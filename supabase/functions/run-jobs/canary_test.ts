// The canary job (spec 004, E.2): unit tests with an in-memory store, a fake
// ingest-form and a fake clock, then one run against the local database with
// the real ingest-form handler behind the fetch.
// deno-lint-ignore no-import-prefix -- test-only std dep; no shared deno.json by design
import { assert, assertEquals, assertMatch, assertStrictEquals } from "jsr:@std/assert@1";
import { canaryTurnstileToken } from "../_shared/canary.ts";
import type { Json } from "../_shared/database.types.ts";
import type { Job } from "../_shared/jobs.ts";
import { FakeWhatsAppProvider } from "../_shared/whatsapp.ts";
import { handler as ingest } from "../ingest-form/index.ts";
import {
  canary,
  canaryIdempotencyKey,
  type CanaryStore,
  CHECK_WINDOW_MS,
  makeCanaryHandler,
  supabaseCanaryStore,
  syntheticCanaryPhone,
} from "./canary.ts";
import { defaultHandlers, type JobContext } from "./handlers.ts";
import { runClaimedJobs } from "./index.ts";
import { db, dbTest, MIN, noDb, T0 } from "./testing.ts";

const ORG = "c0000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-11T05:30:00.000Z");
const URL_ = "https://example.test/functions/v1/ingest-form";

const SOURCE = "c0000000-0000-4000-8000-0000000000f1";

type MemLead = {
  id: string;
  name: string;
  sourceId: string;
  phone: string;
  createdAt: Date;
  first_auto_reply_at: string | null;
  last_enquiry_at: string;
};

class MemoryStore implements CanaryStore {
  isCanary = true;
  form: { id: string; public_key: string } | null = { id: SOURCE, public_key: "canary-form" };
  leads = new Map<string, MemLead>();
  enqueued: { orgId: string; runAt: Date }[] = [];
  deleted: string[] = [];
  failCleanup = false;

  isCanaryOrg(orgId: string) {
    return Promise.resolve(orgId === ORG && this.isCanary);
  }
  enqueueCanary(orgId: string, runAt: Date) {
    this.enqueued.push({ orgId, runAt });
    return Promise.resolve();
  }
  canaryNamedLeadsBefore(sourceId: string, before: Date, limit: number) {
    if (this.failCleanup) return Promise.reject(new Error("db down"));
    return Promise.resolve(
      [...this.leads.values()]
        .filter((l) => l.sourceId === sourceId && l.name === "Flow Canary" && l.createdAt < before)
        .slice(0, limit).map((l) => ({ id: l.id, phone: l.phone })),
    );
  }
  findCanaryLead(sourceId: string, phone: string) {
    return Promise.resolve(
      [...this.leads.values()].find((l) => l.sourceId === sourceId && l.name === "Flow Canary" && l.phone === phone)
        ?.id ?? null,
    );
  }
  deleteLead(leadId: string) {
    this.deleted.push(leadId);
    this.leads.delete(leadId);
    return Promise.resolve();
  }
  webForm() {
    return Promise.resolve(this.form);
  }
  autoReply(leadId: string) {
    const l = this.leads.get(leadId);
    return Promise.resolve(
      l ? { first_auto_reply_at: l.first_auto_reply_at, last_enquiry_at: l.last_enquiry_at } : null,
    );
  }
}

type Posted = { url: string; body: Record<string, unknown> };

/**
 * A test bench: fake clock (sleep moves it), fake ingest-form that creates the
 * lead in the store, and recorders for events and ops alerts.
 * `replyAfterMs`: when the auto-reply shows up after the post (null: never).
 */
