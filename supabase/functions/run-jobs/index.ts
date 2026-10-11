// run-jobs: claims due jobs and runs each through the handler for its kind
// (docs/specs/004-production-engine.md, "A. Jobs"). pg_cron calls it every
// minute through pg_net with the `x-run-jobs-secret` header; anything without
// the right secret gets 401.
//
// A handler that throws re-queues its job with backoff (1, 5, 25, 120 minutes).
// After max_attempts, or at once for a PermanentJobError, the job is `dead`:
// a `job_dead` event is written and ops get an `ops_alert` WhatsApp template.
// Full specifier on purpose, as in ingest-form.
// deno-lint-ignore no-import-prefix
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Database, Json } from "../_shared/database.types.ts";
import { errorMessage, must } from "../_shared/db.ts";
import { json } from "../_shared/http.ts";
import { type Job, type JobKind, nextRunAt, opsAlertParams, PermanentJobError } from "../_shared/jobs.ts";
import { normalizeIndianMobile } from "../_shared/phone.ts";
import { getWhatsAppProvider, type WhatsAppProvider } from "../_shared/whatsapp.ts";
import { defaultHandlers, type JobContext, type JobHandler, type JobOutcome } from "./handlers.ts";

export type { JobContext, JobHandler, JobOutcome };

export type Deps = {
  /** Service-role client: bypasses RLS. Never expose it to the browser. */
  db: SupabaseClient<Database>;
  provider: WhatsAppProvider;
  /** The runner's clock: decides which jobs are due and when retries run. */
  now: () => Date;
  env: (k: string) => string | undefined;
  /** Overrides the handler for a kind (tests). */
  handlers?: Partial<Record<JobKind, JobHandler>>;
};

export type RunOptions = {
  /** Jobs claimed (and run concurrently) per round. */
  batchSize?: number;
  /** Stop claiming new rounds after this much wall-clock time. */
  timeBudgetMs?: number;
};

export type RunSummary = {
  claimed: number;
  done: number;
  cancelled: number;
  retried: number;
  dead: number;
  /** Jobs whose outcome could not be recorded; their lease expires and they are retried. */
  errors: number;
};

type Outcome = "done" | "cancelled" | "retried" | "dead";

const DEFAULT_BATCH = 10;
// pg_net waits 55 s; cron fires every 60 s. Overlapping runs are safe anyway
// (claimed jobs are `running`), this just keeps one run inside one minute.
const DEFAULT_BUDGET_MS = 40_000;

/** Claims due jobs in rounds and runs them until none are due or time is up. */
export async function runClaimedJobs(deps: Deps, opts: RunOptions = {}): Promise<RunSummary> {
  const batch = opts.batchSize ?? DEFAULT_BATCH;
  const budget = opts.timeBudgetMs ?? DEFAULT_BUDGET_MS;
  const handlers: Partial<Record<string, JobHandler>> = { ...defaultHandlers, ...deps.handlers };
  const started = performance.now();
  const summary: RunSummary = { claimed: 0, done: 0, cancelled: 0, retried: 0, dead: 0, errors: 0 };

  while (performance.now() - started < budget) {
    const jobs = must(
      await deps.db.rpc("claim_jobs", { batch, as_of: deps.now().toISOString() }),
      "claim jobs",
    ) as Job[];
    if (!jobs.length) break;
    summary.claimed += jobs.length;
    const outcomes = await Promise.all(jobs.map((job) =>
      runOne(job, handlers, deps).catch((err) => {
        log({ job_id: job.id, kind: job.kind, outcome_not_recorded: errorMessage(err) });
        return "error" as const;
      })
    ));
    for (const o of outcomes) summary[o === "error" ? "errors" : o]++;
    if (jobs.length < batch) break;
  }
  return summary;
}

async function runOne(job: Job, handlers: Partial<Record<string, JobHandler>>, deps: Deps): Promise<Outcome> {
  // Reclaimed after its runner vanished on the final attempt: don't run it again.
  if (job.attempts > job.max_attempts) {
    return await deadLetter(job, deps, job.last_error ?? "runner lost the job during its final attempt");
  }

  let outcome: JobOutcome;
  try {
    const handle = handlers[job.kind];
    if (!handle) throw new PermanentJobError(`no handler for job kind ${JSON.stringify(job.kind)}`);
    outcome = (await handle(job, contextFor(deps))) ?? { status: "done" };
  } catch (err) {
    const error = errorMessage(err).slice(0, 1000);
    if (err instanceof PermanentJobError || job.attempts >= job.max_attempts) {
      return await deadLetter(job, deps, error);
    }
    const runAt = nextRunAt(deps.now(), job.attempts).toISOString();
    await settle(job, deps, { status: "queued", run_at: runAt, last_error: error });
    await addEvent(deps, job, "job_retry_scheduled", { attempt: job.attempts, error, run_at: runAt });
    return "retried";
  }

  await settle(job, deps, { status: outcome.status });
  if (outcome.status === "cancelled") await addEvent(deps, job, "job_cancelled", { reason: outcome.reason });
  return outcome.status;
}

