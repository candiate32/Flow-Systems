// deno-lint-ignore no-import-prefix -- test-only std dep; no shared deno.json by design
import { assert, assertEquals, assertExists, assertMatch } from "jsr:@std/assert@1";
// deno-lint-ignore no-import-prefix -- see index.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import type { Database } from "../_shared/database.types.ts";
import { followUpIdempotencyKey, followUpTimes, scheduleFollowUps } from "../_shared/followups.ts";
import { handler as ingest } from "../ingest-form/index.ts";
import { runClaimedJobs } from "../run-jobs/index.ts";
import { renderInboundAck } from "../_shared/templates.ts";
import { FakeWhatsAppProvider, type TemplateMessage, type WhatsAppProvider } from "../_shared/whatsapp.ts";
import { FAKE_SIGNATURE_HEADER, FakeWebhookAdapter, signFakeWebhook } from "../_shared/whatsapp_webhook.ts";
import { type Deps, handler, MAX_PROCESSING_ATTEMPTS } from "./index.ts";

// Database tests run against the local stack, as in ingest-form: set
// SUPABASE_SERVICE_ROLE_KEY (and SUPABASE_URL) to run them.
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const NO_DB = !SERVICE_KEY;

const SECRET = "whatsapp-webhook-test-secret";
const DEMO_ORG = "00000000-0000-4000-8000-000000000001";
const DEMO_ORG_NAME = "Lime & Lattice, Sarjapur Road";
const DEMO_OWNER = "+919000000001";
const SOURCE_KEY = "demo-whatsapp-inbound";
const DEMO_WA_SOURCE = "00000000-0000-4000-8000-000000000102";
/** Event times in 2031: far from real jobs, so nothing here is claimed by a real runner. */
const T = new Date("2031-03-03T05:00:00.000Z");
const MIN = 60_000;
/** Marks this run's provider event ids, for cleanup. */
const RUN = `wh-test-${crypto.randomUUID().slice(0, 8)}`;

const noDb = new Proxy({}, {
  get() {
    throw new Error("handler should not touch the database here");
  },
}) as Deps["db"];

const db: Deps["db"] = NO_DB ? noDb : createClient<Database>(SUPABASE_URL, SERVICE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const dbTest = (name: string, fn: () => Promise<void>) =>
  Deno.test({ name, ignore: NO_DB, sanitizeOps: false, sanitizeResources: false, fn });

let n = 0;
const eventId = (label: string) => `${RUN}-${label}-${++n}`;

function uniquePhone(): string {
  const digits = Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b % 10).join("");
  return `+917${digits}`;
}

type FakeEvent = { id: string; message_id: string; text?: string } & Record<string, unknown>;
const inbound = (phone: string, text: string, at: Date, extra: Record<string, unknown> = {}): FakeEvent => ({
  id: eventId("in"),
  kind: "inbound",
  phone,
  text,
  at: at.toISOString(),
  message_id: `${RUN}-msg-${++n}`,
  ...extra,
});
const echo = (phone: string, text: string, at: Date): FakeEvent => ({
  id: eventId("echo"),
  kind: "echo",
  phone,
  text,
  at: at.toISOString(),
  message_id: `${RUN}-echo-${++n}`,
});
const status = (messageId: string, s: string, at: Date, error?: string): FakeEvent => ({
  id: eventId(`st-${s}`),
  kind: "status",
  message_id: messageId,
  status: s,
  at: at.toISOString(),
  ...(error ? { error } : {}),
});

async function signed(body: string, opts: { source?: string | null; secret?: string } = {}): Promise<Request> {
  const source = opts.source === undefined ? SOURCE_KEY : opts.source;
  const url = `http://localhost/functions/v1/whatsapp-webhook${source === null ? "" : `?source=${encodeURIComponent(source)}`}`;
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [FAKE_SIGNATURE_HEADER]: await signFakeWebhook(body, opts.secret ?? SECRET),
    },
    body,
  });
}

function deps(over: Partial<Deps> = {}): Deps & { provider: WhatsAppProvider } {
  return {
    db,
    adapter: new FakeWebhookAdapter(SECRET),
    provider: new FakeWhatsAppProvider(),
    now: () => new Date(T.getTime() + 2_000),
    ...over,
  };
}

async function post(d: Deps, events: FakeEvent[], opts: { source?: string | null } = {}) {
  const res = await handler(await signed(JSON.stringify({ events }), opts), d);
  return { status: res.status, body: await res.json() };
}

