// deno-lint-ignore no-import-prefix -- test-only std dep; no shared deno.json by design
import { assert, assertEquals, assertRejects, assertStringIncludes, assertThrows } from "jsr:@std/assert@1";
import { renderWeeklySummary, WEEKLY_SUMMARY_TEXT } from "./templates.ts";
import { TEMPLATE_NAMES } from "./whatsapp.ts";
import {
  EmailSendError,
  formatDuration,
  formatPercent,
  parseWeeklyReportPayload,
  sendResendEmail,
  weekLabel,
  type WeeklyMetrics,
  weeklyEmailIdempotencyKey,
  weeklyReportEmail,
  weeklyReportIdempotencyKey,
  weeklySummaryParams,
  weeklySummaryWhatsAppKey,
} from "./weekly_report.ts";

const ORG = "00000000-0000-4000-8000-000000000001";
const USER = "11111111-0000-4000-8000-000000000001";

const METRICS: WeeklyMetrics = {
  lead_count: 5,
  auto_replied_count: 5,
  median_seconds_to_auto_reply: 20,
  p90_seconds_to_auto_reply: 76,
  human_replied_count: 4,
  median_seconds_to_first_human_reply: 2700,
  human_reply_within_1h_count: 3,
  pct_human_reply_within_1h: 60,
  replied_by_lead_count: 1,
};

Deno.test("weekly_summary is a template the provider interface knows", () => {
  assert((TEMPLATE_NAMES as readonly string[]).includes("weekly_summary"));
});

Deno.test("idempotency keys: weekly:<org>:<iso-week>, plus one per WhatsApp recipient and one per owner email", () => {
  assertEquals(weeklyReportIdempotencyKey(ORG, "2026-W41"), `weekly:${ORG}:2026-W41`);
  assertEquals(weeklySummaryWhatsAppKey(ORG, "2026-W41", "+919000000001"), `weekly:${ORG}:2026-W41:whatsapp:+919000000001`);
  assertEquals(weeklyEmailIdempotencyKey(ORG, "2026-W41", USER), `weekly:${ORG}:2026-W41:email:${USER}`);
});

Deno.test("parseWeeklyReportPayload accepts a Monday and its ISO week only", () => {
  assertEquals(parseWeeklyReportPayload({ week_start: "2026-10-05", iso_week: "2026-W41" }), {
    weekStart: "2026-10-05",
    isoWeek: "2026-W41",
    report: null,
  });
  // The snapshot the first run stores is read back as is.
  const report = { org_name: "Studio", metrics: METRICS };
  assertEquals(parseWeeklyReportPayload({ week_start: "2026-10-05", iso_week: "2026-W41", report })?.report, report);
  assertEquals(
    parseWeeklyReportPayload({ week_start: "2026-10-05", iso_week: "2026-W41", report: { org_name: "S", metrics: null } })
      ?.report,
    { org_name: "S", metrics: null },
  );
  assertEquals(parseWeeklyReportPayload({ week_start: "2026-10-05", iso_week: "2026-W41", report: { metrics: null } }), null);
  assertEquals(parseWeeklyReportPayload({ week_start: "2026-10-06", iso_week: "2026-W41" }), null, "a Tuesday");
  assertEquals(parseWeeklyReportPayload({ week_start: "2026-10-05", iso_week: "2026-W42" }), null, "wrong week");
  assertEquals(parseWeeklyReportPayload({ week_start: "2026-13-05", iso_week: "2026-W41" }), null);
  assertEquals(parseWeeklyReportPayload({ week_start: "2026-10-05" }), null);
  assertEquals(parseWeeklyReportPayload(null), null);
  assertEquals(parseWeeklyReportPayload([]), null);
  // ISO week-numbering years: Monday 29 Dec 2025 is in 2026-W01, Monday 28 Dec 2026 in 2026-W53.
  assertEquals(parseWeeklyReportPayload({ week_start: "2025-12-29", iso_week: "2026-W01" })?.isoWeek, "2026-W01");
  assertEquals(parseWeeklyReportPayload({ week_start: "2026-12-28", iso_week: "2026-W53" })?.isoWeek, "2026-W53");
});

Deno.test("formatDuration: seconds, minutes, hours and days; n/a when there is none", () => {
  assertEquals(formatDuration(null), "n/a");
  assertEquals(formatDuration(0.4), "<1s");
  assertEquals(formatDuration(7.4), "7s");
  assertEquals(formatDuration(59.4), "59s");
  assertEquals(formatDuration(60), "1m");
  assertEquals(formatDuration(250), "4m 10s");
  assertEquals(formatDuration(2700), "45m");
  assertEquals(formatDuration(3600), "1h");
  assertEquals(formatDuration(3900), "1h 5m");
  assertEquals(formatDuration(86_400 * 2 + 3 * 3600 + 100), "2d 3h");
});

Deno.test("formatPercent drops a trailing .0", () => {
  assertEquals(formatPercent(60), "60%");
  assertEquals(formatPercent(66.7), "66.7%");
  assertEquals(formatPercent(null), "n/a");
});

Deno.test("weekLabel: Monday to Sunday, across months and years", () => {
  assertEquals(weekLabel("2026-10-05"), "5–11 Oct 2026");
  assertEquals(weekLabel("2026-09-28"), "28 Sep – 4 Oct 2026");
  assertEquals(weekLabel("2025-12-29"), "29 Dec 2025 – 4 Jan 2026");
});

