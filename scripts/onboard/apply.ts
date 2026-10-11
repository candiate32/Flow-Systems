// Turns a validated onboarding config into database writes (scripts/onboard-org.ts).
//
// planOnboarding compares the config with what is in the database and lists
// the changes; executePlan makes them, each followed by its audit_log row.
// Running the same config twice plans nothing the second time, so it writes
// nothing and adds no audit rows. Rows the config doesn't mention (an old
// source, a template no longer listed) are left alone.
//
// The writes are separate requests, not one transaction. If a run stops part
// way, running it again finishes the job.
// deno-lint-ignore no-import-prefix -- scripts share the functions' full specifiers
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Database, Json } from "../../supabase/functions/_shared/database.types.ts";
import { must } from "../../supabase/functions/_shared/db.ts";
import type { ConfigError, Locate, OrgConfig } from "./config.ts";

type Tables = Database["public"]["Tables"];
type OrgRow = Tables["orgs"]["Row"];
type SourceRow = Tables["sources"]["Row"];
type TemplateRow = Tables["templates"]["Row"];

export type Db = SupabaseClient<Database>;
export type FieldChange = { from: Json; to: Json };

export type Change =
  | { table: "orgs"; op: "create"; target: string; row: Tables["orgs"]["Insert"] & { id: string } }
  | { table: "orgs"; op: "update"; target: string; id: string; changes: Record<string, FieldChange> }
  | { table: "sources"; op: "create"; target: string; row: Tables["sources"]["Insert"] }
  | { table: "sources"; op: "update"; target: string; id: string; changes: Record<string, FieldChange> }
  | { table: "templates"; op: "create"; target: string; row: Tables["templates"]["Insert"] }
  | { table: "templates"; op: "update"; target: string; id: string; changes: Record<string, FieldChange> };

export type Plan = { orgId: string; slug: string; changes: Change[] };

export type PlanResult = { ok: true; plan: Plan } | { ok: false; errors: ConfigError[] };

const ORG_FIELDS = [
  "slug",
  "name",
  "timezone",
  "is_demo",
  "is_canary",
  "owner_alert_phones",
  "whatsapp_fallback_phone",
] as const;

