import { test, expect } from "@playwright/test";
import { headers, verifiedUser } from "./helpers";

test("approving an edited revision clears the obsolete validation warning", async ({
  request,
}) => {
  await verifiedUser(request);
  const demo = await (
    await request.post("/api/demo", { headers, data: { locale: "ru" } })
  ).json();
  const path = `/api/generations/${demo.id}`;
  const original = await (await request.get(path)).json();
  const document = structuredClone(original.document);
  document.tasks[0].contentBlocks[0].text += " Объясните решение.";
  const save = await request.patch(`${path}/document`, {
    headers,
    data: { revision: original.revision, document },
  });
  expect(save.ok(), await save.text()).toBe(true);
  const edited = await (await request.get(path)).json();
  expect(edited.validation.stale).toBe(true);
  expect(edited.reviewed_at).toBeNull();
  const approval = await request.post(`${path}/approve`, {
    headers,
    data: { revision: edited.revision, teacherReviewed: true },
  });
  expect(approval.ok(), await approval.text()).toBe(true);
  const approved = await (await request.get(path)).json();
  expect(approved.reviewed_at).toBeTruthy();
  expect(approved.status).toBe("approved");
  expect(approved.validation.stale).not.toBe(true);
  expect(approved.validation.issues).toEqual([]);
});
