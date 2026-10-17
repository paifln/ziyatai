import { expect, it } from "vitest";
import { draftsEqual, mergeDrafts } from "../packages/domain/merge-drafts";

it("merges independent task and row fields without changing inputs", () => {
  const base = {
    rows: [
      { id: "a", topic: "A", goals: "G" },
      { id: "b", topic: "B", goals: "H" },
    ],
  };
  const local = structuredClone(base),
    remote = structuredClone(base);
  local.rows[0].topic = "Local";
  remote.rows[0].goals = "Remote goal";
  remote.rows[1].topic = "Remote";
  const result = mergeDrafts(base, local, remote);
  expect(result.conflicts).toEqual([]);
  expect(result.merged.rows).toEqual([
    { id: "a", topic: "Local", goals: "Remote goal" },
    { id: "b", topic: "Remote", goals: "H" },
  ]);
  expect(base.rows[0].topic).toBe("A");
  expect(local.rows[1].topic).toBe("B");
});
it("requires an explicit choice for the same changed field and handles deletions", () => {
  const base = { text: "base", optional: "base" };
  const local: Partial<typeof base> = { text: "local" };
  const remote = { text: "remote", optional: "remote" };
  const result = mergeDrafts<Partial<typeof base>>(base, local, remote);
  expect(result.conflicts).toHaveLength(2);
  expect(result.merged).toEqual(local);
  const choices = Object.fromEntries(
    result.conflicts.map((c) => [c.key, "remote" as const]),
  );
  expect(
    mergeDrafts<Partial<typeof base>>(base, local, remote, choices).merged,
  ).toEqual(remote);
});
it("does not guess identities after insertions, deletion, reordering or unkeyed block changes", () => {
  for (const [base, local, remote] of [
    [
      [{ id: "a", text: "A" }],
      [{ id: "b", text: "B" }],
      [{ id: "a", text: "R" }],
    ],
    [
      [{ id: "a" }, { id: "b" }],
      [{ id: "b" }, { id: "a" }],
      [{ id: "a", text: "R" }, { id: "b" }],
    ],
    [
      [{ text: "A" }, { text: "B" }],
      [{ text: "L" }, { text: "B" }],
      [{ text: "A" }, { text: "R" }],
    ],
  ]) {
    const result = mergeDrafts(base, local, remote);
    expect(result.conflicts).toHaveLength(1);
    expect(result.merged).toEqual(local);
  }
});
it("recognizes a write whose response was lost and ignores object key order", () => {
  const local = { text: "saved", count: 2 };
  const remote = { count: 2, text: "saved" };
  expect(draftsEqual(local, remote)).toBe(true);
  expect(mergeDrafts({ text: "old", count: 1 }, local, remote)).toEqual({
    merged: local,
    conflicts: [],
  });
});
it("merges JSON keys without mutating the object prototype", () => {
  const base = JSON.parse('{"text":"base","__proto__":{"value":0}}');
  const local = JSON.parse('{"text":"local","__proto__":{"value":0}}');
  const remote = JSON.parse('{"text":"base","__proto__":{"value":1}}');
  const { merged, conflicts } = mergeDrafts(base, local, remote);
  expect(conflicts).toHaveLength(0);
  expect(Object.hasOwn(merged, "__proto__")).toBe(true);
  expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
  expect(({} as { value?: number }).value).toBeUndefined();
});
