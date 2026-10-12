// The weekly report against the local database (spec 004, D.2).
//
// A test org gets three enquiries on Tuesday 2001-01-09 10:00 IST, in the
// week of Monday 8 January 2001 (IST). The cron's run is Monday 15 January
// 09:00 IST (03:30 UTC), which reports that week. Auto-replies came after 5,
// 10 and 20 seconds; staff replied to two leads, after 60 seconds and 2 hours.
//   lead count 3; auto-reply median 10 s, p90 18 s; human median 3630 s
//   (1h 1m, rounds from 60.5 min); within 1 hour 1 of 3 = 33.3 %.
// Email goes through an injected fetch: the real Resend API is never called.
// deno-lint-ignore no-import-prefix -- test-only std dep; no shared deno.json by design
import { assert, assertEquals, assertExists, assertStringIncludes } from "jsr:@std/assert@1";
import { renderWeeklySummary } from "../_shared/templates.ts";
import { FakeWhatsAppProvider } from "../_shared/whatsapp.ts";
import { weeklyEmailIdempotencyKey, weeklyReportIdempotencyKey } from "../_shared/weekly_report.ts";
import { runClaimedJobs } from "./index.ts";
import { db, dbTest, MIN, purgeTestJobs, uniquePhone } from "./testing.ts";

const CRON = new Date("2001-01-15T03:30:00.000Z"); // Monday 09:00 IST
const ENQ = new Date("2001-01-09T04:30:00.000Z"); // Tuesday 10:00 IST
const ISO_WEEK = "2001-W02";
const STUDIO = "Weekly Test Studio";
const at = (d: Date, plusMs = 0) => new Date(d.getTime() + plusMs);
const plusS = (s: number) => at(ENQ, s * 1000).toISOString();

type FetchCall = { url: string; headers: Headers; body: Record<string, unknown> };

/** A fetch that answers like Resend with the given status, recording every call. */
function resend(calls: FetchCall[], status = 200): typeof fetch {
  return (input, init) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body ?? "{}")),
    });
    const body = status === 200
      ? { id: `email-${calls.length}` }
      : { statusCode: status, name: "test_error", message: `failed with ${status}` };
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
}

const RESEND_ENV: Record<string, string> = { RESEND_API_KEY: "re_test_only", RESEND_FROM: "Flow <r@example.test>" };

function run(provider: FakeWhatsAppProvider, now: Date, env: Record<string, string>, fetchFn: typeof fetch) {
  return runClaimedJobs({ db, provider, now: () => now, env: (k) => env[k], fetch: fetchFn });
}

type Fixture = { orgId: string; phones: string[]; email: string; userId: string };

/** A fresh org with two owner phones, one owner (email) and one staff member, and its three leads. */
async function fixture(): Promise<Fixture> {
  const slug = `weekly-${crypto.randomUUID()}`;
  const phones = [uniquePhone().e164, uniquePhone().e164];
  const { data: org, error } = await db.from("orgs")
    .insert({ name: STUDIO, slug, owner_alert_phones: phones }).select("id").single();
  if (error) throw error;
  const email = `${slug}@example.test`;
  const owner = await db.auth.admin.createUser({ email, email_confirm: true });
  if (owner.error) throw owner.error;
  const staff = await db.auth.admin.createUser({ email: `staff-${slug}@example.test`, email_confirm: true });
  if (staff.error) throw staff.error;
  const members = await db.from("org_members").insert([
    { org_id: org.id, user_id: owner.data.user.id, role: "owner" },
    { org_id: org.id, user_id: staff.data.user.id, role: "staff" },
  ]);
  if (members.error) throw members.error;
  const leads = [[5, 60], [10, 7200], [20, null]].map(([auto, human], i) => ({
    org_id: org.id,
    name: `Weekly Lead ${i}`,
    phone_e164: uniquePhone().e164,
    consent_at: ENQ.toISOString(),
    created_at: ENQ.toISOString(),
    last_enquiry_at: ENQ.toISOString(),
    first_auto_reply_at: plusS(auto!),
    first_human_reply_at: human === null ? null : plusS(human),
  }));
  const ins = await db.from("leads").insert(leads);
  if (ins.error) throw ins.error;
  // The staff user is deleted with the owner in cleanup.
  return { orgId: org.id, phones, email, userId: `${owner.data.user.id},${staff.data.user.id}` };
}

async function cleanupFixture(f: Fixture) {
  await db.from("orgs").delete().eq("id", f.orgId); // cascades leads, jobs, messages, events
  for (const id of f.userId.split(",")) await db.auth.admin.deleteUser(id);
}

async function enqueue(orgId: string, asOf = CRON): Promise<string[]> {
  const { data, error } = await db.rpc("enqueue_weekly_reports", { p_as_of: asOf.toISOString(), p_org_id: orgId });
  if (error) throw error;
  return data;
}

async function jobsOf(orgId: string) {
  const { data, error } = await db.from("jobs").select("*").eq("org_id", orgId).order("created_at").order("id");
  if (error) throw error;
  return data;
}

