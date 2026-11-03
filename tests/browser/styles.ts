import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

// Inline local CSS imports in isolated browser fixtures, just as the Next build does.
export async function stylesheet(path: string): Promise<string> {
  const source = await readFile(path, "utf8");
  const imports = [...source.matchAll(/@import\s+"(\.\/[^";]+\.css)";/g)];
  let result = source;
  for (const match of imports)
    result = result.replace(
      match[0],
      await stylesheet(resolve(dirname(path), match[1])),
    );
  return result;
}
