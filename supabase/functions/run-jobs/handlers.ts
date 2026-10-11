// Job handlers, one per kind. A handler returns normally (job done), returns
// `{ status: "cancelled" }`, or throws: a plain Error is retried with backoff,
// a PermanentJobError dead-letters the job at once.
// deno-lint-ignore no-import-prefix -- see index.ts
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Database, Json } from "../_shared/database.types.ts";
import { errorMessage, must, mustRow } from "../_shared/db.ts";
import { type Job, type JobKind, parseSendMessagePayload, PermanentJobError } from "../_shared/jobs.ts";
import type { WhatsAppProvider } from "../_shared/whatsapp.ts";
import { canary } from "./canary.ts";

export type JobOutcome = { status: "done" } | { status: "cancelled"; reason: string };

export type JobContext = {
  db: SupabaseClient<Database>;
  provider: WhatsAppProvider;
  now: () => Date;
  addEvent: (job: Job, type: string, payload?: Record<string, Json>) => Promise<void>;
  env: (k: string) => string | undefined;
  /** Sends the ops_alert template to OPS_ALERT_PHONE. Never throws. */
  alertOps: (job: Job, error: string) => Promise<void>;
};

export type JobHandler = (job: Job, ctx: JobContext) => Promise<JobOutcome | void>;

/**
 * Sends one template. Exactly once per job: a send that the provider accepted
 * is recorded as a message carrying the job id (unique per job, whatever its
 * later status), and a retry that finds one does not send again.
 *
 * Recipients:
 * - `owner_alert` goes to one of the org's owner_alert_phones. The job's
 *   lead_id is the lead the alert is about (so deleting the lead removes the
 *   job); the message itself has no lead_id, as for inline owner alerts.
 * - every other template goes to the job's lead, at the phone the lead gave
 *   and only with consent.
 */
export const sendMessage: JobHandler = async (job, ctx) => {
  const { db, provider, now } = ctx;
  const p = parseSendMessagePayload(job.payload);
  if (!p) throw new PermanentJobError("invalid send_message payload");

  const prior = must(
    await db.from("messages").select("id, sent_at, created_at").eq("job_id", job.id).maybeSingle(),
    "find earlier send",
  );
  const isOwnerAlert = p.template === "owner_alert";
  let sentAt: string;
  if (prior) {
    // An earlier attempt sent it and then lost track (crash before the job was
    // settled). Its status may have moved on (delivered, read); it was sent.
    sentAt = prior.sent_at ?? prior.created_at;
  } else {
    const refusal = isOwnerAlert ? await checkOwnerPhone(job, p.to, db) : await checkLeadRecipient(job, p.to, db);
    if (refusal) return refusal;

    let providerMessageId: string;
    try {
      ({ providerMessageId } = await provider.sendTemplate({
        to: p.to,
        template: p.template,
        language: p.language,
        params: p.params,
      }));
    } catch (err) {
      await ctx.addEvent(job, "send_failed", { template: p.template, attempt: job.attempts, error: errorMessage(err) });
      throw new Error(`send failed: ${errorMessage(err)}`);
    }

    // From here on the message is out. If recording it fails, dead-letter the
    // job (ops get alerted) rather than retry and send it a second time.
    sentAt = now().toISOString();
    try {
      const message = mustRow(
        await db.from("messages").insert({
          org_id: job.org_id,
          lead_id: isOwnerAlert ? null : job.lead_id,
          job_id: job.id,
          to_phone: p.to,
          direction: "outbound",
          kind: "template",
          template_name: p.template,
          provider: provider.name,
          provider_message_id: providerMessageId,
          status: "sent",
          sent_at: sentAt,
        }).select("id").single(),
        "insert message",
      );
      await ctx.addEvent(job, SENT_EVENT[p.template] ?? "message_sent", {
        template: p.template,
        message_id: message.id,
        attempt: job.attempts,
      });
    } catch (err) {
      throw new PermanentJobError(
        `sent as ${providerMessageId} but not recorded, not retrying: ${errorMessage(err)}`,
      );
    }
  }

  if (p.first_auto_reply && job.lead_id && !isOwnerAlert) {
    must(
      await db.from("leads")
        .update({ first_auto_reply_at: sentAt })
        .eq("id", job.lead_id)
        .is("first_auto_reply_at", null),
      "set first_auto_reply_at",
    );
  }
};

/** Event names match the ones ingest-form writes for inline sends. */
const SENT_EVENT: Partial<Record<string, string>> = { enquiry_ack: "ack_sent", owner_alert: "owner_alert_sent" };

/** Only message people who gave consent, at the number they gave. */
async function checkLeadRecipient(job: Job, to: string, db: JobContext["db"]): Promise<JobOutcome | null> {
  if (!job.lead_id) throw new PermanentJobError("a message to a lead needs the job's lead_id");
  const lead = must(
    await db.from("leads").select("phone_e164, consent_at").eq("id", job.lead_id).maybeSingle(),
    "find lead",
  );
  if (!lead) return { status: "cancelled", reason: "lead no longer exists" };
  if (!lead.consent_at) return { status: "cancelled", reason: "lead has not given consent" };
  if (lead.phone_e164 !== to) throw new PermanentJobError("recipient is not the lead's phone");
  return null;
}

/** Owner alerts only go to a phone that is still on the org's owner_alert_phones. */
async function checkOwnerPhone(job: Job, to: string, db: JobContext["db"]): Promise<JobOutcome | null> {
  const org = must(
    await db.from("orgs").select("owner_alert_phones").eq("id", job.org_id).maybeSingle(),
    "find org",
  );
  if (!org) return { status: "cancelled", reason: "org no longer exists" };
  if (!org.owner_alert_phones.includes(to)) {
    return { status: "cancelled", reason: "recipient is no longer an owner alert phone" };
  }
  return null;
}

/** Kinds that later slices implement. Such jobs dead-letter visibly until then. */
const notYet = (kind: JobKind): JobHandler => () => {
  throw new PermanentJobError(`${kind} is not implemented in slice A`);
};

export const defaultHandlers: Record<JobKind, JobHandler> = {
  send_message: sendMessage,
  followup: notYet("followup"),
  weekly_report: notYet("weekly_report"),
  canary,
};
