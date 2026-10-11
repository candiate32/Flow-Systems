// deno-lint-ignore no-import-prefix -- test-only std dep; no shared deno.json by design
import { assert, assertEquals, assertExists } from "jsr:@std/assert@1";
// deno-lint-ignore no-import-prefix -- see index.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import type { Database } from "../_shared/database.types.ts";
import { FakeWhatsAppProvider, type TemplateMessage, type WhatsAppProvider } from "../_shared/whatsapp.ts";
import { type Deps, handler, makeVerifyTurnstile } from "./index.ts";

// Database tests run against the local stack (`npx supabase start`). Set
// SUPABASE_SERVICE_ROLE_KEY (SERVICE_ROLE_KEY or SECRET_KEY from
// `npx supabase status -o env`) to run them; without it they are ignored.
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const NO_DB = !SERVICE_KEY;

const DEMO_ORG = "00000000-0000-4000-8000-000000000001";
const DEMO_SOURCE = "00000000-0000-4000-8000-000000000101";
const DEMO_OWNER_PHONES = ["+919000000001"];
const URL_ = "http://localhost/functions/v1/ingest-form";

/** A db that fails the test if the handler touches it. */
const noDb = new Proxy({}, {
  get() {
    throw new Error("handler should not touch the database here");
  },
}) as Deps["db"];

