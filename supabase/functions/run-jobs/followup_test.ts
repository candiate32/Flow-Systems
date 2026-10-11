// Follow-ups against the local database (spec 004, "B. Follow-ups and window").
//
// Every test drives the job runner with its own clock, so nothing waits for
// real time. The enquiry is Saturday 2001-03-10 14:00 IST; its follow-ups fall
// due at 11:00 IST on Sunday 11th (day 1), Tuesday 13th (day 3) and Saturday
// 17th (day 7). Being in 2001, they are only ever claimed by these tests.
// deno-lint-ignore no-import-prefix -- test-only std dep; no shared deno.json by design
import { assert, assertEquals, assertExists } from "jsr:@std/assert@1";
import { scheduleFollowUps } from "../_shared/followups.ts";
import { cancelFollowUps, recordOptOut } from "../_shared/lead_activity.ts";
import { renderTemplate } from "../_shared/templates.ts";
import { FakeWhatsAppProvider, type WhatsAppProvider } from "../_shared/whatsapp.ts";
import { handler as ingest } from "../ingest-form/index.ts";
import { runClaimedJobs, type RunOptions } from "./index.ts";
import { cleanup, db, dbTest, DEMO_ORG, FlakyProvider, insertLead, MIN, purgeTestJobs, uniquePhone } from "./testing.ts";

const H = 60 * MIN;
const ORG_NAME = "Lime & Lattice, Sarjapur Road";
const ENQ = new Date("2001-03-10T08:30:00.000Z"); // 14:00 IST
const DAY1 = new Date("2001-03-11T05:30:00.000Z"); // 11:00 IST
const DAY3 = new Date("2001-03-13T05:30:00.000Z");
const DAY7 = new Date("2001-03-17T05:30:00.000Z");
const at = (d: Date, plusMs = 0) => new Date(d.getTime() + plusMs);

function run(provider: WhatsAppProvider, now: Date, opts?: RunOptions) {
  return runClaimedJobs({ db, provider, now: () => now, env: () => undefined }, opts);
}

/** Inserts a consenting lead ("Job Test") and schedules its follow-ups for the enquiry at ENQ. */
async function leadWithFollowUps(enquiryAt = ENQ) {
  const phone = uniquePhone();
  const leadId = await insertLead(phone.e164);
  const { enqueued } = await scheduleFollowUps(db, leadId, enquiryAt, enquiryAt);
  assertEquals(enqueued.length, 3);
  return { leadId, phone: phone.e164 };
}

/** The lead's follow-up jobs, oldest due first. */
async function followUpJobs(leadId: string) {
  const { data, error } = await db.from("jobs").select("*").eq("lead_id", leadId).eq("kind", "followup")
    .order("run_at").order("created_at");
  if (error) throw error;
  return data;
}

async function eventsForJob(id: string) {
  const { data, error } = await db.from("events").select("type, payload").eq("payload->>job_id", id).order("id");
  if (error) throw error;
  return data;
}

async function messagesForLead(leadId: string) {
  const { data, error } = await db.from("messages").select("*").eq("lead_id", leadId).order("created_at");
  if (error) throw error;
  return data;
}

const reasonOf = (e: { payload: unknown }) => (e.payload as { reason?: string }).reason;

