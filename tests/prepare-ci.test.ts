import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";

it("prepares document integration only with local Supabase and real local S3 credentials", () => {
  const root = mkdtempSync(join(tmpdir(), "ziyatai-ci-env-"));
  const script = resolve("scripts/supabase/prepare-ci.ts");
  const loader = pathToFileURL(
    resolve("node_modules/tsx/dist/loader.mjs"),
  ).href;
  const status = {
    API_URL: "http://127.0.0.1:54321",
    DB_URL: "postgresql://postgres:synthetic@127.0.0.1:54322/postgres",
    PUBLISHABLE_KEY: "fixture-public",
    SECRET_KEY: "fixture-server",
    S3_PROTOCOL_ACCESS_KEY_ID: "fixture-s3-id",
    S3_PROTOCOL_ACCESS_KEY_SECRET: "fixture-s3-secret",
    S3_PROTOCOL_REGION: "local",
  };
  const run = () =>
    execFileSync(
      process.execPath,
      ["--import", loader, script, "--documents"],
      { cwd: root, stdio: "pipe", windowsHide: true },
    );
  try {
    mkdirSync(join(root, ".local"));
    const input = join(root, ".local/supabase-status.json");
    writeFileSync(
      input,
      JSON.stringify({ ...status, API_URL: "https://hosted.example.test" }),
    );
    expect(run).toThrow();
    expect(existsSync(join(root, ".env.local"))).toBe(false);
    writeFileSync(
      input,
      JSON.stringify({ ...status, S3_PROTOCOL_ACCESS_KEY_SECRET: "" }),
    );
    expect(run).toThrow();
    expect(existsSync(join(root, ".env.local"))).toBe(false);
    writeFileSync(input, JSON.stringify(status));
    run();
    const env = readFileSync(join(root, ".env.local"), "utf8");
    expect(env).toContain('SCAN_REQUIRED="true"');
    expect(env).toContain('STORAGE_ACCESS_KEY="fixture-s3-id"');
    expect(env).not.toContain("ci-storage-unused");
    const token = JSON.parse(env.match(/^RENDERER_TOKEN=(.+)$/m)![1]);
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(readFileSync(join(root, ".local/renderer.env"), "utf8")).toBe(
      `RENDERER_TOKEN=${token}\n`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
