// deno-lint-ignore no-import-prefix -- test-only std dep; no shared deno.json by design
import { assert, assertEquals } from "jsr:@std/assert@1";
import { corsHeaders, handleOptions, json } from "./http.ts";

Deno.test("json returns the status, a JSON body and CORS headers", async () => {
  const res = json(400, { errors: { phone: "Enter a valid Indian mobile number" } });
  assertEquals(res.status, 400);
  assertEquals(res.headers.get("content-type"), "application/json; charset=utf-8");
  assertEquals(res.headers.get("access-control-allow-origin"), corsHeaders["Access-Control-Allow-Origin"]);
  assertEquals(await res.json(), { errors: { phone: "Enter a valid Indian mobile number" } });
});

Deno.test("handleOptions answers a preflight with CORS headers", () => {
  const res = handleOptions(new Request("http://x/ingest-form", { method: "OPTIONS" }));
  assert(res);
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("access-control-allow-origin"), "*");
  assert(res.headers.get("access-control-allow-headers")?.includes("content-type"));
  assert(res.headers.get("access-control-allow-methods")?.includes("POST"));
});

Deno.test("handleOptions returns null for non-OPTIONS requests", () => {
  assertEquals(handleOptions(new Request("http://x/ingest-form", { method: "POST", body: "{}" })), null);
  assertEquals(handleOptions(new Request("http://x/ingest-form")), null);
});
