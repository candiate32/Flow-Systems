// The `canary` job (spec 004, E.2). Once an hour it posts a fake enquiry for
// the canary org (orgs.is_canary) through the real ingest-form URL, then checks
// that the lead's first_auto_reply_at was recorded within 60 seconds of the
// enquiry. If not, or if the post fails, ops get an `ops_alert`. Each run
// queues the next one an hour later and deletes its own leads older than 7 days
// through delete_lead. What to do when it alerts is in docs/runbook.md.
//
// The phone it enquires with:
// - CANARY_PHONE when set: a number ops own, so a real provider only ever
//   messages someone who agreed to it. Its previous canary lead is deleted
//   first, so every hour is a new enquiry rather than a 24-hour duplicate.
// - otherwise a made-up number per hour (+91 6000 plus six digits), allowed
//   only with the fake provider.
//
// A canary lead is one the canary created: from the canary org's web form,
// named "Flow Canary", from CANARY_PHONE or a made-up +916000 number. Cleanup
// and the delete-before-post touch nothing else, so a real lead that ends up
// in the canary org is never deleted by the canary.
//
// The whole run fits inside pg_net's 55 s wait for run-jobs: the post may take
// 20 s and the check ends 40 s after the post started.
// deno-lint-ignore no-import-prefix -- see index.ts
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { CANARY_LEAD_NAME, canaryTurnstileToken, SYNTHETIC_CANARY_PHONE_RE } from "../_shared/canary.ts";
import type { Database, Json } from "../_shared/database.types.ts";
import { errorMessage, must } from "../_shared/db.ts";
import { enqueueJob, type Job } from "../_shared/jobs.ts";
import { normalizeIndianMobile } from "../_shared/phone.ts";
import type { JobContext, JobHandler } from "./handlers.ts";

/** The promise to every lead: an auto-reply within 60 seconds. */
export const AUTO_REPLY_DEADLINE_MS = 60_000;
export const CANARY_INTERVAL_MS = 60 * 60_000;
export const CANARY_RETENTION_MS = 7 * 24 * 60 * 60_000;
/**
 * How long after the post the canary looks for the auto-reply. ingest-form
 * sends the acknowledgement before it answers, so it is normally recorded by
 * the time the post returns. If that inline send failed, the next try is the
 * retry job a minute later, already past the 60 s promise, so waiting longer
 * than this could not turn a failure into a pass.
 */
export const CHECK_WINDOW_MS = 40_000;
const POLL_MS = 2_000;
const POST_TIMEOUT_MS = 20_000;

/**
 * One canary job per org per UTC hour: canary:<org_id>:<YYYY-MM-DDTHH>.
 * Must match private.canary_idempotency_key in the operations migration.
 */
export function canaryIdempotencyKey(orgId: string, runAt: Date): string {
  return `canary:${orgId}:${runAt.toISOString().slice(0, 13)}`;
}

/** A made-up number for the hour: +916000 plus the hour count mod 10^6. */
export function syntheticCanaryPhone(at: Date): string {
  const hour = Math.floor(at.getTime() / CANARY_INTERVAL_MS) % 1_000_000;
  return `+916000${String(hour).padStart(6, "0")}`;
}

/** The database calls the canary makes. Tests swap in an in-memory version. */
export type CanaryStore = {
  isCanaryOrg(orgId: string): Promise<boolean>;
  enqueueCanary(orgId: string, runAt: Date): Promise<void>;
  /** Leads from this source named "Flow Canary" created before `before`, at most `limit`. */
  canaryNamedLeadsBefore(sourceId: string, before: Date, limit: number): Promise<{ id: string; phone: string }[]>;
  /** The lead from this source named "Flow Canary" with this phone, if any. */
  findCanaryLead(sourceId: string, phone: string): Promise<string | null>;
  /** Calls public.delete_lead. */
  deleteLead(leadId: string): Promise<void>;
  /** The canary org's (first) web form. */
  webForm(orgId: string): Promise<{ id: string; public_key: string } | null>;
  autoReply(leadId: string): Promise<{ first_auto_reply_at: string | null; last_enquiry_at: string } | null>;
};

