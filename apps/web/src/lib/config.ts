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

export function demoSourceKey(): string {
  return read('VITE_DEMO_SOURCE_KEY') || 'demo-web-form'
}

export function whatsappFallbackUrl(): string {
  const digits = (read('VITE_WHATSAPP_FALLBACK_PHONE') || '919000000001').replace(/\D/g, '')
  return `https://wa.me/${digits}`
}