/** A consenting lead in the demo org, as a form enquiry at `at` would leave it. */
async function insertLead(phone: string, at: Date): Promise<string> {
  const { data, error } = await db.from("leads").insert({
    org_id: DEMO_ORG,
    name: "Webhook Test",
    phone_e164: phone,
    consent_at: at.toISOString(),
    last_enquiry_at: at.toISOString(),
  }).select("id").single();
  if (error) throw error;
  return data.id;
}

async function lead(phone: string) {
  const { data, error } = await db.from("leads").select("*").eq("org_id", DEMO_ORG).eq("phone_e164", phone).maybeSingle();
  if (error) throw error;
  return data;
}

async function queuedFollowUps(leadId: string) {
  const { data, error } = await db.from("jobs").select("id, status, idempotency_key")
    .eq("lead_id", leadId).eq("kind", "followup").order("run_at");
  if (error) throw error;
  return data;
}

async function webhookRow(providerEventId: string) {
  const { data, error } = await db.from("webhook_events").select("*").eq("provider", "fake")
    .eq("provider_event_id", providerEventId).maybeSingle();
  if (error) throw error;
  return data;
}

/** Counts of everything a delivery could change for a lead. */
async function snapshot(leadId: string) {
  const count = async (table: "messages" | "events" | "jobs") => {
    const { count, error } = await db.from(table).select("*", { count: "exact", head: true }).eq("lead_id", leadId);
    if (error) throw error;
    return count;
  };
  const { data: l } = await db.from("leads").select("*").eq("id", leadId).single();
  return { messages: await count("messages"), events: await count("events"), jobs: await count("jobs"), lead: l };
}

const cleanupLeads: string[] = [];
const cleanupProviderIds: string[] = [];

/** Deletes this run's leads (cascading their messages, events, jobs), owner alerts and webhook rows. */
async function cleanup() {
  if (cleanupProviderIds.length) await db.from("messages").delete().in("provider_message_id", cleanupProviderIds);
  if (cleanupLeads.length) await db.from("leads").delete().in("id", cleanupLeads);
  await db.from("webhook_events").delete().like("provider_event_id", `${RUN}%`);
  await db.from("webhook_events").delete().like("payload->>body", `%${RUN}%`);
}

// --- Without a database -----------------------------------------------------------

Deno.test("a bad or missing signature gets 401 before anything is stored", async () => {
  const body = JSON.stringify({ events: [inbound("+919845012345", "hi", T)] });
  const d = deps({ db: noDb });
  for (const req of [
    await signed(body, { secret: "wrong" }),
    new Request("http://localhost/?source=x", { method: "POST", body }),
    new Request("http://localhost/?source=x", { method: "POST", body, headers: { [FAKE_SIGNATURE_HEADER]: "00" } }),
  ]) {
    const res = await handler(req, d);
    assertEquals(res.status, 401);
    await res.body?.cancel();
  }
});

Deno.test("with no WHATSAPP_WEBHOOK_SECRET every request gets 401", async () => {
  const res = await handler(await signed('{"events":[]}'), deps({ db: noDb, adapter: new FakeWebhookAdapter(undefined) }));
  assertEquals(res.status, 401);
  await res.body?.cancel();
});

Deno.test("non-POST methods get 405", async () => {
  for (const method of ["GET", "PUT", "DELETE"]) {
    const res = await handler(new Request("http://localhost/?source=x", { method }), deps({ db: noDb }));
    assertEquals(res.status, 405, method);
    await res.body?.cancel();
  }
});

Deno.test("a signed empty batch is answered 200 without touching the database", async () => {
  const res = await post(deps({ db: noDb }), []);
  assertEquals(res.status, 200);
  assertEquals(res.body.received, 0);
});

// --- Against the database ----------------------------------------------------------

