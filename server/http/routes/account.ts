import { randomUUID } from "node:crypto";
import { z } from "zod";
import { readJsonBody as body } from "../request-body";
import { db, transaction } from "../../infrastructure/database/db";
import { env } from "../../config/env";
import { enqueue } from "../../infrastructure/queue/queue";
import { Styles } from "../../../packages/contracts";
import { type ApiContext, json } from "../context";
export async function handleAccount(
  context: ApiContext,
): Promise<Response | undefined> {
  const { req, resource, method, owner, session } = context;
  if (resource === "account" && method === "DELETE") {
    await transaction(async (c) => {
      await c.query(
        "INSERT INTO profiles(owner_id,deleted_at) VALUES($1,now()) ON CONFLICT(owner_id) DO UPDATE SET deleted_at=now()",
        [owner],
      );
      await c.query(
        "UPDATE auth_sessions SET revoked_at=now() WHERE owner_id=$1",
        [owner],
      );
      await c.query("DELETE FROM editor_drafts WHERE owner_id=$1", [owner]);
      for (const table of ["uploads", "plans", "generations", "exports"])
        await c.query(
          `UPDATE ${table} SET deleted_at=now() WHERE owner_id=$1`,
          [owner],
        );
      await c.query(
        "UPDATE jobs SET cancel_requested=true,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END WHERE owner_id=$1 AND kind!='delete'",
        [owner],
      );
      await enqueue(
        c,
        owner,
        "delete",
        randomUUID(),
        { scope: "account" },
        `delete:account:${owner}`,
      );
    });
    return json({ deleted: true });
  }
  if (resource === "profile") {
    if (method === "GET") {
      await db().query(
        "INSERT INTO profiles(owner_id) VALUES($1) ON CONFLICT DO NOTHING",
        [owner],
      );
      const profile = (
        await db().query(
          "SELECT school,locale,grades,styles FROM profiles WHERE owner_id=$1",
          [owner],
        )
      ).rows[0];
      return json({
        ...profile,
        styles: Styles.parse({
          font: env().DEFAULT_EXPORT_FONT,
          ...(profile.styles ?? {}),
        }),
        name: session.user.name,
        teachingSubject:
          (
            await db().query(
              'SELECT "teachingSubject" FROM "user" WHERE id=$1',
              [owner],
            )
          ).rows[0]?.teachingSubject ?? "",
        email: session.user.email,
        stats: (
          await db().query(
            `SELECT
            (SELECT count(*)::int FROM plans WHERE owner_id=$1 AND deleted_at IS NULL) AS "planCount",
            (SELECT count(*)::int FROM plans WHERE owner_id=$1 AND deleted_at IS NULL AND status='review') AS "reviewCount",
            (SELECT count(*)::int FROM exports e JOIN generations g ON g.id=e.generation_id WHERE e.owner_id=$1 AND e.deleted_at IS NULL AND g.deleted_at IS NULL AND e.status='succeeded') AS "documentCount"`,
            [owner],
          )
        ).rows[0],
        limits: { daily: env().DAILY_AI_LIMIT },
        capabilities: {
          authMode: "password",
          directUploads: env().DIRECT_UPLOADS === "true",
          ai: !!env().OPENAI_API_KEY && !!env().OPENAI_MODEL,
          demo: env().ALLOW_DEMO === "true",
        },
      });
    }
    if (method === "PATCH") {
      const b = z
        .object({
          name: z.string().trim().min(1).max(100),
          teachingSubject: z.string().max(120).optional(),
          school: z.string().max(200),
          locale: z.enum(["kk", "ru"]),
          grades: z.array(z.number().int().min(1).max(11)).max(11),
          styles: Styles,
        })
        .parse(await body(req));
      await transaction(async (c) => {
        await c.query(
          'UPDATE "user" SET name=$2,"teachingSubject"=COALESCE($3,"teachingSubject"),"updatedAt"=now() WHERE id=$1',
          [owner, b.name, b.teachingSubject ?? null],
        );
        await c.query(
          "INSERT INTO profiles(owner_id,school,locale,grades,styles) VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner_id) DO UPDATE SET school=$2,locale=$3,grades=$4,styles=$5",
          [owner, b.school, b.locale, JSON.stringify(b.grades), b.styles],
        );
      });
      return json({ saved: true });
    }
  }
}
