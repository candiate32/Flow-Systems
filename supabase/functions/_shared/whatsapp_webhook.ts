// The receiving side of the WhatsApp provider (spec 004, C.1): checking that a
// webhook really came from the provider, and turning its payload into a list
// of provider-neutral events for the `whatsapp-webhook` function.
//
// Sending lives in whatsapp.ts. Real providers (Gupshup / 360dialog) are slice
// F; until then the fake adapter below is what tests, scripts and local runs
// use.
//
// How Meta's Cloud API payload maps onto NormalizedEvent (360dialog forwards
// this format as is; Gupshup's v2 "meta" format is the same inside its own
// envelope). A delivery is
//   { object: "whatsapp_business_account",
//     entry: [{ id, changes: [{ field, value }] }] }
// and each change's `value` becomes zero or more events:
//
// - field "messages", value.messages[i] (a message from a customer):
//     kind "inbound"
//     providerEventId   "inbound:" + message.id   (wamid; unique per message)
//     providerMessageId message.id
//     phone             normalizeIndianMobile(message.from)   ("9198…" -> "+9198…")
//     text              message.text.body (type "text"), message.button.text,
//                       message.interactive.*_reply.title; null for media
//     at                new Date(Number(message.timestamp) * 1000)   (unix seconds)
//     profileName       value.contacts.find(c => c.wa_id === message.from)?.profile.name
// - field "messages", value.statuses[i] (a receipt for a message we sent):
//     kind "status"
//     providerEventId   "status:" + status.id + ":" + status.status
//                       (one message gets one event per status, so the id alone
//                       is not unique; Meta repeats the same pair on retry)
//     providerMessageId status.id
//     status            status.status ("sent" | "delivered" | "read" | "failed")
//     error             status.errors?.[0] as "code title: details"
//     phone             normalizeIndianMobile(status.recipient_id)
//     at                status.timestamp (unix seconds)
// - field "smb_message_echoes", value.message_echoes[i] (a message staff typed
//   in the WhatsApp Business app on a coexistence number):
//     kind "echo"
//     providerEventId   "echo:" + echo.id
//     providerMessageId echo.id
//     phone             normalizeIndianMobile(echo.to)   (the customer; `from` is us)
//     text, at          as for inbound
// - anything else (account_update, template status, …) yields no events.
//
// Routing to an org is not the adapter's job: each org's webhook URL carries
// `?source=<public_key>` of its `whatsapp_inbound` source (see
// whatsapp-webhook/index.ts). A Meta app that serves several numbers through
// one URL can route on value.metadata.phone_number_id instead, in slice F.
import { normalizeIndianMobile } from "./phone.ts";

export const DELIVERY_STATUSES = ["sent", "delivered", "read", "failed"] as const;
export type DeliveryStatus = typeof DELIVERY_STATUSES[number];

type EventBase = {
  /** The provider's id for this event; with the provider name, unique across all deliveries. */
  providerEventId: string;
  /** The customer's phone in E.164 (+91…), or null when it is not an Indian mobile. */
  phone: string | null;
  /** Message text; null for media, statuses and anything without text. */
  text: string | null;
  /** When the provider says it happened. */
  at: Date;
  /** The WhatsApp message id the event is about (the inbound/echo message, or the one a status is for). */
  providerMessageId: string;
  /** The provider's own JSON for this event, stored as is in webhook_events.payload. */
  raw: unknown;
};

/** A customer wrote to the business. */
export type InboundEvent = EventBase & { kind: "inbound"; profileName: string | null };
/** Staff replied from the WhatsApp Business app (coexistence echo). */
export type EchoEvent = EventBase & { kind: "echo" };
/** A delivery receipt for a message we sent. */
export type StatusEvent = EventBase & { kind: "status"; status: DeliveryStatus; error: string | null };

export type NormalizedEvent = InboundEvent | EchoEvent | StatusEvent;

export interface WhatsAppWebhookAdapter {
  /** Same as the sending provider's name: webhook_events.provider and messages.provider. */
  readonly name: string;
  /**
   * True when the request carries a valid signature for its body. Reads a
   * clone of the request, so the caller can still read the body. Never
   * throws; any doubt (no secret configured, no header, bad encoding) is false.
   */
  verifyWebhook(req: Request): Promise<boolean>;
  /**
   * The events in a verified payload, in the provider's order. Throws a
   * WebhookParseError when the payload is not in the provider's format.
   */
  parseWebhook(body: unknown): NormalizedEvent[];
}

export class WebhookParseError extends Error {
  override name = "WebhookParseError";
}

// --- Fake adapter -------------------------------------------------------------

export const FAKE_SIGNATURE_HEADER = "x-fake-signature";

