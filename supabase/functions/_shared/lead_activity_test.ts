// deno-lint-ignore no-import-prefix -- test-only std dep; no shared deno.json by design
import { assertEquals } from "jsr:@std/assert@1";
import { isOptOutMessage } from "./lead_activity.ts";

// Database-backed tests for cancelFollowUps and recordOptOut are in
// supabase/functions/run-jobs/followup_test.ts, next to the job runner they feed.

Deno.test("isOptOutMessage: STOP and UNSUBSCRIBE in any case", () => {
  for (const t of ["STOP", "stop", "Stop", "sToP", "UNSUBSCRIBE", "unsubscribe", "Unsubscribe"]) {
    assertEquals(isOptOutMessage(t), true, t);
  }
});

Deno.test("isOptOutMessage: ignores spaces, tabs, newlines and invisible characters", () => {
  for (const t of [" stop", "stop ", "  STOP\n", "\tStop\t", "S T O P", "un subscribe", " stop ", "​STOP"]) {
    assertEquals(isOptOutMessage(t), true, JSON.stringify(t));
  }
});

Deno.test("isOptOutMessage: a trailing full stop or exclamation mark is fine", () => {
  for (const t of ["Stop.", "STOP!", "stop!!", "Unsubscribe."]) assertEquals(isOptOutMessage(t), true, t);
});

Deno.test("isOptOutMessage: anything else is not an opt-out", () => {
  for (
    const t of [
      "",
      "   ",
      "stopp",
      "sto",
      "don't stop",
      "please stop",
      "stop by tomorrow?",
      "STOP?",
      "unsubscribed",
      "Can we talk about stopping the work?",
      "1",
      null,
      undefined,
    ]
  ) {
    assertEquals(isOptOutMessage(t), false, JSON.stringify(t));
  }
});
