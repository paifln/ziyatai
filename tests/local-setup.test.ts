import { expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import {
  serializeEnv,
  readEnvFile,
  containerEnvironment,
} from "../scripts/lib/env-file.mjs";
import { prepareLocal } from "../scripts/dev/setup";

it("preserves multiline certificates, literal escapes, quotes and hashes across env writes", () => {
  const values = {
    CA: "-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----",
    ESCAPED: "first\\nsecond",
    NAME: 'O\'Neil "School" #1',
    PASSWORD: "literal$VALUE#suffix",
  };
  expect(parseEnv(serializeEnv(values))).toEqual(values);
  expect(() => serializeEnv({ TOKEN: "first\nsecond" }, "docker")).toThrow(
    "single-line TOKEN",
  );
  expect(() => serializeEnv({ "BAD\nKEY": "synthetic" })).toThrow(
    "Invalid environment entry",
  );
});

it("keeps Docker credentials literal while passing the TLS certificate in its supported escaped form", () => {
  const values = {
    DATABASE_SSL_CA: "first\nsecond",
    TOKEN: 'literal$VALUE#quote"end',
    STORAGE_SECRET_KEY: "literal\\nsecret",
  };
  const raw = serializeEnv(containerEnvironment(values), "docker");
  expect(raw).toContain("DATABASE_SSL_CA=first\\nsecond\n");
  expect(raw).toContain('TOKEN=literal$VALUE#quote"end\n');
  expect(raw).toContain("STORAGE_SECRET_KEY=literal\\nsecret\n");
});

it("bootstraps a fresh checkout with usable local endpoints and stable shared credentials", async () => {
  await mkdir(".local", { recursive: true });
  const directory = await mkdtemp(resolve(".local/setup-test-"));
  await writeFile(
    resolve(directory, ".env.example"),
    await readFile(".env.example", "utf8"),
  );
  const first = await prepareLocal(directory);
  expect(first.values).toMatchObject({
    APP_ENV: "local",
    APP_URL: "http://localhost:3000",
    RENDERER_URL: "http://127.0.0.1:18090",
    CLAMAV_HOST: "127.0.0.1",
    CLAMAV_PORT: "13310",
    OPENAI_API_KEY: "",
    OPENAI_MODEL: "",
  });
  expect(first.values.AUTH_SECRET).toHaveLength(64);
  expect(
    (await readEnvFile(resolve(directory, ".local/renderer.env")))
      .RENDERER_TOKEN,
  ).toBe(first.values.RENDERER_TOKEN);
  const second = await prepareLocal(directory);
  expect(second.values).toEqual(first.values);
});

it("retains custom endpoints and credentials when preparing an existing environment", async () => {
  await mkdir(".local", { recursive: true });
  const directory = await mkdtemp(resolve(".local/setup-existing-"));
  const values = {
    APP_ENV: "local",
    APP_URL: "http://localhost:3100",
    AUTH_SECRET: "a".repeat(64),
    RENDERER_TOKEN: "b".repeat(64),
    RENDERER_URL: "http://127.0.0.1:18095",
    CLAMAV_HOST: "127.0.0.1",
    CLAMAV_PORT: "13315",
    DATABASE_SSL_CA: "first\\nsecond",
    OPENAI_API_KEY: "synthetic-provider-key",
    OPENAI_MODEL: "synthetic-model",
  };
  await writeFile(resolve(directory, ".env.local"), serializeEnv(values));
  expect((await prepareLocal(directory)).values).toMatchObject(values);
});
