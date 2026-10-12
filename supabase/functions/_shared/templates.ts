// Texts of the WhatsApp templates the engine sends as free-form session
// messages too. The same body is what gets submitted to the provider for
// approval, so a session message inside the 24-hour window reads exactly like
// the template would outside it (spec 004, B.2).
//
// Bodies use the provider's {{1}}, {{2}}… placeholders; `params` names them in
// order and is what onboarding writes to templates.param_names.

export type TemplateText = {
  body: string;
  params: readonly string[];
};

export const FOLLOW_UP_TEMPLATES = [
  "followup_1",
  "followup_2",
  "followup_3",
] as const;
export type FollowUpTemplate = typeof FOLLOW_UP_TEMPLATES[number];

/** Follow-up n (1, 2 or 3) is sent as template `followup_<n>`. */
export function followUpTemplate(n: 1 | 2 | 3): FollowUpTemplate {
  return FOLLOW_UP_TEMPLATES[n - 1];
}

export const TEMPLATE_TEXTS: Record<FollowUpTemplate, TemplateText> = {
  followup_1: {
    body: "Hi {{1}}, this is {{2}} following up on your interiors enquiry. " +
      "Would you like a free consultation with our designer? " +
      "Reply with a day and time that suits you. Reply STOP to opt out.",
    params: ["first_name", "studio_name"],
  },
  followup_2: {
    body:
      "Hi {{1}}, {{2}} here. We'd still love to help with your home interiors. " +
      "Reply with a convenient time and our designer will call you. Reply STOP to opt out.",
    params: ["first_name", "studio_name"],
  },
  followup_3: {
    body: "Hi {{1}}, a last note from {{2}} about your interiors enquiry. " +
      "If you'd still like a free consultation, just reply to this message. " +
      "We won't follow up again. Reply STOP to opt out.",
    params: ["first_name", "studio_name"],
  },
};

/**
 * Fills a template's placeholders. Throws if the number of params is not the
 * number the template takes, so a session message never goes out with a
 * literal "{{2}}" in it.
 */
export function renderTemplate(
  name: FollowUpTemplate,
  params: readonly string[],
): string {
  return fillText(name, TEMPLATE_TEXTS[name], params);
}

/**
 * The reply to someone who messages a studio's WhatsApp number for the first
 * time (spec 004, C.4). Session-only: it is only ever sent inside the 24-hour
 * window the person just opened, so it is not submitted as a template. If the
 * send fails, the retry job sends the `enquiry_ack` template instead, which
 * takes the same params.
 */
export const INBOUND_ACK_TEXT: TemplateText = {
  body:
    "Hi {{1}}, thanks for messaging {{2}}. Our designer will reply to you here shortly. " +
    "Reply STOP to opt out.",
  params: ["first_name", "studio_name"],
};

export function renderInboundAck(params: readonly string[]): string {
  return fillText("inbound_ack", INBOUND_ACK_TEXT, params);
}

function fillText(
  name: string,
  t: TemplateText,
  params: readonly string[],
): string {
  if (params.length !== t.params.length) {
    throw new RangeError(
      `${name} takes ${t.params.length} params, got ${params.length}`,
    );
  }
  return t.body.replace(
    /\{\{(\d+)\}\}/g,
    (_, i: string) => params[Number(i) - 1],
  );
}
