// The weekly report (spec 004, D.2): the pure parts and the Resend call.
// The job handler is run-jobs/weekly_report.ts; the numbers come from the
// lead_response_weekly view through public.weekly_report_data.
import { renderWeeklySummary, WEEKLY_SUMMARY_TEXT } from "./templates.ts";

/** One org's row of lead_response_weekly (numbers as PostgREST returns them). */
export type WeeklyMetrics = {
  lead_count: number;
  auto_replied_count: number;
  median_seconds_to_auto_reply: number | null;
  p90_seconds_to_auto_reply: number | null;
  human_replied_count: number;
  median_seconds_to_first_human_reply: number | null;
  human_reply_within_1h_count: number;
  pct_human_reply_within_1h: number | null;
  replied_by_lead_count: number;
};

/** An org member with role `owner`, who gets the report by email. */
export type ReportOwner = { user_id: string; email: string };

/** What public.weekly_report_data returns for an org that exists. */
export type WeeklyReportData = {
  org_name: string;
  owner_alert_phones: string[];
  owners: ReportOwner[];
  /** Null when the org had no enquiries that week. */
  metrics: WeeklyMetrics | null;
};

/**
 * What the report says, fixed on its first run and kept on the job's payload
 * (`report`), so a retry sends exactly the same WhatsApp params and email
 * body even if a late reply has changed the week's numbers since.
 */
export type WeeklyReportSnapshot = {
  org_name: string;
  metrics: WeeklyMetrics | null;
};

/** Payload of a `weekly_report` job, as private.enqueue_weekly_reports writes it, plus the snapshot once taken. */
export type WeeklyReportPayload = {
  /** Monday of the reported week (IST), YYYY-MM-DD. */
  weekStart: string;
  /** ISO week of that Monday, e.g. 2026-W41. */
  isoWeek: string;
  /** Set by the first run; absent before it. */
  report: WeeklyReportSnapshot | null;
};

/** One report per org and week: weekly:<org>:<iso-week> (the job's key). */
export function weeklyReportIdempotencyKey(orgId: string, isoWeek: string): string {
  return `weekly:${orgId}:${isoWeek}`;
}

/** One WhatsApp send per owner phone: weekly:<org>:<iso-week>:whatsapp:<phone>. */
export function weeklySummaryWhatsAppKey(orgId: string, isoWeek: string, phone: string): string {
  return `${weeklyReportIdempotencyKey(orgId, isoWeek)}:whatsapp:${phone}`;
}

/**
 * One email per owner: weekly:<org>:<iso-week>:email:<user_id>. Sent as
 * Resend's Idempotency-Key, so a retried request sends one email.
 */
export function weeklyEmailIdempotencyKey(orgId: string, isoWeek: string, userId: string): string {
  return `${weeklyReportIdempotencyKey(orgId, isoWeek)}:email:${userId}`;
}

const DAY_MS = 86_400_000;

/** A YYYY-MM-DD calendar date as midnight UTC, or null if it is not a real date. */
function parseDate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

/** ISO 8601 week of a calendar date (as midnight UTC): IYYY-Www. */
export function isoWeekOf(date: Date): string {
  // The Thursday of the same ISO week decides the year.
  const dayNum = (date.getUTCDay() + 6) % 7; // Monday = 0
  const thursday = new Date(date.getTime() + (3 - dayNum) * DAY_MS);
  const year = thursday.getUTCFullYear();
  const week = 1 + Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / (7 * DAY_MS));
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export function parseWeeklyReportPayload(raw: unknown): WeeklyReportPayload | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.week_start !== "string" || typeof p.iso_week !== "string") return null;
  const start = parseDate(p.week_start);
  if (!start || start.getUTCDay() !== 1) return null;
  if (isoWeekOf(start) !== p.iso_week) return null;
  let report: WeeklyReportSnapshot | null = null;
  if (p.report !== undefined) {
    const r = p.report as Record<string, unknown> | null;
    if (typeof r !== "object" || r === null || typeof r.org_name !== "string") return null;
    if (r.metrics !== null && (typeof r.metrics !== "object" || Array.isArray(r.metrics))) return null;
    report = { org_name: r.org_name, metrics: r.metrics as WeeklyMetrics | null };
  }
  return { weekStart: p.week_start, isoWeek: p.iso_week, report };
}

