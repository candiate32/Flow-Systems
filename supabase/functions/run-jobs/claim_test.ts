// Two claimers at once never get the same job (spec 004, A.2), with real
// concurrent sessions. pgTAP can't stage this (one session never blocks on its
// own locks; see supabase/tests/database/jobs.test.sql), so it lives here:
// - one connection opens a transaction, claims, and keeps its row locks;
// - meanwhile a second session (PostgREST, as service_role) claims too.
// The second claim must return at once (SKIP LOCKED, not wait) and must not
// include the job the first one holds.
//
// The direct connection uses SUPABASE_DB_URL, default the local stack's
// documented postgres URL.
// deno-lint-ignore no-import-prefix -- test-only dep; no shared deno.json by design
import { assert, assertEquals } from "jsr:@std/assert@1";
// deno-lint-ignore no-import-prefix -- test-only dep; no shared deno.json by design
import postgres from "npm:postgres@3.4.5";
import { cleanup, db, dbTest, DEMO_ORG, MIN, purgeTestJobs, T0 } from "./testing.ts";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

async function seedJobs(n: number, runAt: Date): Promise<string[]> {
  const rows = Array.from({ length: n }, () => ({
    org_id: DEMO_ORG,
    kind: "send_message",
    run_at: runAt.toISOString(),
    idempotency_key: `test:${crypto.randomUUID()}`,
  }));
  const { data, error } = await db.from("jobs").insert(rows).select("id");
  if (error) throw error;
  return data.map((r) => r.id);
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} blocked for ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

dbTest("claim_jobs: a claim held open in one session is skipped, not shared, by a concurrent claim", async () => {
  await purgeTestJobs();
  const ids = await seedJobs(3, T0);
  const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
  const asOf = T0.toISOString();
  try {
    let held: string[] = [];
    let other: string[] = [];
    await sql.begin(async (tx) => {
      const rows = await tx`select id from private.claim_jobs(1, ${asOf}::timestamptz)`;
      held = rows.map((r) => r.id as string);
      assertEquals(held.length, 1);

      // Second claimer while the first transaction is still open.
      const res = await withTimeout(
        Promise.resolve(db.rpc("claim_jobs", { batch: 10, as_of: asOf })),
        5000,
        "concurrent claim",
      );
      if (res.error) throw res.error;
      other = res.data!.map((j) => j.id);
    });

    assertEquals(other.length, 2, "the concurrent claim gets the other two jobs");
    assert(!other.includes(held[0]), "and not the one held by the open claim");
    assertEquals([...held, ...other].sort(), [...ids].sort());

    const { data: rows } = await db.from("jobs").select("status, attempts").in("id", ids);
    assert(rows!.every((r) => r.status === "running" && r.attempts === 1), "each job claimed exactly once");
  } finally {
    await sql.end();
    await cleanup({ jobIds: ids });
  }
});

dbTest("claim_jobs: many concurrent claimers split the queue with no overlap", async () => {
  await purgeTestJobs();
  const ids = await seedJobs(40, new Date(T0.getTime() + MIN));
  try {
    const asOf = new Date(T0.getTime() + 2 * MIN).toISOString();
    const claimed: string[] = [];
    // Eight claimers in parallel, each claiming batches of 3 until the queue is empty.
    await Promise.all(Array.from({ length: 8 }, async () => {
      while (true) {
        const { data, error } = await db.rpc("claim_jobs", { batch: 3, as_of: asOf });
        if (error) throw error;
        if (!data!.length) return;
        claimed.push(...data!.map((j) => j.id));
      }
    }));
    assertEquals(claimed.length, ids.length, "no job claimed twice");
    assertEquals(new Set(claimed).size, ids.length);
    assertEquals([...claimed].sort(), [...ids].sort());
    const { data: rows } = await db.from("jobs").select("attempts").in("id", ids);
    assert(rows!.every((r) => r.attempts === 1));
  } finally {
    await cleanup({ jobIds: ids });
  }
});
