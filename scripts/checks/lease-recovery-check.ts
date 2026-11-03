import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { db } from "../../apps/web/lib/db";
import { recoverExpiredJobs } from "../../apps/worker/recover-jobs";
import { syntheticDemo } from "../../packages/domain/demo";

const c = await db().connect();
const owner = randomUUID(),
  foreign = randomUUID();
const cases: {
  id: string;
  resource: string;
  kind: string;
  status: string;
  code: string;
  ledger?: string;
  token: string;
  unchanged?: boolean;
}[] = [];
try {
  await c.query("BEGIN");
  for (const id of [owner, foreign])
    await c.query(
      'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,\'Synthetic recovery QA\',$2,true)',
      [id, `${id}@example.test`],
    );
  const sample = syntheticDemo("ru"),
    original = randomUUID(),
    version = randomUUID();
  await c.query(
    "INSERT INTO generations(id,owner_id,row_id,source_snapshot,title,locale,status,demo) VALUES($1,$2,$3,$4,'Recovery QA','ru','needs_review',true)",
    [original, owner, sample.row.id, sample.snapshot],
  );
  await c.query(
    "INSERT INTO generation_versions(id,generation_id,revision,document,validation,model,prompt_version,reviewed_at,reviewed_by) VALUES($1,$2,1,$3,'{}','synthetic','qa',now(),$4)",
    [version, original, sample.document, owner],
  );

  async function fixture(
    kind: string,
    status: string,
    code: string,
    options: {
      calls?: number;
      cancel?: boolean;
      attempt?: number;
      ledger?: string;
      foreign?: boolean;
      deleted?: boolean;
      live?: boolean;
    } = {},
  ) {
    const id = randomUUID(),
      token = randomUUID();
    let resource = randomUUID();
    if (kind === "import" || kind === "scan") {
      await c.query(
        "INSERT INTO plans(id,owner_id,title,deleted_at) VALUES($1,$2,'Recovery QA',CASE WHEN $3::boolean THEN now() ELSE NULL END)",
        [resource, options.foreign ? foreign : owner, !!options.deleted],
      );
      if (kind === "scan")
        await c.query("UPDATE plans SET status='confirmed' WHERE id=$1", [
          resource,
        ]);
    } else if (kind === "generate") {
      await c.query(
        "INSERT INTO generations(id,owner_id,row_id,source_snapshot,title,locale) VALUES($1,$2,$3,'{}','Recovery QA','ru')",
        [resource, owner, randomUUID()],
      );
    } else if (kind === "regenerate") resource = original;
    else if (kind === "export") {
      await c.query(
        "INSERT INTO exports(id,owner_id,generation_id,generation_version_id,format,audience,styles,teacher_reviewed) VALUES($1,$2,$3,$4,'docx','student','{}',true)",
        [resource, owner, original, version],
      );
    }
    await c.query(
      "INSERT INTO jobs(id,owner_id,kind,resource_id,status,stage,attempt,lease_token,lease_until,cancel_requested,provider_calls,idempotency_key) VALUES($1,$2,$3,$4,'running','working',$5,$6,now()+$7*interval '1 second',$8,$9,$1::uuid::text)",
      [
        id,
        owner,
        kind,
        resource,
        options.attempt ?? 3,
        token,
        options.live ? 3600 : -1,
        !!options.cancel,
        options.calls ?? 0,
      ],
    );
    if (options.ledger)
      await c.query(
        "INSERT INTO usage_ledger(id,owner_id,job_id,state,reserved_tokens) VALUES($1,$2,$3,'reserved',1000)",
        [randomUUID(), owner, id],
      );
    cases.push({
      id,
      resource,
      kind,
      status,
      code,
      ledger: options.ledger,
      token,
      unchanged: options.foreign || options.deleted || options.live,
    });
    return id;
  }
  const exhausted = await fixture("import", "failed", "ATTEMPTS_EXHAUSTED");
  await fixture("scan", "failed", "ATTEMPTS_EXHAUSTED");
  await fixture("scan", "queued", "WORKER_RESTART", { attempt: 1 });
  await fixture("scan", "cancelled", "CANCELLED", { cancel: true });
  await fixture("import", "queued", "WORKER_RESTART", { attempt: 1 });
  await fixture("export", "failed", "ATTEMPTS_EXHAUSTED");
  await fixture("export", "cancelled", "CANCELLED", { cancel: true });
  await fixture("generate", "failed", "ATTEMPTS_EXHAUSTED", {
    ledger: "released",
  });
  await fixture("generate", "failed", "AI_UNCERTAIN", {
    calls: 1,
    attempt: 1,
    ledger: "uncertain",
  });
  await fixture("regenerate", "failed", "AI_UNCERTAIN", {
    calls: 1,
    attempt: 1,
    ledger: "uncertain",
  });
  await fixture("regenerate", "cancelled", "CANCELLED", {
    calls: 1,
    cancel: true,
    ledger: "uncertain",
  });
  await fixture("generate", "cancelled", "CANCELLED", {
    attempt: 1,
    cancel: true,
    ledger: "released",
  });
  await fixture("generate", "cancelled", "CANCELLED", {
    calls: 1,
    cancel: true,
    ledger: "uncertain",
  });
  await fixture("delete", "failed", "ATTEMPTS_EXHAUSTED");
  await fixture("import", "failed", "ATTEMPTS_EXHAUSTED", { deleted: true });
  await fixture("import", "failed", "ATTEMPTS_EXHAUSTED", { foreign: true });
  await fixture("import", "running", "", { live: true });

  // Reproduce the previous janitor's missing resource transition, then undo it.
  await c.query("SAVEPOINT before_recovery");
  await c.query(
    "UPDATE jobs SET status='failed',error_code='ATTEMPTS_EXHAUSTED',lease_token=NULL WHERE id=$1",
    [exhausted],
  );
  const before = await c.query(
    "SELECT j.status AS job,p.status AS plan FROM jobs j JOIN plans p ON p.id=j.resource_id WHERE j.id=$1",
    [exhausted],
  );
  assert.deepEqual(before.rows[0], { job: "failed", plan: "extracting" });
  await c.query("ROLLBACK TO SAVEPOINT before_recovery");

  const counts = await recoverExpiredJobs(c);
  for (const fixture of cases) {
    const job = (
      await c.query(
        "SELECT status,stage,error_code,lease_token,lease_until FROM jobs WHERE id=$1",
        [fixture.id],
      )
    ).rows[0];
    assert.equal(job.status, fixture.status);
    if (fixture.status !== "running") {
      assert.equal(job.stage, fixture.status);
      assert.equal(job.error_code, fixture.code);
      assert.equal(job.lease_token, null);
      assert.equal(job.lease_until, null);
      const stale = await c.query(
        "UPDATE jobs SET stage='stale_worker' WHERE id=$1 AND lease_token=$2 AND status='running' RETURNING id",
        [fixture.id, fixture.token],
      );
      assert.equal(stale.rowCount, 0);
    }
    if (["import", "generate", "export"].includes(fixture.kind)) {
      const table =
        fixture.kind === "import"
          ? "plans"
          : fixture.kind === "generate"
            ? "generations"
            : "exports";
      const resource = (
        await c.query(`SELECT status FROM ${table} WHERE id=$1`, [
          fixture.resource,
        ])
      ).rows[0];
      assert.equal(
        resource.status,
        fixture.unchanged || fixture.status === "queued"
          ? fixture.kind === "import"
            ? "extracting"
            : "queued"
          : fixture.status,
      );
    }
    if (fixture.kind === "scan")
      assert.equal(
        (
          await c.query("SELECT status FROM plans WHERE id=$1", [
            fixture.resource,
          ])
        ).rows[0].status,
        "confirmed",
      );
    if (fixture.ledger)
      assert.equal(
        (
          await c.query("SELECT state FROM usage_ledger WHERE job_id=$1", [
            fixture.id,
          ])
        ).rows[0].state,
        fixture.ledger,
      );
  }
  assert.equal(
    (await c.query("SELECT status FROM generations WHERE id=$1", [original]))
      .rows[0].status,
    "needs_review",
  );
  assert.equal(
    (
      await c.query("SELECT reviewed_by FROM generation_versions WHERE id=$1", [
        version,
      ])
    ).rows[0].reviewed_by,
    owner,
  );
  // The resource, job and reservation changes roll back together.
  await c.query("ROLLBACK TO SAVEPOINT before_recovery");
  assert.equal(
    (await c.query("SELECT status FROM jobs WHERE id=$1", [exhausted])).rows[0]
      .status,
    "running",
  );
  await recoverExpiredJobs(c);
  await c.query(
    "INSERT INTO jobs(id,owner_id,kind,resource_id,status,attempt,lease_token,lease_until,idempotency_key) SELECT gen_random_uuid(),$1,'delete',gen_random_uuid(),'running',3,gen_random_uuid(),now()-interval '2 seconds','batch-'||g FROM generate_series(1,101) g",
    [owner],
  );
  const batch = await recoverExpiredJobs(c);
  assert.equal(batch.failed, 100);
  const remainder = await recoverExpiredJobs(c);
  assert.equal(remainder.failed, 1);
  const report = {
    environment:
      "real PostgreSQL, synthetic fixtures inside a rolled-back transaction; no AI calls or file changes",
    priorStuckPlanReproduced: true,
    fixtureCases: cases.length,
    recoveryCounts: counts,
    atomicRollback: true,
    staleLeaseFenced: true,
    teacherApprovalPreserved: true,
    uncertainAIIsNotRequeued: true,
    cancelledReservationsSettled: true,
    ownerAndDeletionGuards: true,
    batchLimit: 100,
    batchRemainder: 1,
  };
  await mkdir(".local/reports", { recursive: true });
  await writeFile(
    ".local/reports/lease-recovery.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  await c.query("ROLLBACK");
  c.release();
  await db().end();
}
