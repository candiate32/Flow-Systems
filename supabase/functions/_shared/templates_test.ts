// deno-lint-ignore no-import-prefix -- test-only std dep; no shared deno.json by design
import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import { FOLLOW_UP_TEMPLATES, followUpTemplate, renderTemplate, TEMPLATE_TEXTS } from "./templates.ts";
import { TEMPLATE_NAMES } from "./whatsapp.ts";

Deno.test("followUpTemplate maps 1..3 to followup_1..3", () => {
  assertEquals([1, 2, 3].map((n) => followUpTemplate(n as 1 | 2 | 3)), ["followup_1", "followup_2", "followup_3"]);
});

Deno.test("every follow-up template is one the provider interface knows", () => {
  for (const name of FOLLOW_UP_TEMPLATES) assert((TEMPLATE_NAMES as readonly string[]).includes(name), name);
});

Deno.test("each body uses exactly the placeholders {{1}}..{{n}} for its n params", () => {
  for (const [name, t] of Object.entries(TEMPLATE_TEXTS)) {
    const used = [...new Set([...t.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1])))].sort();
    assertEquals(used, t.params.map((_, i) => i + 1), name);
    assert(t.body.includes("STOP"), `${name} tells people how to opt out`);
  }
});

Deno.test("renderTemplate fills placeholders in order", () => {
  const text = renderTemplate("followup_1", ["Asha", "Demo Interiors"]);
  assert(text.startsWith("Hi Asha, this is Demo Interiors following up"), text);
  assert(!text.includes("{{"), text);
});

Deno.test("renderTemplate refuses the wrong number of params", () => {
  assertThrows(() => renderTemplate("followup_2", ["Asha"]), RangeError);
  assertThrows(() => renderTemplate("followup_2", ["Asha", "Demo", "extra"]), RangeError);
});

Deno.test("renderTemplate does not expand placeholders inside params", () => {
  assertEquals(
    renderTemplate("followup_3", ["{{2}}", "Studio"]).startsWith("Hi {{2}}, a last note from Studio"),
    true,
  );
});
