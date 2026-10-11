// The canary's pass through the spam check (spec 004, E.2). The hourly canary
// (run-jobs/canary.ts) posts to the real ingest-form URL and can't solve a
// Turnstile challenge, so it sends `canary:<CANARY_SECRET>` as its token
// instead. CANARY_SECRET is a function secret shared by run-jobs and
// ingest-form; it never reaches a browser.

const PREFIX = "canary:";
/** Shorter secrets are ignored, so a weak or placeholder value opens nothing. */
export const CANARY_SECRET_MIN_LENGTH = 24;

export function canaryTurnstileToken(secret: string): string {
  return `${PREFIX}${secret}`;
}

/** True when the token is `canary:<secret>` for a configured, long enough secret. */
export function isCanaryToken(token: string | null, secret: string | undefined): boolean {
  if (!token || !secret || secret.length < CANARY_SECRET_MIN_LENGTH) return false;
  return timingSafeEqual(token, canaryTurnstileToken(secret));
}

/** Compares without an early exit on the first differing byte. */
function timingSafeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
