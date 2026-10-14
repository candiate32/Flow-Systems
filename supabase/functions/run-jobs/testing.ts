// Shared fixtures for the run-jobs tests. Not a test file itself.
//
// Jobs in these tests run on a clock in 2001 (T0). Real jobs run at real
// times, so claim_jobs with an as_of in 2001 only ever sees test jobs, even on
// a database that also holds other work.
// deno-lint-ignore no-import-prefix -- see index.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import type { Database } from "../_shared/database.types.ts";
import type { SessionMessage, TemplateMessage, WhatsAppProvider } from "../_shared/whatsapp.ts";
import type { Deps } from "./index.ts";

export const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
export const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
export const NO_DB = !SERVICE_KEY;

export const DEMO_ORG = "00000000-0000-4000-8000-000000000001";
export const T0 = new Date("2001-01-01T00:00:00.000Z");
export const MIN = 60_000;

/** A db that fails the test if anything touches it. */
export const noDb = new Proxy({}, {
  get() {
    throw new Error("should not touch the database here");
  },
}) as Deps["db"];

export const db: Deps["db"] = NO_DB ? noDb : createClient<Database>(SUPABASE_URL, SERVICE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const dbTest = (name: string, fn: () => Promise<void>) =>
  Deno.test({ name, ignore: NO_DB, sanitizeOps: false, sanitizeResources: false, fn });

/** A random valid Indian mobile. */
export function uniquePhone(): { national: string; e164: string } {
  const digits = Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b % 10).join("");
  return { national: `7${digits}`, e164: `+917${digits}` };
}

export type Call = TemplateMessage & { at: Date; ok: boolean; providerMessageId?: string };
export type SessionCall = SessionMessage & { at: Date; ok: boolean; providerMessageId?: string };

/**
 * Fails the first `failFirst` calls (templates and session messages counted
 * together), then succeeds. Records every call with the clock's time.
 */
export class FlakyProvider implements WhatsAppProvider {
  readonly name = "fake";
  readonly calls: Call[] = [];
  readonly sessionCalls: SessionCall[] = [];
  /** Marks error texts so a test can find the rows it created. */
  readonly marker = `flaky-${crypto.randomUUID()}`;
  private n = 0;

  constructor(private failFirst: number, private clock: () => Date) {}

  sendTemplate(msg: TemplateMessage): Promise<{ providerMessageId: string }> {
    const call: Call = { ...msg, params: [...msg.params], at: this.clock(), ok: false };
    this.calls.push(call);
    return this.answer(call);
  }

  sendSession(msg: SessionMessage): Promise<{ providerMessageId: string }> {
    const call: SessionCall = { to: msg.to, text: msg.text, at: this.clock(), ok: false };
    this.sessionCalls.push(call);
    return this.answer(call);
  }

  private answer(call: { ok: boolean; providerMessageId?: string }): Promise<{ providerMessageId: string }> {
    this.n++;
    if (this.n <= this.failFirst) {
      return Promise.reject(new Error(`provider down (${this.marker}, call ${this.n})`));
    }
    call.ok = true;
    call.providerMessageId = `fake-${crypto.randomUUID()}`;
    return Promise.resolve({ providerMessageId: call.providerMessageId });
  }
}

/** Inserts a lead in the demo org with consent, as ingest-form would. */
export async function insertLead(phone: string): Promise<string> {
  const { data, error } = await db.from("leads")
    .insert({ org_id: DEMO_ORG, name: "Job Test", phone_e164: phone, consent_at: T0.toISOString() })
    .select("id").single();
  if (error) throw error;
  return data.id;
}

/** Removes test jobs left behind by an interrupted run (anything due before 2002). */
export async function purgeTestJobs() {
  await db.from("jobs").delete().lt("run_at", "2002-01-01T00:00:00Z");
}

/** Deletes leads (cascading their jobs, messages and events) and stray rows by job id. */
export async function cleanup(opts: { leadIds?: string[]; jobIds?: string[]; marker?: string }) {
  if (opts.jobIds?.length) {
    for (const id of opts.jobIds) await db.from("events").delete().eq("payload->>job_id", id);
    await db.from("messages").delete().in("job_id", opts.jobIds);
    await db.from("jobs").delete().in("id", opts.jobIds);
  }
  if (opts.marker) await db.from("messages").delete().like("error", `%${opts.marker}%`);
  if (opts.leadIds?.length) await db.from("leads").delete().in("id", opts.leadIds);
}
