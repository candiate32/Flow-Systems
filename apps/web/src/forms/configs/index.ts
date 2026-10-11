// The one registry of studio forms. To add a studio: create configs/<slug>.ts
// exporting a FormConfig and add it to this list. Nothing else changes.
import type { FormConfig } from '../types'
import { demoInteriors } from './demo-interiors'
import { haveliWorks } from './haveli-works'
import { nilaDesignHouse } from './nila-design-house'

export const FORM_CONFIGS: readonly FormConfig[] = [demoInteriors, nilaDesignHouse, haveliWorks]

/** The form served at `/`. */
export const HOME_FORM_SLUG = 'demo-interiors'

export function getFormConfig(slug: string): FormConfig | undefined {
  return FORM_CONFIGS.find((c) => c.slug === slug)
}
