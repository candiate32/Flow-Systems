// Ops alerts: the `ops_alert` WhatsApp template to OPS_ALERT_PHONE (spec 004,
// "Defaults picked"). Shared by run-jobs (dead jobs) and ingest-form (follow-ups
// that could not be scheduled). The caller records the returned event.
import type { Json } from "./database.types.ts";
import { errorMessage } from "./db.ts";
import { normalizeIndianMobile } from "./phone.ts";
import type { WhatsAppProvider } from "./whatsapp.ts";

export type OpsAlertEvent =
  | { type: "ops_alert_sent"; payload: { provider_message_id: string } }
  | { type: "ops_alert_skipped"; payload: { reason: string } }
  | { type: "ops_alert_failed"; payload: { error: string } };

/**
 * Sends `ops_alert` with the given params (see opsAlertParams in jobs.ts).
 * Never throws: the provider being down is often the reason for the alert.
 * Returns the event to record: sent, skipped (OPS_ALERT_PHONE unset or not a
 * mobile number) or failed.
 */
export async function sendOpsAlert(
  provider: WhatsAppProvider,
  env: (k: string) => string | undefined,
  params: string[],
): Promise<OpsAlertEvent & { payload: Record<string, Json> }> {
  const raw = env("OPS_ALERT_PHONE");
  const to = raw ? normalizeIndianMobile(raw) : null;
  if (!to) {
    return {
      type: "ops_alert_skipped",
      payload: { reason: raw ? "OPS_ALERT_PHONE is not a valid mobile number" : "OPS_ALERT_PHONE is not set" },
    };
  }
  try {
    const { providerMessageId } = await provider.sendTemplate({ to, template: "ops_alert", language: "en", params });
    return { type: "ops_alert_sent", payload: { provider_message_id: providerMessageId } };
  } catch (err) {
    return { type: "ops_alert_failed", payload: { error: errorMessage(err) } };
  }
}
