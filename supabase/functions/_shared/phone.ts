/**
 * The one place phone numbers are normalised. Accepts Indian mobile numbers
 * written with spaces, dashes or brackets, and an optional leading `0`, `91`,
 * `+91` or `0091`. Returns E.164 (`+91` plus 10 digits starting 6-9) or null.
 */
export function normalizeIndianMobile(input: string): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  // Only digits, separators and a single leading plus are allowed.
  if (!/^\+?[0-9\s()\-]+$/.test(trimmed)) return null;

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  let national: string;
  if (hasPlus) {
    if (digits.length !== 12 || !digits.startsWith("91")) return null;
    national = digits.slice(2);
  } else if (digits.length === 10) {
    national = digits;
  } else if (digits.length === 11 && digits.startsWith("0")) {
    national = digits.slice(1);
  } else if (digits.length === 12 && digits.startsWith("91")) {
    national = digits.slice(2);
  } else if (digits.length === 14 && digits.startsWith("0091")) {
    national = digits.slice(4);
  } else {
    return null;
  }

  return /^[6-9]\d{9}$/.test(national) ? `+91${national}` : null;
}
