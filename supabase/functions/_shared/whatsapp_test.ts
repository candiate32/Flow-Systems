// deno-lint-ignore no-import-prefix -- test-only std dep; no shared deno.json by design
import { assert, assertEquals, assertInstanceOf, assertMatch, assertNotEquals, assertThrows } from "jsr:@std/assert@1";
import { FakeWhatsAppProvider, getWhatsAppProvider } from "./whatsapp.ts";

const UUID = /^fake-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

Deno.test("FakeWhatsAppProvider records sends and returns fake-<uuid> ids", async () => {
  const p = new FakeWhatsAppProvider();
  assertEquals(p.name, "fake");
  assertEquals(p.sent.length, 0);
  const msg = {
    to: "+919845012345",
    template: "enquiry_ack" as const,
    language: "en",
    params: ["Asha", "Demo Interiors"],
  };
  const a = await p.sendTemplate(msg);
  const b = await p.sendTemplate({ ...msg, template: "owner_alert", to: "+919000000001" });
  assertMatch(a.providerMessageId, UUID);
  assertMatch(b.providerMessageId, UUID);
  assertNotEquals(a.providerMessageId, b.providerMessageId);
  assertEquals(p.sent.length, 2);
  assertEquals(p.sent[0].to, "+919845012345");
  assertEquals(p.sent[0].template, "enquiry_ack");
  assertEquals(p.sent[0].params, ["Asha", "Demo Interiors"]);
  assertEquals(p.sent[0].providerMessageId, a.providerMessageId);
  assertEquals(p.sent[1].template, "owner_alert");
});

Deno.test("FakeWhatsAppProvider copies params so later mutation does not change the record", async () => {
  const p = new FakeWhatsAppProvider();
  const params = ["Asha"];
  await p.sendTemplate({ to: "+919845012345", template: "followup_1", language: "en", params });
  params.push("changed");
  assertEquals(p.sent[0].params, ["Asha"]);
});

Deno.test("FakeWhatsAppProvider records session messages apart from templates", async () => {
  const p = new FakeWhatsAppProvider();
  const a = await p.sendSession({ to: "+919845012345", text: "Hi Asha" });
  assertMatch(a.providerMessageId, UUID);
  assertEquals(p.sessions, [{ to: "+919845012345", text: "Hi Asha", providerMessageId: a.providerMessageId }]);
  assertEquals(p.sent.length, 0);
});

Deno.test("getWhatsAppProvider returns the fake by default", () => {
  assertInstanceOf(getWhatsAppProvider(() => undefined), FakeWhatsAppProvider);
  assertInstanceOf(getWhatsAppProvider(() => ""), FakeWhatsAppProvider);
  assertInstanceOf(
    getWhatsAppProvider((k) => (k === "WHATSAPP_PROVIDER" ? "fake" : undefined)),
    FakeWhatsAppProvider,
  );
});

Deno.test("getWhatsAppProvider throws on unknown provider names", () => {
  for (const name of ["meta", "gupshup", "FAKE ", "twilio"]) {
    const err = assertThrows(() => getWhatsAppProvider((k) => (k === "WHATSAPP_PROVIDER" ? name : undefined)));
    assert(err instanceof Error && err.message.includes(name), name);
  }
});
