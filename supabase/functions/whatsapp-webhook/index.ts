// whatsapp-webhook: receives the WhatsApp provider's webhooks (spec 004,
// "C. Webhook"): messages from customers, echoes of staff replies typed in the
// WhatsApp Business app, and delivery receipts.
//
// Routing. Each studio's WhatsApp number is configured at the provider with
// its own webhook URL:
//   https://<ref>.supabase.co/functions/v1/whatsapp-webhook?source=<public_key>
// where <public_key> is the org's `whatsapp_inbound` source (the demo org's is
// `demo-whatsapp-inbound`). The signature proves a delivery came from the
// provider; the source says which studio's number it was for.
//
// Steps, per delivery:
// 1. Check the signature: 401 before anything is read or stored.
// 2. Store each event raw in webhook_events, one row per (provider, event id).
//    A signed payload we can't parse is stored as one `invalid` row (keyed by
//    the body's SHA-256) and answered 200: resending won't make it parse.
// 3. Find the source. Unknown: the rows stay unprocessed and we answer 404,
//    so the provider retries once the URL or the source is fixed.
// 4. Process each stored, unprocessed event through process_whatsapp_event,
//    one transaction per event that also sets processed_at. A replay or a
//    concurrent duplicate finds it processed and changes nothing.
// 5. For a lead created by its first message (and not an opt-out): send the
//    session acknowledgement, alert the owners, schedule follow-ups. A failed
//    send is retried through the job queue, as in ingest-form.
//
// Partial failure. When an event fails to process, its row keeps
// processed_at null and records processing_error and attempts; the other
// events of the delivery are still processed. If any failed event has had
// fewer than MAX_PROCESSING_ATTEMPTS tries we answer 500, so the provider
// redelivers: the processed events come back as duplicates and only the
// failed ones run again. Once an event has failed MAX_PROCESSING_ATTEMPTS
// times it is left as a dead letter (a `webhook_event_failed` event and a log
// line) and the delivery is answered 200, so a poison event never keeps the
// provider retrying.
// Full specifier on purpose, as in ingest-form.
// deno-lint-ignore no-import-prefix
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Database, Json } from "../_shared/database.types.ts";
import { errorMessage, must } from "../_shared/db.ts";
import { scheduleFollowUps } from "../_shared/followups.ts";
import { json } from "../_shared/http.ts";
import { ackIdempotencyKey, enqueueJob, nextRunAt, ownerAlertIdempotencyKey } from "../_shared/jobs.ts";
import { isOptOutMessage } from "../_shared/lead_activity.ts";
import { renderInboundAck } from "../_shared/templates.ts";
import { getWhatsAppProvider, type WhatsAppProvider } from "../_shared/whatsapp.ts";
import {
  getWebhookAdapter,
  type InboundEvent,
  type NormalizedEvent,
  type WhatsAppWebhookAdapter,
} from "../_shared/whatsapp_webhook.ts";

export type Deps = {
  /** Service-role client: bypasses RLS. Never expose it to the browser. */
  db: SupabaseClient<Database>;
  adapter: WhatsAppWebhookAdapter;
  /** Sends the acknowledgement and owner alerts for leads created by an inbound message. */
  provider: WhatsAppProvider;
  now: () => Date;
};

/** Tries per event before it is left as a dead letter and the provider gets a 200. */
export const MAX_PROCESSING_ATTEMPTS = 3;

const TEMPLATE_LANGUAGE = "en";
const FN = "whatsapp-webhook";

type StoredEvent = { id: number; provider_event_id: string; processed_at: string | null; attempts: number };

/** What process_whatsapp_event returns (see its migration). */
export type ProcessResult = {
  outcome: "processed" | "duplicate" | "ignored";
  kind?: "inbound" | "echo" | "status";
  lead_id?: string;
  created_lead?: boolean;
  opted_out?: boolean;
  message_id?: string;
  cancelled_jobs?: string[];
  status_applied?: boolean;
  reason?: string;
};

