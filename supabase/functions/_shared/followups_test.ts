// deno-lint-ignore no-import-prefix -- test-only std dep; no shared deno.json by design
import { assertEquals } from "jsr:@std/assert@1";
import {
  decideFollowUp,
  type FollowUpLead,
  followUpIdempotencyKey,
  followUpJobs,
  followUpTimes,
  isQuietHour,
  outOfQuietHours,
  parseFollowUpPayload,
} from "./followups.ts";

// 11:00 IST is 05:30 UTC.
const isoAll = (ds: Date[]) => ds.map((d) => d.toISOString());

Deno.test("followUpTimes: mid-day IST enquiry", () => {
  // 2026-10-11 14:00 IST
  assertEquals(isoAll(followUpTimes(new Date("2026-10-11T08:30:00Z"))), [
    "2026-10-12T05:30:00.000Z",
    "2026-10-14T05:30:00.000Z",
    "2026-10-18T05:30:00.000Z",
  ]);
});

Deno.test("followUpTimes: 23:30 IST uses that IST date", () => {
  // 2026-10-11 23:30 IST = 2026-10-11 18:00 UTC
  assertEquals(isoAll(followUpTimes(new Date("2026-10-11T18:00:00Z"))), [
    "2026-10-12T05:30:00.000Z",
    "2026-10-14T05:30:00.000Z",
    "2026-10-18T05:30:00.000Z",
  ]);
});

