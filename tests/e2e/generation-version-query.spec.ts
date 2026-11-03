import { test, expect } from "@playwright/test";
import { headers, verifiedUser } from "./helpers";

test("generation revision queries validate SQL integers and never disguise a missing version as the current document", async ({
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "kk" } })
  ).json();
  for (const revision of [
    "",
    "NaN",
    "Infinity",
    "1.5",
    "-1",
    "0",
    "2147483648",
    "1 OR 1=1",
  ]) {
    const response = await request.get(
      `/api/generations/${demo.id}?revision=${encodeURIComponent(revision)}`,
    );
    expect(response.status(), revision).toBe(422);
    expect((await response.json()).code).toBe("FILE_INVALID");
  }
  const current = await request.get(`/api/generations/${demo.id}`);
  const first = await request.get(`/api/generations/${demo.id}?revision=1`);
  expect(current.status()).toBe(200);
  expect(first.status()).toBe(200);
  expect((await first.json()).document).toEqual(
    (await current.json()).document,
  );
  const missing = await request.get(
    `/api/generations/${demo.id}?revision=2147483647`,
  );
  expect(missing.status()).toBe(404);
  expect((await missing.json()).code).toBe("NOT_FOUND");
});