Deno.test("weeklySummaryParams fill the template's seven params in order", () => {
  const params = weeklySummaryParams("Lime & Lattice", "2026-10-05", METRICS);
  assertEquals(params, ["Lime & Lattice", "5–11 Oct 2026", "5", "20s", "1m 16s", "45m", "60%"]);
  assertEquals(params.length, WEEKLY_SUMMARY_TEXT.params.length);
  assertEquals(
    renderWeeklySummary(params),
    "Lime & Lattice: your enquiries for 5–11 Oct 2026. New enquiries: 5. " +
      "WhatsApp auto-reply: median 20s, 90% within 1m 16s. " +
      "First reply from your team: median 45m; 60% answered within 1 hour.",
  );
});

Deno.test("a week with no enquiries still reports, with zeros and n/a", () => {
  const params = weeklySummaryParams("Studio", "2026-10-05", null);
  assertEquals(params, ["Studio", "5–11 Oct 2026", "0", "n/a", "n/a", "n/a", "n/a"]);
  for (const p of params) assert(p.trim() !== "" && !/[\n\t]| {4}/.test(p), "WhatsApp params: non-empty, no newlines");
});

Deno.test("template params never carry newlines or tabs from a studio name", () => {
  const params = weeklySummaryParams("Lime\n&\tLattice   Studio", "2026-10-05", METRICS);
  assertEquals(params[0], "Lime & Lattice Studio");
});

Deno.test("weeklyReportEmail: subject, text and escaped HTML", () => {
  const email = weeklyReportEmail("Lime & <Lattice>", "2026-10-05", METRICS);
  assertEquals(email.subject, "Weekly enquiry report: Lime & <Lattice>, 5–11 Oct 2026");
  assertStringIncludes(email.text, "New enquiries: 5");
  assertStringIncludes(email.text, "median 20s, 90% within 1m 16s (5 of 5 auto-replied)");
  assertStringIncludes(email.text, "median 45m (4 of 5 got a reply)");
  assertStringIncludes(email.text, "within 1 hour: 60% (3 of 5)");
  assertStringIncludes(email.text, "Leads who replied: 1");
  assertStringIncludes(email.text, "IST");
  assertStringIncludes(email.html, "Lime &amp; &lt;Lattice&gt;");
  assert(!email.html.includes("<Lattice>"));
});

type Captured = { url: string; init: RequestInit };

function fakeFetch(status: number, body: unknown, captured: Captured[]): typeof fetch {
  return (input, init) => {
    captured.push({ url: String(input), init: init ?? {} });
    return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  };
}

const EMAIL = {
  apiKey: "re_test_key",
  from: "Flow Systems <reports@example.test>",
  to: ["owner@example.test"],
  subject: "S",
  text: "T",
  html: "<p>H</p>",
  idempotencyKey: `weekly:${ORG}:2026-W41:email:${USER}`,
};

Deno.test("sendResendEmail posts to Resend's /emails with the key, the idempotency key and the message", async () => {
  const captured: Captured[] = [];
  const result = await sendResendEmail(EMAIL, fakeFetch(200, { id: "49a3999c-0ce1" }, captured));
  assertEquals(result, { status: "sent", id: "49a3999c-0ce1" });
  assertEquals(captured.length, 1);
  assertEquals(captured[0].url, "https://api.resend.com/emails");
  assertEquals(captured[0].init.method, "POST");
  const headers = new Headers(captured[0].init.headers);
  assertEquals(headers.get("authorization"), "Bearer re_test_key");
  assertEquals(headers.get("content-type"), "application/json");
  assertEquals(headers.get("idempotency-key"), EMAIL.idempotencyKey);
  assertEquals(JSON.parse(String(captured[0].init.body)), {
    from: EMAIL.from,
    to: EMAIL.to,
    subject: "S",
    text: "T",
    html: "<p>H</p>",
  });
});

Deno.test("sendResendEmail: 429 and 5xx are retryable, other 4xx are permanent, a network error is retryable", async () => {
  const captured: Captured[] = [];
  for (const [status, permanent] of [[429, false], [500, false], [503, false], [422, true], [401, true]] as const) {
    const err = await assertRejects(
      () => sendResendEmail(EMAIL, fakeFetch(status, { name: "x_error", message: `status ${status}` }, captured)),
      EmailSendError,
    );
    assertEquals(err.permanent, permanent, String(status));
    assertStringIncludes(err.message, String(status));
  }
  const err = await assertRejects(
    () => sendResendEmail(EMAIL, () => Promise.reject(new TypeError("connection reset"))),
    EmailSendError,
  );
  assertEquals(err.permanent, false);
  assertStringIncludes(err.message, "connection reset");
});

Deno.test("sendResendEmail: a 409 idempotency conflict means the email with this key already went out", async () => {
  for (const name of ["invalid_idempotent_request", "concurrent_idempotent_requests"]) {
    const result = await sendResendEmail(EMAIL, fakeFetch(409, { name, message: "key already used" }, []));
    assertEquals(result, { status: "already_sent", detail: `${name}: key already used` });
  }
});

Deno.test("sendResendEmail refuses a 200 without an id", async () => {
  await assertRejects(() => sendResendEmail(EMAIL, fakeFetch(200, {}, [])), EmailSendError);
});

Deno.test("sendResendEmail needs at least one recipient", () => {
  assertThrows(() => {
    // Validated before any request.
    void sendResendEmail({ ...EMAIL, to: [] }, () => {
      throw new Error("must not be called");
    });
  }, RangeError);
});