/**
 * The fake provider's webhook. A delivery is
 *
 *   { "events": [
 *       { "id": "evt-1", "kind": "inbound", "phone": "+919845012345", "text": "Hi",
 *         "at": "2026-10-11T10:00:00Z", "message_id": "fake-in-1", "profile_name": "Asha" },
 *       { "id": "evt-2", "kind": "echo", "phone": "+919845012345", "text": "Hello!",
 *         "at": "...", "message_id": "fake-echo-1" },
 *       { "id": "evt-3", "kind": "status", "message_id": "fake-…", "status": "failed",
 *         "error": "131047 Re-engagement message", "at": "...", "phone": "+91…" } ] }
 *
 * signed with HMAC-SHA256 over the raw body, keyed by WHATSAPP_WEBHOOK_SECRET,
 * hex-encoded in the `x-fake-signature` header (an optional "sha256=" prefix,
 * as Meta writes it, is accepted).
 */
export class FakeWebhookAdapter implements WhatsAppWebhookAdapter {
  readonly name = "fake";

  constructor(private readonly secret: string | undefined) {}

  async verifyWebhook(req: Request): Promise<boolean> {
    if (!this.secret) return false;
    const header = req.headers.get(FAKE_SIGNATURE_HEADER);
    if (!header) return false;
    const signature = hexToBytes(header.trim().replace(/^sha256=/i, ""));
    if (!signature || signature.length !== 32) return false;
    try {
      const body = new Uint8Array(await req.clone().arrayBuffer());
      // crypto.subtle.verify compares the MAC in constant time.
      return await crypto.subtle.verify("HMAC", await hmacKey(this.secret), signature, body);
    } catch {
      return false;
    }
  }

  parseWebhook(body: unknown): NormalizedEvent[] {
    if (!isObject(body) || !Array.isArray(body.events)) {
      throw new WebhookParseError("expected { events: [...] }");
    }
    return body.events.map((raw, i) => parseFakeEvent(raw, i));
  }
}

function parseFakeEvent(raw: unknown, i: number): NormalizedEvent {
  const bad = (why: string) => new WebhookParseError(`events[${i}]: ${why}`);
  if (!isObject(raw)) throw bad("not an object");
  const id = nonEmptyString(raw.id);
  if (!id) throw bad("id must be a non-empty string");
  const messageId = nonEmptyString(raw.message_id);
  if (!messageId) throw bad("message_id must be a non-empty string");
  const at = typeof raw.at === "string" ? new Date(raw.at) : null;
  if (!at || Number.isNaN(at.getTime())) throw bad("at must be an ISO timestamp");
  if (raw.text !== undefined && raw.text !== null && typeof raw.text !== "string") throw bad("text must be a string");
  const text = typeof raw.text === "string" ? raw.text : null;
  const phone = typeof raw.phone === "string" ? normalizeIndianMobile(raw.phone) : null;
  const base = { providerEventId: id, phone, text, at, providerMessageId: messageId, raw };

  switch (raw.kind) {
    case "inbound":
      return { ...base, kind: "inbound", profileName: nonEmptyString(raw.profile_name) };
    case "echo":
      return { ...base, kind: "echo" };
    case "status": {
      if (!(DELIVERY_STATUSES as readonly unknown[]).includes(raw.status)) {
        throw bad(`status must be one of ${DELIVERY_STATUSES.join(", ")}`);
      }
      const status = raw.status as DeliveryStatus;
      const error = status === "failed" ? (nonEmptyString(raw.error) ?? "failed without an error") : null;
      return { ...base, kind: "status", text: null, status, error };
    }
    default:
      throw bad("kind must be inbound, echo or status");
  }
}

/**
 * Signs a fake webhook body the way the fake provider would: lowercase hex
 * HMAC-SHA256. For tests and scripts/e2e-webhook.sh's Deno equivalent.
 */
export async function signFakeWebhook(body: string, secret: string): Promise<string> {
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(body));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Picks the webhook adapter for WHATSAPP_PROVIDER, the same switch as
 * getWhatsAppProvider: unset or "fake" gives the fake, keyed by
 * WHATSAPP_WEBHOOK_SECRET. Real adapters are added in slice F.
 */
export function getWebhookAdapter(env: (k: string) => string | undefined): WhatsAppWebhookAdapter {
  const name = env("WHATSAPP_PROVIDER");
  if (!name || name === "fake") return new FakeWebhookAdapter(env("WHATSAPP_WEBHOOK_SECRET"));
  throw new Error(`Unknown WHATSAPP_PROVIDER: ${JSON.stringify(name)}`);
}

// --- Helpers ------------------------------------------------------------------

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function nonEmptyString(x: unknown): string | null {
  return typeof x === "string" && x.trim() !== "" ? x.trim() : null;
}
