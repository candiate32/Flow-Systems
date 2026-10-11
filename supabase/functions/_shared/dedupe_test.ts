// deno-lint-ignore no-import-prefix -- test-only std dep; no shared deno.json by design
import { assertEquals } from "jsr:@std/assert@1";
import { isDuplicateEnquiry } from "./dedupe.ts";

const now = new Date("2026-10-11T12:00:00.000Z");
const H = 3_600_000;

Deno.test("isDuplicateEnquiry is false for a first enquiry", () => {
  assertEquals(isDuplicateEnquiry(null, now), false);
});

Deno.test("isDuplicateEnquiry is true within 24 hours", () => {
  assertEquals(isDuplicateEnquiry(now, now), true);
  assertEquals(isDuplicateEnquiry(new Date(now.getTime() - 5 * 60_000), now), true);
  assertEquals(isDuplicateEnquiry(new Date(now.getTime() - 24 * H + 1), now), true);
});

Deno.test("isDuplicateEnquiry is false at exactly 24 hours and later", () => {
  assertEquals(isDuplicateEnquiry(new Date(now.getTime() - 24 * H), now), false);
  assertEquals(isDuplicateEnquiry(new Date(now.getTime() - 24 * H - 1), now), false);
  assertEquals(isDuplicateEnquiry(new Date(now.getTime() - 30 * 24 * H), now), false);
});

Deno.test("isDuplicateEnquiry treats a future last enquiry (clock skew) as duplicate", () => {
  assertEquals(isDuplicateEnquiry(new Date(now.getTime() + 1000), now), true);
});
