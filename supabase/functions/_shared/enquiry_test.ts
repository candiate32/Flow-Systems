// deno-lint-ignore no-import-prefix -- test-only std dep; no shared deno.json by design
import { assert, assertEquals } from "jsr:@std/assert@1";
import { parseEnquiry } from "./enquiry.ts";

const base = {
  source_key: "demo-web-form",
  name: "Asha Rao",
  phone: "98450 12345",
  bhk: "3BHK",
  possession_month: "2027-03",
  consent: true,
  turnstile_token: "tok",
};

function errorsOf(body: unknown): Record<string, string> {
  const r = parseEnquiry(body);
  assert(!r.ok, "expected validation to fail");
  return r.errors;
}

Deno.test("parseEnquiry accepts a full valid body", () => {
  const r = parseEnquiry(base);
  assert(r.ok);
  assertEquals(r.value, {
    sourceKey: "demo-web-form",
    name: "Asha Rao",
    phone: "+919845012345",
    bhk: "3BHK",
    possessionMonth: "2027-03",
    consent: true,
    turnstileToken: "tok",
  });
});

Deno.test("parseEnquiry trims name and source key", () => {
  const r = parseEnquiry({ ...base, name: "  Asha Rao \n", source_key: " demo-web-form " });
  assert(r.ok);
  assertEquals(r.value.name, "Asha Rao");
  assertEquals(r.value.sourceKey, "demo-web-form");
});

Deno.test("parseEnquiry treats optional fields as null when missing, null or blank", () => {
  for (
    const extra of [{}, { bhk: null, possession_month: null, turnstile_token: null }, {
      bhk: "",
      possession_month: "  ",
      turnstile_token: "",
    }]
  ) {
    const { bhk: _b, possession_month: _p, turnstile_token: _t, ...rest } = base;
    const r = parseEnquiry({ ...rest, ...extra });
    assert(r.ok, JSON.stringify(extra));
    assertEquals(r.value.bhk, null);
    assertEquals(r.value.possessionMonth, null);
    assertEquals(r.value.turnstileToken, null);
  }
});

Deno.test("parseEnquiry accepts every allowed BHK value", () => {
  for (const bhk of ["1BHK", "2BHK", "3BHK", "4BHK+", "Villa", "Office"]) {
    const r = parseEnquiry({ ...base, bhk });
    assert(r.ok, bhk);
    assertEquals(r.value.bhk, bhk);
  }
});

Deno.test("parseEnquiry rejects non-object bodies", () => {
  for (const body of [null, undefined, "x", 42, [], true]) {
    const e = errorsOf(body);
    assert(Object.keys(e).length > 0, String(body));
  }
});

Deno.test("parseEnquiry reports source_key errors", () => {
  assert("source_key" in errorsOf({ ...base, source_key: undefined }));
  assert("source_key" in errorsOf({ ...base, source_key: "   " }));
  assert("source_key" in errorsOf({ ...base, source_key: 7 }));
});

Deno.test("parseEnquiry reports name errors", () => {
  assert("name" in errorsOf({ ...base, name: undefined }));
  assert("name" in errorsOf({ ...base, name: "" }));
  assert("name" in errorsOf({ ...base, name: "    " }));
  assert("name" in errorsOf({ ...base, name: 12 }));
  assert("name" in errorsOf({ ...base, name: "a".repeat(81) }));
});

Deno.test("parseEnquiry name length bounds are 1 and 80 after trimming", () => {
  const one = parseEnquiry({ ...base, name: " A " });
  assert(one.ok);
  assertEquals(one.value.name, "A");
  const eighty = parseEnquiry({ ...base, name: `  ${"a".repeat(80)}  ` });
  assert(eighty.ok);
  assertEquals(eighty.value.name.length, 80);
  // 80 non-BMP characters count as 80, not 160.
  const emoji = parseEnquiry({ ...base, name: "😀".repeat(80) });
  assert(emoji.ok);
});

Deno.test("parseEnquiry reports phone errors", () => {
  assert("phone" in errorsOf({ ...base, phone: undefined }));
  assert("phone" in errorsOf({ ...base, phone: "" }));
  assert("phone" in errorsOf({ ...base, phone: "011 2345 6789" }));
  assert("phone" in errorsOf({ ...base, phone: 9845012345 }));
});

Deno.test("parseEnquiry reports bhk errors", () => {
  assert("bhk" in errorsOf({ ...base, bhk: "5BHK" }));
  assert("bhk" in errorsOf({ ...base, bhk: "3bhk" }));
  assert("bhk" in errorsOf({ ...base, bhk: 3 }));
});

Deno.test("parseEnquiry reports possession_month errors", () => {
  for (const m of ["2027-13", "2027-00", "2027-3", "27-03", "2027/03", "March", "2027-03-01", 202703]) {
    assert("possession_month" in errorsOf({ ...base, possession_month: m }), String(m));
  }
});

Deno.test("parseEnquiry requires consent to be exactly true", () => {
  for (const consent of [undefined, false, "true", 1, "on", null]) {
    assert("consent" in errorsOf({ ...base, consent }), String(consent));
  }
});

Deno.test("parseEnquiry reports turnstile_token type errors", () => {
  assert("turnstile_token" in errorsOf({ ...base, turnstile_token: 5 }));
});

Deno.test("parseEnquiry reports every bad field at once", () => {
  const e = errorsOf({
    source_key: "",
    name: "",
    phone: "abc",
    bhk: "Castle",
    possession_month: "soon",
    consent: false,
    turnstile_token: {},
  });
  assertEquals(Object.keys(e).sort(), [
    "bhk",
    "consent",
    "name",
    "phone",
    "possession_month",
    "source_key",
    "turnstile_token",
  ]);
  for (const msg of Object.values(e)) assert(msg.length > 0);
});
