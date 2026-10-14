
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "audit_log": {
                  Row: {
                    "action": string,"actor": string,"at": string,"details": NonNullable<Json>,"id": number,"org_id": string,"target": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor": string,"at"?: string,"details"?: NonNullable<Json>,"id"?: never,"org_id": string,"target"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor"?: string,"at"?: string,"details"?: NonNullable<Json>,"id"?: never,"org_id"?: string,"target"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_log_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"events": {
                  Row: {
                    "created_at": string,"id": number,"lead_id": string | null,"org_id": string,"payload": NonNullable<Json>,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: never,"lead_id"?: string | null,"org_id": string,"payload"?: NonNullable<Json>,"type": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: never,"lead_id"?: string | null,"org_id"?: string,"payload"?: NonNullable<Json>,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "events_lead_id_fkey"
      columns: ["lead_id"]
isOneToOne: false
      referencedRelation: "leads"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "events_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"jobs": {
                  Row: {
                    "attempts": number,"created_at": string,"id": string,"idempotency_key": string,"kind": string,"last_error": string | null,"lead_id": string | null,"max_attempts": number,"org_id": string,"payload": NonNullable<Json>,"run_at": string,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"created_at"?: string,"id"?: string,"idempotency_key": string,"kind": string,"last_error"?: string | null,"lead_id"?: string | null,"max_attempts"?: number,"org_id": string,"payload"?: NonNullable<Json>,"run_at"?: string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "attempts"?: number,"created_at"?: string,"id"?: string,"idempotency_key"?: string,"kind"?: string,"last_error"?: string | null,"lead_id"?: string | null,"max_attempts"?: number,"org_id"?: string,"payload"?: NonNullable<Json>,"run_at"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "jobs_lead_id_fkey"
      columns: ["lead_id"]
isOneToOne: false
      referencedRelation: "leads"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "jobs_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"leads": {
                  Row: {
                    "bhk": string | null,"consent_at": string,"created_at": string,"details": NonNullable<Json>,"first_auto_reply_at": string | null,"first_human_reply_at": string | null,"id": string,"last_enquiry_at": string,"last_human_reply_at": string | null,"last_inbound_at": string | null,"name": string,"opted_out_at": string | null,"org_id": string,"phone_e164": string,"possession_month": string | null,"source_id": string | null,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "bhk"?: string | null,"consent_at": string,"created_at"?: string,"details"?: NonNullable<Json>,"first_auto_reply_at"?: string | null,"first_human_reply_at"?: string | null,"id"?: string,"last_enquiry_at"?: string,"last_human_reply_at"?: string | null,"last_inbound_at"?: string | null,"name": string,"opted_out_at"?: string | null,"org_id": string,"phone_e164": string,"possession_month"?: string | null,"source_id"?: string | null,"status"?: string
                  }
                  Update: {
                    "bhk"?: string | null,"consent_at"?: string,"created_at"?: string,"details"?: NonNullable<Json>,"first_auto_reply_at"?: string | null,"first_human_reply_at"?: string | null,"id"?: string,"last_enquiry_at"?: string,"last_human_reply_at"?: string | null,"last_inbound_at"?: string | null,"name"?: string,"opted_out_at"?: string | null,"org_id"?: string,"phone_e164"?: string,"possession_month"?: string | null,"source_id"?: string | null,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "leads_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "leads_source_id_fkey"
      columns: ["source_id"]
isOneToOne: false
      referencedRelation: "sources"
      referencedColumns: ["id"]
    }
                  ]
                },"messages": {
                  Row: {
                    "body": string | null,"created_at": string,"direction": string,"error": string | null,"id": string,"job_id": string | null,"kind": string,"lead_id": string | null,"org_id": string,"provider": string,"provider_message_id": string | null,"sent_at": string | null,"status": string,"template_name": string | null,"to_phone": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "body"?: string | null,"created_at"?: string,"direction": string,"error"?: string | null,"id"?: string,"job_id"?: string | null,"kind": string,"lead_id"?: string | null,"org_id": string,"provider": string,"provider_message_id"?: string | null,"sent_at"?: string | null,"status"?: string,"template_name"?: string | null,"to_phone"?: string | null
                  }
                  Update: {
                    "body"?: string | null,"created_at"?: string,"direction"?: string,"error"?: string | null,"id"?: string,"job_id"?: string | null,"kind"?: string,"lead_id"?: string | null,"org_id"?: string,"provider"?: string,"provider_message_id"?: string | null,"sent_at"?: string | null,"status"?: string,"template_name"?: string | null,"to_phone"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "messages_job_id_fkey"
      columns: ["job_id"]
isOneToOne: false
      referencedRelation: "jobs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "messages_lead_id_fkey"
      columns: ["lead_id"]
isOneToOne: false
      referencedRelation: "leads"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "messages_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"org_members": {
                  Row: {
                    "created_at": string,"org_id": string,"role": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"org_id": string,"role": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"org_id"?: string,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "org_members_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"orgs": {
                  Row: {
                    "created_at": string,"id": string,"is_canary": boolean,"is_demo": boolean,"name": string,"owner_alert_phones": (string)[],"slug": string,"timezone": string,"whatsapp_fallback_phone": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_canary"?: boolean,"is_demo"?: boolean,"name": string,"owner_alert_phones"?: (string)[],"slug": string,"timezone"?: string,"whatsapp_fallback_phone"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_canary"?: boolean,"is_demo"?: boolean,"name"?: string,"owner_alert_phones"?: (string)[],"slug"?: string,"timezone"?: string,"whatsapp_fallback_phone"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"sources": {
                  Row: {
                    "created_at": string,"id": string,"kind": string,"name": string,"org_id": string,"public_key": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"kind": string,"name": string,"org_id": string,"public_key": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"kind"?: string,"name"?: string,"org_id"?: string,"public_key"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sources_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"templates": {
                  Row: {
                    "body": string,"category": string,"created_at": string,"id": string,"language": string,"name": string,"org_id": string,"param_names": (string)[],"provider_template_id": string | null,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "body": string,"category"?: string,"created_at"?: string,"id"?: string,"language"?: string,"name": string,"org_id": string,"param_names"?: (string)[],"provider_template_id"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "body"?: string,"category"?: string,"created_at"?: string,"id"?: string,"language"?: string,"name"?: string,"org_id"?: string,"param_names"?: (string)[],"provider_template_id"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "templates_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"webhook_events": {
                  Row: {
                    "attempts": number,"id": number,"kind": string | null,"lead_id": string | null,"org_id": string | null,"payload": NonNullable<Json>,"phone": string | null,"processed_at": string | null,"processing_error": string | null,"provider": string,"provider_event_id": string,"received_at": string,"result": Json | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"id"?: never,"kind"?: string | null,"lead_id"?: string | null,"org_id"?: string | null,"payload": NonNullable<Json>,"phone"?: string | null,"processed_at"?: string | null,"processing_error"?: string | null,"provider": string,"provider_event_id": string,"received_at"?: string,"result"?: Json | null
                  }
                  Update: {
                    "attempts"?: number,"id"?: never,"kind"?: string | null,"lead_id"?: string | null,"org_id"?: string | null,"payload"?: NonNullable<Json>,"phone"?: string | null,"processed_at"?: string | null,"processing_error"?: string | null,"provider"?: string,"provider_event_id"?: string,"received_at"?: string,"result"?: Json | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "webhook_events_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "cancel_followups":
{ Args: { "p_as_of"?: string,"p_lead_id": string,"p_reason": string }; Returns: string[]
                           },
"claim_jobs":
{ Args: { "as_of"?: string,"batch": number }; Returns: {
              "attempts": number,
"created_at": string,
"id": string,
"idempotency_key": string,
"kind": string,
"last_error": string | null,
"lead_id": string | null,
"max_attempts": number,
"org_id": string,
"payload": NonNullable<Json>,
"run_at": string,
"status": string,
"updated_at": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "jobs"
        isOneToOne: false
        isSetofReturn: true
      } },
"delete_lead":
{ Args: { "lead": string }; Returns: boolean
                           },
"process_whatsapp_event":
{ Args: { "p_as_of"?: string,"p_event": Json,"p_source_id": string,"p_webhook_event_id": number }; Returns: Json
                           },
"record_opt_out":
{ Args: { "p_at"?: string,"p_lead_id": string }; Returns: (string)[]
                           },
"record_webhook_failure":
{ Args: { "p_error": string,"p_org_id"?: string,"p_webhook_event_id": number }; Returns: number
                           },
"schedule_followups":
{ Args: { "p_as_of"?: string,"p_jobs": Json,"p_lead_id": string,"p_reason": string }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const
