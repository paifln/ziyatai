import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { parseEnv } from "node:util";

export async function readEnvFile(path, optional = false) {
  try {
    /** @type {Record<string, string>} */
    const values = {};
    for (const [key, value] of Object.entries(
      parseEnv(await readFile(path, "utf8")),
    )) {
      if (typeof value === "string") values[key] = value;
    }
    return values;
  } catch (error) {
    if (optional && error.code === "ENOENT") return {};
    throw error;
  }
}

/** Validate the actual Node parser round trip instead of treating dotenv as JSON. */
export function serializeEnv(values, format = "dotenv") {
  return (
    Object.entries(values)
      .map(([key, value]) => {
        if (
          !/^[A-Z_][A-Z0-9_]*$/.test(key) ||
          typeof value !== "string" ||
          value.includes("\0")
        )
          throw new Error(`Invalid environment entry: ${key}`);
        if (format === "docker") {
          if (/[\r\n]/.test(value))
            throw new Error(`Docker env requires a single-line ${key}`);
          return `${key}=${value}`;
        }
        const candidates = [
          JSON.stringify(value),
          ...["'", '"', "`"]
            .filter((quote) => !value.includes(quote))
            .map((quote) => `${quote}${value}${quote}`),
        ];
        if (!/[\r\n#]/.test(value) && value.trim() === value)
          candidates.push(value);
        const encoded = candidates.find(
          (candidate) => parseEnv(`${key}=${candidate}`)[key] === value,
        );
        if (encoded === undefined)
          throw new Error(`Cannot safely serialize environment entry: ${key}`);
        return `${key}=${encoded}`;
      })
      .join("\n") + "\n"
  );
}

/** Write beside the destination and rename, so interrupted setup preserves the old file. */
export async function writeEnvFile(path, values, format = "dotenv") {
  const contents = serializeEnv(values, format);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export const isConfigured = (value) =>
  typeof value === "string" &&
  value.trim() !== "" &&
  !/YOUR_|REPLACE_|CHANGE_ME/.test(value);

/** Raw Compose env files preserve literal $, # and quotes without interpolation. */
export function containerEnvironment(values) {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      key === "DATABASE_SSL_CA" ? value.replace(/\r?\n/g, "\\n") : value,
    ]),
  );
}
