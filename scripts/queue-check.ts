import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import { db, transaction } from "../apps/web/lib/db";
import { enqueue, reserveQuota } from "../apps/web/lib/queue";
import { syntheticDemo } from "../packages/domain/demo";
const owner = randomUUID(),
  gid = randomUUID(),
  eid = randomUUID(),
  exhaustedExport = randomUUID();
const sample = syntheticDemo("ru");
const vid = randomUUID();
await db().query(
  'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)',
  [owner, "Queue test synthetic", `${owner}@example.test`],
);
const wait = async (predicate: () => Promise<boolean>, timeout = 45000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Queue check timed out");
};
try {
  await db().query(
    "INSERT INTO generations(id,owner_id,row_id,source_snapshot,title,locale,status,demo) VALUES($1,$2,$3,$4,$5,'ru','needs_review',true)",
    [gid, owner, sample.row.id, sample.snapshot, sample.document.title],
  );
  await db().query(
    "INSERT INTO generation_versions(id,generation_id,revision,document,validation,model,prompt_version,reviewed_at,reviewed_by) VALUES($1,$2,1,$3,'{}','synthetic','test',now(),$4)",
    [vid, gid, sample.document, owner],
  );
  await db().query(
    "INSERT INTO exports(id,owner_id,generation_id,generation_version_id,format,audience,styles,teacher_reviewed) VALUES($1,$2,$3,$4,'docx','student','{}',true)",
    [eid, owner, gid, vid],
  );
  const jobId = await transaction((c) =>
    enqueue(c, owner, "export", eid, {}, "test-recovery"),
  );
  await db().query(
    "UPDATE jobs SET status='running',attempt=1,lease_token=$2,lease_until=now()-interval '1 second' WHERE id=$1",
    [jobId, randomUUID()],
  );
  const exhaustedJob = await transaction(async (c) => {
    await c.query(
      "INSERT INTO exports(id,owner_id,generation_id,generation_version_id,format,audience,styles,teacher_reviewed) VALUES($1,$2,$3,$4,'docx','student','{}',true)",
      [exhaustedExport, owner, gid, vid],
    );
    const id = await enqueue(
      c,
      owner,
      "export",
      exhaustedExport,
      {},
      "test-exhausted",
    );
    await c.query(
      "UPDATE jobs SET status='running',attempt=max_attempts,lease_token=$2,lease_until=now()-interval '1 second' WHERE id=$1",
      [id, randomUUID()],
    );
    return id;
  });
  await wait(
    async () =>
      (await db().query("SELECT status FROM jobs WHERE id=$1", [jobId])).rows[0]
        ?.status === "succeeded",
  );
  const job = (
    await db().query("SELECT attempt FROM jobs WHERE id=$1", [jobId])
  ).rows[0];
  if (job.attempt !== 2) throw new Error("Expired lease not reclaimed once");
  const exhausted = (
    await db().query(
      "SELECT j.status AS job,j.stage,j.lease_token,j.lease_until,e.status AS export FROM jobs j JOIN exports e ON e.id=j.resource_id WHERE j.id=$1",
      [exhaustedJob],
    )
  ).rows[0];
  if (
    exhausted.job !== "failed" ||
    exhausted.export !== "failed" ||
    exhausted.stage !== "failed" ||
    exhausted.lease_token !== null ||
    exhausted.lease_until !== null
  )
    throw new Error(
      "Expired exhausted export did not reach a consistent terminal state",
    );
  const same = await transaction((c) =>
    enqueue(c, owner, "export", eid, {}, "test-recovery"),
  );
  if (same !== jobId) throw new Error("Idempotency violated");
  const cancel = await transaction((c) =>
    enqueue(c, owner, "export", eid, {}, "test-cancel"),
  );
  await db().query(
    "UPDATE jobs SET status='cancelled',cancel_requested=true WHERE id=$1",
    [cancel],
  );
  await new Promise((r) => setTimeout(r, 1500));
  if (
    (await db().query("SELECT status FROM jobs WHERE id=$1", [cancel])).rows[0]
      .status !== "cancelled"
  )
    throw new Error("Cancellation violated");
  for (let i = 0; i < 2; i++)
    await transaction(async (c) => {
      const id = await enqueue(c, owner, "generate", gid, {}, `quota-${i}`);
      await c.query(
        "UPDATE jobs SET status='running',lease_until=now()+interval '1 hour' WHERE id=$1",
        [id],
      );
      await reserveQuota(c, owner, id);
    });
  let limited = false;
  try {
    await transaction(async (c) => {
      const id = await enqueue(c, owner, "generate", gid, {}, "quota-third");
      await reserveQuota(c, owner, id);
    });
  } catch (e) {
    limited = (e as any).code === "LIMIT";
  }
  if (!limited) throw new Error("Concurrent quota not enforced");
  const report = {
    environment: "local real PostgreSQL + worker + private S3",
    leaseRecovery: true,
    attempts: job.attempt,
    exhaustedExportAndJobSettledTogether: true,
    idempotentJob: true,
    cancelledJobNotClaimed: true,
    concurrentQuota: true,
    thirdReservationRolledBack: !(
      await db().query(
        "SELECT 1 FROM jobs WHERE owner_id=$1 AND idempotency_key='quota-third'",
        [owner],
      )
    ).rowCount,
  };
  await mkdir("docs/reports", { recursive: true });
  await writeFile("docs/reports/queue.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  const exports = await db().query(
    "SELECT object_key FROM exports WHERE owner_id=$1",
    [owner],
  );
  const { deleteObject } = await import("../apps/web/lib/storage");
  for (const e of exports.rows)
    if (e.object_key) await deleteObject(e.object_key);
  await transaction(async (c) => {
    await c.query("DELETE FROM usage_ledger WHERE owner_id=$1", [owner]);
    await c.query("DELETE FROM jobs WHERE owner_id=$1", [owner]);
    await c.query("DELETE FROM exports WHERE owner_id=$1", [owner]);
    await c.query("DELETE FROM generations WHERE owner_id=$1", [owner]);
    await c.query('DELETE FROM "user" WHERE id=$1', [owner]);
  });
  await db().end();
}
