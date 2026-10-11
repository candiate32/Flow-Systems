/** IST is UTC+05:30 all year (no DST). */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const FOLLOW_UP_DAYS = [1, 3, 7] as const;
const SEND_HOUR_IST = 11;

/**
 * Follow-up times for an enquiry: 11:00 IST on day 1, 3 and 7 after the
 * enquiry's IST calendar date. Returned as UTC instants.
 */
export function followUpTimes(enquiryAt: Date): Date[] {
  // Shift into IST, then read the calendar date with UTC getters.
  const ist = new Date(enquiryAt.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  return FOLLOW_UP_DAYS.map((n) => new Date(Date.UTC(y, m, d + n, SEND_HOUR_IST) - IST_OFFSET_MS));
}