function bench(opts: {
  env?: Record<string, string>;
  replyAfterMs?: number | null;
  /** first_auto_reply_at minus last_enquiry_at as stored on the lead. */
  recordedDelayMs?: number;
  response?: (body: Record<string, unknown>, leadId: string) => Response;
  fetchError?: Error;
} = {}) {
  const clock = { t: NOW };
  const store = new MemoryStore();
  const posted: Posted[] = [];
  const events: { type: string; payload: Record<string, Json> }[] = [];
  const alerts: string[] = [];
  const sleeps: number[] = [];
  let replyAt: number | null = null;
  let leadId: string | null = null;

  const env = { INGEST_FORM_URL: URL_, ...opts.env };
  const handler = makeCanaryHandler({
    fetch: (url, init) => {
      const body = JSON.parse(String(init.body));
      posted.push({ url, body });
      if (opts.fetchError) return Promise.reject(opts.fetchError);
      leadId = crypto.randomUUID();
      const enquiryAt = clock.t.toISOString();
      store.leads.set(leadId, {
        id: leadId,
        name: body.name as string,
        sourceId: SOURCE,
        phone: body.phone as string,
        createdAt: clock.t,
        first_auto_reply_at: null,
        last_enquiry_at: enquiryAt,
      });
      const replyAfter = opts.replyAfterMs === undefined ? 1500 : opts.replyAfterMs;
      replyAt = replyAfter === null ? null : clock.t.getTime() + replyAfter;
      clock.t = new Date(clock.t.getTime() + 800); // the post takes 0.8 s
      const res = opts.response?.(body, leadId) ??
        new Response(JSON.stringify({ lead_id: leadId, duplicate: false, ack_sent: true }), { status: 200 });
      return Promise.resolve(res);
    },
    sleep: (ms) => {
      sleeps.push(ms);
      clock.t = new Date(clock.t.getTime() + ms);
      return Promise.resolve();
    },
    store: () => store,
  });

  // The fake auto-reply lands once the clock passes replyAt.
  const origAutoReply = store.autoReply.bind(store);
  store.autoReply = (id: string) => {
    const lead = store.leads.get(id);
    if (lead && replyAt !== null && clock.t.getTime() >= replyAt && !lead.first_auto_reply_at) {
      const delay = opts.recordedDelayMs ?? (replyAt - new Date(lead.last_enquiry_at).getTime());
      lead.first_auto_reply_at = new Date(new Date(lead.last_enquiry_at).getTime() + delay).toISOString();
    }
    return origAutoReply(id);
  };

  const ctx: JobContext = {
    db: noDb,
    provider: new FakeWhatsAppProvider(),
    now: () => clock.t,
    env: (k) => env[k as keyof typeof env],
    // The canary posts through its own deps (above); the job context's fetch is for Resend.
    fetch: () => Promise.reject(new Error("the canary must not use ctx.fetch")),
    addEvent: (_job, type, payload = {}) => {
      events.push({ type, payload });
      return Promise.resolve();
    },
    alertOps: (_job, error) => {
      alerts.push(error);
      return Promise.resolve();
    },
  };
  return { handler, ctx, store, posted, events, alerts, sleeps, clock, leadId: () => leadId };
}

function canaryJob(): Job {
  return {
    id: crypto.randomUUID(),
    org_id: ORG,
    lead_id: null,
    kind: "canary",
    run_at: NOW.toISOString(),
    status: "running",
    attempts: 1,
    max_attempts: 5,
    last_error: null,
    payload: {},
    idempotency_key: canaryIdempotencyKey(ORG, NOW),
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  };
}

// --- Pure helpers ------------------------------------------------------------

Deno.test("canary: idempotency key is per org and UTC hour", () => {
  assertEquals(canaryIdempotencyKey(ORG, new Date("2026-10-11T05:00:00Z")), `canary:${ORG}:2026-10-11T05`);
  assertEquals(canaryIdempotencyKey(ORG, new Date("2026-10-11T05:59:59.999Z")), `canary:${ORG}:2026-10-11T05`);
  assertEquals(canaryIdempotencyKey(ORG, new Date("2026-10-11T06:00:00Z")), `canary:${ORG}:2026-10-11T06`);
});

Deno.test("canary: the made-up phone is a valid mobile that changes every hour", () => {
  const a = syntheticCanaryPhone(new Date("2026-10-11T05:00:00Z"));
  const b = syntheticCanaryPhone(new Date("2026-10-11T05:59:00Z"));
  const c = syntheticCanaryPhone(new Date("2026-10-11T06:00:00Z"));
  assertMatch(a, /^\+916000\d{6}$/);
  assertEquals(a, b);
  assert(a !== c);
});