dbTest("follow-ups end to end: an enquiry through ingest-form gets followup_1, _2 and _3 as templates on day 1, 3 and 7", async () => {
  await purgeTestJobs();
  const phone = uniquePhone();
  const ingestProvider = new FakeWhatsAppProvider();
  const res = await ingest(
    new Request("http://localhost/functions/v1/ingest-form", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source_key: "demo-web-form", name: "Asha Rao", phone: phone.national, consent: true }),
    }),
    { db, provider: ingestProvider, now: () => ENQ, verifyTurnstile: () => Promise.resolve(true) },
  );
  assertEquals(res.status, 200);
  const { lead_id: leadId } = await res.json();
  try {
    const jobs = await followUpJobs(leadId);
    assertEquals(jobs.map((j) => new Date(j.run_at).toISOString()), [DAY1, DAY3, DAY7].map((d) => d.toISOString()));

    const provider = new FakeWhatsAppProvider();
    assertEquals((await run(provider, at(DAY1, -MIN))).claimed, 0, "nothing is due a minute early");

    const summary = await run(provider, DAY1);
    assertEquals(summary, { claimed: 1, done: 1, cancelled: 0, deferred: 0, retried: 0, dead: 0, lost: 0, errors: 0 });
    assertEquals(provider.sent.map((s) => [s.to, s.template, s.language, s.params]), [
      [phone.e164, "followup_1", "en", ["Asha", ORG_NAME]],
    ]);
    assertEquals(provider.sessions.length, 0);

    const [job1, job2, job3] = await followUpJobs(leadId);
    assertEquals([job1.status, job1.attempts, job2.status, job3.status], ["done", 1, "queued", "queued"]);
    const msgs = (await messagesForLead(leadId)).filter((m) => m.job_id === job1.id);
    assertEquals(msgs.length, 1);
    assertEquals(msgs[0].direction, "outbound");
    assertEquals(msgs[0].kind, "template");
    assertEquals(msgs[0].template_name, "followup_1");
    assertEquals(msgs[0].to_phone, phone.e164);
    assertEquals(msgs[0].status, "sent");
    assertEquals(msgs[0].provider_message_id, provider.sent[0].providerMessageId);
    assertEquals(msgs[0].body, renderTemplate("followup_1", ["Asha", ORG_NAME]));
    assertEquals(new Date(msgs[0].sent_at!).toISOString(), DAY1.toISOString());
    const events = await eventsForJob(job1.id);
    assertEquals(events.map((e) => e.type), ["followup_sent"]);
    assertEquals((events[0].payload as { mode: string; n: number }).mode, "template");

    assertEquals((await run(provider, at(DAY1, MIN))).claimed, 0, "running again sends nothing");

    await run(provider, DAY3);
    await run(provider, DAY7);
    assertEquals(provider.sent.map((s) => s.template), ["followup_1", "followup_2", "followup_3"]);
    assert((await followUpJobs(leadId)).every((j) => j.status === "done"));
  } finally {
    await db.from("messages").delete().in("provider_message_id", ingestProvider.sent.map((s) => s.providerMessageId));
    await cleanup({ leadIds: [leadId] });
  }
});

dbTest("a lead who messaged 2 hours before day 3 gets no day-3 or day-7 follow-up; each is cancelled with the reason", async () => {
  await purgeTestJobs();
  const { leadId } = await leadWithFollowUps();
  try {
    const provider = new FakeWhatsAppProvider();
    await run(provider, DAY1);
    assertEquals(provider.sent.length, 1);

    await db.from("leads").update({ last_inbound_at: at(DAY3, -2 * H).toISOString() }).eq("id", leadId);
    const day3 = await run(provider, DAY3);
    assertEquals([day3.claimed, day3.cancelled], [1, 1]);
    const day7 = await run(provider, DAY7);
    assertEquals([day7.claimed, day7.cancelled], [1, 1]);
    assertEquals(provider.sent.length + provider.sessions.length, 1, "only day 1 was sent");

    const [, job2, job3] = await followUpJobs(leadId);
    for (const job of [job2, job3]) {
      assertEquals(job.status, "cancelled");
      const events = await eventsForJob(job.id);
      assertEquals(events.map((e) => [e.type, reasonOf(e)]), [["job_cancelled", "lead replied after the enquiry"]]);
    }
  } finally {
    await cleanup({ leadIds: [leadId] });
  }
});

dbTest("a staff reply after the enquiry cancels the follow-up", async () => {
  await purgeTestJobs();
  const { leadId } = await leadWithFollowUps();
  try {
    await db.from("leads").update({ first_human_reply_at: at(ENQ, 3 * H).toISOString() }).eq("id", leadId);
    const provider = new FakeWhatsAppProvider();
    assertEquals((await run(provider, DAY1)).cancelled, 1);
    assertEquals(provider.sent.length, 0);
    const [job1] = await followUpJobs(leadId);
    assertEquals((await eventsForJob(job1.id)).map(reasonOf), ["staff replied after the enquiry"]);
  } finally {
    await cleanup({ leadIds: [leadId] });
  }
});

