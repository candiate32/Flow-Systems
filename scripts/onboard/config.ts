// Onboarding config for scripts/onboard-org.ts: one JSON file per studio
// (sample: onboarding/demo-interiors.json). This module parses and validates
// it without touching the database; every error names its line and column.
import { normalizeIndianMobile } from "../../supabase/functions/_shared/phone.ts";
import { childPath, JsonSyntaxError, parseJsonWithPositions, type Pos } from "./json.ts";

/** Templates the engine sends (spec 004, "Schema additions"). */
export const KNOWN_TEMPLATE_NAMES = [
  "enquiry_ack",
  "owner_alert",
  "followup_1",
  "followup_2",
  "followup_3",
  "weekly_summary",
  "ops_alert",
] as const;
export type KnownTemplateName = typeof KNOWN_TEMPLATE_NAMES[number];

export const SOURCE_KINDS = ["web_form", "whatsapp_inbound"] as const;
export const TEMPLATE_STATUSES = ["draft", "submitted", "approved", "rejected"] as const;

export type SourceConfig = { kind: typeof SOURCE_KINDS[number]; name: string; public_key: string };

export type TemplateConfig = {
  name: KnownTemplateName;
  language: string;
  body: string;
  param_names: string[];
  /** Only written when given: the provider's review moves these on later. */
  status?: typeof TEMPLATE_STATUSES[number];
  provider_template_id?: string | null;
};

export type OrgConfig = {
  /** Fixed id (e.g. the seeded demo org). Without it the org is matched by slug. */
  id?: string;
  slug: string;
  name: string;
  timezone: string;
  is_demo: boolean;
  is_canary: boolean;
  /** E.164 */
  owner_alert_phones: string[];
  /** E.164 */
  whatsapp_fallback_phone: string | null;
  sources: SourceConfig[];
  templates: TemplateConfig[];
};

export type ConfigError = { path: string; pos: Pos; message: string };

/** Finds where a path is in the file (or its nearest parent that is there). */
export type Locate = (path: string) => Pos;

export type ConfigResult =
  | { ok: true; config: OrgConfig; locate: Locate }
  | { ok: false; errors: ConfigError[] };

