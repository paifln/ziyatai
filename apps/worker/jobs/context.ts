import { db } from "../../../server/infrastructure/database/db";
import { env } from "../../../server/config/env";
import { AppError } from "../../../packages/domain/errors";
export type Job = {
  id: string;
  owner_id: string;
  kind: string;
  resource_id: string;
  payload: any;
  lease_token: string;
  attempt: number;
  max_attempts: number;
};

export async function check(c: any, job: Job) {
  const row = (
    await c.query(
      "SELECT * FROM jobs WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>now() FOR UPDATE",
      [job.id, job.lease_token],
    )
  ).rows[0];
  if (!row || row.cancel_requested) throw new AppError("CANCELLED", 409);
  return row;
}

export async function stage(job: Job, value: string) {
  const r = await db().query(
    "UPDATE jobs SET stage=$3,heartbeat=now(),lease_until=now()+$4*interval '1 second',updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running' AND cancel_requested=false RETURNING id",
    [job.id, job.lease_token, value, env().JOB_LEASE_SECONDS],
  );
  if (!r.rowCount) throw new AppError("CANCELLED", 409);
}

export async function active(
  table: "plans" | "generations" | "exports",
  job: Job,
  c: any = db(),
) {
  const r = await c.query(
    `SELECT * FROM ${table} WHERE id=$1 AND owner_id=$2 AND deleted_at IS NULL FOR UPDATE`,
    [job.resource_id, job.owner_id],
  );
  if (!r.rowCount) throw new AppError("CANCELLED", 409);
  return r.rows[0];
}

export async function done(c: any, job: Job, result: unknown) {
  await c.query(
    "UPDATE jobs SET status='succeeded',stage='complete',result=$3,lease_until=NULL,lease_token=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2",
    [job.id, job.lease_token, result],
  );
}
