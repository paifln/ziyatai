import { expect, it } from "vitest";
import { databaseConnection } from "../apps/web/lib/database-connection";

it("preserves a local database connection without enabling TLS implicitly", () => {
  const url = "postgresql://test:test@127.0.0.1:55432/fixture";
  expect(databaseConnection({ DATABASE_URL: url })).toEqual({
    connectionString: url,
  });
});

it("keeps certificate and hostname verification active despite conflicting URL options", () => {
  const options = databaseConnection({
    DATABASE_URL:
      "postgresql://test:p%23ss@pool.example.test:5432/postgres?sslmode=no-verify&sslrootcert=other&ssl=false&application_name=fixture",
    DATABASE_SSL_CA: "certificate\\nwith-newlines",
  });
  expect(options.ssl).toEqual({
    ca: "certificate\nwith-newlines",
    rejectUnauthorized: true,
  });
  const parsed = new URL(options.connectionString!);
  expect(parsed.searchParams.has("sslmode")).toBe(false);
  expect(parsed.searchParams.has("sslrootcert")).toBe(false);
  expect(parsed.searchParams.has("ssl")).toBe(false);
  expect(parsed.searchParams.get("application_name")).toBe("fixture");
  expect(parsed.password).toBe("p%23ss");
});
