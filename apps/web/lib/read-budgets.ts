import { db } from "./db";
import { AppError } from "../../../packages/domain/errors";

export const readBudgets = {
  metadata: { perMinute: 600, burst: 120 },
  snapshot: { perMinute: 120, burst: 12 },
  download: { perMinute: 30, burst: 6 },
  preview: { perMinute: 30, burst: 3 },
} as const;
export function readBucket(path: string[]) {
  const [resource, id, action] = path;
  if (resource === "ktp" && id && action === "source" && path.length === 3)
    return "metadata";
  if (resource === "ktp" && id && action === "preview") return "preview";
  if ((resource === "uploads" && id) || (resource === "exports" && id))
    return "download";
  if (["ktp", "generations", "drafts"].includes(resource) && id)
    return "snapshot";
  return "metadata";
}
export class ReadBudgetError extends AppError {
  constructor(public retryAfter: number) {
    super("READ_LIMIT", 429);
  }
}

/** GCRA admission is one atomic DB operation shared by every API instance.
 * Refused reads do not advance the schedule or extend another user's wait.
 */
export async function admitRead(owner: string, path: string[]) {
  const bucket = readBucket(path),
    policy = readBudgets[bucket];
  const step = 60 / policy.perMinute;
  const tolerance = (policy.burst - 1) * step;
  const accepted = await db().query(
    `INSERT INTO api_read_budgets(owner_id,bucket,available_at)
     VALUES($1,$2,statement_timestamp()+$3::double precision*interval '1 second')
     ON CONFLICT(owner_id,bucket) DO UPDATE
       SET available_at=GREATEST(api_read_budgets.available_at,statement_timestamp())+$3::double precision*interval '1 second'
       WHERE api_read_budgets.available_at<=statement_timestamp()+$4::double precision*interval '1 second'
     RETURNING 1`,
    [owner, bucket, step, tolerance],
  );
  if (accepted.rowCount) return;
  const remaining = await db().query(
    "SELECT GREATEST(1,ceil(extract(epoch FROM available_at-statement_timestamp())-$3))::int AS seconds FROM api_read_budgets WHERE owner_id=$1 AND bucket=$2",
    [owner, bucket, tolerance],
  );
  throw new ReadBudgetError(remaining.rows[0]?.seconds ?? 1);
}