function post(body: unknown): Request {
  return new Request(URL_, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// --- Tests that need no database -------------------------------------------

Deno.test("OPTIONS answers the CORS preflight", async () => {
  const res = await handler(new Request(URL_, { method: "OPTIONS" }), {
    db: noDb,
    provider: new FakeWhatsAppProvider(),
    now: () => new Date(),
    verifyTurnstile: () => Promise.resolve(true),
  });
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("non-POST methods get 405", async () => {
  for (const method of ["GET", "PUT", "DELETE"]) {
    const res = await handler(new Request(URL_, { method }), {
      db: noDb,
      provider: new FakeWhatsAppProvider(),
      now: () => new Date(),
      verifyTurnstile: () => Promise.resolve(true),
    });
    assertEquals(res.status, 405, method);
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
    await res.body?.cancel();
  }
});

Deno.test("invalid JSON with no source key gets 400 without touching the database", async () => {
  const res = await handler(post("{not json"), {
    db: noDb,
    provider: new FakeWhatsAppProvider(),
    now: () => new Date(),
    verifyTurnstile: () => Promise.resolve(true),
  });
  assertEquals(res.status, 400);
  assertExists((await res.json()).errors.body);
});

Deno.test("verifyTurnstile passes when TURNSTILE_SECRET is unset", async () => {
  const verify = makeVerifyTurnstile(() => undefined, () => {
    throw new Error("must not call Cloudflare");
  });
  assertEquals(await verify(null), true);
});

Deno.test("verifyTurnstile fails closed without a secret when a real provider is configured", async () => {
  const verify = makeVerifyTurnstile((k) => (k === "WHATSAPP_PROVIDER" ? "some-bsp" : undefined), () => {
    throw new Error("must not call Cloudflare");
  });
  assertEquals(await verify("token"), false);
});

Deno.test("verifyTurnstile fails a missing token when the secret is set", async () => {
  const verify = makeVerifyTurnstile((k) => (k === "TURNSTILE_SECRET" ? "s3cret" : undefined), () => {
    throw new Error("must not call Cloudflare without a token");
  });
  assertEquals(await verify(null), false);
});

Deno.test("verifyTurnstile posts secret and token to siteverify and reads success", async () => {
  const calls: { url: string; body: string }[] = [];
  const fakeFetch = (success: boolean) => ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: String(init?.body) });
    return Promise.resolve(Response.json({ success }));
  }) as typeof fetch;
  const env = (k: string) => (k === "TURNSTILE_SECRET" ? "s3cret" : undefined);

  assertEquals(await makeVerifyTurnstile(env, fakeFetch(true))("tok-1"), true);
  assertEquals(await makeVerifyTurnstile(env, fakeFetch(false))("tok-2"), false);
  assertEquals(calls[0].url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  assertEquals(new URLSearchParams(calls[0].body).get("secret"), "s3cret");
  assertEquals(new URLSearchParams(calls[0].body).get("response"), "tok-1");
});

Deno.test("verifyTurnstile fails closed when Cloudflare is unreachable", async () => {
  const verify = makeVerifyTurnstile(
    (k) => (k === "TURNSTILE_SECRET" ? "s3cret" : undefined),
    () => Promise.reject(new Error("network down")),
  );
  assertEquals(await verify("tok"), false);
});

// --- Tests against the local database --------------------------------------

const db = NO_DB ? noDb : createClient<Database>(SUPABASE_URL, SERVICE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** A random valid Indian mobile, so tests never collide with each other or the seed. */
function uniquePhone(): { national: string; e164: string } {
  const digits = Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b % 10).join("");
  const national = `7${digits}`;
  return { national, e164: `+91${national}` };
}

function form(phone: string, extra: Record<string, unknown> = {}) {
  return {
    source_key: "demo-web-form",
    name: "Asha Rao",
    phone,
    bhk: "3BHK",
    possession_month: "2027-03",
    consent: true,
    ...extra,
  };
}

function deps(provider: WhatsAppProvider, now: () => Date = () => new Date()): Deps {
  return { db, provider, now, verifyTurnstile: () => Promise.resolve(true) };
}

/** Removes everything a test created: leads (cascading), owner alerts and events by request id. */
async function cleanup(phones: string[], requestIds: string[], providerIds: string[]) {
  if (requestIds.length) {
    for (const id of requestIds) {
      await db.from("events").delete().eq("org_id", DEMO_ORG).eq("payload->>request_id", id);
    }
  }
  if (providerIds.length) await db.from("messages").delete().in("provider_message_id", providerIds);
  if (phones.length) await db.from("leads").delete().eq("org_id", DEMO_ORG).in("phone_e164", phones);
}

async function leadsFor(phone: string) {
  const { data, error } = await db.from("leads").select("*").eq("org_id", DEMO_ORG).eq("phone_e164", phone);
  if (error) throw error;
  return data;
}

async function eventsFor(requestId: string) {
  const { data, error } = await db.from("events").select("*").eq("org_id", DEMO_ORG)
    .eq("payload->>request_id", requestId).order("id");
  if (error) throw error;
  return data;
}

const dbTest = (name: string, fn: () => Promise<void>) =>
  Deno.test({ name, ignore: NO_DB, sanitizeOps: false, sanitizeResources: false, fn });

dbTest("happy path: saves one lead, acks it, alerts each owner, logs every step", async () => {
  const phone = uniquePhone();
  const provider = new FakeWhatsAppProvider();
  // Spaces and a leading 0, the way people type it.
  const res = await handler(post(form(`0${phone.national.slice(0, 5)} ${phone.national.slice(5)}`)), deps(provider));
  const requestId = res.headers.get("X-Request-Id")!;
  try {
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.duplicate, false);
    assertEquals(body.ack_sent, true);

    const leads = await leadsFor(phone.e164);
    assertEquals(leads.length, 1);
    const lead = leads[0];
    assertEquals(lead.id, body.lead_id);
    assertEquals(lead.phone_e164, phone.e164);
    assertEquals(lead.source_id, DEMO_SOURCE);
    assertEquals(lead.name, "Asha Rao");
    assertEquals(lead.bhk, "3BHK");
    assertEquals(lead.possession_month, "2027-03");
    assertExists(lead.consent_at);
    assertExists(lead.first_auto_reply_at);

    // Provider calls.
    assertEquals(provider.sent.length, 1 + DEMO_OWNER_PHONES.length);
    const ackSend = provider.sent.find((s) => s.template === "enquiry_ack")!;
    assertEquals(ackSend.to, phone.e164);
    assertEquals(ackSend.params, ["Asha", "Demo Interiors, Sarjapur Road"]);
    const alertSends = provider.sent.filter((s) => s.template === "owner_alert");
    assertEquals(alertSends.map((s) => s.to).sort(), [...DEMO_OWNER_PHONES].sort());
    assertEquals(alertSends[0].params, ["Asha Rao", phone.e164, "3BHK", "2027-03"]);

    // Message rows.
    const { data: ack } = await db.from("messages").select("*").eq("lead_id", lead.id);
    assertEquals(ack!.length, 1);
    assertEquals(ack![0].direction, "outbound");
    assertEquals(ack![0].kind, "template");
    assertEquals(ack![0].template_name, "enquiry_ack");
    assertEquals(ack![0].to_phone, phone.e164);
    assertEquals(ack![0].status, "sent");
    assertEquals(ack![0].provider, "fake");
    assertEquals(ack![0].provider_message_id, ackSend.providerMessageId);
    assertEquals(ack![0].sent_at && new Date(ack![0].sent_at).getTime(), new Date(lead.first_auto_reply_at!).getTime());

    const { data: alerts } = await db.from("messages").select("*")
      .in("provider_message_id", alertSends.map((s) => s.providerMessageId));
    assertEquals(alerts!.length, DEMO_OWNER_PHONES.length);
    for (const a of alerts!) {
      assertEquals(a.template_name, "owner_alert");
      assertEquals(a.kind, "template");
      assertEquals(a.direction, "outbound");
      assertEquals(a.status, "sent");
      assertEquals(a.lead_id, null);
    }

    // Events: one per step, all tied to the lead.
    const events = await eventsFor(requestId);
    assertEquals(events.map((e) => e.type), [
      "enquiry_received",
      "enquiry_validated",
      "turnstile_passed",
      "source_resolved",
      "lead_created",
      "ack_sent",
      ...DEMO_OWNER_PHONES.map(() => "owner_alert_sent"),
      "enquiry_completed",
    ]);
    assert(events.every((e) => e.lead_id === lead.id));

    const { count: jobCount } = await db.from("jobs").select("id", { count: "exact", head: true }).eq("lead_id", lead.id);
    assertEquals(jobCount, 0, "a successful ack enqueues no retry");
  } finally {
    await cleanup([phone.e164], [requestId], provider.sent.map((s) => s.providerMessageId));
  }
});

