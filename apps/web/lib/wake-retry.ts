/** A sleeping backend can briefly return 502. Only reads may be replayed. */
export async function fetchWithWakeRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  transport: typeof fetch = fetch,
) {
  const safe = ["GET", "HEAD"].includes((init.method ?? "GET").toUpperCase());
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await transport(input, init);
    } catch (error) {
      if (!safe || attempt >= 2 || init.signal?.aborted) throw error;
      await pause(500 * (attempt + 1), init.signal);
      continue;
    }
    if (!safe || attempt >= 2 || ![502, 503, 504].includes(response.status))
      return response;
    await response.body?.cancel();
    await pause(500 * (attempt + 1), init.signal);
  }
}
function pause(ms: number, signal?: AbortSignal | null) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}
