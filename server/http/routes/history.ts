import { db } from "../../infrastructure/database/db";
import { materialCollection } from "../../application/material-collection";
import { type ApiContext, json } from "../context";
export async function handleHistory(
  context: ApiContext,
): Promise<Response | undefined> {
  const { resource, id, method, url, owner, limit, offset } = context;
  if (
    (resource === "history" || resource === "library") &&
    id === "collection" &&
    method === "GET"
  )
    return json(await materialCollection(owner, resource, url.searchParams));
  if (["history", "library"].includes(resource) && method === "GET") {
    const q = `%${(url.searchParams.get("q") ?? "").slice(0, 200)}%`;
    return json(
      resource === "history"
        ? (
            await db().query(
              "SELECT id,title,locale,status,revision,demo,created_at FROM generations WHERE owner_id=$1 AND deleted_at IS NULL AND title ILIKE $2 ORDER BY created_at DESC,id DESC LIMIT $3 OFFSET $4",
              [owner, q, limit, offset],
            )
          ).rows
        : (
            await db().query(
              "SELECT e.id,e.format,e.audience,e.status,e.created_at,e.teacher_reviewed,g.id AS generation_id,g.title,v.revision FROM exports e JOIN generations g ON g.id=e.generation_id JOIN generation_versions v ON v.id=e.generation_version_id WHERE e.owner_id=$1 AND e.deleted_at IS NULL AND g.deleted_at IS NULL AND g.title ILIKE $2 ORDER BY e.created_at DESC,e.id DESC LIMIT $3 OFFSET $4",
              [owner, q, limit, offset],
            )
          ).rows,
    );
  }
}