dbTest("duplicate within 24h: 200 with duplicate:true, nothing new sent", async () => {
  const phone = uniquePhone();
  const provider = new FakeWhatsAppProvider();
  const t0 = new Date();
  const first = await handler(post(form(phone.national)), deps(provider, () => t0));
  const firstBody = await first.json();
  const t1 = new Date(t0.getTime() + 60 * 60 * 1000); // one hour later
  const second = await handler(post(form(phone.national, { name: "Asha R" })), deps(provider, () => t1));
  const ids = [first.headers.get("X-Request-Id")!, second.headers.get("X-Request-Id")!];
  try {
    assertEquals(second.status, 200);
    assertEquals(await second.json(), { lead_id: firstBody.lead_id, duplicate: true });
    assertEquals(provider.sent.length, 1 + DEMO_OWNER_PHONES.length, "no new sends");

    const leads = await leadsFor(phone.e164);
    assertEquals(leads.length, 1);
    assertEquals(leads[0].name, "Asha Rao", "duplicate does not overwrite the lead");
    assertEquals(new Date(leads[0].last_enquiry_at).getTime(), t1.getTime());

    const { count } = await db.from("messages").select("id", { count: "exact", head: true }).eq("lead_id", firstBody.lead_id);
    assertEquals(count, 1);
    const events = await eventsFor(ids[1]);
    assert(events.some((e) => e.type === "duplicate_enquiry"));
    assert(!events.some((e) => e.type === "ack_sent"));
  } finally {
    await cleanup([phone.e164], ids, provider.sent.map((s) => s.providerMessageId));
  }
});