export async function planOnboarding(db: Db, config: OrgConfig, locate: Locate): Promise<PlanResult> {
  const errors: ConfigError[] = [];
  const err = (path: string, message: string) => errors.push({ path, pos: locate(path), message });

  // The org: by id when the config fixes one, otherwise by slug.
  const bySlug = must(await db.from("orgs").select("*").eq("slug", config.slug).maybeSingle(), "find org by slug");
  let existing: OrgRow | null = bySlug;
  if (config.id) {
    existing = must(await db.from("orgs").select("*").eq("id", config.id).maybeSingle(), "find org by id");
    if (bySlug && bySlug.id !== config.id) {
      err("slug", `is already used by another org (${bySlug.name}, ${bySlug.id})`);
    }
  }
  const orgId = existing?.id ?? config.id ?? crypto.randomUUID();

  if (config.is_canary) {
    const canaries = must(await db.from("orgs").select("id, slug").eq("is_canary", true), "find canary org");
    const other = canaries?.find((o) => o.id !== orgId);
    if (other) err("is_canary", `org ${other.slug} is already the canary; there can be only one`);
  }

  const keys = config.sources.map((s) => s.public_key);
  const sourceRows: SourceRow[] = keys.length
    ? must(await db.from("sources").select("*").in("public_key", keys), "find sources") ?? []
    : [];
  config.sources.forEach((s, n) => {
    const row = sourceRows.find((r) => r.public_key === s.public_key);
    if (row && row.org_id !== orgId) {
      err(`sources[${n}].public_key`, `${JSON.stringify(s.public_key)} already belongs to another org's source`);
    }
  });

  if (errors.length) return { ok: false, errors };

  const templateRows: TemplateRow[] = existing
    ? must(await db.from("templates").select("*").eq("org_id", orgId), "find templates") ?? []
    : [];

  const changes: Change[] = [];
  const orgTarget = `org:${config.slug}`;
  const wanted: Pick<OrgRow, typeof ORG_FIELDS[number]> = {
    slug: config.slug,
    name: config.name,
    timezone: config.timezone,
    is_demo: config.is_demo,
    is_canary: config.is_canary,
    owner_alert_phones: config.owner_alert_phones,
    whatsapp_fallback_phone: config.whatsapp_fallback_phone,
  };
  if (!existing) {
    changes.push({ table: "orgs", op: "create", target: orgTarget, row: { id: orgId, ...wanted } });
  } else {
    const diff = diffFields(existing, wanted);
    if (Object.keys(diff).length) {
      changes.push({ table: "orgs", op: "update", target: orgTarget, id: orgId, changes: diff });
    }
  }

  for (const s of config.sources) {
    const target = `source:${s.public_key}`;
    const row = sourceRows.find((r) => r.public_key === s.public_key);
    if (!row) {
      changes.push({ table: "sources", op: "create", target, row: { org_id: orgId, ...s } });
      continue;
    }
    const diff = diffFields(row, { kind: s.kind, name: s.name });
    if (Object.keys(diff).length) changes.push({ table: "sources", op: "update", target, id: row.id, changes: diff });
  }

  for (const t of config.templates) {
    const target = `template:${t.name}/${t.language}`;
    const row = templateRows.find((r) => r.name === t.name && r.language === t.language);
    const fields: Partial<TemplateRow> = { body: t.body, param_names: t.param_names, category: "utility" };
    if (t.status !== undefined) fields.status = t.status;
    if (t.provider_template_id !== undefined) fields.provider_template_id = t.provider_template_id;
    if (!row) {
      changes.push({
        table: "templates",
        op: "create",
        target,
        row: {
          org_id: orgId,
          name: t.name,
          language: t.language,
          status: "draft",
          ...fields,
        } as Tables["templates"]["Insert"],
      });
      continue;
    }
    const diff = diffFields(row, fields);
    if (Object.keys(diff).length) changes.push({ table: "templates", op: "update", target, id: row.id, changes: diff });
  }

  return { ok: true, plan: { orgId, slug: config.slug, changes } };
}

/** Makes the planned changes in order, writing an audit_log row after each. */
export async function executePlan(db: Db, plan: Plan): Promise<void> {
  for (const c of plan.changes) {
    let details: Record<string, Json>;
    if (c.op === "create") {
      must(await db.from(c.table).insert(c.row as never), `create ${c.target}`);
      const { org_id: _org, id: _id, ...fields } = c.row as Record<string, Json>;
      details = { via: "onboard-org", fields };
    } else {
      const set = Object.fromEntries(Object.entries(c.changes).map(([k, v]) => [k, v.to]));
      must(await db.from(c.table).update(set as never).eq("id", c.id), `update ${c.target}`);
      details = { via: "onboard-org", changes: c.changes };
    }
    must(
      await db.from("audit_log").insert({
        org_id: plan.orgId,
        actor: "system",
        action: `${singular(c.table)}.${c.op === "create" ? "created" : "updated"}`,
        target: c.target,
        details,
      }),
      `audit ${c.target}`,
    );
  }
}

/** One line per change, for the command's output. */
export function describeChange(c: Change): string {
  if (c.op === "create") return `create ${c.target}`;
  const fields = Object.entries(c.changes).map(([k, v]) =>
    `${k}: ${JSON.stringify(v.from)} -> ${JSON.stringify(v.to)}`
  );
  return `update ${c.target} (${fields.join("; ")})`;
}

function singular(table: Change["table"]): string {
  return table === "orgs" ? "org" : table === "sources" ? "source" : "template";
}

function diffFields<T extends Record<string, unknown>>(current: T, wanted: Partial<T>): Record<string, FieldChange> {
  const out: Record<string, FieldChange> = {};
  for (const [k, to] of Object.entries(wanted)) {
    const from = current[k];
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      out[k] = { from: (from ?? null) as Json, to: (to ?? null) as Json };
    }
  }
  return out;
}
