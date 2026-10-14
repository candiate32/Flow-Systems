// Job queue helpers shared by the functions that enqueue jobs (ingest-form)
// and the one that runs them (run-jobs). Spec 004, "A. Jobs".
// deno-lint-ignore no-import-prefix -- see ingest-form/index.ts
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Database } from "./database.types.ts";
import { must } from "./db.ts";
import { TEMPLATE_NAMES, type TemplateName } from "./whatsapp.ts";

export const JOB_KINDS = ["send_message", "followup", "weekly_report", "canary"] as const;
export type JobKind = typeof JOB_KINDS[number];

export type Job = Database["public"]["Tables"]["jobs"]["Row"];
export type JobInsert = Database["public"]["Tables"]["jobs"]["Insert"];

/** Minutes to wait after failed attempt 1, 2, 3 and 4 (spec 004, A.4). */
export const BACKOFF_MINUTES = [1, 5, 25, 120] as const;

/** Wait before the next try after the given failed attempt (1-based). */
export function backoffMinutes(failedAttempt: number): number {
  if (!Number.isInteger(failedAttempt) || failedAttempt < 1) {
    throw new RangeError(`attempt must be a positive integer, got ${failedAttempt}`);
  }
  return BACKOFF_MINUTES[Math.min(failedAttempt, BACKOFF_MINUTES.length) - 1];
}

export function nextRunAt(now: Date, failedAttempt: number): Date {
  return new Date(now.getTime() + backoffMinutes(failedAttempt) * 60_000);
}

/** One acknowledgement retry per enquiry: ack:<lead_id>:<last_enquiry_at iso>. */
export function ackIdempotencyKey(leadId: string, enquiryAt: Date): string {
  return `ack:${leadId}:${enquiryAt.toISOString()}`;
}

/** One owner-alert retry per enquiry and owner phone: owner_alert:<lead_id>:<enquiry iso>:<phone>. */
export function ownerAlertIdempotencyKey(leadId: string, enquiryAt: Date, phone: string): string {
  return `owner_alert:${leadId}:${enquiryAt.toISOString()}:${phone}`;
}

/**
 * Inserts a job unless one with the same idempotency key exists. Returns the
 * new job's id, or null when the key was already taken (nothing enqueued).
 */
export async function enqueueJob(db: SupabaseClient<Database>, job: JobInsert): Promise<string | null> {
  const rows = must(
    await db.from("jobs")
      .upsert(job, { onConflict: "idempotency_key", ignoreDuplicates: true })
      .select("id"),
    "enqueue job",
  );
  return rows?.[0]?.id ?? null;
}

/**
 * A failure that retrying cannot fix (bad payload, unknown kind, a handler not
 * built yet). The runner dead-letters the job at once instead of backing off.
 */
export class PermanentJobError extends Error {
  override name = "PermanentJobError";
}

/** Payload of a `send_message` job: one template to one phone. */
export type SendMessagePayload = {
  /** E.164 */
  to: string;
  template: TemplateName;
  language: string;
  params: string[];
  /** Set leads.first_auto_reply_at when this send succeeds (the enquiry ack). */
  first_auto_reply: boolean;
};

export function parseSendMessagePayload(raw: unknown): SendMessagePayload | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.to !== "string" || !/^\+[1-9]\d{7,14}$/.test(p.to)) return null;
  if (typeof p.template !== "string" || !(TEMPLATE_NAMES as readonly string[]).includes(p.template)) return null;
  if (typeof p.language !== "string" || p.language === "") return null;
  if (!Array.isArray(p.params) || !p.params.every((x) => typeof x === "string")) return null;
  if (p.first_auto_reply !== undefined && typeof p.first_auto_reply !== "boolean") return null;
  return {
    to: p.to,
    template: p.template as TemplateName,
    language: p.language,
    params: [...p.params] as string[],
    first_auto_reply: p.first_auto_reply === true,
  };
}

/**
 * Parameters of the `ops_alert` template: kind, job id, attempts, error.
 * WhatsApp template parameters may not contain newlines, tabs or runs of
 * spaces, and the error is cut to keep the message short.
 */
export function opsAlertParams(job: Pick<Job, "id" | "kind" | "attempts">, error: string): string[] {
  const flat = error.replace(/\s+/g, " ").trim();
  return [job.kind, job.id, String(job.attempts), flat.length > 200 ? `${flat.slice(0, 199)}…` : flat];
}
