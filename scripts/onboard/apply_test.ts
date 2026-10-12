// onboard-org against the local database. Skipped without SUPABASE_SERVICE_ROLE_KEY,
// like the other database tests.
// deno-lint-ignore no-import-prefix -- test-only std dep; no shared deno.json by design
import { assert, assertEquals } from "jsr:@std/assert@1";
// deno-lint-ignore no-import-prefix -- scripts share the functions' full specifiers
import { createClient } from "npm:@supabase/supabase-js@2";
import type { Database } from "../../supabase/functions/_shared/database.types.ts";
import { main } from "../onboard-org.ts";
import { planOnboarding } from "./apply.ts";
import { formatError, parseOrgConfig } from "./config.ts";

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const NO_DB = !SERVICE_KEY;
const DEMO_ORG = "00000000-0000-4000-8000-000000000001";
const SAMPLE = new URL("../../onboarding/demo-interiors.json", import.meta.url).pathname;

const db = NO_DB ? null! : createClient<Database>(SUPABASE_URL, SERVICE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const env = (k: string) => ({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY })[k];

const dbTest = (name: string, fn: () => Promise<void>) =>
  Deno.test({ name, ignore: NO_DB, sanitizeOps: false, sanitizeResources: false, fn });

/** Runs the command quietly and returns its exit code and output. */
async function run(args: string[]): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const [log, error] = [console.log, console.error];
  console.log = (...a: unknown[]) => out.push(a.join(" "));
  console.error = (...a: unknown[]) => err.push(a.join(" "));
  try {
    return { code: await main(args, env), out, err };
  } finally {
    [console.log, console.error] = [log, error];
  }
}

async function writeConfig(cfg: unknown): Promise<string> {
  const path = await Deno.makeTempFile({ suffix: ".json" });
  await Deno.writeTextFile(path, JSON.stringify(cfg, null, 2));
  return path;
}

async function snapshot(slug: string) {
  const { data: org } = await db.from("orgs").select("*").eq("slug", slug).single();
  const { data: sources } = await db.from("sources").select("*").eq("org_id", org!.id).order("public_key");
  const { data: templates } = await db.from("templates").select("*").eq("org_id", org!.id).order("name");
  const { data: audit } = await db.from("audit_log").select("*").eq("org_id", org!.id).order("id");
  return { org, sources, templates, audit };
}

function studio(slug: string, overrides: Record<string, unknown> = {}) {
  return {
    slug,
    name: "Onboard Test Studio",
    owner_alert_phones: ["98450 11111", "+91 98450-22222"],
    whatsapp_fallback_phone: "098450 11111",
    sources: [
      { kind: "web_form", name: "Website form", public_key: `${slug}-web` },
      { kind: "whatsapp_inbound", name: "WhatsApp", public_key: `${slug}-wa` },
    ],
    templates: [
      { name: "enquiry_ack", body: "Hi {{1}}, thanks for contacting {{2}}.", param_names: ["first_name", "studio"] },
      { name: "owner_alert", body: "New lead {{1}} ({{2}}), call back.", param_names: ["name", "phone"] },
    ],
    ...overrides,
  };
}

const slugOf = () => `onboard-test-${crypto.randomUUID().slice(0, 8)}`;

dbTest("onboard-org: creates the org, sources, templates and owner contacts, with an audit row each", async () => {
  const slug = slugOf();
  const file = await writeConfig(studio(slug));
  try {
    const r = await run([file]);
    assertEquals(r.code, 0, r.err.join("\n"));
    const s = await snapshot(slug);
    assertEquals(s.org!.name, "Onboard Test Studio");
    assertEquals(s.org!.owner_alert_phones, ["+919845011111", "+919845022222"]);
    assertEquals(s.org!.whatsapp_fallback_phone, "+919845011111");
    assertEquals(s.org!.timezone, "Asia/Kolkata");
    assertEquals(s.org!.is_canary, false);
    assertEquals(s.sources!.map((x) => [x.public_key, x.kind]), [[`${slug}-wa`, "whatsapp_inbound"], [
      `${slug}-web`,
      "web_form",
    ]]);
    assertEquals(s.templates!.map((t) => [t.name, t.language, t.status, t.category, t.param_names]), [
      ["enquiry_ack", "en", "draft", "utility", ["first_name", "studio"]],
      ["owner_alert", "en", "draft", "utility", ["name", "phone"]],
    ]);
    assertEquals(s.audit!.map((a) => [a.actor, a.action, a.target]), [
      ["system", "org.created", `org:${slug}`],
      ["system", "source.created", `source:${slug}-web`],
      ["system", "source.created", `source:${slug}-wa`],
      ["system", "template.created", "template:enquiry_ack/en"],
      ["system", "template.created", "template:owner_alert/en"],
    ]);
  } finally {
    await db.from("orgs").delete().eq("slug", slug);
    await Deno.remove(file);
  }
});

