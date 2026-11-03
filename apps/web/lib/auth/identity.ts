import { randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { transaction, db } from "../db";
import { AppError } from "../../../../packages/domain/errors";

export function confirmedIdentity(user: User) {
  if (!user.email || !user.email_confirmed_at || user.is_anonymous)
    throw new AppError("UNAUTHORIZED", 401);
  return { subject: user.id, email: user.email.trim().toLowerCase() };
}

// Called only after Supabase has authenticated the current user.
export async function provisionIdentity(
  user: User,
  sessionId: string,
  details: { name?: string; teachingSubject?: string } = {},
  emailProof = false,
) {
  const { subject, email } = confirmedIdentity(user);
  return transaction(async (c) => {
    // Serialize first sign-in/linking across different Supabase sessions.
    await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      email,
    ]);
    const bound = await c.query(
      "SELECT owner_id FROM auth_identities WHERE provider='supabase' AND subject=$1",
      [subject],
    );
    let owner = bound.rows[0]?.owner_id as string | undefined;
    if (!owner) {
      const previous = await c.query(
        'SELECT id FROM "user" WHERE lower(email)=$1 FOR UPDATE',
        [email],
      );
      if (previous.rows.length > 1) throw new AppError("UNAUTHORIZED", 401);
      owner = previous.rows[0]?.id;
      // Password login alone must never claim an unbound imported account.
      if (owner && !emailProof) throw new AppError("EMAIL_NOT_VERIFIED", 403);
      if (!owner) {
        owner = randomUUID();
        await c.query(
          'INSERT INTO "user"(id,name,email,"emailVerified","teachingSubject") VALUES($1,$2,$3,true,$4)',
          [
            owner,
            details.name || email.split("@")[0],
            email,
            details.teachingSubject || "",
          ],
        );
      }
      await c.query(
        "INSERT INTO auth_identities(provider,subject,owner_id) VALUES('supabase',$1,$2)",
        [subject, owner],
      );
    }
    const deleted = await c.query(
      "SELECT deleted_at FROM profiles WHERE owner_id=$1",
      [owner],
    );
    if (deleted.rows[0]?.deleted_at) throw new AppError("UNAUTHORIZED", 401);
    await c.query('UPDATE "user" SET "emailVerified"=true WHERE id=$1', [
      owner,
    ]);
    await c.query(
      "INSERT INTO auth_sessions(id,owner_id) VALUES($1,$2) ON CONFLICT(id) DO NOTHING",
      [sessionId, owner],
    );
    return owner;
  });
}

export async function readIdentity(user: User, sessionId: string) {
  const { subject } = confirmedIdentity(user);
  const found = await db().query(
    `SELECT u.id,u.name,u.email,u.image,u."emailVerified",u."createdAt",u."updatedAt"
     FROM auth_identities i JOIN "user" u ON u.id=i.owner_id
     JOIN auth_sessions s ON s.owner_id=u.id AND s.id=$2 AND s.revoked_at IS NULL
     LEFT JOIN profiles p ON p.owner_id=u.id
     WHERE i.provider='supabase' AND i.subject=$1 AND p.deleted_at IS NULL`,
    [subject, sessionId],
  );
  return found.rows[0] ?? null;
}