type Source = { id: string; org_id: string; org: { name: string; owner_alert_phones: string[] } };

type EventOutcome =
  | { status: "processed" | "ignored" | "duplicate" }
  | { status: "failed"; attempts: number }
  | { status: "dead" };

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== "POST") {
    const res = json(405, { error: "Method not allowed" });
    res.headers.set("Allow", "POST");
    return res;
  }
  // 1. Signature, before anything is stored.
  if (!(await deps.adapter.verifyWebhook(req))) {
    return json(401, { error: "Invalid signature" });
  }

  const { db, adapter } = deps;
  const raw = await req.text();

  let events: NormalizedEvent[];
  try {
    events = adapter.parseWebhook(JSON.parse(raw));
  } catch (err) {
    // 2a. Signed by the provider but not something we understand.
    try {
      await storeInvalid(deps, raw, errorMessage(err));
    } catch (storeErr) {
      log("store_failed", { error: errorMessage(storeErr) });
      return json(500, { error: "Could not store the webhook" });
    }
    log("invalid_payload", { error: errorMessage(err) });
    return json(200, { received: 0, invalid: true });
  }

  // A delivery that repeats an event id is one event.
  const seen = new Set<string>();
  events = events.filter((e) => !seen.has(e.providerEventId) && seen.add(e.providerEventId));
  if (events.length === 0) return json(200, { received: 0 });

  // 2. Store raw, one row per provider event.
  let stored: Map<string, StoredEvent>;
  try {
    stored = await storeEvents(deps, events);
  } catch (err) {
    log("store_failed", { error: errorMessage(err) });
    return json(500, { error: "Could not store the webhook" });
  }

  // 3. Which studio's number this is.
  const sourceKey = new URL(req.url).searchParams.get("source")?.trim() ?? "";
  let source: Source | null;
  try {
    source = sourceKey ? await findInboundSource(db, sourceKey) : null;
  } catch (err) {
    log("source_lookup_failed", { error: errorMessage(err) });
    return json(500, { error: "Could not route the webhook" });
  }
  if (!source) {
    const why = sourceKey ? `unknown whatsapp_inbound source ${JSON.stringify(sourceKey)}` : "no ?source= on the webhook URL";
    await db.from("webhook_events").update({ processing_error: why })
      .in("id", [...stored.values()].map((r) => r.id)).is("processed_at", null);
    log("unknown_source", { source: sourceKey, events: events.length });
    return json(404, { error: "Unknown source" });
  }

  // 4 and 5. Process each event in the provider's order.
  const outcomes: EventOutcome[] = [];
  for (const event of events) {
    outcomes.push(await processEvent(deps, source, event, stored.get(event.providerEventId)!));
  }

  const count = (s: EventOutcome["status"]) => outcomes.filter((o) => o.status === s).length;
  const retry = outcomes.some((o) => o.status === "failed" && o.attempts < MAX_PROCESSING_ATTEMPTS);
  return json(retry ? 500 : 200, {
    received: events.length,
    processed: count("processed"),
    ignored: count("ignored"),
    duplicates: count("duplicate"),
    failed: count("failed"),
    dead: count("dead"),
  });
}

/** Inserts one row per event (an existing one is kept as is) and returns the rows for all of them. */
async function storeEvents(deps: Deps, events: NormalizedEvent[]): Promise<Map<string, StoredEvent>> {
  const provider = deps.adapter.name;
  must(
    await deps.db.from("webhook_events").upsert(
      events.map((e) => ({
        provider,
        provider_event_id: e.providerEventId,
        kind: e.kind,
        payload: (e.raw ?? {}) as NonNullable<Json>,
        received_at: deps.now().toISOString(),
      })),
      { onConflict: "provider,provider_event_id", ignoreDuplicates: true },
    ),
    "store webhook events",
  );
  const rows = must(
    await deps.db.from("webhook_events")
      .select("id, provider_event_id, processed_at, attempts")
      .eq("provider", provider)
      .in("provider_event_id", events.map((e) => e.providerEventId)),
    "read stored webhook events",
  ) ?? [];
  const byId = new Map(rows.map((r) => [r.provider_event_id, r]));
  for (const e of events) {
    if (!byId.has(e.providerEventId)) throw new Error(`webhook event ${e.providerEventId} was not stored`);
  }
  return byId;
}

