/** Coalesce slow heartbeats and contain background errors inside the job lifecycle. */
export function startHeartbeat(
  refresh: () => Promise<unknown>,
  intervalMs = 10000,
) {
  let pending = false;
  let stopped = false;
  const timer = setInterval(() => {
    if (pending || stopped) return;
    pending = true;
    void Promise.resolve()
      .then(refresh)
      .catch(() => {
        console.error(JSON.stringify({ event: "worker_heartbeat_failed" }));
      })
      .finally(() => {
        pending = false;
      });
  }, intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
