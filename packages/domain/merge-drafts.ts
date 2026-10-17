export type DraftChoice = "local" | "remote";
export type DraftConflict = {
  key: string;
  path: string[];
  local: unknown;
  remote: unknown;
};

const absent = Object.create(null);
const has = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function draftsEqual(a: unknown, b: unknown): boolean {
  if (a === b || (a !== a && b !== b)) return true;
  if (a === absent || b === absent) return false;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => draftsEqual(v, b[i]));
  if (object(a) && object(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => has(b, key) && draftsEqual(a[key], b[key]))
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
      const seen = Object.create(null),
        keys: string[] = [];
      [b, l, r].forEach((value) =>
        Object.keys(value).forEach((key) => {
          if (!has(seen, key)) {
            seen[key] = true;
            keys.push(key);
          }
        }),
      );
      const result: Record<string, unknown> = {};
      keys.forEach((key) => {
        const value = merge(
          has(b, key) ? b[key] : absent,
          has(l, key) ? l[key] : absent,
          has(r, key) ? r[key] : absent,
          [...path, key],
        );
        if (value !== absent)
          Object.defineProperty(result, key, {
            value,
            enumerable: true,
            configurable: true,
            writable: true,
          });
      });
      return result;
    }
    if (Array.isArray(b) && Array.isArray(l) && Array.isArray(r)) {
      const ids = (items: unknown[]) =>
        items.map((item) =>
          object(item) && typeof item.id === "string" ? item.id : null,
        );
      const bi = ids(b),
        li = ids(l),
        ri = ids(r);
      const unique = Object.create(null);
      const validIds = bi.every((id) => {
        if (id === null || has(unique, id)) return false;
        unique[id] = true;
        return true;
      });
      if (validIds && draftsEqual(bi, li) && draftsEqual(bi, ri))
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
