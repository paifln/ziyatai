import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { AppError } from "../../../packages/domain/errors";
import { env } from "../../config/env";
export async function enqueue(
  c: PoolClient,
  owner: string,
  kind: string,
  resource: string,
  payload: unknown,
  key: string,
) {
  const id = randomUUID();
  const result = await c.query(
    "INSERT INTO jobs(id,owner_id,kind,resource_id,payload,idempotency_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner_id,idempotency_key) DO NOTHING RETURNING id",
    [id, owner, kind, resource, payload, key],
  );
  if (result.rowCount) return id;
  const existing = await c.query(
    // Account cleanup is scoped to owner_id; its resource UUID is only a marker.
    "SELECT id FROM jobs WHERE owner_id=$1 AND idempotency_key=$2 AND kind=$3 AND (resource_id=$4 OR (kind='delete' AND payload->>'scope'='account')) AND payload=$5::jsonb",
    [owner, key, kind, resource, payload],
  );
  if (!existing.rowCount) throw new AppError("CONFLICT", 409);
  return existing.rows[0].id as string;
}
export async function reserveQuota(
  c: PoolClient,
  owner: string,
  jobId: string,
  input?: unknown,
) {
  const e = env();
  // Reserve for source/replacement size too. A fixed allowance alone lets a
  // very large edited task consume substantially more input than was admitted.
  // UTF-8 bytes are a conservative input allowance, not exact token counting;
  // the existing 10k covers instructions/schema/repair overhead per attempt.
  const inputBytes =
    input === undefined ? 0 : Buffer.byteLength(JSON.stringify(input), "utf8");
  const reservation = (e.MAX_AI_TOKENS + 10000 + inputBytes) * 3;
  if (
    !Number.isSafeInteger(reservation) ||
    reservation <= 0 ||
    reservation > 2147483647
  )
    throw new AppError("LIMIT", 429);
  await c.query("SELECT pg_advisory_xact_lock(843002)");
  const counts = await c.query(
    "SELECT count(*) FILTER(WHERE owner_id=$1)::int AS personal,count(*)::int AS global,count(*) FILTER(WHERE owner_id=$1 AND state='reserved')::int AS concurrent FROM usage_ledger WHERE created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND state!='released'",
    [owner],
  );
  if (
    counts.rows[0].personal >= e.DAILY_AI_LIMIT ||
    counts.rows[0].global >= e.GLOBAL_DAILY_AI_LIMIT ||
    counts.rows[0].concurrent >= 2
  )
    throw new AppError("LIMIT", 429);
  const budgets = await c.query(
    "SELECT coalesce(sum(CASE WHEN state IN('reserved','uncertain') THEN greatest(tokens,reserved_tokens) ELSE tokens END) FILTER(WHERE owner_id=$1),0)::bigint AS personal,coalesce(sum(CASE WHEN state IN('reserved','uncertain') THEN greatest(tokens,reserved_tokens) ELSE tokens END),0)::bigint AS global FROM usage_ledger WHERE created_at>=date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND state!='released'",
    [owner],
  );
  if (
    BigInt(budgets.rows[0].personal) + BigInt(reservation) >
      BigInt(e.DAILY_AI_TOKEN_LIMIT) ||
    BigInt(budgets.rows[0].global) + BigInt(reservation) >
      BigInt(e.GLOBAL_DAILY_AI_TOKEN_LIMIT)
  )
    throw new AppError("LIMIT", 429);
  await c.query(
    "INSERT INTO usage_ledger(id,owner_id,job_id,state,reserved_tokens) VALUES($1,$2,$3,$4,$5) ON CONFLICT(job_id) DO NOTHING",
    [randomUUID(), owner, jobId, "reserved", reservation],
  );
}
