// Copy for the home page, from the client-facing services sheet
// (flow-systems/client-facing/services-for-interior-designers*.html).
// Keep tech, provider and competitor names out, and only claim what we do.
import { contactWhatsappNumber } from '../lib/config'
import { normalizeIndianMobile } from '../lib/enquiry'

export const WHY = [
  {
    title: 'Always reply first',
    body: 'An enquiry at 11 pm, or in the middle of a site visit, still gets an answer within a minute.',
  },
  {
    title: "Leads don't go cold",
    body: 'Follow-ups go out on their own, even when your team is busy.',
  },
  {
    title: "Know what's working",
    body: 'See how many enquiries came in, how fast you replied and where each one stands.',
  },
] as const

/** The four core services, in the order an enquiry meets them. */
export const STEPS = [
  {
    when: 'Under 60 seconds',
    title: 'Instant WhatsApp reply',
    body: "Every new enquiry gets a reply in your studio's name, at any hour, on the WhatsApp Business number you already use.",
  },
  {
    when: 'The same minute',
    title: 'New lead alerts',
    body: "You or your designer get the lead's details on WhatsApp the moment an enquiry arrives.",
  },
  {
    when: 'Day 1, 3 and 7',
    title: 'Automatic follow-ups',
    body: 'Short, polite follow-ups when a lead stops replying, so no enquiry quietly goes cold.',
  },
  {
    when: 'Every week',
    title: 'Weekly lead report',
    body: 'Enquiries received, how fast each one was answered, and where every lead stands.',
  },
] as const

export const ADD_ONS = [
  { title: 'Site visit reminders', body: 'Confirmations and reminders before consultations and site visits.' },
  { title: 'Old enquiry follow-up', body: "A message to past enquiries that didn't convert, checking if they're still planning." },
  { title: 'Google review requests', body: 'A message after handover asking for a review, with a direct link.' },
  { title: 'Enquiry landing page', body: 'A simple mobile page for your ads, with your projects and an enquiry form.' },
] as const

export const COMING_SOON = ['Lead dashboard', 'Facebook and Instagram lead forms'] as const

const AUDIT_MESSAGE = "Hi Flow Systems, I'd like a free Enquiry Leak Audit for my studio."

/** wa.me link to Flow Systems for the audit, or null while we have no number (VITE_CONTACT_WHATSAPP). */
export function auditWhatsappLink(): string | null {
  const e164 = normalizeIndianMobile(contactWhatsappNumber())
  if (!e164) return null
  return `https://wa.me/${e164.slice(1)}?text=${encodeURIComponent(AUDIT_MESSAGE)}`
}
