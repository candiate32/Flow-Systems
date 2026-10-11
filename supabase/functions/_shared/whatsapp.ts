/** Templates the engine sends. `ops_alert` goes to Flow Systems ops, not to a studio's leads. */
export const TEMPLATE_NAMES = [
  "enquiry_ack",
  "followup_1",
  "followup_2",
  "followup_3",
  "owner_alert",
  "ops_alert",
] as const;
export type TemplateName = typeof TEMPLATE_NAMES[number];

export type TemplateMessage = {
  /** E.164 */
  to: string;
  template: TemplateName;
  language: string;
  params: string[];
};

/**
 * A free-form text message. Only allowed inside the lead's 24-hour customer
 * service window (see window.ts); outside it, send a template.
 */
export type SessionMessage = {
  /** E.164 */
  to: string;
  text: string;
};

export interface WhatsAppProvider {
  name: string;
  sendTemplate(msg: TemplateMessage): Promise<{ providerMessageId: string }>;
  sendSession(msg: SessionMessage): Promise<{ providerMessageId: string }>;
}

export type FakeSend = TemplateMessage & { providerMessageId: string };
export type FakeSessionSend = SessionMessage & { providerMessageId: string };

/** Records sends in memory and never touches the network. */
export class FakeWhatsAppProvider implements WhatsAppProvider {
  readonly name = "fake";
  /** Template sends, in order. */
  readonly sent: FakeSend[] = [];
  /** Session (free-form) sends, in order. */
  readonly sessions: FakeSessionSend[] = [];

  sendTemplate(msg: TemplateMessage): Promise<{ providerMessageId: string }> {
    const providerMessageId = `fake-${crypto.randomUUID()}`;
    this.sent.push({ ...msg, params: [...msg.params], providerMessageId });
    return Promise.resolve({ providerMessageId });
  }

  sendSession(msg: SessionMessage): Promise<{ providerMessageId: string }> {
    const providerMessageId = `fake-${crypto.randomUUID()}`;
    this.sessions.push({ to: msg.to, text: msg.text, providerMessageId });
    return Promise.resolve({ providerMessageId });
  }
}

/**
 * Picks the provider named by WHATSAPP_PROVIDER. Unset or "fake" gives the
 * fake. Real adapters are added here after the Phase 0 spike.
 */
export function getWhatsAppProvider(env: (k: string) => string | undefined): WhatsAppProvider {
  const name = env("WHATSAPP_PROVIDER");
  if (!name || name === "fake") return new FakeWhatsAppProvider();
  throw new Error(`Unknown WHATSAPP_PROVIDER: ${JSON.stringify(name)}`);
}
