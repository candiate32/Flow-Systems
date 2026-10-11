import type { FormConfig } from '../types'

/** Fictional sample studio: premium, dark teak palette, minimal (embeddable) layout. */
export const haveliWorks: FormConfig = {
  slug: 'haveli-works',
  sourceKey: 'demo-web-form',
  studio: {
    name: 'Haveli Works',
    area: 'Whitefield',
    logoText: 'HAVELI WORKS',
    whatsappFallback: '+91 90000 00001',
    isDemo: true,
  },
  theme: { preset: 'teak' },
  layout: 'minimal',
  copy: {
    headline: 'Book a design consultation',
    intro: 'Bespoke woodwork and turnkey interiors for villas and large apartments. We reply on WhatsApp within a minute.',
    submitLabel: 'Request a consultation',
    consentLabel: 'I agree to Haveli Works contacting me on WhatsApp about this enquiry',
  },
  fields: [
    { kind: 'name', label: 'Full name' },
    { kind: 'phone', label: 'WhatsApp number' },
    { kind: 'bhk', label: 'Property', options: ['3BHK', '4BHK+', 'Villa', 'Office'] },
    {
      kind: 'select',
      key: 'locality',
      label: 'Where is the property?',
      options: [
        'Whitefield',
        'Varthur',
        'Marathahalli',
        'Sarjapur Road',
        'Bellandur',
        'HSR Layout',
        'Koramangala',
        'Indiranagar',
        'Hebbal',
        'Elsewhere in Bangalore',
      ],
    },
    { kind: 'chips', key: 'call_time', label: 'Best time to call', options: ['Morning', 'Afternoon', 'Evening'] },
  ],
}
