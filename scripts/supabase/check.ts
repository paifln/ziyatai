import { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";
import {
  HeadBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { settings, schema, objectStore } from "./migration-config";
import { databaseConnection } from "../../server/infrastructure/database/database-connection";

const path = process.argv[2];
if (!path)
  throw new Error(
    "Usage: tsx scripts/supabase/check.ts .env.supabase.local [--create-bucket] [--storage-probe]",
  );
const values = await settings(path);
const namespace = schema(values);
if (namespace === "public")
  throw new Error("Use a private DATABASE_SCHEMA such as ziyatai");
if (
  [
    values.SUPABASE_URL,
    values.SUPABASE_PUBLISHABLE_KEY,
    values.SUPABASE_SECRET_KEY,
    values.DATABASE_URL,
    values.STORAGE_ACCESS_KEY,
    values.STORAGE_SECRET_KEY,
  ].some((v) => !v || /YOUR_|REPLACE_/.test(v))
)
  throw new Error("Fill the Supabase settings locally before checking");
const client = createClient(values.SUPABASE_URL, values.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const pool = new Pool({
  ...databaseConnection({
    DATABASE_URL: values.DATABASE_URL,
    DATABASE_SSL_CA: values.DATABASE_SSL_CA,
  }),
  max: 1,
  connectionTimeoutMillis: 10000,
});
const storage = objectStore(values);
const probe = `migration-probe/${randomUUID()}.txt`;
let probeWritten = false;
try {
  const { data: bucket, error } = await client.storage.getBucket(
    values.STORAGE_BUCKET,
  );
  if (error) {
    if (
      !process.argv.includes("--create-bucket") ||
      !["404", "not_found"].includes(String(error.statusCode))
    )
      throw new Error("Private storage bucket is missing or inaccessible");
    const created = await client.storage.createBucket(values.STORAGE_BUCKET, {
      public: false,
      fileSizeLimit: 32 * 1024 * 1024,
    });
    if (created.error) throw new Error("Private bucket creation failed");
  } else if (bucket?.public) throw new Error("Storage bucket must be private");
  await storage.send(new HeadBucketCommand({ Bucket: values.STORAGE_BUCKET }), {
    abortSignal: AbortSignal.timeout(10000),
  });
  const roles = await pool.query(
    `SELECT c.relname,c.relrowsecurity,
       has_schema_privilege('anon',n.oid,'USAGE') AS anon_schema,
       has_schema_privilege('authenticated',n.oid,'USAGE') AS user_schema
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname=$1 AND c.relkind='r'`,
    [namespace],
  );
  if (
    !roles.rowCount ||
    roles.rows.some((r) => !r.relrowsecurity || r.anon_schema || r.user_schema)
  )
    throw new Error(
      "Application schema is not private; run migrations and security setup",
    );
  if (process.argv.includes("--storage-probe")) {
    await storage.send(
      new PutObjectCommand({
        Bucket: values.STORAGE_BUCKET,
        Key: probe,
        Body: "ZiyatAI migration probe",
        ContentType: "text/plain",
      }),
      { abortSignal: AbortSignal.timeout(10000) },
    );
    probeWritten = true;
    const downloaded = await storage.send(
      new GetObjectCommand({ Bucket: values.STORAGE_BUCKET, Key: probe }),
      { abortSignal: AbortSignal.timeout(10000) },
    );
    if (
      (await downloaded.Body?.transformToString()) !== "ZiyatAI migration probe"
    )
      throw new Error("Storage probe mismatch");
  }
  console.log(
    JSON.stringify({
      database: "connected",
      privateSchema: "verified",
      storage: "private-and-connected",
      storageProbe: probeWritten ? "passed" : "not-requested",
      emailDelivery: "requires real mailbox test",
    }),
  );
} catch {
  console.error(
    "Supabase check failed. Verify database connection, schema permissions, private bucket and S3 credentials. No secret values were logged.",
  );
  process.exitCode = 1;
} finally {
  if (probeWritten)
    await storage
      .send(
        new DeleteObjectCommand({ Bucket: values.STORAGE_BUCKET, Key: probe }),
        { abortSignal: AbortSignal.timeout(10000) },
      )
      .catch(() => {
        console.error(
          "Remove leftover migration-probe object from the private bucket",
        );
        process.exitCode = 1;
      });
  storage.destroy();
  await pool.end();
}
