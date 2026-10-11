const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * WhatsApp's customer service window: free-form messages are allowed only
 * when the lead messaged us less than 24 hours ago. Outside it, use templates.
 */
export function isInsideServiceWindow(lastInboundAt: Date | null, now: Date): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() < DAY_MS;
}
