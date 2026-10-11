// The one registry of studio forms. To add a studio: create configs/<slug>.ts
// exporting a FormConfig and add it to this list. Nothing else changes.
import type { FormConfig } from '../types'
import { haveliWorks } from './haveli-works'
import { limeAndLattice } from './lime-and-lattice'
import { nilaDesignHouse } from './nila-design-house'

/** Showcase order: the first is the default form at `/`. */
export const FORM_CONFIGS: readonly FormConfig[] = [nilaDesignHouse, limeAndLattice, haveliWorks]

/** The form shown first at `/`. */
export const HOME_FORM_SLUG = 'nila-design-house'

export function getFormConfig(slug: string): FormConfig | undefined {
  return FORM_CONFIGS.find((c) => c.slug === slug)
}
