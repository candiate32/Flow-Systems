# 006: Flow Systems home page

A page at `/home` that explains Flow Systems to an interior design studio owner: what it is, the services, and why they need it, with the three live sample forms built in so they can try the front end the engine sits behind. Asked for by Mourya on 11 Oct: pretty and professional, Nila's design system throughout, smooth scrolling and animation, few sections, not cluttered, easy to read.

## The bar (what the reviewer grades against)

1. `npm ci && npm run typecheck && npm run lint && npm test && npm run build` pass. Nothing under `supabase/` changes.
2. **Route.** `/home` (so `/#/home` on GitHub Pages) renders the page; it is lazy-loaded so `/` and `/f/:slug` don't download it. `/` stays the form showcase, and its Flow Systems wordmark links to `/home`.
3. **Content, five parts and no more:** a hero (what Flow Systems is in one line, for whom, and a live-looking WhatsApp exchange that shows a reply landing within a minute); why it matters (the first studio to reply usually gets the site visit); how it works (the four core services as one managed package: instant WhatsApp reply, new lead alerts, follow-ups on day 1, 3 and 7, weekly report, plus the add-ons and what's coming soon); the three sample forms; and a closing call to action for the free Enquiry Leak Audit with a short footer. Copy comes from the client-facing services sheet. No tech stack, provider or competitor names, and no statistics we can't back up.
4. **Nila's design system.** The page uses the terrazzo theme's tokens through the same `--ff-*` variables and shared classes the forms use: Bricolage Grotesque headings, DM Sans body, 14px radius, verdigris accent, terrazzo pattern.
5. **The forms.** All three registered forms appear in one section, switchable with tabs (a WAI-ARIA tab list: arrow keys move between tabs) and previous/next buttons, Nila first. They are live, exactly like `/`. Switching keeps what was typed in each form. The section is not labelled "playground".
6. **Motion.** Section anchors scroll smoothly from the nav (without breaking hash routing); content reveals as it scrolls into view; the hero exchange plays once; the how-it-works line fills as you scroll. With `prefers-reduced-motion: reduce`, everything is shown in its final state with no movement.
7. **Polish, checked in a real browser at 390px and 1280px:** no horizontal scroll; every tap target at least 44px; sticky nav never covers a section heading after an anchor jump; text contrast passes 4.5:1; headings in order (one h1).
8. **Contact.** The audit button opens WhatsApp to Flow Systems when `VITE_CONTACT_WHATSAPP` is set; when it isn't (today), the page offers "Try a live form" instead and never shows a dead or placeholder link.

Max 3 review rounds. Personal taste in colours or wording is not grounds for rejection.

## Also in this change

- `/` keeps what was typed in each form when you switch away and back, so arrow keys can never throw away a half-filled enquiry (follow-up to the 005 review), and quick key presses always land one form apart.