function contextFor(deps: Deps): JobContext {
  return {
    db: deps.db,
    provider: deps.provider,
    now: deps.now,
    addEvent: (job, type, payload) => addEvent(deps, job, type, payload),
  };
}

/**
 * Records a job's new state, but only if this runner still holds it (same
 * attempt, still running). Otherwise its lease expired and another runner
 * owns it now.
 */
async function settle(job: Job, deps: Deps, update: Database["public"]["Tables"]["jobs"]["Update"]) {
  const rows = must(
    await deps.db.from("jobs")
      .update({ ...update, updated_at: deps.now().toISOString() })
      .eq("id", job.id)
      .eq("status", "running")
      .eq("attempts", job.attempts)
      .select("id"),
    "settle job",
  );
  if (!rows?.length) log({ job_id: job.id, lost_lease: true, wanted: update.status });
}

async function deadLetter(job: Job, deps: Deps, error: string): Promise<"dead"> {
  await settle(job, deps, { status: "dead", last_error: error });
  await addEvent(deps, job, "job_dead", { attempts: job.attempts, max_attempts: job.max_attempts, error });
  await alertOps(job, deps, error);
  return "dead";
}

/**
 * Sends the `ops_alert` template to OPS_ALERT_PHONE. Recorded as an event
 * either way; never throws (the provider being down is often why the job
 * died, and the alert must not keep the job from being dead-lettered).
 */
async function alertOps(job: Job, deps: Deps, error: string): Promise<void> {
  const raw = deps.env("OPS_ALERT_PHONE");
  const to = raw ? normalizeIndianMobile(raw) : null;
  if (!to) {
    await addEvent(deps, job, "ops_alert_skipped", {
      reason: raw ? "OPS_ALERT_PHONE is not a valid mobile number" : "OPS_ALERT_PHONE is not set",
    });
    return;
  }
  try {
    const { providerMessageId } = await deps.provider.sendTemplate({
      to,
      template: "ops_alert",
      language: "en",
      params: opsAlertParams(job, error),
    });
    await addEvent(deps, job, "ops_alert_sent", { provider_message_id: providerMessageId });
  } catch (err) {
    await addEvent(deps, job, "ops_alert_failed", { error: errorMessage(err) });
  }
}

/** Writes an event for the job's org and lead. Logs instead of throwing. */
async function addEvent(deps: Deps, job: Job, type: string, payload: Record<string, Json> = {}): Promise<void> {
  const { error } = await deps.db.from("events").insert({
    org_id: job.org_id,
    lead_id: job.lead_id,
    type,
    payload: { job_id: job.id, kind: job.kind, ...payload },
    created_at: deps.now().toISOString(),
  });
  if (error) log({ job_id: job.id, event: type, events_insert_failed: error.message });
}

function log(fields: Record<string, unknown>) {
  console.error(JSON.stringify({ fn: "run-jobs", ...fields }));
}

/** Compares secrets without an early exit on the first differing byte. */
export function secretMatches(expected: string | undefined, given: string | null): boolean {
  if (!expected || !given) return false;
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(given);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function handler(req: Request, deps: Deps, opts?: RunOptions): Promise<Response> {
  if (req.method !== "POST") {
    const res = json(405, { error: "Method not allowed" });
    res.headers.set("Allow", "POST");
    return res;
  }
  // Unset RUN_JOBS_SECRET means nobody is allowed, not everybody.
  if (!secretMatches(deps.env("RUN_JOBS_SECRET"), req.headers.get("x-run-jobs-secret"))) {
    return json(401, { error: "Unauthorized" });
  }
  try {
    return json(200, await runClaimedJobs(deps, opts));
  } catch (err) {
    log({ run_failed: errorMessage(err) });
    return json(500, { error: "run failed" });
  }
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
    env,
  };
  Deno.serve((req) => handler(req, deps));
}