dbTest("a repeat enquiry after 24h is handled as a new enquiry", async () => {
  const phone = uniquePhone();
  const provider = new FakeWhatsAppProvider();
  const t0 = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const first = await handler(post(form(phone.national)), deps(provider, () => t0));
  const second = await handler(post(form(phone.national)), deps(provider));
  const ids = [first.headers.get("X-Request-Id")!, second.headers.get("X-Request-Id")!];
  try {
    assertEquals(second.status, 200);
    const body = await second.json();
    assertEquals(body.duplicate, false);
    assertEquals((await leadsFor(phone.e164)).length, 1);
    assertEquals(provider.sent.length, 2 * (1 + DEMO_OWNER_PHONES.length));
    assert((await eventsFor(ids[1])).some((e) => e.type === "lead_updated"));
  } finally {
    await cleanup([phone.e164], ids, provider.sent.map((s) => s.providerMessageId));
  }
});

for (
  const [label, overrides, field] of [
    ["missing consent", { consent: undefined }, "consent"],
    ["consent false", { consent: false }, "consent"],
    ["invalid phone", { phone: "12345" }, "phone"],
    ["unknown source key", { source_key: "no-such-form" }, "source_key"],
  ] as const
) {
  dbTest(`400 with field errors and no lead for ${label}`, async () => {
    const phone = uniquePhone();
    const provider = new FakeWhatsAppProvider();
    const body = { ...form(phone.national), ...overrides };
    const res = await handler(post(body), deps(provider));
    const requestId = res.headers.get("X-Request-Id")!;
    try {
      assertEquals(res.status, 400);
      const out = await res.json();
      assertExists(out.errors[field], JSON.stringify(out));
      assertEquals((await leadsFor(phone.e164)).length, 0);
      assertEquals(provider.sent.length, 0);
      if (field !== "source_key") {
        // Rejections for a real source are logged against its org.
        const events = await eventsFor(requestId);
        assertEquals(events.map((e) => e.type), ["enquiry_received", "enquiry_invalid"]);
        assertEquals(events[1].payload, { request_id: requestId, fields: [field] });
      }
    } finally {
      await cleanup([phone.e164], [requestId], []);
    }
  });
}

dbTest("403 when Turnstile fails, and no lead", async () => {
  const phone = uniquePhone();
  const provider = new FakeWhatsAppProvider();
  const res = await handler(post(form(phone.national)), {
    ...deps(provider),
    verifyTurnstile: () => Promise.resolve(false),
  });
  const requestId = res.headers.get("X-Request-Id")!;
  try {
    assertEquals(res.status, 403);
    await res.body?.cancel();
    assertEquals((await leadsFor(phone.e164)).length, 0);
    assertEquals(provider.sent.length, 0);
    assertEquals((await eventsFor(requestId)).map((e) => e.type), [
      "enquiry_received",
      "enquiry_validated",
      "turnstile_failed",
    ]);
  } finally {
    await cleanup([phone.e164], [requestId], []);
  }
});

class FailingProvider implements WhatsAppProvider {
  readonly name = "fake";
  attempts: TemplateMessage[] = [];
  sendTemplate(msg: TemplateMessage): Promise<{ providerMessageId: string }> {
    this.attempts.push(msg);
    return Promise.reject(new Error("provider is down (secret detail)"));
  }
  sendSession(): Promise<{ providerMessageId: string }> {
    return Promise.reject(new Error("ingest-form sends no session messages"));
  }
}

