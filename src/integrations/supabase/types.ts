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
      audit_logs: {
        Row: {
          action: string
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          user_id: string
        }
        Insert: {
          action: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          user_id?: string
        }
        Relationships: []
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
          paid_ars?: number
          remaining_ars?: number
          sale_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "debts_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
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
          influencer_instagram: string | null
          influencer_name: string
          notes: string | null
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
          influencer_instagram?: string | null
          influencer_name: string
          notes?: string | null
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
          influencer_instagram?: string | null
          influencer_name?: string
          notes?: string | null
          product_id?: string | null
          product_name?: string
          product_value_ars?: number
          quantity?: number
          status?: string
          updated_at?: string | null
          user_id?: string
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
          platform?: string
          post_type?: string
          product_ids?: string[] | null
          scheduled_at?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          brand: string
          category: string
          cost_usd: number
          created_at: string
          customs_fee: number
          description: string | null
          discount_price_ars: number | null
          gender: string
          id: string
          image_url: string | null
          name: string
          profit_per_unit_ars: number
          profit_per_unit_usd: number
          sale_price_ars: number
          stock: number
          total_cost_usd: number
          updated_at: string
          user_id: string
        }
        Insert: {
          brand?: string
          category?: string
          cost_usd?: number
          created_at?: string
          customs_fee?: number
          description?: string | null
          discount_price_ars?: number | null
          gender?: string
          id?: string
          image_url?: string | null
          name: string
          profit_per_unit_ars?: number
          profit_per_unit_usd?: number
          sale_price_ars?: number
          stock?: number
          total_cost_usd?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          brand?: string
          category?: string
          cost_usd?: number
          created_at?: string
          customs_fee?: number
          description?: string | null
          discount_price_ars?: number | null
          gender?: string
          id?: string
          image_url?: string | null
          name?: string
          profit_per_unit_ars?: number
          profit_per_unit_usd?: number
          sale_price_ars?: number
          stock?: number
          total_cost_usd?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          product_id: string | null
          product_name: string
          quantity: number
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
          product_id?: string | null
          product_name: string
          quantity?: number
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
          product_id?: string | null
          product_name?: string
          quantity?: number
          supplier?: string | null
          total_ars?: number
          total_usd?: number
          unit_cost_usd?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          cost_per_unit_usd: number
          created_at: string
          customer_name: string | null
          date: string
          discount_applied: boolean
          id: string
          paid: boolean
          payment_method: string
          product_id: string | null
          product_name: string
          profit_ars: number
          profit_usd: number
          quantity: number
          total_ars: number
          unit_price_ars: number
          user_id: string
        }
        Insert: {
          cost_per_unit_usd?: number
          created_at?: string
          customer_name?: string | null
          date?: string
          discount_applied?: boolean
          id?: string
          paid?: boolean
          payment_method?: string
          product_id?: string | null
          product_name: string
          profit_ars?: number
          profit_usd?: number
          quantity?: number
          total_ars?: number
          unit_price_ars?: number
          user_id: string
        }
        Update: {
          cost_per_unit_usd?: number
          created_at?: string
          customer_name?: string | null
          date?: string
          discount_applied?: boolean
          id?: string
          paid?: boolean
          payment_method?: string
          product_id?: string | null
          product_name?: string
          profit_ars?: number
          profit_usd?: number
          quantity?: number
          total_ars?: number
          unit_price_ars?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      settings: {
        Row: {
          business_name: string | null
          created_at: string
          customs_percent: number
          default_discount_percent: number
          discount_cash_percent: number
          discount_credit_percent: number
          discount_debit_percent: number
          discount_transfer_percent: number
          exchange_rate: number
          id: string
          logo_url: string | null
          primary_color: string | null
          secondary_color: string | null
          tax_enabled: boolean
          tax_iibb_percent: number
          tax_iva_percent: number
          tax_monotributo_monthly: number
          updated_at: string
          user_id: string
        }
        Insert: {
          business_name?: string | null
          created_at?: string
          customs_percent?: number
          default_discount_percent?: number
          discount_cash_percent?: number
          discount_credit_percent?: number
          discount_debit_percent?: number
          discount_transfer_percent?: number
          exchange_rate?: number
          id?: string
          logo_url?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          tax_enabled?: boolean
          tax_iibb_percent?: number
          tax_iva_percent?: number
          tax_monotributo_monthly?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          business_name?: string | null
          created_at?: string
          customs_percent?: number
          default_discount_percent?: number
          discount_cash_percent?: number
          discount_credit_percent?: number
          discount_debit_percent?: number
          discount_transfer_percent?: number
          exchange_rate?: number
          id?: string
          logo_url?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          tax_enabled?: boolean
          tax_iibb_percent?: number
          tax_iva_percent?: number
          tax_monotributo_monthly?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "vendedor"
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
      app_role: ["admin", "vendedor"],
    },
  },
} as const