dbTest("onboard-org: running the same config twice gives the same rows and no new audit rows", async () => {
  const slug = slugOf();
  const file = await writeConfig(studio(slug));
  try {
    assertEquals((await run([file])).code, 0);
    const first = await snapshot(slug);
    const again = await run([file]);
    assertEquals(again.code, 0);
    assertEquals(again.out, [`${slug} (${first.org!.id}) is up to date. Nothing to change.`]);
    assertEquals(await snapshot(slug), first);
  } finally {
    await db.from("orgs").delete().eq("slug", slug);
    await Deno.remove(file);
  }
});

dbTest(
  "onboard-org: a changed config updates only what changed, audits the change, keeps provider-set template status",
  async () => {
    const slug = slugOf();
    const file = await writeConfig(studio(slug));
    try {
      assertEquals((await run([file])).code, 0);
      const before = await snapshot(slug);
      // The provider approved enquiry_ack since onboarding.
      await db.from("templates").update({ status: "approved", provider_template_id: "tpl-1" })
        .eq("org_id", before.org!.id).eq("name", "enquiry_ack");

      const changed = studio(slug, { name: "Onboard Test Studio, HSR Layout", owner_alert_phones: ["98450 11111"] });
      (changed.templates[1] as { body: string }).body = "New lead {{1}} ({{2}}). Call back within the hour.";
      await Deno.writeTextFile(file, JSON.stringify(changed, null, 2));

      const dry = await run(["--dry-run", file]);
      assertEquals(dry.code, 0);
      assertEquals(dry.out.at(-1), "Dry run: 2 change(s) not written.");
      assertEquals((await snapshot(slug)).org, before.org, "dry run wrote nothing");

      assertEquals((await run([file])).code, 0);
      const after = await snapshot(slug);
      assertEquals(after.org!.name, "Onboard Test Studio, HSR Layout");
      assertEquals(after.org!.owner_alert_phones, ["+919845011111"]);
      assertEquals(after.sources, before.sources, "sources unchanged");
      const ack = after.templates!.find((t) => t.name === "enquiry_ack")!;
      assertEquals([ack.status, ack.provider_template_id], ["approved", "tpl-1"]);
      assertEquals(after.templates!.find((t) => t.name === "owner_alert")!.body, changed.templates[1].body);

      const added = after.audit!.slice(before.audit!.length);
      assertEquals(added.map((a) => [a.action, a.target]), [
        ["org.updated", `org:${slug}`],
        ["template.updated", "template:owner_alert/en"],
      ]);
      assertEquals(added[0].details, {
        via: "onboard-org",
        changes: {
          name: { from: "Onboard Test Studio", to: "Onboard Test Studio, HSR Layout" },
          owner_alert_phones: { from: ["+919845011111", "+919845022222"], to: ["+919845011111"] },
        },
      });
    } finally {
      await db.from("orgs").delete().eq("slug", slug);
      await Deno.remove(file);
    }
  },
);

