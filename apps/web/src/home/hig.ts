// Shared class strings for the Flow Systems pages, in the style of Apple's
// Human Interface Guidelines. Colours, font and easing are the hig-* tokens
// in index.css.

export const container = 'mx-auto w-full max-w-[980px] px-5 sm:px-6'
export const wide = 'mx-auto w-full max-w-[1200px] px-4 sm:px-6'

export const focus =
  'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-hig-tint'

/** Small coloured line above a section title. */
export const eyebrow = 'text-[1.0625rem] font-semibold tracking-[-0.01em] text-hig-tint'

/** Section titles: large, semibold, tightly tracked. */
export const sectionTitle = 'text-[2.5rem] leading-[1.08] font-semibold tracking-[-0.03em] text-balance sm:text-[3.5rem]'

export const lead = 'text-[1.1875rem] leading-[1.45] tracking-[-0.01em] text-pretty text-hig-ink-2 sm:text-[1.3125rem]'

export const filledButton = [
  'inline-flex min-h-11 items-center justify-center rounded-full bg-hig-tint px-6 py-2.5',
  'text-[1.0625rem] font-medium tracking-[-0.01em] text-white',
  'transition-[background-color,scale] duration-200 hover:bg-hig-tint-bright active:scale-[0.97]',
  focus,
].join(' ')

/** Apple's plain text link with a chevron: "Learn more ›". */
export const chevronLink = [
  'group/link inline-flex min-h-11 items-center gap-1 text-[1.0625rem] tracking-[-0.01em] text-hig-tint',
  'hover:underline hover:underline-offset-4',
  focus,
].join(' ')

/** A bento tile or card: white on the grey fill, large continuous-looking corners, no border. */
export const tile = 'rounded-[1.75rem] bg-white'

/** Translucent, blurred bar material, like Safari's toolbar. */
export const material = 'bg-white/72 backdrop-blur-xl backdrop-saturate-[1.8]'

/** A thicker material for controls that pin over busy content, so their small text keeps its contrast. */
export const materialThick = 'bg-white/85 backdrop-blur-xl backdrop-saturate-[1.8]'
