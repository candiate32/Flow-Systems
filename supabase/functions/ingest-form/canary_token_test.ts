// The canary's pass through the spam check (spec 004, E.2).
// deno-lint-ignore no-import-prefix -- test-only std dep; no shared deno.json by design
import { assertEquals } from "jsr:@std/assert@1";
import { CANARY_SECRET_MIN_LENGTH, canaryTurnstileToken, isCanaryToken } from "../_shared/canary.ts";
import { makeVerifyTurnstile } from "./index.ts";

const SECRET = "c".repeat(CANARY_SECRET_MIN_LENGTH);

const turnstileMustNotBeCalled = () => {
  throw new Error("Turnstile should not be called");
};

Deno.test("canary token: only canary:<CANARY_SECRET> matches", () => {
  assertEquals(isCanaryToken(canaryTurnstileToken(SECRET), SECRET), true);
  assertEquals(isCanaryToken(`canary:${SECRET}x`, SECRET), false);
  assertEquals(isCanaryToken(SECRET, SECRET), false);
  assertEquals(isCanaryToken("canary:", SECRET), false);
  assertEquals(isCanaryToken(null, SECRET), false);
  assertEquals(isCanaryToken(canaryTurnstileToken(SECRET), undefined), false);
  assertEquals(isCanaryToken("canary:", ""), false);
});

Deno.test("canary token: a secret shorter than the minimum opens nothing", () => {
  const short = "s".repeat(CANARY_SECRET_MIN_LENGTH - 1);
  assertEquals(isCanaryToken(canaryTurnstileToken(short), short), false);
});

Deno.test("ingest-form: the canary token passes the spam check without calling Turnstile", async () => {
  const env = (k: string) =>
    ({ TURNSTILE_SECRET: "turnstile-secret", CANARY_SECRET: SECRET } as Record<string, string>)[k];
  const verify = makeVerifyTurnstile(env, turnstileMustNotBeCalled);
  assertEquals(await verify(canaryTurnstileToken(SECRET)), true);
});

Deno.test("ingest-form: a wrong canary token still goes to Turnstile", async () => {
  const env = (k: string) =>
    ({ TURNSTILE_SECRET: "turnstile-secret", CANARY_SECRET: SECRET } as Record<string, string>)[k];
  let calls = 0;
  const verify = makeVerifyTurnstile(env, () => {
    calls++;
    return Promise.resolve(new Response(JSON.stringify({ success: false })));
  });
  assertEquals(await verify("canary:guess"), false);
  assertEquals(calls, 1);
});

Deno.test("ingest-form: without CANARY_SECRET a canary-looking token gets no pass", async () => {
  const env = (k: string) => ({ TURNSTILE_SECRET: "turnstile-secret" } as Record<string, string>)[k];
  const verify = makeVerifyTurnstile(env, () => Promise.resolve(new Response(JSON.stringify({ success: false }))));
  assertEquals(await verify("canary:"), false);
});
