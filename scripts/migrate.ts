import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { db } from "../apps/web/lib/db";
const c = await db().connect();
try {
  await c.query("SELECT pg_advisory_lock(843001)");
  await c.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const name of (await readdir("migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    const sql = await readFile(`migrations/${name}`, "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const old = await c.query(
      "SELECT checksum FROM schema_migrations WHERE name=$1",
      [name],
    );
    if (old.rowCount) {
      if (old.rows[0].checksum !== checksum)
        throw new Error(`Migration modified: ${name}`);
      continue;
    }
    await c.query("BEGIN");
    try {
      await c.query(sql);
      await c.query(
        "INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)",
        [name, checksum],
      );
      await c.query("COMMIT");
      console.log(`Applied ${name}`);
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  }
} finally {
  await c.query("SELECT pg_advisory_unlock(843001)");
  c.release();
  await db().end();
}
