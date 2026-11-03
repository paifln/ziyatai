import { z } from "zod";
import { readJsonBody as body } from "../../request-body";
import { db, transaction } from "../../../infrastructure/database/db";
import { AppError } from "../../../../packages/domain/errors";
import { validateDocument } from "../../../../packages/domain/validation";
import { type ApiContext, json, currentGeneration } from "../../context";
export async function handleGenerationsReview(
  context: ApiContext,
): Promise<Response | undefined> {
  const { req, resource, id, action, method, owner } = context;
  if (
    resource === "generations" &&
    id &&
    action === "approve" &&
    method === "POST"
  ) {
    const b = z
      .object({
        revision: z.number().int().positive(),
        teacherReviewed: z.literal(true),
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
        const v = (
          await c.query(
            "SELECT * FROM generation_versions WHERE generation_id=$1 AND revision=$2",
            [id, b.revision],
          )
        ).rows[0];
        if (!v) throw new AppError("REVIEW_REQUIRED", 422);
        const report = validateDocument(v.document, g.source_snapshot);
        if (report.issues.length) throw new AppError("REVIEW_REQUIRED", 422);
        // An in-flight regeneration can replace the document. Let it finish before approval.
        const pending = await c.query(
          "SELECT 1 FROM jobs WHERE resource_id=$1 AND kind IN ('generate','regenerate') AND status IN ('queued','running')",
          [id],
        );
        if (pending.rowCount) throw new AppError("CONFLICT", 409);
        const approved = (
          await c.query(
            "UPDATE generation_versions SET reviewed_at=COALESCE(reviewed_at,now()),reviewed_by=$3,validation=$4 WHERE generation_id=$1 AND revision=$2 RETURNING reviewed_at",
            [id, b.revision, owner, { ...report, doc: undefined }],
          )
        ).rows[0];
        await c.query("UPDATE generations SET status='approved' WHERE id=$1", [
          id,
        ]);
        return { revision: b.revision, reviewedAt: approved.reviewed_at };
      }),
    );
  }
  if (
    resource === "generations" &&
    id &&
    action === "validate" &&
    method === "POST"
  ) {
    const g = await currentGeneration(id, owner);
    if (!g.document) throw new AppError("CONFLICT", 409);
    const report = validateDocument(g.document, g.source_snapshot);
    await db().query(
      "UPDATE generation_versions SET validation=$3 WHERE generation_id=$1 AND revision=$2",
      [id, g.revision, { ...report, doc: undefined }],
    );
    return json({ ...report, doc: undefined });
  }
}