/** Keeps a payload that didn't parse, once per distinct body. */
async function storeInvalid(deps: Deps, raw: string, error: string): Promise<void> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  must(
    await deps.db.from("webhook_events").upsert({
      provider: deps.adapter.name,
      provider_event_id: `invalid:${hex}`,
      kind: "invalid",
      payload: { body: raw.slice(0, 100_000) },
      processing_error: error,
      received_at: deps.now().toISOString(),
    }, { onConflict: "provider,provider_event_id", ignoreDuplicates: true }),
    "store invalid webhook",
  );
}

async function findInboundSource(db: Deps["db"], publicKey: string): Promise<Source | null> {
  const row = must(
    await db.from("sources")
      .select("id, org_id, org:orgs!inner(name, owner_alert_phones)")
      .eq("public_key", publicKey)
      .eq("kind", "whatsapp_inbound")
      .maybeSingle(),
    "find source",
  );
  if (!row) return null;
  const org = Array.isArray(row.org) ? row.org[0] : row.org;
  return { id: row.id, org_id: row.org_id, org };
}

/** The event as process_whatsapp_event reads it. */
export function toDbEvent(e: NormalizedEvent): Json {
  return {
    kind: e.kind,
    phone: e.phone,
    text: e.text,
    at: e.at.toISOString(),
    provider_message_id: e.providerMessageId,
    status: e.kind === "status" ? e.status : null,
    error: e.kind === "status" ? e.error : null,
    profile_name: e.kind === "inbound" ? e.profileName : null,
    opt_out: e.kind === "inbound" && isOptOutMessage(e.text),
  };
}

async function processEvent(deps: Deps, source: Source, event: NormalizedEvent, row: StoredEvent): Promise<EventOutcome> {
  if (row.processed_at) return { status: "duplicate" };
  if (row.attempts >= MAX_PROCESSING_ATTEMPTS) return { status: "dead" };

  let result: ProcessResult;
  try {
    result = must(
      await deps.db.rpc("process_whatsapp_event", {
        p_webhook_event_id: row.id,
        p_source_id: source.id,
        p_event: toDbEvent(event),
        p_as_of: deps.now().toISOString(),
      }),
      "process webhook event",
    ) as unknown as ProcessResult;
  } catch (err) {
    return await recordFailure(deps, source, event, row, errorMessage(err));
  }

  if (result.outcome === "duplicate") return { status: "duplicate" };
  if (
    event.kind === "inbound" && result.outcome === "processed" && result.created_lead && !result.opted_out &&
    result.lead_id && event.phone
  ) {
    // Runs once: only the call that created the lead (and processed the event) gets created_lead.
    await welcomeNewLead(deps, source, result.lead_id, { ...event, phone: event.phone });
  }
  return { status: result.outcome };
}

/** Records a failed attempt; after the last one, leaves the event as a dead letter. */
async function recordFailure(
  deps: Deps,
  source: Source,
  event: NormalizedEvent,
  row: StoredEvent,
  error: string,
): Promise<EventOutcome> {
  const attempts = row.attempts + 1;
  const { error: dbError } = await deps.db.from("webhook_events")
    .update({ attempts, processing_error: error, org_id: source.org_id })
    .eq("id", row.id)
    .is("processed_at", null);
  log("event_failed", {
    webhook_event_id: row.id,
    provider_event_id: event.providerEventId,
    attempts,
    error,
    ...(dbError ? { record_error: dbError.message } : {}),
  });
  if (attempts < MAX_PROCESSING_ATTEMPTS) return { status: "failed", attempts };
  await addEvent(deps, source.org_id, null, "webhook_event_failed", {
    webhook_event_id: row.id,
    provider_event_id: event.providerEventId,
    kind: event.kind,
    attempts,
    error,
  });
  return { status: "failed", attempts };
}

