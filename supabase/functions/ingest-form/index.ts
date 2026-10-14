// ingest-form: the public enquiry form endpoint (docs/specs/002-demo-slice.md,
// "ingest-form"). Validates the enquiry, saves the lead, sends the WhatsApp
// acknowledgement and owner alerts, schedules the day 1/3/7 follow-ups
// (spec 004, B.1), and logs every step to `events`.
// Full specifier on purpose: `deno check`/`deno test` from the repo root don't
// read this folder's deno.json, and the root package.json would otherwise make
// Deno look for the package in node_modules (absent in CI's functions job).
// deno-lint-ignore no-import-prefix
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Database, Json } from "../_shared/database.types.ts";
import { errorMessage, must, mustRow } from "../_shared/db.ts";
import { isDuplicateEnquiry } from "../_shared/dedupe.ts";
import { parseEnquiry } from "../_shared/enquiry.ts";
import { scheduleFollowUps } from "../_shared/followups.ts";
import { handleOptions, json } from "../_shared/http.ts";
import { ackIdempotencyKey, enqueueJob, nextRunAt, opsAlertParams, ownerAlertIdempotencyKey } from "../_shared/jobs.ts";
import { sendOpsAlert } from "../_shared/ops_alert.ts";
import {
  getWhatsAppProvider,
  type TemplateName,
  type WhatsAppProvider,
} from "../_shared/whatsapp.ts";

export type Deps = {
  /** Service-role client: bypasses RLS. Never expose it to the browser. */
  db: SupabaseClient<Database>;
  provider: WhatsAppProvider;
  now: () => Date;
  verifyTurnstile: (token: string | null) => Promise<boolean>;
  /** Function environment; read for OPS_ALERT_PHONE. Unset means no ops alerts (skipped, and logged). */
  env?: (k: string) => string | undefined;
};

const TEMPLATE_LANGUAGE = "en";

type EventRow = Database["public"]["Tables"]["events"]["Insert"];
type MessageRow = Database["public"]["Tables"]["messages"]["Insert"];

/**
 * Collects the request's events and writes them in one insert once the org is
 * known. Every event carries the request id, and the lead id once there is one,
 * so deleting a lead deletes its trail.
 */
class EventLog {
  private pending: { type: string; payload: Record<string, Json>; at: string }[] = [];

  constructor(
    private readonly db: Deps["db"],
    private readonly now: () => Date,
    readonly requestId: string,
  ) {}

  add(type: string, payload: Record<string, Json> = {}) {
    this.pending.push({ type, payload, at: this.now().toISOString() });
  }

  /** Writes pending events. Without an org they can only go to the function log. */
  async flush(orgId: string | null, leadId: string | null) {
    const batch = this.pending;
    this.pending = [];
    if (batch.length === 0) return;
    if (!orgId) {
      for (const e of batch) {
        console.log(JSON.stringify({ fn: "ingest-form", request_id: this.requestId, event: e.type, ...e.payload }));
      }
      return;
    }
    const rows: EventRow[] = batch.map((e) => ({
      org_id: orgId,
      lead_id: leadId,
      type: e.type,
      payload: { request_id: this.requestId, ...e.payload },
      created_at: e.at,
    }));
    const { error } = await this.db.from("events").insert(rows);
    if (error) {
      console.error(JSON.stringify({ fn: "ingest-form", request_id: this.requestId, events_insert_failed: error.message, rows }));
    }
  }
}

function withRequestId(res: Response, requestId: string): Response {
  res.headers.set("X-Request-Id", requestId);
  return res;
}

