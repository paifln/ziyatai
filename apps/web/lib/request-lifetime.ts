/** A workspace owns its requests, including native responses that set cookies. */
export function createRequestLifetime() {
  let controller = new AbortController();
  return {
    get signal() {
      return controller.signal;
    },
    activate() {
      // React Strict Mode replays effects for the same mounted owner.
      if (controller.signal.aborted) controller = new AbortController();
    },
    stop() {
      controller.abort();
    },
  };
}

/** Avoid AbortSignal.any: supported school browsers may not implement it. */
export async function withinRequestLifetime<T>(
  caller: AbortSignal | undefined,
  lifetime: AbortSignal | undefined,
  operation: (signal?: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!caller || !lifetime || caller === lifetime)
    return operation(caller ?? lifetime);
  const controller = new AbortController();
  const cancelCaller = () => controller.abort(caller.reason);
  const cancelLifetime = () => controller.abort(lifetime.reason);
  caller.addEventListener("abort", cancelCaller, { once: true });
  lifetime.addEventListener("abort", cancelLifetime, { once: true });
  if (caller.aborted) cancelCaller();
  if (lifetime.aborted) cancelLifetime();
  try {
    return await operation(controller.signal);
  } finally {
    caller.removeEventListener("abort", cancelCaller);
    lifetime.removeEventListener("abort", cancelLifetime);
  }
}