async function eventTypes(orgId: string) {
  const { data, error } = await db.from("events").select("type, payload").eq("org_id", orgId).order("id");
  if (error) throw error;
  return data;
}

const EXPECTED_PARAMS = [STUDIO, "8–14 Jan 2001", "3", "10s", "18s", "1h 1m", "33.3%"];

dbTest("weekly report: one job per org, weekly_summary to each owner phone and an email to the owner; a re-run sends nothing", async () => {
  await purgeTestJobs();
  const f = await fixture();
  try {
    const queued = await enqueue(f.orgId);
    assertEquals(queued.length, 1);
    assertEquals(await enqueue(f.orgId), [], "re-running the cron for the same week queues nothing");
    const [job] = await jobsOf(f.orgId);
    assertEquals(job.kind, "weekly_report");
    assertEquals(job.idempotency_key, weeklyReportIdempotencyKey(f.orgId, ISO_WEEK));
    assertEquals(job.payload, { week_start: "2001-01-08", iso_week: ISO_WEEK });

    const provider = new FakeWhatsAppProvider();
    const calls: FetchCall[] = [];
    const summary = await run(provider, CRON, RESEND_ENV, resend(calls));
    // The report job, then the two WhatsApp sends it queued, in the same run.
    assertEquals(summary, { claimed: 3, done: 3, cancelled: 0, deferred: 0, retried: 0, dead: 0, lost: 0, errors: 0 });

    assertEquals(
      provider.sent.map((s) => [s.to, s.template, s.language, s.params]).sort(),
      f.phones.map((p) => [p, "weekly_summary", "en", EXPECTED_PARAMS]).sort(),
    );
    assertEquals(provider.sessions.length, 0);

    const { data: msgs } = await db.from("messages").select("*").eq("org_id", f.orgId).eq("template_name", "weekly_summary");
    assertEquals(msgs!.length, 2);
    for (const m of msgs!) {
      assertEquals([m.direction, m.kind, m.status, m.lead_id], ["outbound", "template", "sent", null]);
      assert(f.phones.includes(m.to_phone!));
    }

    assertEquals(calls.length, 1, "one email");
    assertEquals(calls[0].url, "https://api.resend.com/emails");
    assertEquals(calls[0].headers.get("authorization"), "Bearer re_test_only");
    assertEquals(calls[0].headers.get("idempotency-key"), weeklyEmailIdempotencyKey(f.orgId, ISO_WEEK));
    assertEquals(calls[0].body.to, [f.email], "owners only, not staff");
    assertEquals(calls[0].body.from, "Flow <r@example.test>");
    assertEquals(calls[0].body.subject, `Weekly enquiry report: ${STUDIO}, 8–14 Jan 2001`);
    assertStringIncludes(String(calls[0].body.text), "within 1 hour: 33.3% (1 of 3)");
    assertStringIncludes(String(calls[0].body.html), renderWeeklySummary(EXPECTED_PARAMS).replace(/&/g, "&amp;"));

    const types = (await eventTypes(f.orgId)).map((e) => e.type);
    assertEquals(types.filter((t) => t === "weekly_summary_sent").length, 2);
    assertEquals(types.filter((t) => t === "weekly_email_sent").length, 1);
    assertEquals(types.filter((t) => t === "weekly_report_queued").length, 1);

    // Again a minute later: nothing due, nothing sent.
    assertEquals((await run(provider, at(CRON, MIN), RESEND_ENV, resend(calls))).claimed, 0);

    // Even if the report job itself runs again (re-queued by hand), it sends nothing new:
    // the WhatsApp sends are keyed per phone and the email is recorded for the week.
    await db.from("jobs").update({ status: "queued", attempts: 0 }).eq("id", job.id);
    const again = await run(provider, at(CRON, 2 * MIN), RESEND_ENV, resend(calls));
    assertEquals([again.claimed, again.done], [1, 1]);
    assertEquals(provider.sent.length, 2, "no second WhatsApp send");
    assertEquals(calls.length, 1, "no second email");
    assertEquals((await jobsOf(f.orgId)).length, 3, "no new send jobs");
  } finally {
    await cleanupFixture(f);
  }
});