// --- A lead created by its first WhatsApp message -----------------------------

/**
 * Same as for a form enquiry: acknowledge the person, alert the owners and
 * schedule the day 1/3/7 follow-ups from the time they wrote. Inside the
 * 24-hour window they just opened, so the acknowledgement is a session
 * message. Never throws: the lead is recorded either way.
 */
async function welcomeNewLead(
  deps: Deps,
  source: Source,
  leadId: string,
  event: InboundEvent & { phone: string },
): Promise<void> {
  const firstName = event.profileName?.split(/\s+/)[0] ?? "there";
  const studio = source.org.name;
  await acknowledge(deps, source.org_id, leadId, event, [firstName, studio]);

  const alertParams = [event.profileName ?? "WhatsApp enquiry", event.phone, "-", "-"];
  await Promise.all(source.org.owner_alert_phones.map((to) => alertOwner(deps, source.org_id, leadId, event.at, to, alertParams)));

  try {
    const { enqueued, cancelled } = await scheduleFollowUps(deps.db, leadId, event.at, deps.now());
    await addEvent(deps, source.org_id, leadId, "followups_scheduled", { job_ids: enqueued, cancelled_job_ids: cancelled });
  } catch (err) {
    await addEvent(deps, source.org_id, leadId, "followups_schedule_failed", { error: errorMessage(err) });
  }
}

async function acknowledge(
  deps: Deps,
  orgId: string,
  leadId: string,
  event: InboundEvent & { phone: string },
  params: string[],
): Promise<void> {
  const { db, provider } = deps;
  const text = renderInboundAck(params);
  const base = {
    org_id: orgId,
    lead_id: leadId,
    to_phone: event.phone,
    direction: "outbound",
    kind: "session",
    body: text,
    provider: provider.name,
  } as const;

  let providerMessageId: string;
  try {
    ({ providerMessageId } = await provider.sendSession({ to: event.phone, text }));
  } catch (err) {
    const error = errorMessage(err);
    const { data } = await db.from("messages").insert({ ...base, status: "failed", error }).select("id").maybeSingle();
    await addEvent(deps, orgId, leadId, "send_failed", { kind: "inbound_ack", message_id: data?.id ?? null, error });
    // Retry through the job queue with the enquiry_ack template, which takes
    // the same params and is allowed inside or outside the window.
    try {
      const jobId = await enqueueJob(db, {
        org_id: orgId,
        lead_id: leadId,
        kind: "send_message",
        run_at: nextRunAt(deps.now(), 1).toISOString(),
        idempotency_key: ackIdempotencyKey(leadId, event.at),
        payload: { to: event.phone, template: "enquiry_ack", language: TEMPLATE_LANGUAGE, params, first_auto_reply: true },
      });
      await addEvent(deps, orgId, leadId, "ack_retry_enqueued", { job_id: jobId, template: "enquiry_ack" });
    } catch (enqueueErr) {
      await addEvent(deps, orgId, leadId, "ack_retry_enqueue_failed", { error: errorMessage(enqueueErr) });
    }
    return;
  }

  // Sent. If recording it fails, log it and don't retry: a retry would send twice.
  const sentAt = deps.now().toISOString();
  try {
    const { data, error } = await db.from("messages")
      .insert({ ...base, status: "sent", provider_message_id: providerMessageId, sent_at: sentAt })
      .select("id").single();
    if (error) throw error;
    must(
      await db.from("leads").update({ first_auto_reply_at: sentAt }).eq("id", leadId).is("first_auto_reply_at", null),
      "set first_auto_reply_at",
    );
    await addEvent(deps, orgId, leadId, "ack_sent", { kind: "inbound_ack", message_id: data.id });
  } catch (err) {
    await addEvent(deps, orgId, leadId, "ack_record_failed", {
      provider_message_id: providerMessageId,
      error: errorMessage(err),
    });
  }
}

