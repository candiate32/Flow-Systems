// The `followup` job handler (spec 004, "B. Follow-ups and window").
//
// A follow-up job carries { n, enquiry_at }. When it runs:
// - it is final if an earlier attempt already sent it (exactly once);
// - it is cancelled if the lead opted out, has no consent, or the lead or a
//   staff member replied after the enquiry (decideFollowUp in _shared);
// - it is cancelled if a later follow-up of the same set is already due (a
//   backlog after downtime sends only the latest, not all three at once);
// - in quiet hours (21:00-09:00 IST) it goes back to the queue for 09:00 IST;
// - otherwise it sends `followup_<n>`: the template outside the lead's 24-hour
//   window, a session message with the same text inside it.
import { errorMessage, must, mustRow } from "../_shared/db.ts";
import {
  decideFollowUp,
  followUpIdempotencyKey,
  type FollowUpNumber,
  parseFollowUpPayload,
} from "../_shared/followups.ts";
import { PermanentJobError } from "../_shared/jobs.ts";
import { followUpTemplate, renderTemplate } from "../_shared/templates.ts";
import type { JobContext, JobHandler } from "./handlers.ts";

const TEMPLATE_LANGUAGE = "en";

/**
 * True when a later follow-up of the same set (same lead and enquiry, higher
 * n) is due by `now` and has not been cancelled or dead-lettered: queued and
 * due, already running, or done.
 */
async function laterFollowUpDue(
  db: JobContext["db"],
  leadId: string,
  n: FollowUpNumber,
  enquiryAt: Date,
  now: Date,
): Promise<boolean> {
  const later = ([1, 2, 3] as const).filter((m) => m > n);
  if (!later.length) return false;
  const rows = must(
    await db.from("jobs")
      .select("id")
      .in("idempotency_key", later.map((m) => followUpIdempotencyKey(leadId, m, enquiryAt)))
      .in("status", ["queued", "running", "done"])
      .lte("run_at", now.toISOString())
      .limit(1),
    "find later follow-ups",
  );
  return (rows?.length ?? 0) > 0;
}

export const followUp: JobHandler = async (job, ctx) => {
  const { db, provider, now } = ctx;
  const p = parseFollowUpPayload(job.payload);
  if (!p) throw new PermanentJobError("invalid followup payload");
  if (!job.lead_id) throw new PermanentJobError("a followup job needs the job's lead_id");

  // An earlier attempt sent it and then lost track (crash before the job was
  // settled). Whatever has happened since, it was sent: don't send again.
  const prior = must(
    await db.from("messages").select("id").eq("job_id", job.id).maybeSingle(),
    "find earlier send",
  );
  if (prior) return;

  const lead = must(
    await db.from("leads")
      .select("name, phone_e164, consent_at, opted_out_at, last_inbound_at, first_human_reply_at, org:orgs!inner(name)")
      .eq("id", job.lead_id)
      .maybeSingle(),
    "find lead",
  );
  if (!lead) return { status: "cancelled", reason: "lead no longer exists" };

  const decision = decideFollowUp(lead, p.enquiryAt, now());
  if (decision.action === "cancel") return { status: "cancelled", reason: decision.reason };

  // Backlog (runner down, long deferral): if a later follow-up of the same
  // set is already due, only the latest one goes out.
  if (await laterFollowUpDue(db, job.lead_id, p.n, p.enquiryAt, now())) {
    return { status: "cancelled", reason: "superseded by a later follow-up" };
  }

  if (decision.action === "defer") return { status: "deferred", runAt: decision.runAt, reason: "quiet hours" };

  const org = Array.isArray(lead.org) ? lead.org[0] : lead.org;
  const template = followUpTemplate(p.n);
  const params = [lead.name.split(/\s+/)[0], org.name];
  const text = renderTemplate(template, params);
  const to = lead.phone_e164;

  let providerMessageId: string;
  try {
    ({ providerMessageId } = decision.mode === "session"
      ? await provider.sendSession({ to, text })
      : await provider.sendTemplate({ to, template, language: TEMPLATE_LANGUAGE, params }));
  } catch (err) {
    await ctx.addEvent(job, "send_failed", { template, mode: decision.mode, attempt: job.attempts, error: errorMessage(err) });
    throw new Error(`send failed: ${errorMessage(err)}`);
  }

  // The message is out. If recording it fails, dead-letter (ops get alerted)
  // rather than retry and send it twice.
  try {
    const message = mustRow(
      await db.from("messages").insert({
        org_id: job.org_id,
        lead_id: job.lead_id,
        job_id: job.id,
        to_phone: to,
        direction: "outbound",
        kind: decision.mode,
        template_name: template,
        body: text,
        provider: provider.name,
        provider_message_id: providerMessageId,
        status: "sent",
        sent_at: now().toISOString(),
      }).select("id").single(),
      "insert message",
    );
    await ctx.addEvent(job, "followup_sent", {
      n: p.n,
      template,
      mode: decision.mode,
      message_id: message.id,
      attempt: job.attempts,
    });
  } catch (err) {
    throw new PermanentJobError(`sent as ${providerMessageId} but not recorded, not retrying: ${errorMessage(err)}`);
  }
};
