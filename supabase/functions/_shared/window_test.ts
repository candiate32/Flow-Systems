// deno-lint-ignore no-import-prefix -- test-only std dep; no shared deno.json by design
import { assertEquals } from "jsr:@std/assert@1";
import { isInsideServiceWindow } from "./window.ts";

const now = new Date("2026-10-11T12:00:00.000Z");
const H = 3_600_000;

Deno.test("isInsideServiceWindow is false when the lead never messaged us", () => {
  assertEquals(isInsideServiceWindow(null, now), false);
});

Deno.test("isInsideServiceWindow is true just now and 1 ms before 24 h", () => {
  assertEquals(isInsideServiceWindow(now, now), true);
  assertEquals(isInsideServiceWindow(new Date(now.getTime() - H), now), true);
  assertEquals(isInsideServiceWindow(new Date(now.getTime() - 24 * H + 1), now), true);
});

Deno.test("isInsideServiceWindow is false at exactly 24 h and after", () => {
  assertEquals(isInsideServiceWindow(new Date(now.getTime() - 24 * H), now), false);
  assertEquals(isInsideServiceWindow(new Date(now.getTime() - 24 * H - 1), now), false);
  assertEquals(isInsideServiceWindow(new Date(now.getTime() - 72 * H), now), false);
});

Deno.test("isInsideServiceWindow at 23:59 since the lead's message is inside, at 24:01 outside (spec 004, B.2)", () => {
  const M = 60_000;
  assertEquals(isInsideServiceWindow(new Date(now.getTime() - (23 * H + 59 * M)), now), true);
  assertEquals(isInsideServiceWindow(new Date(now.getTime() - (24 * H + 1 * M)), now), false);
});

Deno.test("isInsideServiceWindow treats a slightly future inbound (clock skew) as inside", () => {
  assertEquals(isInsideServiceWindow(new Date(now.getTime() + 1000), now), true);
});
