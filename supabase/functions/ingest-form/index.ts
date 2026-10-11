// ingest-form: the public enquiry form endpoint (docs/specs/002-demo-slice.md,
// "ingest-form"). Validates the enquiry, saves the lead, sends the WhatsApp
// acknowledgement and owner alerts, and logs every step to `events`.
// Full specifier on purpose: `deno check`/`deno test` from the repo root don't
// read this folder's deno.json, and the root package.json would otherwise make
// Deno look for the package in node_modules (absent in CI's functions job).
// deno-lint-ignore no-import-prefix
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Database, Json } from "../_shared/database.types.ts";
import { isDuplicateEnquiry } from "../_shared/dedupe.ts";
import { parseEnquiry } from "../_shared/enquiry.ts";
import { handleOptions, json } from "../_shared/http.ts";
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

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}

/** Turns a supabase-js `{ data, error }` result into data or a thrown error. */
function must<T>(res: { data: T; error: { message: string; code?: string } | null }, what: string): T {
  if (res.error) throw Object.assign(new Error(`${what}: ${res.error.message}`), { code: res.error.code });
  return res.data;
}

/** Like `must`, for queries that must return a row (`.single()`). */
function mustRow<T>(res: { data: T; error: { message: string; code?: string } | null }, what: string): NonNullable<T> {
  const data = must(res, what);
  if (data === null || data === undefined) throw new Error(`${what}: no row returned`);
  return data;
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
        .select("id, last_enquiry_at")
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
      const updated = must(
        await db.from("leads")
          .update(fields)
          .eq("id", existing.id)
          .eq("last_enquiry_at", existing.last_enquiry_at)
          .select("id")
          .maybeSingle(),
        "update lead",
      );
      if (!updated) return await duplicate(existing);
      leadId = updated.id;
      log.add("lead_updated");
    } else {
      const inserted = await db.from("leads")
        .insert({ org_id: orgId, phone_e164: enquiry.phone, ...fields })
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
    }

    // 6. Alert the studio owners. Owner alerts have no lead_id (spec).
    const alertParams = [enquiry.name, enquiry.phone, enquiry.bhk ?? "-", enquiry.possessionMonth ?? "-"];
    await Promise.all(org.owner_alert_phones.map((to) =>
      sendAndRecord(deps, log, {
        orgId: orgId!,
        leadId: null,
        aboutLeadId: savedLeadId,
        to,
        template: "owner_alert",
        params: alertParams,
      })
    ));

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

/** Cloudflare Turnstile check. Skipped (passes) when TURNSTILE_SECRET is unset. */
export function makeVerifyTurnstile(
  env: (k: string) => string | undefined,
  fetchFn: typeof fetch = fetch,
): Deps["verifyTurnstile"] {
  return async (token) => {
    const secret = env("TURNSTILE_SECRET");
    if (!secret) return true;
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
  };
  Deno.serve((req) => handler(req, deps));
}
