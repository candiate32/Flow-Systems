import type { FormConfig } from '../types'

/** Fictional sample studio: terrazzo palette, split layout. The default form at `/`. */
export const nilaDesignHouse: FormConfig = {
  slug: 'nila-design-house',
  sourceKey: 'demo-web-form',
  studio: {
    name: 'Nila Design House',
    area: 'Indiranagar',
    logoText: 'nila.',
    whatsappFallback: '+91 90000 00001',
    isDemo: true,
  },
  theme: { preset: 'terrazzo' },
  layout: 'split',
  copy: {
    headline: 'Homes that feel like you, not a catalogue.',
    intro:
      'Tell us a little about the flat and what you have in mind. A designer replies on WhatsApp within a minute with next steps and a free consult slot.',
    submitLabel: 'Get my free consult slot',
    successTitle: "We've sent you a WhatsApp",
  },
  fields: [
    { kind: 'name', label: 'Your name' },
    { kind: 'phone', hint: 'We reply here, usually within a minute.' },
    { kind: 'bhk', label: 'Home size', options: ['1BHK', '2BHK', '3BHK', '4BHK+', 'Villa'], required: true },
    {
      kind: 'chips',
      key: 'scope',
      label: 'What are we designing?',
      options: ['Kitchen only', 'Kitchen + wardrobes', 'Full home'],
      required: true,
    },
    {
      kind: 'chips',
      key: 'budget_band',
      label: 'Rough budget',
      options: ['Under ₹8L', '₹8–15L', '₹15–25L', '₹25L+'],
    },
    { kind: 'possession_month', label: 'When do you get the keys?', monthsAhead: 24 },
    {
      kind: 'text',
      key: 'project_name',
      label: 'Apartment or project name',
      placeholder: 'e.g. Prestige Lakeside Habitat',
      maxLength: 80,
    },
  ],
}