Deno.test("followUpTimes: 00:30 IST is the next IST date though UTC date is earlier", () => {
  // 2026-10-12 00:30 IST = 2026-10-11 19:00 UTC
  assertEquals(isoAll(followUpTimes(new Date("2026-10-11T19:00:00Z"))), [
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
  assertEquals(isoAll(followUpTimes(new Date("2026-12-30T16:30:00Z"))), [
    "2026-12-31T05:30:00.000Z",
    "2027-01-02T05:30:00.000Z",
    "2027-01-06T05:30:00.000Z",
  ]);
  // 2028-02-27 10:00 IST (leap year)
  assertEquals(isoAll(followUpTimes(new Date("2028-02-27T04:30:00Z"))), [
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

// --- Quiet hours (21:00 to 09:00 IST) ----------------------------------------

/** An IST wall-clock time on 2026-10-11 (or another day) as a UTC instant. */
const ist = (hhmm: string, day = "2026-10-11") => new Date(`${day}T${hhmm}:00.000+05:30`);

Deno.test("isQuietHour: 21:00 up to 09:00 IST is quiet, 09:00 up to 21:00 is not", () => {
  for (const t of ["21:00", "21:30", "23:59", "00:00", "03:00", "08:59"]) assertEquals(isQuietHour(ist(t)), true, t);
  for (const t of ["09:00", "11:00", "14:00", "20:59"]) assertEquals(isQuietHour(ist(t)), false, t);
  assertEquals(isQuietHour(new Date(ist("21:00").getTime() - 1)), false, "20:59:59.999");
  assertEquals(isQuietHour(new Date(ist("09:00").getTime() - 1)), true, "08:59:59.999");
});

Deno.test("outOfQuietHours leaves daytime alone", () => {
  for (const t of ["09:00", "11:00", "20:59"]) {
    assertEquals(outOfQuietHours(ist(t)).toISOString(), ist(t).toISOString(), t);
  }
});

Deno.test("outOfQuietHours moves late evening to 09:00 IST the next day", () => {
  assertEquals(outOfQuietHours(ist("21:00")).toISOString(), ist("09:00", "2026-10-12").toISOString());
  assertEquals(outOfQuietHours(ist("23:59")).toISOString(), ist("09:00", "2026-10-12").toISOString());
  // 2026-12-31 22:00 IST crosses into the new year
  assertEquals(outOfQuietHours(ist("22:00", "2026-12-31")).toISOString(), ist("09:00", "2027-01-01").toISOString());
});

Deno.test("outOfQuietHours moves early morning to 09:00 IST the same IST day", () => {
  assertEquals(outOfQuietHours(ist("00:00")).toISOString(), ist("09:00").toISOString());
  assertEquals(outOfQuietHours(ist("04:30")).toISOString(), ist("09:00").toISOString());
  assertEquals(outOfQuietHours(ist("08:59")).toISOString(), ist("09:00").toISOString());
  // 00:30 IST on the 12th is still the 11th in UTC; 09:00 IST on the 12th is 03:30 UTC.
  assertEquals(outOfQuietHours(new Date("2026-10-11T19:00:00Z")).toISOString(), "2026-10-12T03:30:00.000Z");
});

// --- Jobs an enquiry enqueues -------------------------------------------------

const LEAD = "11111111-2222-4333-8444-555555555555";

Deno.test("followUpJobs: three jobs at 11:00 IST on day 1, 3, 7 with keys and payload { n, enquiry_at }", () => {
  const at = new Date("2026-10-11T08:30:00.000Z");
  assertEquals(followUpJobs(LEAD, at), [
    {
      run_at: "2026-10-12T05:30:00.000Z",
      idempotency_key: `followup:${LEAD}:1:2026-10-11T08:30:00.000Z`,
      payload: { n: 1, enquiry_at: "2026-10-11T08:30:00.000Z" },
    },
    {
      run_at: "2026-10-14T05:30:00.000Z",
      idempotency_key: `followup:${LEAD}:2:2026-10-11T08:30:00.000Z`,
      payload: { n: 2, enquiry_at: "2026-10-11T08:30:00.000Z" },
    },
    {
      run_at: "2026-10-18T05:30:00.000Z",
      idempotency_key: `followup:${LEAD}:3:2026-10-11T08:30:00.000Z`,
      payload: { n: 3, enquiry_at: "2026-10-11T08:30:00.000Z" },
    },
  ]);
});

Deno.test("followUpJobs: every run_at is outside quiet hours, whatever the enquiry time", () => {
  for (let h = 0; h < 48; h++) {
    const at = new Date(Date.UTC(2026, 9, 11, h, 17));
    for (const j of followUpJobs(LEAD, at)) assertEquals(isQuietHour(new Date(j.run_at)), false, j.run_at);
  }
});

Deno.test("followUpIdempotencyKey names the lead, the follow-up and the enquiry", () => {
  assertEquals(
    followUpIdempotencyKey(LEAD, 2, new Date("2026-10-11T08:30:00Z")),
    `followup:${LEAD}:2:2026-10-11T08:30:00.000Z`,
  );
});

Deno.test("parseFollowUpPayload accepts { n: 1..3, enquiry_at } and nothing else", () => {
  assertEquals(parseFollowUpPayload({ n: 2, enquiry_at: "2026-10-11T08:30:00.000Z" }), {
    n: 2,
    enquiryAt: new Date("2026-10-11T08:30:00.000Z"),
  });
  const at = "2026-10-11T08:30:00Z";
  const bad = [null, [], "x", {}, { n: 0, enquiry_at: at }, { n: 4, enquiry_at: at }, { n: "1", enquiry_at: at }, {
    n: 1,
  }, { n: 1, enquiry_at: "not a date" }];
  for (const b of bad) assertEquals(parseFollowUpPayload(b), null, JSON.stringify(b));
});

// --- What a follow-up does when it runs ---------------------------------------

const ENQ = ist("14:00"); // 2026-10-11 14:00 IST
const DAY1 = ist("11:00", "2026-10-12");
const H = 3_600_000;
const MIN = 60_000;
const iso = (d: Date) => d.toISOString();
const fresh = (over: Partial<FollowUpLead> = {}): FollowUpLead => ({
  consent_at: iso(ENQ),
  opted_out_at: null,
  last_inbound_at: null,
  first_human_reply_at: null,
  last_human_reply_at: null,
  ...over,
});

Deno.test("decideFollowUp: a fresh lead outside the window gets the template", () => {
  assertEquals(decideFollowUp(fresh(), ENQ, DAY1), { action: "send", mode: "template" });
});

Deno.test("decideFollowUp: inside the 24-hour window it is a session message, at 23:59 yes, at 24:01 no", () => {
  // The lead wrote to us an hour before submitting the form.
  const inbound = new Date(ENQ.getTime() - H);
  const lead = fresh({ last_inbound_at: iso(inbound) });
  assertEquals(decideFollowUp(lead, ENQ, new Date(inbound.getTime() + 22 * H)), { action: "send", mode: "session" });
  assertEquals(decideFollowUp(lead, ENQ, new Date(inbound.getTime() + 23 * H + 59 * MIN)), {
    action: "send",
    mode: "session",
  });
  assertEquals(decideFollowUp(lead, ENQ, new Date(inbound.getTime() + 24 * H + 1 * MIN)), {
    action: "send",
    mode: "template",
  });
});

Deno.test("decideFollowUp: an inbound after the enquiry cancels", () => {
  const lead = fresh({ last_inbound_at: iso(new Date(DAY1.getTime() - 2 * H)) });
  assertEquals(decideFollowUp(lead, ENQ, DAY1), { action: "cancel", reason: "lead replied after the enquiry" });
});

Deno.test("decideFollowUp: an inbound exactly at the enquiry (WhatsApp-first lead) is not a reply", () => {
  const lead = fresh({ last_inbound_at: iso(ENQ) });
  assertEquals(decideFollowUp(lead, ENQ, ist("11:00", "2026-10-14")), { action: "send", mode: "template" });
});

Deno.test("decideFollowUp: a staff reply after the enquiry cancels; one before it does not", () => {
  assertEquals(
    decideFollowUp(fresh({ first_human_reply_at: iso(new Date(ENQ.getTime() + H)) }), ENQ, DAY1),
    { action: "cancel", reason: "staff replied after the enquiry" },
  );
  assertEquals(
    decideFollowUp(fresh({ first_human_reply_at: iso(new Date(ENQ.getTime() - 30 * 24 * H)) }), ENQ, DAY1),
    { action: "send", mode: "template" },
  );
});

Deno.test("decideFollowUp: on a repeat enquiry, the latest staff reply counts, not the first", () => {
  // Staff replied to an enquiry a month ago (first_human_reply_at), then again after this one.
  const first = iso(new Date(ENQ.getTime() - 30 * 24 * H));
  assertEquals(
    decideFollowUp(fresh({ first_human_reply_at: first, last_human_reply_at: iso(new Date(ENQ.getTime() + H)) }), ENQ, DAY1),
    { action: "cancel", reason: "staff replied after the enquiry" },
  );
  assertEquals(
    decideFollowUp(fresh({ first_human_reply_at: first, last_human_reply_at: first }), ENQ, DAY1),
    { action: "send", mode: "template" },
  );
});

Deno.test("decideFollowUp: no consent, no follow-up (B.4)", () => {
  assertEquals(decideFollowUp(fresh({ consent_at: null }), ENQ, DAY1), {
    action: "cancel",
    reason: "lead has not given consent",
  });
});

Deno.test("decideFollowUp: nothing after an opt-out, whatever else is true (B.4)", () => {
  const optedOut = iso(new Date(ENQ.getTime() + H));
  assertEquals(decideFollowUp(fresh({ opted_out_at: optedOut }), ENQ, DAY1), {
    action: "cancel",
    reason: "lead opted out",
  });
  // An opt-out from before this enquiry still holds.
  assertEquals(
    decideFollowUp(fresh({ opted_out_at: iso(new Date(ENQ.getTime() - 24 * H)) }), ENQ, DAY1).action,
    "cancel",
  );
  // In quiet hours it is a cancel, not a deferral.
  assertEquals(decideFollowUp(fresh({ opted_out_at: optedOut }), ENQ, ist("22:00")).action, "cancel");
});

Deno.test("decideFollowUp: in quiet hours a sendable follow-up waits until 09:00 IST", () => {
  assertEquals(decideFollowUp(fresh(), ENQ, ist("22:30", "2026-10-12")), {
    action: "defer",
    runAt: ist("09:00", "2026-10-13"),
  });
  assertEquals(decideFollowUp(fresh(), ENQ, ist("06:00", "2026-10-13")), {
    action: "defer",
    runAt: ist("09:00", "2026-10-13"),
  });
  assertEquals(decideFollowUp(fresh(), ENQ, ist("09:00", "2026-10-13")).action, "send");
});