dbTest("inbound from an unknown number creates a lead, acknowledges it, alerts the owner and schedules follow-ups", async () => {
  const phone = uniquePhone();
  const provider = new FakeWhatsAppProvider();
  const d = deps({ provider });
  const ev = inbound(phone, "Hi, I'm looking for 3BHK interiors", T, { profile_name: "Ravi Kumar" });
  try {
    const res = await post(d, [ev]);
    assertEquals(res.status, 200);
    assertEquals(res.body, { received: 1, processed: 1, ignored: 0, duplicates: 0, failed: 0, dead: 0 });

    const l = await lead(phone);
    assertExists(l);
    cleanupLeads.push(l.id);
    cleanupProviderIds.push(...provider.sent.map((s) => s.providerMessageId));
    assertEquals(l.name, "Ravi Kumar");
    assertEquals(l.source_id, DEMO_WA_SOURCE);
    assertEquals(new Date(l.consent_at).toISOString(), T.toISOString(), "consent_at is the inbound time");
    assertEquals(new Date(l.last_inbound_at!).toISOString(), T.toISOString());
    assertEquals(new Date(l.last_enquiry_at).toISOString(), T.toISOString());
    assertEquals(new Date(l.first_auto_reply_at!).toISOString(), d.now().toISOString());

    // The acknowledgement: a session message inside the window just opened.
    assertEquals(provider.sessions.length, 1);
    assertEquals(provider.sessions[0].to, phone);
    assertEquals(provider.sessions[0].text, renderInboundAck(["Ravi", DEMO_ORG_NAME]));
    // The owner alert: the template, as for a form enquiry.
    assertEquals(provider.sent.map((s) => [s.template, s.to, s.params]), [
      ["owner_alert", DEMO_OWNER, ["Ravi Kumar", phone, "-", "-"]],
    ]);

    const { data: msgs } = await db.from("messages").select("direction, kind, body, status, provider_message_id")
      .eq("lead_id", l.id).order("created_at");
    assertEquals(msgs, [
      { direction: "inbound", kind: "session", body: ev.text!, status: "delivered", provider_message_id: ev.message_id },
      {
        direction: "outbound",
        kind: "session",
        body: provider.sessions[0].text,
        status: "sent",
        provider_message_id: provider.sessions[0].providerMessageId,
      },
    ]);
    const { data: alert } = await db.from("messages").select("lead_id, to_phone, template_name, status")
      .eq("provider_message_id", provider.sent[0].providerMessageId).single();
    assertEquals(alert, { lead_id: null, to_phone: DEMO_OWNER, template_name: "owner_alert", status: "sent" });

    // Follow-ups on day 1, 3 and 7 from the inbound time.
    const jobs = await queuedFollowUps(l.id);
    assertEquals(jobs.map((j) => [j.status, j.idempotency_key]), [1, 2, 3].map((k) => [
      "queued",
      followUpIdempotencyKey(l.id, k as 1 | 2 | 3, T),
    ]));

    const { data: events } = await db.from("events").select("type").eq("lead_id", l.id).order("id");
    assertEquals(new Set(events!.map((e) => e.type)), new Set(["lead_created", "inbound_received", "ack_sent", "owner_alert_sent", "followups_scheduled"]));

    const row = await webhookRow(ev.id);
    assertExists(row?.processed_at);
    assertEquals([row.kind, row.org_id, row.lead_id, row.attempts, row.processing_error], ["inbound", DEMO_ORG, l.id, 1, null]);
    assertEquals(row.payload as unknown, ev, "the raw event is stored");
  } finally {
    await cleanup();
  }
});

dbTest("a replayed delivery returns 200 and changes nothing", async () => {
  const phone = uniquePhone();
  const provider = new FakeWhatsAppProvider();
  const ev = inbound(phone, "Hello", T, { profile_name: "Asha" });
  const body = JSON.stringify({ events: [ev] });
  try {
    const first = await handler(await signed(body), deps({ provider }));
    assertEquals(first.status, 200);
    await first.body?.cancel();
    const l = await lead(phone);
    cleanupLeads.push(l!.id);
    cleanupProviderIds.push(...provider.sent.map((s) => s.providerMessageId));
    const before = await snapshot(l!.id);
    const rowBefore = await webhookRow(ev.id);

    const replayProvider = new FakeWhatsAppProvider();
    const again = await handler(await signed(body), deps({ provider: replayProvider, now: () => new Date(T.getTime() + 60 * MIN) }));
    assertEquals(again.status, 200);
    assertEquals((await again.json()).duplicates, 1);
    assertEquals(replayProvider.sent.length + replayProvider.sessions.length, 0, "nothing sent again");
    assertEquals(await snapshot(l!.id), before, "no row of the lead changed");
    assertEquals(await webhookRow(ev.id), rowBefore, "the webhook row is unchanged");
    const { count } = await db.from("leads").select("*", { count: "exact", head: true }).eq("phone_e164", phone);
    assertEquals(count, 1);
  } finally {
    await cleanup();
  }
});