dbTest("provider failure: lead saved, failed messages and send_failed events, 200 with ack_sent:false", async () => {
  const phone = uniquePhone();
  const provider = new FailingProvider();
  const t = new Date();
  const res = await handler(post(form(phone.national)), deps(provider, () => t));
  const requestId = res.headers.get("X-Request-Id")!;
  const leads = await leadsFor(phone.e164);
  try {
    assertEquals(res.status, 200);
    const text = await res.text();
    assert(!text.includes("secret detail"), "provider error must not reach the client");
    const body = JSON.parse(text);
    assertEquals(body, { lead_id: leads[0].id, duplicate: false, ack_sent: false });

    assertEquals(leads.length, 1);
    assertEquals(leads[0].first_auto_reply_at, null);

    const { data: ack } = await db.from("messages").select("*").eq("lead_id", leads[0].id);
    assertEquals(ack!.length, 1);
    assertEquals(ack![0].status, "failed");
    assertEquals(ack![0].template_name, "enquiry_ack");
    assertEquals(ack![0].provider_message_id, null);
    assertExists(ack![0].error);

    const events = await eventsFor(requestId);
    const failed = events.filter((e) => e.type === "send_failed");
    assertEquals(failed.length, 1 + DEMO_OWNER_PHONES.length);
    assert(events.some((e) => e.type === "enquiry_completed"));

    // Spec 004, A.5: the failed ack and each failed owner alert are handed to the job queue.
    const { data: jobs } = await db.from("jobs").select("*").eq("lead_id", leads[0].id);
    assertEquals(jobs!.length, 1 + DEMO_OWNER_PHONES.length);
    for (const j of jobs!) {
      assertEquals(j.kind, "send_message");
      assertEquals(j.status, "queued");
      assertEquals(j.attempts, 0);
      assertEquals(j.max_attempts, 5);
      assertEquals(j.org_id, DEMO_ORG);
      assertEquals(new Date(j.run_at).getTime(), t.getTime() + 60_000, "first retry one minute later");
    }
    assertEquals(new Date(leads[0].last_enquiry_at).getTime(), t.getTime());

    const job = jobs!.find((j) => (j.payload as { template: string }).template === "enquiry_ack")!;
    assertEquals(job.idempotency_key, `ack:${leads[0].id}:${t.toISOString()}`);
    assertEquals(job.payload, {
      to: phone.e164,
      template: "enquiry_ack",
      language: "en",
      params: ["Asha", "Demo Interiors, Sarjapur Road"],
      first_auto_reply: true,
    });
    const enqueued = events.filter((e) => e.type === "ack_retry_enqueued");
    assertEquals(enqueued.length, 1);
    assertEquals((enqueued[0].payload as { job_id: string }).job_id, job.id);

    const alertJobs = jobs!.filter((j) => (j.payload as { template: string }).template === "owner_alert");
    assertEquals(
      alertJobs.map((j) => j.idempotency_key).sort(),
      DEMO_OWNER_PHONES.map((to) => `owner_alert:${leads[0].id}:${t.toISOString()}:${to}`).sort(),
    );
    for (const j of alertJobs) {
      const to = (j.payload as { to: string }).to;
      assertEquals(j.payload, {
        to,
        template: "owner_alert",
        language: "en",
        params: ["Asha Rao", phone.e164, "3BHK", "2027-03"],
        first_auto_reply: false,
      });
    }
    const alertEnqueued = events.filter((e) => e.type === "owner_alert_retry_enqueued");
    assertEquals(
      alertEnqueued.map((e) => (e.payload as { job_id: string }).job_id).sort(),
      alertJobs.map((j) => j.id).sort(),
    );
  } finally {
    // Failed owner alerts have no lead_id and no provider id; remove them by recipient and time.
    for (const to of DEMO_OWNER_PHONES) {
      await db.from("messages").delete().eq("org_id", DEMO_ORG).eq("to_phone", to).eq("status", "failed")
        .eq("template_name", "owner_alert").like("error", "%secret detail%");
    }
    await cleanup([phone.e164], [requestId], []);
  }
});

// --- details (spec 003, bar 6) ---------------------------------------------

dbTest("details: custom answers are stored on the lead, trimmed, blanks dropped", async () => {
  const phone = uniquePhone();
  const provider = new FakeWhatsAppProvider();
  const details = { budget: " 10-15L ", rooms: "Kitchen, Living", call_time: "  " };
  const res = await handler(post(form(phone.national, { details })), deps(provider));
  const requestId = res.headers.get("X-Request-Id")!;
  try {
    assertEquals(res.status, 200);
    assertEquals((await res.json()).duplicate, false);
    const leads = await leadsFor(phone.e164);
    assertEquals(leads.length, 1);
    assertEquals(leads[0].details, { budget: "10-15L", rooms: "Kitchen, Living" });
  } finally {
    await cleanup([phone.e164], [requestId], provider.sent.map((s) => s.providerMessageId));
  }
});