export async function handler(req: Request, deps: Deps): Promise<Response> {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== "POST") {
    const res = json(405, { error: "Method not allowed" });
    res.headers.set("Allow", "POST, OPTIONS");
    return res;
  }

  const { db, now } = deps;
  const startedAt = now();
  const requestId = crypto.randomUUID();
  const log = new EventLog(db, now, requestId);
  let orgId: string | null = null;
  let leadId: string | null = null;

  try {
    log.add("enquiry_received");

    // 1. Validate.
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      body = undefined;
    }
    const parsed = body === undefined
      ? { ok: false as const, errors: { body: "Expected a JSON object" } }
      : parseEnquiry(body);

    if (!parsed.ok) {
      // Attribute the rejection to the org when the source key is real, so the
      // studio can see failed submissions. No field values are logged.
      const key = typeof (body as { source_key?: unknown })?.source_key === "string"
        ? (body as { source_key: string }).source_key.trim()
        : "";
      if (key) orgId = (await findSource(db, key).catch(() => null))?.org_id ?? null;
      log.add("enquiry_invalid", { fields: Object.keys(parsed.errors) });
      return withRequestId(json(400, { errors: parsed.errors }), requestId);
    }
    const enquiry = parsed.value;
    log.add("enquiry_validated");

    // 2. Spam check.
    if (!(await deps.verifyTurnstile(enquiry.turnstileToken))) {
      orgId = (await findSource(db, enquiry.sourceKey).catch(() => null))?.org_id ?? null;
      log.add("turnstile_failed");
      return withRequestId(json(403, { error: "Spam check failed. Please try again." }), requestId);
    }
    log.add("turnstile_passed");

    // 3. Source and org.
    const source = await findSource(db, enquiry.sourceKey);
    if (!source) {
      log.add("unknown_source", { source_key: enquiry.sourceKey });
      return withRequestId(json(400, { errors: { source_key: "Unknown source" } }), requestId);
    }
    orgId = source.org_id;
    const org = source.org;
    log.add("source_resolved", { source_id: source.id });

    // 4. Dedupe, then save the lead.
    const nowIso = now().toISOString();
    const existing = must(
      await db.from("leads")
        .select("id, last_enquiry_at, details, opted_out_at")
        .eq("org_id", orgId)
        .eq("phone_e164", enquiry.phone)
        .maybeSingle(),
      "find lead",
    );

    const fields = {
      source_id: source.id,
      name: enquiry.name,
      bhk: enquiry.bhk,
      possession_month: enquiry.possessionMonth,
      consent_at: nowIso,
      last_enquiry_at: nowIso,
    };

    const duplicate = async (lead: { id: string; last_enquiry_at: string } | null) => {
      if (lead) {
        leadId = lead.id;
        must(
          await db.from("leads").update({ last_enquiry_at: nowIso }).eq("id", lead.id),
          "touch lead",
        );
      }
      log.add("duplicate_enquiry", { previous_enquiry_at: lead?.last_enquiry_at ?? null });
      return withRequestId(json(200, { lead_id: leadId, duplicate: true }), requestId);
    };

    if (existing && isDuplicateEnquiry(new Date(existing.last_enquiry_at), now())) {
      return await duplicate(existing);
    }

    if (existing) {
      // Repeat enquiry after 24h. Update only if nobody else got there first
      // (a concurrent submit of the same form), otherwise it's a duplicate.
      // New custom answers replace old ones key by key; unanswered keys are kept.
      // The last_enquiry_at guard below also guards this read-merge-write.
      //
      // A lead who opted out (STOP) and now submits the form again with the
      // consent box ticked has opted back in: this is the only thing that
      // clears opted_out_at (spec 004, "Defaults picked"). A duplicate within
      // 24h returned above and does not. The opted_out_at guard stops this
      // update from wiping a STOP recorded after we read the lead; that case
      // falls through to duplicate() and sends nothing.
      const details = { ...(existing.details as Record<string, Json>), ...enquiry.details };
      const update = db.from("leads")
        .update({ ...fields, details, opted_out_at: null })
        .eq("id", existing.id)
        .eq("last_enquiry_at", existing.last_enquiry_at);
      const updated = must(
        await (existing.opted_out_at
          ? update.eq("opted_out_at", existing.opted_out_at)
          : update.is("opted_out_at", null))
          .select("id")
          .maybeSingle(),
        "update lead",
      );
      if (!updated) return await duplicate(existing);
      leadId = updated.id;
      log.add("lead_updated");
      if (existing.opted_out_at) log.add("lead_opted_in", { previous_opted_out_at: existing.opted_out_at });
    } else {
      const inserted = await db.from("leads")
        .insert({ org_id: orgId, phone_e164: enquiry.phone, ...fields, details: enquiry.details })
        .select("id")
        .single();
      if (inserted.error?.code === "23505") {
        // Same phone inserted by a concurrent request a moment ago.
        const lead = must(
          await db.from("leads").select("id, last_enquiry_at").eq("org_id", orgId)
            .eq("phone_e164", enquiry.phone).maybeSingle(),
          "find lead after conflict",
        );
        return await duplicate(lead);
      }
      leadId = mustRow(inserted, "insert lead").id;
      log.add("lead_created");
    }
    const savedLeadId: string = leadId;

    // 5. Acknowledge the lead on WhatsApp.
    const firstName = enquiry.name.split(/\s+/)[0];
    const ack = await sendAndRecord(deps, log, {
      orgId,
      leadId: savedLeadId,
      to: enquiry.phone,
      template: "enquiry_ack",
      params: [firstName, org.name],
    });
    if (ack.ok) {
      must(
        await db.from("leads")
          .update({ first_auto_reply_at: ack.sentAt })
          .eq("id", savedLeadId)
          .is("first_auto_reply_at", null),
        "set first_auto_reply_at",
      );
    } else {
      // The inline send failed: hand the same template to the job queue, which
      // retries with backoff (spec 004, A.5). The lead still gets a 200.
      await enqueueRetry(deps, log, {
        orgId,
        leadId: savedLeadId,
        key: ackIdempotencyKey(savedLeadId, new Date(nowIso)),
        to: enquiry.phone,
        template: "enquiry_ack",
        params: [firstName, org.name],
      });
    }

    // 6. Alert the studio owners. Owner alerts have no lead_id (spec). A
    //    failed alert is retried through the job queue, like the ack.
    const alertParams = [enquiry.name, enquiry.phone, enquiry.bhk ?? "-", enquiry.possessionMonth ?? "-"];
    await Promise.all(org.owner_alert_phones.map(async (to) => {
      const sent = await sendAndRecord(deps, log, {
        orgId: orgId!,
        leadId: null,
        aboutLeadId: savedLeadId,
        to,
        template: "owner_alert",
        params: alertParams,
      });
      if (!sent.ok) {
        await enqueueRetry(deps, log, {
          orgId: orgId!,
          leadId: savedLeadId,
          key: ownerAlertIdempotencyKey(savedLeadId, new Date(nowIso), to),
          to,
          template: "owner_alert",
          params: alertParams,
        });
      }
    }));

    // 7. Follow-ups on day 1, 3 and 7 (spec 004, B.1). A repeat enquiry after
    //    24h replaces the lead's queued set. Whether each one is still wanted
    //    (reply, opt-out, consent) is decided when it runs.
    await scheduleFollowUpsLogged(deps, log, savedLeadId, new Date(nowIso));

    log.add("enquiry_completed", {
      ack_sent: ack.ok,
      duration_ms: now().getTime() - startedAt.getTime(),
    });
    return withRequestId(json(200, { lead_id: savedLeadId, duplicate: false, ack_sent: ack.ok }), requestId);
  } catch (err) {
    log.add("internal_error", { error: errorMessage(err) });
    return withRequestId(json(500, { error: "Something went wrong. Please try again." }), requestId);
  } finally {
    await log.flush(orgId, leadId);
  }
}

