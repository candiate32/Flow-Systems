// What happens to a lead's follow-ups when the lead or the studio does
// something (spec 004, B.3 and B.4). The WhatsApp webhook (slice C) calls
// these when an inbound or echo message arrives.
//
// Both database calls are single Postgres functions, so each is one
// transaction: the follow-ups are cancelled together with the `job_cancelled`
// events that say why, and an opt-out sets `leads.opted_out_at` and cancels in
// one go. To cancel in the same transaction as the code that records the
// reply, call `private.cancel_followups(lead, reason, as_of)` from that SQL
// function instead (see supabase/migrations/*_followups.sql).
// deno-lint-ignore no-import-prefix -- see ingest-form/index.ts
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Database } from "./database.types.ts";
import { must } from "./db.ts";

type Db = SupabaseClient<Database>;

/** Opt-out keywords ("Defaults picked" in spec 004). */
export const OPT_OUT_KEYWORDS = ["STOP", "UNSUBSCRIBE"] as const;

/**
 * True when an inbound message is an opt-out: exactly STOP or UNSUBSCRIBE,
 * ignoring case and any whitespace ("stop", " Stop ", "S T O P", "un subscribe"),
 * with an optional trailing "." or "!". A sentence that merely contains the
 * word ("don't stop", "stop by tomorrow?") is not an opt-out.
 */
export function isOptOutMessage(text: string | null | undefined): boolean {
  if (typeof text !== "string") return false;
  // \s covers spaces, tabs, newlines and no-break spaces; also drop zero-width characters.
  const word = text.replace(/[\s​-‍⁠﻿]+/g, "").replace(/[.!]+$/, "").toUpperCase();
  return (OPT_OUT_KEYWORDS as readonly string[]).includes(word);
}

/**
 * Cancels the lead's queued `followup` jobs and writes a `job_cancelled` event
 * (payload `{ job_id, kind, reason }`) for each, in one statement. Running
 * jobs are not touched: the follow-up handler re-checks the lead before it
 * sends. Returns the ids of the cancelled jobs (empty when there were none).
 */
export async function cancelFollowUps(db: Db, leadId: string, reason: string, at?: Date): Promise<string[]> {
  const ids = must(
    await db.rpc("cancel_followups", { p_lead_id: leadId, p_reason: reason, ...(at ? { p_as_of: at.toISOString() } : {}) }),
    "cancel follow-ups",
  );
  return ids ?? [];
}

/**
 * Records an opt-out: sets `leads.opted_out_at` (keeping the first one if the
 * lead opts out twice), writes a `lead_opted_out` event and cancels queued
 * follow-ups, in one transaction. Returns the cancelled job ids, or null when
 * the lead does not exist.
 */
export async function recordOptOut(db: Db, leadId: string, at: Date): Promise<string[] | null> {
  const out = must(
    await db.rpc("record_opt_out", { p_lead_id: leadId, p_at: at.toISOString() }),
    "record opt-out",
  );
  return out ?? null;
}
