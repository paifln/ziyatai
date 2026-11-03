import { transaction } from "../../infrastructure/database/db";
import { enqueue } from "../../infrastructure/queue/queue";
import { type ApiContext, owned, json, audit } from "../context";
export async function handleDeletions(
  context: ApiContext,
): Promise<Response | undefined> {
  const { resource, id, method, owner, requestId } = context;
  if (
    ["ktp", "generations", "exports"].includes(resource) &&
    id &&
    method === "DELETE"
  ) {
    const table =
      resource === "ktp" ? "plans" : (resource as "generations" | "exports");
    await owned(table, id, owner);
    await transaction(async (c) => {
      await c.query(`UPDATE ${table} SET deleted_at=now() WHERE id=$1`, [id]);
      if (table === "plans") {
        await c.query(
          "UPDATE uploads SET deleted_at=now() WHERE id=(SELECT file_id FROM plans WHERE id=$1)",
          [id],
        );
        await c.query(
          "UPDATE generations SET deleted_at=now() WHERE plan_id=$1",
          [id],
        );
      }
      if (table !== "exports")
        await c.query(
          "UPDATE exports SET deleted_at=now() WHERE generation_id IN(SELECT id FROM generations WHERE id=$1 OR plan_id=$1)",
          [id],
        );
      await c.query(
        "UPDATE jobs SET cancel_requested=true,status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END WHERE owner_id=$1 AND kind!='delete' AND (resource_id=$2 OR resource_id IN(SELECT id FROM generations WHERE deleted_at IS NOT NULL AND owner_id=$1) OR resource_id IN(SELECT id FROM exports WHERE deleted_at IS NOT NULL AND owner_id=$1))",
        [owner, id],
      );
      await enqueue(
        c,
        owner,
        "delete",
        id,
        { scope: table },
        `delete:${table}:${id}`,
      );
    });
    await audit(owner, "delete", id, requestId);
    return json({ deleted: true });
  }
}