dbTest("cancelFollowUps (the webhook's call on an inbound or echo) cancels the queued follow-ups at once", async () => {
  await purgeTestJobs();
  const { leadId } = await leadWithFollowUps();
  const other = await leadWithFollowUps();
  try {
    const cancelled = await cancelFollowUps(db, leadId, "lead replied", at(ENQ, H));
    const jobs = await followUpJobs(leadId);
    assertEquals(cancelled.sort(), jobs.map((j) => j.id).sort());
    assert(jobs.every((j) => j.status === "cancelled"));
    for (const j of jobs) assertEquals((await eventsForJob(j.id)).map((e) => [e.type, reasonOf(e)]), [["job_cancelled", "lead replied"]]);
    assertEquals(await cancelFollowUps(db, leadId, "again"), [], "a second call cancels nothing");

    // Another lead's follow-ups are untouched, and run as usual.
    const provider = new FakeWhatsAppProvider();
    const summary = await run(provider, DAY1);
    assertEquals([summary.claimed, summary.done], [1, 1]);
    assertEquals(provider.sent.map((s) => s.to), [other.phone]);
  } finally {
    await cleanup({ leadIds: [leadId, other.leadId] });
  }
});

dbTest("inside the 24-hour window the follow-up is a session message with the template's text; outside it, the template", async () => {
  await purgeTestJobs();
  const { leadId, phone } = await leadWithFollowUps();
  try {
    // The lead wrote to us an hour before the enquiry: day 1 is 22 hours later.
    await db.from("leads").update({ last_inbound_at: at(ENQ, -H).toISOString() }).eq("id", leadId);
    const provider = new FakeWhatsAppProvider();
    assertEquals((await run(provider, DAY1)).done, 1);
    const text = renderTemplate("followup_1", ["Job", ORG_NAME]);
    assertEquals(provider.sessions.map((s) => [s.to, s.text]), [[phone, text]]);
    assertEquals(provider.sent.length, 0, "no template inside the window");
    const [job1] = await followUpJobs(leadId);
    const msg = (await messagesForLead(leadId)).find((m) => m.job_id === job1.id)!;
    assertEquals([msg.kind, msg.template_name, msg.body], ["session", "followup_1", text]);
    assertEquals(msg.provider_message_id, provider.sessions[0].providerMessageId);
    assertEquals((await eventsForJob(job1.id)).map((e) => (e.payload as { mode?: string }).mode), ["session"]);

    // Day 3 is long past the window.
    await run(provider, DAY3);
    assertEquals(provider.sent.map((s) => s.template), ["followup_2"]);
    assertEquals(provider.sessions.length, 1);
  } finally {
    await cleanup({ leadIds: [leadId] });
  }
});

