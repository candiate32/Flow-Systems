// Creates or updates a client org from a JSON config: the org and its owner
// contacts, its sources and its WhatsApp templates (spec 004, E.1).
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     deno run -A scripts/onboard-org.ts [--dry-run] onboarding/<studio>.json
//
// Safe to run again: an unchanged config writes nothing. Every change gets an
// audit_log row. --dry-run checks the config against the database and prints
// the changes without making them. Sample config: onboarding/demo-interiors.json;
// steps in docs/runbook.md.
// deno-lint-ignore no-import-prefix -- scripts share the functions' full specifiers
import { createClient } from "npm:@supabase/supabase-js@2";
import type { Database } from "../supabase/functions/_shared/database.types.ts";
import { describeChange, executePlan, planOnboarding } from "./onboard/apply.ts";
import { formatError, parseOrgConfig } from "./onboard/config.ts";

const USAGE = "usage: deno run -A scripts/onboard-org.ts [--dry-run] <config.json>";

export async function main(args: string[], env: (k: string) => string | undefined): Promise<number> {
  const dryRun = args.includes("--dry-run");
  const files = args.filter((a) => a !== "--dry-run");
  if (files.length !== 1 || files[0].startsWith("-")) {
    console.error(USAGE);
    return 2;
  }
  const file = files[0];

  let text: string;
  try {
    text = await Deno.readTextFile(file);
  } catch (err) {
    console.error(`${file}: cannot read: ${err instanceof Error ? err.message : err}`);
    return 1;
  }
  const parsed = parseOrgConfig(text);
  if (!parsed.ok) {
    for (const e of parsed.errors) console.error(formatError(file, e));
    console.error(`${parsed.errors.length} problem(s) in ${file}; nothing was written.`);
    return 1;
  }

  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the service role key, from Supabase secrets).");
    return 2;
  }
  const db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const planned = await planOnboarding(db, parsed.config, parsed.locate);
  if (!planned.ok) {
    for (const e of planned.errors) console.error(formatError(file, e));
    console.error(`${planned.errors.length} problem(s) in ${file}; nothing was written.`);
    return 1;
  }
  const { plan } = planned;
  if (plan.changes.length === 0) {
    console.log(`${plan.slug} (${plan.orgId}) is up to date. Nothing to change.`);
    return 0;
  }
  for (const c of plan.changes) console.log(describeChange(c));
  if (dryRun) {
    console.log(`Dry run: ${plan.changes.length} change(s) not written.`);
    return 0;
  }
  await executePlan(db, plan);
  console.log(`Done: ${plan.changes.length} change(s) to ${plan.slug} (${plan.orgId}), each recorded in audit_log.`);
  return 0;
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args, (k) => Deno.env.get(k)));
}
