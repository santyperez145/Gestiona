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
          org_id: string
          recurring: boolean
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
          org_id: string
          recurring?: boolean
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
          org_id?: string
          recurring?: boolean
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
          exchange_type: string
          expected_posts: number | null
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
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          actual_posts?: number | null
          created_at?: string | null
          delivery_date?: string | null
          exchange_type?: string
          expected_posts?: number | null
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
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          actual_posts?: number | null
          created_at?: string | null
          delivery_date?: string | null
          exchange_type?: string
          expected_posts?: number | null
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
          id: string
          invited_by: string | null
          joined_at: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          id?: string
          invited_by?: string | null
          joined_at?: string
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
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
      product_variants: {
        Row: {
          active: boolean
          created_at: string
          id: string
          org_id: string
          product_id: string
          sku: string | null
          stock: number
          user_id: string
          variant_name: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          org_id: string
          product_id: string
          sku?: string | null
          stock?: number
          user_id: string
          variant_name: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          org_id?: string
          product_id?: string
          sku?: string | null
          stock?: number
          user_id?: string
          variant_name?: string
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
          brand: string
          category: string
          content_ml: number | null
          cost_usd: number
          created_at: string
          customs_fee: number
          description: string | null
          discount_price_ars: number | null
          featured: boolean | null
          gender: string
          id: string
          image_url: string | null
          image_urls: string[] | null
          name: string
          offer_expires_at: string | null
          org_id: string
          profit_per_unit_ars: number
          profit_per_unit_usd: number
          sale_price_ars: number
          stock: number
          tiendanube_product_id: string | null
          total_cost_usd: number
          total_sold: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          brand?: string
          category?: string
          content_ml?: number | null
          cost_usd?: number
          created_at?: string
          customs_fee?: number
          description?: string | null
          discount_price_ars?: number | null
          featured?: boolean | null
          gender?: string
          id?: string
          image_url?: string | null
          image_urls?: string[] | null
          name: string
          offer_expires_at?: string | null
          org_id: string
          profit_per_unit_ars?: number
          profit_per_unit_usd?: number
          sale_price_ars?: number
          stock?: number
          tiendanube_product_id?: string | null
          total_cost_usd?: number
          total_sold?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          brand?: string
          category?: string
          content_ml?: number | null
          cost_usd?: number
          created_at?: string
          customs_fee?: number
          description?: string | null
          discount_price_ars?: number | null
          featured?: boolean | null
          gender?: string
          id?: string
          image_url?: string | null
          image_urls?: string[] | null
          name?: string
          offer_expires_at?: string | null
          org_id?: string
          profit_per_unit_ars?: number
          profit_per_unit_usd?: number
          sale_price_ars?: number
          stock?: number
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
          total_ars: number
          total_usd: number
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
          total_ars?: number
          total_usd?: number
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
          total_ars?: number
          total_usd?: number
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
          id: string
          org_id: string
          paid: boolean
          payment_method: string
          product_id: string | null
          product_name: string
          profit_ars: number
          profit_usd: number
          quantity: number
          referral_code: string | null
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
          id?: string
          org_id: string
          paid?: boolean
          payment_method?: string
          product_id?: string | null
          product_name: string
          profit_ars?: number
          profit_usd?: number
          quantity?: number
          referral_code?: string | null
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
          id?: string
          org_id?: string
          paid?: boolean
          payment_method?: string
          product_id?: string | null
          product_name?: string
          profit_ars?: number
          profit_usd?: number
          quantity?: number
          referral_code?: string | null
          total_ars?: number
          unit_price_ars?: number
          user_id?: string
          variant_id?: string | null
        }
        Relationships: [
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
      settings: {
        Row: {
          ai_tone: string | null
          business_name: string | null
          cash_flow_warning_threshold_ars: number
          created_at: string
          customs_percent: number
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
          margin_alert_percent: number
          max_ai_discount_percent: number | null
          max_overstock_units: number | null
          org_id: string
          overdue_check_window_hours: number
          pasero_commission_percent: number
          primary_color: string | null
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
          whatsapp_number: string | null
        }
        Insert: {
          ai_tone?: string | null
          business_name?: string | null
          cash_flow_warning_threshold_ars?: number
          created_at?: string
          customs_percent?: number
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
          margin_alert_percent?: number
          max_ai_discount_percent?: number | null
          max_overstock_units?: number | null
          org_id: string
          overdue_check_window_hours?: number
          pasero_commission_percent?: number
          primary_color?: string | null
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
          whatsapp_number?: string | null
        }
        Update: {
          ai_tone?: string | null
          business_name?: string | null
          cash_flow_warning_threshold_ars?: number
          created_at?: string
          customs_percent?: number
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
          margin_alert_percent?: number
          max_ai_discount_percent?: number | null
          max_overstock_units?: number | null
          org_id?: string
          overdue_check_window_hours?: number
          pasero_commission_percent?: number
          primary_color?: string | null
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
      tiendanube_integrations: {
        Row: {
          access_token: string
          created_at: string
          default_category_id: string | null
          id: string
          last_sync_at: string | null
          markup_percent: number
          org_id: string
          price_mode: string
          publish_status: string
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
          price_mode?: string
          publish_status?: string
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
          price_mode?: string
          publish_status?: string
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
    }
    Views: {
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
      check_overdue_debts: { Args: never; Returns: undefined }
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
      unaccent: { Args: { "": string }; Returns: string }
      user_org_ids: { Args: { _user_id: string }; Returns: string[] }
    }
    Enums: {
      app_role: "admin" | "vendedor" | "viewer"
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
