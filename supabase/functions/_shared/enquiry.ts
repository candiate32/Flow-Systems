import { normalizeIndianMobile } from "./phone.ts";

export const BHK_OPTIONS = ["1BHK", "2BHK", "3BHK", "4BHK+", "Villa", "Office"] as const;
export type Bhk = (typeof BHK_OPTIONS)[number];

export type Enquiry = {
  sourceKey: string;
  name: string;
  /** E.164, e.g. +919845012345 */
  phone: string;
  bhk: string | null;
  /** YYYY-MM */
  possessionMonth: string | null;
  consent: true;
  turnstileToken: string | null;
};

export type ParseEnquiryResult =
  | { ok: true; value: Enquiry }
  | { ok: false; errors: Record<string, string> };

const NAME_MAX = 80;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Missing, null or blank strings count as "not given" for optional fields. */
function optionalString(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return undefined; // wrong type
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * Validates the JSON body posted by the enquiry form. Errors are keyed by the
 * JSON field name so the form can show them next to the right input.
 */
export function parseEnquiry(body: unknown): ParseEnquiryResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, errors: { body: "Expected a JSON object" } };
  }
  const b = body as Record<string, unknown>;
  const errors: Record<string, string> = {};

  const sourceKey = typeof b.source_key === "string" ? b.source_key.trim() : "";
  if (!sourceKey) errors.source_key = "Missing source key";

  const name = typeof b.name === "string" ? b.name.trim() : "";
  const nameLength = [...name].length;
  if (nameLength === 0) errors.name = "Please enter your name";
  else if (nameLength > NAME_MAX) errors.name = `Name must be at most ${NAME_MAX} characters`;

  const phone = typeof b.phone === "string" ? normalizeIndianMobile(b.phone) : null;
  if (!phone) errors.phone = "Enter a valid Indian mobile number";

  const bhk = optionalString(b.bhk);
  if (bhk === undefined || (bhk !== null && !(BHK_OPTIONS as readonly string[]).includes(bhk))) {
    errors.bhk = `BHK must be one of ${BHK_OPTIONS.join(", ")}`;
  }

  const possessionMonth = optionalString(b.possession_month);
  if (possessionMonth === undefined || (possessionMonth !== null && !MONTH_RE.test(possessionMonth))) {
    errors.possession_month = "Possession month must look like YYYY-MM";
  }

  if (b.consent !== true) errors.consent = "Please agree to be contacted on WhatsApp";

  const turnstileToken = optionalString(b.turnstile_token);
  if (turnstileToken === undefined) errors.turnstile_token = "Invalid spam-check token";

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      sourceKey,
      name,
      phone: phone!,
      bhk: bhk ?? null,
      possessionMonth: possessionMonth ?? null,
      consent: true,
      turnstileToken: turnstileToken ?? null,
    },
  };
}
