import { z } from "zod";
import { PlanStatus } from "../../../packages/contracts";
import type { PlanCollectionPage } from "../../../packages/contracts/plan-collection";
import { db } from "./db";

/** A bounded page and its counts share one PostgreSQL statement snapshot. */
export async function planCollection(
  owner: string,
  params: URLSearchParams,
): Promise<PlanCollectionPage> {
  const query = z
    .string()
    .trim()
    .max(200)
    .parse(params.get("q") ?? "");
  const status = PlanStatus.optional().parse(params.get("status") ?? undefined);
  const grade = z.coerce
    .number()
    .int()
    .min(1)
    .max(11)
    .optional()
    .parse(params.get("grade") ?? undefined);
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
  // Sorting fragments come exclusively from this allowlist, never query text.
  const order = sort === "name" ? "lower(title),id" : "created_at DESC,id DESC";
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const result = await db().query<PlanCollectionPage>(
    `
    WITH owned AS MATERIALIZED (
      SELECT id,title,grade,school_year,status,created_at FROM plans
      WHERE owner_id=$1 AND deleted_at IS NULL
    ), filtered AS MATERIALIZED (
      SELECT * FROM owned WHERE title ILIKE $2
      AND ($5::text IS NULL OR status=$5)
      AND ($6::int IS NULL OR grade=$6)
    ), bounds AS (
      SELECT count(*)::int AS matched FROM filtered
    ), position AS (
      SELECT CASE WHEN matched=0 THEN 0 ELSE LEAST($4::int,((matched-1)/$3::int)*$3::int) END AS page_offset FROM bounds
    ), page AS (
      SELECT * FROM filtered ORDER BY ${order} LIMIT $3 OFFSET (SELECT page_offset FROM position)
    )
    SELECT COALESCE((SELECT jsonb_agg(page ORDER BY ${order}) FROM page),'[]'::jsonb) AS items,
      (SELECT count(*)::int FROM owned) AS total,
      (SELECT matched FROM bounds) AS matched,
      COALESCE((SELECT jsonb_object_agg(status,n) FROM (SELECT status,count(*)::int AS n FROM owned GROUP BY status) c),'{}'::jsonb) AS counts,
      $3::int AS "limit",(SELECT page_offset FROM position) AS "offset"
  `,
    [owner, pattern, limit, offset, status ?? null, grade ?? null],
  );
  return result.rows[0];
}