Deno.test("canary: registered as the canary handler in run-jobs", () => {
  assertStrictEquals(defaultHandlers.canary, canary);
});

// --- Handler -----------------------------------------------------------------

Deno.test("canary: healthy run posts a fake enquiry, sees the auto-reply, queues the next run, no alert", async () => {
  const b = bench({ env: { CANARY_SECRET: "x".repeat(32) } });
  const outcome = await b.handler(canaryJob(), b.ctx);

  assertEquals(outcome, undefined, "done");
  assertEquals(b.posted.length, 1);
  assertEquals(b.posted[0].url, URL_);
  assertEquals(b.posted[0].body, {
    source_key: "canary-form",
    name: "Flow Canary",
    phone: syntheticCanaryPhone(NOW),
    consent: true,
    turnstile_token: canaryTurnstileToken("x".repeat(32)),
  });
  assertEquals(b.store.enqueued, [{ orgId: ORG, runAt: new Date(NOW.getTime() + 60 * MIN) }]);
  assertEquals(b.alerts, []);
  assertEquals(b.events.map((e) => e.type), ["canary_passed"]);
  assertEquals(b.events[0].payload.probe_lead_id, b.leadId());
  assertEquals(b.events[0].payload.lead_id, undefined, "not lead_id: the result outlives the lead");
  assertEquals(b.events[0].payload.seconds_to_auto_reply, 1.5);
});

Deno.test("canary: waits for an auto-reply that lands within the check window", async () => {
  const b = bench({ replyAfterMs: 30_000 });
  await b.handler(canaryJob(), b.ctx);
  assertEquals(b.alerts, []);
  assertEquals(b.events.map((e) => e.type), ["canary_passed"]);
  assertEquals(b.events[0].payload.seconds_to_auto_reply, 30);
  assert(b.sleeps.length > 1, "polled");
});

Deno.test("canary: alerts ops when no auto-reply is recorded, and stops waiting in time for pg_net's 55 s", async () => {
  const b = bench({ replyAfterMs: null });
  const outcome = await b.handler(canaryJob(), b.ctx);
  assertEquals(outcome, undefined, "the job is done; the next canary is already queued");
  assertEquals(b.alerts, ["canary: no auto-reply recorded within 40 s of the enquiry"]);
  assertEquals(b.events.map((e) => e.type), ["canary_failed"]);
  assertEquals(b.events[0].payload.probe_lead_id, b.leadId());
  assertEquals(b.clock.t.getTime() - NOW.getTime(), CHECK_WINDOW_MS, "waited exactly until the window closed");
  assert(CHECK_WINDOW_MS < 55_000);
  assertEquals(b.store.enqueued.length, 1);
});

Deno.test("canary: alerts ops when the auto-reply was recorded but more than 60 s after the enquiry", async () => {
  const b = bench({ replyAfterMs: 2000, recordedDelayMs: 75_000 });
  await b.handler(canaryJob(), b.ctx);
  assertEquals(b.alerts, ["canary: auto-reply took 75 s, over 60 s"]);
});

Deno.test("canary: alerts ops when the post fails", async () => {
  const b = bench({ fetchError: new TypeError("connection refused") });
  await b.handler(canaryJob(), b.ctx);
  assertEquals(b.alerts, ["canary: post to ingest-form failed: connection refused"]);
  assertEquals(b.store.enqueued.length, 1, "next run still queued");
});

Deno.test("canary: alerts ops when ingest-form answers with an error", async () => {
  const b = bench({
    response: () => new Response(JSON.stringify({ error: "Something went wrong." }), { status: 500 }),
  });
  await b.handler(canaryJob(), b.ctx);
  assertEquals(b.alerts.length, 1);
  assertMatch(b.alerts[0], /^canary: ingest-form returned 500: /);
});

Deno.test("canary: alerts ops when the enquiry is treated as a duplicate", async () => {
  const b = bench({
    response: (_body, leadId) => new Response(JSON.stringify({ lead_id: leadId, duplicate: true }), { status: 200 }),
  });
  await b.handler(canaryJob(), b.ctx);
  assertEquals(b.alerts, ["canary: the canary enquiry was treated as a duplicate"]);
});