dbTest("onboard-org: refuses a slug or public key that belongs to another org, and a second canary", async () => {
  const slug = slugOf();
  const other = slugOf();
  const plan = async (cfg: unknown) => {
    const parsed = parseOrgConfig(JSON.stringify(cfg, null, 2));
    if (!parsed.ok) throw new Error("config should be valid");
    const r = await planOnboarding(db, parsed.config, parsed.locate);
    return r.ok ? [] : r.errors.map((e) => formatError("c.json", e));
  };
  try {
    // Slug of the demo org, but a different fixed id.
    assertEquals(await plan(studio("demo-interiors", { id: "11111111-1111-4111-8111-111111111111" })), [
      `c.json:2:11: slug: is already used by another org (${
        (await db.from("orgs").select("name").eq("id", DEMO_ORG).single()).data!.name
      }, ${DEMO_ORG})`,
    ]);

    // The demo org's form key.
    const stolen = studio(slug, {
      sources: [{ kind: "web_form", name: "Form", public_key: "demo-web-form" }],
    });
    assertEquals(await plan(stolen), [
      'c.json:13:21: sources[0].public_key: "demo-web-form" already belongs to another org\'s source',
    ]);

    // A second canary.
    const { data: canaries } = await db.from("orgs").select("id").eq("is_canary", true);
    if (canaries?.length) {
      console.warn("skipping the canary check: this database already has a canary org");
      return;
    }
    const first = await writeConfig(studio(other, { is_canary: true }));
    assertEquals((await run([first])).code, 0);
    await Deno.remove(first);
    const errs = await plan(studio(slug, { is_canary: true }));
    assertEquals(errs.length, 1);
    assert(errs[0].endsWith(`is_canary: org ${other} is already the canary; there can be only one`), errs[0]);
    // Marking it the canary queued its first canary job.
    const { data: org } = await db.from("orgs").select("id").eq("slug", other).single();
    const { data: jobs } = await db.from("jobs").select("kind").eq("org_id", org!.id);
    assertEquals(jobs, [{ kind: "canary" }]);
  } finally {
    await db.from("orgs").delete().in("slug", [slug, other]);
  }
});

dbTest("onboard-org: refuses to make an org with real leads the canary", async () => {
  const slug = slugOf();
  const file = await writeConfig(studio(slug));
  try {
    assertEquals((await run([file])).code, 0);
    const { data: org } = await db.from("orgs").select("id").eq("slug", slug).single();
    await db.from("leads").insert({
      org_id: org!.id,
      name: "Asha Rao",
      phone_e164: "+919845012345",
      consent_at: new Date().toISOString(),
    });
    await Deno.writeTextFile(file, JSON.stringify(studio(slug, { is_canary: true }), null, 2));
    const r = await run([file]);
    assertEquals(r.code, 1);
    assert(
      r.err[0].endsWith("is_canary: this org has 1 lead(s), so it can't be the canary; use an org of its own"),
      r.err[0],
    );
    const { data: after } = await db.from("orgs").select("is_canary").eq("id", org!.id).single();
    assertEquals(after!.is_canary, false);
  } finally {
    await db.from("orgs").delete().eq("slug", slug);
    await Deno.remove(file);
  }
});

dbTest("onboard-org: the sample config matches the seeded demo org; only its templates are new", async () => {
  const parsed = parseOrgConfig(await Deno.readTextFile(SAMPLE));
  if (!parsed.ok) throw new Error("sample should be valid");
  const r = await planOnboarding(db, parsed.config, parsed.locate);
  if (!r.ok) throw new Error(r.errors.map((e) => formatError("sample", e)).join("\n"));
  assertEquals(r.plan.orgId, DEMO_ORG);
  const nonTemplate = r.plan.changes.filter((c) => c.table !== "templates");
  assertEquals(nonTemplate, [], "org and source already match the seed");
});

Deno.test("onboard-org: an invalid config writes nothing and names the line", async () => {
  const file = await writeConfig({ slug: "Bad Slug", name: "X", sources: [] });
  try {
    const r = await run([file]);
    assertEquals(r.code, 1);
    assertEquals(r.err, [
      `${file}:2:11: slug: must be 3-48 lowercase letters, digits and single hyphens, e.g. lime-and-lattice`,
      `${file}:4:14: sources: list at least the studio's web form`,
      `2 problem(s) in ${file}; nothing was written.`,
    ]);
  } finally {
    await Deno.remove(file);
  }
});

Deno.test("onboard-org: usage error without exactly one config file", async () => {
  assertEquals((await run([])).code, 2);
  assertEquals((await run(["a.json", "b.json"])).code, 2);
});
