// deno-lint-ignore no-import-prefix -- test-only std dep; no shared deno.json by design
import { assert, assertEquals, assertInstanceOf, assertThrows } from "jsr:@std/assert@1";
import {
  FAKE_SIGNATURE_HEADER,
  FakeWebhookAdapter,
  getWebhookAdapter,
  signFakeWebhook,
  WebhookParseError,
} from "./whatsapp_webhook.ts";

const SECRET = "test-webhook-secret";
const URL_ = "http://localhost/functions/v1/whatsapp-webhook?source=x";

function request(body: string, signature: string | null): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (signature !== null) headers.set(FAKE_SIGNATURE_HEADER, signature);
  return new Request(URL_, { method: "POST", headers, body });
}

// --- verifyWebhook --------------------------------------------------------------

Deno.test("verifyWebhook accepts the HMAC-SHA256 of the raw body", async () => {
  const body = JSON.stringify({ events: [] });
  const sig = await signFakeWebhook(body, SECRET);
  assertEquals(sig.length, 64);
  assert(await new FakeWebhookAdapter(SECRET).verifyWebhook(request(body, sig)));
});

Deno.test("verifyWebhook accepts upper-case hex and a sha256= prefix", async () => {
  const body = '{"events":[]}';
  const sig = await signFakeWebhook(body, SECRET);
  const adapter = new FakeWebhookAdapter(SECRET);
  assert(await adapter.verifyWebhook(request(body, sig.toUpperCase())));
  assert(await adapter.verifyWebhook(request(body, `sha256=${sig}`)));
});

Deno.test("verifyWebhook leaves the body readable for the caller", async () => {
  const body = '{"events":[]}';
  const req = request(body, await signFakeWebhook(body, SECRET));
  assert(await new FakeWebhookAdapter(SECRET).verifyWebhook(req));
  assertEquals(await req.text(), body);
});

Deno.test("verifyWebhook rejects a changed body, a wrong key, a missing or malformed header", async () => {
  const body = '{"events":[]}';
  const sig = await signFakeWebhook(body, SECRET);
  const adapter = new FakeWebhookAdapter(SECRET);
  assertEquals(await adapter.verifyWebhook(request('{"events":[] }', sig)), false, "body changed by one byte");
  assertEquals(await adapter.verifyWebhook(request(body, await signFakeWebhook(body, "other"))), false, "wrong key");
  assertEquals(await adapter.verifyWebhook(request(body, null)), false, "no header");
  assertEquals(await adapter.verifyWebhook(request(body, "")), false, "empty header");
  assertEquals(await adapter.verifyWebhook(request(body, "zz".repeat(32))), false, "not hex");
  assertEquals(await adapter.verifyWebhook(request(body, sig.slice(0, 62))), false, "too short");
  assertEquals(await adapter.verifyWebhook(request(body, `${sig}00`)), false, "too long");
});

Deno.test("verifyWebhook fails closed when no secret is configured", async () => {
  const body = '{"events":[]}';
  for (const secret of [undefined, ""]) {
    const adapter = new FakeWebhookAdapter(secret);
    assertEquals(await adapter.verifyWebhook(request(body, await signFakeWebhook(body, "anything"))), false);
  }
});

// --- parseWebhook ---------------------------------------------------------------

const adapter = new FakeWebhookAdapter(SECRET);

Deno.test("parseWebhook normalises inbound, echo and status events in order", () => {
  const inbound = {
    id: "evt-1",
    kind: "inbound",
    phone: "98450 12345",
    text: "Hi, I need a quote",
    at: "2026-10-11T10:00:00Z",
    message_id: "fake-in-1",
    profile_name: " Asha Rao ",
  };
  const echo = { id: "evt-2", kind: "echo", phone: "+919845012345", text: "Hello Asha", at: "2026-10-11T10:05:00Z", message_id: "fake-echo-1" };
  const status = { id: "evt-3", kind: "status", phone: "919845012345", at: "2026-10-11T10:06:00Z", message_id: "fake-out-1", status: "read" };
  const events = adapter.parseWebhook({ events: [inbound, echo, status] });

  assertEquals(events, [
    {
      kind: "inbound",
      providerEventId: "evt-1",
      phone: "+919845012345",
      text: "Hi, I need a quote",
      at: new Date("2026-10-11T10:00:00Z"),
      providerMessageId: "fake-in-1",
      profileName: "Asha Rao",
      raw: inbound,
    },
    {
      kind: "echo",
      providerEventId: "evt-2",
      phone: "+919845012345",
      text: "Hello Asha",
      at: new Date("2026-10-11T10:05:00Z"),
      providerMessageId: "fake-echo-1",
      raw: echo,
    },
    {
      kind: "status",
      providerEventId: "evt-3",
      phone: "+919845012345",
      text: null,
      at: new Date("2026-10-11T10:06:00Z"),
      providerMessageId: "fake-out-1",
      status: "read",
      error: null,
      raw: status,
    },
  ]);
});