dbTest("opt-out stops everything: queued follow-ups, a pending ack retry, and follow-ups of a later enquiry", async () => {
  await purgeTestJobs();
  const { leadId, phone } = await leadWithFollowUps();
  try {
    // An acknowledgement retry is also waiting.
    const { data: ack } = await db.from("jobs").insert({
      org_id: DEMO_ORG,
      lead_id: leadId,
      kind: "send_message",
      run_at: at(ENQ, MIN).toISOString(),
      idempotency_key: `test:${crypto.randomUUID()}`,
      payload: { to: phone, template: "enquiry_ack", language: "en", params: ["Job", ORG_NAME], first_auto_reply: true },
    }).select("id").single();

    const optedOutAt = at(ENQ, 30 * 1000);
    const cancelled = await recordOptOut(db, leadId, optedOutAt);
    assertEquals(cancelled!.length, 3, "the three queued follow-ups");
    const { data: lead } = await db.from("leads").select("opted_out_at").eq("id", leadId).single();
    assertEquals(new Date(lead!.opted_out_at!).toISOString(), optedOutAt.toISOString());
    const { data: optOutEvents } = await db.from("events").select("type").eq("lead_id", leadId).eq("type", "lead_opted_out");
    assertEquals(optOutEvents!.length, 1);
    assertEquals(await recordOptOut(db, crypto.randomUUID(), optedOutAt), null, "unknown lead");

    // A later enquiry (say the form again) queues a fresh set; it must not send either.
    const later = new Date("2001-04-02T06:00:00.000Z");
    assertEquals((await scheduleFollowUps(db, leadId, later, later)).enqueued.length, 3);

    const provider = new FakeWhatsAppProvider();
    let cancelledRuns = 0;
    for (const t of [at(ENQ, MIN), DAY1, DAY3, DAY7, new Date("2001-04-03T05:30:00Z"), new Date("2001-04-09T05:30:00Z")]) {
      cancelledRuns += (await run(provider, t)).cancelled;
    }
    assertEquals(provider.sent.length + provider.sessions.length, 0, "nothing sent after the opt-out");
    assertEquals(cancelledRuns, 4, "the ack retry and the later enquiry's three follow-ups, at run time");
    assertEquals((await eventsForJob(ack!.id)).map(reasonOf), ["lead opted out"]);
    const jobs = await followUpJobs(leadId);
    assertEquals(jobs.length, 6);
    assert(jobs.every((j) => j.status === "cancelled"));
    assertEquals((await messagesForLead(leadId)).length, 0);
  } finally {
    await cleanup({ leadIds: [leadId] });
  }
});

dbTest("quiet hours: a follow-up due at 22:00 IST waits until 09:00 IST, gives back its attempt, then sends", async () => {
  await purgeTestJobs();
  const { leadId } = await leadWithFollowUps();
  try {
    // Pushed into the evening, as a late runner or a retry would.
    const [job1] = await followUpJobs(leadId);
    const evening = new Date("2001-03-11T16:30:00.000Z"); // 22:00 IST
    const nineAm = new Date("2001-03-12T03:30:00.000Z"); // 09:00 IST next day
    await db.from("jobs").update({ run_at: evening.toISOString() }).eq("id", job1.id);

    const provider = new FakeWhatsAppProvider();
    const summary = await run(provider, evening);
    assertEquals(summary, { claimed: 1, done: 0, cancelled: 0, deferred: 1, retried: 0, dead: 0, lost: 0, errors: 0 });
    assertEquals(provider.sent.length, 0);
    const { data: deferred } = await db.from("jobs").select("*").eq("id", job1.id).single();
    assertEquals([deferred!.status, deferred!.attempts], ["queued", 0]);
    assertEquals(new Date(deferred!.run_at).toISOString(), nineAm.toISOString());
    const events = await eventsForJob(job1.id);
    assertEquals(events.map((e) => [e.type, reasonOf(e), (e.payload as { run_at?: string }).run_at]), [
      ["job_deferred", "quiet hours", nineAm.toISOString()],
    ]);

    assertEquals((await run(provider, at(nineAm, -MIN))).claimed, 0, "still quiet at 08:59");
    assertEquals((await run(provider, nineAm)).done, 1);
    assertEquals(provider.sent.map((s) => s.template), ["followup_1"]);
    const { data: done } = await db.from("jobs").select("status, attempts").eq("id", job1.id).single();
    assertEquals(done, { status: "done", attempts: 1 });
  } finally {
    await cleanup({ leadIds: [leadId] });
  }
});

dbTest("a failed follow-up send is retried with backoff and sent once", async () => {
  await purgeTestJobs();
  const { leadId } = await leadWithFollowUps();
  try {
    let now = DAY1;
    const provider = new FlakyProvider(1, () => now);
    assertEquals((await run(provider, now)).retried, 1);
    const [job1] = await followUpJobs(leadId);
    assertEquals([job1.status, job1.attempts], ["queued", 1]);
    assertEquals(new Date(job1.run_at).toISOString(), at(DAY1, MIN).toISOString());
    now = at(DAY1, MIN);
    assertEquals((await run(provider, now)).done, 1);
    assertEquals(provider.calls.map((c) => [c.template, c.ok]), [["followup_1", false], ["followup_1", true]]);
    assertEquals((await eventsForJob(job1.id)).map((e) => e.type), ["send_failed", "job_retry_scheduled", "followup_sent"]);
    assertEquals((await messagesForLead(leadId)).length, 1);
  } finally {
    await cleanup({ leadIds: [leadId] });
  }
});

