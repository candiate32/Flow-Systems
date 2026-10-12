// The canary's pass through the spam check (spec 004, E.2): only for the
// canary org's form, and only from CANARY_PHONE when that is set.
// deno-lint-ignore no-import-prefix -- test-only std dep; no shared deno.json by design
import { assert, assertEquals } from "jsr:@std/assert@1";
// deno-lint-ignore no-import-prefix -- see index.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { CANARY_SECRET_MIN_LENGTH, canaryTurnstileToken, canaryVerdict, isCanaryToken } from "../_shared/canary.ts";
import type { Database } from "../_shared/database.types.ts";
import { FakeWhatsAppProvider } from "../_shared/whatsapp.ts";
import { type Deps, handler, makeVerifyTurnstile } from "./index.ts";

const SECRET = "c".repeat(CANARY_SECRET_MIN_LENGTH);
const TOKEN = canaryTurnstileToken(SECRET);
const CANARY_SOURCE = { org: { is_canary: true } };
const OTHER_SOURCE = { org: { is_canary: false } };

// --- Pure -----------------------------------------------------------------------

Deno.test("canary token: only canary:<CANARY_SECRET> matches", () => {
  assertEquals(isCanaryToken(TOKEN, SECRET), true);
  assertEquals(isCanaryToken(`canary:${SECRET}x`, SECRET), false);
  assertEquals(isCanaryToken(SECRET, SECRET), false);
  assertEquals(isCanaryToken("canary:", SECRET), false);
  assertEquals(isCanaryToken(null, SECRET), false);
  assertEquals(isCanaryToken(TOKEN, undefined), false);
  assertEquals(isCanaryToken("canary:", ""), false);
});

Deno.test("canary token: a secret shorter than the minimum opens nothing", () => {
  const short = "s".repeat(CANARY_SECRET_MIN_LENGTH - 1);
  assertEquals(isCanaryToken(canaryTurnstileToken(short), short), false);
});

Deno.test("canary verdict: allowed only on the canary org's source", () => {
  const cfg = { secret: SECRET };
  assertEquals(canaryVerdict(cfg, TOKEN, CANARY_SOURCE, "+916000123456"), { kind: "allowed" });
  assertEquals(canaryVerdict(cfg, TOKEN, OTHER_SOURCE, "+916000123456"), {
    kind: "refused",
    reason: "canary token for a source outside the canary org",
  });
  assertEquals(canaryVerdict(cfg, TOKEN, null, "+916000123456").kind, "refused", "unknown source");
  assertEquals(canaryVerdict(cfg, "some-turnstile-token", OTHER_SOURCE, "+916000123456"), { kind: "not_canary" });
  assertEquals(canaryVerdict(undefined, TOKEN, CANARY_SOURCE, "+916000123456"), { kind: "not_canary" });
});

Deno.test("canary verdict: a real provider without CANARY_PHONE refuses the token", () => {
  const real = { secret: SECRET, provider: "gupshup" };
  assertEquals(canaryVerdict(real, TOKEN, CANARY_SOURCE, "+916000123456"), {
    kind: "refused",
    reason: "CANARY_PHONE must be set when a real WhatsApp provider is configured",
  });
  assertEquals(canaryVerdict({ ...real, provider: "fake" }, TOKEN, CANARY_SOURCE, "+916000123456"), { kind: "allowed" });
  assertEquals(canaryVerdict({ ...real, phone: "+916000123456" }, TOKEN, CANARY_SOURCE, "+916000123456"), {
    kind: "allowed",
  });
});

Deno.test("canary verdict: with CANARY_PHONE, only from that number", () => {
  const cfg = { secret: SECRET, phone: "98450 12345" };
  assertEquals(canaryVerdict(cfg, TOKEN, CANARY_SOURCE, "+919845012345"), { kind: "allowed" });
  assertEquals(canaryVerdict(cfg, TOKEN, CANARY_SOURCE, "+919845054321"), {
    kind: "refused",
    reason: "canary token from a number other than CANARY_PHONE",
  });
  const broken = { secret: SECRET, phone: "12345" };
  assertEquals(canaryVerdict(broken, TOKEN, CANARY_SOURCE, "+919845012345").kind, "refused", "invalid CANARY_PHONE");
});

