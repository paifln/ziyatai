import { syntheticDemo } from "../../../packages/domain/demo";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { readJsonBody as body } from "../request-body";
import { transaction } from "../../infrastructure/database/db";
import { env } from "../../config/env";
import { AppError } from "../../../packages/domain/errors";
import { type ApiContext, json } from "../context";
export async function handleDemo(
  context: ApiContext,
): Promise<Response | undefined> {
  const { req, resource, method, owner } = context;
  if (resource === "demo" && method === "POST") {
    if (env().ALLOW_DEMO !== "true") throw new AppError("NOT_FOUND", 404);
    const b = z.object({ locale: z.enum(["kk", "ru"]) }).parse(await body(req));
    const sample = syntheticDemo(b.locale);
    return json(
      await transaction(async (c) => {
        await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          owner + "demo",
        ]);
        const old = await c.query(
          "SELECT id,plan_id FROM generations WHERE owner_id=$1 AND demo=true AND locale=$2 AND deleted_at IS NULL",
          [owner, b.locale],
        );
        if (old.rowCount)
          return { id: old.rows[0].id, planId: old.rows[0].plan_id };
        const pid = randomUUID(),
          gid = randomUUID();
        await c.query(
          "INSERT INTO plans(id,owner_id,title,grade,locale,status,grades) VALUES($1,$2,$3,7,$4,'confirmed',ARRAY[7])",
          [pid, owner, `DEMO • ${sample.row.topic}`, b.locale],
        );
        await c.query(
          "INSERT INTO plan_versions(id,plan_id,revision,rows,parser_version,grade,confirmed_at) VALUES($1,$2,1,$3,'synthetic',7,now())",
          [randomUUID(), pid, JSON.stringify([sample.row])],
        );
        await c.query(
          "INSERT INTO generations(id,owner_id,plan_id,row_id,source_snapshot,title,locale,status,demo) VALUES($1,$2,$3,$4,$5,$6,$7,'needs_review',true)",
          [
            gid,
            owner,
            pid,
            sample.row.id,
            sample.snapshot,
            sample.document.title,
            b.locale,
          ],
        );
        await c.query(
          "INSERT INTO generation_versions(id,generation_id,revision,document,validation,model,prompt_version) VALUES($1,$2,1,$3,$4,'synthetic-no-provider','demo-1.0')",
          [
            randomUUID(),
            gid,
            sample.document,
            {
              status: "needs_review",
              demo: true,
              checks: ["synthetic"],
              limitations: [
                "Prepared demonstration; AI generation was not used",
              ],
            },
          ],
        );
        return { id: gid, planId: pid };
      }),
      201,
    );
  }
}