type SourceWithOrg = {
  id: string;
  org_id: string;
  org: { name: string; owner_alert_phones: string[] };
};

async function findSource(db: Deps["db"], publicKey: string): Promise<SourceWithOrg | null> {
  const row = must(
    await db.from("sources")
      .select("id, org_id, org:orgs!inner(name, owner_alert_phones)")
      .eq("public_key", publicKey)
      .maybeSingle(),
    "find source",
  );
  if (!row) return null;
  // The embed is a to-one relation; normalise in case it comes back as an array.
  const org = Array.isArray(row.org) ? row.org[0] : row.org;
  return { id: row.id, org_id: row.org_id, org };
}

type SendResult = { ok: true; sentAt: string } | { ok: false };

/**
 * Sends one template and records it as a message row plus an event. A provider
 * failure becomes a `failed` message and a `send_failed` event, never a throw.
 */
async function sendAndRecord(
  deps: Deps,
  log: EventLog,
  m: {
    orgId: string;
    leadId: string | null;
    aboutLeadId?: string;
    to: string;
    template: TemplateName;
    params: string[];
  },
): Promise<SendResult> {
  const base: MessageRow = {
    org_id: m.orgId,
    lead_id: m.leadId,
    to_phone: m.to,
    direction: "outbound",
    kind: "template",
    template_name: m.template,
    provider: deps.provider.name,
  };
  const eventBase = { template: m.template, ...(m.aboutLeadId ? { lead_id: m.aboutLeadId } : {}) };

  let providerMessageId: string;
  try {
    ({ providerMessageId } = await deps.provider.sendTemplate({
      to: m.to,
      template: m.template,
      language: TEMPLATE_LANGUAGE,
      params: m.params,
    }));
  } catch (err) {
    const error = errorMessage(err);
    const { data, error: dbError } = await deps.db.from("messages")
      .insert({ ...base, status: "failed", error })
      .select("id")
      .single();
    if (dbError) log.add("message_insert_failed", { ...eventBase, error: dbError.message });
    log.add("send_failed", { ...eventBase, message_id: data?.id ?? null, error });
    return { ok: false };
  }

  const sentAt = deps.now().toISOString();
  const message = mustRow(
    await deps.db.from("messages")
      .insert({ ...base, status: "sent", provider_message_id: providerMessageId, sent_at: sentAt })
      .select("id")
      .single(),
    "insert message",
  );
  log.add(m.template === "owner_alert" ? "owner_alert_sent" : "ack_sent", {
    ...eventBase,
    message_id: message.id,
  });
  return { ok: true, sentAt };
}

