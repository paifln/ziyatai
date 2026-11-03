import { createClient } from "@supabase/supabase-js";
import { db } from "../infrastructure/database/db";
import { env } from "../config/env";
import { AppError } from "../../packages/domain/errors";

export async function deleteSupabaseIdentity(owner: string) {
  const result = await db().query(
    "SELECT subject FROM auth_identities WHERE provider='supabase' AND owner_id=$1",
    [owner],
  );
  if (!result.rows[0]) return;
  const client = createClient(env().SUPABASE_URL, env().SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.admin.deleteUser(result.rows[0].subject);
  if (error && error.status !== 404)
    throw new AppError("AUTH_UNAVAILABLE", 503);
}