/** "7s", "4m 10s", "1h 5m", "2d 3h"; "n/a" when there is no value. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "n/a";
  if (seconds < 1) return "<1s";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const join = (a: number, ua: string, b: number, ub: string) => (b ? `${a}${ua} ${b}${ub}` : `${a}${ua}`);
  if (s < 3600) return join(Math.floor(s / 60), "m", s % 60, "s");
  const m = Math.round(s / 60);
  if (m < 24 * 60) return join(Math.floor(m / 60), "h", m % 60, "m");
  const h = Math.round(s / 3600);
  return join(Math.floor(h / 24), "d", h % 24, "h");
}

/** "60%", "66.7%"; "n/a" when there were no leads. */
export function formatPercent(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return "n/a";
  return `${Number(pct.toFixed(1))}%`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The reported week, Monday to Sunday: "5–11 Oct 2026", "28 Sep – 4 Oct 2026". */
export function weekLabel(weekStart: string): string {
  const start = parseDate(weekStart);
  if (!start) throw new RangeError(`not a date: ${weekStart}`);
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const d = (x: Date) => x.getUTCDate();
  const m = (x: Date) => MONTHS[x.getUTCMonth()];
  const y = (x: Date) => x.getUTCFullYear();
  if (y(start) !== y(end)) return `${d(start)} ${m(start)} ${y(start)} – ${d(end)} ${m(end)} ${y(end)}`;
  if (m(start) !== m(end)) return `${d(start)} ${m(start)} – ${d(end)} ${m(end)} ${y(end)}`;
  return `${d(start)}–${d(end)} ${m(end)} ${y(end)}`;
}

/** WhatsApp template params may not contain newlines, tabs or runs of spaces. */
function flat(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Params of the `weekly_summary` template, in WEEKLY_SUMMARY_TEXT's order. */
export function weeklySummaryParams(studio: string, weekStart: string, m: WeeklyMetrics | null): string[] {
  const params = [
    flat(studio),
    weekLabel(weekStart),
    String(m?.lead_count ?? 0),
    formatDuration(m?.median_seconds_to_auto_reply ?? null),
    formatDuration(m?.p90_seconds_to_auto_reply ?? null),
    formatDuration(m?.median_seconds_to_first_human_reply ?? null),
    formatPercent(m?.pct_human_reply_within_1h ?? null),
  ];
  if (params.length !== WEEKLY_SUMMARY_TEXT.params.length) throw new Error("weekly_summary params out of sync");
  return params;
}

export type ReportEmail = { subject: string; text: string; html: string };

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The email version of the report: the WhatsApp text plus the counts behind each number. */
export function weeklyReportEmail(studio: string, weekStart: string, m: WeeklyMetrics | null): ReportEmail {
  const week = weekLabel(weekStart);
  const n = m?.lead_count ?? 0;
  const rows: [string, string][] = [
    ["New enquiries", String(n)],
    [
      "WhatsApp auto-reply",
      `median ${formatDuration(m?.median_seconds_to_auto_reply ?? null)}, ` +
      `90% within ${formatDuration(m?.p90_seconds_to_auto_reply ?? null)} ` +
      `(${m?.auto_replied_count ?? 0} of ${n} auto-replied)`,
    ],
    [
      "First reply from your team",
      `median ${formatDuration(m?.median_seconds_to_first_human_reply ?? null)} ` +
      `(${m?.human_replied_count ?? 0} of ${n} got a reply)`,
    ],
    [
      "Answered by your team within 1 hour",
      `${formatPercent(m?.pct_human_reply_within_1h ?? null)} (${m?.human_reply_within_1h_count ?? 0} of ${n})`,
    ],
    ["Leads who replied", String(m?.replied_by_lead_count ?? 0)],
  ];
  const title = `Weekly enquiry report for ${studio}, ${week} (IST)`;
  const text = [
    title,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    "Times are from each enquiry to the first reply. A week runs Monday 00:00 to Sunday 23:59 IST.",
  ].join("\n");
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;color:#1c1917">` +
    `<h2 style="font-size:18px">${escapeHtml(title)}</h2>` +
    `<table cellpadding="6" style="border-collapse:collapse">` +
    rows.map(([k, v]) =>
      `<tr><td style="color:#57534e">${escapeHtml(k)}</td><td><strong>${escapeHtml(v)}</strong></td></tr>`
    ).join("") +
    `</table><p style="font-size:12px;color:#78716c">Times are from each enquiry to the first reply. ` +
    `A week runs Monday 00:00 to Sunday 23:59 IST.</p>` +
    `<p style="font-size:12px;color:#78716c">${escapeHtml(renderWeeklySummary(weeklySummaryParams(studio, weekStart, m)))}</p>` +
    `</body></html>`;
  return { subject: `Weekly enquiry report: ${flat(studio)}, ${week}`, text, html };
}

// --- Resend ----------------------------------------------------------------

export const RESEND_EMAILS_URL = "https://api.resend.com/emails";

/** A failed email send. `permanent` when retrying the same request cannot help (a 4xx other than 429). */
export class EmailSendError extends Error {
  override name = "EmailSendError";
  constructor(message: string, readonly permanent: boolean) {
    super(message);
  }
}

export type EmailMessage = {
  apiKey: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  /** Resend keeps it for 24 hours: a retry with the same key and body sends nothing new. */
  idempotencyKey: string;
};

export type EmailSendResult =
  | { status: "sent"; id: string }
  /**
   * Resend answered 409 for the idempotency key: a request with this key was
   * already made (with another body, or is still in progress). The key is
   * per owner and week, so that email went out; nothing to retry.
   */
  | { status: "already_sent"; detail: string };

/**
 * Sends one email with Resend's REST API (POST /emails, Bearer key,
 * Idempotency-Key header). Returns Resend's email id, or `already_sent` on a
 * 409 idempotency conflict. Throws EmailSendError for any other failure.
 * `fetchFn` is injectable so tests never reach the real API.
 */
export function sendResendEmail(msg: EmailMessage, fetchFn: typeof fetch): Promise<EmailSendResult> {
  if (!msg.to.length) throw new RangeError("an email needs at least one recipient");
  return post(msg, fetchFn);
}

async function post(msg: EmailMessage, fetchFn: typeof fetch): Promise<EmailSendResult> {
  let res: Response;
  try {
    res = await fetchFn(RESEND_EMAILS_URL, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${msg.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": msg.idempotencyKey,
      },
      body: JSON.stringify({ from: msg.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new EmailSendError(`resend request failed: ${err instanceof Error ? err.message : String(err)}`, false);
  }
  const body = await res.json().catch(() => null) as { id?: unknown; name?: unknown; message?: unknown } | null;
  const detail = [body?.name, body?.message].filter((x) => typeof x === "string").join(": ");
  if (res.status === 409) return { status: "already_sent", detail: detail || "409 conflict" };
  if (!res.ok) {
    const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
    throw new EmailSendError(`resend returned ${res.status}${detail ? ` (${detail})` : ""}`, permanent);
  }
  if (typeof body?.id !== "string" || !body.id) throw new EmailSendError("resend returned no email id", false);
  return { status: "sent", id: body.id };
}
