// deno-lint-ignore no-import-prefix -- test-only std dep; no shared deno.json by design
import { assert, assertEquals, assertExists } from "jsr:@std/assert@1";
import { enqueueJob } from "../_shared/jobs.ts";
import { FakeWhatsAppProvider } from "../_shared/whatsapp.ts";
import { type Deps, handler, runClaimedJobs, secretMatches } from "./index.ts";
import {
  cleanup,
  db,
  dbTest,
  DEMO_ORG,
  FlakyProvider,
  insertLead,
  MIN,
  noDb,
  purgeTestJobs,
  T0,
  uniquePhone,
} from "./testing.ts";

const URL_ = "http://localhost/functions/v1/run-jobs";

function envOf(vars: Record<string, string>): Deps["env"] {
  return (k) => vars[k];
}

/** A db whose only power is claim_jobs returning nothing. */
const emptyQueueDb = {
  rpc: (fn: string) => {
    assertEquals(fn, "claim_jobs");
    return Promise.resolve({ data: [], error: null });
  },
} as unknown as Deps["db"];

function req(method: string, secret?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== undefined) headers["x-run-jobs-secret"] = secret;
  return new Request(URL_, { method, headers, body: method === "POST" ? "{}" : undefined });
}

// --- Auth (no database) -----------------------------------------------------

Deno.test("run-jobs: 401 without the secret header", async () => {
  const res = await handler(req("POST"), {
    db: noDb,
    provider: new FakeWhatsAppProvider(),
    now: () => new Date(),
    env: envOf({ RUN_JOBS_SECRET: "s3cret" }),
  });
  assertEquals(res.status, 401);
  await res.body?.cancel();
});

Deno.test("run-jobs: 401 with the wrong secret", async () => {
  for (const wrong of ["", "s3cre", "s3cret!", "S3CRET"]) {
    const res = await handler(req("POST", wrong), {
      db: noDb,
      provider: new FakeWhatsAppProvider(),
      now: () => new Date(),
      env: envOf({ RUN_JOBS_SECRET: "s3cret" }),
    });
    assertEquals(res.status, 401, JSON.stringify(wrong));
    await res.body?.cancel();
  }
});

Deno.test("run-jobs: 401 for every caller when RUN_JOBS_SECRET is unset", async () => {
  for (const given of [undefined, "", "anything"]) {
    const res = await handler(req("POST", given), {
      db: noDb,
      provider: new FakeWhatsAppProvider(),
      now: () => new Date(),
      env: envOf({}),
    });
    assertEquals(res.status, 401, String(given));
    await res.body?.cancel();
  }
});

Deno.test("run-jobs: 405 for non-POST", async () => {
  const res = await handler(req("GET", "s3cret"), {
    db: noDb,
    provider: new FakeWhatsAppProvider(),
    now: () => new Date(),
    env: envOf({ RUN_JOBS_SECRET: "s3cret" }),
  });
  assertEquals(res.status, 405);
  await res.body?.cancel();
});

Deno.test("run-jobs: 200 and a summary with the right secret", async () => {
  const res = await handler(req("POST", "s3cret"), {
    db: emptyQueueDb,
    provider: new FakeWhatsAppProvider(),
    now: () => new Date(),
    env: envOf({ RUN_JOBS_SECRET: "s3cret" }),
  });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { claimed: 0, done: 0, cancelled: 0, retried: 0, dead: 0, lost: 0, errors: 0 });
});

Deno.test("secretMatches needs both values and an exact match", () => {
  assertEquals(secretMatches("abc", "abc"), true);
  assertEquals(secretMatches("abc", "abd"), false);
  assertEquals(secretMatches("abc", "ab"), false);
  assertEquals(secretMatches(undefined, "abc"), false);
  assertEquals(secretMatches("", ""), false);
  assertEquals(secretMatches("abc", null), false);
});

// --- Against the local database ---------------------------------------------

type Clock = { t: Date };

function runnerDeps(provider: Deps["provider"], clock: Clock, env: Record<string, string> = {}): Deps {
  return { db, provider, now: () => clock.t, env: envOf(env) };
}