export function supabaseCanaryStore(db: SupabaseClient<Database>): CanaryStore {
  return {
    async isCanaryOrg(orgId) {
      const org = must(await db.from("orgs").select("is_canary").eq("id", orgId).maybeSingle(), "find canary org");
      return org?.is_canary === true;
    },
    async enqueueCanary(orgId, runAt) {
      await enqueueJob(db, {
        org_id: orgId,
        kind: "canary",
        run_at: runAt.toISOString(),
        idempotency_key: canaryIdempotencyKey(orgId, runAt),
      });
    },
    async canaryNamedLeadsBefore(sourceId, before, limit) {
      const rows = must(
        await db.from("leads").select("id, phone_e164").eq("source_id", sourceId).eq("name", CANARY_LEAD_NAME)
          .lt("created_at", before.toISOString()).order("created_at").limit(limit),
        "find old canary leads",
      );
      return (rows ?? []).map((r) => ({ id: r.id, phone: r.phone_e164 }));
    },
    async findCanaryLead(sourceId, phone) {
      const row = must(
        await db.from("leads").select("id").eq("source_id", sourceId).eq("name", CANARY_LEAD_NAME)
          .eq("phone_e164", phone).maybeSingle(),
        "find canary lead",
      );
      return row?.id ?? null;
    },
    async deleteLead(leadId) {
      must(await db.rpc("delete_lead", { lead: leadId }), "delete_lead");
    },
    async webForm(orgId) {
      return must(
        await db.from("sources").select("id, public_key").eq("org_id", orgId).eq("kind", "web_form")
          .order("created_at").limit(1).maybeSingle(),
        "find canary source",
      );
    },
    async autoReply(leadId) {
      return must(
        await db.from("leads").select("first_auto_reply_at, last_enquiry_at").eq("id", leadId).maybeSingle(),
        "read canary lead",
      );
    },
  };
}

export type CanaryDeps = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
  store: (db: JobContext["db"]) => CanaryStore;
};

type Probe =
  | { ok: true; leadId: string; secondsToAutoReply: number; postMs: number }
  | { ok: false; reason: string; leadId?: string };

type Source = { id: string; public_key: string };

export function makeCanaryHandler(deps: CanaryDeps): JobHandler {
  return async (job, ctx) => {
    const store = deps.store(ctx.db);
    if (!(await store.isCanaryOrg(job.org_id))) {
      // Unmarked since this job was queued: the chain ends here.
      return { status: "cancelled", reason: "org is not the canary" };
    }

    // Queue the next run first, so nothing below can end the hourly chain.
    // A failure here throws, and the job is retried before anything is posted.
    await store.enqueueCanary(job.org_id, new Date(ctx.now().getTime() + CANARY_INTERVAL_MS));

    const source = await store.webForm(job.org_id);
    const phone = canaryPhone(ctx);
    if (source) await deleteOldLeads(job, ctx, store, source, phone.ok ? phone.phone : null);

    const probe: Probe = !source
      ? { ok: false, reason: "the canary org has no web_form source" }
      : !phone.ok
      ? { ok: false, reason: phone.reason }
      : await runProbe(ctx, deps, store, source, phone.phone);
    // probe_lead_id, not lead_id: these results outlive the canary lead
    // (delete_lead removes events that carry a lead_id).
    if (probe.ok) {
      await ctx.addEvent(job, "canary_passed", {
        probe_lead_id: probe.leadId,
        seconds_to_auto_reply: probe.secondsToAutoReply,
        post_ms: probe.postMs,
      });
      return;
    }
    // The job itself is done: the next canary is already queued, and a
    // retry would only post another enquiry.
    const payload: Record<string, Json> = { reason: probe.reason };
    if (probe.leadId) payload.probe_lead_id = probe.leadId;
    await ctx.addEvent(job, "canary_failed", payload);
    await ctx.alertOps(job, `canary: ${probe.reason}`);
  };
}

/**
 * Deletes the canary's own leads older than 7 days: from its form, named
 * "Flow Canary", from CANARY_PHONE or a made-up +916000 number. Never throws:
 * cleanup must not stop the check.
 */
