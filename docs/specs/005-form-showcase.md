# 005: One showcase page for every studio form

The public preview (`/`) is what Prajin opens in a meeting to show that Flow Systems builds a good front end as well as the engine behind it. Today `/` shows one studio, the other forms sit on a separate `/forms` gallery, and the three themes each use a different type system, so they don't read as one product. Mourya asked (11 Oct) for: Nila as the default form, no studio called "Demo …", every form in Nila's design language, all forms on one page with arrows to switch between them, and tighter spacing.

## The bar (what the reviewer grades against)

1. `npm ci && npm run typecheck && npm run lint && npm test && npm run build` pass. Nothing under `supabase/` changes.
2. **One page, every form.** `/` renders a showcase: a Flow Systems bar above one studio form at a time. Nila Design House is shown first. The bar has previous and next arrow buttons (each at least 44px, named for the form they go to, wrapping at the ends) and, from 1024px up, one pill per registered studio (below that, the current studio's name and its place, "1 of 3"). The Left and Right arrow keys also switch forms when focus is not in a form control.
3. **Shareable.** The selected form lives in the URL as `?form=<slug>` (so `/#/?form=haveli-works` works on GitHub Pages). An unknown slug falls back to Nila. Switching replaces the history entry and starts the new form empty.
4. **Live, not a preview.** Showcase forms submit to the engine with their config's source key, exactly as `/` did before, so a prospect's enquiry reaches `/admin`.
5. **Routes:** `/f/:slug` still renders one form on its own with no showcase bar (what a client's page looks like). `/forms` redirects to `/`. An unknown `/f/:slug` still shows the friendly not-found, which links back to `/`.
6. **No "Demo" studio.** Demo Interiors becomes **Lime & Lattice, Sarjapur Road** (`lime-and-lattice`), with at least one custom question like the other two. Every sample studio keeps its small "Demo" tag and the "not a real business" footer line, so a prospect is never misled.
7. **Nila's design language everywhere.** All three presets use Nila's type and shape: Bricolage Grotesque headlines, DM Sans body and buttons, 14px corner radius. Presets still differ in colour and material pattern, and still pass the contrast checks in `validateConfig.test.ts`.
8. **Polish, checked in a real browser at 390px and 1280px for every form in the showcase:** no horizontal scroll; every tap target at least 44px; the split layout's header spans both columns and its copy column doesn't leave a tall empty gap beside the form; spacing between header, copy, fields, consent and footer follows one rhythm across the three layouts.

Max 3 review rounds. Personal taste in colours is not grounds for rejection.

## Out of scope

Renaming the server-side demo org (still "Demo Interiors, Sarjapur Road" in `supabase/seed.sql` and on flow-dev). That belongs to the engine work.
