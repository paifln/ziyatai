import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { checkPublicArtifacts } from "../scripts/checks/check-public-artifacts.mjs";

it("finds leaked raw and encoded credentials without returning their values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ziyatai-public-"));
  const secret = 'synthetic-pass/with+characters"123';
  try {
    await writeFile(join(directory, "main.js"), JSON.stringify(secret));
    await writeFile(join(directory, "index.html"), encodeURIComponent(secret));
    const report = await checkPublicArtifacts([directory], {
      AUTH_SECRET: secret,
      NEXT_PUBLIC_ORIGIN: "https://example.test",
    });
    expect(report.files).toBe(2);
    expect(report.credentialCount).toBe(1);
    expect(
      report.issues.map((issue: { variable: string }) => issue.variable),
    ).toEqual(["AUTH_SECRET", "AUTH_SECRET"]);
    expect(JSON.stringify(report)).not.toContain(secret);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("permits public configuration and never treats variable names as secret values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ziyatai-public-"));
  try {
    await writeFile(
      join(directory, "main.js"),
      'const keyName="AUTH_SECRET";const origin="https://example.test";',
    );
    expect(
      (
        await checkPublicArtifacts([directory], {
          AUTH_SECRET: "synthetic-not-in-bundle",
          NEXT_PUBLIC_ORIGIN: "https://example.test",
        })
      ).issues,
    ).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