Deno.test("parseWebhook keeps a failed status's error, and gives one when the provider didn't", () => {
  const [a, b] = adapter.parseWebhook({
    events: [
      { id: "e1", kind: "status", at: "2026-10-11T10:00:00Z", message_id: "m1", status: "failed", error: "131047 outside window" },
      { id: "e2", kind: "status", at: "2026-10-11T10:00:00Z", message_id: "m2", status: "failed" },
    ],
  });
  assertEquals(a.kind === "status" && a.error, "131047 outside window");
  assertEquals(b.kind === "status" && b.error, "failed without an error");
});

Deno.test("parseWebhook gives a null phone for a number that is not an Indian mobile", () => {
  const [e] = adapter.parseWebhook({
    events: [{ id: "e1", kind: "inbound", phone: "+14155550100", text: "hi", at: "2026-10-11T10:00:00Z", message_id: "m1" }],
  });
  assertEquals(e.phone, null);
  assertEquals(e.kind === "inbound" && e.profileName, null);
});

Deno.test("parseWebhook allows no text (media) and an empty batch", () => {
  const [e] = adapter.parseWebhook({
    events: [{ id: "e1", kind: "inbound", phone: "9845012345", at: "2026-10-11T10:00:00Z", message_id: "m1" }],
  });
  assertEquals(e.text, null);
  assertEquals(adapter.parseWebhook({ events: [] }), []);
});

Deno.test("parseWebhook throws WebhookParseError on anything not in the fake format", () => {
  const ok = { id: "e1", kind: "inbound", phone: "9845012345", text: "hi", at: "2026-10-11T10:00:00Z", message_id: "m1" };
  const bad: unknown[] = [
    null,
    [],
    "events",
    {},
    { events: {} },
    { events: [null] },
    { events: [{ ...ok, id: "" }] },
    { events: [{ ...ok, id: 7 }] },
    { events: [{ ...ok, message_id: undefined }] },
    { events: [{ ...ok, at: "yesterday" }] },
    { events: [{ ...ok, at: undefined }] },
    { events: [{ ...ok, text: 12 }] },
    { events: [{ ...ok, kind: "reaction" }] },
    { events: [{ ...ok, kind: "status", status: "queued" }] },
    { events: [ok, { ...ok, kind: undefined }] },
  ];
  for (const body of bad) {
    assertThrows(() => adapter.parseWebhook(body), WebhookParseError, undefined, JSON.stringify(body));
  }
});

// --- getWebhookAdapter ----------------------------------------------------------

Deno.test("getWebhookAdapter returns the fake, keyed by WHATSAPP_WEBHOOK_SECRET, unless a real provider is named", async () => {
  const env = (vars: Record<string, string>) => (k: string) => vars[k];
  const a = getWebhookAdapter(env({ WHATSAPP_WEBHOOK_SECRET: SECRET }));
  assertInstanceOf(a, FakeWebhookAdapter);
  assertEquals(a.name, "fake");
  const body = '{"events":[]}';
  assert(await a.verifyWebhook(request(body, await signFakeWebhook(body, SECRET))));
  assertInstanceOf(getWebhookAdapter(env({ WHATSAPP_PROVIDER: "fake" })), FakeWebhookAdapter);
  assertThrows(() => getWebhookAdapter(env({ WHATSAPP_PROVIDER: "gupshup" })), Error, "Unknown WHATSAPP_PROVIDER");
});