dbTest("inbound from a known lead stores the message, sets last_inbound_at and cancels follow-ups, sending nothing", async () => {
  const phone = uniquePhone();
  const leadId = await insertLead(phone, T);
  cleanupLeads.push(leadId);
  const provider = new FakeWhatsAppProvider();
  try {
    await scheduleFollowUps(db, leadId, T, T);
    const at = new Date(T.getTime() + 30 * MIN);
    const ev = inbound(`0${phone.slice(3)}`, "Can we talk tomorrow?", at); // written as the provider might: 0 + national
    const res = await post(deps({ provider }), [ev]);
    assertEquals(res.status, 200);
    assertEquals(provider.sent.length + provider.sessions.length, 0, "no ack or alert for a known lead");

    const l = await lead(phone);
    assertEquals(new Date(l!.last_inbound_at!).toISOString(), at.toISOString());
    assertEquals((await queuedFollowUps(leadId)).map((j) => j.status), ["cancelled", "cancelled", "cancelled"]);
    const { data: m } = await db.from("messages").select("direction, kind, body").eq("provider_message_id", ev.message_id).single();
    assertEquals(m, { direction: "inbound", kind: "session", body: "Can we talk tomorrow?" });
    const { data: ev2 } = await db.from("events").select("payload").eq("lead_id", leadId).eq("type", "job_cancelled");
    assertEquals(ev2!.map((e) => (e.payload as { reason: string }).reason), ["lead replied", "lead replied", "lead replied"]);
  } finally {
    await cleanup();
  }
});

dbTest("an opt-out sets opted_out_at, cancels follow-ups and sends nothing", async () => {
  const phone = uniquePhone();
  const leadId = await insertLead(phone, T);
  cleanupLeads.push(leadId);
  const provider = new FakeWhatsAppProvider();
  try {
    await scheduleFollowUps(db, leadId, T, T);
    const at = new Date(T.getTime() + 5 * MIN);
    const res = await post(deps({ provider }), [inbound(phone, " Stop. ", at)]);
    assertEquals(res.status, 200);
    const l = await lead(phone);
    assertEquals(new Date(l!.opted_out_at!).toISOString(), at.toISOString());
    assertEquals((await queuedFollowUps(leadId)).map((j) => j.status), ["cancelled", "cancelled", "cancelled"]);
    assertEquals(provider.sent.length + provider.sessions.length, 0, "no confirmation or anything else");
    const { count } = await db.from("events").select("*", { count: "exact", head: true }).eq("lead_id", leadId).eq("type", "lead_opted_out");
    assertEquals(count, 1);
  } finally {
    await cleanup();
  }
});

dbTest("a first message that is STOP records the lead as opted out and sends nothing", async () => {
  const phone = uniquePhone();
  const provider = new FakeWhatsAppProvider();
  try {
    const res = await post(deps({ provider }), [inbound(phone, "UNSUBSCRIBE", T)]);
    assertEquals(res.status, 200);
    const l = await lead(phone);
    assertExists(l);
    cleanupLeads.push(l.id);
    assertExists(l.opted_out_at);
    assertEquals(l.first_auto_reply_at, null);
    assertEquals(provider.sent.length + provider.sessions.length, 0);
    assertEquals(await queuedFollowUps(l.id), [], "no follow-ups scheduled");
  } finally {
    await cleanup();
  }
});

dbTest("an echo stores the staff reply, sets first_human_reply_at once and cancels follow-ups", async () => {
  const phone = uniquePhone();
  const leadId = await insertLead(phone, T);
  cleanupLeads.push(leadId);
  try {
    await scheduleFollowUps(db, leadId, T, T);
    const first = new Date(T.getTime() + 10 * MIN);
    const e1 = echo(phone, "Hi! Our designer will call you at 4", first);
    const e2 = echo(phone, "Calling now", new Date(T.getTime() + 20 * MIN));
    const res = await post(deps(), [e1, e2]);
    assertEquals(res.status, 200);
    assertEquals(res.body.processed, 2);
    const l = await lead(phone);
    assertEquals(new Date(l!.first_human_reply_at!).toISOString(), first.toISOString());
    assertEquals((await queuedFollowUps(leadId)).map((j) => j.status), ["cancelled", "cancelled", "cancelled"]);
    const { data: msgs } = await db.from("messages").select("direction, to_phone, body").eq("lead_id", leadId).order("sent_at");
    assertEquals(msgs, [
      { direction: "echo", to_phone: phone, body: e1.text! },
      { direction: "echo", to_phone: phone, body: e2.text! },
    ]);
  } finally {
    await cleanup();
  }
});

