// The `weekly_report` job handler (spec 004, D.2).
//
// pg_cron queues one job per org on Monday 09:00 IST for the week that just
// ended (private.enqueue_weekly_reports, key weekly:<org>:<iso-week>). When
// it runs:
// 1. it reads the org's name, owner phones, owner emails and the week's
//    numbers (public.weekly_report_data, from the lead_response_weekly view);
// 2. it queues one `send_message` job per owner phone with the
//    `weekly_summary` template, keyed weekly:<org>:<iso-week>:whatsapp:<phone>.
//    Those go out in the same run-jobs run, through the usual send path:
//    exactly once per phone, retried with backoff, dead-lettered with an ops
//    alert, and skipped if the phone is no longer an owner phone;
// 3. then, when RESEND_API_KEY is set, it emails the report to the org's
//    owners through Resend, once per org and week.
//
// The WhatsApp sends are queued before the email is tried, so an email
// failure never blocks them. A failed email fails this job: it is retried
// with backoff (a 4xx other than 429 dead-letters it at once, and ops are
// alerted). A retry queues no new WhatsApp sends (their keys exist) and sends
// the email only if no `weekly_email_sent` event exists for the org and week.
import { errorMessage, must } from "../_shared/db.ts";
import { enqueueJob, PermanentJobError, type SendMessagePayload } from "../_shared/jobs.ts";
import {
  EmailSendError,
  parseWeeklyReportPayload,
  sendResendEmail,
  weeklyEmailIdempotencyKey,
  type WeeklyReportData,
  weeklyReportEmail,
  weeklySummaryParams,
  weeklySummaryWhatsAppKey,
} from "../_shared/weekly_report.ts";
import type { JobContext, JobHandler } from "./handlers.ts";

/** Resend only sends from a verified domain; set RESEND_FROM to an address on it in production. */
export const DEFAULT_RESEND_FROM = "Flow Systems <onboarding@resend.dev>";

export const weeklyReport: JobHandler = async (job, ctx) => {
  const { db, now } = ctx;
  const p = parseWeeklyReportPayload(job.payload);
  if (!p) throw new PermanentJobError("invalid weekly_report payload");

  const data = must(
    await db.rpc("weekly_report_data", { p_org_id: job.org_id, p_week_start: p.weekStart }),
    "load weekly report",
  ) as WeeklyReportData | null;
  if (!data) return { status: "cancelled", reason: "org no longer exists" };

  // WhatsApp: one send job per owner phone, due now.
  const params = weeklySummaryParams(data.org_name, p.weekStart, data.metrics);
  const queued: string[] = [];
  for (const to of data.owner_alert_phones) {
    const payload: SendMessagePayload = {
      to,
      template: "weekly_summary",
      language: "en",
      params,
      first_auto_reply: false,
    };
    const id = await enqueueJob(db, {
      org_id: job.org_id,
      kind: "send_message",
      run_at: now().toISOString(),
      idempotency_key: weeklySummaryWhatsAppKey(job.org_id, p.isoWeek, to),
      payload,
    });
    if (id) queued.push(id);
  }
  if (queued.length || job.attempts === 1) {
    await ctx.addEvent(job, "weekly_report_queued", {
      iso_week: p.isoWeek,
      week_start: p.weekStart,
      lead_count: data.metrics?.lead_count ?? 0,
      whatsapp_jobs: queued,
      owner_phones: data.owner_alert_phones.length,
    });
  }

  await emailReport(job.org_id, p, data, ctx, job.attempts, (type, payload) => ctx.addEvent(job, type, payload));
};

async function emailReport(
  orgId: string,
  p: { weekStart: string; isoWeek: string },
  data: WeeklyReportData,
  ctx: JobContext,
  attempt: number,
  addEvent: (type: string, payload: Record<string, string | number | boolean | null>) => Promise<void>,
): Promise<void> {
  const apiKey = ctx.env("RESEND_API_KEY");
  const skip = (reason: string) => addEvent("weekly_email_skipped", { iso_week: p.isoWeek, reason });
  if (!apiKey) return await skip("RESEND_API_KEY is not set");
  if (!data.owner_emails.length) return await skip("the org has no owner with an email");

  const sent = must(
    await ctx.db.from("events")
      .select("id")
      .eq("org_id", orgId)
      .eq("type", "weekly_email_sent")
      .eq("payload->>iso_week", p.isoWeek)
      .limit(1),
    "find earlier email",
  );
  if (sent?.length) return;

  const email = weeklyReportEmail(data.org_name, p.weekStart, data.metrics);
  try {
    const { id } = await sendResendEmail({
      apiKey,
      from: ctx.env("RESEND_FROM") || DEFAULT_RESEND_FROM,
      to: data.owner_emails,
      ...email,
      idempotencyKey: weeklyEmailIdempotencyKey(orgId, p.isoWeek),
    }, ctx.fetch);
    await addEvent("weekly_email_sent", { iso_week: p.isoWeek, email_id: id, recipients: data.owner_emails.length });
  } catch (err) {
    const permanent = err instanceof EmailSendError && err.permanent;
    await addEvent("weekly_email_failed", { iso_week: p.isoWeek, attempt, permanent, error: errorMessage(err) });
    const message = `weekly email failed: ${errorMessage(err)}`;
    throw permanent ? new PermanentJobError(message) : new Error(message);
  }
}
