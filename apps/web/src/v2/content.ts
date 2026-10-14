// Copy for the v2 home page. Service names and lines come from the services
// reference sheet. Keep tech, provider and competitor names out, and only
// claim what we do.
import { contactWhatsappNumber } from '../lib/config'
import { normalizeIndianMobile } from '../lib/enquiry'

export type ServiceArt = 'voice' | 'marketing' | 'content' | 'exhibition' | 'workflow' | 'apps'

export type Service = {
  id: ServiceArt
  category: string
  name: string
  line: string
}

export const SERVICES: readonly Service[] = [
  {
    id: 'voice',
    category: 'Conversation',
    name: 'AI Voice Agent',
    line: 'Responds, qualifies, books and follows up using approved business context.',
  },
  {
    id: 'marketing',
    category: 'Growth',
    name: 'Marketing Agent',
    line: 'Coordinates research, campaign planning and repeatable marketing execution.',
  },
  {
    id: 'content',
    category: 'Content',
    name: 'Content Generator',
    line: 'Turns brand knowledge into structured, reviewable content workflows.',
  },
  {
    id: 'exhibition',
    category: 'Field sales',
    name: 'Exhibition Lead Capture',
    line: 'Captures visitor data, routes priority prospects and triggers timely follow-up.',
  },
  {
    id: 'workflow',
    category: 'Operations',
    name: 'Workflow Automation',
    line: 'Connects tools, decisions and approvals into one dependable operating flow.',
  },
  {
    id: 'apps',
    category: 'Software',
    name: 'Custom Apps',
    line: 'Purpose-built web and mobile products for workflows generic tools cannot fit.',
  },
]

export const STEPS = [
  {
    title: 'Audit',
    body: 'A free call where we map how work moves today and where leads, hours or money leak out.',
  },
  {
    title: 'Design',
    body: 'One short written plan with a clear bar: exactly what will run, and what will be true, when it is done.',
  },
  {
    title: 'Build',
    body: 'Small releases you can try each week, with your team approving anything that speaks for your business.',
  },
  {
    title: 'Run',
    body: 'We keep it running, watch it closely and send a weekly report on what it did.',
  },
] as const

export const FAQ = [
  {
    q: 'Who is this for?',
    a: 'Growing service businesses in and around Bangalore that lose time or customers to slow replies, manual follow-up and work spread across too many tools.',
  },
  {
    q: 'Do I need to change the tools I already use?',
    a: 'Usually not. We connect to what your team already works in and only build something new where nothing you have can fit.',
  },
  {
    q: 'Will an AI speak to my customers without checks?',
    a: 'No. Agents work from business context you approve, and anything sensitive waits for a person on your team to say yes.',
  },
  {
    q: 'What happens to my customer data?',
    a: 'It is used only to run your systems and is deleted when you or your customer ask. Lead data we hold for you stays in India.',
  },
  {
    q: 'How do we start?',
    a: 'With the free audit. You leave with a short plan whether or not you work with us.',
  },
] as const

const CONTACT_MESSAGE = "Hi Flow Systems, I'd like a free audit of how my business handles leads and work."

/** wa.me link to Flow Systems, or null while we have no number (VITE_CONTACT_WHATSAPP). */
export function contactWhatsappLink(): string | null {
  const e164 = normalizeIndianMobile(contactWhatsappNumber())
  if (!e164) return null
  return `https://wa.me/${e164.slice(1)}?text=${encodeURIComponent(CONTACT_MESSAGE)}`
}