dbTest("statuses move a message forward only, in any arrival order, and failed keeps its error", async () => {
  const phone = uniquePhone();
  const leadId = await insertLead(phone, T);
  cleanupLeads.push(leadId);
  const a = `${RUN}-out-a`;
  const b = `${RUN}-out-b`;
  try {
    const { error } = await db.from("messages").insert([a, b].map((id) => ({
      org_id: DEMO_ORG,
      lead_id: leadId,
      to_phone: phone,
      direction: "outbound",
      kind: "template",
      template_name: "enquiry_ack",
      provider: "fake",
      provider_message_id: id,
      status: "sent",
    })));
    if (error) throw error;
    const statusOf = async (id: string) =>
      (await db.from("messages").select("status, error").eq("provider_message_id", id).single()).data;

    // read arrives before delivered (Meta doesn't promise order).
    let res = await post(deps(), [status(a, "read", new Date(T.getTime() + 2 * MIN)), status(a, "delivered", new Date(T.getTime() + MIN))]);
    assertEquals(res.status, 200);
    assertEquals(await statusOf(a), { status: "read", error: null });
    res = await post(deps(), [status(a, "sent", T)]);
    assertEquals(await statusOf(a), { status: "read", error: null }, "never backwards");

    res = await post(deps(), [status(b, "failed", T, "131047 Re-engagement message")]);
    assertEquals(res.status, 200);
    assertEquals(await statusOf(b), { status: "failed", error: "131047 Re-engagement message" });

    // A receipt for a message we don't know (e.g. sent from the phone app) is ignored, not retried.
    res = await post(deps(), [status(`${RUN}-unknown`, "delivered", T)]);
    assertEquals(res.status, 200);
    assertEquals(res.body.ignored, 1);
  } finally {
    await db.from("messages").delete().in("provider_message_id", [a, b]);
    await cleanup();
  }
});

dbTest("an unknown or missing source gets 404 and leaves the stored events unprocessed", async () => {
  const phone = uniquePhone();
  try {
    for (const source of ["no-such-source", "demo-web-form", null]) {
      const ev = inbound(phone, "hi", T);
      const res = await post(deps(), [ev], { source });
      assertEquals(res.status, 404, String(source));
      const row = await webhookRow(ev.id);
      assertExists(row, "stored before routing");
      assertEquals(row.processed_at, null);
      assertMatch(row.processing_error ?? "", source ? /unknown whatsapp_inbound source/ : /no \?source=/);
    }
    assertEquals(await lead(phone), null, "no lead created");
  } finally {
    await cleanup();
  }
});

dbTest("a signed payload that doesn't parse is stored once and answered 200", async () => {
  const body = JSON.stringify({ hello: RUN });
  try {
    for (let i = 0; i < 2; i++) {
      const res = await handler(await signed(body), deps());
      assertEquals(res.status, 200);
      assertEquals((await res.json()).invalid, true);
    }
    const { data } = await db.from("webhook_events").select("kind, processed_at, processing_error, payload")
      .like("payload->>body", `%${RUN}%`);
    assertEquals(data!.length, 1);
    assertEquals(data![0].kind, "invalid");
    assertEquals(data![0].processed_at, null);
    assertExists(data![0].processing_error);
  } finally {
    await cleanup();
  }
});

dbTest("a number that is not an Indian mobile is recorded and ignored", async () => {
  const provider = new FakeWhatsAppProvider();
  try {
    const ev = inbound("+14155550100", "hi", T);
    const res = await post(deps({ provider }), [ev]);
    assertEquals(res.status, 200);
    assertEquals(res.body.ignored, 1);
    assertEquals(provider.sessions.length, 0);
    const row = await webhookRow(ev.id);
    assertExists(row?.processed_at);
    assertEquals((row.result as { reason: string }).reason, "phone is not a supported mobile number");
  } finally {
    await cleanup();
  }
});

