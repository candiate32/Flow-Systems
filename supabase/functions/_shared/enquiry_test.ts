// deno-lint-ignore no-import-prefix -- test-only std dep; no shared deno.json by design
import { assert, assertEquals } from "jsr:@std/assert@1";
import { DETAILS_KEY_RE, DETAILS_MAX_KEYS, DETAILS_VALUE_MAX, parseEnquiry } from "./enquiry.ts";

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
    details: {},
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

// --- details (spec 003, bar 6) ---------------------------------------------

Deno.test("details limits match the spec", () => {
  assertEquals(DETAILS_MAX_KEYS, 10);
  assertEquals(DETAILS_VALUE_MAX, 200);
  for (const k of ["a", "budget", "rooms_2", "a".repeat(32)]) assert(DETAILS_KEY_RE.test(k), k);
  for (const k of ["", "Budget", "1rooms", "_x", "rooms-2", "a b", "a".repeat(33), "café"]) {
    assert(!DETAILS_KEY_RE.test(k), k);
  }
});

Deno.test("parseEnquiry treats missing or null details as an empty object", () => {
  for (const details of [undefined, null]) {
    const r = parseEnquiry({ ...base, details });
    assert(r.ok, String(details));
    assertEquals(r.value.details, {});
  }
});

Deno.test("parseEnquiry accepts valid details, trimming values and dropping blanks", () => {
  const r = parseEnquiry({
    ...base,
    details: { budget: " 10-15L ", rooms: "Kitchen, Living", call_time: "   ", note: "" },
  });
  assert(r.ok);
  assertEquals(r.value.details, { budget: "10-15L", rooms: "Kitchen, Living" });
});

Deno.test("parseEnquiry accepts exactly 10 keys and 200-character values", () => {
  const ten = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`q${i}`, "x"]));
  const r = parseEnquiry({ ...base, details: ten });
  assert(r.ok);
  assertEquals(Object.keys(r.value.details).length, 10);

  const long = parseEnquiry({ ...base, details: { note: `  ${"a".repeat(200)}  ` } });
  assert(long.ok);
  assertEquals(long.value.details.note.length, 200);
  // Counted in characters, not UTF-16 units.
  assert(parseEnquiry({ ...base, details: { note: "😀".repeat(200) } }).ok);
});

Deno.test("parseEnquiry rejects details that are not a plain object", () => {
  for (const details of ["budget", 42, true, [], [["budget", "x"]]]) {
    const e = errorsOf({ ...base, details });
    assertEquals(Object.keys(e), ["details"], JSON.stringify(details));
    assert(e.details.length > 0);
  }
});

Deno.test("parseEnquiry rejects more than 10 details keys", () => {
  const eleven = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`q${i}`, "x"]));
  const e = errorsOf({ ...base, details: eleven });
  assertEquals(Object.keys(e), ["details"]);
  assert(e.details.includes("10"), e.details);
});

Deno.test("parseEnquiry rejects details keys that do not match the pattern", () => {
  for (const key of ["Budget", "1rooms", "rooms-2", "a".repeat(33), "", "__proto__x", "call time"]) {
    const e = errorsOf({ ...base, details: { [key]: "x" } });
    assertEquals(Object.keys(e), ["details"], key);
  }
});

Deno.test("parseEnquiry rejects non-string details values", () => {
  for (const value of [5, true, null, ["a"], { a: "b" }]) {
    const e = errorsOf({ ...base, details: { budget: value } });
    assertEquals(Object.keys(e), ["details"], JSON.stringify(value));
    assert(e.details.includes("budget"), e.details);
  }
});

Deno.test("parseEnquiry rejects details values over 200 characters", () => {
  const e = errorsOf({ ...base, details: { note: "a".repeat(201) } });
  assertEquals(Object.keys(e), ["details"]);
  assert(e.details.includes("note") && e.details.includes("200"), e.details);
});

Deno.test("parseEnquiry reports details alongside other field errors", () => {
  const e = errorsOf({ ...base, name: "", details: { Bad: "x" } });
  assertEquals(Object.keys(e).sort(), ["details", "name"]);
});