async function jobRow(id: string) {
  const { data, error } = await db.from("jobs").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

async function eventsForJob(id: string) {
  const { data, error } = await db.from("events").select("type, payload, lead_id").eq("payload->>job_id", id).order("id");
  if (error) throw error;
  return data;
}

async function enqueueAck(leadId: string, phone: string, extra: Record<string, unknown> = {}) {
  const id = await enqueueJob(db, {
    org_id: DEMO_ORG,
    lead_id: leadId,
    kind: "send_message",
    run_at: T0.toISOString(),
    idempotency_key: `test:${crypto.randomUUID()}`,
    payload: { to: phone, template: "enquiry_ack", language: "en", params: ["Job", "Demo"], first_auto_reply: true },
    ...extra,
  });
  assertExists(id);
  return id!;
}

dbTest("send_message: sends once, records the message with its job, sets first_auto_reply_at", async () => {
  await purgeTestJobs();
  const phone = uniquePhone();
  const leadId = await insertLead(phone.e164);
  try {
    const jobId = await enqueueAck(leadId, phone.e164);
    const clock = { t: T0 };
    const provider = new FakeWhatsAppProvider();
    const summary = await runClaimedJobs(runnerDeps(provider, clock));
    assertEquals(summary, { claimed: 1, done: 1, cancelled: 0, retried: 0, dead: 0, lost: 0, errors: 0 });

    assertEquals(provider.sent.length, 1);
    assertEquals(provider.sent[0].to, phone.e164);
    assertEquals(provider.sent[0].template, "enquiry_ack");
    assertEquals(provider.sent[0].params, ["Job", "Demo"]);

    const job = await jobRow(jobId);
    assertEquals(job.status, "done");
    assertEquals(job.attempts, 1);
    const { data: msgs } = await db.from("messages").select("*").eq("job_id", jobId);
    assertEquals(msgs!.length, 1);
    assertEquals(msgs![0].status, "sent");
    assertEquals(msgs![0].lead_id, leadId);
    assertEquals(msgs![0].provider_message_id, provider.sent[0].providerMessageId);
    const { data: lead } = await db.from("leads").select("first_auto_reply_at").eq("id", leadId).single();
    assertEquals(new Date(lead!.first_auto_reply_at!).getTime(), T0.getTime());
    assertEquals((await eventsForJob(jobId)).map((e) => e.type), ["ack_sent"]);

    // Running again finds nothing to do.
    assertEquals((await runClaimedJobs(runnerDeps(provider, { t: new Date(T0.getTime() + 600 * MIN) }))).claimed, 0);
    assertEquals(provider.sent.length, 1);
  } finally {
    await cleanup({ leadIds: [leadId] });
  }
});

dbTest("enqueueJob: the same idempotency key enqueues once", async () => {
  await purgeTestJobs();
  const phone = uniquePhone();
  const leadId = await insertLead(phone.e164);
  try {
    const key = `test:${crypto.randomUUID()}`;
    const job = {
      org_id: DEMO_ORG,
      lead_id: leadId,
      kind: "send_message",
      run_at: T0.toISOString(),
      idempotency_key: key,
      payload: {},
    };
    const first = await enqueueJob(db, job);
    const second = await enqueueJob(db, job);
    assertExists(first);
    assertEquals(second, null);
    const { count } = await db.from("jobs").select("id", { count: "exact", head: true }).eq("idempotency_key", key);
    assertEquals(count, 1);
  } finally {
    await cleanup({ leadIds: [leadId] });
  }
});

dbTest("a failed send sets last_error and re-queues 1 minute later; the event says when", async () => {
  await purgeTestJobs();
  const phone = uniquePhone();
  const leadId = await insertLead(phone.e164);
  const clock = { t: T0 };
  const provider = new FlakyProvider(1, () => clock.t);
  try {
    const jobId = await enqueueAck(leadId, phone.e164);
    const summary = await runClaimedJobs(runnerDeps(provider, clock));
    assertEquals(summary.retried, 1);
    const job = await jobRow(jobId);
    assertEquals(job.status, "queued");
    assertEquals(job.attempts, 1);
    assert(job.last_error!.includes(provider.marker));
    assertEquals(new Date(job.run_at).getTime(), T0.getTime() + MIN);
    const events = await eventsForJob(jobId);
    assertEquals(events.map((e) => e.type), ["send_failed", "job_retry_scheduled"]);
    assertEquals((events[1].payload as { run_at: string }).run_at, new Date(T0.getTime() + MIN).toISOString());
    assertEquals(events[1].lead_id, leadId);
  } finally {
    await cleanup({ leadIds: [leadId] });
  }
});

dbTest("an earlier recorded send is not repeated (crash after send, before settle)", async () => {
  await purgeTestJobs();
  const phone = uniquePhone();
  const leadId = await insertLead(phone.e164);
  try {
    const jobId = await enqueueAck(leadId, phone.e164);
    const sentAt = new Date(T0.getTime() - MIN).toISOString();
    await db.from("messages").insert({
      org_id: DEMO_ORG,
      lead_id: leadId,
      job_id: jobId,
      to_phone: phone.e164,
      direction: "outbound",
      kind: "template",
      template_name: "enquiry_ack",
      provider: "fake",
      provider_message_id: `fake-${crypto.randomUUID()}`,
      status: "sent",
      sent_at: sentAt,
    });
    const provider = new FakeWhatsAppProvider();
    const summary = await runClaimedJobs(runnerDeps(provider, { t: T0 }));
    assertEquals(summary.done, 1);
    assertEquals(provider.sent.length, 0, "nothing sent twice");
    const { data: lead } = await db.from("leads").select("first_auto_reply_at").eq("id", leadId).single();
    assertEquals(new Date(lead!.first_auto_reply_at!).toISOString(), sentAt);
  } finally {
    await cleanup({ leadIds: [leadId] });
  }
});

dbTest("a running job whose lease expired is claimed again; past max_attempts it is dead-lettered unrun", async () => {
  await purgeTestJobs();
  const phone = uniquePhone();
  const leadId = await insertLead(phone.e164);
  try {
    const retryable = await enqueueAck(leadId, phone.e164);
    const exhausted = await enqueueAck(leadId, phone.e164);
    const claimedAt = T0.toISOString();
    await db.from("jobs").update({ status: "running", attempts: 1, updated_at: claimedAt }).eq("id", retryable);
    await db.from("jobs").update({ status: "running", attempts: 5, updated_at: claimedAt, last_error: "boom" })
      .eq("id", exhausted);

    const provider = new FakeWhatsAppProvider();
    // 10 minutes later both are still leased.
    assertEquals((await runClaimedJobs(runnerDeps(provider, { t: new Date(T0.getTime() + 10 * MIN) }))).claimed, 0);
    // 15 minutes later both leases have expired.
    const summary = await runClaimedJobs(runnerDeps(provider, { t: new Date(T0.getTime() + 15 * MIN) }));
    assertEquals(summary, { claimed: 2, done: 1, cancelled: 0, retried: 0, dead: 1, lost: 0, errors: 0 });
    assertEquals(provider.sent.length, 1, "only the job with attempts left is run");
    assertEquals((await jobRow(retryable)).attempts, 2);
    const dead = await jobRow(exhausted);
    assertEquals(dead.status, "dead");
    assertEquals(dead.attempts, 6);
    assertEquals(dead.last_error, "boom");
    assertEquals((await eventsForJob(exhausted)).map((e) => e.type), ["job_dead", "ops_alert_skipped"]);
  } finally {
    await cleanup({ leadIds: [leadId] });
  }
});

dbTest("kinds not built yet dead-letter at once, visibly; no OPS_ALERT_PHONE means a skipped-alert event", async () => {
  await purgeTestJobs();
  const ids: string[] = [];
  try {
    for (const kind of ["followup", "weekly_report"]) {
      ids.push((await enqueueJob(db, {
        org_id: DEMO_ORG,
        kind,
        run_at: T0.toISOString(),
        idempotency_key: `test:${crypto.randomUUID()}`,
      }))!);
    }
    const provider = new FakeWhatsAppProvider();
    const summary = await runClaimedJobs(runnerDeps(provider, { t: T0 }));
    assertEquals(summary.dead, 2);
    for (const id of ids) {
      const job = await jobRow(id);
      assertEquals(job.status, "dead");
      assertEquals(job.attempts, 1);
      assert(job.last_error!.includes("not implemented in slice A"), job.last_error!);
      const events = await eventsForJob(id);
      assertEquals(events.map((e) => e.type), ["job_dead", "ops_alert_skipped"]);
      assertEquals((events[1].payload as { reason: string }).reason, "OPS_ALERT_PHONE is not set");
    }
    assertEquals(provider.sent.length, 0);
  } finally {
    await cleanup({ jobIds: ids });
  }
});

dbTest("a send_message job for a phone other than the lead's is dead-lettered, not sent", async () => {
  await purgeTestJobs();
  const phone = uniquePhone();
  const leadId = await insertLead(phone.e164);
  try {
    const jobId = await enqueueAck(leadId, uniquePhone().e164);
    const provider = new FakeWhatsAppProvider();
    const summary = await runClaimedJobs(
      runnerDeps(provider, { t: T0 }, { OPS_ALERT_PHONE: "+91 90000 00002" }),
    );
    assertEquals(summary.dead, 1);
    assertEquals(provider.sent.map((s) => s.template), ["ops_alert"]);
    assertEquals(provider.sent[0].to, "+919000000002");
    assertEquals(provider.sent[0].params.slice(0, 3), ["send_message", jobId, "1"]);
    assertEquals((await eventsForJob(jobId)).map((e) => e.type), ["job_dead", "ops_alert_sent"]);
  } finally {
    await cleanup({ leadIds: [leadId] });
  }
});

// --- Owner alerts (spec 004, A.5) ------------------------------------------

async function enqueueOwnerAlert(leadId: string, to: string) {
  const id = await enqueueJob(db, {
    org_id: DEMO_ORG,
    lead_id: leadId,
    kind: "send_message",
    run_at: T0.toISOString(),
    idempotency_key: `test:${crypto.randomUUID()}`,
    payload: {
      to,
      template: "owner_alert",
      language: "en",
      params: ["Job Test", "+917000000000", "-", "-"],
      first_auto_reply: false,
    },
  });
  assertExists(id);
  return id!;
}

dbTest("send_message owner_alert: goes to the org's owner phone, recorded without a lead_id", async () => {
  await purgeTestJobs();
  const phone = uniquePhone();
  const leadId = await insertLead(phone.e164);
  let jobId = "";
  try {
    jobId = await enqueueOwnerAlert(leadId, "+919000000001");
    const provider = new FakeWhatsAppProvider();
    const summary = await runClaimedJobs(runnerDeps(provider, { t: T0 }));
    assertEquals(summary.done, 1);
    assertEquals(provider.sent.map((s) => [s.to, s.template]), [["+919000000001", "owner_alert"]]);
    const { data: msgs } = await db.from("messages").select("*").eq("job_id", jobId);
    assertEquals(msgs!.length, 1);
    assertEquals(msgs![0].lead_id, null);
    assertEquals(msgs![0].to_phone, "+919000000001");
    assertEquals(msgs![0].template_name, "owner_alert");
    const { data: lead } = await db.from("leads").select("first_auto_reply_at").eq("id", leadId).single();
    assertEquals(lead!.first_auto_reply_at, null, "an owner alert is not the lead's auto-reply");
    assertEquals((await eventsForJob(jobId)).map((e) => e.type), ["owner_alert_sent"]);
  } finally {
    await cleanup({ jobIds: [jobId], leadIds: [leadId] });
  }
});

dbTest("send_message owner_alert: a phone that is not an owner phone of the org is cancelled, not sent", async () => {
  await purgeTestJobs();
  const phone = uniquePhone();
  const leadId = await insertLead(phone.e164);
  try {
    const jobId = await enqueueOwnerAlert(leadId, uniquePhone().e164);
    const provider = new FakeWhatsAppProvider();
    const summary = await runClaimedJobs(runnerDeps(provider, { t: T0 }));
    assertEquals(summary.cancelled, 1);
    assertEquals(provider.sent.length, 0);
    assertEquals((await jobRow(jobId)).status, "cancelled");
    assertEquals((await eventsForJob(jobId)).map((e) => e.type), ["job_cancelled"]);
  } finally {
    await cleanup({ leadIds: [leadId] });
  }
});

// --- Exactly once after status changes, and lost leases ----------------------

dbTest("a reclaimed job whose message is already delivered sends nothing", async () => {
  await purgeTestJobs();
  const phone = uniquePhone();
  const leadId = await insertLead(phone.e164);
  try {
    const jobId = await enqueueAck(leadId, phone.e164);
    // Its runner sent the message and died before settling; a receipt has since
    // moved the message to delivered.
    await db.from("jobs").update({ status: "running", attempts: 1, updated_at: T0.toISOString() }).eq("id", jobId);
    await db.from("messages").insert({
      org_id: DEMO_ORG,
      lead_id: leadId,
      job_id: jobId,
      to_phone: phone.e164,
      direction: "outbound",
      kind: "template",
      template_name: "enquiry_ack",
      provider: "fake",
      provider_message_id: `fake-${crypto.randomUUID()}`,
      status: "delivered",
      sent_at: T0.toISOString(),
    });
    const provider = new FakeWhatsAppProvider();
    const summary = await runClaimedJobs(runnerDeps(provider, { t: new Date(T0.getTime() + 15 * MIN) }));
    assertEquals(summary.claimed, 1, "the expired lease is reclaimed");
    assertEquals(summary.done, 1);
    assertEquals(provider.sent.length, 0, "nothing sent twice");
    const job = await jobRow(jobId);
    assertEquals(job.status, "done");
    assertEquals(job.attempts, 2);
    const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("job_id", jobId);
    assertEquals(count, 1);
  } finally {
    await cleanup({ leadIds: [leadId] });
  }
});

/** A handler that, mid-run, loses its job to another runner (as a lease reclaim would), then fails. */
function losesLeaseThenThrows(): Deps["handlers"] {
  return {
    send_message: async (job) => {
      await db.from("jobs").update({ attempts: job.attempts + 1, updated_at: T0.toISOString() }).eq("id", job.id);
      throw new Error("boom after losing the lease");
    },
  };
}

dbTest("lost lease on a retry: no retry event, and the other runner's state is kept", async () => {
  await purgeTestJobs();
  const phone = uniquePhone();
  const leadId = await insertLead(phone.e164);
  try {
    const jobId = await enqueueAck(leadId, phone.e164);
    const provider = new FakeWhatsAppProvider();
    const summary = await runClaimedJobs({ ...runnerDeps(provider, { t: T0 }), handlers: losesLeaseThenThrows() });
    assertEquals(summary, { claimed: 1, done: 0, cancelled: 0, retried: 0, dead: 0, lost: 1, errors: 0 });
    const job = await jobRow(jobId);
    assertEquals(job.status, "running", "still the other runner's");
    assertEquals(job.attempts, 2);
    assertEquals(job.last_error, null);
    assertEquals((await eventsForJob(jobId)).map((e) => e.type), []);
  } finally {
    await cleanup({ leadIds: [leadId] });
  }
});

dbTest("lost lease on the final attempt: no job_dead event and no ops alert", async () => {
  await purgeTestJobs();
  const phone = uniquePhone();
  const leadId = await insertLead(phone.e164);
  try {
    const jobId = await enqueueAck(leadId, phone.e164, { max_attempts: 1 });
    const provider = new FakeWhatsAppProvider();
    const summary = await runClaimedJobs({
      ...runnerDeps(provider, { t: T0 }, { OPS_ALERT_PHONE: "+919000000002" }),
      handlers: losesLeaseThenThrows(),
    });
    assertEquals(summary, { claimed: 1, done: 0, cancelled: 0, retried: 0, dead: 0, lost: 1, errors: 0 });
    assertEquals(provider.sent.length, 0, "no ops alert");
    const job = await jobRow(jobId);
    assertEquals(job.status, "running");
    assertEquals((await eventsForJob(jobId)).map((e) => e.type), []);
  } finally {
    await cleanup({ leadIds: [leadId] });
  }
});
