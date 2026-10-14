// The `weekly_report` job handler (spec 004, D.2).
//
// pg_cron queues one job per org on Monday 09:00 IST for the week that just
// ended (private.enqueue_weekly_reports, key weekly:<org>:<iso-week>). When
// it runs:
// 1. on its first run it reads the org's name and the week's numbers
//    (public.weekly_report_data, from the lead_response_weekly view) and
//    stores them on the job's payload as `report`. Retries use that snapshot,
//    so every message of the report says the same thing even if a late reply
//    has moved the numbers since;
// 2. it queues one `send_message` job per owner phone with the
//    `weekly_summary` template, keyed weekly:<org>:<iso-week>:whatsapp:<phone>.
//    Those go out in the same run-jobs run, through the usual send path:
//    exactly once per phone, retried with backoff, dead-lettered with an ops
//    alert, and skipped if the phone is no longer an owner phone;
// 3. then, when RESEND_API_KEY is set, it emails each of the org's owners
//    separately (nobody sees another owner's address), keyed
//    weekly:<org>:<iso-week>:email:<user_id>. An owner with a
//    `weekly_email_sent` event for the week is skipped.
//
// The WhatsApp sends are queued before any email is tried, so an email
// failure never blocks them. If an owner's email fails, the others are still
// sent, and then the job fails: it is retried with backoff and the retry
// emails only the owners still missing (a 4xx other than 429 dead-letters
// the job at once, and ops are alerted). A 409 from Resend means a request
// with that owner's key was already made, so the email counts as sent.
import { errorMessage, must } from "../_shared/db.ts";
import type { Json } from "../_shared/database.types.ts";
import { type Job, PermanentJobError, type SendMessagePayload, enqueueJob } from "../_shared/jobs.ts";
import {
  EmailSendError,
  parseWeeklyReportPayload,
  type ReportOwner,
  sendResendEmail,
  weeklyEmailIdempotencyKey,
  type WeeklyReportData,
  weeklyReportEmail,
  type WeeklyReportSnapshot,
  weeklySummaryParams,
  weeklySummaryWhatsAppKey,
} from "../_shared/weekly_report.ts";
import type { JobContext, JobHandler } from "./handlers.ts";

/** Resend only sends from a verified domain; set RESEND_FROM to an address on it in production. */
export const DEFAULT_RESEND_FROM = "Flow Systems <onboarding@resend.dev>";

type Week = { weekStart: string; isoWeek: string };

export const weeklyReport: JobHandler = async (job, ctx) => {
  const { db, now } = ctx;
  const p = parseWeeklyReportPayload(job.payload);
  if (!p) throw new PermanentJobError("invalid weekly_report payload");

  const data = must(
    await db.rpc("weekly_report_data", { p_org_id: job.org_id, p_week_start: p.weekStart }),
    "load weekly report",
  ) as WeeklyReportData | null;
  if (!data) return { status: "cancelled", reason: "org no longer exists" };

  const report = p.report ?? await takeSnapshot(job, ctx, { org_name: data.org_name, metrics: data.metrics });

  // WhatsApp: one send job per owner phone, due now.
  const params = weeklySummaryParams(report.org_name, p.weekStart, report.metrics);
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
      lead_count: report.metrics?.lead_count ?? 0,
      whatsapp_jobs: queued,
      owner_phones: data.owner_alert_phones.length,
    });
  }

  await emailOwners(job, p, report, data.owners, ctx);
};

/**
 * Stores what the report says on the job's payload, only while this runner
 * still holds the job (same attempt, still running), and returns it.
 */
async function takeSnapshot(job: Job, ctx: JobContext, report: WeeklyReportSnapshot): Promise<WeeklyReportSnapshot> {
  const payload = { ...(job.payload as Record<string, Json>), report: report as unknown as Json };
  const rows = must(
    await ctx.db.from("jobs")
      .update({ payload })
      .eq("id", job.id)
      .eq("status", "running")
      .eq("attempts", job.attempts)
      .select("id"),
    "store weekly report snapshot",
  );
  // Lost the job to another runner: send nothing, the other runner reports.
  if (!rows?.length) throw new Error("lost the job before storing its report");
  return report;
}

async function emailOwners(
  job: Job,
  week: Week,
  report: WeeklyReportSnapshot,
  owners: ReportOwner[],
  ctx: JobContext,
): Promise<void> {
  const addEvent = (type: string, payload: Record<string, Json>) =>
    ctx.addEvent(job, type, { iso_week: week.isoWeek, ...payload });
  const apiKey = ctx.env("RESEND_API_KEY");
  if (!apiKey) return await addEvent("weekly_email_skipped", { reason: "RESEND_API_KEY is not set" });
  if (!owners.length) return await addEvent("weekly_email_skipped", { reason: "the org has no owner with an email" });

  const done = new Set(
    (must(
      await ctx.db.from("events")
        .select("payload")
        .eq("org_id", job.org_id)
        .eq("type", "weekly_email_sent")
        .eq("payload->>iso_week", week.isoWeek),
      "find earlier emails",
    ) ?? []).map((e) => (e.payload as { user_id?: string }).user_id),
  );

  const email = weeklyReportEmail(report.org_name, week.weekStart, report.metrics);
  const from = ctx.env("RESEND_FROM") || DEFAULT_RESEND_FROM;
  const failures: { permanent: boolean; error: string }[] = [];
  for (const owner of owners) {
    if (done.has(owner.user_id)) continue;
    try {
      const result = await sendResendEmail({
        apiKey,
        from,
        to: [owner.email],
        ...email,
        idempotencyKey: weeklyEmailIdempotencyKey(job.org_id, week.isoWeek, owner.user_id),
      }, ctx.fetch);
      if (result.status === "sent") {
        await addEvent("weekly_email_sent", { user_id: owner.user_id, email_id: result.id });
      } else {
        console.error(JSON.stringify({
          fn: "run-jobs",
          job_id: job.id,
          weekly_email_already_sent: owner.user_id,
          resend: result.detail,
        }));
        await addEvent("weekly_email_sent", { user_id: owner.user_id, already_sent: true, resend: result.detail });
      }
    } catch (err) {
      const permanent = err instanceof EmailSendError && err.permanent;
      failures.push({ permanent, error: errorMessage(err) });
      await addEvent("weekly_email_failed", {
        user_id: owner.user_id,
        attempt: job.attempts,
        permanent,
        error: errorMessage(err),
      });
    }
  }

  if (failures.length) {
    const message = `weekly email failed for ${failures.length} of ${owners.length} owners: ${failures[0].error}`;
    // Retry while any failure might pass on a retry; all permanent means dead now.
    throw failures.every((f) => f.permanent) ? new PermanentJobError(message) : new Error(message);
  }
}
