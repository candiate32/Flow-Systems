// Follow-up scheduling (spec 004, "B. Follow-ups and window"). The pure parts:
// when follow-ups run, quiet hours, the jobs an enquiry enqueues, and what a
// follow-up job should do when it runs. The database calls are at the bottom.
// deno-lint-ignore no-import-prefix -- see ingest-form/index.ts
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Database, Json } from "./database.types.ts";
import { must } from "./db.ts";
import { isInsideServiceWindow } from "./window.ts";

/** IST is UTC+05:30 all year (no DST). */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const FOLLOW_UP_DAYS = [1, 3, 7] as const;
const SEND_HOUR_IST = 11;
/** No follow-up runs from 21:00 to 09:00 IST ("Defaults picked" in spec 004). */
const QUIET_FROM_HOUR_IST = 21;
const QUIET_UNTIL_HOUR_IST = 9;

/**
 * Follow-up times for an enquiry: 11:00 IST on day 1, 3 and 7 after the
 * enquiry's IST calendar date. Returned as UTC instants.
 */
export function followUpTimes(enquiryAt: Date): Date[] {
  // Shift into IST, then read the calendar date with UTC getters.
  const ist = new Date(enquiryAt.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  return FOLLOW_UP_DAYS.map((n) => new Date(Date.UTC(y, m, d + n, SEND_HOUR_IST) - IST_OFFSET_MS));
}

/** True from 21:00:00.000 up to (not including) 09:00:00.000 IST. */
export function isQuietHour(at: Date): boolean {
  const h = new Date(at.getTime() + IST_OFFSET_MS).getUTCHours();
  return h >= QUIET_FROM_HOUR_IST || h < QUIET_UNTIL_HOUR_IST;
}

/**
 * The earliest time at or after `at` that is outside quiet hours: `at` itself
 * during the day, otherwise the next 09:00 IST.
 */
export function outOfQuietHours(at: Date): Date {
  if (!isQuietHour(at)) return at;
  const ist = new Date(at.getTime() + IST_OFFSET_MS);
  // Before 09:00 the next 09:00 is today (IST); from 21:00 it is tomorrow.
  const dayOffset = ist.getUTCHours() >= QUIET_FROM_HOUR_IST ? 1 : 0;
  return new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + dayOffset, QUIET_UNTIL_HOUR_IST) -
      IST_OFFSET_MS,
  );
}

export type FollowUpNumber = 1 | 2 | 3;

/** Payload of a `followup` job. `enquiry_at` is the enquiry that scheduled it. */
export type FollowUpPayload = { n: FollowUpNumber; enquiry_at: string };

/** One follow-up set per enquiry: followup:<lead_id>:<n>:<enquiry_at iso>. */
export function followUpIdempotencyKey(leadId: string, n: FollowUpNumber, enquiryAt: Date): string {
  return `followup:${leadId}:${n}:${enquiryAt.toISOString()}`;
}

export type FollowUpJob = { run_at: string; idempotency_key: string; payload: FollowUpPayload };

/** The three `followup` jobs an enquiry enqueues, each moved out of quiet hours. */
export function followUpJobs(leadId: string, enquiryAt: Date): FollowUpJob[] {
  return followUpTimes(enquiryAt).map((at, i) => {
    const n = (i + 1) as FollowUpNumber;
    return {
      run_at: outOfQuietHours(at).toISOString(),
      idempotency_key: followUpIdempotencyKey(leadId, n, enquiryAt),
      payload: { n, enquiry_at: enquiryAt.toISOString() },
    };
  });
}

export function parseFollowUpPayload(raw: unknown): { n: FollowUpNumber; enquiryAt: Date } | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (p.n !== 1 && p.n !== 2 && p.n !== 3) return null;
  if (typeof p.enquiry_at !== "string") return null;
  const enquiryAt = new Date(p.enquiry_at);
  if (Number.isNaN(enquiryAt.getTime())) return null;
  return { n: p.n, enquiryAt };
}

/** The lead fields a follow-up decision reads. Timestamps as ISO strings, as the database returns them. */
export type FollowUpLead = {
  consent_at: string | null;
  opted_out_at: string | null;
  last_inbound_at: string | null;
  first_human_reply_at: string | null;
  /** The latest staff reply; first_human_reply_at is set once, so a repeat enquiry needs this one. */
  last_human_reply_at: string | null;
};

export type FollowUpDecision =
  | { action: "cancel"; reason: string }
  | { action: "defer"; runAt: Date }
  | { action: "send"; mode: "template" | "session" };

/**
 * What a follow-up job does when it runs, in this order:
 * 1. cancel if the lead opted out, never consented, messaged us after the
 *    enquiry, or a staff member replied after it (spec 004, B.2 and B.4);
 * 2. wait until 09:00 IST if it is quiet hours;
 * 3. otherwise send: a session message inside the 24-hour window, the
 *    template outside it.
 *
 * "After the enquiry" is strictly after: a lead who first wrote to us on
 * WhatsApp has last_inbound_at equal to the enquiry, which is not a reply.
 */
export function decideFollowUp(lead: FollowUpLead, enquiryAt: Date, now: Date): FollowUpDecision {
  const after = (ts: string | null) => ts !== null && new Date(ts).getTime() > enquiryAt.getTime();
  if (lead.opted_out_at) return { action: "cancel", reason: "lead opted out" };
  if (!lead.consent_at) return { action: "cancel", reason: "lead has not given consent" };
  if (after(lead.last_inbound_at)) return { action: "cancel", reason: "lead replied after the enquiry" };
  if (after(lead.last_human_reply_at) || after(lead.first_human_reply_at)) {
    return { action: "cancel", reason: "staff replied after the enquiry" };
  }
  if (isQuietHour(now)) return { action: "defer", runAt: outOfQuietHours(now) };
  const inside = isInsideServiceWindow(lead.last_inbound_at ? new Date(lead.last_inbound_at) : null, now);
  return { action: "send", mode: inside ? "session" : "template" };
}

// --- Database ---------------------------------------------------------------

export type ScheduleResult = { enqueued: string[]; cancelled: string[] };

/**
 * Enqueues the enquiry's three follow-ups and, in the same transaction,
 * cancels any other queued follow-ups of the lead (an earlier enquiry's set),
 * recording a `job_cancelled` event for each. Idempotent: calling it again for
 * the same enquiry enqueues nothing and cancels nothing.
 */
export async function scheduleFollowUps(
  db: SupabaseClient<Database>,
  leadId: string,
  enquiryAt: Date,
  now: Date,
): Promise<ScheduleResult> {
  const out = must(
    await db.rpc("schedule_followups", {
      p_lead_id: leadId,
      p_jobs: followUpJobs(leadId, enquiryAt) as unknown as Json,
      p_reason: "superseded by a new enquiry",
      p_as_of: now.toISOString(),
    }),
    "schedule follow-ups",
  ) as unknown as ScheduleResult | null;
  if (!out) throw new Error("schedule follow-ups: lead not found");
  return out;
}