dbTest("weekly report: an email failure does not block the WhatsApp send; the email is retried alone", async () => {
  await purgeTestJobs();
  const f = await fixture();
  try {
    await enqueue(f.orgId);
    const provider = new FakeWhatsAppProvider();
    const calls: FetchCall[] = [];
    const first = await run(provider, CRON, RESEND_ENV, resend(calls, 503));
    assertEquals([first.claimed, first.done, first.retried], [3, 2, 1]);
    assertEquals(provider.sent.length, 2, "WhatsApp went out to both owner phones");
    assertEquals(calls.length, 1);

    const report = (await jobsOf(f.orgId)).find((j) => j.kind === "weekly_report")!;
    assertEquals(report.status, "queued");
    assertStringIncludes(report.last_error!, "resend returned 503");
    assertEquals(new Date(report.run_at).getTime(), at(CRON, MIN).getTime(), "backoff: 1 minute");
    const failed = (await eventTypes(f.orgId)).filter((e) => e.type === "weekly_email_failed");
    assertEquals(failed.length, 1);
    assertEquals((failed[0].payload as { permanent: boolean }).permanent, false);

    // Resend is back: the retry sends the email and nothing else.
    const second = await run(provider, at(CRON, MIN), RESEND_ENV, resend(calls));
    assertEquals([second.claimed, second.done], [1, 1]);
    assertEquals(provider.sent.length, 2, "no WhatsApp resend");
    assertEquals(calls.length, 2);
    assertEquals(calls[0].headers.get("idempotency-key"), calls[1].headers.get("idempotency-key"));
    assertEquals((await jobsOf(f.orgId)).every((j) => j.status === "done"), true);
  } finally {
    await cleanupFixture(f);
  }
});

dbTest("weekly report: a permanent email error (422) dead-letters the report job after the WhatsApp sends", async () => {
  await purgeTestJobs();
  const f = await fixture();
  try {
    await enqueue(f.orgId);
    const provider = new FakeWhatsAppProvider();
    const calls: FetchCall[] = [];
    const s = await run(provider, CRON, RESEND_ENV, resend(calls, 422));
    assertEquals([s.claimed, s.done, s.dead], [3, 2, 1]);
    assertEquals(provider.sent.filter((x) => x.template === "weekly_summary").length, 2);
    const report = (await jobsOf(f.orgId)).find((j) => j.kind === "weekly_report")!;
    assertEquals(report.status, "dead");
    const types = (await eventTypes(f.orgId)).map((e) => e.type);
    assert(types.includes("weekly_email_failed"));
    assert(types.includes("job_dead"));
    assert(types.includes("ops_alert_skipped"), "ops alert attempted (OPS_ALERT_PHONE unset here)");
  } finally {
    await cleanupFixture(f);
  }
});

dbTest("weekly report: without RESEND_API_KEY no email is attempted and WhatsApp still goes out", async () => {
  await purgeTestJobs();
  const f = await fixture();
  try {
    await enqueue(f.orgId);
    const provider = new FakeWhatsAppProvider();
    const calls: FetchCall[] = [];
    const s = await run(provider, CRON, {}, resend(calls));
    assertEquals([s.claimed, s.done], [3, 3]);
    assertEquals(calls.length, 0, "no request to Resend");
    assertEquals(provider.sent.length, 2);
    const skipped = (await eventTypes(f.orgId)).filter((e) => e.type === "weekly_email_skipped");
    assertEquals(skipped.length, 1);
    assertEquals((skipped[0].payload as { reason: string }).reason, "RESEND_API_KEY is not set");
  } finally {
    await cleanupFixture(f);
  }
});

dbTest("weekly report: a week without enquiries still reports zeros; an owner phone removed before the send is skipped", async () => {
  await purgeTestJobs();
  const f = await fixture();
  try {
    // The following week (8 days later) has no enquiries.
    const next = at(CRON, 7 * 24 * 60 * MIN);
    assertEquals((await enqueue(f.orgId, next)).length, 1);
    const provider = new FakeWhatsAppProvider();
    // Run the report job; hold its sends back a minute so the org can change in between.
    const one = await runClaimedJobs(
      {
        db,
        provider,
        now: () => next,
        env: () => undefined,
        fetch: resend([]),
        handlers: { send_message: () => Promise.resolve({ status: "deferred", runAt: at(next, MIN), reason: "test" }) },
      },
      { batchSize: 10 },
    );
    assertEquals(one.done, 1, "the report job");
    // An owner phone is removed before its send runs.
    await db.from("orgs").update({ owner_alert_phones: [f.phones[0]] }).eq("id", f.orgId);
    const sends = await run(provider, at(next, MIN), {}, resend([]));
    assertEquals([sends.claimed, sends.done, sends.cancelled], [2, 1, 1]);
    assertEquals(provider.sent.map((s) => [s.to, s.params]), [
      [f.phones[0], [STUDIO, "15–21 Jan 2001", "0", "n/a", "n/a", "n/a", "n/a"]],
    ]);
  } finally {
    await cleanupFixture(f);
  }
});

dbTest("weekly report: a bad payload dead-letters at once", async () => {
  await purgeTestJobs();
  const f = await fixture();
  try {
    const [id] = await enqueue(f.orgId);
    assertExists(id);
    await db.from("jobs").update({ payload: { week_start: "2001-01-09", iso_week: ISO_WEEK } }).eq("id", id);
    const provider = new FakeWhatsAppProvider();
    const s = await run(provider, CRON, {}, resend([]));
    assertEquals([s.claimed, s.dead], [1, 1]);
    const [job] = await jobsOf(f.orgId);
    assertStringIncludes(job.last_error!, "invalid weekly_report payload");
    assertEquals(provider.sent.length, 0);
  } finally {
    await cleanupFixture(f);
  }
});
