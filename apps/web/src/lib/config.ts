// Browser config. Everything here comes from VITE_ env vars and ships to the
// browser, so it must only ever hold public values.

function read(name: string): string {
  const value = (import.meta.env as Record<string, string | undefined>)[name]
  return typeof value === 'string' ? value.trim() : ''
}

export function supabaseUrl(): string {
  return read('VITE_SUPABASE_URL').replace(/\/+$/, '')
}

export function supabasePublishableKey(): string {
  return read('VITE_SUPABASE_PUBLISHABLE_KEY')
}

export function turnstileSiteKey(): string {
  return read('VITE_TURNSTILE_SITE_KEY')
}

/** Flow Systems' own WhatsApp number for the home page's audit button; empty until there is one. */
export function contactWhatsappNumber(): string {
  return read('VITE_CONTACT_WHATSAPP')
}

// Static hosts without SPA rewrites (GitHub Pages previews) use hash routes: /#/admin.
export function hashRouting(): boolean {
  return read('VITE_HASH_ROUTER') === 'true'
}

export function adminUrl(): string {
  const { origin, pathname } = window.location
  return hashRouting() ? `${origin}${pathname}#/admin` : `${origin}/admin`
}
