import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// Initial install into an empty Supabase project. Existing numbered migrations
// retain their checksums so the normal application migrator can continue later.
const statements = [
  "CREATE SCHEMA ziyatai;",
  "SET LOCAL search_path TO ziyatai, public;",
  "CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now());",
];
for (const name of (await readdir("migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort()) {
  const sql = await readFile(`migrations/${name}`, "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");
  statements.push(
    sql,
    `INSERT INTO schema_migrations(name,checksum) VALUES('${name.replaceAll("'", "''")}','${checksum}');`,
  );
}
statements.push(
  "ALTER FUNCTION ziyatai.project_ktp_rows() SET search_path = ziyatai, pg_temp;",
  "REVOKE ALL ON SCHEMA ziyatai FROM PUBLIC, anon, authenticated;",
  "REVOKE ALL ON ALL TABLES IN SCHEMA ziyatai FROM PUBLIC, anon, authenticated;",
  "REVOKE ALL ON ALL SEQUENCES IN SCHEMA ziyatai FROM PUBLIC, anon, authenticated;",
  "REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ziyatai FROM PUBLIC, anon, authenticated;",
  `DO $$ DECLARE item record; BEGIN
    FOR item IN SELECT tablename FROM pg_tables WHERE schemaname='ziyatai' LOOP
      EXECUTE format('ALTER TABLE ziyatai.%I ENABLE ROW LEVEL SECURITY', item.tablename);
    END LOOP;
  END $$;`,
  "ALTER DEFAULT PRIVILEGES IN SCHEMA ziyatai REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;",
  "ALTER DEFAULT PRIVILEGES IN SCHEMA ziyatai REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;",
  "ALTER DEFAULT PRIVILEGES IN SCHEMA ziyatai REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;",
);
const sql = statements.join("\n\n");
await mkdir(".local", { recursive: true });
await writeFile(".local/supabase-bootstrap.sql", sql);
if (process.argv.includes("--stdout")) process.stdout.write(sql);
else
  console.log(
    "Prepared .local/supabase-bootstrap.sql for an empty Supabase project.",
  );
