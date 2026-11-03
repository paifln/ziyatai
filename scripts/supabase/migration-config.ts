import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";

export async function settings(path: string) {
  const parsed = parseEnv(await readFile(path, "utf8"));
  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value === "string") values[name] = value;
  }
  return values;
}
export function identifier(value: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(value))
    throw new Error("Invalid database identifier");
  return `"${value}"`;
}
export function schema(values: Record<string, string>) {
  const name = values.DATABASE_SCHEMA || "public";
  identifier(name);
  return name;
}
export function objectStore(values: Record<string, string>) {
  const endpoint = z.url().parse(values.STORAGE_ENDPOINT);
  return new S3Client({
    endpoint,
    region: z.string().min(1).parse(values.STORAGE_REGION),
    forcePathStyle: values.STORAGE_FORCE_PATH_STYLE !== "false",
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: z.string().min(1).parse(values.STORAGE_ACCESS_KEY),
      secretAccessKey: z.string().min(1).parse(values.STORAGE_SECRET_KEY),
    },
  });
}
export function migrationArguments() {
  const args = process.argv.slice(2);
  const option = (name: string) => {
    const index = args.indexOf(name);
    if (index < 0 || !args[index + 1] || args[index + 1].startsWith("--"))
      throw new Error(`Missing ${name}`);
    return args[index + 1];
  };
  const apply = args.includes("--apply");
  if (apply && !args.includes("--maintenance"))
    throw new Error(
      "Stop source web/worker writes, then pass --maintenance with --apply",
    );
  return {
    source: option("--source-env"),
    target: option("--target-env"),
    apply,
  };
}
