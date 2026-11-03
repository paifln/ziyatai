import { z } from "zod";
import {
  materialStatuses,
  type MaterialCollectionPage,
} from "../../../packages/contracts/material-collection";
import { db } from "./db";

/** One metadata snapshot; legacy history/library array endpoints remain available. */
export async function materialCollection(
  owner: string,
  kind: "history" | "library",
  params: URLSearchParams,
): Promise<MaterialCollectionPage> {
  const query = z
    .string()
    .trim()
    .max(200)
    .parse(params.get("q") ?? "");
  const status = z
    .enum(materialStatuses)
    .optional()
    .parse(params.get("status") ?? undefined);
  const format = z
    .enum(["docx", "pdf"])
    .optional()
    .parse(params.get("format") ?? undefined);
  const audience = z
    .enum(["student", "full"])
    .optional()
    .parse(params.get("audience") ?? undefined);
  if (kind === "history") {
    z.undefined().parse(format);
    z.undefined().parse(audience);
  }
  const sort = z.enum(["recent", "name"]).parse(params.get("sort") ?? "recent");
  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .parse(params.get("limit") ?? "20");
  const offset = z.coerce
    .number()
    .int()
    .min(0)
    .max(1000000)
    .parse(params.get("offset") ?? "0");
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const order = sort === "name" ? "lower(title),id" : "created_at DESC,id DESC";
  const source =
    kind === "history"
      ? `SELECT id,title,locale,status,revision,demo,created_at,NULL::text AS format,NULL::text AS audience
       FROM generations WHERE owner_id=$1 AND deleted_at IS NULL`
      : `SELECT e.id,g.title,g.locale,e.format,e.audience,e.status,e.created_at,e.teacher_reviewed,
       g.id AS generation_id,v.revision FROM exports e
       JOIN generations g ON g.id=e.generation_id AND g.owner_id=$1
       JOIN generation_versions v ON v.id=e.generation_version_id AND v.generation_id=g.id
       WHERE e.owner_id=$1 AND e.deleted_at IS NULL AND g.deleted_at IS NULL`;
  const result = await db().query<MaterialCollectionPage>(
    `
    WITH owned AS MATERIALIZED (${source}), filtered AS MATERIALIZED (
      SELECT * FROM owned WHERE title ILIKE $2
      AND ($5::text IS NULL OR status=$5)
      AND ($6::text IS NULL OR format=$6)
      AND ($7::text IS NULL OR audience=$7)
    ), bounds AS (SELECT count(*)::int AS matched FROM filtered), position AS (
      SELECT CASE WHEN matched=0 THEN 0 ELSE LEAST($4::int,((matched-1)/$3::int)*$3::int) END AS page_offset FROM bounds
    ), page AS (
      SELECT * FROM filtered ORDER BY ${order} LIMIT $3 OFFSET (SELECT page_offset FROM position)
    ) SELECT COALESCE((SELECT jsonb_agg(page ORDER BY ${order}) FROM page),'[]'::jsonb) AS items,
      (SELECT count(*)::int FROM owned) AS total,(SELECT matched FROM bounds) AS matched,
      COALESCE((SELECT jsonb_object_agg(status,n) FROM (SELECT status,count(*)::int AS n FROM owned GROUP BY status) c),'{}'::jsonb) AS counts,
      $3::int AS "limit",(SELECT page_offset FROM position) AS "offset"
  `,
    [
      owner,
      pattern,
      limit,
      offset,
      status ?? null,
      format ?? null,
      audience ?? null,
    ],
  );
  return result.rows[0];
}
