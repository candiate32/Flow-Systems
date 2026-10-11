import type { FormConfig } from '../types'

/** The spec 002 demo studio, served at `/`. Core fields only. */
export const demoInteriors: FormConfig = {
  slug: 'demo-interiors',
  sourceKey: 'demo-web-form',
  studio: {
    name: 'Demo Interiors',
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
    { kind: 'possession_month' },
  ],
}
