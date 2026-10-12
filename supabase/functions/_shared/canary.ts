// The canary's pass through the spam check, and what makes a lead a canary
// lead (spec 004, E.2). The hourly canary (run-jobs/canary.ts) posts to the
// real ingest-form URL and can't solve a Turnstile challenge, so it sends
// `canary:<CANARY_SECRET>` as its token instead. CANARY_SECRET is a function
// secret shared by run-jobs and ingest-form; it never reaches a browser.
//
// The pass only works for the canary org's own form and, when CANARY_PHONE is
// set, only for that number. Anywhere else the token counts as a failed spam
// check, so a leaked secret can't be used to message other studios' leads.
import { normalizeIndianMobile } from "./phone.ts";

const PREFIX = "canary:";
/** Shorter secrets are ignored, so a weak or placeholder value opens nothing. */
export const CANARY_SECRET_MIN_LENGTH = 24;

/** The name every canary enquiry uses. Cleanup only touches leads with it. */
export const CANARY_LEAD_NAME = "Flow Canary";

/** Made-up canary numbers: +91 6000 plus six digits. */
export const SYNTHETIC_CANARY_PHONE_RE = /^\+916000\d{6}$/;

export function canaryTurnstileToken(secret: string): string {
  return `${PREFIX}${secret}`;
}

/** True when the token is `canary:<secret>` for a configured, long enough secret. */
export function isCanaryToken(token: string | null, secret: string | undefined): boolean {
  if (!token || !secret || secret.length < CANARY_SECRET_MIN_LENGTH) return false;
  return timingSafeEqual(token, canaryTurnstileToken(secret));
}

/** ingest-form's view of the canary settings (function secrets). */
export type CanaryPassConfig = { secret?: string; phone?: string };

export type CanaryVerdict =
  /** Not a canary token: run the normal Turnstile check. */
  | { kind: "not_canary" }
  | { kind: "allowed" }
  /** A valid canary token used where the canary may not post: fail the spam check. */
  | { kind: "refused"; reason: string };

/**
 * Decides what a token means for an enquiry to this source from this phone
 * (E.164). `source` is null when the source key is unknown.
 */
export function canaryVerdict(
  cfg: CanaryPassConfig | undefined,
  token: string | null,
  source: { org: { is_canary: boolean } } | null,
  phone: string,
): CanaryVerdict {
  if (!isCanaryToken(token, cfg?.secret)) return { kind: "not_canary" };
  if (!source?.org.is_canary) return { kind: "refused", reason: "canary token for a source outside the canary org" };
  if (cfg?.phone) {
    const expected = normalizeIndianMobile(cfg.phone);
    if (!expected || expected !== phone) {
      return { kind: "refused", reason: "canary token from a number other than CANARY_PHONE" };
    }
  }
  return { kind: "allowed" };
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
