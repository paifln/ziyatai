import { AppError } from "../../../packages/domain/errors";

/** Bound actual streamed bytes too: Content-Length is optional and untrusted. */
export async function readBoundedBody(
  request: Request,
  maximum: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = request.headers.get("content-length");
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)))
  )
    throw new AppError("FILE_INVALID", 400);
  if (declared !== null && Number(declared) > maximum) {
    await request.body?.cancel().catch(() => undefined);
    throw new AppError("FILE_SIZE", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel();
        throw new AppError("FILE_SIZE", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function readJsonBody(
  request: Request,
  maximum = 2 * 1024 * 1024,
): Promise<unknown> {
  const bytes = await readBoundedBody(request, maximum);
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
  const bytes = await readBoundedBody(request, maximum);
  return new Request(request, { body: bytes });
}