async function deleteOldLeads(
  job: Job,
  ctx: JobContext,
  store: CanaryStore,
  source: Source,
  phone: string | null,
): Promise<void> {
  try {
    const before = new Date(ctx.now().getTime() - CANARY_RETENTION_MS);
    const named = await store.canaryNamedLeadsBefore(source.id, before, 100);
    const ids = named.filter((l) => l.phone === phone || SYNTHETIC_CANARY_PHONE_RE.test(l.phone)).map((l) => l.id);
    for (const id of ids) await store.deleteLead(id);
    if (ids.length) await ctx.addEvent(job, "canary_leads_deleted", { count: ids.length });
  } catch (err) {
    await ctx.addEvent(job, "canary_cleanup_failed", { error: errorMessage(err) });
  }
}

/** The number to enquire from: CANARY_PHONE, or a made-up one with the fake provider only. */
function canaryPhone(ctx: JobContext): { ok: true; phone: string } | { ok: false; reason: string } {
  const fixed = ctx.env("CANARY_PHONE");
  const provider = ctx.env("WHATSAPP_PROVIDER") ?? "";
  if (fixed) {
    const p = normalizeIndianMobile(fixed);
    return p ? { ok: true, phone: p } : { ok: false, reason: "CANARY_PHONE is not a valid Indian mobile number" };
  }
  if (provider === "" || provider === "fake") return { ok: true, phone: syntheticCanaryPhone(ctx.now()) };
  return { ok: false, reason: "CANARY_PHONE must be set when a real WhatsApp provider is configured" };
}

async function runProbe(
  ctx: JobContext,
  deps: CanaryDeps,
  store: CanaryStore,
  source: Source,
  phone: string,
): Promise<Probe> {
  const fail = (reason: string, leadId?: string): Probe => ({ ok: false, reason, leadId });

  const url = ctx.env("INGEST_FORM_URL");
  if (!url) return fail("INGEST_FORM_URL is not set");

  // Start with no canary lead for this number, so the enquiry is new and gets
  // an auto-reply instead of being dropped as a duplicate.
  const prior = await store.findCanaryLead(source.id, phone);
  if (prior) await store.deleteLead(prior);

  const secret = ctx.env("CANARY_SECRET");
  const body: Record<string, unknown> = {
    source_key: source.public_key,
    name: CANARY_LEAD_NAME,
    phone,
    consent: true,
  };
  if (secret) body.turnstile_token = canaryTurnstileToken(secret);

  const started = ctx.now();
  let res: Response;
  try {
    res = await deps.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    });
  } catch (err) {
    return fail(`post to ingest-form failed: ${errorMessage(err)}`);
  }
  const postMs = ctx.now().getTime() - started.getTime();
  const text = await res.text().catch(() => "");
  if (res.status !== 200) return fail(`ingest-form returned ${res.status}: ${text.slice(0, 120)}`);

  let out: { lead_id?: unknown; duplicate?: unknown };
  try {
    out = JSON.parse(text);
  } catch {
    return fail("ingest-form returned a body that is not JSON");
  }
  if (typeof out.lead_id !== "string") return fail("ingest-form returned no lead_id");
  const leadId = out.lead_id;
  if (out.duplicate === true) return fail("the canary enquiry was treated as a duplicate", leadId);

  const deadline = started.getTime() + CHECK_WINDOW_MS;
  for (;;) {
    const lead = await store.autoReply(leadId);
    if (!lead) return fail("the canary lead disappeared after the post", leadId);
    if (lead.first_auto_reply_at) {
      const ms = new Date(lead.first_auto_reply_at).getTime() - new Date(lead.last_enquiry_at).getTime();
      const seconds = Math.round(ms / 100) / 10;
      if (ms > AUTO_REPLY_DEADLINE_MS) return fail(`auto-reply took ${seconds} s, over 60 s`, leadId);
      return { ok: true, leadId, secondsToAutoReply: seconds, postMs };
    }
    const left = deadline - ctx.now().getTime();
    if (left <= 0) return fail(`no auto-reply recorded within ${CHECK_WINDOW_MS / 1000} s of the enquiry`, leadId);
    await deps.sleep(Math.min(POLL_MS, left));
  }
}

export const canary: JobHandler = makeCanaryHandler({
  fetch: (url, init) => fetch(url, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  store: supabaseCanaryStore,
});
