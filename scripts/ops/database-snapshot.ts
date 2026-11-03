import type { PoolClient } from "pg";
import { Readable } from "node:stream";
import { identifier } from "../supabase/migration-config";

const derived = new Set([
  "schema_migrations",
  "ktp_rows",
  "resource_budgets",
  "worker_health",
  "api_limits",
  "api_read_budgets",
  "auth_session_read_budgets",
]);
/** Exact JSON row text preserves PostgreSQL numeric precision. */
export async function databaseSnapshot(
  client: PoolClient,
  schema: string,
  referenced: Map<string, string | undefined>,
) {
  const q = identifier(schema);
  const catalog = (
    await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename",
      [schema],
    )
  ).rows
    .map((row) => String(row.tablename))
    .filter((name) => !derived.has(name));
  const dependencies = (
    await client.query(
      "SELECT child.relname AS child,parent.relname AS parent FROM pg_constraint c JOIN pg_class child ON child.oid=c.conrelid JOIN pg_namespace n ON n.oid=child.relnamespace JOIN pg_class parent ON parent.oid=c.confrelid WHERE c.contype='f' AND n.nspname=$1",
      [schema],
    )
  ).rows;
  const remaining = new Set(catalog),
    tables: string[] = [];
  while (remaining.size) {
    const ready = [...remaining].filter(
      (name) =>
        !dependencies.some(
          (d) =>
            d.child === name && d.parent !== name && remaining.has(d.parent),
        ),
    );
    if (!ready.length) throw new Error("Unsupported circular dependencies");
    for (const name of ready) {
      tables.push(name);
      remaining.delete(name);
    }
  }
  async function* rows() {
    for (const table of tables) {
      let count = 0;
      await client.query(
        `DECLARE snapshot_rows NO SCROLL CURSOR FOR SELECT row_to_json(t)::text AS document FROM ${q}.${identifier(table)} t`,
      );
      try {
        for (;;) {
          const large = [
            "plan_versions",
            "generation_versions",
            "editor_drafts",
          ].includes(table);
          const batch = await client.query(
            large
              ? "FETCH FORWARD 5 FROM snapshot_rows"
              : "FETCH FORWARD 500 FROM snapshot_rows",
          );
          if (!batch.rowCount) break;
          for (const row of batch.rows) {
            count++;
            if (table === "uploads" || table === "exports") {
              const value = JSON.parse(row.document);
              if (
                value.object_key &&
                ["complete", "succeeded"].includes(value.status) &&
                !value.deleted_at
              )
                referenced.set(
                  value.object_key,
                  /^[a-f0-9]{64}$/.test(value.checksum || "")
                    ? value.checksum
                    : undefined,
                );
            }
            yield JSON.stringify({ table, row: row.document }) + "\n";
          }
        }
      } finally {
        await client.query("CLOSE snapshot_rows");
      }
      console.log(
        JSON.stringify({ event: "backup_table_encrypted", table, rows: count }),
      );
    }
  }
  const inventory = [];
  for (const table of tables) {
    const columns = (
      await client.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position",
        [schema, table],
      )
    ).rows.map((row) => String(row.column_name));
    const fingerprint = (
      await client.query(
        `SELECT count(*)::text AS count,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) AS digest FROM ${q}.${identifier(table)} t`,
      )
    ).rows[0];
    inventory.push({ table, columns, ...fingerprint });
  }
  return { stream: Readable.from(rows()), tables, inventory };
}
