# 007: Home page redesign, Apple style

A redesign of `/home` (spec 006) following Apple's Human Interface Guidelines, asked for on 14 Oct: redesign the UI completely, move the enquiry forms right below "Why it matters", make switching the form design more prominent, and give "How it works" a new bento layout with animation. Everything in 006 still holds unless this spec replaces it.

## What changes

- **Design language.** The page leaves Nila's look for Apple's: the system font (SF Pro on Apple devices, Inter elsewhere), large semibold titles with tight tracking, white and light-grey (#F5F5F7) surfaces, rounded tiles, translucent blurred bars, pill buttons, plain "›" text links, and generous space. Verdigris (Nila's accent) stays as the one tint colour so the page still belongs to the forms. The sample forms themselves keep their own studio designs.
- **Order.** Hero, Why it matters, the forms, How it works, the audit call to action, footer. The nav links follow that order.
- **Design picker.** A large segmented control with a sliding selection, one segment per studio showing its colours, name, theme and layout, plus previous/next buttons. It stays pinned under the nav while you scroll through the form.
- **How it works.** A bento grid replaces the timeline: one tile per core service, each with its own small animation that plays when the tile comes into view (a reply timer, lead alerts arriving, follow-up days lighting up, a report's bars growing), and one tile for the add-ons and what's coming soon.

## The bar (what the reviewer grades against)

1. `npm run typecheck && npm run lint && npm test && npm run build` pass. Nothing under `supabase/` changes.
2. Spec 006's bar still passes, except where this spec replaces it: content (bar 3) and Nila's design system (bar 4) are replaced by lines 3 to 5 below, and the timeline line fill in bar 6 by the bento animations.
3. **Apple style, consistently.** System font stack with Inter as the fallback; one tint colour; titles semibold with negative tracking; surfaces white and #F5F5F7; tiles and cards with large radii and no heavy borders; the nav and the pinned picker use a translucent, blurred material. No Bricolage Grotesque or DM Sans outside the sample forms.
4. **Order and picker.** The forms section comes straight after "Why it matters". The picker is a WAI-ARIA tab list (arrow keys, Home and End), shows every studio's colours and its theme and layout names (names only on phones), has previous/next buttons, stays visible under the nav while any part of the form is on screen, and never covers a form field's label or the submit button once scrolled to.
5. **Bento.** Four service tiles and one add-ons tile in a grid that is varied on desktop, two columns on tablet and one on phones. Each service tile's animation runs once when it comes into view; with reduced motion every tile shows its final state with no movement. Illustrations show no statistics we can't back up (an example reply time is labelled as an example; the report has no numbers).
6. **Polish at 360, 390 and 1280px:** no horizontal scroll, every tap target at least 44px, text contrast at least 4.5:1 (3:1 for titles 24px and up), one h1 and headings in order, and no console errors.

Max 3 review rounds.