Deno.test("canary: alerts ops without posting when INGEST_FORM_URL is unset", async () => {
  const b = bench({ env: { INGEST_FORM_URL: "" } });
  await b.handler(canaryJob(), b.ctx);
  assertEquals(b.posted, []);
  assertEquals(b.alerts, ["canary: INGEST_FORM_URL is not set"]);
  assertEquals(b.store.enqueued.length, 1);
});

Deno.test("canary: never messages a made-up number through a real provider", async () => {
  const b = bench({ env: { WHATSAPP_PROVIDER: "some-bsp" } });
  await b.handler(canaryJob(), b.ctx);
  assertEquals(b.posted, []);
  assertEquals(b.alerts, ["canary: CANARY_PHONE must be set when a real WhatsApp provider is configured"]);
});

Deno.test("canary: with CANARY_PHONE it enquires from that number, deleting last hour's canary lead first", async () => {
  const b = bench({ env: { WHATSAPP_PROVIDER: "some-bsp", CANARY_PHONE: "98450 12345" } });
  b.store.leads.set("last-hour", {
    id: "last-hour",
    name: "Flow Canary",
    sourceId: SOURCE,
    phone: "+919845012345",
    createdAt: new Date(NOW.getTime() - 60 * MIN),
    first_auto_reply_at: null,
    last_enquiry_at: new Date(NOW.getTime() - 60 * MIN).toISOString(),
  });
  await b.handler(canaryJob(), b.ctx);
  assertEquals(b.store.deleted, ["last-hour"]);
  assertEquals(b.posted[0].body.phone, "+919845012345");
  assertEquals(b.alerts, []);
});

const DAY = 24 * 60 * MIN;

function addLead(
  b: ReturnType<typeof bench>,
  id: string,
  l: { ageDays: number; name?: string; sourceId?: string; phone?: string },
) {
  b.store.leads.set(id, {
    id,
    name: l.name ?? "Flow Canary",
    sourceId: l.sourceId ?? SOURCE,
    phone: l.phone ?? `+91600000${String(b.store.leads.size).padStart(4, "0")}`,
    createdAt: new Date(NOW.getTime() - l.ageDays * DAY),
    first_auto_reply_at: null,
    last_enquiry_at: NOW.toISOString(),
  });
}

Deno.test("canary: deletes its own leads older than 7 days, keeps newer ones", async () => {
  const b = bench();
  addLead(b, "old-1", { ageDays: 8 });
  addLead(b, "old-2", { ageDays: 7.01 });
  addLead(b, "new", { ageDays: 6.9 });
  await b.handler(canaryJob(), b.ctx);
  assertEquals(b.store.deleted, ["old-1", "old-2"]);
  assert(b.store.leads.has("new"));
  assertEquals(b.events.map((e) => e.type), ["canary_leads_deleted", "canary_passed"]);
});

Deno.test("canary: never deletes a lead it didn't create, however old", async () => {
  const b = bench();
  addLead(b, "real-person", { ageDays: 30, name: "Asha Rao", phone: "+919845012345" });
  addLead(b, "real-same-name", { ageDays: 30, phone: "+919845054321" }); // named Flow Canary, real number
  addLead(b, "other-form", { ageDays: 30, sourceId: "another-source" });
  addLead(b, "real-synthetic-looking", { ageDays: 30, name: "Ravi", phone: "+916000123456" });
  addLead(b, "canary-old", { ageDays: 30 });
  await b.handler(canaryJob(), b.ctx);
  assertEquals(b.store.deleted, ["canary-old"]);
  for (const id of ["real-person", "real-same-name", "other-form", "real-synthetic-looking"]) {
    assert(b.store.leads.has(id), id);
  }
});

Deno.test("canary: with CANARY_PHONE, its old leads from that number are deleted too", async () => {
  const b = bench({ env: { CANARY_PHONE: "98450 12345" } });
  addLead(b, "canary-old-fixed", { ageDays: 9, phone: "+919845012345" });
  addLead(b, "not-canary-number", { ageDays: 9, phone: "+919845099999" });
  await b.handler(canaryJob(), b.ctx);
  assertEquals(b.store.deleted, ["canary-old-fixed"]);
});

