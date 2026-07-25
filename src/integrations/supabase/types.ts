export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_audit_logs: {
        Row: {
          action: string
          admin_email: string | null
          admin_user_id: string
          created_at: string
          details: Json | null
          id: string
          target_org_id: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          admin_email?: string | null
          admin_user_id: string
          created_at?: string
          details?: Json | null
          id?: string
          target_org_id?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          admin_email?: string | null
          admin_user_id?: string
          created_at?: string
          details?: Json | null
          id?: string
          target_org_id?: string | null
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_audit_logs_target_org_id_fkey"
            columns: ["target_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_offer_recommendations: {
        Row: {
          applied_at: string | null
          created_at: string
          dismissed_at: string | null
          duration_hours: number | null
          id: string
          offer_type: string
          org_id: string
          payload: Json | null
          probability: string | null
          product_id: string | null
          reason: string
          recommended_channel: string | null
          resulting_margin_percent: number | null
          status: string | null
          suggested_discount_percent: number | null
          suggested_price_ars: number | null
          user_id: string
        }
        Insert: {
          applied_at?: string | null
          created_at?: string
          dismissed_at?: string | null
          duration_hours?: number | null
          id?: string
          offer_type: string
          org_id: string
          payload?: Json | null
          probability?: string | null
          product_id?: string | null
          reason: string
          recommended_channel?: string | null
          resulting_margin_percent?: number | null
          status?: string | null
          suggested_discount_percent?: number | null
          suggested_price_ars?: number | null
          user_id: string
        }
        Update: {
          applied_at?: string | null
          created_at?: string
          dismissed_at?: string | null
          duration_hours?: number | null
          id?: string
          offer_type?: string
          org_id?: string
          payload?: Json | null
          probability?: string | null
          product_id?: string | null
          reason?: string
          recommended_channel?: string | null
          resulting_margin_percent?: number | null
          status?: string | null
          suggested_discount_percent?: number | null
          suggested_price_ars?: number | null
          user_id?: string
        }
        Relationships: []
      }
      alert_rules: {
        Row: {
          created_at: string | null
          enabled: boolean
          id: string
          last_run_at: string | null
          last_triggered_at: string | null
          org_id: string
          threshold_days: number
          threshold_value: number
          type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          last_triggered_at?: string | null
          org_id: string
          threshold_days?: number
          threshold_value?: number
          type: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          enabled?: boolean
          id?: string
          last_run_at?: string | null
          last_triggered_at?: string | null
          org_id?: string
          threshold_days?: number
          threshold_value?: number
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alert_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          org_id: string | null
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          org_id?: string | null
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          org_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      automation_flows: {
        Row: {
          action_config: Json
          action_type: string
          active: boolean
          created_at: string
          id: string
          last_run_at: string | null
          name: string
          org_id: string
          trigger_config: Json
          trigger_type: string
          updated_at: string
        }
        Insert: {
          action_config?: Json
          action_type: string
          active?: boolean
          created_at?: string
          id?: string
          last_run_at?: string | null
          name: string
          org_id: string
          trigger_config?: Json
          trigger_type: string
          updated_at?: string
        }
        Update: {
          action_config?: Json
          action_type?: string
          active?: boolean
          created_at?: string
          id?: string
          last_run_at?: string | null
          name?: string
          org_id?: string
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_flows_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_runs: {
        Row: {
          action_type: string
          actions_taken: number | null
          entities_matched: number | null
          error_message: string | null
          flow_id: string
          id: string
          org_id: string
          ran_at: string
          status: string
          trigger_type: string
        }
        Insert: {
          action_type: string
          actions_taken?: number | null
          entities_matched?: number | null
          error_message?: string | null
          flow_id: string
          id?: string
          org_id: string
          ran_at?: string
          status?: string
          trigger_type: string
        }
        Update: {
          action_type?: string
          actions_taken?: number | null
          entities_matched?: number | null
          error_message?: string | null
          flow_id?: string
          id?: string
          org_id?: string
          ran_at?: string
          status?: string
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "automation_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_transactions: {
        Row: {
          account: string
          amount_ars: number
          created_at: string
          date: string
          description: string
          id: string
          match_ref: string | null
          matched: boolean
          notes: string | null
          org_id: string
          type: string
        }
        Insert: {
          account?: string
          amount_ars: number
          created_at?: string
          date: string
          description: string
          id?: string
          match_ref?: string | null
          matched?: boolean
          notes?: string | null
          org_id: string
          type: string
        }
        Update: {
          account?: string
          amount_ars?: number
          created_at?: string
          date?: string
          description?: string
          id?: string
          match_ref?: string | null
          matched?: boolean
          notes?: string | null
          org_id?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_knowledge: {
        Row: {
          active: boolean | null
          brand: string
          category: string
          clone_of: string | null
          created_at: string
          description: string | null
          id: string
          notes_typical: string | null
          org_id: string | null
        }
        Insert: {
          active?: boolean | null
          brand: string
          category?: string
          clone_of?: string | null
          created_at?: string
          description?: string | null
          id?: string
          notes_typical?: string | null
          org_id?: string | null
        }
        Update: {
          active?: boolean | null
          brand?: string
          category?: string
          clone_of?: string | null
          created_at?: string
          description?: string | null
          id?: string
          notes_typical?: string | null
          org_id?: string | null
        }
        Relationships: []
      }
      cash_entries: {
        Row: {
          amount_ars: number
          created_at: string
          created_by: string | null
          description: string | null
          entry_type: string
          id: string
          org_id: string
          payment_method: string | null
          reference_id: string | null
          reference_type: string | null
          session_id: string | null
        }
        Insert: {
          amount_ars?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          entry_type: string
          id?: string
          org_id: string
          payment_method?: string | null
          reference_id?: string | null
          reference_type?: string | null
          session_id?: string | null
        }
        Update: {
          amount_ars?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          entry_type?: string
          id?: string
          org_id?: string
          payment_method?: string | null
          reference_id?: string | null
          reference_type?: string | null
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_entries_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_entries_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "cash_session_summary"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "cash_entries_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_sessions: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          closing_amount: number | null
          difference: number | null
          expected_cash: number | null
          id: string
          notes: string | null
          opened_at: string
          opened_by: string | null
          opening_amount: number
          org_id: string
          status: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          closing_amount?: number | null
          difference?: number | null
          expected_cash?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          opening_amount?: number
          org_id: string
          status?: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          closing_amount?: number | null
          difference?: number | null
          expected_cash?: number | null
          id?: string
          notes?: string | null
          opened_at?: string
          opened_by?: string | null
          opening_amount?: number
          org_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_sessions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_banners: {
        Row: {
          active: boolean | null
          background_color: string | null
          created_at: string
          expires_at: string | null
          id: string
          image_url: string | null
          link_url: string | null
          org_id: string
          sort_order: number | null
          starts_at: string | null
          subtitle: string | null
          text_color: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean | null
          background_color?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          image_url?: string | null
          link_url?: string | null
          org_id: string
          sort_order?: number | null
          starts_at?: string | null
          subtitle?: string | null
          text_color?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean | null
          background_color?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          image_url?: string | null
          link_url?: string | null
          org_id?: string
          sort_order?: number | null
          starts_at?: string | null
          subtitle?: string | null
          text_color?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      cheques: {
        Row: {
          amount_ars: number
          bank_name: string | null
          check_number: string | null
          created_at: string
          customer_name: string | null
          deposited_at: string | null
          due_date: string
          id: string
          issue_date: string | null
          notes: string | null
          org_id: string
          status: string
          type: string
        }
        Insert: {
          amount_ars: number
          bank_name?: string | null
          check_number?: string | null
          created_at?: string
          customer_name?: string | null
          deposited_at?: string | null
          due_date: string
          id?: string
          issue_date?: string | null
          notes?: string | null
          org_id: string
          status?: string
          type?: string
        }
        Update: {
          amount_ars?: number
          bank_name?: string | null
          check_number?: string | null
          created_at?: string
          customer_name?: string | null
          deposited_at?: string | null
          due_date?: string
          id?: string
          issue_date?: string | null
          notes?: string | null
          org_id?: string
          status?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "cheques_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          active: boolean
          code: string
          created_at: string
          current_uses: number
          discount_fixed_ars: number | null
          discount_percent: number | null
          id: string
          influencer_id: string | null
          max_uses: number | null
          org_id: string
          user_id: string
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          current_uses?: number
          discount_fixed_ars?: number | null
          discount_percent?: number | null
          id?: string
          influencer_id?: string | null
          max_uses?: number | null
          org_id: string
          user_id: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          current_uses?: number
          discount_fixed_ars?: number | null
          discount_percent?: number | null
          id?: string
          influencer_id?: string | null
          max_uses?: number | null
          org_id?: string
          user_id?: string
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coupons_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_communications: {
        Row: {
          created_at: string | null
          customer_name: string
          id: string
          org_id: string
          summary: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          customer_name: string
          id?: string
          org_id: string
          summary: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          customer_name?: string
          id?: string
          org_id?: string
          summary?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_communications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_notes: {
        Row: {
          created_at: string
          customer_name: string
          id: string
          notes: string | null
          org_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          customer_name: string
          id?: string
          notes?: string | null
          org_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          customer_name?: string
          id?: string
          notes?: string | null
          org_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_notes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_payments: {
        Row: {
          amount_ars: number
          created_by: string | null
          customer_name: string
          debt_id: string
          id: string
          note: string | null
          org_id: string
          paid_at: string
          payment_method: string
          sale_id: string | null
        }
        Insert: {
          amount_ars?: number
          created_by?: string | null
          customer_name: string
          debt_id: string
          id?: string
          note?: string | null
          org_id: string
          paid_at?: string
          payment_method?: string
          sale_id?: string | null
        }
        Update: {
          amount_ars?: number
          created_by?: string | null
          customer_name?: string
          debt_id?: string
          id?: string
          note?: string | null
          org_id?: string
          paid_at?: string
          payment_method?: string
          sale_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_payments_debt_id_fkey"
            columns: ["debt_id"]
            isOneToOne: false
            referencedRelation: "debts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_payments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_payments_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_referrals: {
        Row: {
          bonus_ars: number | null
          bonus_points: number | null
          created_at: string
          id: string
          org_id: string
          referral_code: string
          referred_name: string
          referrer_name: string
          sale_id: string | null
          status: string
        }
        Insert: {
          bonus_ars?: number | null
          bonus_points?: number | null
          created_at?: string
          id?: string
          org_id: string
          referral_code: string
          referred_name: string
          referrer_name: string
          sale_id?: string | null
          status?: string
        }
        Update: {
          bonus_ars?: number | null
          bonus_points?: number | null
          created_at?: string
          id?: string
          org_id?: string
          referral_code?: string
          referred_name?: string
          referrer_name?: string
          sale_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_referrals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_referrals_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          birthday: string | null
          buys_vapers: boolean
          created_at: string
          email: string | null
          id: string
          instagram_handle: string | null
          name: string
          notes: string | null
          org_id: string
          phone: string | null
          scent_preferences: string[]
          tags: string[] | null
          updated_at: string
          user_id: string
          whatsapp_number: string | null
        }
        Insert: {
          address?: string | null
          birthday?: string | null
          buys_vapers?: boolean
          created_at?: string
          email?: string | null
          id?: string
          instagram_handle?: string | null
          name: string
          notes?: string | null
          org_id: string
          phone?: string | null
          scent_preferences?: string[]
          tags?: string[] | null
          updated_at?: string
          user_id: string
          whatsapp_number?: string | null
        }
        Update: {
          address?: string | null
          birthday?: string | null
          buys_vapers?: boolean
          created_at?: string
          email?: string | null
          id?: string
          instagram_handle?: string | null
          name?: string
          notes?: string | null
          org_id?: string
          phone?: string | null
          scent_preferences?: string[]
          tags?: string[] | null
          updated_at?: string
          user_id?: string
          whatsapp_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_outcomes: {
        Row: {
          closed_at: string
          competitor: string | null
          created_at: string
          currency: string | null
          customer_name: string | null
          days_in_pipeline: number | null
          deal_id: string | null
          deal_title: string
          deal_value: number | null
          id: string
          org_id: string
          outcome: string
          reason: string
          reason_detail: string | null
          seller_name: string | null
          stage_at_close: string | null
        }
        Insert: {
          closed_at?: string
          competitor?: string | null
          created_at?: string
          currency?: string | null
          customer_name?: string | null
          days_in_pipeline?: number | null
          deal_id?: string | null
          deal_title: string
          deal_value?: number | null
          id?: string
          org_id: string
          outcome: string
          reason: string
          reason_detail?: string | null
          seller_name?: string | null
          stage_at_close?: string | null
        }
        Update: {
          closed_at?: string
          competitor?: string | null
          created_at?: string
          currency?: string | null
          customer_name?: string | null
          days_in_pipeline?: number | null
          deal_id?: string | null
          deal_title?: string
          deal_value?: number | null
          id?: string
          org_id?: string
          outcome?: string
          reason?: string
          reason_detail?: string | null
          seller_name?: string | null
          stage_at_close?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_outcomes_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_outcomes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          created_at: string | null
          customer_name: string | null
          expected_close: string | null
          id: string
          notes: string | null
          org_id: string
          stage: string
          title: string
          updated_at: string | null
          user_id: string
          value_ars: number | null
        }
        Insert: {
          created_at?: string | null
          customer_name?: string | null
          expected_close?: string | null
          id?: string
          notes?: string | null
          org_id: string
          stage?: string
          title: string
          updated_at?: string | null
          user_id: string
          value_ars?: number | null
        }
        Update: {
          created_at?: string | null
          customer_name?: string | null
          expected_close?: string | null
          id?: string
          notes?: string | null
          org_id?: string
          stage?: string
          title?: string
          updated_at?: string | null
          user_id?: string
          value_ars?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "deals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      debts: {
        Row: {
          amount_ars: number
          created_at: string
          customer_name: string
          date: string
          description: string | null
          due_date: string | null
          id: string
          org_id: string
          paid_ars: number
          remaining_ars: number
          sale_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_ars?: number
          created_at?: string
          customer_name: string
          date?: string
          description?: string | null
          due_date?: string | null
          id?: string
          org_id: string
          paid_ars?: number
          remaining_ars?: number
          sale_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_ars?: number
          created_at?: string
          customer_name?: string
          date?: string
          description?: string | null
          due_date?: string | null
          id?: string
          org_id?: string
          paid_ars?: number
          remaining_ars?: number
          sale_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "debts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "debts_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaigns: {
        Row: {
          body_html: string
          click_count: number
          created_at: string
          failed_count: number
          id: string
          open_count: number
          org_id: string
          scheduled_at: string | null
          segment: string
          sent_at: string | null
          sent_count: number
          status: string
          subject: string
          unsubscribe_count: number
        }
        Insert: {
          body_html: string
          click_count?: number
          created_at?: string
          failed_count?: number
          id?: string
          open_count?: number
          org_id: string
          scheduled_at?: string | null
          segment?: string
          sent_at?: string | null
          sent_count?: number
          status?: string
          subject: string
          unsubscribe_count?: number
        }
        Update: {
          body_html?: string
          click_count?: number
          created_at?: string
          failed_count?: number
          id?: string
          open_count?: number
          org_id?: string
          scheduled_at?: string | null
          segment?: string
          sent_at?: string | null
          sent_count?: number
          status?: string
          subject?: string
          unsubscribe_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "email_campaigns_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_events: {
        Row: {
          campaign_id: string | null
          event_type: string
          id: string
          link_url: string | null
          occurred_at: string
          org_id: string
          recipient_email: string | null
          resend_email_id: string | null
        }
        Insert: {
          campaign_id?: string | null
          event_type: string
          id?: string
          link_url?: string | null
          occurred_at?: string
          org_id: string
          recipient_email?: string | null
          resend_email_id?: string | null
        }
        Update: {
          campaign_id?: string | null
          event_type?: string
          id?: string
          link_url?: string | null
          occurred_at?: string
          org_id?: string
          recipient_email?: string | null
          resend_email_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_unsubscribes: {
        Row: {
          email: string
          id: string
          org_id: string
          unsubscribed_at: string
        }
        Insert: {
          email: string
          id?: string
          org_id: string
          unsubscribed_at?: string
        }
        Update: {
          email?: string
          id?: string
          org_id?: string
          unsubscribed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_unsubscribes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_configs: {
        Row: {
          active: boolean | null
          code: string
          color_class: string | null
          created_at: string
          id: string
          kind: string
          label: string
          org_id: string | null
          sort_order: number | null
        }
        Insert: {
          active?: boolean | null
          code: string
          color_class?: string | null
          created_at?: string
          id?: string
          kind: string
          label: string
          org_id?: string | null
          sort_order?: number | null
        }
        Update: {
          active?: boolean | null
          code?: string
          color_class?: string | null
          created_at?: string
          id?: string
          kind?: string
          label?: string
          org_id?: string | null
          sort_order?: number | null
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount_ars: number
          category: string
          created_at: string
          date: string
          description: string | null
          id: string
          last_auto_created_at: string | null
          org_id: string
          receipt_url: string | null
          recurring: boolean
          recurring_frequency: string | null
          recurring_next_date: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_ars?: number
          category?: string
          created_at?: string
          date?: string
          description?: string | null
          id?: string
          last_auto_created_at?: string | null
          org_id: string
          receipt_url?: string | null
          recurring?: boolean
          recurring_frequency?: string | null
          recurring_next_date?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_ars?: number
          category?: string
          created_at?: string
          date?: string
          description?: string | null
          id?: string
          last_auto_created_at?: string | null
          org_id?: string
          receipt_url?: string | null
          recurring?: boolean
          recurring_frequency?: string | null
          recurring_next_date?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_movements: {
        Row: {
          affects_bank: boolean
          affects_cash: boolean
          amount_ars: number
          cash_session_id: string | null
          channel: string
          counterparty: string | null
          created_at: string
          created_by: string | null
          description: string
          direction: string
          happened_at: string
          id: string
          metadata: Json
          org_id: string
          payment_method: string
          source_id: string | null
          source_type: string
        }
        Insert: {
          affects_bank?: boolean
          affects_cash?: boolean
          amount_ars?: number
          cash_session_id?: string | null
          channel: string
          counterparty?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          direction: string
          happened_at?: string
          id?: string
          metadata?: Json
          org_id: string
          payment_method: string
          source_id?: string | null
          source_type: string
        }
        Update: {
          affects_bank?: boolean
          affects_cash?: boolean
          amount_ars?: number
          cash_session_id?: string | null
          channel?: string
          counterparty?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          direction?: string
          happened_at?: string
          id?: string
          metadata?: Json
          org_id?: string
          payment_method?: string
          source_id?: string | null
          source_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_movements_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_session_summary"
            referencedColumns: ["session_id"]
          },
          {
            foreignKeyName: "financial_movements_cash_session_id_fkey"
            columns: ["cash_session_id"]
            isOneToOne: false
            referencedRelation: "cash_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_movements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      industry_presets: {
        Row: {
          active: boolean | null
          ai_tone: string | null
          code: string
          default_color: string | null
          default_secondary_color: string | null
          default_settings: Json | null
          id: string
          name: string
          sort_order: number | null
        }
        Insert: {
          active?: boolean | null
          ai_tone?: string | null
          code: string
          default_color?: string | null
          default_secondary_color?: string | null
          default_settings?: Json | null
          id?: string
          name: string
          sort_order?: number | null
        }
        Update: {
          active?: boolean | null
          ai_tone?: string | null
          code?: string
          default_color?: string | null
          default_secondary_color?: string | null
          default_settings?: Json | null
          id?: string
          name?: string
          sort_order?: number | null
        }
        Relationships: []
      }
      influencer_exchanges: {
        Row: {
          actual_posts: number | null
          created_at: string | null
          delivery_date: string | null
          discount_code: string | null
          exchange_type: string
          expected_posts: number | null
          goal_notes: string | null
          id: string
          influencer_followers: number | null
          influencer_id: string | null
          influencer_instagram: string | null
          influencer_name: string
          notes: string | null
          org_id: string
          product_id: string | null
          product_name: string
          product_value_ars: number
          quantity: number
          sales_generated_ars: number | null
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          actual_posts?: number | null
          created_at?: string | null
          delivery_date?: string | null
          discount_code?: string | null
          exchange_type?: string
          expected_posts?: number | null
          goal_notes?: string | null
          id?: string
          influencer_followers?: number | null
          influencer_id?: string | null
          influencer_instagram?: string | null
          influencer_name: string
          notes?: string | null
          org_id: string
          product_id?: string | null
          product_name: string
          product_value_ars?: number
          quantity?: number
          sales_generated_ars?: number | null
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          actual_posts?: number | null
          created_at?: string | null
          delivery_date?: string | null
          discount_code?: string | null
          exchange_type?: string
          expected_posts?: number | null
          goal_notes?: string | null
          id?: string
          influencer_followers?: number | null
          influencer_id?: string | null
          influencer_instagram?: string | null
          influencer_name?: string
          notes?: string | null
          org_id?: string
          product_id?: string | null
          product_name?: string
          product_value_ars?: number
          quantity?: number
          sales_generated_ars?: number | null
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "influencer_exchanges_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      influencer_payouts: {
        Row: {
          amount_ars: number
          created_at: string
          created_by: string
          id: string
          influencer_id: string
          notes: string | null
          org_id: string
          paid_at: string
          payment_method: string | null
          period_end: string | null
          period_start: string | null
          sales_count: number | null
        }
        Insert: {
          amount_ars?: number
          created_at?: string
          created_by: string
          id?: string
          influencer_id: string
          notes?: string | null
          org_id: string
          paid_at?: string
          payment_method?: string | null
          period_end?: string | null
          period_start?: string | null
          sales_count?: number | null
        }
        Update: {
          amount_ars?: number
          created_at?: string
          created_by?: string
          id?: string
          influencer_id?: string
          notes?: string | null
          org_id?: string
          paid_at?: string
          payment_method?: string | null
          period_end?: string | null
          period_start?: string | null
          sales_count?: number | null
        }
        Relationships: []
      }
      influencer_sales: {
        Row: {
          commission_ars: number
          created_at: string
          id: string
          influencer_id: string
          org_id: string
          paid: boolean
          paid_at: string | null
          payout_id: string | null
          referral_code: string
          sale_id: string
          sale_total_ars: number
        }
        Insert: {
          commission_ars?: number
          created_at?: string
          id?: string
          influencer_id: string
          org_id: string
          paid?: boolean
          paid_at?: string | null
          payout_id?: string | null
          referral_code: string
          sale_id: string
          sale_total_ars?: number
        }
        Update: {
          commission_ars?: number
          created_at?: string
          id?: string
          influencer_id?: string
          org_id?: string
          paid?: boolean
          paid_at?: string | null
          payout_id?: string | null
          referral_code?: string
          sale_id?: string
          sale_total_ars?: number
        }
        Relationships: []
      }
      influencers: {
        Row: {
          avatar_url: string | null
          commission_fixed_ars: number | null
          commission_percent: number | null
          commission_type: string | null
          created_at: string
          email: string | null
          engagement_rate: number | null
          followers_ig: number | null
          followers_tiktok: number | null
          id: string
          instagram: string | null
          name: string
          notes: string | null
          org_id: string
          phone: string | null
          referral_code: string
          status: string | null
          tier: string | null
          tiktok: string | null
          total_commissions_ars: number | null
          total_generated_ars: number | null
          total_sales_count: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          commission_fixed_ars?: number | null
          commission_percent?: number | null
          commission_type?: string | null
          created_at?: string
          email?: string | null
          engagement_rate?: number | null
          followers_ig?: number | null
          followers_tiktok?: number | null
          id?: string
          instagram?: string | null
          name: string
          notes?: string | null
          org_id: string
          phone?: string | null
          referral_code: string
          status?: string | null
          tier?: string | null
          tiktok?: string | null
          total_commissions_ars?: number | null
          total_generated_ars?: number | null
          total_sales_count?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          commission_fixed_ars?: number | null
          commission_percent?: number | null
          commission_type?: string | null
          created_at?: string
          email?: string | null
          engagement_rate?: number | null
          followers_ig?: number | null
          followers_tiktok?: number | null
          id?: string
          instagram?: string | null
          name?: string
          notes?: string | null
          org_id?: string
          phone?: string | null
          referral_code?: string
          status?: string | null
          tier?: string | null
          tiktok?: string | null
          total_commissions_ars?: number | null
          total_generated_ars?: number | null
          total_sales_count?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      installment_schedule: {
        Row: {
          amount_ars: number
          created_at: string
          due_date: string
          id: string
          installment_number: number
          org_id: string
          paid: boolean
          paid_at: string | null
          sale_id: string
        }
        Insert: {
          amount_ars: number
          created_at?: string
          due_date: string
          id?: string
          installment_number: number
          org_id: string
          paid?: boolean
          paid_at?: string | null
          sale_id: string
        }
        Update: {
          amount_ars?: number
          created_at?: string
          due_date?: string
          id?: string
          installment_number?: number
          org_id?: string
          paid?: boolean
          paid_at?: string | null
          sale_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "installment_schedule_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_schedule_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_logs: {
        Row: {
          created_at: string
          duration_ms: number | null
          event: string
          id: string
          integration: string
          message: string | null
          metadata: Json | null
          org_id: string
          status: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          event: string
          id?: string
          integration: string
          message?: string | null
          metadata?: Json | null
          org_id: string
          status?: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          event?: string
          id?: string
          integration?: string
          message?: string | null
          metadata?: Json | null
          org_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          description: string
          id: string
          invoice_id: string
          quantity: number
          total: number
          unit_price: number
        }
        Insert: {
          description: string
          id?: string
          invoice_id: string
          quantity?: number
          total?: number
          unit_price?: number
        }
        Update: {
          description?: string
          id?: string
          invoice_id?: string
          quantity?: number
          total?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_sequences: {
        Row: {
          last_number: number
          org_id: string
        }
        Insert: {
          last_number?: number
          org_id: string
        }
        Update: {
          last_number?: number
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_sequences_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          afip_environment: string | null
          afip_error: string | null
          afip_status: string | null
          cae: string | null
          cae_vencimiento: string | null
          created_at: string
          created_by: string | null
          currency: string
          customer_address: string | null
          customer_email: string | null
          customer_name: string
          customer_tax_id: string | null
          due_date: string | null
          id: string
          issue_date: string
          notes: string | null
          number: string
          numero_afip: number | null
          org_id: string
          paid_at: string | null
          sale_id: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          tax_amount: number
          tax_pct: number
          tipo_comprobante: number | null
          total: number
          updated_at: string
        }
        Insert: {
          afip_environment?: string | null
          afip_error?: string | null
          afip_status?: string | null
          cae?: string | null
          cae_vencimiento?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_address?: string | null
          customer_email?: string | null
          customer_name: string
          customer_tax_id?: string | null
          due_date?: string | null
          id?: string
          issue_date?: string
          notes?: string | null
          number: string
          numero_afip?: number | null
          org_id: string
          paid_at?: string | null
          sale_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tax_amount?: number
          tax_pct?: number
          tipo_comprobante?: number | null
          total?: number
          updated_at?: string
        }
        Update: {
          afip_environment?: string | null
          afip_error?: string | null
          afip_status?: string | null
          cae?: string | null
          cae_vencimiento?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_address?: string | null
          customer_email?: string | null
          customer_name?: string
          customer_tax_id?: string | null
          due_date?: string | null
          id?: string
          issue_date?: string
          notes?: string | null
          number?: string
          numero_afip?: number | null
          org_id?: string
          paid_at?: string | null
          sale_id?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          tax_amount?: number
          tax_pct?: number
          tipo_comprobante?: number | null
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      location_stock: {
        Row: {
          id: string
          location_id: string
          org_id: string
          product_id: string
          stock: number
          updated_at: string
        }
        Insert: {
          id?: string
          location_id: string
          org_id: string
          product_id: string
          stock?: number
          updated_at?: string
        }
        Update: {
          id?: string
          location_id?: string
          org_id?: string
          product_id?: string
          stock?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "location_stock_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_stock_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "location_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          active: boolean
          address: string | null
          created_at: string
          id: string
          is_main: boolean
          name: string
          org_id: string
          phone: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          created_at?: string
          id?: string
          is_main?: boolean
          name: string
          org_id: string
          phone?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          created_at?: string
          id?: string
          is_main?: boolean
          name?: string
          org_id?: string
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "locations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      loyalty_points: {
        Row: {
          created_at: string | null
          customer_name: string
          delta: number
          id: string
          org_id: string
          reason: string | null
          reference_id: string | null
        }
        Insert: {
          created_at?: string | null
          customer_name: string
          delta: number
          id?: string
          org_id: string
          reason?: string | null
          reference_id?: string | null
        }
        Update: {
          created_at?: string | null
          customer_name?: string
          delta?: number
          id?: string
          org_id?: string
          reason?: string | null
          reference_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_points_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_post_types: {
        Row: {
          active: boolean | null
          code: string
          created_at: string
          emoji: string | null
          id: string
          label: string
          org_id: string | null
          sort_order: number | null
        }
        Insert: {
          active?: boolean | null
          code: string
          created_at?: string
          emoji?: string | null
          id?: string
          label: string
          org_id?: string | null
          sort_order?: number | null
        }
        Update: {
          active?: boolean | null
          code?: string
          created_at?: string
          emoji?: string | null
          id?: string
          label?: string
          org_id?: string | null
          sort_order?: number | null
        }
        Relationships: []
      }
      marketing_posts: {
        Row: {
          ai_generated: boolean
          content: string | null
          created_at: string
          hashtags: string[] | null
          id: string
          image_url: string | null
          org_id: string
          platform: string
          post_type: string
          product_ids: string[] | null
          scheduled_at: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_generated?: boolean
          content?: string | null
          created_at?: string
          hashtags?: string[] | null
          id?: string
          image_url?: string | null
          org_id: string
          platform?: string
          post_type?: string
          product_ids?: string[] | null
          scheduled_at?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_generated?: boolean
          content?: string | null
          created_at?: string
          hashtags?: string[] | null
          id?: string
          image_url?: string | null
          org_id?: string
          platform?: string
          post_type?: string
          product_ids?: string[] | null
          scheduled_at?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_posts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_templates: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          id: string
          industry: string | null
          is_public: boolean
          likes: number
          org_id: string | null
          post_type: string
          tags: string[] | null
          title: string
          uses_count: number
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          industry?: string | null
          is_public?: boolean
          likes?: number
          org_id?: string | null
          post_type?: string
          tags?: string[] | null
          title: string
          uses_count?: number
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          industry?: string | null
          is_public?: boolean
          likes?: number
          org_id?: string | null
          post_type?: string
          tags?: string[] | null
          title?: string
          uses_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "marketing_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_themes: {
        Row: {
          active: boolean | null
          created_at: string
          id: string
          industry_code: string | null
          label: string
          org_id: string | null
          sort_order: number | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string
          id?: string
          industry_code?: string | null
          label: string
          org_id?: string | null
          sort_order?: number | null
        }
        Update: {
          active?: boolean | null
          created_at?: string
          id?: string
          industry_code?: string | null
          label?: string
          org_id?: string | null
          sort_order?: number | null
        }
        Relationships: []
      }
      memberships: {
        Row: {
          commission_enabled: boolean | null
          commission_percent: number | null
          created_at: string
          id: string
          invited_by: string | null
          joined_at: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          commission_enabled?: boolean | null
          commission_percent?: number | null
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          commission_enabled?: boolean | null
          commission_percent?: number | null
          created_at?: string
          id?: string
          invited_by?: string | null
          joined_at?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          message: string
          org_id: string
          read: boolean
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          message: string
          org_id: string
          read?: boolean
          title: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          message?: string
          org_id?: string
          read?: boolean
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_api_keys: {
        Row: {
          created_at: string
          id: string
          key_hash: string
          label: string | null
          last_used_at: string | null
          org_id: string
          revoked: boolean
          revoked_at: string | null
          use_count: number
        }
        Insert: {
          created_at?: string
          id?: string
          key_hash: string
          label?: string | null
          last_used_at?: string | null
          org_id: string
          revoked?: boolean
          revoked_at?: string | null
          use_count?: number
        }
        Update: {
          created_at?: string
          id?: string
          key_hash?: string
          label?: string | null
          last_used_at?: string | null
          org_id?: string
          revoked?: boolean
          revoked_at?: string | null
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "org_api_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_invitations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          logo_url: string | null
          name: string
          onboarding_completed: boolean
          owner_user_id: string
          plan_id: string | null
          primary_color: string | null
          secondary_color: string | null
          slug: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          onboarding_completed?: boolean
          owner_user_id: string
          plan_id?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          slug: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          onboarding_completed?: boolean
          owner_user_id?: string
          plan_id?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          slug?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organizations_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_links: {
        Row: {
          created_at: string
          customer_name: string
          customer_phone: string | null
          expires_at: string | null
          external_ref: string | null
          id: string
          items: Json
          mp_link: string | null
          mp_payment_id: string | null
          notes: string | null
          org_id: string
          paid_at: string | null
          quote_id: string | null
          quote_number: string | null
          status: string
          total_ars: number
        }
        Insert: {
          created_at?: string
          customer_name: string
          customer_phone?: string | null
          expires_at?: string | null
          external_ref?: string | null
          id?: string
          items?: Json
          mp_link?: string | null
          mp_payment_id?: string | null
          notes?: string | null
          org_id: string
          paid_at?: string | null
          quote_id?: string | null
          quote_number?: string | null
          status?: string
          total_ars: number
        }
        Update: {
          created_at?: string
          customer_name?: string
          customer_phone?: string | null
          expires_at?: string | null
          external_ref?: string | null
          id?: string
          items?: Json
          mp_link?: string | null
          mp_payment_id?: string | null
          notes?: string | null
          org_id?: string
          paid_at?: string | null
          quote_id?: string | null
          quote_number?: string | null
          status?: string
          total_ars?: number
        }
        Relationships: [
          {
            foreignKeyName: "payment_links_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_links_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          active: boolean
          ai_enabled: boolean
          backups_enabled: boolean
          code: string
          created_at: string
          custom_branding: boolean
          description: string | null
          id: string
          max_products: number | null
          max_sales_per_month: number | null
          max_users: number | null
          name: string
          price_usd_monthly: number
          price_usd_yearly: number
          sort_order: number
          stripe_price_id_monthly: string | null
          stripe_price_id_yearly: string | null
        }
        Insert: {
          active?: boolean
          ai_enabled?: boolean
          backups_enabled?: boolean
          code: string
          created_at?: string
          custom_branding?: boolean
          description?: string | null
          id?: string
          max_products?: number | null
          max_sales_per_month?: number | null
          max_users?: number | null
          name: string
          price_usd_monthly?: number
          price_usd_yearly?: number
          sort_order?: number
          stripe_price_id_monthly?: string | null
          stripe_price_id_yearly?: string | null
        }
        Update: {
          active?: boolean
          ai_enabled?: boolean
          backups_enabled?: boolean
          code?: string
          created_at?: string
          custom_branding?: boolean
          description?: string | null
          id?: string
          max_products?: number | null
          max_sales_per_month?: number | null
          max_users?: number | null
          name?: string
          price_usd_monthly?: number
          price_usd_yearly?: number
          sort_order?: number
          stripe_price_id_monthly?: string | null
          stripe_price_id_yearly?: string | null
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          granted_at: string
          granted_by: string | null
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      price_history: {
        Row: {
          change_pct: number | null
          changed_by: string | null
          created_at: string
          id: string
          new_cost_usd: number | null
          new_price_ars: number
          old_cost_usd: number | null
          old_price_ars: number | null
          org_id: string
          product_id: string
        }
        Insert: {
          change_pct?: number | null
          changed_by?: string | null
          created_at?: string
          id?: string
          new_cost_usd?: number | null
          new_price_ars: number
          old_cost_usd?: number | null
          old_price_ars?: number | null
          org_id: string
          product_id: string
        }
        Update: {
          change_pct?: number | null
          changed_by?: string | null
          created_at?: string
          id?: string
          new_cost_usd?: number | null
          new_price_ars?: number
          old_cost_usd?: number | null
          old_price_ars?: number | null
          org_id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_history_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      product_combos: {
        Row: {
          active: boolean
          combo_price_ars: number
          created_at: string
          description: string | null
          expires_at: string | null
          id: string
          name: string
          org_id: string
          original_price_ars: number
          product_ids: string[]
          savings_ars: number
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          combo_price_ars?: number
          created_at?: string
          description?: string | null
          expires_at?: string | null
          id?: string
          name: string
          org_id: string
          original_price_ars?: number
          product_ids?: string[]
          savings_ars?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          combo_price_ars?: number
          created_at?: string
          description?: string | null
          expires_at?: string | null
          id?: string
          name?: string
          org_id?: string
          original_price_ars?: number
          product_ids?: string[]
          savings_ars?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      product_perfume_details: {
        Row: {
          created_at: string
          duracion: string | null
          edad_recomendada: string | null
          estacion: string[]
          familia_olfativa: string | null
          id: string
          inspiracion: string | null
          modelo: string | null
          notas_corazon: string[]
          notas_fondo: string[]
          notas_salida: string[]
          ocasion: string[]
          org_id: string
          product_id: string
          proyeccion: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          duracion?: string | null
          edad_recomendada?: string | null
          estacion?: string[]
          familia_olfativa?: string | null
          id?: string
          inspiracion?: string | null
          modelo?: string | null
          notas_corazon?: string[]
          notas_fondo?: string[]
          notas_salida?: string[]
          ocasion?: string[]
          org_id: string
          product_id: string
          proyeccion?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          duracion?: string | null
          edad_recomendada?: string | null
          estacion?: string[]
          familia_olfativa?: string | null
          id?: string
          inspiracion?: string | null
          modelo?: string | null
          notas_corazon?: string[]
          notas_fondo?: string[]
          notas_salida?: string[]
          ocasion?: string[]
          org_id?: string
          product_id?: string
          proyeccion?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_perfume_details_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_perfume_details_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_perfume_details_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          active: boolean
          created_at: string
          id: string
          image_url: string | null
          org_id: string
          price_override: number | null
          product_id: string
          sku: string | null
          stock: number
          user_id: string
          variant_name: string
          variant_type: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          image_url?: string | null
          org_id: string
          price_override?: number | null
          product_id: string
          sku?: string | null
          stock?: number
          user_id: string
          variant_name: string
          variant_type?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          image_url?: string | null
          org_id?: string
          price_override?: number | null
          product_id?: string
          sku?: string | null
          stock?: number
          user_id?: string
          variant_name?: string
          variant_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          brand: string
          category: string
          content_ml: number | null
          cost_usd: number
          created_at: string
          customs_fee: number
          description: string | null
          discount_price_ars: number | null
          expected_restock_at: string | null
          expiry_date: string | null
          featured: boolean | null
          gender: string
          id: string
          image_url: string | null
          image_urls: string[] | null
          is_active: boolean
          lot_number: string | null
          low_stock_threshold: number | null
          name: string
          offer_expires_at: string | null
          org_id: string
          price_2x_ars: number | null
          profit_per_unit_ars: number
          profit_per_unit_usd: number
          sale_price_ars: number
          sku: string | null
          stock: number
          tags: string[] | null
          tiendanube_id: string | null
          tiendanube_product_id: string | null
          total_cost_usd: number
          total_sold: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          barcode?: string | null
          brand?: string
          category?: string
          content_ml?: number | null
          cost_usd?: number
          created_at?: string
          customs_fee?: number
          description?: string | null
          discount_price_ars?: number | null
          expected_restock_at?: string | null
          expiry_date?: string | null
          featured?: boolean | null
          gender?: string
          id?: string
          image_url?: string | null
          image_urls?: string[] | null
          is_active?: boolean
          lot_number?: string | null
          low_stock_threshold?: number | null
          name: string
          offer_expires_at?: string | null
          org_id: string
          price_2x_ars?: number | null
          profit_per_unit_ars?: number
          profit_per_unit_usd?: number
          sale_price_ars?: number
          sku?: string | null
          stock?: number
          tags?: string[] | null
          tiendanube_id?: string | null
          tiendanube_product_id?: string | null
          total_cost_usd?: number
          total_sold?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          barcode?: string | null
          brand?: string
          category?: string
          content_ml?: number | null
          cost_usd?: number
          created_at?: string
          customs_fee?: number
          description?: string | null
          discount_price_ars?: number | null
          expected_restock_at?: string | null
          expiry_date?: string | null
          featured?: boolean | null
          gender?: string
          id?: string
          image_url?: string | null
          image_urls?: string[] | null
          is_active?: boolean
          lot_number?: string | null
          low_stock_threshold?: number | null
          name?: string
          offer_expires_at?: string | null
          org_id?: string
          price_2x_ars?: number | null
          profit_per_unit_ars?: number
          profit_per_unit_usd?: number
          sale_price_ars?: number
          sku?: string | null
          stock?: number
          tags?: string[] | null
          tiendanube_id?: string | null
          tiendanube_product_id?: string | null
          total_cost_usd?: number
          total_sold?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      purchases: {
        Row: {
          batch_name: string | null
          created_at: string
          customs_fee: number
          date: string
          exchange_rate: number
          id: string
          is_scheduled: boolean
          org_id: string
          product_id: string | null
          product_name: string
          quantity: number
          scheduled_date: string | null
          supplier: string | null
          supplier_id: string | null
          total_ars: number
          total_usd: number
          travel_status: string
          unit_cost_usd: number
          user_id: string
        }
        Insert: {
          batch_name?: string | null
          created_at?: string
          customs_fee?: number
          date?: string
          exchange_rate?: number
          id?: string
          is_scheduled?: boolean
          org_id: string
          product_id?: string | null
          product_name: string
          quantity?: number
          scheduled_date?: string | null
          supplier?: string | null
          supplier_id?: string | null
          total_ars?: number
          total_usd?: number
          travel_status?: string
          unit_cost_usd?: number
          user_id: string
        }
        Update: {
          batch_name?: string | null
          created_at?: string
          customs_fee?: number
          date?: string
          exchange_rate?: number
          id?: string
          is_scheduled?: boolean
          org_id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          scheduled_date?: string | null
          supplier?: string | null
          supplier_id?: string | null
          total_ars?: number
          total_usd?: number
          travel_status?: string
          unit_cost_usd?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchases_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          org_id: string
          p256dh: string
          user_id: string | null
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          org_id: string
          p256dh: string
          user_id?: string | null
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          org_id?: string
          p256dh?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_sequences: {
        Row: {
          last_number: number
          org_id: string
        }
        Insert: {
          last_number?: number
          org_id: string
        }
        Update: {
          last_number?: number
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quote_sequences_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          created_at: string
          created_by: string | null
          customer_email: string | null
          customer_name: string
          customer_phone: string | null
          discount_amount: number
          id: string
          items: Json
          notes: string | null
          org_id: string
          quote_number: string
          status: string
          subtotal: number
          total: number
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_name: string
          customer_phone?: string | null
          discount_amount?: number
          id?: string
          items?: Json
          notes?: string | null
          org_id: string
          quote_number: string
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string | null
          discount_amount?: number
          id?: string
          items?: Json
          notes?: string | null
          org_id?: string
          quote_number?: string
          status?: string
          subtotal?: number
          total?: number
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      returns: {
        Row: {
          amount_ars: number
          created_at: string
          id: string
          notes: string | null
          org_id: string
          product_id: string | null
          product_name: string
          quantity: number
          reason: string | null
          refund_method: string
          sale_id: string | null
          user_id: string | null
          variant_id: string | null
        }
        Insert: {
          amount_ars?: number
          created_at?: string
          id?: string
          notes?: string | null
          org_id: string
          product_id?: string | null
          product_name: string
          quantity?: number
          reason?: string | null
          refund_method?: string
          sale_id?: string | null
          user_id?: string | null
          variant_id?: string | null
        }
        Update: {
          amount_ars?: number
          created_at?: string
          id?: string
          notes?: string | null
          org_id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          reason?: string | null
          refund_method?: string
          sale_id?: string | null
          user_id?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "returns_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "returns_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          can_create: boolean
          can_delete: boolean
          can_edit: boolean
          can_export: boolean
          can_view: boolean
          id: string
          module: string
          org_id: string
          role: string
          updated_at: string
        }
        Insert: {
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_export?: boolean
          can_view?: boolean
          id?: string
          module: string
          org_id: string
          role: string
          updated_at?: string
        }
        Update: {
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_export?: boolean
          can_view?: boolean
          id?: string
          module?: string
          org_id?: string
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          cost_per_unit_usd: number
          coupon_id: string | null
          created_at: string
          customer_name: string | null
          date: string
          discount_applied: boolean
          first_installment_date: string | null
          global_discount_ars: number | null
          id: string
          installment_amount_ars: number | null
          installments: number | null
          invoice_id: string | null
          org_id: string
          paid: boolean
          payment_method: string
          product_id: string | null
          product_name: string
          profit_ars: number
          profit_usd: number
          quantity: number
          quote_id: string | null
          referral_code: string | null
          return_id: string | null
          returned: boolean
          returned_quantity: number
          seller_name: string | null
          source: string
          split_payments: Json | null
          tiendanube_order_id: string | null
          total_ars: number
          unit_price_ars: number
          user_id: string
          variant_id: string | null
        }
        Insert: {
          cost_per_unit_usd?: number
          coupon_id?: string | null
          created_at?: string
          customer_name?: string | null
          date?: string
          discount_applied?: boolean
          first_installment_date?: string | null
          global_discount_ars?: number | null
          id?: string
          installment_amount_ars?: number | null
          installments?: number | null
          invoice_id?: string | null
          org_id: string
          paid?: boolean
          payment_method?: string
          product_id?: string | null
          product_name: string
          profit_ars?: number
          profit_usd?: number
          quantity?: number
          quote_id?: string | null
          referral_code?: string | null
          return_id?: string | null
          returned?: boolean
          returned_quantity?: number
          seller_name?: string | null
          source?: string
          split_payments?: Json | null
          tiendanube_order_id?: string | null
          total_ars?: number
          unit_price_ars?: number
          user_id: string
          variant_id?: string | null
        }
        Update: {
          cost_per_unit_usd?: number
          coupon_id?: string | null
          created_at?: string
          customer_name?: string | null
          date?: string
          discount_applied?: boolean
          first_installment_date?: string | null
          global_discount_ars?: number | null
          id?: string
          installment_amount_ars?: number | null
          installments?: number | null
          invoice_id?: string | null
          org_id?: string
          paid?: boolean
          payment_method?: string
          product_id?: string | null
          product_name?: string
          profit_ars?: number
          profit_usd?: number
          quantity?: number
          quote_id?: string | null
          referral_code?: string | null
          return_id?: string | null
          returned?: boolean
          returned_quantity?: number
          seller_name?: string | null
          source?: string
          split_payments?: Json | null
          tiendanube_order_id?: string | null
          total_ars?: number
          unit_price_ars?: number
          user_id?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_goals: {
        Row: {
          commission_percent: number
          created_at: string
          id: string
          month: string
          org_id: string
          owner_id: string
          target_ars: number
          total_commission_ars: number
          total_sales_ars: number
          user_id: string
        }
        Insert: {
          commission_percent?: number
          created_at?: string
          id?: string
          month: string
          org_id: string
          owner_id: string
          target_ars?: number
          total_commission_ars?: number
          total_sales_ars?: number
          user_id: string
        }
        Update: {
          commission_percent?: number
          created_at?: string
          id?: string
          month?: string
          org_id?: string
          owner_id?: string
          target_ars?: number
          total_commission_ars?: number
          total_sales_ars?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_goals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_payouts: {
        Row: {
          commission_ars: number
          commission_percent: number
          created_at: string
          id: string
          notes: string | null
          org_id: string
          paid_at: string | null
          period_end: string
          period_start: string
          sales_total_ars: number
          seller_name: string
          status: string
          user_id: string
        }
        Insert: {
          commission_ars?: number
          commission_percent?: number
          created_at?: string
          id?: string
          notes?: string | null
          org_id: string
          paid_at?: string | null
          period_end: string
          period_start: string
          sales_total_ars?: number
          seller_name: string
          status?: string
          user_id: string
        }
        Update: {
          commission_ars?: number
          commission_percent?: number
          created_at?: string
          id?: string
          notes?: string | null
          org_id?: string
          paid_at?: string | null
          period_end?: string
          period_start?: string
          sales_total_ars?: number
          seller_name?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_payouts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          afip_certificate: string | null
          afip_cuit: string | null
          afip_domicilio: string | null
          afip_environment: string | null
          afip_private_key: string | null
          afip_punto_venta: number | null
          afip_razon_social: string | null
          afip_ta_expires_at: string | null
          afip_ta_sign: string | null
          afip_ta_token: string | null
          afip_tipo_emisor: string | null
          ai_tone: string | null
          api_key: string | null
          bank_alias: string | null
          bank_cbu: string | null
          bank_holder: string | null
          bank_name: string | null
          brand_palettes: Json | null
          business_name: string | null
          cash_flow_warning_threshold_ars: number
          catalog_accent_color: string | null
          catalog_bg_color: string | null
          catalog_card_color: string | null
          category_pricing: Json
          created_at: string
          customs_percent: number
          daily_margin_alert_threshold: number | null
          daily_sales_alert_threshold: number | null
          decant_margin_10ml: number | null
          decant_margin_2_5ml: number | null
          decant_margin_5ml: number | null
          default_cta_text: string | null
          default_discount_percent: number
          discount_cash_percent: number
          discount_credit_percent: number
          discount_debit_percent: number
          discount_transfer_percent: number
          exchange_rate: number
          expense_categories: Json
          expense_ratio_alert_percent: number
          id: string
          industry_code: string | null
          initial_cash_ars: number
          large_sale_threshold_ars: number
          logo_url: string | null
          low_stock_threshold: number
          loyalty_enabled: boolean | null
          loyalty_points_per_1000: number | null
          loyalty_points_value_ars: number | null
          margin_alert_percent: number
          max_ai_discount_percent: number | null
          max_overstock_units: number | null
          monthly_targets: Json | null
          mp_access_token: string | null
          mp_enabled: boolean
          mp_webhook_secret: string | null
          org_id: string
          overdue_check_window_hours: number
          pasero_commission_percent: number
          primary_color: string | null
          receipt_footer: string | null
          referral_bonus_ars: number | null
          referral_bonus_points: number | null
          referral_enabled: boolean | null
          secondary_color: string | null
          stock_dormido_days: number | null
          tax_enabled: boolean
          tax_iibb_percent: number
          tax_iva_percent: number
          tax_monotributo_monthly: number
          updated_at: string
          usd_rate_blue: number | null
          usd_rate_mep: number | null
          usd_rate_oficial: number | null
          usd_rate_updated_at: string | null
          user_id: string
          volume_discount_percent: number | null
          volume_discount_threshold: number | null
          webhook_enabled: boolean | null
          webhook_events: string[] | null
          webhook_secret: string | null
          webhook_url: string | null
          whatsapp_number: string | null
        }
        Insert: {
          afip_certificate?: string | null
          afip_cuit?: string | null
          afip_domicilio?: string | null
          afip_environment?: string | null
          afip_private_key?: string | null
          afip_punto_venta?: number | null
          afip_razon_social?: string | null
          afip_ta_expires_at?: string | null
          afip_ta_sign?: string | null
          afip_ta_token?: string | null
          afip_tipo_emisor?: string | null
          ai_tone?: string | null
          api_key?: string | null
          bank_alias?: string | null
          bank_cbu?: string | null
          bank_holder?: string | null
          bank_name?: string | null
          brand_palettes?: Json | null
          business_name?: string | null
          cash_flow_warning_threshold_ars?: number
          catalog_accent_color?: string | null
          catalog_bg_color?: string | null
          catalog_card_color?: string | null
          category_pricing?: Json
          created_at?: string
          customs_percent?: number
          daily_margin_alert_threshold?: number | null
          daily_sales_alert_threshold?: number | null
          decant_margin_10ml?: number | null
          decant_margin_2_5ml?: number | null
          decant_margin_5ml?: number | null
          default_cta_text?: string | null
          default_discount_percent?: number
          discount_cash_percent?: number
          discount_credit_percent?: number
          discount_debit_percent?: number
          discount_transfer_percent?: number
          exchange_rate?: number
          expense_categories?: Json
          expense_ratio_alert_percent?: number
          id?: string
          industry_code?: string | null
          initial_cash_ars?: number
          large_sale_threshold_ars?: number
          logo_url?: string | null
          low_stock_threshold?: number
          loyalty_enabled?: boolean | null
          loyalty_points_per_1000?: number | null
          loyalty_points_value_ars?: number | null
          margin_alert_percent?: number
          max_ai_discount_percent?: number | null
          max_overstock_units?: number | null
          monthly_targets?: Json | null
          mp_access_token?: string | null
          mp_enabled?: boolean
          mp_webhook_secret?: string | null
          org_id: string
          overdue_check_window_hours?: number
          pasero_commission_percent?: number
          primary_color?: string | null
          receipt_footer?: string | null
          referral_bonus_ars?: number | null
          referral_bonus_points?: number | null
          referral_enabled?: boolean | null
          secondary_color?: string | null
          stock_dormido_days?: number | null
          tax_enabled?: boolean
          tax_iibb_percent?: number
          tax_iva_percent?: number
          tax_monotributo_monthly?: number
          updated_at?: string
          usd_rate_blue?: number | null
          usd_rate_mep?: number | null
          usd_rate_oficial?: number | null
          usd_rate_updated_at?: string | null
          user_id: string
          volume_discount_percent?: number | null
          volume_discount_threshold?: number | null
          webhook_enabled?: boolean | null
          webhook_events?: string[] | null
          webhook_secret?: string | null
          webhook_url?: string | null
          whatsapp_number?: string | null
        }
        Update: {
          afip_certificate?: string | null
          afip_cuit?: string | null
          afip_domicilio?: string | null
          afip_environment?: string | null
          afip_private_key?: string | null
          afip_punto_venta?: number | null
          afip_razon_social?: string | null
          afip_ta_expires_at?: string | null
          afip_ta_sign?: string | null
          afip_ta_token?: string | null
          afip_tipo_emisor?: string | null
          ai_tone?: string | null
          api_key?: string | null
          bank_alias?: string | null
          bank_cbu?: string | null
          bank_holder?: string | null
          bank_name?: string | null
          brand_palettes?: Json | null
          business_name?: string | null
          cash_flow_warning_threshold_ars?: number
          catalog_accent_color?: string | null
          catalog_bg_color?: string | null
          catalog_card_color?: string | null
          category_pricing?: Json
          created_at?: string
          customs_percent?: number
          daily_margin_alert_threshold?: number | null
          daily_sales_alert_threshold?: number | null
          decant_margin_10ml?: number | null
          decant_margin_2_5ml?: number | null
          decant_margin_5ml?: number | null
          default_cta_text?: string | null
          default_discount_percent?: number
          discount_cash_percent?: number
          discount_credit_percent?: number
          discount_debit_percent?: number
          discount_transfer_percent?: number
          exchange_rate?: number
          expense_categories?: Json
          expense_ratio_alert_percent?: number
          id?: string
          industry_code?: string | null
          initial_cash_ars?: number
          large_sale_threshold_ars?: number
          logo_url?: string | null
          low_stock_threshold?: number
          loyalty_enabled?: boolean | null
          loyalty_points_per_1000?: number | null
          loyalty_points_value_ars?: number | null
          margin_alert_percent?: number
          max_ai_discount_percent?: number | null
          max_overstock_units?: number | null
          monthly_targets?: Json | null
          mp_access_token?: string | null
          mp_enabled?: boolean
          mp_webhook_secret?: string | null
          org_id?: string
          overdue_check_window_hours?: number
          pasero_commission_percent?: number
          primary_color?: string | null
          receipt_footer?: string | null
          referral_bonus_ars?: number | null
          referral_bonus_points?: number | null
          referral_enabled?: boolean | null
          secondary_color?: string | null
          stock_dormido_days?: number | null
          tax_enabled?: boolean
          tax_iibb_percent?: number
          tax_iva_percent?: number
          tax_monotributo_monthly?: number
          updated_at?: string
          usd_rate_blue?: number | null
          usd_rate_mep?: number | null
          usd_rate_oficial?: number | null
          usd_rate_updated_at?: string | null
          user_id?: string
          volume_discount_percent?: number | null
          volume_discount_threshold?: number | null
          webhook_enabled?: boolean | null
          webhook_events?: string[] | null
          webhook_secret?: string | null
          webhook_url?: string | null
          whatsapp_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_history: {
        Row: {
          change: number
          created_at: string
          created_by: string | null
          id: string
          new_stock: number
          org_id: string
          product_id: string | null
          product_name: string
          reason: string | null
        }
        Insert: {
          change: number
          created_at?: string
          created_by?: string | null
          id?: string
          new_stock: number
          org_id: string
          product_id?: string | null
          product_name: string
          reason?: string | null
        }
        Update: {
          change?: number
          created_at?: string
          created_by?: string | null
          id?: string
          new_stock?: number
          org_id?: string
          product_id?: string | null
          product_name?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_history_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          movement_type: string
          new_stock: number | null
          note: string | null
          notes: string | null
          org_id: string
          previous_stock: number | null
          product_id: string | null
          product_name: string
          quantity: number
          reference_id: string | null
          reference_type: string | null
          source_id: string | null
          source_type: string | null
          stock_after: number
          stock_before: number
          unit_cost_usd: number | null
          unit_price_ars: number | null
          variant_id: string | null
          variant_name: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          movement_type: string
          new_stock?: number | null
          note?: string | null
          notes?: string | null
          org_id: string
          previous_stock?: number | null
          product_id?: string | null
          product_name: string
          quantity: number
          reference_id?: string | null
          reference_type?: string | null
          source_id?: string | null
          source_type?: string | null
          stock_after?: number
          stock_before?: number
          unit_cost_usd?: number | null
          unit_price_ars?: number | null
          variant_id?: string | null
          variant_name?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          movement_type?: string
          new_stock?: number | null
          note?: string | null
          notes?: string | null
          org_id?: string
          previous_stock?: number | null
          product_id?: string | null
          product_name?: string
          quantity?: number
          reference_id?: string | null
          reference_type?: string | null
          source_id?: string | null
          source_type?: string | null
          stock_after?: number
          stock_before?: number
          unit_cost_usd?: number | null
          unit_price_ars?: number | null
          variant_id?: string | null
          variant_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "product_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfers: {
        Row: {
          created_at: string
          from_location_id: string | null
          id: string
          notes: string | null
          org_id: string
          product_id: string
          product_name: string
          quantity: number
          to_location_id: string | null
          transferred_by: string | null
        }
        Insert: {
          created_at?: string
          from_location_id?: string | null
          id?: string
          notes?: string | null
          org_id: string
          product_id: string
          product_name: string
          quantity: number
          to_location_id?: string | null
          transferred_by?: string | null
        }
        Update: {
          created_at?: string
          from_location_id?: string | null
          id?: string
          notes?: string | null
          org_id?: string
          product_id?: string
          product_name?: string
          quantity?: number
          to_location_id?: string | null
          transferred_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfers_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      story_templates: {
        Row: {
          active: boolean | null
          badge_color: string | null
          badge_text: string | null
          code: string
          created_at: string
          emoji: string | null
          id: string
          is_default: boolean | null
          layout: string | null
          name: string
          org_id: string | null
          sort_order: number | null
        }
        Insert: {
          active?: boolean | null
          badge_color?: string | null
          badge_text?: string | null
          code: string
          created_at?: string
          emoji?: string | null
          id?: string
          is_default?: boolean | null
          layout?: string | null
          name: string
          org_id?: string | null
          sort_order?: number | null
        }
        Update: {
          active?: boolean | null
          badge_color?: string | null
          badge_text?: string | null
          code?: string
          created_at?: string
          emoji?: string | null
          id?: string
          is_default?: boolean | null
          layout?: string | null
          name?: string
          org_id?: string | null
          sort_order?: number | null
        }
        Relationships: []
      }
      stripe_events: {
        Row: {
          event_id: string
          processed_at: string
        }
        Insert: {
          event_id: string
          processed_at?: string
        }
        Update: {
          event_id?: string
          processed_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          org_id: string
          plan_id: string
          status: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_end: string | null
          updated_at: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          org_id: string
          plan_id: string
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          updated_at?: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          org_id?: string
          plan_id?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_debts: {
        Row: {
          amount_ars: number
          created_at: string
          description: string
          due_date: string | null
          id: string
          notes: string | null
          org_id: string
          paid_ars: number
          purchase_id: string | null
          remaining_ars: number | null
          status: string
          supplier_id: string | null
          supplier_name: string
          updated_at: string
        }
        Insert: {
          amount_ars?: number
          created_at?: string
          description: string
          due_date?: string | null
          id?: string
          notes?: string | null
          org_id: string
          paid_ars?: number
          purchase_id?: string | null
          remaining_ars?: number | null
          status?: string
          supplier_id?: string | null
          supplier_name: string
          updated_at?: string
        }
        Update: {
          amount_ars?: number
          created_at?: string
          description?: string
          due_date?: string | null
          id?: string
          notes?: string | null
          org_id?: string
          paid_ars?: number
          purchase_id?: string | null
          remaining_ars?: number | null
          status?: string
          supplier_id?: string | null
          supplier_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_debts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_debts_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_debts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_payments: {
        Row: {
          amount_ars: number
          id: string
          method: string
          note: string | null
          org_id: string
          paid_at: string
          supplier_debt_id: string
        }
        Insert: {
          amount_ars: number
          id?: string
          method?: string
          note?: string | null
          org_id: string
          paid_at?: string
          supplier_debt_id: string
        }
        Update: {
          amount_ars?: number
          id?: string
          method?: string
          note?: string | null
          org_id?: string
          paid_at?: string
          supplier_debt_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_payments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_payments_supplier_debt_id_fkey"
            columns: ["supplier_debt_id"]
            isOneToOne: false
            referencedRelation: "supplier_debts"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          active: boolean
          address: string | null
          contact: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          org_id: string
          phone: string | null
          tags: string[] | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          contact?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          org_id: string
          phone?: string | null
          tags?: string[] | null
        }
        Update: {
          active?: boolean
          address?: string | null
          contact?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          org_id?: string
          phone?: string | null
          tags?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_to: string | null
          category: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          due_date: string | null
          id: string
          org_id: string
          parent_id: string | null
          priority: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          category?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          org_id: string
          parent_id?: string | null
          priority?: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          category?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          org_id?: string
          parent_id?: string | null
          priority?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tiendanube_connections: {
        Row: {
          access_token: string
          client_secret: string | null
          connected_at: string
          id: string
          last_sync_orders_at: string | null
          last_sync_products_at: string | null
          org_id: string
          store_id: string
          store_name: string | null
          store_url: string | null
          sync_orders: boolean
          sync_products: boolean
          webhook_id: string | null
        }
        Insert: {
          access_token: string
          client_secret?: string | null
          connected_at?: string
          id?: string
          last_sync_orders_at?: string | null
          last_sync_products_at?: string | null
          org_id: string
          store_id: string
          store_name?: string | null
          store_url?: string | null
          sync_orders?: boolean
          sync_products?: boolean
          webhook_id?: string | null
        }
        Update: {
          access_token?: string
          client_secret?: string | null
          connected_at?: string
          id?: string
          last_sync_orders_at?: string | null
          last_sync_products_at?: string | null
          org_id?: string
          store_id?: string
          store_name?: string | null
          store_url?: string | null
          sync_orders?: boolean
          sync_products?: boolean
          webhook_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tiendanube_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tiendanube_integrations: {
        Row: {
          access_token: string
          created_at: string
          default_category_id: string | null
          id: string
          last_sync_at: string | null
          markup_percent: number
          org_id: string
          payment_fee_percent: number
          platform_fee_percent: number
          price_mode: string
          publish_status: string
          round_to: number
          store_id: string
          store_name: string | null
          store_url: string | null
          sync_images: boolean
          sync_stock: boolean
          updated_at: string
        }
        Insert: {
          access_token: string
          created_at?: string
          default_category_id?: string | null
          id?: string
          last_sync_at?: string | null
          markup_percent?: number
          org_id: string
          payment_fee_percent?: number
          platform_fee_percent?: number
          price_mode?: string
          publish_status?: string
          round_to?: number
          store_id: string
          store_name?: string | null
          store_url?: string | null
          sync_images?: boolean
          sync_stock?: boolean
          updated_at?: string
        }
        Update: {
          access_token?: string
          created_at?: string
          default_category_id?: string | null
          id?: string
          last_sync_at?: string | null
          markup_percent?: number
          org_id?: string
          payment_fee_percent?: number
          platform_fee_percent?: number
          price_mode?: string
          publish_status?: string
          round_to?: number
          store_id?: string
          store_name?: string | null
          store_url?: string | null
          sync_images?: boolean
          sync_stock?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tiendanube_integrations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tiendanube_sync_log: {
        Row: {
          action: string
          created_at: string
          error_message: string | null
          id: string
          org_id: string
          product_id: string | null
          product_name: string | null
          status: string
          tiendanube_product_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          error_message?: string | null
          id?: string
          org_id: string
          product_id?: string | null
          product_name?: string | null
          status: string
          tiendanube_product_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          error_message?: string | null
          id?: string
          org_id?: string
          product_id?: string | null
          product_name?: string | null
          status?: string
          tiendanube_product_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tiendanube_sync_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tiendanube_sync_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tiendanube_sync_log_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      webhook_deliveries: {
        Row: {
          attempt_count: number
          created_at: string
          delivered: boolean
          delivered_at: string | null
          event: string
          id: string
          last_response_body: string | null
          last_response_status: number | null
          org_id: string
          payload: Json
          webhook_url: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          delivered?: boolean
          delivered_at?: string | null
          event: string
          id?: string
          last_response_body?: string | null
          last_response_status?: number | null
          org_id: string
          payload?: Json
          webhook_url: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          delivered?: boolean
          delivered_at?: string | null
          event?: string
          id?: string
          last_response_body?: string | null
          last_response_status?: number | null
          org_id?: string
          payload?: Json
          webhook_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      audit_summary: {
        Row: {
          action: string | null
          entity_type: string | null
          event_count: number | null
          last_event: string | null
          unique_users: number | null
        }
        Relationships: []
      }
      cash_session_summary: {
        Row: {
          closed_at: string | null
          efectivo_neto: number | null
          opened_at: string | null
          opening_amount: number | null
          org_id: string | null
          session_id: string | null
          status: string | null
          tarjeta_total: number | null
          total_cobros: number | null
          total_egresos: number | null
          total_movements: number | null
          total_ventas: number | null
          transferencia_total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_sessions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_outcome_stats: {
        Row: {
          avg_days: number | null
          month: string | null
          org_id: string | null
          outcome: string | null
          reason: string | null
          total: number | null
          total_value: number | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_outcomes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      kardex_summary: {
        Row: {
          current_stock: number | null
          last_movement_at: string | null
          org_id: string | null
          product_id: string | null
          product_name: string | null
          total_in: number | null
          total_movements: number | null
          total_out: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      org_members: {
        Row: {
          id: string | null
          invited_by: string | null
          joined_at: string | null
          org_id: string | null
          role: Database["public"]["Enums"]["org_role"] | null
          user_id: string | null
        }
        Insert: {
          id?: string | null
          invited_by?: string | null
          joined_at?: string | null
          org_id?: string | null
          role?: Database["public"]["Enums"]["org_role"] | null
          user_id?: string | null
        }
        Update: {
          id?: string | null
          invited_by?: string | null
          joined_at?: string | null
          org_id?: string | null
          role?: Database["public"]["Enums"]["org_role"] | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      products_public: {
        Row: {
          brand: string | null
          category: string | null
          content_ml: number | null
          description: string | null
          discount_price_ars: number | null
          featured: boolean | null
          gender: string | null
          id: string | null
          image_url: string | null
          name: string | null
          offer_expires_at: string | null
          sale_price_ars: number | null
          stock: number | null
          total_sold: number | null
          user_id: string | null
        }
        Insert: {
          brand?: string | null
          category?: string | null
          content_ml?: number | null
          description?: string | null
          discount_price_ars?: number | null
          featured?: boolean | null
          gender?: string | null
          id?: string | null
          image_url?: string | null
          name?: string | null
          offer_expires_at?: string | null
          sale_price_ars?: number | null
          stock?: number | null
          total_sold?: number | null
          user_id?: string | null
        }
        Update: {
          brand?: string | null
          category?: string | null
          content_ml?: number | null
          description?: string | null
          discount_price_ars?: number | null
          featured?: boolean | null
          gender?: string | null
          id?: string | null
          image_url?: string | null
          name?: string | null
          offer_expires_at?: string | null
          sale_price_ars?: number | null
          stock?: number | null
          total_sold?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      settings_public: {
        Row: {
          business_name: string | null
          id: string | null
          logo_url: string | null
          primary_color: string | null
          secondary_color: string | null
          user_id: string | null
          whatsapp_number: string | null
        }
        Insert: {
          business_name?: string | null
          id?: string | null
          logo_url?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          user_id?: string | null
          whatsapp_number?: string | null
        }
        Update: {
          business_name?: string | null
          id?: string | null
          logo_url?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          user_id?: string | null
          whatsapp_number?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      adjust_stock: {
        Args: {
          p_created_by: string
          p_new_stock: number
          p_notes: string
          p_org_id: string
          p_product_id: string
          p_variant_id: string
        }
        Returns: string
      }
      check_overdue_debts: { Args: never; Returns: undefined }
      expire_overdue_trials: { Args: never; Returns: undefined }
      generate_org_slug: { Args: { _name: string }; Returns: string }
      get_org_role: {
        Args: { _org_id: string; _user_id: string }
        Returns: string
      }
      get_user_role: { Args: { _user_id: string }; Returns: string }
      has_org_role: {
        Args: { _org_id: string; _roles: string[]; _user_id: string }
        Returns: boolean
      }
      has_permission: {
        Args: { p_action: string; p_module: string; p_org_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_org_member: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      is_platform_admin: { Args: { _user_id: string }; Returns: boolean }
      next_quote_number: { Args: { p_org_id: string }; Returns: string }
      record_debt_payment_cash_entry: {
        Args: {
          p_amount_ars: number
          p_created_by: string
          p_debt_id: string
          p_description: string
          p_org_id: string
          p_payment_method: string
        }
        Returns: string
      }
      record_manual_stock_movement: {
        Args: {
          p_created_by: string
          p_movement_type: string
          p_notes: string
          p_org_id: string
          p_product_id: string
          p_quantity: number
          p_variant_id: string
        }
        Returns: string
      }
      record_stock_movement: {
        Args: {
          p_created_by?: string
          p_movement_type: string
          p_notes?: string
          p_org_id: string
          p_product_id: string
          p_product_name: string
          p_quantity: number
          p_reference_id?: string
          p_reference_type?: string
          p_unit_cost_usd?: number
          p_unit_price_ars?: number
          p_variant_id: string
          p_variant_name: string
        }
        Returns: string
      }
      seed_default_alert_rules: {
        Args: { p_org_id: string }
        Returns: undefined
      }
      seed_default_permissions: {
        Args: { p_org_id: string }
        Returns: undefined
      }
      seed_demo_data: {
        Args: { p_org_id: string; p_user_id: string }
        Returns: Json
      }
      unaccent: { Args: { "": string }; Returns: string }
      user_org_ids: { Args: { _user_id: string }; Returns: string[] }
    }
    Enums: {
      app_role: "admin" | "vendedor" | "viewer"
      invoice_status: "draft" | "sent" | "paid" | "overdue" | "canceled"
      org_role: "owner" | "admin" | "vendedor" | "viewer"
      subscription_status:
        | "trialing"
        | "active"
        | "past_due"
        | "canceled"
        | "paused"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "vendedor", "viewer"],
      invoice_status: ["draft", "sent", "paid", "overdue", "canceled"],
      org_role: ["owner", "admin", "vendedor", "viewer"],
      subscription_status: [
        "trialing",
        "active",
        "past_due",
        "canceled",
        "paused",
      ],
    },
  },
} as const
