// deno-lint-ignore no-import-prefix -- test-only std dep; no shared deno.json by design
import { assertEquals } from "jsr:@std/assert@1";
import { normalizeIndianMobile } from "./phone.ts";

const valid: [string, string][] = [
  ["9845012345", "+919845012345"],
  ["98450 12345", "+919845012345"],
  ["098450-12345", "+919845012345"],
  ["+91 98450 12345", "+919845012345"],
  ["+91-98450-12345", "+919845012345"],
  ["+91 (98450) 12345", "+919845012345"],
  ["0091 98450 12345", "+919845012345"],
  ["00919845012345", "+919845012345"],
  ["919845012345", "+919845012345"],
  ["  98450 12345  ", "+919845012345"],
  ["6000000000", "+916000000000"],
  ["7012345678", "+917012345678"],
  ["8123456789", "+918123456789"],
  // Bangalore landlines (080 + 8 digits) are digit-for-digit identical to
  // 80xx mobiles, which exist, so they cannot be told apart and are accepted.
  ["080 2345 6789", "+918023456789"],
  // A 10-digit number that happens to start with 91 is still a mobile.
  ["9123456789", "+919123456789"],
];

for (const [input, expected] of valid) {
  Deno.test(`normalizeIndianMobile accepts ${JSON.stringify(input)}`, () => {
    assertEquals(normalizeIndianMobile(input), expected);
  });
}

const invalid = [
  "",
  "   ",
  "5845012345", // starts with 5
  "011 2345 6789", // Delhi landline
  "01123456789",
  "+91 11 2345 6789",
  "020-2345-6789", // Pune landline
  "2345 6789", // Bangalore landline without STD code (8 digits)
  "(080) 2345678", // short landline
  "0123456789",
  "98450123456", // 11 digits, no leading 0
  "984501234", // 9 digits
  "+91 98450 1234", // too short after +91
  "+919845012345 6", // too long
  "98450abcde",
  "98450 12345x",
  "abc",
  "+1 415 555 0100", // non-Indian
  "+44 7700 900123",
  "0919845012345", // stray 0 before 91
  "9+19845012345", // plus not leading
  "++919845012345",
  "98450.12345",
  "919845012345 ext 2",
];

for (const input of invalid) {
  Deno.test(`normalizeIndianMobile rejects ${JSON.stringify(input)}`, () => {
    assertEquals(normalizeIndianMobile(input), null);
  });
}

Deno.test("normalizeIndianMobile rejects non-string input at runtime", () => {
  assertEquals(normalizeIndianMobile(undefined as unknown as string), null);
  assertEquals(normalizeIndianMobile(9845012345 as unknown as string), null);
});