/**
 * Enqueues a `send_message` job that resends a failed template, first try one
 * minute from now (the first backoff step; the inline send was attempt zero).
 * The idempotency key names the lead and this enquiry's time (and, for owner
 * alerts, the owner phone), so a replayed request can't enqueue it twice.
 *
 * The job's lead_id is the enquiring lead for both templates: deleting the
 * lead removes its pending retries. For owner alerts the run-jobs handler
 * checks the recipient against the org's owner_alert_phones instead of the
 * lead's phone, and records the message without a lead_id.
 *
 * Never throws: the lead is saved either way.
 */
async function enqueueRetry(
  deps: Deps,
  log: EventLog,
  r: { orgId: string; leadId: string; key: string; to: string; template: "enquiry_ack" | "owner_alert"; params: string[] },
): Promise<void> {
  const eventPrefix = r.template === "enquiry_ack" ? "ack" : "owner_alert";
  try {
    const jobId = await enqueueJob(deps.db, {
      org_id: r.orgId,
      lead_id: r.leadId,
      kind: "send_message",
      run_at: nextRunAt(deps.now(), 1).toISOString(),
      idempotency_key: r.key,
      payload: {
        to: r.to,
        template: r.template,
        language: TEMPLATE_LANGUAGE,
        params: r.params,
        first_auto_reply: r.template === "enquiry_ack",
      },
    });
    log.add(`${eventPrefix}_retry_enqueued`, { job_id: jobId, template: r.template });
  } catch (err) {
    log.add(`${eventPrefix}_retry_enqueue_failed`, { template: r.template, error: errorMessage(err) });
  }
}

/**
 * Enqueues the enquiry's follow-ups. Never throws: the lead is saved and
 * acknowledged either way. A failure is logged and ops are alerted (ops_alert
 * params: "followups_schedule", the lead id, 1, the error), since otherwise
 * this lead would silently get no follow-ups.
 */
async function scheduleFollowUpsLogged(deps: Deps, log: EventLog, leadId: string, enquiryAt: Date): Promise<void> {
  try {
    const { enqueued, cancelled } = await scheduleFollowUps(deps.db, leadId, enquiryAt, deps.now());
    log.add("followups_scheduled", { job_ids: enqueued, cancelled_job_ids: cancelled });
  } catch (err) {
    const error = errorMessage(err);
    log.add("followups_schedule_failed", { error });
    const alert = await sendOpsAlert(
      deps.provider,
      deps.env ?? (() => undefined),
      opsAlertParams({ kind: "followups_schedule", id: leadId, attempts: 1 }, error),
    );
    log.add(alert.type, alert.payload);
  }
}

/** Cloudflare Turnstile check. Skipped (passes) when TURNSTILE_SECRET is unset. */
export function makeVerifyTurnstile(
  env: (k: string) => string | undefined,
  fetchFn: typeof fetch = fetch,
): Deps["verifyTurnstile"] {
  return async (token) => {
    const secret = env("TURNSTILE_SECRET");
    if (!secret) {
      // Only the fake provider may run without spam protection; a real one would send WhatsApp to anyone.
      const provider = env("WHATSAPP_PROVIDER") ?? "";
      return provider === "" || provider === "fake";
    }
    if (!token) return false;
    try {
      const res = await fetchFn("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        body: new URLSearchParams({ secret, response: token }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return false;
      const out = await res.json() as { success?: boolean };
      return out.success === true;
    } catch (err) {
      console.error(JSON.stringify({ fn: "ingest-form", turnstile_error: errorMessage(err) }));
      return false;
    }
  };
}

if (import.meta.main) {
  const env = (k: string) => Deno.env.get(k);
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");

  const deps: Deps = {
    db: createClient<Database>(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    provider: getWhatsAppProvider(env),
    now: () => new Date(),
    verifyTurnstile: makeVerifyTurnstile(env),
    env,
  };
  Deno.serve((req) => handler(req, deps));
}
