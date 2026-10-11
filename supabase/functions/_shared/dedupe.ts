const DAY_MS = 24 * 60 * 60 * 1000;

/** A repeat enquiry from the same phone less than 24 hours after the last one. */
export function isDuplicateEnquiry(lastEnquiryAt: Date | null, now: Date): boolean {
  if (!lastEnquiryAt) return false;
  return now.getTime() - lastEnquiryAt.getTime() < DAY_MS;
}
