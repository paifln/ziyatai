import { expect, it, vi } from "vitest";
import { fetchWithWakeRetry } from "../apps/web/lib/wake-retry";
it("retries a cold-start read but never repeats a mutation", async () => {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("warming", { status: 502 }))
    .mockResolvedValueOnce(new Response("ready"));
  expect(
    (
      await fetchWithWakeRetry(
        "https://example.test",
        { method: "GET" },
        transport,
      )
    ).status,
  ).toBe(200);
  expect(transport).toHaveBeenCalledTimes(2);
  transport
    .mockClear()
    .mockResolvedValue(new Response("warming", { status: 502 }));
  expect(
    (
      await fetchWithWakeRetry(
        "https://example.test",
        { method: "POST" },
        transport,
      )
    ).status,
  ).toBe(502);
  expect(transport).toHaveBeenCalledTimes(1);
});
it("does not retry an aborted request or a rate limit", async () => {
  const controller = new AbortController();
  controller.abort();
  const transport = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new DOMException("Aborted", "AbortError"));
  await expect(
    fetchWithWakeRetry(
      "https://example.test",
      { signal: controller.signal },
      transport,
    ),
  ).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(1);
  const limited = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("limited", { status: 429 }));
  expect(
    (await fetchWithWakeRetry("https://example.test", {}, limited)).status,
  ).toBe(429);
  expect(limited).toHaveBeenCalledTimes(1);
});