/** One owner alert, recorded like ingest-form's (no lead_id on the message); a failure is retried by a job. */
async function alertOwner(
  deps: Deps,
  orgId: string,
  leadId: string,
  enquiryAt: Date,
  to: string,
  params: string[],
): Promise<void> {
  const { db, provider } = deps;
  const base = {
    org_id: orgId,
    lead_id: null,
    to_phone: to,
    direction: "outbound",
    kind: "template",
    template_name: "owner_alert",
    provider: provider.name,
  } as const;
  try {
    const { providerMessageId } = await provider.sendTemplate({ to, template: "owner_alert", language: TEMPLATE_LANGUAGE, params });
    const { data, error } = await db.from("messages")
      .insert({ ...base, status: "sent", provider_message_id: providerMessageId, sent_at: deps.now().toISOString() })
      .select("id").single();
    if (error) {
      await addEvent(deps, orgId, leadId, "message_insert_failed", { template: "owner_alert", lead_id: leadId, error: error.message });
      return;
    }
    await addEvent(deps, orgId, leadId, "owner_alert_sent", { template: "owner_alert", lead_id: leadId, message_id: data.id });
    return;
  } catch (err) {
    const error = errorMessage(err);
    const { data } = await db.from("messages").insert({ ...base, status: "failed", error }).select("id").maybeSingle();
    await addEvent(deps, orgId, leadId, "send_failed", { template: "owner_alert", lead_id: leadId, message_id: data?.id ?? null, error });
  }
  try {
    const jobId = await enqueueJob(db, {
      org_id: orgId,
      lead_id: leadId,
      kind: "send_message",
      run_at: nextRunAt(deps.now(), 1).toISOString(),
      idempotency_key: ownerAlertIdempotencyKey(leadId, enquiryAt, to),
      payload: { to, template: "owner_alert", language: TEMPLATE_LANGUAGE, params, first_auto_reply: false },
    });
    await addEvent(deps, orgId, leadId, "owner_alert_retry_enqueued", { job_id: jobId, template: "owner_alert" });
  } catch (err) {
    await addEvent(deps, orgId, leadId, "owner_alert_retry_enqueue_failed", { error: errorMessage(err) });
  }
}

// --- Logging --------------------------------------------------------------------

/** Writes one `events` row. Never throws; a failure goes to the function log. */
async function addEvent(
  deps: Deps,
  orgId: string,
  leadId: string | null,
  type: string,
  payload: Record<string, Json>,
): Promise<void> {
  const { error } = await deps.db.from("events").insert({
    org_id: orgId,
    lead_id: leadId,
    type,
    payload,
    created_at: deps.now().toISOString(),
  });
  if (error) log("event_insert_failed", { type, error: error.message });
}

function log(event: string, details: Record<string, unknown>) {
  console.error(JSON.stringify({ fn: FN, event, ...details }));
}

if (import.meta.main) {
  const env = (k: string) => Deno.env.get(k);
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  if (!env("WHATSAPP_WEBHOOK_SECRET") && (env("WHATSAPP_PROVIDER") ?? "fake") === "fake") {
    console.error(JSON.stringify({ fn: FN, warning: "WHATSAPP_WEBHOOK_SECRET is unset: every request gets 401" }));
  }

  const deps: Deps = {
    db: createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
    adapter: getWebhookAdapter(env),
    provider: getWhatsAppProvider(env),
    now: () => new Date(),
  };
  Deno.serve((req) => handler(req, deps));
}
