import type { FormConfig } from '../types'

/** Fictional sample studio: lime plaster and terracotta, card layout. */
export const limeAndLattice: FormConfig = {
  slug: 'lime-and-lattice',
  sourceKey: 'demo-web-form',
  studio: {
    name: 'Lime & Lattice',
    area: 'Sarjapur Road',
    whatsappFallback: '+91 90000 00001',
    isDemo: true,
  },
  theme: { preset: 'atelier' },
  layout: 'card',
  copy: {
    headline: 'Interiors for your new home, planned properly.',
    intro:
      "Modular kitchens, wardrobes and full-home interiors. Tell us about your home and we'll reply on WhatsApp in under a minute.",
  },
  fields: [
    { kind: 'name' },
    { kind: 'phone' },
    { kind: 'bhk' },
    {
      kind: 'chips',
      key: 'style',
      label: 'Which style are you drawn to?',
      options: ['Warm minimal', 'Contemporary', 'Classic Indian', 'Not sure yet'],
    },
    { kind: 'possession_month' },
  ],
}
