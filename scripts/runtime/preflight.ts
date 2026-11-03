import { env } from "../../apps/web/lib/env";
import { db } from "../../apps/web/lib/db";
const e = env();
if (
  e.APP_ENV === "production" &&
  (!e.OPENAI_API_KEY || !e.OPENAI_MODEL || !e.CLAMAV_HOST)
)
  throw new Error("Production OpenAI or antivirus provider is not configured");
console.log("Server configuration validated.");
if (e.APP_ENV === "production") {
  const result = await db()
    .query(`SELECT r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls OR
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND c.relname='users' AND has_table_privilege(current_user,c.oid,'SELECT,UPDATE')) AS unsafe
    FROM pg_roles r WHERE r.rolname=current_user`);
  await db().end();
  if (result.rows[0]?.unsafe !== false)
    throw new Error(
      "Production requires a scoped runtime database role; migrate separately with the maintenance credential",
    );
  console.log("Runtime database privileges validated.");
}