Deno.test("verifyTurnstile: a canary token is not a Turnstile token and gets no pass there", async () => {
  const env = (k: string) =>
    ({ TURNSTILE_SECRET: "turnstile-secret", CANARY_SECRET: SECRET } as Record<string, string>)[k];
  let calls = 0;
  const verify = makeVerifyTurnstile(env, () => {
    calls++;
    return Promise.resolve(new Response(JSON.stringify({ success: false })));
  });
  assertEquals(await verify(TOKEN), false);
  assertEquals(calls, 1, "went to Cloudflare like any other token");
});

// --- Through the handler, against the local database ----------------------------

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const NO_DB = !SERVICE_KEY;
const db = NO_DB ? null! : createClient<Database>(SUPABASE_URL, SERVICE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const dbTest = (name: string, fn: () => Promise<void>) =>
  Deno.test({ name, ignore: NO_DB, sanitizeOps: false, sanitizeResources: false, fn });

/** Turnstile that fails everything: only the canary pass can get through. */
function deps(canary: Deps["canary"]): Deps & { provider: FakeWhatsAppProvider } {
  return {
    db,
    provider: new FakeWhatsAppProvider(),
    now: () => new Date(),
    verifyTurnstile: () => Promise.resolve(false),
    canary,
  };
}

function post(sourceKey: string, phone: string, token: string) {
  return new Request("http://localhost/functions/v1/ingest-form", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source_key: sourceKey, name: "Flow Canary", phone, consent: true, turnstile_token: token }),
  });
}

/** A throwaway canary org with a form; runs `fn`, then deletes it all. */
async function withCanaryOrg(fn: (formKey: string) => Promise<void>) {
  const { data: existing } = await db.from("orgs").select("id").eq("is_canary", true);
  if (existing?.length) {
    console.warn("skipping: this database already has a canary org");
    return;
  }
  const slug = `canary-pass-${crypto.randomUUID().slice(0, 8)}`;
  const { data: org, error } = await db.from("orgs").insert({ name: "Canary Pass Test", slug, is_canary: true })
    .select("id").single();
  if (error) throw error;
  try {
    await db.from("sources").insert({ org_id: org.id, kind: "web_form", name: "Canary form", public_key: slug });
    await fn(slug);
  } finally {
    await db.from("orgs").delete().eq("id", org.id);
  }
}

dbTest("ingest-form: the canary token passes the spam check on the canary org's form", async () => {
  await withCanaryOrg(async (formKey) => {
    const d = deps({ secret: SECRET });
    const res = await handler(post(formKey, "6000111111", TOKEN), d);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.duplicate, false);
    assert(body.lead_id);
  });
});

dbTest("ingest-form: a valid canary token on another org's form gets 403 and saves nothing", async () => {
  const phone = "6000222222";
  const d = deps({ secret: SECRET });
  const res = await handler(post("demo-web-form", phone, TOKEN), d);
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "Spam check failed. Please try again." });
  assertEquals((await db.from("leads").select("id").eq("phone_e164", `+91${phone}`)).data, []);
  assertEquals(d.provider.sent, []);
  const requestId = res.headers.get("X-Request-Id")!;
  const { data: events } = await db.from("events").select("type, payload").eq("payload->>request_id", requestId);
  assertEquals(events!.find((e) => e.type === "turnstile_failed")?.payload, {
    request_id: requestId,
    reason: "canary token for a source outside the canary org",
  });
  await db.from("events").delete().eq("payload->>request_id", requestId);
});

dbTest("ingest-form: with CANARY_PHONE set, a canary token from another number gets 403", async () => {
  await withCanaryOrg(async (formKey) => {
    const d = deps({ secret: SECRET, phone: "6000333333" });
    const wrong = await handler(post(formKey, "6000444444", TOKEN), d);
    assertEquals(wrong.status, 403);
    await wrong.body?.cancel();
    assertEquals(d.provider.sent, []);

    const right = await handler(post(formKey, "6000333333", TOKEN), d);
    assertEquals(right.status, 200);
    await right.body?.cancel();
  });
});
