import { it, expect } from "vitest";
import { DraftGuard } from "../packages/domain/draft-guard";

it("rejects a background response if editing began while it was in flight", () => {
  const guard = new DraftGuard();
  const read = guard.checkpoint();
  guard.mark(true);
  expect(guard.canReplace(read)).toBe(false);
  expect(guard.canReplace(read, true)).toBe(false);
});
it("keeps existing unsaved edits but permits reloading the exact saved draft", () => {
  const guard = new DraftGuard();
  guard.mark(true);
  const read = guard.checkpoint();
  expect(guard.canReplace(read)).toBe(false);
  expect(guard.canReplace(read, true)).toBe(true);
  guard.mark(false);
  expect(guard.canReplace(guard.checkpoint())).toBe(true);
});
