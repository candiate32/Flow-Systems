// Job handlers, one per kind. A handler returns normally (job done), returns
// `{ status: "cancelled" }`, or throws: a plain Error is retried with backoff,
// a PermanentJobError dead-letters the job at once.
// deno-lint-ignore no-import-prefix -- see index.ts
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Database, Json } from "../_shared/database.types.ts";
import { errorMessage, must, mustRow } from "../_shared/db.ts";
import { type Job, type JobKind, parseSendMessagePayload, PermanentJobError } from "../_shared/jobs.ts";
import type { WhatsAppProvider } from "../_shared/whatsapp.ts";

export type JobOutcome = { status: "done" } | { status: "cancelled"; reason: string };

export type JobContext = {
  db: SupabaseClient<Database>;
  provider: WhatsAppProvider;
  now: () => Date;
  addEvent: (job: Job, type: string, payload?: Record<string, Json>) => Promise<void>;
};

export type JobHandler = (job: Job, ctx: JobContext) => Promise<JobOutcome | void>;

/**
 * Sends one template. Exactly once per job: a send that the provider accepted
 * is recorded as a `sent` message carrying the job id (unique per job), and a
 * retry that finds one does not send again.
 */
export const sendMessage: JobHandler = async (job, ctx) => {
  const { db, provider, now } = ctx;
  const p = parseSendMessagePayload(job.payload);
  if (!p) throw new PermanentJobError("invalid send_message payload");

  const prior = must(
    await db.from("messages").select("id, sent_at").eq("job_id", job.id).eq("status", "sent").maybeSingle(),
    "find earlier send",
  );
  let sentAt: string;
  if (prior) {
    // An earlier attempt sent it and then lost track (crash before the job was settled).
    sentAt = prior.sent_at ?? now().toISOString();
  } else {
    if (job.lead_id) {
      // Only message people who gave consent, at the number they gave.
      const lead = must(
        await db.from("leads").select("phone_e164, consent_at").eq("id", job.lead_id).maybeSingle(),
        "find lead",
      );
      if (!lead) return { status: "cancelled", reason: "lead no longer exists" };
      if (!lead.consent_at) return { status: "cancelled", reason: "lead has not given consent" };
      if (lead.phone_e164 !== p.to) throw new PermanentJobError("recipient is not the lead's phone");
    }

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
          lead_id: job.lead_id,
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
      await ctx.addEvent(job, p.template === "enquiry_ack" ? "ack_sent" : "message_sent", {
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

  if (p.first_auto_reply && job.lead_id) {
    must(
      await db.from("leads")
        .update({ first_auto_reply_at: sentAt })
        .eq("id", job.lead_id)
        .is("first_auto_reply_at", null),
      "set first_auto_reply_at",
    );
  }
};

/** Kinds that later slices implement. Such jobs dead-letter visibly until then. */
const notYet = (kind: JobKind): JobHandler => () => {
  throw new PermanentJobError(`${kind} is not implemented in slice A`);
};

export const defaultHandlers: Record<JobKind, JobHandler> = {
  send_message: sendMessage,
  followup: notYet("followup"),
  weekly_report: notYet("weekly_report"),
  canary: notYet("canary"),
};
