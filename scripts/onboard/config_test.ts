// deno-lint-ignore no-import-prefix -- test-only std dep; no shared deno.json by design
import { assert, assertEquals } from "jsr:@std/assert@1";
import { type ConfigResult, formatError, parseOrgConfig } from "./config.ts";
import { parseJsonWithPositions } from "./json.ts";

const SAMPLE = new URL("../../onboarding/demo-interiors.json", import.meta.url);

function errorsOf(r: ConfigResult): string[] {
  assert(!r.ok, "expected errors");
  return r.errors.map((e) => formatError("c.json", e));
}

/** A valid config, pretty-printed (one field per line) with overrides. */
function config(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify(
    {
      slug: "lime-and-lattice",
      name: "Lime & Lattice",
      owner_alert_phones: ["98450 12345"],
      sources: [{ kind: "web_form", name: "Website form", public_key: "lime-web-form" }],
      templates: [{ name: "enquiry_ack", body: "Hi {{1}}, thanks for contacting {{2}}.", param_names: ["a", "b"] }],
      ...overrides,
    },
    null,
    2,
  );
}

// --- JSON with positions ------------------------------------------------------

Deno.test("json: records the line and column of every value", () => {
  const { value, positions } = parseJsonWithPositions('{\n  "a": [1,\n    {"b": "x"}],\n  "c": null\n}');
  assertEquals(value, { a: [1, { b: "x" }], c: null });
  assertEquals(positions.get(""), { line: 1, col: 1 });
  assertEquals(positions.get("a"), { line: 2, col: 8 });
  assertEquals(positions.get("a[1].b"), { line: 3, col: 11 });
  assertEquals(positions.get("c"), { line: 4, col: 8 });
});

Deno.test("json: same values as JSON.parse, escapes included", () => {
  const text = '{"s": "a\\"b\\u00e9\\n", "n": -1.5e3, "t": true, "f": false, "z": [], "o": {}}';
  assertEquals(parseJsonWithPositions(text).value, JSON.parse(text));
});

Deno.test("config: syntax errors name the line and column", () => {
  assertEquals(errorsOf(parseOrgConfig('{\n  "slug": "x",\n  "name": "y"\n  "sources": []\n}')), [
    'c.json:4:3: Invalid JSON: Unexpected "\\"", expected "," or "}"',
  ]);
  assertEquals(errorsOf(parseOrgConfig('{\n  "slug": "x",\n}')), [
    'c.json:3:1: Invalid JSON: Unexpected "}", expected a "quoted" key',
  ]);
  assertEquals(errorsOf(parseOrgConfig('{"slug": "a",\n "slug": "b"}')), [
    'c.json:2:2: Invalid JSON: Duplicate key "slug"',
  ]);
  assertEquals(errorsOf(parseOrgConfig("")), ["c.json:1:1: Invalid JSON: Unexpected end of file, expected a value"]);
});

// --- Valid configs ------------------------------------------------------------

Deno.test("config: the sample onboarding/demo-interiors.json is valid and matches the seed", async () => {
  const r = parseOrgConfig(await Deno.readTextFile(SAMPLE));
  if (!r.ok) throw new Error(r.errors.map((e) => formatError("sample", e)).join("\n"));
  assertEquals(r.config.id, "00000000-0000-4000-8000-000000000001");
  assertEquals(r.config.slug, "demo-interiors");
  assertEquals(r.config.name, "Lime & Lattice, Sarjapur Road");
  assertEquals(r.config.is_demo, true);
  assertEquals(r.config.owner_alert_phones, ["+919000000001"]);
  assertEquals(r.config.whatsapp_fallback_phone, "+919000000001");
  assertEquals(r.config.sources, [{ kind: "web_form", name: "Demo landing page form", public_key: "demo-web-form" }]);
  assertEquals(r.config.templates.map((t) => t.name), ["enquiry_ack", "owner_alert"]);
});

Deno.test("config: phones are normalised to +91, defaults are filled in", () => {
  const r = parseOrgConfig(config({ owner_alert_phones: ["98450 12345", "+91 (98450) 54321"] }));
  assert(r.ok);
  assertEquals(r.config.owner_alert_phones, ["+919845012345", "+919845054321"]);
  assertEquals(r.config.timezone, "Asia/Kolkata");
  assertEquals(r.config.is_demo, false);
  assertEquals(r.config.is_canary, false);
  assertEquals(r.config.whatsapp_fallback_phone, null);
  assertEquals(r.config.templates[0], {
    name: "enquiry_ack",
    language: "en",
    body: "Hi {{1}}, thanks for contacting {{2}}.",
    param_names: ["a", "b"],
  });
});

