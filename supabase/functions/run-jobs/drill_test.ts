// Failure drill (spec 004, A.6), against the local database.
//
// The provider is down for the first N calls and then recovers. Enquiries go
// through ingest-form (inline ack fails, a send_message job is enqueued), then
// the job runner is called every simulated minute, two runners at a time, as
// overlapping cron calls would. Checks: every ack is sent exactly once,
// nothing is lost, and attempts and backoff follow 1, 5, 25, 120 minutes.
// deno-lint-ignore no-import-prefix -- test-only std dep; no shared deno.json by design
import { assert, assertEquals } from "jsr:@std/assert@1";
import { BACKOFF_MINUTES } from "../_shared/jobs.ts";
import { handler as ingest } from "../ingest-form/index.ts";
import { type Deps, runClaimedJobs } from "./index.ts";
import { cleanup, db, dbTest, DEMO_ORG, FlakyProvider, insertLead, MIN, purgeTestJobs, T0, uniquePhone } from "./testing.ts";

const OWNER_PHONES = 1; // the demo org's owner_alert_phones

/** Calls two runners per simulated minute from `from` to `to` (inclusive). */
async function tickEveryMinute(deps: Omit<Deps, "now">, clock: { t: Date }, fromMin: number, toMin: number) {
  for (let m = fromMin; m <= toMin; m++) {
    clock.t = new Date(T0.getTime() + m * MIN);
    const d = { ...deps, now: () => clock.t };
    // Batch size 2 so each minute takes several claim rounds that interleave.
    await Promise.all([runClaimedJobs(d, { batchSize: 2 }), runClaimedJobs(d, { batchSize: 2 })]);
  }
}

type Sent = "enquiry_ack" | "owner_alert";

/**
 * Minutes after T0 of each provider call for one lead's message: its ack (sent
 * to the lead) or its owner alert (sent to the owner, naming the lead's phone).
 */
function callsFor(provider: FlakyProvider, leadPhone: string, template: Sent) {
  return provider.calls
    .filter((c) => c.template === template && (template === "enquiry_ack" ? c.to : c.params[1]) === leadPhone)
    .map((c) => ({ min: (c.at.getTime() - T0.getTime()) / MIN, ok: c.ok, call: c }));
}

/** Minutes after T0 of each ack call to one recipient. */
function callMinutes(provider: FlakyProvider, to: string) {
  return provider.calls.filter((c) => c.to === to && c.template === "enquiry_ack")
    .map((c) => ({ min: (c.at.getTime() - T0.getTime()) / MIN, ok: c.ok }));
}