dbTest("details: absent details store an empty object", async () => {
  const phone = uniquePhone();
  const provider = new FakeWhatsAppProvider();
  const res = await handler(post(form(phone.national)), deps(provider));
  const requestId = res.headers.get("X-Request-Id")!;
  try {
    assertEquals(res.status, 200);
    await res.body?.cancel();
    assertEquals((await leadsFor(phone.e164))[0].details, {});
  } finally {
    await cleanup([phone.e164], [requestId], provider.sent.map((s) => s.providerMessageId));
  }
});

dbTest("details: a repeat enquiry after 24h merges new answers over old", async () => {
  const phone = uniquePhone();
  const provider = new FakeWhatsAppProvider();
  const t0 = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  const first = await handler(
    post(form(phone.national, { details: { budget: "5-10L", rooms: "Kitchen" } })),
    deps(provider, () => t0),
  );
  const second = await handler(
    post(form(phone.national, { details: { budget: "10-15L", call_time: "Evening" } })),
    deps(provider),
  );
  const ids = [first.headers.get("X-Request-Id")!, second.headers.get("X-Request-Id")!];
  try {
    assertEquals(second.status, 200);
    assertEquals((await second.json()).duplicate, false);
    const leads = await leadsFor(phone.e164);
    assertEquals(leads.length, 1);
    assertEquals(leads[0].details, { budget: "10-15L", rooms: "Kitchen", call_time: "Evening" });
  } finally {
    await first.body?.cancel();
    await cleanup([phone.e164], ids, provider.sent.map((s) => s.providerMessageId));
  }
});

dbTest("details: a duplicate within 24h does not change stored answers", async () => {
  const phone = uniquePhone();
  const provider = new FakeWhatsAppProvider();
  const t0 = new Date();
  const first = await handler(post(form(phone.national, { details: { budget: "5-10L" } })), deps(provider, () => t0));
  const second = await handler(
    post(form(phone.national, { details: { budget: "50L+" } })),
    deps(provider, () => new Date(t0.getTime() + 60_000)),
  );
  const ids = [first.headers.get("X-Request-Id")!, second.headers.get("X-Request-Id")!];
  try {
    assertEquals((await second.json()).duplicate, true);
    assertEquals((await leadsFor(phone.e164))[0].details, { budget: "5-10L" });
  } finally {
    await first.body?.cancel();
    await cleanup([phone.e164], ids, provider.sent.map((s) => s.providerMessageId));
  }
});

for (
  const [label, details] of [
    ["an array", ["budget"]],
    ["a string", "budget=10L"],
    ["11 keys", Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`q${i}`, "x"]))],
    ["a bad key", { "Budget!": "10L" }],
    ["a non-string value", { budget: 10 }],
    ["a value over 200 characters", { note: "a".repeat(201) }],
  ] as const
) {
  dbTest(`details: 400 naming details, no lead and no sends for ${label}`, async () => {
    const phone = uniquePhone();
    const provider = new FakeWhatsAppProvider();
    const res = await handler(post(form(phone.national, { details })), deps(provider));
    const requestId = res.headers.get("X-Request-Id")!;
    try {
      assertEquals(res.status, 400);
      const out = await res.json();
      assertEquals(Object.keys(out.errors), ["details"], JSON.stringify(out));
      assert(typeof out.errors.details === "string" && out.errors.details.length > 0);
      assertEquals((await leadsFor(phone.e164)).length, 0);
      assertEquals(provider.sent.length, 0);
      const events = await eventsFor(requestId);
      assertEquals(events.map((e) => e.type), ["enquiry_received", "enquiry_invalid"]);
      assertEquals(events[1].payload, { request_id: requestId, fields: ["details"] });
    } finally {
      await cleanup([phone.e164], [requestId], []);
    }
  });
}