// --- Errors, each with its line ----------------------------------------------

Deno.test("config: a phone that isn't an Indian mobile is reported on its line", () => {
  const text = config({ owner_alert_phones: ["98450 12345", "12345"], whatsapp_fallback_phone: "+1 415 555 0100" });
  assertEquals(errorsOf(parseOrgConfig(text)), [
    'c.json:6:5: owner_alert_phones[1]: "12345" is not an Indian mobile number (10 digits, starting 6-9)',
    'c.json:25:30: whatsapp_fallback_phone: "+1 415 555 0100" is not an Indian mobile number (10 digits, starting 6-9)',
  ]);
});

Deno.test("config: the same owner number twice is an error", () => {
  assertEquals(errorsOf(parseOrgConfig(config({ owner_alert_phones: ["9845012345", "+91 98450 12345"] }))), [
    "c.json:6:5: owner_alert_phones[1]: is the same number as owner_alert_phones[0]",
  ]);
});

Deno.test("config: a malformed slug is reported", () => {
  for (const slug of ["Lime_Lattice", "-lime", "li", "lime--lattice", "lime lattice"]) {
    const errs = errorsOf(parseOrgConfig(config({ slug })));
    assertEquals(errs, [
      "c.json:2:11: slug: must be 3-48 lowercase letters, digits and single hyphens, e.g. lime-and-lattice",
    ], slug);
  }
});

Deno.test("config: an unknown template name is reported with the known set", () => {
  const errs = errorsOf(parseOrgConfig(config({
    templates: [{ name: "followup", body: "Hi {{1}}, still keen?", param_names: ["a"] }],
  })));
  assertEquals(errs, [
    'c.json:16:15: templates[0].name: "followup" is not a template the engine sends; use one of enquiry_ack, ' +
    "owner_alert, followup_1, followup_2, followup_3, weekly_summary, ops_alert",
  ]);
});

Deno.test("config: placeholders must match param_names, and may not start or end the body", () => {
  const errs = errorsOf(parseOrgConfig(config({
    templates: [
      { name: "enquiry_ack", body: "Hi {{1}}, from {{3}}.", param_names: ["a", "b"] },
      { name: "owner_alert", body: "{{1}} enquired", param_names: ["a"] },
      { name: "followup_1", body: "Still keen, {{1}}", param_names: ["a"] },
    ],
  })));
  assertEquals(errs, [
    "c.json:17:15: templates[0].body: uses {{3}} but param_names has only 2 name(s)",
    "c.json:17:15: templates[0].body: never uses {{2}} from param_names",
    "c.json:25:15: templates[1].body: must not start or end with a placeholder (WhatsApp rejects such templates)",
    "c.json:32:15: templates[2].body: must not start or end with a placeholder (WhatsApp rejects such templates)",
  ]);
});

Deno.test("config: unknown fields, missing fields and duplicates are reported", () => {
  const text = `{
  "slug": "lime-and-lattice",
  "nmae": "Lime & Lattice",
  "sources": [
    { "kind": "web_form", "name": "Form", "public_key": "lime-web" },
    { "kind": "web_form", "name": "Form 2", "public_key": "lime-web" },
    { "kind": "email", "name": "Mail", "public_key": "lime-mail" }
  ],
  "templates": [
    { "name": "enquiry_ack", "body": "Hi {{1}}, thanks.", "param_names": ["a"] },
    { "name": "enquiry_ack", "body": "Hello {{1}}, thanks.", "param_names": ["a"], "status": "live" }
  ]
}`;
  assertEquals(errorsOf(parseOrgConfig(text)), [
    "c.json:1:1: name: is required",
    "c.json:3:11: nmae: unknown field; expected one of id, slug, name, timezone, is_demo, is_canary, " +
    "owner_alert_phones, whatsapp_fallback_phone, sources, templates",
    "c.json:6:59: sources[1].public_key: is already used by sources[0]",
    "c.json:7:15: sources[2].kind: must be one of web_form, whatsapp_inbound",
    "c.json:11:5: templates[1]: duplicates templates[0] (same name and language)",
    "c.json:11:94: templates[1].status: must be one of draft, submitted, approved, rejected",
  ]);
});

Deno.test("config: sources are required and the time zone must exist", () => {
  assertEquals(errorsOf(parseOrgConfig(config({ sources: [], timezone: "India/Bangalore" }))), [
    "c.json:7:14: sources: list at least the studio's web form",
    'c.json:18:15: timezone: "India/Bangalore" is not an IANA time zone',
  ]);
});