dbTest("failure drill: provider down for the first 27 calls, every ack and owner alert sent exactly once with the right backoff", async () => {
  await purgeTestJobs();
  const K = 4;
  const JOBS = K * (1 + OWNER_PHONES); // one ack and one owner alert per enquiry
  // Inline: all JOBS sends fail. Runner: minutes 1 and 2 fail all JOBS jobs,
  // minute 7 fails 3 of them; those 3 succeed at minute 32.
  const N = JOBS + JOBS + JOBS + 3;
  const clock = { t: T0 };
  const provider = new FlakyProvider(N, () => clock.t);
  const phones = Array.from({ length: K }, () => uniquePhone());
  const leadIds: string[] = [];

  try {
    // 1. Enquiries arrive while the provider is down.
    for (const phone of phones) {
      const res = await ingest(
        new Request("http://localhost/functions/v1/ingest-form", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source_key: "demo-web-form", name: "Drill Lead", phone: phone.national, consent: true }),
        }),
        { db, provider, now: () => clock.t, verifyTurnstile: () => Promise.resolve(true) },
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.ack_sent, false);
      leadIds.push(body.lead_id);
    }
    assertEquals(provider.calls.length, JOBS);
    assert(provider.calls.every((c) => !c.ok));

    const { data: jobs } = await db.from("jobs").select("*").in("lead_id", leadIds);
    assertEquals(jobs!.length, JOBS, "one retry job per failed ack and per failed owner alert");
    assert(jobs!.every((j) => j.status === "queued" && j.attempts === 0));
    assert(jobs!.every((j) => new Date(j.run_at).getTime() === T0.getTime() + MIN));

    // 2. Cron every minute for 3 hours, two overlapping runners each time.
    await tickEveryMinute({ db, provider, env: () => undefined }, clock, 0, 180);

    // 3. Every ack and every owner alert got exactly one successful call, and
    //    the attempts were spaced by the backoff schedule.
    let runnerFailures = 0;
    const attemptCounts: number[] = [];
    for (const phone of phones) {
      for (const template of ["enquiry_ack", "owner_alert"] as const) {
        const calls = callsFor(provider, phone.e164, template);
        const what = `${template} for ${phone.e164}`;
        // Call 0 was the inline send at minute 0; the job's attempts follow.
        assertEquals(calls[0].min, 0, what);
        assertEquals(calls[0].ok, false, what);
        const attempts = calls.slice(1);
        assertEquals(attempts.filter((c) => c.ok).length, 1, `${what} sent exactly once`);
        assertEquals(attempts.at(-1)!.ok, true, `${what}: the last attempt is the success`);
        assertEquals(attempts[0].min, 1, `${what}: first retry one minute after the enquiry`);
        for (let i = 1; i < attempts.length; i++) {
          assertEquals(attempts[i].min - attempts[i - 1].min, BACKOFF_MINUTES[i - 1], `${what}: gap before attempt ${i + 1}`);
        }
        runnerFailures += attempts.length - 1;
        attemptCounts.push(attempts.length);
      }
    }
    assertEquals(runnerFailures, N - JOBS, "every provider failure is accounted for");
    assertEquals(attemptCounts.sort(), [3, 3, 3, 3, 3, 4, 4, 4]);

    // 4. The database agrees: jobs done, one message per job, linked to it.
    const { data: after } = await db.from("jobs").select("*").in("lead_id", leadIds);
    assertEquals(after!.length, JOBS);
    for (const job of after!) {
      assertEquals(job.status, "done");
      const payload = job.payload as { to: string; template: Sent; params: string[] };
      const leadPhone = payload.template === "enquiry_ack" ? payload.to : payload.params[1];
      const calls = callsFor(provider, leadPhone, payload.template).slice(1);
      assertEquals(job.attempts, calls.length);
      assert(job.last_error?.includes(provider.marker), "last_error kept from the last failure");

      const { data: msgs } = await db.from("messages").select("*").eq("job_id", job.id);
      assertEquals(msgs!.length, 1, "exactly one message for the job");
      const msg = msgs![0];
      assertEquals(msg.status, "sent");
      assertEquals(msg.template_name, payload.template);
      assertEquals(msg.to_phone, payload.to);
      const okCall = calls.find((c) => c.ok)!.call;
      assertEquals(msg.provider_message_id, okCall.providerMessageId);

      if (payload.template === "enquiry_ack") {
        assertEquals(msg.lead_id, job.lead_id);
        const { data: lead } = await db.from("leads").select("first_auto_reply_at").eq("id", job.lead_id!).single();
        assertEquals(new Date(lead!.first_auto_reply_at!).getTime(), okCall.at.getTime());
      } else {
        assertEquals(msg.lead_id, null, "owner alerts have no lead_id");
        assertEquals(payload.to, "+919000000001");
      }

      const { data: events } = await db.from("events").select("type, payload").eq("payload->>job_id", job.id).order("id");
      assertEquals(events!.filter((e) => e.type === "job_retry_scheduled").length, job.attempts - 1);
      assert(!events!.some((e) => e.type === "job_dead"));
    }

    // Per lead: one sent ack in total (inline ones all failed).
    for (const leadId of leadIds) {
      const { count } = await db.from("messages").select("id", { count: "exact", head: true })
        .eq("lead_id", leadId).eq("template_name", "enquiry_ack").eq("status", "sent");
      assertEquals(count, 1);
    }

    // 5. Nothing more happens later: no stray sends, nothing left in the queue.
    const callsBefore = provider.calls.length;
    await tickEveryMinute({ db, provider, env: () => undefined }, clock, 600, 602);
    assertEquals(provider.calls.length, callsBefore);
    const { count: open } = await db.from("jobs").select("id", { count: "exact", head: true })
      .in("lead_id", leadIds).in("status", ["queued", "running", "dead"]);
    assertEquals(open, 0);
    const ownerOk = provider.calls.filter((c) => c.template === "owner_alert" && c.ok);
    assertEquals(ownerOk.length, K * OWNER_PHONES, "each owner alert delivered once");
    assertEquals(new Set(ownerOk.map((c) => c.params[1])).size, K);
  } finally {
    // Sent owner-alert messages have no lead_id; remove them through their jobs first.
    const { data: jobs } = await db.from("jobs").select("id").in("lead_id", leadIds);
    await db.from("messages").delete().in("job_id", (jobs ?? []).map((j) => j.id));
    await cleanup({ leadIds, marker: provider.marker });
  }
});

dbTest("failure drill: a job that never succeeds runs 5 times at +0, 1, 6, 31, 151 minutes, then dead-letters and alerts ops", async () => {
  await purgeTestJobs();
  const clock = { t: T0 };
  // Down for 5 calls: all five attempts fail; the 6th call (the ops alert) works.
  const provider = new FlakyProvider(5, () => clock.t);
  const phone = uniquePhone();
  const leadId = await insertLead(phone.e164);
  try {
    const { data: job } = await db.from("jobs").insert({
      org_id: DEMO_ORG,
      lead_id: leadId,
      kind: "send_message",
      run_at: T0.toISOString(),
      idempotency_key: `test:${crypto.randomUUID()}`,
      payload: { to: phone.e164, template: "enquiry_ack", language: "en", params: ["Job", "Demo"] },
    }).select("*").single();

    await tickEveryMinute({ db, provider, env: (k) => (k === "OPS_ALERT_PHONE" ? "9000000002" : undefined) }, clock, 0, 300);

    assertEquals(callMinutes(provider, phone.e164), [0, 1, 6, 31, 151].map((min) => ({ min, ok: false })));
    const ops = provider.calls.filter((c) => c.template === "ops_alert");
    assertEquals(ops.length, 1);
    assertEquals(ops[0].to, "+919000000002");
    assertEquals(ops[0].ok, true);
    assertEquals((ops[0].at.getTime() - T0.getTime()) / MIN, 151);
    assertEquals(ops[0].params.slice(0, 3), ["send_message", job!.id, "5"]);

    const { data: dead } = await db.from("jobs").select("*").eq("id", job!.id).single();
    assertEquals(dead!.status, "dead");
    assertEquals(dead!.attempts, 5);
    assert(dead!.last_error!.includes(provider.marker));

    const { data: events } = await db.from("events").select("type").eq("payload->>job_id", job!.id).order("id");
    const types = events!.map((e) => e.type);
    assertEquals(types.filter((t) => t === "send_failed").length, 5);
    assertEquals(types.filter((t) => t === "job_retry_scheduled").length, 4);
    assertEquals(types.slice(-2), ["job_dead", "ops_alert_sent"]);
    const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("job_id", job!.id);
    assertEquals(count, 0, "nothing recorded as sent");
  } finally {
    await cleanup({ leadIds: [leadId] });
  }
});