export function formatError(file: string, e: ConfigError): string {
  return `${file}:${e.pos.line}:${e.pos.col}: ${e.path ? `${e.path}: ` : ""}${e.message}`;
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LANGUAGE_RE = /^[a-z]{2,3}(?:_[A-Z]{2})?$/;
const PARAM_NAME_RE = /^[a-z][a-z0-9_]{0,31}$/;
const PLACEHOLDER_RE = /\{\{\s*(\d+)\s*\}\}/g;

const ORG_KEYS = [
  "id",
  "slug",
  "name",
  "timezone",
  "is_demo",
  "is_canary",
  "owner_alert_phones",
  "whatsapp_fallback_phone",
  "sources",
  "templates",
];
const SOURCE_KEYS = ["kind", "name", "public_key"];
const TEMPLATE_KEYS = ["name", "language", "body", "param_names", "status", "provider_template_id"];

export function parseOrgConfig(text: string): ConfigResult {
  let parsed;
  try {
    parsed = parseJsonWithPositions(text);
  } catch (err) {
    if (err instanceof JsonSyntaxError) {
      return { ok: false, errors: [{ path: "", pos: err.pos, message: `Invalid JSON: ${err.message}` }] };
    }
    throw err;
  }
  const { value, positions } = parsed;
  const locate: Locate = (path) => {
    for (let p = path;; p = parentPath(p)) {
      const pos = positions.get(p);
      if (pos) return pos;
      if (p === "") return { line: 1, col: 1 };
    }
  };
  const errors: ConfigError[] = [];
  const err = (path: string, message: string) => errors.push({ path, pos: locate(path), message });

  if (!isObject(value)) {
    err("", "The config must be a JSON object");
    return { ok: false, errors };
  }
  rejectUnknownKeys(value, "", ORG_KEYS, err);

  const str = (obj: Record<string, unknown>, path: string, key: string, opts: { max: number; optional?: boolean }) => {
    const p = childPath(path, key);
    const v = obj[key];
    if (v === undefined || v === null) {
      if (!opts.optional) err(p, "is required");
      return undefined;
    }
    if (typeof v !== "string") return void err(p, "must be a string");
    const t = v.trim();
    if (t === "") return void err(p, "must not be empty");
    if (t.length > opts.max) return void err(p, `must be at most ${opts.max} characters`);
    return t;
  };
  const bool = (obj: Record<string, unknown>, key: string): boolean => {
    const v = obj[key];
    if (v === undefined) return false;
    if (typeof v !== "boolean") {
      err(key, "must be true or false");
      return false;
    }
    return v;
  };
  const phone = (path: string, v: unknown): string | undefined => {
    if (typeof v !== "string") return void err(path, "must be a phone number in quotes");
    const e164 = normalizeIndianMobile(v);
    if (!e164) return void err(path, `${JSON.stringify(v)} is not an Indian mobile number (10 digits, starting 6-9)`);
    return e164;
  };

  // Org --------------------------------------------------------------------------
  let id: string | undefined;
  if (value.id !== undefined) {
    if (typeof value.id !== "string" || !UUID_RE.test(value.id)) err("id", "must be a lowercase UUID");
    else id = value.id;
  }
  const slug = str(value, "", "slug", { max: 48 });
  if (slug !== undefined && (!SLUG_RE.test(slug) || slug.length < 3)) {
    err("slug", "must be 3-48 lowercase letters, digits and single hyphens, e.g. lime-and-lattice");
  }
  const name = str(value, "", "name", { max: 120 });
  const timezone = str(value, "", "timezone", { max: 64, optional: true }) ?? "Asia/Kolkata";
  if (!isTimeZone(timezone)) err("timezone", `${JSON.stringify(timezone)} is not an IANA time zone`);
  const isDemo = bool(value, "is_demo");
  const isCanary = bool(value, "is_canary");

  const ownerPhones: string[] = [];
  const rawOwners = value.owner_alert_phones;
  if (rawOwners !== undefined) {
    if (!Array.isArray(rawOwners)) err("owner_alert_phones", "must be a list of phone numbers");
    else {
      rawOwners.forEach((v, n) => {
        const p = childPath("owner_alert_phones", n);
        const e164 = phone(p, v);
        if (!e164) return;
        const first = ownerPhones.indexOf(e164);
        if (first >= 0) err(p, `is the same number as owner_alert_phones[${first}]`);
        else ownerPhones.push(e164);
      });
    }
  }
  let fallback: string | null = null;
  if (value.whatsapp_fallback_phone !== undefined && value.whatsapp_fallback_phone !== null) {
    fallback = phone("whatsapp_fallback_phone", value.whatsapp_fallback_phone) ?? null;
  }

  // Sources ----------------------------------------------------------------------
  const sources: SourceConfig[] = [];
  const rawSources = value.sources;
  if (rawSources === undefined) err("sources", "is required: list at least the studio's web form");
  else if (!Array.isArray(rawSources)) err("sources", "must be a list");
  else {
    const seenKeys = new Map<string, number>();
    let inbound = -1;
    rawSources.forEach((s, n) => {
      const p = childPath("sources", n);
      if (!isObject(s)) return void err(p, "must be an object with kind, name and public_key");
      rejectUnknownKeys(s, p, SOURCE_KEYS, err);
      const kind = str(s, p, "kind", { max: 32 });
      if (kind !== undefined && !(SOURCE_KINDS as readonly string[]).includes(kind)) {
        err(childPath(p, "kind"), `must be one of ${SOURCE_KINDS.join(", ")}`);
      }
      if (kind === "whatsapp_inbound") {
        if (inbound >= 0) {
          err(childPath(p, "kind"), `only one whatsapp_inbound source per org (see sources[${inbound}])`);
        } else inbound = n;
      }
      const sName = str(s, p, "name", { max: 120 });
      const key = str(s, p, "public_key", { max: 64 });
      if (key !== undefined) {
        if (!SLUG_RE.test(key) || key.length < 3) {
          err(childPath(p, "public_key"), "must be 3-64 lowercase letters, digits and single hyphens");
        } else if (seenKeys.has(key)) {
          err(childPath(p, "public_key"), `is already used by sources[${seenKeys.get(key)}]`);
        } else seenKeys.set(key, n);
      }
      if (kind && sName && key) sources.push({ kind: kind as SourceConfig["kind"], name: sName, public_key: key });
    });
    if (rawSources.length === 0) err("sources", "list at least the studio's web form");
  }

  // Templates --------------------------------------------------------------------
  const templates: TemplateConfig[] = [];
  const rawTemplates = value.templates;
  if (rawTemplates !== undefined) {
    if (!Array.isArray(rawTemplates)) err("templates", "must be a list");
    else {
      const seen = new Map<string, number>();
      rawTemplates.forEach((t, n) => {
        const p = childPath("templates", n);
        if (!isObject(t)) return void err(p, "must be an object with name, body and param_names");
        rejectUnknownKeys(t, p, TEMPLATE_KEYS, err);
        const before = errors.length;

        const tName = str(t, p, "name", { max: 64 });
        if (tName !== undefined && !(KNOWN_TEMPLATE_NAMES as readonly string[]).includes(tName)) {
          err(
            childPath(p, "name"),
            `${JSON.stringify(tName)} is not a template the engine sends; use one of ${
              KNOWN_TEMPLATE_NAMES.join(", ")
            }`,
          );
        }
        const language = str(t, p, "language", { max: 8, optional: true }) ?? "en";
        if (!LANGUAGE_RE.test(language)) err(childPath(p, "language"), "must be a language code like en or en_US");
        if (tName !== undefined) {
          const k = `${tName}/${language}`;
          if (seen.has(k)) err(p, `duplicates templates[${seen.get(k)}] (same name and language)`);
          else seen.set(k, n);
        }

        const paramNames: string[] = [];
        const rawParams = t.param_names;
        if (rawParams === undefined) err(childPath(p, "param_names"), "is required (use [] when the body has none)");
        else if (!Array.isArray(rawParams)) err(childPath(p, "param_names"), "must be a list of names");
        else {
          rawParams.forEach((v, k) => {
            const pp = childPath(childPath(p, "param_names"), k);
            if (typeof v !== "string" || !PARAM_NAME_RE.test(v)) {
              err(pp, "must be a lowercase name like first_name");
            } else if (paramNames.includes(v)) err(pp, `repeats ${JSON.stringify(v)}`);
            else paramNames.push(v);
          });
        }

        const body = str(t, p, "body", { max: 1024 });
        if (body !== undefined) checkBody(body, rawParams, childPath(p, "body"), err);

        let status: TemplateConfig["status"];
        if (t.status !== undefined) {
          if (typeof t.status !== "string" || !(TEMPLATE_STATUSES as readonly string[]).includes(t.status)) {
            err(childPath(p, "status"), `must be one of ${TEMPLATE_STATUSES.join(", ")}`);
          } else status = t.status as TemplateConfig["status"];
        }
        let providerId: string | null | undefined;
        if (t.provider_template_id !== undefined) {
          if (t.provider_template_id === null) providerId = null;
          else if (typeof t.provider_template_id !== "string" || t.provider_template_id.trim() === "") {
            err(childPath(p, "provider_template_id"), "must be a non-empty string or null");
          } else providerId = t.provider_template_id.trim();
        }

        if (errors.length === before && tName && body !== undefined) {
          const tpl: TemplateConfig = {
            name: tName as KnownTemplateName,
            language,
            body,
            param_names: paramNames,
          };
          if (status !== undefined) tpl.status = status;
          if (providerId !== undefined) tpl.provider_template_id = providerId;
          templates.push(tpl);
        }
      });
    }
  }

  if (errors.length) return { ok: false, errors: sortErrors(errors) };
  return {
    ok: true,
    locate,
    config: {
      ...(id ? { id } : {}),
      slug: slug!,
      name: name!,
      timezone,
      is_demo: isDemo,
      is_canary: isCanary,
      owner_alert_phones: ownerPhones,
      whatsapp_fallback_phone: fallback,
      sources,
      templates,
    },
  };
}

/**
 * Placeholders must be {{1}}..{{n}}, each used, for the n param_names; and,
 * as WhatsApp requires, the body may not start or end with a placeholder.
 */
function checkBody(body: string, rawParams: unknown, path: string, err: (p: string, m: string) => void) {
  const used = new Set([...body.matchAll(PLACEHOLDER_RE)].map((m) => Number(m[1])));
  const count = Array.isArray(rawParams) ? rawParams.length : null;
  if (count !== null) {
    const missing = Array.from({ length: count }, (_, k) => k + 1).filter((k) => !used.has(k));
    const extra = [...used].filter((k) => k < 1 || k > count).sort((a, b) => a - b);
    if (extra.length) {
      err(path, `uses ${extra.map((k) => `{{${k}}}`).join(", ")} but param_names has only ${count} name(s)`);
    }
    if (missing.length) err(path, `never uses ${missing.map((k) => `{{${k}}}`).join(", ")} from param_names`);
  }
  if (/^\s*\{\{\s*\d+\s*\}\}/.test(body) || /\{\{\s*\d+\s*\}\}\s*$/.test(body)) {
    err(path, "must not start or end with a placeholder (WhatsApp rejects such templates)");
  }
}

function rejectUnknownKeys(
  obj: Record<string, unknown>,
  path: string,
  allowed: string[],
  err: (p: string, m: string) => void,
) {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) err(childPath(path, k), `unknown field; expected one of ${allowed.join(", ")}`);
  }
}

function parentPath(path: string): string {
  const m = /^(.*)(?:\.[^.[\]]+|\[\d+\])$/.exec(path);
  return m ? m[1] : "";
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function sortErrors(errors: ConfigError[]): ConfigError[] {
  return [...errors].sort((a, b) => a.pos.line - b.pos.line || a.pos.col - b.pos.col);
}
