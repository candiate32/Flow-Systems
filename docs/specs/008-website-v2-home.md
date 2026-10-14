# 008: Website v2 home page

A new home page for Flow Systems as a multi-service studio, at `/v2`. Asked for on 14 Oct: v2 offers every service, while today's pages stay only for interior designers and must not change. Services and their wording come from the reference sheet (six services); the layout takes its cues from a monochrome AI SaaS template with a draggable 3D ink sculpture hero and a feature bento, but the design is our own.

## The bar (what the reviewer grades against)

1. `npm ci && npm run typecheck && npm run lint && npm test && npm run build` pass. Nothing under `supabase/` changes, and no existing page (`/`, `/home`, `/f/:slug`, `/admin`) changes.
2. **Route.** `/v2` (so `/#/v2` on GitHub Pages) renders the page and is lazy-loaded, so other routes don't download it.
3. **Content, in this order:** a hero (what Flow Systems does in one line, two calls to action, the 3D sculpture); the six services, numbered 01–06, each with its category label, name and one-line description from the reference; one service already running for real (the Lead Leak Fix for interior studios, linking to the live sample forms at `/`); how we work in four steps; an FAQ; a closing call to action and footer. No testimonials, pricing, client logos or statistics we can't back up, and no tech stack, provider or competitor names.
4. **Hero sculpture.** A generative 3D ink form drawn on a canvas that turns slowly, can be dragged to rotate (mouse, pen and touch, with vertical page scroll still working on phones), stops drawing when off screen or in a hidden tab, and is decorative to assistive tech. With `prefers-reduced-motion: reduce` it draws one still frame and only moves when dragged.
5. **Contact.** The main button opens WhatsApp to Flow Systems when `VITE_CONTACT_WHATSAPP` is set; until then it jumps to the services instead, so there is never a dead or placeholder link.
6. **Polish, checked in a real browser at 390px and 1280px:** no horizontal scroll; every tap target at least 44px; the sticky nav never covers a section heading after an anchor jump; text contrast passes 4.5:1; one h1 and headings in order; in-page links scroll smoothly without breaking hash routing.

Max 3 review rounds. Personal taste in colours or wording is not grounds for rejection.