Deno.test("canary: doesn't delete a real lead that has the number it is about to use", async () => {
  const b = bench({ env: { CANARY_PHONE: "98450 12345" } });
  addLead(b, "real", { ageDays: 0, name: "Asha Rao", phone: "+919845012345" });
  await b.handler(canaryJob(), b.ctx);
  assertEquals(b.store.deleted, []);
});

Deno.test("canary: alerts ops without posting when the canary org has no web form", async () => {
  const b = bench();
  b.store.form = null;
  await b.handler(canaryJob(), b.ctx);
  assertEquals(b.posted, []);
  assertEquals(b.alerts, ["canary: the canary org has no web_form source"]);
});

Deno.test("canary: a failed cleanup is recorded and the check still runs", async () => {
  const b = bench();
  b.store.failCleanup = true;
  await b.handler(canaryJob(), b.ctx);
  assertEquals(b.events.map((e) => e.type), ["canary_cleanup_failed", "canary_passed"]);
  assertEquals(b.posted.length, 1);
});

Deno.test("canary: an org that is no longer the canary cancels the job and ends the chain", async () => {
  const b = bench();
  b.store.isCanary = false;
  const outcome = await b.handler(canaryJob(), b.ctx);
  assertEquals(outcome, { status: "cancelled", reason: "org is not the canary" });
  assertEquals(b.posted, []);
  assertEquals(b.store.enqueued, []);
  assertEquals(b.alerts, []);
});

// --- Against the local database ---------------------------------------------

