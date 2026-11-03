import { GenerationDoc } from "../../../../packages/contracts";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { readJsonBody as body } from "../../request-body";
import { transaction } from "../../../infrastructure/database/db";
import { AppError } from "../../../../packages/domain/errors";
import { validateDocument } from "../../../../packages/domain/validation";
import { type ApiContext, json } from "../../context";
export async function handleGenerationsDocument(
  context: ApiContext,
): Promise<Response | undefined> {
  const { req, resource, id, action, method, owner } = context;
  if (
    resource === "generations" &&
    id &&
    action === "document" &&
    method === "PATCH"
  ) {
    const b = z
      .object({
        revision: z.number().int().positive(),
        document: GenerationDoc,
      })
      .parse(await body(req));
    return json(
      await transaction(async (c) => {
        const g = (
          await c.query(
            "SELECT * FROM generations WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE",
            [id, owner],
          )
        ).rows[0];
        if (!g) throw new AppError("NOT_FOUND", 404);
        if (g.revision !== b.revision) throw new AppError("CONFLICT", 409);
        const old = (
          await c.query(
            "SELECT * FROM generation_versions WHERE generation_id=$1 AND revision=$2",
            [id, g.revision],
          )
        ).rows[0];
        const existingIds = new Set(old.document.tasks.map((t: any) => t.id));
        if (
          b.document.tasks.some((t) => !existingIds.has(t.id)) ||
          b.document.tasks.length !== existingIds.size
        )
          throw new AppError("AI_INVALID", 422);
        const report = validateDocument(b.document, g.source_snapshot);
        if (
          report.issues.includes("SNAPSHOT_MISMATCH") ||
          report.issues.includes("LEVEL_COUNT") ||
          report.issues.includes("DUPLICATE_ID") ||
          b.document.tasks.some(
            (t) =>
              old.document.tasks.find((previous: any) => previous.id === t.id)
                ?.level !== t.level,
          )
        )
          throw new AppError("AI_INVALID", 422);
        const revision = g.revision + 1;
        await c.query(
          "INSERT INTO generation_versions(id,generation_id,revision,document,validation,model,prompt_version) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            randomUUID(),
            id,
            revision,
            b.document,
            { ...report, doc: undefined, stale: true },
            old.model,
            old.prompt_version,
          ],
        );
        await c.query(
          "UPDATE generations SET revision=$2,status='needs_review' WHERE id=$1",
          [id, revision],
        );
        return { revision };
      }),
    );
  }
}