dbTest("exactly once: two overlapping runners send each lead's day-1 follow-up once", async () => {
  await purgeTestJobs();
  const leads = await Promise.all(Array.from({ length: 6 }, () => leadWithFollowUps()));
  try {
    const provider = new FakeWhatsAppProvider();
    // Batch size 2 so each runner takes several claim rounds that interleave.
    const [a, b] = await Promise.all([run(provider, DAY1, { batchSize: 2 }), run(provider, DAY1, { batchSize: 2 })]);
    assertEquals(a.claimed + b.claimed, 6);
    assertEquals(a.done + b.done, 6);
    assertEquals(provider.sent.length, 6);
    assertEquals(new Set(provider.sent.map((s) => s.to)).size, 6);
    for (const { leadId } of leads) {
      const msgs = await messagesForLead(leadId);
      assertEquals(msgs.length, 1);
      assertExists(msgs[0].job_id);
    }
    // And a third runner a minute later finds nothing.
    assertEquals((await run(provider, at(DAY1, MIN))).claimed, 0);
  } finally {
    await cleanup({ leadIds: leads.map((l) => l.leadId) });
  }
});

dbTest("exactly once: a reclaimed follow-up whose send was recorded does not send again", async () => {
  await purgeTestJobs();
  const { leadId, phone } = await leadWithFollowUps();
  try {
    const [job1] = await followUpJobs(leadId);
    // Its runner sent it and died before settling the job.
    await db.from("jobs").update({ status: "running", attempts: 1, updated_at: DAY1.toISOString() }).eq("id", job1.id);
    await db.from("messages").insert({
      org_id: DEMO_ORG,
      lead_id: leadId,
      job_id: job1.id,
      to_phone: phone,
      direction: "outbound",
      kind: "template",
      template_name: "followup_1",
      provider: "fake",
      provider_message_id: `fake-${crypto.randomUUID()}`,
      status: "delivered",
      sent_at: DAY1.toISOString(),
    });
    const provider = new FakeWhatsAppProvider();
    const summary = await run(provider, at(DAY1, 15 * MIN));
    assertEquals([summary.claimed, summary.done], [1, 1]);
    assertEquals(provider.sent.length, 0);
    assertEquals((await messagesForLead(leadId)).length, 1);
  } finally {
    await cleanup({ leadIds: [leadId] });
  }
});

dbTest("a followup job with a bad payload or no lead is dead-lettered, not sent", async () => {
  await purgeTestJobs();
  const { leadId } = await leadWithFollowUps();
  const ids: string[] = [];
  try {
    const { data } = await db.from("jobs").insert([
      { org_id: DEMO_ORG, lead_id: leadId, kind: "followup", run_at: ENQ.toISOString(), idempotency_key: `test:${crypto.randomUUID()}`, payload: { n: 4 } },
      {
        org_id: DEMO_ORG,
        lead_id: null,
        kind: "followup",
        run_at: ENQ.toISOString(),
        idempotency_key: `test:${crypto.randomUUID()}`,
        payload: { n: 1, enquiry_at: ENQ.toISOString() },
      },
    ]).select("id");
    ids.push(...data!.map((r) => r.id));
    const provider = new FakeWhatsAppProvider();
    const summary = await run(provider, ENQ);
    assertEquals(summary.dead, 2);
    assertEquals(provider.sent.length, 0);
    const { data: rows } = await db.from("jobs").select("last_error").in("id", ids).order("last_error");
    assertEquals(rows!.map((r) => r.last_error), ["a followup job needs the job's lead_id", "invalid followup payload"]);
  } finally {
    await cleanup({ jobIds: ids, leadIds: [leadId] });
  }
});