dbTest(
  "canary (db): marking the canary queues a job keyed like run-jobs; a run through run-jobs posts via ingest-form, passes, queues the next hour and deletes old canary leads",
  async () => {
    const slug = `canary-test-${crypto.randomUUID().slice(0, 8)}`;
    const { data: existing } = await db.from("orgs").select("id").eq("is_canary", true);
    if (existing?.length) {
      console.warn(`skipping: org ${existing[0].id} is already the canary on this database`);
      return;
    }
    const { data: org, error } = await db.from("orgs")
      .insert({ name: "Canary Test Org", slug, is_canary: true }).select("id").single();
    if (error) throw error;
    try {
      const { data: source } = await db.from("sources")
        .insert({ org_id: org.id, kind: "web_form", name: "Canary form", public_key: slug }).select("id").single();

      // The trigger queued the first canary job, keyed the way canary.ts keys it.
      const { data: first } = await db.from("jobs").select("*").eq("org_id", org.id).eq("kind", "canary");
      assertEquals(first!.length, 1);
      assertEquals(first![0].idempotency_key, canaryIdempotencyKey(org.id, new Date(first![0].run_at)));

      // A canary lead from last week, with a message and an event.
      const { data: old } = await db.from("leads").insert({
        org_id: org.id,
        source_id: source!.id,
        name: "Flow Canary",
        phone_e164: "+916000999999",
        consent_at: "2000-12-01T00:00:00Z",
        created_at: "2000-12-01T00:00:00Z",
      }).select("id").single();
      await db.from("messages").insert({
        org_id: org.id,
        lead_id: old!.id,
        direction: "outbound",
        kind: "template",
        provider: "fake",
      });
      await db.from("events").insert({ org_id: org.id, lead_id: old!.id, type: "lead_created" });
      // And a real person who enquired on the canary's form last week: never deleted.
      const { data: real } = await db.from("leads").insert({
        org_id: org.id,
        source_id: source!.id,
        name: "Asha Rao",
        phone_e164: "+919845012345",
        consent_at: "2000-12-01T00:00:00Z",
        created_at: "2000-12-01T00:00:00Z",
      }).select("id").single();

      // Run it on the drill clock (2001) so only test jobs are claimed.
      await db.from("jobs").update({ run_at: T0.toISOString() }).eq("id", first![0].id);
      const clock = { t: T0 };
      const provider = new FakeWhatsAppProvider();
      const realIngest = (url: string, init: RequestInit) =>
        ingest(new Request(url, init), {
          db,
          provider,
          now: () => new Date(),
          verifyTurnstile: () => Promise.resolve(true),
        });
      const summary = await runClaimedJobs({
        db,
        provider,
        now: () => clock.t,
        env: (k) =>
          ({ INGEST_FORM_URL: "http://localhost/functions/v1/ingest-form", OPS_ALERT_PHONE: "9000000002" })[k],
        handlers: {
          canary: makeCanaryHandler({
            fetch: realIngest,
            sleep: (ms) => {
              clock.t = new Date(clock.t.getTime() + ms);
              return Promise.resolve();
            },
            store: supabaseCanaryStore,
          }),
        },
      }, { batchSize: 1 });
      assertEquals(summary.claimed, 1);
      assertEquals(summary.done, 1);

      const { data: events } = await db.from("events").select("type, payload").eq("org_id", org.id)
        .eq("payload->>job_id", first![0].id).order("id");
      assertEquals(events!.map((e) => e.type), ["canary_leads_deleted", "canary_passed"]);
      const leadId = (events![1].payload as { probe_lead_id: string }).probe_lead_id;

      // The lead came through ingest-form and was acknowledged.
      const { data: lead } = await db.from("leads").select("name, phone_e164, first_auto_reply_at").eq("id", leadId)
        .single();
      assertEquals(lead!.name, "Flow Canary");
      assertMatch(lead!.phone_e164, /^\+916000\d{6}$/);
      assert(lead!.first_auto_reply_at);
      assertEquals(provider.sent.filter((s) => s.template === "ops_alert"), [], "no ops alert");

      // The next canary is queued an hour later, keyed by its hour.
      const next = new Date(T0.getTime() + 60 * MIN);
      const { data: queued } = await db.from("jobs").select("run_at, status").eq("org_id", org.id)
        .eq("idempotency_key", canaryIdempotencyKey(org.id, next));
      assertEquals(queued!.length, 1);
      assertEquals(new Date(queued![0].run_at).getTime(), next.getTime());

      // Last week's lead went through delete_lead.
      assertEquals((await db.from("leads").select("id").eq("id", old!.id)).data, []);
      assertEquals((await db.from("messages").select("id").eq("lead_id", old!.id)).data, []);
      const { data: audit } = await db.from("audit_log").select("action").eq("target", `lead:${old!.id}`);
      assertEquals(audit, [{ action: "lead.deleted" }]);
      assertEquals((await db.from("leads").select("id").eq("id", real!.id)).data, [{ id: real!.id }], "real lead kept");

      // Second run with the provider down: no auto-reply, so ops are alerted.
      await db.from("jobs").update({ run_at: next.toISOString() }).eq("org_id", org.id).eq("status", "queued");
      clock.t = next;
      const down = {
        name: "fake",
        sent: [] as unknown[],
        sendTemplate(msg: { template: string }) {
          if (msg.template === "ops_alert") return provider.sendTemplate(msg as never);
          return Promise.reject(new Error("provider down"));
        },
        sendSession() {
          return Promise.reject(new Error("provider down"));
        },
      };
      const downIngest = (url: string, init: RequestInit) =>
        ingest(new Request(url, init), {
          db,
          provider: down,
          now: () => new Date(),
          verifyTurnstile: () => Promise.resolve(true),
        });
      const summary2 = await runClaimedJobs({
        db,
        provider: down,
        now: () => clock.t,
        env: (k) =>
          ({ INGEST_FORM_URL: "http://localhost/functions/v1/ingest-form", OPS_ALERT_PHONE: "9000000002" })[k],
        handlers: {
          canary: makeCanaryHandler({
            fetch: downIngest,
            sleep: (ms) => {
              clock.t = new Date(clock.t.getTime() + ms);
              return Promise.resolve();
            },
            store: supabaseCanaryStore,
          }),
        },
      }, { batchSize: 1 });
      assertEquals(summary2.done, 1);
      const alerts = provider.sent.filter((s) => s.template === "ops_alert");
      assertEquals(alerts.length, 1);
      assertEquals(alerts[0].to, "+919000000002");
      assertEquals(alerts[0].params[0], "canary");
      assertEquals(alerts[0].params[3], "canary: no auto-reply recorded within 40 s of the enquiry");
    } finally {
      // Cascades to its sources, leads, messages, events, jobs and audit rows.
      await db.from("orgs").delete().eq("id", org.id);
    }
  },
);
