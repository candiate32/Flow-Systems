import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabasePublishableKey, supabaseUrl } from './config'

let client: SupabaseClient | null = null

/**
 * The browser Supabase client, authenticated with the signed-in user's
 * session so row-level security applies. Uses only the publishable key.
 * Returns null when the env vars are missing so the public page still renders.
 */
export function getSupabase(): SupabaseClient | null {
  if (client) return client
  const url = supabaseUrl()
  const key = supabasePublishableKey()
  if (!url || !key) return null
  client = createClient(url, key)
  return client
}