/** Makes the process_whatsapp_event call fail for chosen webhook event ids. */
function failingDb(shouldFail: (providerEventId: string) => boolean, rowIds: Map<number, string>): Deps["db"] {
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "rpc") {
        return async (fn: string, args: { p_webhook_event_id: number }) => {
          if (fn === "process_whatsapp_event") {
            if (!rowIds.has(args.p_webhook_event_id)) {
              const { data } = await db.from("webhook_events").select("provider_event_id").eq("id", args.p_webhook_event_id).single();
              rowIds.set(args.p_webhook_event_id, data!.provider_event_id);
            }
            if (shouldFail(rowIds.get(args.p_webhook_event_id)!)) {
              return { data: null, error: { message: "connection reset (test)", code: "08006" } };
            }
          }
          // deno-lint-ignore no-explicit-any
          return (target.rpc as any)(fn, args);
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

dbTest("one failing event: the rest are processed, the provider is asked to redeliver, and the replay finishes the job", async () => {
  const phone = uniquePhone();
  const leadId = await insertLead(phone, T);
  cleanupLeads.push(leadId);
  try {
    const bad = inbound(phone, "first", new Date(T.getTime() + MIN));
    const good = echo(phone, "staff reply", new Date(T.getTime() + 2 * MIN));
    const body = JSON.stringify({ events: [bad, good] });
    let fail = true;
    const d = deps({ db: failingDb((id) => fail && id === bad.id, new Map()) });

    const res = await handler(await signed(body), d);
    assertEquals(res.status, 500, "a retryable failure asks the provider to resend");
    assertEquals((await res.json()).processed, 1);
    const badRow = await webhookRow(bad.id);
    assertEquals([badRow!.processed_at, badRow!.attempts, badRow!.processing_error?.includes("connection reset")], [null, 1, true]);
    assertExists((await webhookRow(good.id))?.processed_at, "the other event was processed");
    assertExists((await lead(phone))!.first_human_reply_at);

    fail = false;
    const replay = await handler(await signed(body), d);
    assertEquals(replay.status, 200);
    assertEquals((await replay.json()), { received: 2, processed: 1, ignored: 0, duplicates: 1, failed: 0, dead: 0 });
    const done = await webhookRow(bad.id);
    assertExists(done?.processed_at);
    assertEquals([done.attempts, done.processing_error], [2, null]);
    const { count } = await db.from("messages").select("*", { count: "exact", head: true }).eq("lead_id", leadId);
    assertEquals(count, 2, "one inbound and one echo, nothing twice");
  } finally {
    await cleanup();
  }
});

dbTest(`an event that fails ${MAX_PROCESSING_ATTEMPTS} times is left as a dead letter and the provider gets 200`, async () => {
  const phone = uniquePhone();
  const leadId = await insertLead(phone, T);
  cleanupLeads.push(leadId);
  try {
    const ev = inbound(phone, "poison", T);
    const body = JSON.stringify({ events: [ev] });
    const provider = new FakeWhatsAppProvider();
    const env = (k: string) => (k === "OPS_ALERT_PHONE" ? "+91 90000 00099" : undefined);
    const d = deps({ db: failingDb((id) => id === ev.id, new Map()), provider, env });
    const codes: number[] = [];
    for (let i = 0; i < MAX_PROCESSING_ATTEMPTS + 1; i++) {
      const res = await handler(await signed(body), d);
      codes.push(res.status);
      await res.body?.cancel();
    }
    assertEquals(codes, [...Array(MAX_PROCESSING_ATTEMPTS - 1).fill(500), 200, 200]);
    const row = await webhookRow(ev.id);
    assertEquals([row!.processed_at, row!.attempts], [null, MAX_PROCESSING_ATTEMPTS], "no attempt after the last");
    const { data: dead } = await db.from("events").select("payload").eq("org_id", DEMO_ORG).eq("type", "webhook_event_failed")
      .eq("payload->>provider_event_id", ev.id);
    assertEquals(dead!.length, 1, "one dead-letter event");

    // Ops hear about it once: a real customer's message may be stuck.
    assertEquals(provider.sent.map((s) => [s.template, s.to, s.params.slice(0, 3)]), [
      ["ops_alert", "+919000000099", ["webhook_event", ev.id, String(MAX_PROCESSING_ATTEMPTS)]],
    ]);
    assertMatch(provider.sent[0].params[3], /connection reset/);
    const { data: alerts } = await db.from("events").select("type, payload").eq("org_id", DEMO_ORG)
      .like("type", "ops_alert_%").eq("payload->>webhook_event_id", String(row!.id));
    assertEquals(alerts!.map((a) => a.type), ["ops_alert_sent"]);
    await db.from("events").delete().eq("type", "webhook_event_failed").eq("payload->>provider_event_id", ev.id);
    await db.from("events").delete().like("type", "ops_alert_%").eq("payload->>webhook_event_id", String(row!.id));
  } finally {
    await cleanup();
  }
});

/** Fails every send, like a provider outage. */
class DownProvider implements WhatsAppProvider {
  readonly name = "fake";
  sendTemplate(_: TemplateMessage): Promise<{ providerMessageId: string }> {
    return Promise.reject(new Error(`provider down (${RUN})`));
  }
  sendSession(): Promise<{ providerMessageId: string }> {
    return Promise.reject(new Error(`provider down (${RUN})`));
  }
}

dbTest("when the provider is down, the ack and owner alerts are queued as retry jobs", async () => {
  const phone = uniquePhone();
  try {
    const res = await post(deps({ provider: new DownProvider() }), [inbound(phone, "hi", T, { profile_name: "Meera" })]);
    assertEquals(res.status, 200, "the inbound itself was recorded");
    const l = await lead(phone);
    assertExists(l);
    cleanupLeads.push(l.id);
    assertEquals(l.first_auto_reply_at, null);
    const { data: jobs } = await db.from("jobs").select("kind, status, idempotency_key, payload")
      .eq("lead_id", l.id).eq("kind", "send_message").order("idempotency_key");
    assertEquals(jobs!.map((j) => [j.idempotency_key, (j.payload as { template: string }).template]), [
      [`ack:${l.id}:${T.toISOString()}`, "enquiry_ack"],
      [`owner_alert:${l.id}:${T.toISOString()}:${DEMO_OWNER}`, "owner_alert"],
    ]);
    assertEquals((jobs![0].payload as { params: string[]; first_auto_reply: boolean }).params, ["Meera", DEMO_ORG_NAME]);
    assertEquals((jobs![0].payload as { first_auto_reply: boolean }).first_auto_reply, true);
    assertEquals((await queuedFollowUps(l.id)).length, 3, "follow-ups are still scheduled");
  } finally {
    await db.from("messages").delete().like("error", `%${RUN}%`);
    await cleanup();
  }
});

dbTest("two deliveries of the same new number at once create one lead and one acknowledgement", async () => {
  const phone = uniquePhone();
  const provider = new FakeWhatsAppProvider();
  const ev = inbound(phone, "Hello?", T);
  const body = JSON.stringify({ events: [ev] });
  try {
    const results = await Promise.all([0, 1, 2].map(async () => {
      const res = await handler(await signed(body), deps({ provider }));
      return { status: res.status, body: await res.json() };
    }));
    assert(results.every((r) => r.status === 200), JSON.stringify(results));
    const l = await lead(phone);
    cleanupLeads.push(l!.id);
    cleanupProviderIds.push(...provider.sent.map((s) => s.providerMessageId));
    assertEquals(provider.sessions.length, 1, "one acknowledgement");
    assertEquals(provider.sent.length, 1, "one owner alert");
    assertEquals(results.reduce((s, r) => s + r.body.processed, 0), 1);
  } finally {
    await cleanup();
  }
});

// --- The 24-hour window for the acknowledgement ----------------------------------

const H = 60 * MIN;
for (
  const [label, ageMs, mode] of [
    ["23:59", 24 * H - MIN, "session"],
    ["24:01", 24 * H + MIN, "template"],
  ] as const
) {
  dbTest(`a new number's message that is ${label} old when it arrives gets a ${mode} acknowledgement`, async () => {
    const phone = uniquePhone();
    const provider = new FakeWhatsAppProvider();
    const now = new Date(T.getTime() + ageMs);
    try {
      const res = await post(deps({ provider, now: () => now }), [inbound(phone, "Hi", T, { profile_name: "Kavya" })]);
      assertEquals(res.status, 200);
      const l = await lead(phone);
      assertExists(l);
      cleanupLeads.push(l.id);
      cleanupProviderIds.push(...provider.sent.map((s) => s.providerMessageId));

      const { data: acks } = await db.from("messages").select("kind, template_name, body, status")
        .eq("lead_id", l.id).eq("direction", "outbound");
      if (mode === "session") {
        assertEquals(provider.sessions.map((s) => [s.to, s.text]), [[phone, renderInboundAck(["Kavya", DEMO_ORG_NAME])]]);
        assertEquals(provider.sent.map((s) => s.template), ["owner_alert"]);
        assertEquals(acks, [{ kind: "session", template_name: null, body: provider.sessions[0].text, status: "sent" }]);
      } else {
        assertEquals(provider.sessions, [], "no free-form text outside the window");
        assertEquals(
          provider.sent.filter((s) => s.to === phone).map((s) => [s.template, s.params]),
          [["enquiry_ack", ["Kavya", DEMO_ORG_NAME]]],
        );
        assertEquals(acks, [{ kind: "template", template_name: "enquiry_ack", body: null, status: "sent" }]);
      }
      // Set either way: a late ack is a slow reply, not no reply.
      assertEquals(new Date(l.first_auto_reply_at!).toISOString(), now.toISOString());
      const { data: ev } = await db.from("events").select("payload").eq("lead_id", l.id).eq("type", "ack_sent").single();
      assertEquals((ev!.payload as { mode: string }).mode, mode);
    } finally {
      await cleanup();
    }
  });
}

// --- A staff reply after a repeat enquiry stops that enquiry's follow-ups ----------

dbTest("an echo after a repeat enquiry stops a follow-up that was already running", async () => {
  // In 2001, so only this test's jobs are due when it runs the job runner.
  const E1 = new Date("2001-05-01T08:30:00.000Z"); // 14:00 IST
  const E2 = new Date(E1.getTime() + 10 * 24 * H);
  const [D1] = followUpTimes(E2);
  await db.from("jobs").delete().lt("run_at", "2002-01-01T00:00:00Z");
  const phone = uniquePhone();
  const ingestProvider = new FakeWhatsAppProvider();
  const enquire = async (at: Date) => {
    const res = await ingest(
      new Request("http://localhost/functions/v1/ingest-form", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source_key: "demo-web-form", name: "Nisha Rao", phone: phone.slice(3), consent: true }),
      }),
      { db, provider: ingestProvider, now: () => at, verifyTurnstile: () => Promise.resolve(true) },
    );
    assertEquals(res.status, 200);
    return (await res.json()).lead_id as string;
  };
  const staffReply = async (at: Date) => {
    const res = await post(deps({ now: () => new Date(at.getTime() + 2_000) }), [echo(phone, "Hi Nisha, calling you now", at)]);
    assertEquals(res.status, 200);
  };

  const leadId = await enquire(E1);
  cleanupLeads.push(leadId);
  try {
    const echo1 = new Date(E1.getTime() + H);
    await staffReply(echo1);
    assertEquals(await enquire(E2), leadId, "the repeat enquiry is the same lead");

    // Follow-up 1 of the second enquiry is claimed (running) when staff reply again.
    const { data: claimed, error } = await db.rpc("claim_jobs", { batch: 10, as_of: D1.toISOString() });
    if (error) throw error;
    assertEquals(claimed!.map((j) => [j.lead_id, j.idempotency_key]), [[leadId, followUpIdempotencyKey(leadId, 1, E2)]]);
    const echo2 = new Date(D1.getTime() + MIN);
    await staffReply(echo2);

    const l = await lead(phone);
    assertEquals(new Date(l!.first_human_reply_at!).toISOString(), echo1.toISOString(), "first reply kept for metrics");
    assertEquals(new Date(l!.last_human_reply_at!).toISOString(), echo2.toISOString(), "latest reply moved forward");

    // That runner died; the job is reclaimed after its lease and must not send.
    const provider = new FakeWhatsAppProvider();
    const summary = await runClaimedJobs({ db, provider, now: () => new Date(D1.getTime() + 16 * MIN), env: () => undefined });
    assertEquals([summary.claimed, summary.cancelled], [1, 1]);
    assertEquals(provider.sent.length + provider.sessions.length, 0, "no follow-up after the staff reply");
    const { data: job } = await db.from("jobs").select("id, status").eq("id", claimed![0].id).single();
    assertEquals(job!.status, "cancelled");
    const { data: why } = await db.from("events").select("payload").eq("payload->>job_id", job!.id).eq("type", "job_cancelled");
    assertEquals(why!.map((e) => (e.payload as { reason: string }).reason), ["staff replied after the enquiry"]);
  } finally {
    await db.from("messages").delete().in("provider_message_id", ingestProvider.sent.map((s) => s.providerMessageId));
    await cleanup();
  }
});
