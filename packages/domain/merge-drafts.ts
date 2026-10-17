export type DraftChoice = "local" | "remote";
export type DraftConflict = {
  key: string;
  path: string[];
  local: unknown;
  remote: unknown;
};

const absent = Symbol("absent");
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function draftsEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => draftsEqual(v, b[i]));
  if (object(a) && object(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && draftsEqual(a[key], b[key]))
    );
  }
  return false;
}

/** Conservative three-way merge. Array structure changes always need a choice.
 * Stable ID arrays permit independent rows/tasks to merge. Unkeyed arrays are
 * atomic: matching lengths alone do not prove matching content-block identity.
 * Inputs are never mutated; an unresolved conflict keeps the local value.
 */
export function mergeDrafts<T>(
  base: T,
  local: T,
  remote: T,
  choices: Record<string, DraftChoice> = {},
) {
  const conflicts: DraftConflict[] = [];
  function merge(b: unknown, l: unknown, r: unknown, path: string[]): unknown {
    if (draftsEqual(l, r)) return l;
    if (draftsEqual(b, l)) return r;
    if (draftsEqual(b, r)) return l;
    if (object(b) && object(l) && object(r)) {
      const keys = new Set([
        ...Object.keys(b),
        ...Object.keys(l),
        ...Object.keys(r),
      ]);
      return Object.fromEntries(
        [...keys].flatMap((key) => {
          const value = merge(
            Object.hasOwn(b, key) ? b[key] : absent,
            Object.hasOwn(l, key) ? l[key] : absent,
            Object.hasOwn(r, key) ? r[key] : absent,
            [...path, key],
          );
          return value === absent ? [] : [[key, value]];
        }),
      );
    }
    if (Array.isArray(b) && Array.isArray(l) && Array.isArray(r)) {
      const ids = (items: unknown[]) =>
        items.map((item) =>
          object(item) && typeof item.id === "string" ? item.id : null,
        );
      const bi = ids(b),
        li = ids(l),
        ri = ids(r);
      if (
        bi.every((id) => id !== null) &&
        new Set(bi).size === bi.length &&
        draftsEqual(bi, li) &&
        draftsEqual(bi, ri)
      )
        return b.map((value, i) =>
          merge(value, l[i], r[i], [...path, String(i)]),
        );
    }
    const key = JSON.stringify(path);
    conflicts.push({
      key,
      path,
      local: l === absent ? undefined : l,
      remote: r === absent ? undefined : r,
    });
    return choices[key] === "remote" ? r : l;
  }
  return { merged: merge(base, local, remote, []) as T, conflicts };
}
