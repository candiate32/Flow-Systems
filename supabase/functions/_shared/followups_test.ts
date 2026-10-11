// deno-lint-ignore no-import-prefix -- test-only std dep; no shared deno.json by design
import { assertEquals } from "jsr:@std/assert@1";
import { followUpTimes } from "./followups.ts";

// 11:00 IST is 05:30 UTC.
const iso = (ds: Date[]) => ds.map((d) => d.toISOString());

Deno.test("followUpTimes: mid-day IST enquiry", () => {
  // 2026-10-11 14:00 IST
  assertEquals(iso(followUpTimes(new Date("2026-10-11T08:30:00Z"))), [
    "2026-10-12T05:30:00.000Z",
    "2026-10-14T05:30:00.000Z",
    "2026-10-18T05:30:00.000Z",
  ]);
});

Deno.test("followUpTimes: 23:30 IST uses that IST date", () => {
  // 2026-10-11 23:30 IST = 2026-10-11 18:00 UTC
  assertEquals(iso(followUpTimes(new Date("2026-10-11T18:00:00Z"))), [
    "2026-10-12T05:30:00.000Z",
    "2026-10-14T05:30:00.000Z",
    "2026-10-18T05:30:00.000Z",
  ]);
});

Deno.test("followUpTimes: 00:30 IST is the next IST date though UTC date is earlier", () => {
  // 2026-10-12 00:30 IST = 2026-10-11 19:00 UTC
  assertEquals(iso(followUpTimes(new Date("2026-10-11T19:00:00Z"))), [
    "2026-10-13T05:30:00.000Z",
    "2026-10-15T05:30:00.000Z",
    "2026-10-19T05:30:00.000Z",
  ]);
});

Deno.test("followUpTimes: IST midnight exactly belongs to the new day", () => {
  // 2026-10-12 00:00 IST = 2026-10-11 18:30 UTC
  assertEquals(followUpTimes(new Date("2026-10-11T18:30:00Z"))[0].toISOString(), "2026-10-13T05:30:00.000Z");
  // one ms before is still 2026-10-11 IST
  assertEquals(
    followUpTimes(new Date("2026-10-11T18:29:59.999Z"))[0].toISOString(),
    "2026-10-12T05:30:00.000Z",
  );
});

Deno.test("followUpTimes: enquiry before 11:00 IST still waits until the next day", () => {
  // 2026-10-11 09:00 IST
  assertEquals(followUpTimes(new Date("2026-10-11T03:30:00Z"))[0].toISOString(), "2026-10-12T05:30:00.000Z");
});

Deno.test("followUpTimes: crosses month and year ends", () => {
  // 2026-12-30 22:00 IST
  assertEquals(iso(followUpTimes(new Date("2026-12-30T16:30:00Z"))), [
    "2026-12-31T05:30:00.000Z",
    "2027-01-02T05:30:00.000Z",
    "2027-01-06T05:30:00.000Z",
  ]);
  // 2028-02-27 10:00 IST (leap year)
  assertEquals(iso(followUpTimes(new Date("2028-02-27T04:30:00Z"))), [
    "2028-02-28T05:30:00.000Z",
    "2028-03-01T05:30:00.000Z",
    "2028-03-05T05:30:00.000Z",
  ]);
});

Deno.test("followUpTimes returns three strictly increasing times after the enquiry", () => {
  const at = new Date("2026-10-11T08:30:00Z");
  const t = followUpTimes(at);
  assertEquals(t.length, 3);
  assertEquals(t[0] > at && t[1] > t[0] && t[2] > t[1], true);
});
