export type TemplateName = "enquiry_ack" | "followup" | "owner_alert";

export type TemplateMessage = {
  /** E.164 */
  to: string;
  template: TemplateName;
  language: string;
  params: string[];
};

export interface WhatsAppProvider {
  name: string;
  sendTemplate(msg: TemplateMessage): Promise<{ providerMessageId: string }>;
}

export type FakeSend = TemplateMessage & { providerMessageId: string };

/** Records sends in memory and never touches the network. */
export class FakeWhatsAppProvider implements WhatsAppProvider {
  readonly name = "fake";
  readonly sent: FakeSend[] = [];

  sendTemplate(msg: TemplateMessage): Promise<{ providerMessageId: string }> {
    const providerMessageId = `fake-${crypto.randomUUID()}`;
    this.sent.push({ ...msg, params: [...msg.params], providerMessageId });
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
