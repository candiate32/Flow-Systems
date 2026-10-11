// Hand-typed subset of public.leads that the admin page reads.
export type Lead = {
  id: string
  name: string
  phone_e164: string
  bhk: string | null
  created_at: string
  first_auto_reply_at: string | null
}
