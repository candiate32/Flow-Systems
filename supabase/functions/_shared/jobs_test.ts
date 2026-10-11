// deno-lint-ignore no-import-prefix -- test-only std dep; no shared deno.json by design
import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  ackIdempotencyKey,
  backoffMinutes,
  nextRunAt,
  opsAlertParams,
  parseSendMessagePayload,
} from "./jobs.ts";

Deno.test("backoff is 1, 5, 25 and 120 minutes after failed attempts 1 to 4", () => {
  assertEquals([1, 2, 3, 4].map(backoffMinutes), [1, 5, 25, 120]);
});

Deno.test("backoff stays at 120 minutes when max_attempts is raised past 5", () => {
  assertEquals([5, 6, 50].map(backoffMinutes), [120, 120, 120]);
});

Deno.test("backoff rejects attempt numbers below 1", () => {
  assertThrows(() => backoffMinutes(0));
  assertThrows(() => backoffMinutes(1.5));
});

Deno.test("nextRunAt adds the backoff to now", () => {
  const now = new Date("2026-10-11T10:00:00.000Z");
  assertEquals(nextRunAt(now, 1).toISOString(), "2026-10-11T10:01:00.000Z");
  assertEquals(nextRunAt(now, 4).toISOString(), "2026-10-11T12:00:00.000Z");
});

Deno.test("ack idempotency key is ack:<lead_id>:<enquiry iso>", () => {
  assertEquals(
    ackIdempotencyKey("1f0e", new Date("2026-10-11T10:00:00.000Z")),
    "ack:1f0e:2026-10-11T10:00:00.000Z",
  );
});

const valid = { to: "+919845012345", template: "enquiry_ack", language: "en", params: ["Asha", "Demo"] };

Deno.test("parseSendMessagePayload accepts a template send", () => {
  assertEquals(parseSendMessagePayload(valid), { ...valid, first_auto_reply: false });
  assertEquals(parseSendMessagePayload({ ...valid, first_auto_reply: true })?.first_auto_reply, true);
});

Deno.test("parseSendMessagePayload rejects malformed payloads", () => {
  for (
    const bad of [
      null,
      [],
      "x",
      { ...valid, to: "9845012345" }, // not E.164
      { ...valid, to: "+91 98450 12345" },
      { ...valid, template: "marketing_blast" },
      { ...valid, params: "Asha" },
      { ...valid, params: [1] },
      { ...valid, language: "" },
      { ...valid, first_auto_reply: "yes" },
    ]
  ) {
    assertEquals(parseSendMessagePayload(bad), null, JSON.stringify(bad));
  }
});

Deno.test("opsAlertParams flattens whitespace and truncates the error", () => {
  const params = opsAlertParams(
    { id: "job-1", kind: "send_message", attempts: 5 },
    "line one\n\tline    two " + "x".repeat(400),
  );
  assertEquals(params.slice(0, 3), ["send_message", "job-1", "5"]);
  assertEquals(params[3].startsWith("line one line two x"), true);
  assertEquals(params[3].length <= 200, true);
  assertEquals(/[\n\t]| {2}/.test(params[3]), false);
});
