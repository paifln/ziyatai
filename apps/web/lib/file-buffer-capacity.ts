import { AppError } from "../../../packages/domain/errors";

// Multipart validation and PDF preview conversion both buffer source files.
// Share one process budget instead of letting preview bursts bypass uploads' cap.
let active = 0;
const maximum = 2;
function acquire() {
  if (active >= maximum) throw new AppError("LIMIT", 429);
  active++;
  let released = false;
  return () => {
    if (!released) {
      released = true;
      active--;
    }
  };
}
export async function withFileBufferCapacity<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const release = acquire();
  try {
    return await operation();
  } finally {
    release();
  }
}

/** Keep admission until the response drains/cancels, not just until PNG creation. */
export async function withFileBufferResponse(
  operation: () => Promise<Response>,
  signal: AbortSignal,
) {
  const release = acquire();
  try {
    const response = await operation();
    if (!response.body) {
      release();
      return response;
    }
    const reader = response.body.getReader();
    let chunk: Uint8Array | undefined;
    let offset = 0;
    let stopped = false;
    let output: ReadableStreamDefaultController<Uint8Array>;
    const finish = () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      chunk = undefined;
      release();
    };
    const abort = () => {
      if (stopped) return;
      output.error(new Error("File transfer interrupted"));
      void reader.cancel().catch(() => undefined);
      finish();
    };
    const timer = setTimeout(abort, 30000);
    timer.unref();
    const stream = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          output = controller;
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) abort();
        },
        async pull(controller) {
          try {
            if (!chunk || offset === chunk.byteLength) {
              const next = await reader.read();
              if (stopped) return;
              if (next.done) {
                controller.close();
                finish();
                return;
              }
              chunk = next.value;
              offset = 0;
            }
            const end = Math.min(offset + 64 * 1024, chunk.byteLength);
            controller.enqueue(chunk.subarray(offset, end));
            offset = end;
          } catch (error) {
            if (!stopped) {
              controller.error(error);
              finish();
            }
          }
        },
        cancel() {
          void reader.cancel().catch(() => undefined);
          finish();
        },
      },
      { highWaterMark: 0 },
    );
    return new Response(stream, {
      status: response.status,
      headers: response.headers,
    });
  } catch (error) {
    release();
    throw error;
  }
}
