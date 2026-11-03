import { AppError } from "../../../packages/domain/errors";

/** Bound actual streamed bytes too: Content-Length is optional and untrusted. */
export async function readBoundedBody(
  request: {
    headers: Headers;
    body: ReadableStream<Uint8Array<ArrayBufferLike>> | null;
  },
  maximum: number,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isSafeInteger(maximum) || maximum < 0) {
    void request.body?.cancel().catch(() => undefined);
    throw new RangeError("Body byte limit must be a nonnegative safe integer");
  }
  const declared = request.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)))
  ) {
    void request.body?.cancel().catch(() => undefined);
    throw new AppError("FILE_INVALID", 400);
  }
  if (declared !== null && Number(declared) > maximum) {
    void request.body?.cancel().catch(() => undefined);
    throw new AppError("FILE_SIZE", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  if (options.signal?.aborted) {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
    throw new AppError("REQUEST_TIMEOUT", 408);
  }
  let interruption: AppError | undefined;
  const interrupt = () => {
    interruption = new AppError("REQUEST_TIMEOUT", 408);
    // Cancel without awaiting an untrusted stream's cancellation callback.
    void reader.cancel().catch(() => undefined);
  };
  options.signal?.addEventListener("abort", interrupt, { once: true });
  const timer =
    options.timeoutMs === undefined
      ? undefined
      : setTimeout(interrupt, options.timeoutMs);
  timer?.unref();
  let result = new Uint8Array(0);
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (interruption) throw interruption;
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        void reader.cancel().catch(() => undefined);
        throw new AppError("FILE_SIZE", 413);
      }
      // Do not retain one object per network chunk: millions of tiny chunks
      // must not amplify a small byte budget into unbounded heap overhead.
      if (total > result.byteLength) {
        const capacity = Math.min(
          maximum,
          Math.max(total, 8192, result.byteLength * 2),
        );
        const expanded = new Uint8Array(capacity);
        expanded.set(result);
        result = expanded;
      }
      result.set(value, total - value.byteLength);
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", interrupt);
    reader.releaseLock();
  }
  return total === result.byteLength ? result : result.slice(0, total);
}

export async function readJsonBody(
  request: Request,
  maximum = 2 * 1024 * 1024,
): Promise<unknown> {
  const bytes = await readBoundedBody(request, maximum, {
    signal: request.signal,
    timeoutMs: 60000,
  });
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new AppError("FILE_INVALID", 400);
  }
}

export async function boundedRequest(
  request: Request,
  maximum: number,
): Promise<Request> {
  const bytes = await readBoundedBody(request, maximum, {
    signal: request.signal,
    timeoutMs: 60000,
  });
  return new Request(request, { body: bytes });
}
