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
      affiliate_conversions: {
        Row: {
          approved_at: string | null
          commission_amount: number
          created_at: string
          customer_id: string | null
          customer_name: string | null
          id: string
          notes: string | null
          org_id: string
          paid_at: string | null
          partner_id: string
          sale_amount: number
          sale_id: string | null
          status: string
        }
        Insert: {
          approved_at?: string | null
          commission_amount?: number
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          id?: string
          notes?: string | null
          org_id: string
          paid_at?: string | null
          partner_id: string
          sale_amount?: number
          sale_id?: string | null
          status?: string
        }
        Update: {
          approved_at?: string | null
          commission_amount?: number
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          id?: string
          notes?: string | null
          org_id?: string
          paid_at?: string | null
          partner_id?: string
          sale_amount?: number
          sale_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_conversions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_conversions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_conversions_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "affiliate_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_conversions_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_partners: {
        Row: {
          code: string
          commission_rate: number
          commission_type: string
          company: string | null
          created_at: string
          email: string
          id: string
          joined_at: string
          name: string
          notes: string | null
          org_id: string
          payout_threshold: number
          pending_payout: number
          phone: string | null
          status: string
          total_commission: number
          total_referrals: number
          total_revenue: number
          updated_at: string
        }
        Insert: {
          code: string
          commission_rate?: number
          commission_type?: string
          company?: string | null
          created_at?: string
          email: string
          id?: string
          joined_at?: string
          name: string
          notes?: string | null
          org_id: string
          payout_threshold?: number
          pending_payout?: number
          phone?: string | null
          status?: string
          total_commission?: number
          total_referrals?: number
          total_revenue?: number
          updated_at?: string
        }
        Update: {
          code?: string
          commission_rate?: number
          commission_type?: string
          company?: string | null
          created_at?: string
          email?: string
          id?: string
          joined_at?: string
          name?: string
          notes?: string | null
          org_id?: string
          payout_threshold?: number
          pending_payout?: number
          phone?: string | null
          status?: string
          total_commission?: number
          total_referrals?: number
          total_revenue?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_partners_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_payouts: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          notes: string | null
          org_id: string
          partner_id: string
          payment_method: string | null
          processed_at: string | null
          reference: string | null
          status: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: string
          notes?: string | null
          org_id: string
          partner_id: string
          payment_method?: string | null
          processed_at?: string | null
          reference?: string | null
          status?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          notes?: string | null
          org_id?: string
          partner_id?: string
          payment_method?: string | null
          processed_at?: string | null
          reference?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_payouts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_payouts_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "affiliate_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      afip_alicuotas: {
        Row: {
          alicuota_iva: number
          id: string
          org_id: string
          producto_id: string | null
          tipo_exento: boolean
        }
        Insert: {
          alicuota_iva?: number
          id?: string
          org_id: string
          producto_id?: string | null
          tipo_exento?: boolean
        }
        Update: {
          alicuota_iva?: number
          id?: string
          org_id?: string
          producto_id?: string | null
          tipo_exento?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "afip_alicuotas_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "afip_alicuotas_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "afip_alicuotas_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      afip_comprobantes: {
        Row: {
          cae: string | null
          cae_fch_vto: string | null
          created_at: string
          error_code: string | null
          error_msg: string | null
          fecha_cbte: string
          id: string
          imp_iva: number
          imp_neto: number
          imp_op_ex: number
          imp_total: number
          imp_trib: number
          invoice_id: string | null
          moneda_cotiz: number
          moneda_id: string
          nro_cbte: number
          nro_doc: string
          observaciones: Json
          org_id: string
          punto_venta: number
          qr_data: string | null
          raw_request: Json | null
          raw_response: Json | null
          resultado: string | null
          status: string
          tipo_cbte: number
          tipo_doc: number
        }
        Insert: {
          cae?: string | null
          cae_fch_vto?: string | null
          created_at?: string
          error_code?: string | null
          error_msg?: string | null
          fecha_cbte?: string
          id?: string
          imp_iva?: number
          imp_neto?: number
          imp_op_ex?: number
          imp_total?: number
          imp_trib?: number
          invoice_id?: string | null
          moneda_cotiz?: number
          moneda_id?: string
          nro_cbte: number
          nro_doc?: string
          observaciones?: Json
          org_id: string
          punto_venta: number
          qr_data?: string | null
          raw_request?: Json | null
          raw_response?: Json | null
          resultado?: string | null
          status?: string
          tipo_cbte: number
          tipo_doc?: number
        }
        Update: {
          cae?: string | null
          cae_fch_vto?: string | null
          created_at?: string
          error_code?: string | null
          error_msg?: string | null
          fecha_cbte?: string
          id?: string
          imp_iva?: number
          imp_neto?: number
          imp_op_ex?: number
          imp_total?: number
          imp_trib?: number
          invoice_id?: string | null
          moneda_cotiz?: number
          moneda_id?: string
          nro_cbte?: number
          nro_doc?: string
          observaciones?: Json
          org_id?: string
          punto_venta?: number
          qr_data?: string | null
          raw_request?: Json | null
          raw_response?: Json | null
          resultado?: string | null
          status?: string
          tipo_cbte?: number
          tipo_doc?: number
        }
        Relationships: [
          {
            foreignKeyName: "afip_comprobantes_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "afip_comprobantes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      afip_config: {
        Row: {
          ambiente: string
          cert_expires_at: string | null
          cert_pem: string | null
          created_at: string
          cuit: string
          id: string
          is_active: boolean
          key_pem: string | null
          last_sync_at: string | null
          org_id: string
          punto_venta: number
          razon_social: string
          updated_at: string
        }
        Insert: {
          ambiente?: string
          cert_expires_at?: string | null
          cert_pem?: string | null
          created_at?: string
          cuit: string
          id?: string
          is_active?: boolean
          key_pem?: string | null
          last_sync_at?: string | null
          org_id: string
          punto_venta?: number
          razon_social: string
          updated_at?: string
        }
        Update: {
          ambiente?: string
          cert_expires_at?: string | null
          cert_pem?: string | null
          created_at?: string
          cuit?: string
          id?: string
          is_active?: boolean
          key_pem?: string | null
          last_sync_at?: string | null
          org_id?: string
          punto_venta?: number
          razon_social?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "afip_config_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      afip_padron_cache: {
        Row: {
          actividades: Json
          categorias_iva: Json
          consulted_at: string
          cuit: string
          domicilio: Json | null
          estado: string | null
          razon_social: string | null
          tipo_persona: string | null
        }
        Insert: {
          actividades?: Json
          categorias_iva?: Json
          consulted_at?: string
          cuit: string
          domicilio?: Json | null
          estado?: string | null
          razon_social?: string | null
          tipo_persona?: string | null
        }
        Update: {
          actividades?: Json
          categorias_iva?: Json
          consulted_at?: string
          cuit?: string
          domicilio?: Json | null
          estado?: string | null
          razon_social?: string | null
          tipo_persona?: string | null
        }
        Relationships: []
      }
      ai_chat_messages: {
        Row: {
          content: string
          created_at: string
          finish_reason: string | null
          id: string
          is_error: boolean
          metadata: Json
          model: string | null
          org_id: string
          parent_id: string | null
          role: string
          session_id: string
          tokens_used: number
          tool_input: Json | null
          tool_name: string | null
          tool_result: Json | null
        }
        Insert: {
          content: string
          created_at?: string
          finish_reason?: string | null
          id?: string
          is_error?: boolean
          metadata?: Json
          model?: string | null
          org_id: string
          parent_id?: string | null
          role: string
          session_id: string
          tokens_used?: number
          tool_input?: Json | null
          tool_name?: string | null
          tool_result?: Json | null
        }
        Update: {
          content?: string
          created_at?: string
          finish_reason?: string | null
          id?: string
          is_error?: boolean
          metadata?: Json
          model?: string | null
          org_id?: string
          parent_id?: string | null
          role?: string
          session_id?: string
          tokens_used?: number
          tool_input?: Json | null
          tool_name?: string | null
          tool_result?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_messages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_chat_messages_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "ai_chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "ai_chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_chat_sessions: {
        Row: {
          context_window: number
          created_at: string
          id: string
          is_archived: boolean
          is_pinned: boolean
          message_count: number
          model: string
          org_id: string
          system_prompt: string | null
          tags: string[]
          temperature: number
          title: string
          total_tokens: number
          updated_at: string
          user_id: string
        }
        Insert: {
          context_window?: number
          created_at?: string
          id?: string
          is_archived?: boolean
          is_pinned?: boolean
          message_count?: number
          model?: string
          org_id: string
          system_prompt?: string | null
          tags?: string[]
          temperature?: number
          title?: string
          total_tokens?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          context_window?: number
          created_at?: string
          id?: string
          is_archived?: boolean
          is_pinned?: boolean
          message_count?: number
          model?: string
          org_id?: string
          system_prompt?: string | null
          tags?: string[]
          temperature?: number
          title?: string
          total_tokens?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_sessions_org_id_fkey"
            columns: ["org_id"]
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
      ai_prompts_library: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          id: string
          is_shared: boolean
          org_id: string
          prompt: string
          tags: string[]
          title: string
          use_count: number
        }
        Insert: {
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_shared?: boolean
          org_id: string
          prompt: string
          tags?: string[]
          title: string
          use_count?: number
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_shared?: boolean
          org_id?: string
          prompt?: string
          tags?: string[]
          title?: string
          use_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_prompts_library_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_recommendations: {
        Row: {
          action_url: string | null
          confidence: number
          created_at: string
          data_points: Json
          description: string
          effort: string
          entity_id: string | null
          entity_type: string | null
          expires_at: string | null
          id: string
          impact_estimate: number
          org_id: string
          rec_type: string
          status: string
          title: string
          user_feedback: string | null
        }
        Insert: {
          action_url?: string | null
          confidence?: number
          created_at?: string
          data_points?: Json
          description: string
          effort?: string
          entity_id?: string | null
          entity_type?: string | null
          expires_at?: string | null
          id?: string
          impact_estimate?: number
          org_id: string
          rec_type: string
          status?: string
          title: string
          user_feedback?: string | null
        }
        Update: {
          action_url?: string | null
          confidence?: number
          created_at?: string
          data_points?: Json
          description?: string
          effort?: string
          entity_id?: string | null
          entity_type?: string | null
          expires_at?: string | null
          id?: string
          impact_estimate?: number
          org_id?: string
          rec_type?: string
          status?: string
          title?: string
          user_feedback?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_recommendations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_stats: {
        Row: {
          date: string
          estimated_cost_usd: number
          id: string
          input_tokens: number
          model: string
          org_id: string
          output_tokens: number
          request_count: number
          total_tokens: number | null
          user_id: string | null
        }
        Insert: {
          date?: string
          estimated_cost_usd?: number
          id?: string
          input_tokens?: number
          model: string
          org_id: string
          output_tokens?: number
          request_count?: number
          total_tokens?: number | null
          user_id?: string | null
        }
        Update: {
          date?: string
          estimated_cost_usd?: number
          id?: string
          input_tokens?: number
          model?: string
          org_id?: string
          output_tokens?: number
          request_count?: number
          total_tokens?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_stats_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_events: {
        Row: {
          acknowledged_at: string | null
          category: string
          created_at: string
          id: string
          message: string
          metric_value: number | null
          org_id: string
          priority: string
          rule_id: string | null
          rule_name: string
          threshold_value: number | null
          title: string
        }
        Insert: {
          acknowledged_at?: string | null
          category?: string
          created_at?: string
          id?: string
          message?: string
          metric_value?: number | null
          org_id: string
          priority?: string
          rule_id?: string | null
          rule_name: string
          threshold_value?: number | null
          title: string
        }
        Update: {
          acknowledged_at?: string | null
          category?: string
          created_at?: string
          id?: string
          message?: string
          metric_value?: number | null
          org_id?: string
          priority?: string
          rule_id?: string | null
          rule_name?: string
          threshold_value?: number | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "alert_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_events_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "smart_alert_rules"
            referencedColumns: ["id"]
          },
        ]
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
      anomaly_detections: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          actual_value: number
          anomaly_type: string
          description: string
          detected_at: string
          deviation_pct: number
          entity_id: string | null
          entity_type: string
          expected_value: number
          false_positive: boolean
          id: string
          is_acknowledged: boolean
          metric_name: string
          org_id: string
          severity: string
          suggested_action: string | null
          z_score: number | null
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          actual_value: number
          anomaly_type: string
          description: string
          detected_at?: string
          deviation_pct: number
          entity_id?: string | null
          entity_type?: string
          expected_value: number
          false_positive?: boolean
          id?: string
          is_acknowledged?: boolean
          metric_name: string
          org_id: string
          severity?: string
          suggested_action?: string | null
          z_score?: number | null
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          actual_value?: number
          anomaly_type?: string
          description?: string
          detected_at?: string
          deviation_pct?: number
          entity_id?: string | null
          entity_type?: string
          expected_value?: number
          false_positive?: boolean
          id?: string
          is_acknowledged?: boolean
          metric_name?: string
          org_id?: string
          severity?: string
          suggested_action?: string | null
          z_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "anomaly_detections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      appointment_blocks: {
        Row: {
          created_at: string
          end_at: string
          id: string
          org_id: string
          reason: string | null
          staff_name: string | null
          start_at: string
        }
        Insert: {
          created_at?: string
          end_at: string
          id?: string
          org_id: string
          reason?: string | null
          staff_name?: string | null
          start_at: string
        }
        Update: {
          created_at?: string
          end_at?: string
          id?: string
          org_id?: string
          reason?: string | null
          staff_name?: string | null
          start_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_blocks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          created_at: string
          customer_email: string | null
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          deposit_paid: number
          end_at: string
          id: string
          internal_notes: string | null
          notes: string | null
          org_id: string
          price: number
          reminder_sent: boolean
          service_id: string
          staff_name: string | null
          start_at: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_email?: string | null
          customer_id?: string | null
          customer_name: string
          customer_phone?: string | null
          deposit_paid?: number
          end_at: string
          id?: string
          internal_notes?: string | null
          notes?: string | null
          org_id: string
          price?: number
          reminder_sent?: boolean
          service_id: string
          staff_name?: string | null
          start_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string | null
          deposit_paid?: number
          end_at?: string
          id?: string
          internal_notes?: string | null
          notes?: string | null
          org_id?: string
          price?: number
          reminder_sent?: boolean
          service_id?: string
          staff_name?: string | null
          start_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_depreciation_entries: {
        Row: {
          accumulated: number
          asset_id: string
          book_value_end: number
          created_at: string
          depreciation: number
          id: string
          notes: string | null
          org_id: string
          period_month: number
          period_year: number
        }
        Insert: {
          accumulated?: number
          asset_id: string
          book_value_end?: number
          created_at?: string
          depreciation?: number
          id?: string
          notes?: string | null
          org_id: string
          period_month: number
          period_year: number
        }
        Update: {
          accumulated?: number
          asset_id?: string
          book_value_end?: number
          created_at?: string
          depreciation?: number
          id?: string
          notes?: string | null
          org_id?: string
          period_month?: number
          period_year?: number
        }
        Relationships: [
          {
            foreignKeyName: "asset_depreciation_entries_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "fixed_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_depreciation_entries_org_id_fkey"
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
      badge_definitions: {
        Row: {
          active: boolean
          category: string
          color: string
          condition_type: string
          condition_value: number
          created_at: string
          description: string
          icon: string
          id: string
          name: string
          org_id: string
          points: number
        }
        Insert: {
          active?: boolean
          category?: string
          color?: string
          condition_type?: string
          condition_value?: number
          created_at?: string
          description: string
          icon?: string
          id?: string
          name: string
          org_id: string
          points?: number
        }
        Update: {
          active?: boolean
          category?: string
          color?: string
          condition_type?: string
          condition_value?: number
          created_at?: string
          description?: string
          icon?: string
          id?: string
          name?: string
          org_id?: string
          points?: number
        }
        Relationships: [
          {
            foreignKeyName: "badge_definitions_org_id_fkey"
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
      bin_stock: {
        Row: {
          bin_id: string
          id: string
          org_id: string
          product_id: string
          quantity: number
          updated_at: string
        }
        Insert: {
          bin_id: string
          id?: string
          org_id: string
          product_id: string
          quantity?: number
          updated_at?: string
        }
        Update: {
          bin_id?: string
          id?: string
          org_id?: string
          product_id?: string
          quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bin_stock_bin_id_fkey"
            columns: ["bin_id"]
            isOneToOne: false
            referencedRelation: "warehouse_bins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bin_stock_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bin_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bin_stock_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
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
      breakeven_analysis: {
        Row: {
          avg_price: number
          avg_unit_cost: number
          breakeven_revenue: number | null
          breakeven_units: number | null
          contribution_margin_pct: number | null
          created_at: string
          fixed_costs: number
          id: string
          name: string
          org_id: string
          scenario_id: string | null
          variable_cost_pct: number
        }
        Insert: {
          avg_price?: number
          avg_unit_cost?: number
          breakeven_revenue?: number | null
          breakeven_units?: number | null
          contribution_margin_pct?: number | null
          created_at?: string
          fixed_costs?: number
          id?: string
          name: string
          org_id: string
          scenario_id?: string | null
          variable_cost_pct?: number
        }
        Update: {
          avg_price?: number
          avg_unit_cost?: number
          breakeven_revenue?: number | null
          breakeven_units?: number | null
          contribution_margin_pct?: number | null
          created_at?: string
          fixed_costs?: number
          id?: string
          name?: string
          org_id?: string
          scenario_id?: string | null
          variable_cost_pct?: number
        }
        Relationships: [
          {
            foreignKeyName: "breakeven_analysis_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "breakeven_analysis_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "financial_scenarios"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_categories: {
        Row: {
          active: boolean
          color: string
          created_at: string
          icon: string
          id: string
          name: string
          org_id: string
          sort_order: number
          type: string
        }
        Insert: {
          active?: boolean
          color?: string
          created_at?: string
          icon?: string
          id?: string
          name: string
          org_id: string
          sort_order?: number
          type?: string
        }
        Update: {
          active?: boolean
          color?: string
          created_at?: string
          icon?: string
          id?: string
          name?: string
          org_id?: string
          sort_order?: number
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "budget_categories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_transactions: {
        Row: {
          amount: number
          category_id: string
          created_at: string
          date: string
          description: string
          id: string
          org_id: string
          reference_id: string | null
          reference_type: string | null
        }
        Insert: {
          amount: number
          category_id: string
          created_at?: string
          date?: string
          description: string
          id?: string
          org_id: string
          reference_id?: string | null
          reference_type?: string | null
        }
        Update: {
          amount?: number
          category_id?: string
          created_at?: string
          date?: string
          description?: string
          id?: string
          org_id?: string
          reference_id?: string | null
          reference_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_transactions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "budget_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          amount: number
          category_id: string
          created_at: string
          id: string
          month: number
          notes: string | null
          org_id: string
          updated_at: string
          year: number
        }
        Insert: {
          amount?: number
          category_id: string
          created_at?: string
          id?: string
          month: number
          notes?: string | null
          org_id: string
          updated_at?: string
          year: number
        }
        Update: {
          amount?: number
          category_id?: string
          created_at?: string
          id?: string
          month?: number
          notes?: string | null
          org_id?: string
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "budgets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "budget_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budgets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bundle_items: {
        Row: {
          bundle_id: string
          id: string
          product_id: string
          quantity: number
        }
        Insert: {
          bundle_id: string
          id?: string
          product_id: string
          quantity?: number
        }
        Update: {
          bundle_id?: string
          id?: string
          product_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "bundle_items_bundle_id_fkey"
            columns: ["bundle_id"]
            isOneToOne: false
            referencedRelation: "product_bundles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bundle_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bundle_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      carriers: {
        Row: {
          api_key_ref: string | null
          avg_days: number
          carrier_type: string
          code: string
          created_at: string
          id: string
          is_active: boolean
          logo_url: string | null
          max_dimensions: Json | null
          max_weight_kg: number | null
          name: string
          org_id: string
          tracking_url: string | null
        }
        Insert: {
          api_key_ref?: string | null
          avg_days?: number
          carrier_type?: string
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          max_dimensions?: Json | null
          max_weight_kg?: number | null
          name: string
          org_id: string
          tracking_url?: string | null
        }
        Update: {
          api_key_ref?: string | null
          avg_days?: number
          carrier_type?: string
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          logo_url?: string | null
          max_dimensions?: Json | null
          max_weight_kg?: number | null
          name?: string
          org_id?: string
          tracking_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "carriers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
      cash_projections: {
        Row: {
          cash_inflows: Json
          cash_outflows: Json
          closing_balance: number | null
          id: string
          is_deficit: boolean | null
          opening_balance: number
          org_id: string
          period_date: string
          scenario_id: string
          total_inflows: number
          total_outflows: number
        }
        Insert: {
          cash_inflows?: Json
          cash_outflows?: Json
          closing_balance?: number | null
          id?: string
          is_deficit?: boolean | null
          opening_balance?: number
          org_id: string
          period_date: string
          scenario_id: string
          total_inflows?: number
          total_outflows?: number
        }
        Update: {
          cash_inflows?: Json
          cash_outflows?: Json
          closing_balance?: number | null
          id?: string
          is_deficit?: boolean | null
          opening_balance?: number
          org_id?: string
          period_date?: string
          scenario_id?: string
          total_inflows?: number
          total_outflows?: number
        }
        Relationships: [
          {
            foreignKeyName: "cash_projections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_projections_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "financial_scenarios"
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
      cashflow_entries: {
        Row: {
          amount: number
          bank_account: string | null
          category: string
          created_at: string
          date: string
          description: string
          entry_type: string
          id: string
          is_projected: boolean
          is_recurring: boolean
          notes: string | null
          org_id: string
          recurrence_end: string | null
          recurrence_type: string | null
          reference_id: string | null
          reference_type: string | null
        }
        Insert: {
          amount?: number
          bank_account?: string | null
          category?: string
          created_at?: string
          date?: string
          description: string
          entry_type: string
          id?: string
          is_projected?: boolean
          is_recurring?: boolean
          notes?: string | null
          org_id: string
          recurrence_end?: string | null
          recurrence_type?: string | null
          reference_id?: string | null
          reference_type?: string | null
        }
        Update: {
          amount?: number
          bank_account?: string | null
          category?: string
          created_at?: string
          date?: string
          description?: string
          entry_type?: string
          id?: string
          is_projected?: boolean
          is_recurring?: boolean
          notes?: string | null
          org_id?: string
          recurrence_end?: string | null
          recurrence_type?: string | null
          reference_id?: string | null
          reference_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cashflow_entries_org_id_fkey"
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
      content_ideas: {
        Row: {
          category: string
          converted_to_post: boolean
          created_at: string
          id: string
          idea: string
          org_id: string
          priority: number
        }
        Insert: {
          category?: string
          converted_to_post?: boolean
          created_at?: string
          id?: string
          idea: string
          org_id: string
          priority?: number
        }
        Update: {
          category?: string
          converted_to_post?: boolean
          created_at?: string
          id?: string
          idea?: string
          org_id?: string
          priority?: number
        }
        Relationships: [
          {
            foreignKeyName: "content_ideas_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          auto_renewal: boolean
          contract_number: string
          created_at: string
          created_by: string | null
          currency: string
          customer_email: string | null
          customer_id: string | null
          customer_name: string | null
          deal_id: string | null
          description: string | null
          document_url: string | null
          end_date: string | null
          id: string
          org_id: string
          renewal_days: number
          signed_at: string | null
          signed_ip: string | null
          signer_name: string | null
          start_date: string | null
          status: string
          tags: string[] | null
          terms: string | null
          title: string
          type: string
          updated_at: string
          value: number
        }
        Insert: {
          auto_renewal?: boolean
          contract_number: string
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          deal_id?: string | null
          description?: string | null
          document_url?: string | null
          end_date?: string | null
          id?: string
          org_id: string
          renewal_days?: number
          signed_at?: string | null
          signed_ip?: string | null
          signer_name?: string | null
          start_date?: string | null
          status?: string
          tags?: string[] | null
          terms?: string | null
          title: string
          type?: string
          updated_at?: string
          value?: number
        }
        Update: {
          auto_renewal?: boolean
          contract_number?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          deal_id?: string | null
          description?: string | null
          document_url?: string | null
          end_date?: string | null
          id?: string
          org_id?: string
          renewal_days?: number
          signed_at?: string | null
          signed_ip?: string | null
          signer_name?: string | null
          start_date?: string | null
          status?: string
          tags?: string[] | null
          terms?: string | null
          title?: string
          type?: string
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "contracts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_org_id_fkey"
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
      crm_activities: {
        Row: {
          activity_type: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          deal_id: string | null
          description: string | null
          duration_min: number | null
          id: string
          is_completed: boolean
          org_id: string
          outcome: string | null
          scheduled_at: string | null
          subject: string
        }
        Insert: {
          activity_type: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          deal_id?: string | null
          description?: string | null
          duration_min?: number | null
          id?: string
          is_completed?: boolean
          org_id: string
          outcome?: string | null
          scheduled_at?: string | null
          subject: string
        }
        Update: {
          activity_type?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          deal_id?: string | null
          description?: string | null
          duration_min?: number | null
          id?: string
          is_completed?: boolean
          org_id?: string
          outcome?: string | null
          scheduled_at?: string | null
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_activities_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "crm_deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_activities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_contacts: {
        Row: {
          company: string | null
          created_at: string
          custom_fields: Json
          customer_id: string | null
          email: string | null
          first_name: string
          id: string
          last_name: string | null
          lead_score: number
          lifecycle_stage: string
          linkedin_url: string | null
          org_id: string
          phone: string | null
          role: string | null
          tags: string[]
        }
        Insert: {
          company?: string | null
          created_at?: string
          custom_fields?: Json
          customer_id?: string | null
          email?: string | null
          first_name: string
          id?: string
          last_name?: string | null
          lead_score?: number
          lifecycle_stage?: string
          linkedin_url?: string | null
          org_id: string
          phone?: string | null
          role?: string | null
          tags?: string[]
        }
        Update: {
          company?: string | null
          created_at?: string
          custom_fields?: Json
          customer_id?: string | null
          email?: string | null
          first_name?: string
          id?: string
          last_name?: string | null
          lead_score?: number
          lifecycle_stage?: string
          linkedin_url?: string | null
          org_id?: string
          phone?: string | null
          role?: string | null
          tags?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "crm_contacts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_deals: {
        Row: {
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          currency: string
          custom_fields: Json
          customer_id: string | null
          expected_close: string | null
          id: string
          is_rotting: boolean
          last_activity: string | null
          lost_at: string | null
          lost_reason: string | null
          next_follow_up: string | null
          org_id: string
          owner_id: string | null
          pipeline_id: string
          probability: number
          source: string | null
          stage_id: string
          tags: string[]
          title: string
          updated_at: string
          value: number
          weighted_value: number | null
          won_at: string | null
        }
        Insert: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          currency?: string
          custom_fields?: Json
          customer_id?: string | null
          expected_close?: string | null
          id?: string
          is_rotting?: boolean
          last_activity?: string | null
          lost_at?: string | null
          lost_reason?: string | null
          next_follow_up?: string | null
          org_id: string
          owner_id?: string | null
          pipeline_id: string
          probability?: number
          source?: string | null
          stage_id: string
          tags?: string[]
          title: string
          updated_at?: string
          value?: number
          weighted_value?: number | null
          won_at?: string | null
        }
        Update: {
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          currency?: string
          custom_fields?: Json
          customer_id?: string | null
          expected_close?: string | null
          id?: string
          is_rotting?: boolean
          last_activity?: string | null
          lost_at?: string | null
          lost_reason?: string | null
          next_follow_up?: string | null
          org_id?: string
          owner_id?: string | null
          pipeline_id?: string
          probability?: number
          source?: string | null
          stage_id?: string
          tags?: string[]
          title?: string
          updated_at?: string
          value?: number
          weighted_value?: number | null
          won_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_deals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "crm_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "crm_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_pipelines: {
        Row: {
          created_at: string
          currency: string
          description: string | null
          id: string
          is_default: boolean
          name: string
          org_id: string
          win_probability_model: string
        }
        Insert: {
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          is_default?: boolean
          name: string
          org_id: string
          win_probability_model?: string
        }
        Update: {
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          is_default?: boolean
          name?: string
          org_id?: string
          win_probability_model?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_pipelines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_stages: {
        Row: {
          color: string
          id: string
          name: string
          org_id: string
          pipeline_id: string
          required_fields: string[]
          rotting_days: number
          sort_order: number
          stage_type: string
          win_probability: number
        }
        Insert: {
          color?: string
          id?: string
          name: string
          org_id: string
          pipeline_id: string
          required_fields?: string[]
          rotting_days?: number
          sort_order?: number
          stage_type?: string
          win_probability?: number
        }
        Update: {
          color?: string
          id?: string
          name?: string
          org_id?: string
          pipeline_id?: string
          required_fields?: string[]
          rotting_days?: number
          sort_order?: number
          stage_type?: string
          win_probability?: number
        }
        Relationships: [
          {
            foreignKeyName: "crm_stages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "crm_pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      currency_price_updates: {
        Row: {
          applied_at: string
          applied_by: string | null
          id: string
          margin_type: string
          margin_value: number
          name: string
          org_id: string
          pct_change: number | null
          products_updated: number
          rate_after: number
          rate_before: number
        }
        Insert: {
          applied_at?: string
          applied_by?: string | null
          id?: string
          margin_type?: string
          margin_value?: number
          name: string
          org_id: string
          pct_change?: number | null
          products_updated?: number
          rate_after: number
          rate_before: number
        }
        Update: {
          applied_at?: string
          applied_by?: string | null
          id?: string
          margin_type?: string
          margin_value?: number
          name?: string
          org_id?: string
          pct_change?: number | null
          products_updated?: number
          rate_after?: number
          rate_before?: number
        }
        Relationships: [
          {
            foreignKeyName: "currency_price_updates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_field_defs: {
        Row: {
          created_at: string
          entity_type: string
          field_key: string
          field_label: string
          field_type: string
          id: string
          options: string[] | null
          org_id: string
          required: boolean
          sort_order: number
        }
        Insert: {
          created_at?: string
          entity_type: string
          field_key: string
          field_label: string
          field_type?: string
          id?: string
          options?: string[] | null
          org_id: string
          required?: boolean
          sort_order?: number
        }
        Update: {
          created_at?: string
          entity_type?: string
          field_key?: string
          field_label?: string
          field_type?: string
          id?: string
          options?: string[] | null
          org_id?: string
          required?: boolean
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "custom_field_defs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_forms: {
        Row: {
          closes_at: string | null
          created_at: string
          description: string | null
          fields: Json
          form_type: string
          id: string
          max_responses: number | null
          name: string
          notify_email: string | null
          org_id: string
          redirect_url: string | null
          response_count: number
          settings: Json
          slug: string
          status: string
          success_message: string
          updated_at: string
        }
        Insert: {
          closes_at?: string | null
          created_at?: string
          description?: string | null
          fields?: Json
          form_type?: string
          id?: string
          max_responses?: number | null
          name: string
          notify_email?: string | null
          org_id: string
          redirect_url?: string | null
          response_count?: number
          settings?: Json
          slug: string
          status?: string
          success_message?: string
          updated_at?: string
        }
        Update: {
          closes_at?: string | null
          created_at?: string
          description?: string | null
          fields?: Json
          form_type?: string
          id?: string
          max_responses?: number | null
          name?: string
          notify_email?: string | null
          org_id?: string
          redirect_url?: string | null
          response_count?: number
          settings?: Json
          slug?: string
          status?: string
          success_message?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_forms_org_id_fkey"
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
          follow_up_date: string | null
          id: string
          org_id: string
          outcome: string | null
          summary: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          customer_name: string
          follow_up_date?: string | null
          id?: string
          org_id: string
          outcome?: string | null
          summary: string
          type?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          customer_name?: string
          follow_up_date?: string | null
          id?: string
          org_id?: string
          outcome?: string | null
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
      customer_journey_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          customer_id: string
          id: string
          is_current: boolean
          notes: string | null
          org_id: string
          stage_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          customer_id: string
          id?: string
          is_current?: boolean
          notes?: string | null
          org_id: string
          stage_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          customer_id?: string
          id?: string
          is_current?: boolean
          notes?: string | null
          org_id?: string
          stage_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_journey_assignments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_journey_assignments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_journey_assignments_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "journey_stages"
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
      customer_segment_members: {
        Row: {
          added_at: string
          customer_id: string
          id: string
          segment_id: string
        }
        Insert: {
          added_at?: string
          customer_id: string
          id?: string
          segment_id: string
        }
        Update: {
          added_at?: string
          customer_id?: string
          id?: string
          segment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_segment_members_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_segment_members_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "customer_segments"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_segments: {
        Row: {
          active: boolean
          color: string
          created_at: string
          customer_count: number
          description: string | null
          id: string
          is_dynamic: boolean
          last_synced_at: string | null
          name: string
          org_id: string
          rules: Json
          updated_at: string
        }
        Insert: {
          active?: boolean
          color?: string
          created_at?: string
          customer_count?: number
          description?: string | null
          id?: string
          is_dynamic?: boolean
          last_synced_at?: string | null
          name: string
          org_id: string
          rules?: Json
          updated_at?: string
        }
        Update: {
          active?: boolean
          color?: string
          created_at?: string
          customer_count?: number
          description?: string | null
          id?: string
          is_dynamic?: boolean
          last_synced_at?: string | null
          name?: string
          org_id?: string
          rules?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_segments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_subscriptions: {
        Row: {
          amount_override: number | null
          auto_renew: boolean
          cancel_reason: string | null
          cancelled_at: string | null
          created_at: string
          current_period_end: string
          current_period_start: string
          customer_email: string | null
          customer_id: string | null
          customer_name: string
          discount_percent: number
          id: string
          notes: string | null
          org_id: string
          payment_method: string | null
          plan_id: string
          status: string
          trial_end: string | null
          updated_at: string
        }
        Insert: {
          amount_override?: number | null
          auto_renew?: boolean
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          current_period_end: string
          current_period_start?: string
          customer_email?: string | null
          customer_id?: string | null
          customer_name: string
          discount_percent?: number
          id?: string
          notes?: string | null
          org_id: string
          payment_method?: string | null
          plan_id: string
          status?: string
          trial_end?: string | null
          updated_at?: string
        }
        Update: {
          amount_override?: number | null
          auto_renew?: boolean
          cancel_reason?: string | null
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string
          discount_percent?: number
          id?: string
          notes?: string | null
          org_id?: string
          payment_method?: string | null
          plan_id?: string
          status?: string
          trial_end?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_subscriptions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_touchpoints: {
        Row: {
          assigned_to: string | null
          channel: string
          created_at: string
          customer_id: string
          description: string | null
          id: string
          metadata: Json
          occurred_at: string
          org_id: string
          sentiment: string | null
          sentiment_score: number | null
          stage_id: string | null
          subject: string | null
          touchpoint_type: string
        }
        Insert: {
          assigned_to?: string | null
          channel?: string
          created_at?: string
          customer_id: string
          description?: string | null
          id?: string
          metadata?: Json
          occurred_at?: string
          org_id: string
          sentiment?: string | null
          sentiment_score?: number | null
          stage_id?: string | null
          subject?: string | null
          touchpoint_type: string
        }
        Update: {
          assigned_to?: string | null
          channel?: string
          created_at?: string
          customer_id?: string
          description?: string | null
          id?: string
          metadata?: Json
          occurred_at?: string
          org_id?: string
          sentiment?: string | null
          sentiment_score?: number | null
          stage_id?: string | null
          subject?: string | null
          touchpoint_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_touchpoints_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_touchpoints_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_touchpoints_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "journey_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          birthday: string | null
          buys_vapers: boolean
          company: string | null
          created_at: string
          custom_fields: Json | null
          email: string | null
          id: string
          instagram_handle: string | null
          name: string
          notes: string | null
          org_id: string
          phone: string | null
          price_list_id: string | null
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
          company?: string | null
          created_at?: string
          custom_fields?: Json | null
          email?: string | null
          id?: string
          instagram_handle?: string | null
          name: string
          notes?: string | null
          org_id: string
          phone?: string | null
          price_list_id?: string | null
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
          company?: string | null
          created_at?: string
          custom_fields?: Json | null
          email?: string | null
          id?: string
          instagram_handle?: string | null
          name?: string
          notes?: string | null
          org_id?: string
          phone?: string | null
          price_list_id?: string | null
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
          {
            foreignKeyName: "customers_price_list_id_fkey"
            columns: ["price_list_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_activities: {
        Row: {
          content: string
          created_at: string
          deal_id: string
          id: string
          meta: Json | null
          org_id: string
          type: string
          user_id: string | null
        }
        Insert: {
          content: string
          created_at?: string
          deal_id: string
          id?: string
          meta?: Json | null
          org_id: string
          type: string
          user_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          deal_id?: string
          id?: string
          meta?: Json | null
          org_id?: string
          type?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "deal_activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_activities_org_id_fkey"
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
          win_loss_reason: string | null
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
          win_loss_reason?: string | null
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
          win_loss_reason?: string | null
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
      deliveries: {
        Row: {
          address_city: string
          address_notes: string | null
          address_province: string | null
          address_street: string
          address_zip: string | null
          carrier: string
          cod_amount: number
          cod_collected: boolean
          created_at: string
          customer_email: string | null
          customer_name: string
          customer_phone: string | null
          delivered_at: string | null
          driver_name: string | null
          driver_phone: string | null
          external_tracking: string | null
          id: string
          notes: string | null
          org_id: string
          picked_up_at: string | null
          priority: string
          proof_photo_url: string | null
          sale_id: string | null
          scheduled_for: string | null
          signature_url: string | null
          status: string
          tracking_code: string
          updated_at: string
          vehicle_plate: string | null
          weight_kg: number | null
        }
        Insert: {
          address_city: string
          address_notes?: string | null
          address_province?: string | null
          address_street: string
          address_zip?: string | null
          carrier?: string
          cod_amount?: number
          cod_collected?: boolean
          created_at?: string
          customer_email?: string | null
          customer_name: string
          customer_phone?: string | null
          delivered_at?: string | null
          driver_name?: string | null
          driver_phone?: string | null
          external_tracking?: string | null
          id?: string
          notes?: string | null
          org_id: string
          picked_up_at?: string | null
          priority?: string
          proof_photo_url?: string | null
          sale_id?: string | null
          scheduled_for?: string | null
          signature_url?: string | null
          status?: string
          tracking_code: string
          updated_at?: string
          vehicle_plate?: string | null
          weight_kg?: number | null
        }
        Update: {
          address_city?: string
          address_notes?: string | null
          address_province?: string | null
          address_street?: string
          address_zip?: string | null
          carrier?: string
          cod_amount?: number
          cod_collected?: boolean
          created_at?: string
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string | null
          delivered_at?: string | null
          driver_name?: string | null
          driver_phone?: string | null
          external_tracking?: string | null
          id?: string
          notes?: string | null
          org_id?: string
          picked_up_at?: string | null
          priority?: string
          proof_photo_url?: string | null
          sale_id?: string | null
          scheduled_for?: string | null
          signature_url?: string | null
          status?: string
          tracking_code?: string
          updated_at?: string
          vehicle_plate?: string | null
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_events: {
        Row: {
          created_at: string
          created_by: string | null
          delivery_id: string
          description: string
          id: string
          latitude: number | null
          longitude: number | null
          status: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delivery_id: string
          description: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          status: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delivery_id?: string
          description?: string
          id?: string
          latitude?: number | null
          longitude?: number | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_events_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
        ]
      }
      demand_forecasts: {
        Row: {
          actual_units: number | null
          confidence: number
          created_at: string
          forecast_date: string
          horizon_days: number
          id: string
          lower_bound: number
          mape: number | null
          model_type: string
          notes: string | null
          org_id: string
          predicted_units: number
          product_id: string
          upper_bound: number
        }
        Insert: {
          actual_units?: number | null
          confidence?: number
          created_at?: string
          forecast_date: string
          horizon_days?: number
          id?: string
          lower_bound?: number
          mape?: number | null
          model_type?: string
          notes?: string | null
          org_id: string
          predicted_units?: number
          product_id: string
          upper_bound?: number
        }
        Update: {
          actual_units?: number | null
          confidence?: number
          created_at?: string
          forecast_date?: string
          horizon_days?: number
          id?: string
          lower_bound?: number
          mape?: number | null
          model_type?: string
          notes?: string | null
          org_id?: string
          predicted_units?: number
          product_id?: string
          upper_bound?: number
        }
        Relationships: [
          {
            foreignKeyName: "demand_forecasts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demand_forecasts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demand_forecasts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      demand_signals: {
        Row: {
          confidence: number
          description: string | null
          detected_at: string
          id: string
          is_resolved: boolean
          org_id: string
          product_id: string
          resolved_at: string | null
          signal_type: string
          value: number | null
        }
        Insert: {
          confidence?: number
          description?: string | null
          detected_at?: string
          id?: string
          is_resolved?: boolean
          org_id: string
          product_id: string
          resolved_at?: string | null
          signal_type: string
          value?: number | null
        }
        Update: {
          confidence?: number
          description?: string | null
          detected_at?: string
          id?: string
          is_resolved?: boolean
          org_id?: string
          product_id?: string
          resolved_at?: string | null
          signal_type?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "demand_signals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demand_signals_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demand_signals_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      digital_download_events: {
        Row: {
          downloaded_at: string
          id: string
          ip_address: string | null
          license_id: string
          user_agent: string | null
        }
        Insert: {
          downloaded_at?: string
          id?: string
          ip_address?: string | null
          license_id: string
          user_agent?: string | null
        }
        Update: {
          downloaded_at?: string
          id?: string
          ip_address?: string | null
          license_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "digital_download_events_license_id_fkey"
            columns: ["license_id"]
            isOneToOne: false
            referencedRelation: "digital_product_licenses"
            referencedColumns: ["id"]
          },
        ]
      }
      digital_product_licenses: {
        Row: {
          amount_paid: number
          created_at: string
          customer_email: string
          customer_id: string | null
          customer_name: string
          download_token: string
          downloads_used: number
          expires_at: string | null
          id: string
          last_downloaded_at: string | null
          license_key: string
          max_downloads: number | null
          org_id: string
          product_id: string
          revoked: boolean
          revoked_reason: string | null
        }
        Insert: {
          amount_paid?: number
          created_at?: string
          customer_email: string
          customer_id?: string | null
          customer_name: string
          download_token: string
          downloads_used?: number
          expires_at?: string | null
          id?: string
          last_downloaded_at?: string | null
          license_key: string
          max_downloads?: number | null
          org_id: string
          product_id: string
          revoked?: boolean
          revoked_reason?: string | null
        }
        Update: {
          amount_paid?: number
          created_at?: string
          customer_email?: string
          customer_id?: string | null
          customer_name?: string
          download_token?: string
          downloads_used?: number
          expires_at?: string | null
          id?: string
          last_downloaded_at?: string | null
          license_key?: string
          max_downloads?: number | null
          org_id?: string
          product_id?: string
          revoked?: boolean
          revoked_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "digital_product_licenses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "digital_product_licenses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "digital_product_licenses_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "digital_products"
            referencedColumns: ["id"]
          },
        ]
      }
      digital_products: {
        Row: {
          active: boolean
          category: string | null
          created_at: string
          currency: string
          description: string | null
          download_limit: number | null
          file_url: string | null
          id: string
          name: string
          org_id: string
          preview_url: string | null
          price: number
          tags: string[]
          total_revenue: number
          total_sold: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          category?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          download_limit?: number | null
          file_url?: string | null
          id?: string
          name: string
          org_id: string
          preview_url?: string | null
          price?: number
          tags?: string[]
          total_revenue?: number
          total_sold?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          download_limit?: number | null
          file_url?: string | null
          id?: string
          name?: string
          org_id?: string
          preview_url?: string | null
          price?: number
          tags?: string[]
          total_revenue?: number
          total_sold?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "digital_products_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_access_log: {
        Row: {
          accessed_at: string
          action: string
          document_id: string
          id: string
          org_id: string
          user_name: string | null
        }
        Insert: {
          accessed_at?: string
          action: string
          document_id: string
          id?: string
          org_id: string
          user_name?: string | null
        }
        Update: {
          accessed_at?: string
          action?: string
          document_id?: string
          id?: string
          org_id?: string
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_access_log_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_access_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_categories: {
        Row: {
          active: boolean
          color: string
          created_at: string
          description: string | null
          id: string
          name: string
          org_id: string
        }
        Insert: {
          active?: boolean
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          org_id: string
        }
        Update: {
          active?: boolean
          color?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_categories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_versions: {
        Row: {
          change_summary: string | null
          created_at: string
          created_by_name: string | null
          document_id: string
          file_name: string | null
          file_size_kb: number | null
          file_url: string | null
          id: string
          org_id: string
          version: string
          version_number: number
        }
        Insert: {
          change_summary?: string | null
          created_at?: string
          created_by_name?: string | null
          document_id: string
          file_name?: string | null
          file_size_kb?: number | null
          file_url?: string | null
          id?: string
          org_id: string
          version: string
          version_number: number
        }
        Update: {
          change_summary?: string | null
          created_at?: string
          created_by_name?: string | null
          document_id?: string
          file_name?: string | null
          file_size_kb?: number | null
          file_url?: string | null
          id?: string
          org_id?: string
          version?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_versions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_versions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          access_level: string
          category_id: string | null
          created_at: string
          description: string | null
          doc_type: string
          download_count: number
          expiry_date: string | null
          file_name: string | null
          file_size_kb: number | null
          file_url: string | null
          id: string
          mime_type: string | null
          notes: string | null
          org_id: string
          signed_at: string | null
          signed_by: string | null
          status: string
          tags: string[] | null
          title: string
          updated_at: string
          uploaded_by: string | null
          uploaded_by_name: string | null
          version: string
          version_number: number
          view_count: number
        }
        Insert: {
          access_level?: string
          category_id?: string | null
          created_at?: string
          description?: string | null
          doc_type?: string
          download_count?: number
          expiry_date?: string | null
          file_name?: string | null
          file_size_kb?: number | null
          file_url?: string | null
          id?: string
          mime_type?: string | null
          notes?: string | null
          org_id: string
          signed_at?: string | null
          signed_by?: string | null
          status?: string
          tags?: string[] | null
          title: string
          updated_at?: string
          uploaded_by?: string | null
          uploaded_by_name?: string | null
          version?: string
          version_number?: number
          view_count?: number
        }
        Update: {
          access_level?: string
          category_id?: string | null
          created_at?: string
          description?: string | null
          doc_type?: string
          download_count?: number
          expiry_date?: string | null
          file_name?: string | null
          file_size_kb?: number | null
          file_url?: string | null
          id?: string
          mime_type?: string | null
          notes?: string | null
          org_id?: string
          signed_at?: string | null
          signed_by?: string | null
          status?: string
          tags?: string[] | null
          title?: string
          updated_at?: string
          uploaded_by?: string | null
          uploaded_by_name?: string | null
          version?: string
          version_number?: number
          view_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "documents_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "document_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      drip_enrollments: {
        Row: {
          completed_at: string | null
          current_step: number
          customer_email: string
          customer_id: string | null
          customer_name: string
          enrolled_at: string
          id: string
          next_send_at: string | null
          org_id: string
          sequence_id: string
          status: string
          total_steps: number
        }
        Insert: {
          completed_at?: string | null
          current_step?: number
          customer_email: string
          customer_id?: string | null
          customer_name?: string
          enrolled_at?: string
          id?: string
          next_send_at?: string | null
          org_id: string
          sequence_id: string
          status?: string
          total_steps?: number
        }
        Update: {
          completed_at?: string | null
          current_step?: number
          customer_email?: string
          customer_id?: string | null
          customer_name?: string
          enrolled_at?: string
          id?: string
          next_send_at?: string | null
          org_id?: string
          sequence_id?: string
          status?: string
          total_steps?: number
        }
        Relationships: [
          {
            foreignKeyName: "drip_enrollments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drip_enrollments_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "drip_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      drip_send_log: {
        Row: {
          enrollment_id: string
          id: string
          sent_at: string
          status: string
          step_id: string
        }
        Insert: {
          enrollment_id: string
          id?: string
          sent_at?: string
          status?: string
          step_id: string
        }
        Update: {
          enrollment_id?: string
          id?: string
          sent_at?: string
          status?: string
          step_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "drip_send_log_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "drip_enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "drip_send_log_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "drip_sequence_steps"
            referencedColumns: ["id"]
          },
        ]
      }
      drip_sequence_steps: {
        Row: {
          body_html: string
          created_at: string
          day_offset: number
          id: string
          org_id: string
          sequence_id: string
          step_order: number
          subject: string
        }
        Insert: {
          body_html: string
          created_at?: string
          day_offset?: number
          id?: string
          org_id: string
          sequence_id: string
          step_order?: number
          subject: string
        }
        Update: {
          body_html?: string
          created_at?: string
          day_offset?: number
          id?: string
          org_id?: string
          sequence_id?: string
          step_order?: number
          subject?: string
        }
        Relationships: [
          {
            foreignKeyName: "drip_sequence_steps_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "drip_sequences"
            referencedColumns: ["id"]
          },
        ]
      }
      drip_sequences: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          org_id: string
          trigger_event: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          org_id: string
          trigger_event?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          trigger_event?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "drip_sequences_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      drip_unsubscribe_tokens: {
        Row: {
          created_at: string
          customer_email: string
          enrollment_id: string
          expires_at: string
          id: string
          ip_address: unknown
          org_id: string
          token: string
          used_at: string | null
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          customer_email: string
          enrollment_id: string
          expires_at?: string
          id?: string
          ip_address?: unknown
          org_id: string
          token: string
          used_at?: string | null
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          customer_email?: string
          enrollment_id?: string
          expires_at?: string
          id?: string
          ip_address?: unknown
          org_id?: string
          token?: string
          used_at?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "drip_unsubscribe_tokens_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "drip_enrollments"
            referencedColumns: ["id"]
          },
        ]
      }
      dropship_order_items: {
        Row: {
          dropship_product_id: string | null
          id: string
          notes: string | null
          order_id: string
          product_name: string
          quantity: number
          sell_price: number
          supplier_price: number
          supplier_sku: string | null
        }
        Insert: {
          dropship_product_id?: string | null
          id?: string
          notes?: string | null
          order_id: string
          product_name: string
          quantity?: number
          sell_price: number
          supplier_price: number
          supplier_sku?: string | null
        }
        Update: {
          dropship_product_id?: string | null
          id?: string
          notes?: string | null
          order_id?: string
          product_name?: string
          quantity?: number
          sell_price?: number
          supplier_price?: number
          supplier_sku?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dropship_order_items_dropship_product_id_fkey"
            columns: ["dropship_product_id"]
            isOneToOne: false
            referencedRelation: "dropship_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dropship_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "dropship_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      dropship_orders: {
        Row: {
          created_at: string
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          delivered_at: string | null
          dispatched_at: string | null
          estimated_delivery: string | null
          id: string
          notes: string | null
          order_number: string
          org_id: string
          profit: number | null
          sell_total: number
          ship_address: string | null
          ship_city: string | null
          ship_province: string | null
          ship_zip: string | null
          status: string
          supplier_id: string
          supplier_order_ref: string | null
          supplier_total: number
          tracking_code: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          customer_name: string
          customer_phone?: string | null
          delivered_at?: string | null
          dispatched_at?: string | null
          estimated_delivery?: string | null
          id?: string
          notes?: string | null
          order_number: string
          org_id: string
          profit?: number | null
          sell_total?: number
          ship_address?: string | null
          ship_city?: string | null
          ship_province?: string | null
          ship_zip?: string | null
          status?: string
          supplier_id: string
          supplier_order_ref?: string | null
          supplier_total?: number
          tracking_code?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string | null
          delivered_at?: string | null
          dispatched_at?: string | null
          estimated_delivery?: string | null
          id?: string
          notes?: string | null
          order_number?: string
          org_id?: string
          profit?: number | null
          sell_total?: number
          ship_address?: string | null
          ship_city?: string | null
          ship_province?: string | null
          ship_zip?: string | null
          status?: string
          supplier_id?: string
          supplier_order_ref?: string | null
          supplier_total?: number
          tracking_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dropship_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dropship_orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dropship_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "dropship_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      dropship_products: {
        Row: {
          active: boolean
          created_at: string
          id: string
          margin_pct: number | null
          notes: string | null
          org_id: string
          product_id: string | null
          sell_price: number
          stock_status: string
          supplier_id: string
          supplier_price: number
          supplier_sku: string | null
          supplier_url: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          margin_pct?: number | null
          notes?: string | null
          org_id: string
          product_id?: string | null
          sell_price?: number
          stock_status?: string
          supplier_id: string
          supplier_price?: number
          supplier_sku?: string | null
          supplier_url?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          margin_pct?: number | null
          notes?: string | null
          org_id?: string
          product_id?: string | null
          sell_price?: number
          stock_status?: string
          supplier_id?: string
          supplier_price?: number
          supplier_sku?: string | null
          supplier_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dropship_products_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dropship_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dropship_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dropship_products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "dropship_suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      dropship_suppliers: {
        Row: {
          active: boolean
          avg_dispatch_days: number
          commission_pct: number
          contact_name: string | null
          country: string
          created_at: string
          currency: string
          email: string | null
          id: string
          name: string
          notes: string | null
          org_id: string
          payment_terms: string | null
          phone: string | null
          website: string | null
        }
        Insert: {
          active?: boolean
          avg_dispatch_days?: number
          commission_pct?: number
          contact_name?: string | null
          country?: string
          created_at?: string
          currency?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          org_id: string
          payment_terms?: string | null
          phone?: string | null
          website?: string | null
        }
        Update: {
          active?: boolean
          avg_dispatch_days?: number
          commission_pct?: number
          contact_name?: string | null
          country?: string
          created_at?: string
          currency?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          org_id?: string
          payment_terms?: string | null
          phone?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dropship_suppliers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ecommerce_cart_sessions: {
        Row: {
          abandoned_email_sent: boolean
          converted_at: string | null
          coupon_code: string | null
          created_at: string
          customer_email: string | null
          customer_id: string | null
          discount_amount: number
          expires_at: string
          id: string
          ip_address: string | null
          items: Json
          org_id: string
          session_token: string
          shipping_cost: number
          status: string
          store_id: string
          subtotal: number
          total: number
          updated_at: string
          user_agent: string | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
        }
        Insert: {
          abandoned_email_sent?: boolean
          converted_at?: string | null
          coupon_code?: string | null
          created_at?: string
          customer_email?: string | null
          customer_id?: string | null
          discount_amount?: number
          expires_at?: string
          id?: string
          ip_address?: string | null
          items?: Json
          org_id: string
          session_token?: string
          shipping_cost?: number
          status?: string
          store_id: string
          subtotal?: number
          total?: number
          updated_at?: string
          user_agent?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Update: {
          abandoned_email_sent?: boolean
          converted_at?: string | null
          coupon_code?: string | null
          created_at?: string
          customer_email?: string | null
          customer_id?: string | null
          discount_amount?: number
          expires_at?: string
          id?: string
          ip_address?: string | null
          items?: Json
          org_id?: string
          session_token?: string
          shipping_cost?: number
          status?: string
          store_id?: string
          subtotal?: number
          total?: number
          updated_at?: string
          user_agent?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ecommerce_cart_sessions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecommerce_cart_sessions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecommerce_cart_sessions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "ecommerce_funnel"
            referencedColumns: ["store_id"]
          },
          {
            foreignKeyName: "ecommerce_cart_sessions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "ecommerce_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      ecommerce_categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          org_id: string
          parent_id: string | null
          slug: string
          sort_order: number
          store_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          org_id: string
          parent_id?: string | null
          slug: string
          sort_order?: number
          store_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          org_id?: string
          parent_id?: string | null
          slug?: string
          sort_order?: number
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ecommerce_categories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecommerce_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "ecommerce_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecommerce_categories_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "ecommerce_funnel"
            referencedColumns: ["store_id"]
          },
          {
            foreignKeyName: "ecommerce_categories_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "ecommerce_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      ecommerce_orders: {
        Row: {
          billing_address: Json
          carrier: string | null
          cart_session_id: string | null
          coupon_code: string | null
          created_at: string
          customer_email: string
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          discount_amount: number
          fulfillment_status: string
          id: string
          items: Json
          notes: string | null
          order_number: string
          org_id: string
          payment_method: string
          payment_status: string
          shipping_address: Json
          shipping_cost: number
          store_id: string
          subtotal: number
          tags: string[]
          tax_amount: number
          total: number
          tracking_number: string | null
          updated_at: string
          utm_source: string | null
        }
        Insert: {
          billing_address?: Json
          carrier?: string | null
          cart_session_id?: string | null
          coupon_code?: string | null
          created_at?: string
          customer_email: string
          customer_id?: string | null
          customer_name: string
          customer_phone?: string | null
          discount_amount?: number
          fulfillment_status?: string
          id?: string
          items?: Json
          notes?: string | null
          order_number: string
          org_id: string
          payment_method?: string
          payment_status?: string
          shipping_address?: Json
          shipping_cost?: number
          store_id: string
          subtotal?: number
          tags?: string[]
          tax_amount?: number
          total?: number
          tracking_number?: string | null
          updated_at?: string
          utm_source?: string | null
        }
        Update: {
          billing_address?: Json
          carrier?: string | null
          cart_session_id?: string | null
          coupon_code?: string | null
          created_at?: string
          customer_email?: string
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string | null
          discount_amount?: number
          fulfillment_status?: string
          id?: string
          items?: Json
          notes?: string | null
          order_number?: string
          org_id?: string
          payment_method?: string
          payment_status?: string
          shipping_address?: Json
          shipping_cost?: number
          store_id?: string
          subtotal?: number
          tags?: string[]
          tax_amount?: number
          total?: number
          tracking_number?: string | null
          updated_at?: string
          utm_source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ecommerce_orders_cart_session_id_fkey"
            columns: ["cart_session_id"]
            isOneToOne: false
            referencedRelation: "ecommerce_cart_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecommerce_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecommerce_orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ecommerce_orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "ecommerce_funnel"
            referencedColumns: ["store_id"]
          },
          {
            foreignKeyName: "ecommerce_orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "ecommerce_stores"
            referencedColumns: ["id"]
          },
        ]
      }
      ecommerce_stores: {
        Row: {
          banner_url: string | null
          created_at: string
          currency: string
          custom_domain: string | null
          description: string | null
          domain: string | null
          free_shipping_above: number | null
          id: string
          is_active: boolean
          logo_url: string | null
          meta_description: string | null
          meta_title: string | null
          name: string
          org_id: string
          payment_methods: string[]
          primary_color: string
          shipping_cost: number
          slug: string
          social_links: Json
          tax_included: boolean
          theme: string
        }
        Insert: {
          banner_url?: string | null
          created_at?: string
          currency?: string
          custom_domain?: string | null
          description?: string | null
          domain?: string | null
          free_shipping_above?: number | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          meta_description?: string | null
          meta_title?: string | null
          name?: string
          org_id: string
          payment_methods?: string[]
          primary_color?: string
          shipping_cost?: number
          slug: string
          social_links?: Json
          tax_included?: boolean
          theme?: string
        }
        Update: {
          banner_url?: string | null
          created_at?: string
          currency?: string
          custom_domain?: string | null
          description?: string | null
          domain?: string | null
          free_shipping_above?: number | null
          id?: string
          is_active?: boolean
          logo_url?: string | null
          meta_description?: string | null
          meta_title?: string | null
          name?: string
          org_id?: string
          payment_methods?: string[]
          primary_color?: string
          shipping_cost?: number
          slug?: string
          social_links?: Json
          tax_included?: boolean
          theme?: string
        }
        Relationships: [
          {
            foreignKeyName: "ecommerce_stores_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaigns: {
        Row: {
          body_html: string
          click_count: number
          coupon_code: string | null
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
          coupon_code?: string | null
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
          coupon_code?: string | null
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
      email_suppressions: {
        Row: {
          created_at: string
          email: string
          id: string
          org_id: string
          reason: string
          source: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          org_id: string
          reason?: string
          source?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          org_id?: string
          reason?: string
          source?: string | null
        }
        Relationships: []
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
      employees: {
        Row: {
          active: boolean
          created_at: string
          department: string | null
          email: string | null
          hired_at: string | null
          hourly_rate: number
          id: string
          name: string
          org_id: string
          phone: string | null
          position: string | null
          salary_type: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          department?: string | null
          email?: string | null
          hired_at?: string | null
          hourly_rate?: number
          id?: string
          name: string
          org_id: string
          phone?: string | null
          position?: string | null
          salary_type?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          department?: string | null
          email?: string | null
          hired_at?: string | null
          hourly_rate?: number
          id?: string
          name?: string
          org_id?: string
          phone?: string | null
          position?: string | null
          salary_type?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      event_attendees: {
        Row: {
          amount_paid: number
          checked_in_at: string | null
          created_at: string
          customer_id: string | null
          email: string | null
          event_id: string
          id: string
          name: string
          notes: string | null
          org_id: string
          phone: string | null
          quantity: number
          status: string
          ticket_code: string
          ticket_type_id: string
        }
        Insert: {
          amount_paid?: number
          checked_in_at?: string | null
          created_at?: string
          customer_id?: string | null
          email?: string | null
          event_id: string
          id?: string
          name: string
          notes?: string | null
          org_id: string
          phone?: string | null
          quantity?: number
          status?: string
          ticket_code?: string
          ticket_type_id: string
        }
        Update: {
          amount_paid?: number
          checked_in_at?: string | null
          created_at?: string
          customer_id?: string | null
          email?: string | null
          event_id?: string
          id?: string
          name?: string
          notes?: string | null
          org_id?: string
          phone?: string | null
          quantity?: number
          status?: string
          ticket_code?: string
          ticket_type_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_attendees_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_attendees_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_attendees_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_attendees_ticket_type_id_fkey"
            columns: ["ticket_type_id"]
            isOneToOne: false
            referencedRelation: "ticket_types"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          capacity: number
          cover_image_url: string | null
          created_at: string
          description: string | null
          end_date: string | null
          event_date: string
          id: string
          location: string | null
          name: string
          org_id: string
          status: string
          tags: string[]
          tickets_sold: number
          updated_at: string
          venue_name: string | null
        }
        Insert: {
          capacity?: number
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          event_date: string
          id?: string
          location?: string | null
          name: string
          org_id: string
          status?: string
          tags?: string[]
          tickets_sold?: number
          updated_at?: string
          venue_name?: string | null
        }
        Update: {
          capacity?: number
          cover_image_url?: string | null
          created_at?: string
          description?: string | null
          end_date?: string | null
          event_date?: string
          id?: string
          location?: string | null
          name?: string
          org_id?: string
          status?: string
          tags?: string[]
          tickets_sold?: number
          updated_at?: string
          venue_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_org_id_fkey"
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
      exchange_rates: {
        Row: {
          base_currency: string
          brl_ars: number
          created_at: string
          date: string
          eur_ars: number
          id: string
          notes: string | null
          org_id: string
          source: string
          usd_ars: number
        }
        Insert: {
          base_currency?: string
          brl_ars?: number
          created_at?: string
          date: string
          eur_ars?: number
          id?: string
          notes?: string | null
          org_id: string
          source?: string
          usd_ars?: number
        }
        Update: {
          base_currency?: string
          brl_ars?: number
          created_at?: string
          date?: string
          eur_ars?: number
          id?: string
          notes?: string | null
          org_id?: string
          source?: string
          usd_ars?: number
        }
        Relationships: [
          {
            foreignKeyName: "exchange_rates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          location_id: string | null
          org_id: string
          receipt_url: string | null
          recurring: boolean
          recurring_frequency: string | null
          recurring_next_date: string | null
          updated_at: string
          user_id: string
          vendor: string | null
        }
        Insert: {
          amount_ars?: number
          category?: string
          created_at?: string
          date?: string
          description?: string | null
          id?: string
          last_auto_created_at?: string | null
          location_id?: string | null
          org_id: string
          receipt_url?: string | null
          recurring?: boolean
          recurring_frequency?: string | null
          recurring_next_date?: string | null
          updated_at?: string
          user_id: string
          vendor?: string | null
        }
        Update: {
          amount_ars?: number
          category?: string
          created_at?: string
          date?: string
          description?: string | null
          id?: string
          last_auto_created_at?: string | null
          location_id?: string | null
          org_id?: string
          receipt_url?: string | null
          recurring?: boolean
          recurring_frequency?: string | null
          recurring_next_date?: string | null
          updated_at?: string
          user_id?: string
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_line_items: {
        Row: {
          category: string
          created_at: string
          formula: string | null
          id: string
          is_subtotal: boolean
          name: string
          notes: string | null
          org_id: string
          parent_id: string | null
          scenario_id: string
          sort_order: number
          unit: string
          values: Json
        }
        Insert: {
          category: string
          created_at?: string
          formula?: string | null
          id?: string
          is_subtotal?: boolean
          name: string
          notes?: string | null
          org_id: string
          parent_id?: string | null
          scenario_id: string
          sort_order?: number
          unit?: string
          values?: Json
        }
        Update: {
          category?: string
          created_at?: string
          formula?: string | null
          id?: string
          is_subtotal?: boolean
          name?: string
          notes?: string | null
          org_id?: string
          parent_id?: string | null
          scenario_id?: string
          sort_order?: number
          unit?: string
          values?: Json
        }
        Relationships: [
          {
            foreignKeyName: "financial_line_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_line_items_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "financial_line_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_line_items_scenario_id_fkey"
            columns: ["scenario_id"]
            isOneToOne: false
            referencedRelation: "financial_scenarios"
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
      financial_scenarios: {
        Row: {
          assumptions: Json
          base_period: string
          created_at: string
          currency: string
          description: string | null
          end_date: string
          id: string
          is_baseline: boolean
          name: string
          org_id: string
          scenario_type: string
          start_date: string
          updated_at: string
        }
        Insert: {
          assumptions?: Json
          base_period?: string
          created_at?: string
          currency?: string
          description?: string | null
          end_date: string
          id?: string
          is_baseline?: boolean
          name: string
          org_id: string
          scenario_type?: string
          start_date: string
          updated_at?: string
        }
        Update: {
          assumptions?: Json
          base_period?: string
          created_at?: string
          currency?: string
          description?: string | null
          end_date?: string
          id?: string
          is_baseline?: boolean
          name?: string
          org_id?: string
          scenario_type?: string
          start_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_scenarios_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      fixed_assets: {
        Row: {
          active: boolean
          annual_rate_pct: number | null
          asset_number: string | null
          assigned_to: string | null
          category: string
          created_at: string
          depreciation_method: string
          description: string | null
          disposal_value: number | null
          disposed_at: string | null
          id: string
          invoice_number: string | null
          location: string | null
          name: string
          notes: string | null
          org_id: string
          purchase_cost: number
          purchase_date: string
          salvage_value: number
          status: string
          supplier_name: string | null
          updated_at: string
          useful_life_years: number
          warranty_expiry: string | null
        }
        Insert: {
          active?: boolean
          annual_rate_pct?: number | null
          asset_number?: string | null
          assigned_to?: string | null
          category?: string
          created_at?: string
          depreciation_method?: string
          description?: string | null
          disposal_value?: number | null
          disposed_at?: string | null
          id?: string
          invoice_number?: string | null
          location?: string | null
          name: string
          notes?: string | null
          org_id: string
          purchase_cost?: number
          purchase_date?: string
          salvage_value?: number
          status?: string
          supplier_name?: string | null
          updated_at?: string
          useful_life_years?: number
          warranty_expiry?: string | null
        }
        Update: {
          active?: boolean
          annual_rate_pct?: number | null
          asset_number?: string | null
          assigned_to?: string | null
          category?: string
          created_at?: string
          depreciation_method?: string
          description?: string | null
          disposal_value?: number | null
          disposed_at?: string | null
          id?: string
          invoice_number?: string | null
          location?: string | null
          name?: string
          notes?: string | null
          org_id?: string
          purchase_cost?: number
          purchase_date?: string
          salvage_value?: number
          status?: string
          supplier_name?: string | null
          updated_at?: string
          useful_life_years?: number
          warranty_expiry?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fixed_assets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      forecast_accuracy: {
        Row: {
          accuracy_pct: number | null
          actual_revenue: number
          actual_units: number
          forecast_id: string
          id: string
          measured_at: string
          org_id: string
          predicted_units_snap: number
        }
        Insert: {
          accuracy_pct?: number | null
          actual_revenue?: number
          actual_units?: number
          forecast_id: string
          id?: string
          measured_at?: string
          org_id: string
          predicted_units_snap?: number
        }
        Update: {
          accuracy_pct?: number | null
          actual_revenue?: number
          actual_units?: number
          forecast_id?: string
          id?: string
          measured_at?: string
          org_id?: string
          predicted_units_snap?: number
        }
        Relationships: [
          {
            foreignKeyName: "forecast_accuracy_forecast_id_fkey"
            columns: ["forecast_id"]
            isOneToOne: false
            referencedRelation: "sales_forecasts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forecast_accuracy_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      forecast_configs: {
        Row: {
          created_at: string
          id: string
          lead_time_days: number
          model_type: string
          org_id: string
          product_id: string | null
          reorder_point: number
          safety_stock: number
          seasonality_period: number
          smoothing_alpha: number
          trend_damping: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          lead_time_days?: number
          model_type?: string
          org_id: string
          product_id?: string | null
          reorder_point?: number
          safety_stock?: number
          seasonality_period?: number
          smoothing_alpha?: number
          trend_damping?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          lead_time_days?: number
          model_type?: string
          org_id?: string
          product_id?: string | null
          reorder_point?: number
          safety_stock?: number
          seasonality_period?: number
          smoothing_alpha?: number
          trend_damping?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "forecast_configs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forecast_configs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "forecast_configs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      form_responses: {
        Row: {
          data: Json
          form_id: string
          id: string
          ip_address: string | null
          org_id: string
          referrer: string | null
          submitted_at: string
          user_agent: string | null
        }
        Insert: {
          data?: Json
          form_id: string
          id?: string
          ip_address?: string | null
          org_id: string
          referrer?: string | null
          submitted_at?: string
          user_agent?: string | null
        }
        Update: {
          data?: Json
          form_id?: string
          id?: string
          ip_address?: string | null
          org_id?: string
          referrer?: string | null
          submitted_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_responses_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "custom_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_responses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gamification_badges: {
        Row: {
          category: string
          code: string
          condition_type: string
          created_at: string
          description: string
          icon: string
          id: string
          is_active: boolean
          name: string
          org_id: string
          rarity: string
          threshold: number
          xp_reward: number
        }
        Insert: {
          category?: string
          code: string
          condition_type: string
          created_at?: string
          description: string
          icon?: string
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          rarity?: string
          threshold?: number
          xp_reward?: number
        }
        Update: {
          category?: string
          code?: string
          condition_type?: string
          created_at?: string
          description?: string
          icon?: string
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          rarity?: string
          threshold?: number
          xp_reward?: number
        }
        Relationships: [
          {
            foreignKeyName: "gamification_badges_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gamification_challenges: {
        Row: {
          badge_reward: string | null
          challenge_type: string
          created_at: string
          description: string
          end_date: string
          id: string
          is_active: boolean
          metric: string
          name: string
          org_id: string
          participants: string[]
          progress: Json
          start_date: string
          target_value: number
          xp_reward: number
        }
        Insert: {
          badge_reward?: string | null
          challenge_type: string
          created_at?: string
          description: string
          end_date: string
          id?: string
          is_active?: boolean
          metric: string
          name: string
          org_id: string
          participants?: string[]
          progress?: Json
          start_date: string
          target_value: number
          xp_reward?: number
        }
        Update: {
          badge_reward?: string | null
          challenge_type?: string
          created_at?: string
          description?: string
          end_date?: string
          id?: string
          is_active?: boolean
          metric?: string
          name?: string
          org_id?: string
          participants?: string[]
          progress?: Json
          start_date?: string
          target_value?: number
          xp_reward?: number
        }
        Relationships: [
          {
            foreignKeyName: "gamification_challenges_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gamification_config: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          level_names: string[]
          level_thresholds: number[]
          org_id: string
          reset_cycle: string
          streak_bonus_pct: number
          xp_new_customer: number
          xp_per_1000_revenue: number
          xp_per_sale: number
          xp_upsell: number
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          level_names?: string[]
          level_thresholds?: number[]
          org_id: string
          reset_cycle?: string
          streak_bonus_pct?: number
          xp_new_customer?: number
          xp_per_1000_revenue?: number
          xp_per_sale?: number
          xp_upsell?: number
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          level_names?: string[]
          level_thresholds?: number[]
          org_id?: string
          reset_cycle?: string
          streak_bonus_pct?: number
          xp_new_customer?: number
          xp_per_1000_revenue?: number
          xp_per_sale?: number
          xp_upsell?: number
        }
        Relationships: [
          {
            foreignKeyName: "gamification_config_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gamification_events: {
        Row: {
          created_at: string
          description: string | null
          event_type: string
          id: string
          metadata: Json
          org_id: string
          user_id: string
          xp_earned: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          event_type: string
          id?: string
          metadata?: Json
          org_id: string
          user_id: string
          xp_earned?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          event_type?: string
          id?: string
          metadata?: Json
          org_id?: string
          user_id?: string
          xp_earned?: number
        }
        Relationships: [
          {
            foreignKeyName: "gamification_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gamification_profiles: {
        Row: {
          badges_earned: string[]
          current_level: number
          current_streak: number
          id: string
          last_sale_date: string | null
          longest_streak: number
          org_id: string
          rank_position: number | null
          stats: Json
          total_xp: number
          updated_at: string
          user_id: string
        }
        Insert: {
          badges_earned?: string[]
          current_level?: number
          current_streak?: number
          id?: string
          last_sale_date?: string | null
          longest_streak?: number
          org_id: string
          rank_position?: number | null
          stats?: Json
          total_xp?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          badges_earned?: string[]
          current_level?: number
          current_streak?: number
          id?: string
          last_sale_date?: string | null
          longest_streak?: number
          org_id?: string
          rank_position?: number | null
          stats?: Json
          total_xp?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gamification_profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gift_card_transactions: {
        Row: {
          amount: number
          balance_after: number
          balance_before: number
          created_at: string
          gift_card_id: string
          id: string
          notes: string | null
          org_id: string
          performed_by: string | null
          reference_id: string | null
          reference_type: string | null
          transaction_type: string
        }
        Insert: {
          amount: number
          balance_after: number
          balance_before: number
          created_at?: string
          gift_card_id: string
          id?: string
          notes?: string | null
          org_id: string
          performed_by?: string | null
          reference_id?: string | null
          reference_type?: string | null
          transaction_type: string
        }
        Update: {
          amount?: number
          balance_after?: number
          balance_before?: number
          created_at?: string
          gift_card_id?: string
          id?: string
          notes?: string | null
          org_id?: string
          performed_by?: string | null
          reference_id?: string | null
          reference_type?: string | null
          transaction_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "gift_card_transactions_gift_card_id_fkey"
            columns: ["gift_card_id"]
            isOneToOne: false
            referencedRelation: "gift_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_card_transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gift_cards: {
        Row: {
          activated_at: string | null
          code: string
          created_at: string
          currency: string
          current_balance: number
          design: string
          expiry_date: string | null
          fully_used_at: string | null
          id: string
          initial_balance: number
          issued_to_email: string | null
          issued_to_name: string | null
          notes: string | null
          org_id: string
          purchased_by_customer_id: string | null
          sale_price: number | null
          status: string
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          code: string
          created_at?: string
          currency?: string
          current_balance?: number
          design?: string
          expiry_date?: string | null
          fully_used_at?: string | null
          id?: string
          initial_balance?: number
          issued_to_email?: string | null
          issued_to_name?: string | null
          notes?: string | null
          org_id: string
          purchased_by_customer_id?: string | null
          sale_price?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          code?: string
          created_at?: string
          currency?: string
          current_balance?: number
          design?: string
          expiry_date?: string | null
          fully_used_at?: string | null
          id?: string
          initial_balance?: number
          issued_to_email?: string | null
          issued_to_name?: string | null
          notes?: string | null
          org_id?: string
          purchased_by_customer_id?: string | null
          sale_price?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gift_cards_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_cards_purchased_by_customer_id_fkey"
            columns: ["purchased_by_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      hashtag_sets: {
        Row: {
          created_at: string
          hashtags: string[]
          id: string
          name: string
          org_id: string
          platform: string
        }
        Insert: {
          created_at?: string
          hashtags?: string[]
          id?: string
          name: string
          org_id: string
          platform?: string
        }
        Update: {
          created_at?: string
          hashtags?: string[]
          id?: string
          name?: string
          org_id?: string
          platform?: string
        }
        Relationships: [
          {
            foreignKeyName: "hashtag_sets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      iibb_registrations: {
        Row: {
          active: boolean
          created_at: string
          cuit: string | null
          id: string
          org_id: string
          province: string
          rate_pct: number
          regime: string
          registration_number: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          cuit?: string | null
          id?: string
          org_id: string
          province: string
          rate_pct?: number
          regime?: string
          registration_number?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          cuit?: string | null
          id?: string
          org_id?: string
          province?: string
          rate_pct?: number
          regime?: string
          registration_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "iibb_registrations_org_id_fkey"
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
          content_submitted_at: string | null
          content_url: string | null
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
          portal_token: string | null
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
          content_submitted_at?: string | null
          content_url?: string | null
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
          portal_token?: string | null
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
          content_submitted_at?: string | null
          content_url?: string | null
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
          portal_token?: string | null
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
      inventory_abc: {
        Row: {
          abc_class: string
          analysis_date: string
          cumulative_pct: number
          days_on_hand: number
          eoq: number
          id: string
          org_id: string
          period_days: number
          product_id: string
          reorder_point: number
          revenue_pct: number
          safety_stock: number
          stockout_risk: string
          total_orders: number
          total_revenue: number
          total_units: number
          velocity: string
          xyz_class: string | null
        }
        Insert: {
          abc_class?: string
          analysis_date?: string
          cumulative_pct?: number
          days_on_hand?: number
          eoq?: number
          id?: string
          org_id: string
          period_days?: number
          product_id: string
          reorder_point?: number
          revenue_pct?: number
          safety_stock?: number
          stockout_risk?: string
          total_orders?: number
          total_revenue?: number
          total_units?: number
          velocity?: string
          xyz_class?: string | null
        }
        Update: {
          abc_class?: string
          analysis_date?: string
          cumulative_pct?: number
          days_on_hand?: number
          eoq?: number
          id?: string
          org_id?: string
          period_days?: number
          product_id?: string
          reorder_point?: number
          revenue_pct?: number
          safety_stock?: number
          stockout_risk?: string
          total_orders?: number
          total_revenue?: number
          total_units?: number
          velocity?: string
          xyz_class?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_abc_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_abc_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_abc_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_snapshots: {
        Row: {
          avg_daily_sales: number
          created_at: string
          id: string
          org_id: string
          product_id: string
          snapshot_date: string
          stock_quantity: number
          stock_value: number
        }
        Insert: {
          avg_daily_sales?: number
          created_at?: string
          id?: string
          org_id: string
          product_id: string
          snapshot_date?: string
          stock_quantity?: number
          stock_value?: number
        }
        Update: {
          avg_daily_sales?: number
          created_at?: string
          id?: string
          org_id?: string
          product_id?: string
          snapshot_date?: string
          stock_quantity?: number
          stock_value?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_snapshots_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_snapshots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_snapshots_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_transfer_items: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          org_id: string
          product_id: string
          product_name: string
          quantity_received: number
          quantity_sent: number
          transfer_id: string
          unit_cost: number
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          org_id: string
          product_id: string
          product_name: string
          quantity_received?: number
          quantity_sent?: number
          transfer_id: string
          unit_cost?: number
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          org_id?: string
          product_id?: string
          product_name?: string
          quantity_received?: number
          quantity_sent?: number
          transfer_id?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transfer_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transfer_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transfer_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_transfer_items_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "inventory_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_transfers: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          from_location: string
          id: string
          notes: string | null
          org_id: string
          reason: string | null
          received_at: string | null
          sent_at: string | null
          status: string
          to_location: string
          transfer_number: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          from_location: string
          id?: string
          notes?: string | null
          org_id: string
          reason?: string | null
          received_at?: string | null
          sent_at?: string | null
          status?: string
          to_location: string
          transfer_number: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          from_location?: string
          id?: string
          notes?: string | null
          org_id?: string
          reason?: string | null
          received_at?: string | null
          sent_at?: string | null
          status?: string
          to_location?: string
          transfer_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_transfers_org_id_fkey"
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
      journey_automations: {
        Row: {
          action_config: Json
          action_type: string
          created_at: string
          delay_hours: number
          description: string | null
          id: string
          is_active: boolean
          last_run_at: string | null
          name: string
          org_id: string
          run_count: number
          trigger_config: Json
          trigger_type: string
        }
        Insert: {
          action_config?: Json
          action_type: string
          created_at?: string
          delay_hours?: number
          description?: string | null
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          name: string
          org_id: string
          run_count?: number
          trigger_config?: Json
          trigger_type: string
        }
        Update: {
          action_config?: Json
          action_type?: string
          created_at?: string
          delay_hours?: number
          description?: string | null
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          name?: string
          org_id?: string
          run_count?: number
          trigger_config?: Json
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "journey_automations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      journey_stages: {
        Row: {
          color: string
          created_at: string
          description: string | null
          entry_criteria: Json
          exit_criteria: Json
          id: string
          is_active: boolean
          name: string
          org_id: string
          sort_order: number
          stage_type: string
        }
        Insert: {
          color?: string
          created_at?: string
          description?: string | null
          entry_criteria?: Json
          exit_criteria?: Json
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          sort_order?: number
          stage_type: string
        }
        Update: {
          color?: string
          created_at?: string
          description?: string | null
          entry_criteria?: Json
          exit_criteria?: Json
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          sort_order?: number
          stage_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "journey_stages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      kb_articles: {
        Row: {
          category: string
          content: string
          created_at: string
          helpful_count: number
          id: string
          org_id: string
          published: boolean
          slug: string
          tags: string[] | null
          title: string
          updated_at: string
          view_count: number
          visibility: string
        }
        Insert: {
          category?: string
          content: string
          created_at?: string
          helpful_count?: number
          id?: string
          org_id: string
          published?: boolean
          slug: string
          tags?: string[] | null
          title: string
          updated_at?: string
          view_count?: number
          visibility?: string
        }
        Update: {
          category?: string
          content?: string
          created_at?: string
          helpful_count?: number
          id?: string
          org_id?: string
          published?: boolean
          slug?: string
          tags?: string[] | null
          title?: string
          updated_at?: string
          view_count?: number
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "kb_articles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_alerts: {
        Row: {
          condition: string
          created_at: string
          id: string
          is_active: boolean
          last_triggered: string | null
          name: string
          notification_type: string
          org_id: string
          threshold: number
          widget_id: string | null
        }
        Insert: {
          condition: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_triggered?: string | null
          name: string
          notification_type?: string
          org_id: string
          threshold: number
          widget_id?: string | null
        }
        Update: {
          condition?: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_triggered?: string | null
          name?: string
          notification_type?: string
          org_id?: string
          threshold?: number
          widget_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kpi_alerts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_alerts_widget_id_fkey"
            columns: ["widget_id"]
            isOneToOne: false
            referencedRelation: "kpi_widgets"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_dashboards: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_default: boolean
          layout: Json
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          layout?: Json
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_default?: boolean
          layout?: Json
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "kpi_dashboards_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_goals: {
        Row: {
          color: string
          created_at: string
          current_value: number
          id: string
          metric: string
          name: string
          notes: string | null
          org_id: string
          period_end: string
          period_start: string
          status: string
          target_value: number
          unit: string
          widget_id: string | null
        }
        Insert: {
          color?: string
          created_at?: string
          current_value?: number
          id?: string
          metric: string
          name: string
          notes?: string | null
          org_id: string
          period_end: string
          period_start: string
          status?: string
          target_value: number
          unit?: string
          widget_id?: string | null
        }
        Update: {
          color?: string
          created_at?: string
          current_value?: number
          id?: string
          metric?: string
          name?: string
          notes?: string | null
          org_id?: string
          period_end?: string
          period_start?: string
          status?: string
          target_value?: number
          unit?: string
          widget_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kpi_goals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_goals_widget_id_fkey"
            columns: ["widget_id"]
            isOneToOne: false
            referencedRelation: "kpi_widgets"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_widgets: {
        Row: {
          created_at: string
          custom_from: string | null
          custom_sql: string | null
          custom_to: string | null
          dashboard_id: string
          data_source: string
          display_config: Json
          filters: Json
          height: number
          id: string
          is_visible: boolean
          org_id: string
          position_x: number
          position_y: number
          time_range: string
          title: string
          updated_at: string
          widget_type: string
          width: number
        }
        Insert: {
          created_at?: string
          custom_from?: string | null
          custom_sql?: string | null
          custom_to?: string | null
          dashboard_id: string
          data_source: string
          display_config?: Json
          filters?: Json
          height?: number
          id?: string
          is_visible?: boolean
          org_id: string
          position_x?: number
          position_y?: number
          time_range?: string
          title: string
          updated_at?: string
          widget_type: string
          width?: number
        }
        Update: {
          created_at?: string
          custom_from?: string | null
          custom_sql?: string | null
          custom_to?: string | null
          dashboard_id?: string
          data_source?: string
          display_config?: Json
          filters?: Json
          height?: number
          id?: string
          is_visible?: boolean
          org_id?: string
          position_x?: number
          position_y?: number
          time_range?: string
          title?: string
          updated_at?: string
          widget_type?: string
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "kpi_widgets_dashboard_id_fkey"
            columns: ["dashboard_id"]
            isOneToOne: false
            referencedRelation: "kpi_dashboards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_widgets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      marketplace_channels: {
        Row: {
          access_token: string | null
          api_key: string | null
          channel: string
          created_at: string
          id: string
          is_active: boolean
          last_synced_at: string | null
          org_id: string
          refresh_token: string | null
          store_name: string
          store_url: string | null
        }
        Insert: {
          access_token?: string | null
          api_key?: string | null
          channel: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          org_id: string
          refresh_token?: string | null
          store_name: string
          store_url?: string | null
        }
        Update: {
          access_token?: string | null
          api_key?: string | null
          channel?: string
          created_at?: string
          id?: string
          is_active?: boolean
          last_synced_at?: string | null
          org_id?: string
          refresh_token?: string | null
          store_name?: string
          store_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_channels_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_listings: {
        Row: {
          channel_id: string
          commission_pct: number
          condition: string
          created_at: string
          currency: string
          description: string | null
          external_id: string | null
          id: string
          last_synced_at: string | null
          listing_url: string | null
          notes: string | null
          org_id: string
          original_price: number | null
          price: number
          product_id: string | null
          revenue: number
          sales_count: number
          shipping_cost: number | null
          status: string
          stock: number
          thumbnail_url: string | null
          title: string
          updated_at: string
          views: number
        }
        Insert: {
          channel_id: string
          commission_pct?: number
          condition?: string
          created_at?: string
          currency?: string
          description?: string | null
          external_id?: string | null
          id?: string
          last_synced_at?: string | null
          listing_url?: string | null
          notes?: string | null
          org_id: string
          original_price?: number | null
          price?: number
          product_id?: string | null
          revenue?: number
          sales_count?: number
          shipping_cost?: number | null
          status?: string
          stock?: number
          thumbnail_url?: string | null
          title: string
          updated_at?: string
          views?: number
        }
        Update: {
          channel_id?: string
          commission_pct?: number
          condition?: string
          created_at?: string
          currency?: string
          description?: string | null
          external_id?: string | null
          id?: string
          last_synced_at?: string | null
          listing_url?: string | null
          notes?: string | null
          org_id?: string
          original_price?: number | null
          price?: number
          product_id?: string | null
          revenue?: number
          sales_count?: number
          shipping_cost?: number | null
          status?: string
          stock?: number
          thumbnail_url?: string | null
          title?: string
          updated_at?: string
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_listings_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "marketplace_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_listings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_listings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_listings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_orders: {
        Row: {
          buyer_email: string | null
          buyer_name: string | null
          channel_id: string
          commission: number
          created_at: string
          external_order_id: string | null
          id: string
          listing_id: string | null
          net_amount: number
          notes: string | null
          order_date: string
          org_id: string
          quantity: number
          shipping_status: string | null
          status: string
          total_amount: number
          tracking_code: string | null
          unit_price: number
        }
        Insert: {
          buyer_email?: string | null
          buyer_name?: string | null
          channel_id: string
          commission?: number
          created_at?: string
          external_order_id?: string | null
          id?: string
          listing_id?: string | null
          net_amount?: number
          notes?: string | null
          order_date?: string
          org_id: string
          quantity?: number
          shipping_status?: string | null
          status?: string
          total_amount: number
          tracking_code?: string | null
          unit_price: number
        }
        Update: {
          buyer_email?: string | null
          buyer_name?: string | null
          channel_id?: string
          commission?: number
          created_at?: string
          external_order_id?: string | null
          id?: string
          listing_id?: string | null
          net_amount?: number
          notes?: string | null
          order_date?: string
          org_id?: string
          quantity?: number
          shipping_status?: string | null
          status?: string
          total_amount?: number
          tracking_code?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_orders_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "marketplace_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_orders_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
      notification_log: {
        Row: {
          body: string | null
          channel: string
          created_at: string
          error_message: string | null
          id: string
          org_id: string
          payload: Json
          recipient: string | null
          rule_id: string | null
          status: string
          subject: string | null
          trigger_event: string
        }
        Insert: {
          body?: string | null
          channel: string
          created_at?: string
          error_message?: string | null
          id?: string
          org_id: string
          payload?: Json
          recipient?: string | null
          rule_id?: string | null
          status?: string
          subject?: string | null
          trigger_event: string
        }
        Update: {
          body?: string | null
          channel?: string
          created_at?: string
          error_message?: string | null
          id?: string
          org_id?: string
          payload?: Json
          recipient?: string | null
          rule_id?: string | null
          status?: string
          subject?: string | null
          trigger_event?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_log_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "notification_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_rules: {
        Row: {
          actions: Json
          active: boolean
          channels: string[]
          conditions: Json
          cooldown_minutes: number
          created_at: string
          description: string | null
          fire_count: number
          id: string
          last_fired_at: string | null
          name: string
          org_id: string
          trigger_event: string
          updated_at: string
        }
        Insert: {
          actions?: Json
          active?: boolean
          channels?: string[]
          conditions?: Json
          cooldown_minutes?: number
          created_at?: string
          description?: string | null
          fire_count?: number
          id?: string
          last_fired_at?: string | null
          name: string
          org_id: string
          trigger_event: string
          updated_at?: string
        }
        Update: {
          actions?: Json
          active?: boolean
          channels?: string[]
          conditions?: Json
          cooldown_minutes?: number
          created_at?: string
          description?: string | null
          fire_count?: number
          id?: string
          last_fired_at?: string | null
          name?: string
          org_id?: string
          trigger_event?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_rules_org_id_fkey"
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
      nps_responses: {
        Row: {
          created_at: string
          customer_email: string | null
          customer_id: string | null
          customer_name: string | null
          feedback: string | null
          id: string
          org_id: string
          score: number
          source: string
          survey_id: string
        }
        Insert: {
          created_at?: string
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          feedback?: string | null
          id?: string
          org_id: string
          score: number
          source?: string
          survey_id: string
        }
        Update: {
          created_at?: string
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          feedback?: string | null
          id?: string
          org_id?: string
          score?: number
          source?: string
          survey_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "nps_responses_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nps_responses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nps_responses_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "nps_survey_stats"
            referencedColumns: ["survey_id"]
          },
          {
            foreignKeyName: "nps_responses_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "nps_surveys"
            referencedColumns: ["id"]
          },
        ]
      }
      nps_surveys: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          org_id: string
          question: string
          response_count: number
          send_after_days: number
          send_after_purchase: boolean
          type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          org_id: string
          question: string
          response_count?: number
          send_after_days?: number
          send_after_purchase?: boolean
          type?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          question?: string
          response_count?: number
          send_after_days?: number
          send_after_purchase?: boolean
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nps_surveys_org_id_fkey"
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
          customer_email: string | null
          customer_name: string
          customer_phone: string | null
          expires_at: string | null
          external_ref: string | null
          id: string
          items: Json
          mp_link: string | null
          mp_payment_id: string | null
          mp_preference_id: string | null
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
          customer_email?: string | null
          customer_name: string
          customer_phone?: string | null
          expires_at?: string | null
          external_ref?: string | null
          id?: string
          items?: Json
          mp_link?: string | null
          mp_payment_id?: string | null
          mp_preference_id?: string | null
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
          customer_email?: string | null
          customer_name?: string
          customer_phone?: string | null
          expires_at?: string | null
          external_ref?: string | null
          id?: string
          items?: Json
          mp_link?: string | null
          mp_payment_id?: string | null
          mp_preference_id?: string | null
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
      payroll_entries: {
        Row: {
          deductions: number
          employee_id: string
          gross_amount: number
          id: string
          net_amount: number
          notes: string | null
          org_id: string
          overtime_hours: number
          period_id: string
          total_hours: number
        }
        Insert: {
          deductions?: number
          employee_id: string
          gross_amount?: number
          id?: string
          net_amount?: number
          notes?: string | null
          org_id: string
          overtime_hours?: number
          period_id: string
          total_hours?: number
        }
        Update: {
          deductions?: number
          employee_id?: string
          gross_amount?: number
          id?: string
          net_amount?: number
          notes?: string | null
          org_id?: string
          overtime_hours?: number
          period_id?: string
          total_hours?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_entries_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_entries_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_entries_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "payroll_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_periods: {
        Row: {
          created_at: string
          id: string
          name: string
          org_id: string
          period_end: string
          period_start: string
          status: string
          total_gross: number
          total_net: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          org_id: string
          period_end: string
          period_start: string
          status?: string
          total_gross?: number
          total_net?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          period_end?: string
          period_start?: string
          status?: string
          total_gross?: number
          total_net?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_periods_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_obligations: {
        Row: {
          allocated_price: number
          contract_id: string
          deferred_amount: number | null
          description: string | null
          end_date: string | null
          fulfillment_method: string
          id: string
          is_satisfied: boolean
          name: string
          progress_pct: number
          recognized_amount: number | null
          satisfied_at: string | null
          sort_order: number
          standalone_price: number
          start_date: string | null
        }
        Insert: {
          allocated_price?: number
          contract_id: string
          deferred_amount?: number | null
          description?: string | null
          end_date?: string | null
          fulfillment_method?: string
          id?: string
          is_satisfied?: boolean
          name: string
          progress_pct?: number
          recognized_amount?: number | null
          satisfied_at?: string | null
          sort_order?: number
          standalone_price?: number
          start_date?: string | null
        }
        Update: {
          allocated_price?: number
          contract_id?: string
          deferred_amount?: number | null
          description?: string | null
          end_date?: string | null
          fulfillment_method?: string
          id?: string
          is_satisfied?: boolean
          name?: string
          progress_pct?: number
          recognized_amount?: number | null
          satisfied_at?: string | null
          sort_order?: number
          standalone_price?: number
          start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "performance_obligations_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "revenue_contracts"
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
      plm_products: {
        Row: {
          certifications: string[]
          compliance_docs: string[]
          components: Json
          created_at: string
          eol_date: string | null
          id: string
          internal_code: string
          launch_date: string | null
          lifecycle_stage: string
          margin_pct: number
          market_share_pct: number
          name: string
          notes: string | null
          org_id: string
          product_id: string | null
          quality_score: number
          responsible_id: string | null
          revenue_ltm: number
          tags: string[]
          updated_at: string
          version: string
        }
        Insert: {
          certifications?: string[]
          compliance_docs?: string[]
          components?: Json
          created_at?: string
          eol_date?: string | null
          id?: string
          internal_code: string
          launch_date?: string | null
          lifecycle_stage?: string
          margin_pct?: number
          market_share_pct?: number
          name: string
          notes?: string | null
          org_id: string
          product_id?: string | null
          quality_score?: number
          responsible_id?: string | null
          revenue_ltm?: number
          tags?: string[]
          updated_at?: string
          version?: string
        }
        Update: {
          certifications?: string[]
          compliance_docs?: string[]
          components?: Json
          created_at?: string
          eol_date?: string | null
          id?: string
          internal_code?: string
          launch_date?: string | null
          lifecycle_stage?: string
          margin_pct?: number
          market_share_pct?: number
          name?: string
          notes?: string | null
          org_id?: string
          product_id?: string | null
          quality_score?: number
          responsible_id?: string | null
          revenue_ltm?: number
          tags?: string[]
          updated_at?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "plm_products_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plm_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plm_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      plm_quality_checks: {
        Row: {
          check_type: string
          checked_at: string
          created_at: string
          id: string
          inspector: string | null
          notes: string | null
          plm_product_id: string
          result: string
          score: number | null
        }
        Insert: {
          check_type: string
          checked_at?: string
          created_at?: string
          id?: string
          inspector?: string | null
          notes?: string | null
          plm_product_id: string
          result?: string
          score?: number | null
        }
        Update: {
          check_type?: string
          checked_at?: string
          created_at?: string
          id?: string
          inspector?: string | null
          notes?: string | null
          plm_product_id?: string
          result?: string
          score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "plm_quality_checks_plm_product_id_fkey"
            columns: ["plm_product_id"]
            isOneToOne: false
            referencedRelation: "plm_products"
            referencedColumns: ["id"]
          },
        ]
      }
      plm_stage_history: {
        Row: {
          approved_by: string | null
          changed_by: string | null
          created_at: string
          from_stage: string | null
          gate_score: number | null
          id: string
          plm_product_id: string
          reason: string | null
          to_stage: string
        }
        Insert: {
          approved_by?: string | null
          changed_by?: string | null
          created_at?: string
          from_stage?: string | null
          gate_score?: number | null
          id?: string
          plm_product_id: string
          reason?: string | null
          to_stage: string
        }
        Update: {
          approved_by?: string | null
          changed_by?: string | null
          created_at?: string
          from_stage?: string | null
          gate_score?: number | null
          id?: string
          plm_product_id?: string
          reason?: string | null
          to_stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "plm_stage_history_plm_product_id_fkey"
            columns: ["plm_product_id"]
            isOneToOne: false
            referencedRelation: "plm_products"
            referencedColumns: ["id"]
          },
        ]
      }
      plm_versions: {
        Row: {
          changes: string[] | null
          created_at: string
          id: string
          is_current: boolean
          plm_product_id: string
          release_date: string | null
          version: string
        }
        Insert: {
          changes?: string[] | null
          created_at?: string
          id?: string
          is_current?: boolean
          plm_product_id: string
          release_date?: string | null
          version: string
        }
        Update: {
          changes?: string[] | null
          created_at?: string
          id?: string
          is_current?: boolean
          plm_product_id?: string
          release_date?: string | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "plm_versions_plm_product_id_fkey"
            columns: ["plm_product_id"]
            isOneToOne: false
            referencedRelation: "plm_products"
            referencedColumns: ["id"]
          },
        ]
      }
      point_transactions: {
        Row: {
          created_at: string
          id: string
          org_id: string
          points: number
          reason: string
          reference_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          points: number
          reason: string
          reference_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          points?: number
          reason?: string
          reference_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "point_transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_configs: {
        Row: {
          accent_color: string
          allow_invoices: boolean
          allow_loyalty: boolean
          allow_orders: boolean
          allow_tickets: boolean
          created_at: string
          custom_domain: string | null
          enabled: boolean
          id: string
          logo_url: string | null
          org_id: string
          updated_at: string
          welcome_message: string | null
        }
        Insert: {
          accent_color?: string
          allow_invoices?: boolean
          allow_loyalty?: boolean
          allow_orders?: boolean
          allow_tickets?: boolean
          created_at?: string
          custom_domain?: string | null
          enabled?: boolean
          id?: string
          logo_url?: string | null
          org_id: string
          updated_at?: string
          welcome_message?: string | null
        }
        Update: {
          accent_color?: string
          allow_invoices?: boolean
          allow_loyalty?: boolean
          allow_orders?: boolean
          allow_tickets?: boolean
          created_at?: string
          custom_domain?: string | null
          enabled?: boolean
          id?: string
          logo_url?: string | null
          org_id?: string
          updated_at?: string
          welcome_message?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "portal_configs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_sessions: {
        Row: {
          created_at: string
          customer_id: string
          expires_at: string
          id: string
          ip_address: unknown
          last_seen_at: string | null
          org_id: string
          token: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          expires_at?: string
          id?: string
          ip_address?: unknown
          last_seen_at?: string | null
          org_id: string
          token?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          expires_at?: string
          id?: string
          ip_address?: unknown
          last_seen_at?: string | null
          org_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_sessions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_sessions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_ticket_messages: {
        Row: {
          attachment_url: string | null
          created_at: string
          id: string
          is_internal: boolean
          message: string
          sender_name: string
          sender_type: string
          ticket_id: string
        }
        Insert: {
          attachment_url?: string | null
          created_at?: string
          id?: string
          is_internal?: boolean
          message: string
          sender_name: string
          sender_type: string
          ticket_id: string
        }
        Update: {
          attachment_url?: string | null
          created_at?: string
          id?: string
          is_internal?: boolean
          message?: string
          sender_name?: string
          sender_type?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_ticket_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "portal_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      portal_tickets: {
        Row: {
          assigned_to: string | null
          category: string
          closed_at: string | null
          created_at: string
          customer_id: string
          description: string
          id: string
          notes: string | null
          org_id: string
          priority: string
          reference_id: string | null
          reference_type: string | null
          resolved_at: string | null
          satisfaction: number | null
          status: string
          subject: string
          ticket_number: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          category?: string
          closed_at?: string | null
          created_at?: string
          customer_id: string
          description: string
          id?: string
          notes?: string | null
          org_id: string
          priority?: string
          reference_id?: string | null
          reference_type?: string | null
          resolved_at?: string | null
          satisfaction?: number | null
          status?: string
          subject: string
          ticket_number: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          category?: string
          closed_at?: string | null
          created_at?: string
          customer_id?: string
          description?: string
          id?: string
          notes?: string | null
          org_id?: string
          priority?: string
          reference_id?: string | null
          reference_type?: string | null
          resolved_at?: string | null
          satisfaction?: number | null
          status?: string
          subject?: string
          ticket_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_tickets_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "portal_tickets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
      price_list_items: {
        Row: {
          created_at: string
          discount_pct: number | null
          id: string
          min_qty: number
          price_ars: number | null
          price_list_id: string
          product_id: string
        }
        Insert: {
          created_at?: string
          discount_pct?: number | null
          id?: string
          min_qty?: number
          price_ars?: number | null
          price_list_id: string
          product_id: string
        }
        Update: {
          created_at?: string
          discount_pct?: number | null
          id?: string
          min_qty?: number
          price_ars?: number | null
          price_list_id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_list_items_price_list_id_fkey"
            columns: ["price_list_id"]
            isOneToOne: false
            referencedRelation: "price_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_list_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_list_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      price_lists: {
        Row: {
          created_at: string
          currency: string
          description: string | null
          discount_pct: number
          id: string
          is_active: boolean
          is_default: boolean
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          description?: string | null
          discount_pct?: number
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          description?: string | null
          discount_pct?: number
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_lists_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      product_bundles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          org_id: string
          price_ars: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          org_id: string
          price_ars?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          org_id?: string
          price_ars?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_bundles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      product_cooccurrences: {
        Row: {
          cooccurrence_count: number
          id: string
          last_seen_at: string
          org_id: string
          product_a_id: string
          product_b_id: string
          updated_at: string
        }
        Insert: {
          cooccurrence_count?: number
          id?: string
          last_seen_at?: string
          org_id: string
          product_a_id: string
          product_b_id: string
          updated_at?: string
        }
        Update: {
          cooccurrence_count?: number
          id?: string
          last_seen_at?: string
          org_id?: string
          product_a_id?: string
          product_b_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_cooccurrences_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_cooccurrences_product_a_id_fkey"
            columns: ["product_a_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_cooccurrences_product_a_id_fkey"
            columns: ["product_a_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_cooccurrences_product_b_id_fkey"
            columns: ["product_b_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_cooccurrences_product_b_id_fkey"
            columns: ["product_b_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
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
          custom_fields: Json | null
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
          custom_fields?: Json | null
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
          custom_fields?: Json | null
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
      project_expenses: {
        Row: {
          amount: number
          category: string | null
          created_at: string
          date: string
          description: string
          id: string
          org_id: string
          project_id: string
          receipt_url: string | null
        }
        Insert: {
          amount: number
          category?: string | null
          created_at?: string
          date?: string
          description: string
          id?: string
          org_id: string
          project_id: string
          receipt_url?: string | null
        }
        Update: {
          amount?: number
          category?: string | null
          created_at?: string
          date?: string
          description?: string
          id?: string
          org_id?: string
          project_id?: string
          receipt_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_expenses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_expenses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_milestones: {
        Row: {
          completed_at: string | null
          due_date: string | null
          id: string
          name: string
          project_id: string
          sort_order: number
        }
        Insert: {
          completed_at?: string | null
          due_date?: string | null
          id?: string
          name: string
          project_id: string
          sort_order?: number
        }
        Update: {
          completed_at?: string | null
          due_date?: string | null
          id?: string
          name?: string
          project_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_milestones_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_tasks: {
        Row: {
          assignee_id: string | null
          assignee_name: string | null
          created_at: string
          description: string | null
          due_date: string | null
          estimated_hours: number | null
          id: string
          logged_hours: number
          milestone_id: string | null
          org_id: string
          priority: string
          project_id: string
          sort_order: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          assignee_name?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          id?: string
          logged_hours?: number
          milestone_id?: string | null
          org_id: string
          priority?: string
          project_id: string
          sort_order?: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          assignee_name?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          estimated_hours?: number | null
          id?: string
          logged_hours?: number
          milestone_id?: string | null
          org_id?: string
          priority?: string
          project_id?: string
          sort_order?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_tasks_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "project_milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_time_logs: {
        Row: {
          created_at: string
          description: string | null
          hours: number
          id: string
          logged_at: string
          org_id: string
          task_id: string
          user_id: string | null
          user_name: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          hours: number
          id?: string
          logged_at?: string
          org_id: string
          task_id: string
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          hours?: number
          id?: string
          logged_at?: string
          org_id?: string
          task_id?: string
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_time_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_time_logs_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "project_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          budget: number | null
          color: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          customer_id: string | null
          customer_name: string | null
          description: string | null
          due_date: string | null
          id: string
          name: string
          org_id: string
          priority: string
          progress_pct: number
          spent: number
          start_date: string | null
          status: string
          tags: string[]
          updated_at: string
        }
        Insert: {
          budget?: number | null
          color?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          name: string
          org_id: string
          priority?: string
          progress_pct?: number
          spent?: number
          start_date?: string | null
          status?: string
          tags?: string[]
          updated_at?: string
        }
        Update: {
          budget?: number | null
          color?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          customer_id?: string | null
          customer_name?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          name?: string
          org_id?: string
          priority?: string
          progress_pct?: number
          spent?: number
          start_date?: string | null
          status?: string
          tags?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      promotion_usages: {
        Row: {
          customer_id: string | null
          customer_name: string | null
          discount_applied: number
          id: string
          order_value: number
          org_id: string
          promotion_id: string
          used_at: string
        }
        Insert: {
          customer_id?: string | null
          customer_name?: string | null
          discount_applied?: number
          id?: string
          order_value?: number
          org_id: string
          promotion_id: string
          used_at?: string
        }
        Update: {
          customer_id?: string | null
          customer_name?: string | null
          discount_applied?: number
          id?: string
          order_value?: number
          org_id?: string
          promotion_id?: string
          used_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotion_usages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_usages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_usages_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "active_promotions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_usages_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
        ]
      }
      promotions: {
        Row: {
          applies_to: string
          banner_color: string
          banner_text: string | null
          category_names: string[] | null
          coupon_code: string | null
          created_at: string
          description: string | null
          discount_value: number
          ends_at: string | null
          id: string
          max_uses: number | null
          min_order_value: number
          name: string
          org_id: string
          product_ids: string[] | null
          show_countdown: boolean
          starts_at: string
          status: string
          type: string
          updated_at: string
          uses_count: number
          uses_per_customer: number
        }
        Insert: {
          applies_to?: string
          banner_color?: string
          banner_text?: string | null
          category_names?: string[] | null
          coupon_code?: string | null
          created_at?: string
          description?: string | null
          discount_value?: number
          ends_at?: string | null
          id?: string
          max_uses?: number | null
          min_order_value?: number
          name: string
          org_id: string
          product_ids?: string[] | null
          show_countdown?: boolean
          starts_at?: string
          status?: string
          type?: string
          updated_at?: string
          uses_count?: number
          uses_per_customer?: number
        }
        Update: {
          applies_to?: string
          banner_color?: string
          banner_text?: string | null
          category_names?: string[] | null
          coupon_code?: string | null
          created_at?: string
          description?: string | null
          discount_value?: number
          ends_at?: string | null
          id?: string
          max_uses?: number | null
          min_order_value?: number
          name?: string
          org_id?: string
          product_ids?: string[] | null
          show_countdown?: boolean
          starts_at?: string
          status?: string
          type?: string
          updated_at?: string
          uses_count?: number
          uses_per_customer?: number
        }
        Relationships: [
          {
            foreignKeyName: "promotions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_order_items: {
        Row: {
          created_at: string
          id: string
          order_id: string
          org_id: string
          product_id: string | null
          product_name: string
          quantity_ordered: number
          quantity_received: number
          sku: string | null
          tax_rate: number
          total_cost: number
          unit_cost: number
        }
        Insert: {
          created_at?: string
          id?: string
          order_id: string
          org_id: string
          product_id?: string | null
          product_name: string
          quantity_ordered?: number
          quantity_received?: number
          sku?: string | null
          tax_rate?: number
          total_cost?: number
          unit_cost?: number
        }
        Update: {
          created_at?: string
          id?: string
          order_id?: string
          org_id?: string
          product_id?: string | null
          product_name?: string
          quantity_ordered?: number
          quantity_received?: number
          sku?: string | null
          tax_rate?: number
          total_cost?: number
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_orders: {
        Row: {
          confirmed_at: string | null
          created_at: string
          currency: string
          discount_amount: number
          expected_date: string | null
          id: string
          internal_notes: string | null
          notes: string | null
          order_number: string
          org_id: string
          payment_terms: string | null
          received_date: string | null
          sent_at: string | null
          status: string
          subtotal: number
          supplier_email: string | null
          supplier_id: string | null
          supplier_name: string
          tax_amount: number
          total_amount: number
          updated_at: string
        }
        Insert: {
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          discount_amount?: number
          expected_date?: string | null
          id?: string
          internal_notes?: string | null
          notes?: string | null
          order_number: string
          org_id: string
          payment_terms?: string | null
          received_date?: string | null
          sent_at?: string | null
          status?: string
          subtotal?: number
          supplier_email?: string | null
          supplier_id?: string | null
          supplier_name: string
          tax_amount?: number
          total_amount?: number
          updated_at?: string
        }
        Update: {
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          discount_amount?: number
          expected_date?: string | null
          id?: string
          internal_notes?: string | null
          notes?: string | null
          order_number?: string
          org_id?: string
          payment_terms?: string | null
          received_date?: string | null
          sent_at?: string | null
          status?: string
          subtotal?: number
          supplier_email?: string | null
          supplier_id?: string | null
          supplier_name?: string
          tax_amount?: number
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_request_items: {
        Row: {
          description: string | null
          estimated_price: number
          id: string
          notes: string | null
          preferred_supplier: string | null
          product_id: string | null
          product_name: string
          quantity: number
          request_id: string
          total_estimated: number | null
          unit: string
        }
        Insert: {
          description?: string | null
          estimated_price?: number
          id?: string
          notes?: string | null
          preferred_supplier?: string | null
          product_id?: string | null
          product_name: string
          quantity?: number
          request_id: string
          total_estimated?: number | null
          unit?: string
        }
        Update: {
          description?: string | null
          estimated_price?: number
          id?: string
          notes?: string | null
          preferred_supplier?: string | null
          product_id?: string | null
          product_name?: string
          quantity?: number
          request_id?: string
          total_estimated?: number | null
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_request_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_request_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_request_items_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "purchase_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          department: string | null
          id: string
          needed_by: string | null
          notes: string | null
          org_id: string
          priority: string
          rejected_reason: string | null
          request_number: string
          requested_by: string
          status: string
          title: string
          total_estimated: number
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          department?: string | null
          id?: string
          needed_by?: string | null
          notes?: string | null
          org_id: string
          priority?: string
          rejected_reason?: string | null
          request_number: string
          requested_by: string
          status?: string
          title: string
          total_estimated?: number
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          department?: string | null
          id?: string
          needed_by?: string | null
          notes?: string | null
          org_id?: string
          priority?: string
          rejected_reason?: string | null
          request_number?: string
          requested_by?: string
          status?: string
          title?: string
          total_estimated?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
      recipe_ingredients: {
        Row: {
          id: string
          ingredient_name: string
          ingredient_product_id: string | null
          is_optional: boolean
          notes: string | null
          quantity: number
          recipe_id: string
          sort_order: number
          unit: string
          unit_cost: number | null
        }
        Insert: {
          id?: string
          ingredient_name: string
          ingredient_product_id?: string | null
          is_optional?: boolean
          notes?: string | null
          quantity?: number
          recipe_id: string
          sort_order?: number
          unit?: string
          unit_cost?: number | null
        }
        Update: {
          id?: string
          ingredient_name?: string
          ingredient_product_id?: string | null
          is_optional?: boolean
          notes?: string | null
          quantity?: number
          recipe_id?: string
          sort_order?: number
          unit?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "recipe_ingredients_ingredient_product_id_fkey"
            columns: ["ingredient_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_ingredients_ingredient_product_id_fkey"
            columns: ["ingredient_product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_ingredients_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipe_productions: {
        Row: {
          batches: number
          id: string
          notes: string | null
          org_id: string
          produced_at: string
          produced_by: string | null
          recipe_id: string
          total_cost: number | null
          yield_qty: number
        }
        Insert: {
          batches?: number
          id?: string
          notes?: string | null
          org_id: string
          produced_at?: string
          produced_by?: string | null
          recipe_id: string
          total_cost?: number | null
          yield_qty: number
        }
        Update: {
          batches?: number
          id?: string
          notes?: string | null
          org_id?: string
          produced_at?: string
          produced_by?: string | null
          recipe_id?: string
          total_cost?: number | null
          yield_qty?: number
        }
        Relationships: [
          {
            foreignKeyName: "recipe_productions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipe_productions_recipe_id_fkey"
            columns: ["recipe_id"]
            isOneToOne: false
            referencedRelation: "recipes"
            referencedColumns: ["id"]
          },
        ]
      }
      recipes: {
        Row: {
          active: boolean
          category: string
          cook_time_min: number
          created_at: string
          difficulty: string
          id: string
          instructions: string | null
          name: string
          notes: string | null
          org_id: string
          output_product_id: string | null
          prep_time_min: number
          updated_at: string
          yield_qty: number
          yield_unit: string
        }
        Insert: {
          active?: boolean
          category?: string
          cook_time_min?: number
          created_at?: string
          difficulty?: string
          id?: string
          instructions?: string | null
          name: string
          notes?: string | null
          org_id: string
          output_product_id?: string | null
          prep_time_min?: number
          updated_at?: string
          yield_qty?: number
          yield_unit?: string
        }
        Update: {
          active?: boolean
          category?: string
          cook_time_min?: number
          created_at?: string
          difficulty?: string
          id?: string
          instructions?: string | null
          name?: string
          notes?: string | null
          org_id?: string
          output_product_id?: string | null
          prep_time_min?: number
          updated_at?: string
          yield_qty?: number
          yield_unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_output_product_id_fkey"
            columns: ["output_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recipes_output_product_id_fkey"
            columns: ["output_product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendation_events: {
        Row: {
          created_at: string
          customer_id: string | null
          event_type: string
          id: string
          org_id: string
          recommended_product_id: string | null
          source: string
          trigger_product_id: string | null
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          event_type: string
          id?: string
          org_id: string
          recommended_product_id?: string | null
          source?: string
          trigger_product_id?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          event_type?: string
          id?: string
          org_id?: string
          recommended_product_id?: string | null
          source?: string
          trigger_product_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_events_recommended_product_id_fkey"
            columns: ["recommended_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_events_recommended_product_id_fkey"
            columns: ["recommended_product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_events_trigger_product_id_fkey"
            columns: ["trigger_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_events_trigger_product_id_fkey"
            columns: ["trigger_product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendation_rules: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          org_id: string
          position: number
          recommended_product_id: string | null
          rule_type: string
          trigger_product_id: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          org_id: string
          position?: number
          recommended_product_id?: string | null
          rule_type?: string
          trigger_product_id?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          position?: number
          recommended_product_id?: string | null
          rule_type?: string
          trigger_product_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recommendation_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_rules_recommended_product_id_fkey"
            columns: ["recommended_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_rules_recommended_product_id_fkey"
            columns: ["recommended_product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_rules_trigger_product_id_fkey"
            columns: ["trigger_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendation_rules_trigger_product_id_fkey"
            columns: ["trigger_product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_assets: {
        Row: {
          category: string
          condition: string
          created_at: string
          daily_rate: number
          deposit_amount: number
          description: string | null
          hourly_rate: number | null
          id: string
          image_url: string | null
          location: string | null
          monthly_rate: number | null
          name: string
          notes: string | null
          org_id: string
          serial_number: string | null
          status: string
          updated_at: string
          weekly_rate: number | null
        }
        Insert: {
          category?: string
          condition?: string
          created_at?: string
          daily_rate?: number
          deposit_amount?: number
          description?: string | null
          hourly_rate?: number | null
          id?: string
          image_url?: string | null
          location?: string | null
          monthly_rate?: number | null
          name: string
          notes?: string | null
          org_id: string
          serial_number?: string | null
          status?: string
          updated_at?: string
          weekly_rate?: number | null
        }
        Update: {
          category?: string
          condition?: string
          created_at?: string
          daily_rate?: number
          deposit_amount?: number
          description?: string | null
          hourly_rate?: number | null
          id?: string
          image_url?: string | null
          location?: string | null
          monthly_rate?: number | null
          name?: string
          notes?: string | null
          org_id?: string
          serial_number?: string | null
          status?: string
          updated_at?: string
          weekly_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rental_assets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_contracts: {
        Row: {
          asset_id: string
          contract_number: string
          created_at: string
          customer_dni: string | null
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          deposit_paid: number
          deposit_returned: number | null
          end_date: string
          id: string
          notes: string | null
          org_id: string
          rate_amount: number
          rate_type: string
          returned_at: string | null
          start_date: string
          status: string
          total_amount: number
          updated_at: string
        }
        Insert: {
          asset_id: string
          contract_number: string
          created_at?: string
          customer_dni?: string | null
          customer_id?: string | null
          customer_name: string
          customer_phone?: string | null
          deposit_paid?: number
          deposit_returned?: number | null
          end_date: string
          id?: string
          notes?: string | null
          org_id: string
          rate_amount: number
          rate_type?: string
          returned_at?: string | null
          start_date: string
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Update: {
          asset_id?: string
          contract_number?: string
          created_at?: string
          customer_dni?: string | null
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string | null
          deposit_paid?: number
          deposit_returned?: number | null
          end_date?: string
          id?: string
          notes?: string | null
          org_id?: string
          rate_amount?: number
          rate_type?: string
          returned_at?: string | null
          start_date?: string
          status?: string
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_contracts_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "rental_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_contracts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_contracts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_payments: {
        Row: {
          amount: number
          contract_id: string
          created_at: string
          id: string
          notes: string | null
          org_id: string
          payment_date: string
          payment_method: string
        }
        Insert: {
          amount: number
          contract_id: string
          created_at?: string
          id?: string
          notes?: string | null
          org_id: string
          payment_date?: string
          payment_method?: string
        }
        Update: {
          amount?: number
          contract_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          org_id?: string
          payment_date?: string
          payment_method?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_payments_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "rental_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_payments_org_id_fkey"
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
      revenue_contracts: {
        Row: {
          constraint_estimate: number
          contract_number: string
          created_at: string
          currency: string
          customer_id: string | null
          end_date: string | null
          id: string
          is_variable_consideration: boolean
          org_id: string
          recognition_method: string
          start_date: string
          status: string
          title: string
          total_value: number
          updated_at: string
        }
        Insert: {
          constraint_estimate?: number
          contract_number: string
          created_at?: string
          currency?: string
          customer_id?: string | null
          end_date?: string | null
          id?: string
          is_variable_consideration?: boolean
          org_id: string
          recognition_method?: string
          start_date: string
          status?: string
          title: string
          total_value?: number
          updated_at?: string
        }
        Update: {
          constraint_estimate?: number
          contract_number?: string
          created_at?: string
          currency?: string
          customer_id?: string | null
          end_date?: string | null
          id?: string
          is_variable_consideration?: boolean
          org_id?: string
          recognition_method?: string
          start_date?: string
          status?: string
          title?: string
          total_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_contracts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_contracts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_journal_entries: {
        Row: {
          amount: number
          contract_id: string
          created_at: string
          credit_account: string
          debit_account: string
          description: string | null
          entry_date: string
          entry_type: string
          id: string
          obligation_id: string | null
          org_id: string
          period_month: string
        }
        Insert: {
          amount?: number
          contract_id: string
          created_at?: string
          credit_account?: string
          debit_account?: string
          description?: string | null
          entry_date: string
          entry_type: string
          id?: string
          obligation_id?: string | null
          org_id: string
          period_month: string
        }
        Update: {
          amount?: number
          contract_id?: string
          created_at?: string
          credit_account?: string
          debit_account?: string
          description?: string | null
          entry_date?: string
          entry_type?: string
          id?: string
          obligation_id?: string | null
          org_id?: string
          period_month?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_journal_entries_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "revenue_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_journal_entries_obligation_id_fkey"
            columns: ["obligation_id"]
            isOneToOne: false
            referencedRelation: "performance_obligations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_journal_entries_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          attribution_source: string | null
          cost_of_goods_ars: number
          cost_per_unit_usd: number
          coupon_code: string | null
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
          location_id: string | null
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
          attribution_source?: string | null
          cost_of_goods_ars?: number
          cost_per_unit_usd?: number
          coupon_code?: string | null
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
          location_id?: string | null
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
          attribution_source?: string | null
          cost_of_goods_ars?: number
          cost_per_unit_usd?: number
          coupon_code?: string | null
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
          location_id?: string | null
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
            foreignKeyName: "sales_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
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
      sales_forecasts: {
        Row: {
          confidence_hi: number
          confidence_lo: number
          confidence_pct: number
          created_at: string
          forecast_date: string
          horizon_days: number
          id: string
          mape: number | null
          model: string
          org_id: string
          predicted_revenue: number
          predicted_units: number
          product_id: string | null
          rmse: number | null
          seasonality_factor: number
          trend_direction: string | null
        }
        Insert: {
          confidence_hi?: number
          confidence_lo?: number
          confidence_pct?: number
          created_at?: string
          forecast_date: string
          horizon_days?: number
          id?: string
          mape?: number | null
          model?: string
          org_id: string
          predicted_revenue?: number
          predicted_units?: number
          product_id?: string | null
          rmse?: number | null
          seasonality_factor?: number
          trend_direction?: string | null
        }
        Update: {
          confidence_hi?: number
          confidence_lo?: number
          confidence_pct?: number
          created_at?: string
          forecast_date?: string
          horizon_days?: number
          id?: string
          mape?: number | null
          model?: string
          org_id?: string
          predicted_revenue?: number
          predicted_units?: number
          product_id?: string | null
          rmse?: number | null
          seasonality_factor?: number
          trend_direction?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_forecasts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_forecasts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_forecasts_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      segment_campaigns: {
        Row: {
          body_preview: string | null
          channel: string
          click_count: number
          conversion_count: number
          created_at: string
          id: string
          name: string
          open_count: number
          org_id: string
          scheduled_at: string | null
          segment_id: string
          sent_count: number
          status: string
          subject: string | null
          template_id: string | null
          updated_at: string
        }
        Insert: {
          body_preview?: string | null
          channel?: string
          click_count?: number
          conversion_count?: number
          created_at?: string
          id?: string
          name: string
          open_count?: number
          org_id: string
          scheduled_at?: string | null
          segment_id: string
          sent_count?: number
          status?: string
          subject?: string | null
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          body_preview?: string | null
          channel?: string
          click_count?: number
          conversion_count?: number
          created_at?: string
          id?: string
          name?: string
          open_count?: number
          org_id?: string
          scheduled_at?: string | null
          segment_id?: string
          sent_count?: number
          status?: string
          subject?: string | null
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "segment_campaigns_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "segment_campaigns_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "customer_segments"
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
      service_order_items: {
        Row: {
          created_at: string
          description: string
          id: string
          item_type: string
          order_id: string
          org_id: string
          product_id: string | null
          quantity: number
          total_price: number | null
          unit_price: number
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          item_type?: string
          order_id: string
          org_id: string
          product_id?: string | null
          quantity?: number
          total_price?: number | null
          unit_price?: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          item_type?: string
          order_id?: string
          org_id?: string
          product_id?: string | null
          quantity?: number
          total_price?: number | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "service_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "service_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_order_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      service_orders: {
        Row: {
          actual_hours: number | null
          assigned_name: string | null
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          customer_address: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          description: string | null
          estimated_hours: number | null
          id: string
          internal_notes: string | null
          labor_cost: number
          notes: string | null
          order_number: string
          org_id: string
          parts_cost: number
          priority: string
          rating: number | null
          rating_comment: string | null
          scheduled_at: string | null
          service_type: string
          signature_at: string | null
          signature_data: string | null
          signature_name: string | null
          started_at: string | null
          status: string
          tags: string[] | null
          title: string
          total_cost: number | null
          updated_at: string
        }
        Insert: {
          actual_hours?: number | null
          assigned_name?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          customer_address?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          description?: string | null
          estimated_hours?: number | null
          id?: string
          internal_notes?: string | null
          labor_cost?: number
          notes?: string | null
          order_number: string
          org_id: string
          parts_cost?: number
          priority?: string
          rating?: number | null
          rating_comment?: string | null
          scheduled_at?: string | null
          service_type?: string
          signature_at?: string | null
          signature_data?: string | null
          signature_name?: string | null
          started_at?: string | null
          status?: string
          tags?: string[] | null
          title: string
          total_cost?: number | null
          updated_at?: string
        }
        Update: {
          actual_hours?: number | null
          assigned_name?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          customer_address?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          description?: string | null
          estimated_hours?: number | null
          id?: string
          internal_notes?: string | null
          labor_cost?: number
          notes?: string | null
          order_number?: string
          org_id?: string
          parts_cost?: number
          priority?: string
          rating?: number | null
          rating_comment?: string | null
          scheduled_at?: string | null
          service_type?: string
          signature_at?: string | null
          signature_data?: string | null
          signature_name?: string | null
          started_at?: string | null
          status?: string
          tags?: string[] | null
          title?: string
          total_cost?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          active: boolean
          buffer_minutes: number
          color: string
          created_at: string
          description: string | null
          duration_minutes: number
          id: string
          max_attendees: number
          name: string
          org_id: string
          price: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          buffer_minutes?: number
          color?: string
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          max_attendees?: number
          name: string
          org_id: string
          price?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          buffer_minutes?: number
          color?: string
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          max_attendees?: number
          name?: string
          org_id?: string
          price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_org_id_fkey"
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
          evolution_api_key: string | null
          evolution_api_url: string | null
          evolution_instance: string | null
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
          ml_access_token: string | null
          ml_enabled: boolean | null
          ml_refresh_token: string | null
          ml_user_id: string | null
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
          shopify_api_key: string | null
          shopify_api_secret: string | null
          shopify_enabled: boolean | null
          shopify_store_url: string | null
          smtp_from_email: string | null
          smtp_from_name: string | null
          smtp_host: string | null
          smtp_pass: string | null
          smtp_port: number
          smtp_secure: boolean
          smtp_user: string | null
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
          whatsapp_birthday_enabled: boolean
          whatsapp_digest_enabled: boolean
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
          evolution_api_key?: string | null
          evolution_api_url?: string | null
          evolution_instance?: string | null
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
          ml_access_token?: string | null
          ml_enabled?: boolean | null
          ml_refresh_token?: string | null
          ml_user_id?: string | null
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
          shopify_api_key?: string | null
          shopify_api_secret?: string | null
          shopify_enabled?: boolean | null
          shopify_store_url?: string | null
          smtp_from_email?: string | null
          smtp_from_name?: string | null
          smtp_host?: string | null
          smtp_pass?: string | null
          smtp_port?: number
          smtp_secure?: boolean
          smtp_user?: string | null
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
          whatsapp_birthday_enabled?: boolean
          whatsapp_digest_enabled?: boolean
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
          evolution_api_key?: string | null
          evolution_api_url?: string | null
          evolution_instance?: string | null
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
          ml_access_token?: string | null
          ml_enabled?: boolean | null
          ml_refresh_token?: string | null
          ml_user_id?: string | null
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
          shopify_api_key?: string | null
          shopify_api_secret?: string | null
          shopify_enabled?: boolean | null
          shopify_store_url?: string | null
          smtp_from_email?: string | null
          smtp_from_name?: string | null
          smtp_host?: string | null
          smtp_pass?: string | null
          smtp_port?: number
          smtp_secure?: boolean
          smtp_user?: string | null
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
          whatsapp_birthday_enabled?: boolean
          whatsapp_digest_enabled?: boolean
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
      shipments: {
        Row: {
          actual_delivery: string | null
          carrier_id: string | null
          created_at: string
          dest_address: Json
          dimensions: Json | null
          estimated_delivery: string | null
          events: Json
          id: string
          insurance_value: number
          label_url: string | null
          order_ref: string | null
          org_id: string
          origin_address: Json
          shipping_cost: number
          status: string
          tracking_number: string | null
          updated_at: string
          weight_kg: number
          zone_id: string | null
        }
        Insert: {
          actual_delivery?: string | null
          carrier_id?: string | null
          created_at?: string
          dest_address?: Json
          dimensions?: Json | null
          estimated_delivery?: string | null
          events?: Json
          id?: string
          insurance_value?: number
          label_url?: string | null
          order_ref?: string | null
          org_id: string
          origin_address?: Json
          shipping_cost?: number
          status?: string
          tracking_number?: string | null
          updated_at?: string
          weight_kg?: number
          zone_id?: string | null
        }
        Update: {
          actual_delivery?: string | null
          carrier_id?: string | null
          created_at?: string
          dest_address?: Json
          dimensions?: Json | null
          estimated_delivery?: string | null
          events?: Json
          id?: string
          insurance_value?: number
          label_url?: string | null
          order_ref?: string | null
          org_id?: string
          origin_address?: Json
          shipping_cost?: number
          status?: string
          tracking_number?: string | null
          updated_at?: string
          weight_kg?: number
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shipments_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "shipping_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_rates: {
        Row: {
          base_cost: number
          carrier_id: string
          cost_per_kg: number
          created_at: string
          estimated_days: number
          free_above: number | null
          id: string
          is_active: boolean
          max_value: number | null
          max_weight_kg: number | null
          min_value: number
          min_weight_kg: number
          org_id: string
          service_name: string
          zone_id: string
        }
        Insert: {
          base_cost?: number
          carrier_id: string
          cost_per_kg?: number
          created_at?: string
          estimated_days?: number
          free_above?: number | null
          id?: string
          is_active?: boolean
          max_value?: number | null
          max_weight_kg?: number | null
          min_value?: number
          min_weight_kg?: number
          org_id: string
          service_name?: string
          zone_id: string
        }
        Update: {
          base_cost?: number
          carrier_id?: string
          cost_per_kg?: number
          created_at?: string
          estimated_days?: number
          free_above?: number | null
          id?: string
          is_active?: boolean
          max_value?: number | null
          max_weight_kg?: number | null
          min_value?: number
          min_weight_kg?: number
          org_id?: string
          service_name?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipping_rates_carrier_id_fkey"
            columns: ["carrier_id"]
            isOneToOne: false
            referencedRelation: "carriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_rates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipping_rates_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "shipping_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_zones: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          org_id: string
          postal_codes: string[]
          provinces: string[]
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          postal_codes?: string[]
          provinces?: string[]
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          postal_codes?: string[]
          provinces?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "shipping_zones_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      smart_alert_rules: {
        Row: {
          category: string
          channels: string[]
          condition_op: string
          cooldown_min: number
          created_at: string
          id: string
          is_active: boolean
          last_triggered: string | null
          metric: string
          name: string
          org_id: string
          priority: string
          threshold: number
          trigger_count: number
          updated_at: string
        }
        Insert: {
          category?: string
          channels?: string[]
          condition_op?: string
          cooldown_min?: number
          created_at?: string
          id?: string
          is_active?: boolean
          last_triggered?: string | null
          metric: string
          name: string
          org_id: string
          priority?: string
          threshold?: number
          trigger_count?: number
          updated_at?: string
        }
        Update: {
          category?: string
          channels?: string[]
          condition_op?: string
          cooldown_min?: number
          created_at?: string
          id?: string
          is_active?: boolean
          last_triggered?: string | null
          metric?: string
          name?: string
          org_id?: string
          priority?: string
          threshold?: number
          trigger_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "smart_alert_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      social_posts: {
        Row: {
          campaign_name: string | null
          clicks: number
          comments: number
          content: string
          created_at: string
          cta_text: string | null
          cta_url: string | null
          hashtags: string[]
          id: string
          likes: number
          media_urls: string[]
          notes: string | null
          org_id: string
          platforms: string[]
          post_type: string
          published_at: string | null
          scheduled_for: string | null
          shares: number
          status: string
          target_audience: string | null
          title: string
          updated_at: string
          views: number
        }
        Insert: {
          campaign_name?: string | null
          clicks?: number
          comments?: number
          content: string
          created_at?: string
          cta_text?: string | null
          cta_url?: string | null
          hashtags?: string[]
          id?: string
          likes?: number
          media_urls?: string[]
          notes?: string | null
          org_id: string
          platforms?: string[]
          post_type?: string
          published_at?: string | null
          scheduled_for?: string | null
          shares?: number
          status?: string
          target_audience?: string | null
          title: string
          updated_at?: string
          views?: number
        }
        Update: {
          campaign_name?: string | null
          clicks?: number
          comments?: number
          content?: string
          created_at?: string
          cta_text?: string | null
          cta_url?: string | null
          hashtags?: string[]
          id?: string
          likes?: number
          media_urls?: string[]
          notes?: string | null
          org_id?: string
          platforms?: string[]
          post_type?: string
          published_at?: string | null
          scheduled_for?: string | null
          shares?: number
          status?: string
          target_audience?: string | null
          title?: string
          updated_at?: string
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "social_posts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_availability: {
        Row: {
          active: boolean
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          org_id: string
          staff_name: string
          staff_user_id: string | null
          start_time: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          day_of_week: number
          end_time: string
          id?: string
          org_id: string
          staff_name: string
          staff_user_id?: string | null
          start_time: string
        }
        Update: {
          active?: boolean
          created_at?: string
          day_of_week?: number
          end_time?: string
          id?: string
          org_id?: string
          staff_name?: string
          staff_user_id?: string | null
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_availability_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_badge_awards: {
        Row: {
          awarded_by: string | null
          badge_id: string
          created_at: string
          id: string
          message: string | null
          org_id: string
          points_earned: number
          staff_name: string
          user_id: string
        }
        Insert: {
          awarded_by?: string | null
          badge_id: string
          created_at?: string
          id?: string
          message?: string | null
          org_id: string
          points_earned?: number
          staff_name: string
          user_id: string
        }
        Update: {
          awarded_by?: string | null
          badge_id?: string
          created_at?: string
          id?: string
          message?: string | null
          org_id?: string
          points_earned?: number
          staff_name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_badge_awards_badge_id_fkey"
            columns: ["badge_id"]
            isOneToOne: false
            referencedRelation: "badge_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_badge_awards_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_points: {
        Row: {
          created_at: string
          id: string
          level: number
          org_id: string
          staff_name: string
          total_points: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          level?: number
          org_id: string
          staff_name: string
          total_points?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          level?: number
          org_id?: string
          staff_name?: string
          total_points?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_points_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
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
      subscription_invoices: {
        Row: {
          amount: number
          created_at: string
          currency: string
          due_date: string
          id: string
          invoice_number: string
          notes: string | null
          org_id: string
          paid_at: string | null
          payment_method: string | null
          period_end: string
          period_start: string
          status: string
          subscription_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          currency?: string
          due_date: string
          id?: string
          invoice_number: string
          notes?: string | null
          org_id: string
          paid_at?: string | null
          payment_method?: string | null
          period_end: string
          period_start: string
          status?: string
          subscription_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          due_date?: string
          id?: string
          invoice_number?: string
          notes?: string | null
          org_id?: string
          paid_at?: string | null
          payment_method?: string | null
          period_end?: string
          period_start?: string
          status?: string
          subscription_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_invoices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "customer_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          active: boolean
          billing_interval: string
          created_at: string
          currency: string
          description: string | null
          features: string[] | null
          id: string
          is_public: boolean
          name: string
          org_id: string
          price: number
          trial_days: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          billing_interval?: string
          created_at?: string
          currency?: string
          description?: string | null
          features?: string[] | null
          id?: string
          is_public?: boolean
          name: string
          org_id: string
          price?: number
          trial_days?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          billing_interval?: string
          created_at?: string
          currency?: string
          description?: string | null
          features?: string[] | null
          id?: string
          is_public?: boolean
          name?: string
          org_id?: string
          price?: number
          trial_days?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_plans_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
      tax_declarations: {
        Row: {
          created_at: string
          declaration_number: string | null
          due_date: string | null
          filed_at: string | null
          id: string
          notes: string | null
          org_id: string
          paid_at: string | null
          period: number
          period_type: string
          status: string
          tax_balance: number | null
          tax_collected: number
          tax_paid: number
          tax_rate_id: string
          taxable_base: number
          year: number
        }
        Insert: {
          created_at?: string
          declaration_number?: string | null
          due_date?: string | null
          filed_at?: string | null
          id?: string
          notes?: string | null
          org_id: string
          paid_at?: string | null
          period: number
          period_type?: string
          status?: string
          tax_balance?: number | null
          tax_collected?: number
          tax_paid?: number
          tax_rate_id: string
          taxable_base?: number
          year: number
        }
        Update: {
          created_at?: string
          declaration_number?: string | null
          due_date?: string | null
          filed_at?: string | null
          id?: string
          notes?: string | null
          org_id?: string
          paid_at?: string | null
          period?: number
          period_type?: string
          status?: string
          tax_balance?: number | null
          tax_collected?: number
          tax_paid?: number
          tax_rate_id?: string
          taxable_base?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "tax_declarations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_declarations_tax_rate_id_fkey"
            columns: ["tax_rate_id"]
            isOneToOne: false
            referencedRelation: "tax_rates"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_rates: {
        Row: {
          active: boolean
          applies_to: string
          code: string | null
          created_at: string
          id: string
          jurisdiction: string | null
          name: string
          org_id: string
          rate_pct: number
          tax_type: string
        }
        Insert: {
          active?: boolean
          applies_to?: string
          code?: string | null
          created_at?: string
          id?: string
          jurisdiction?: string | null
          name: string
          org_id: string
          rate_pct?: number
          tax_type?: string
        }
        Update: {
          active?: boolean
          applies_to?: string
          code?: string | null
          created_at?: string
          id?: string
          jurisdiction?: string | null
          name?: string
          org_id?: string
          rate_pct?: number
          tax_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_rates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      team_messages: {
        Row: {
          content: string
          created_at: string | null
          id: string
          org_id: string
          sender_name: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          org_id: string
          sender_name: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          org_id?: string
          sender_name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_messages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      territories: {
        Row: {
          active: boolean
          color: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "territories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      territory_assignments: {
        Row: {
          assigned_user_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          org_id: string
          reason: string | null
          rule_id: string | null
          territory_id: string | null
        }
        Insert: {
          assigned_user_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          org_id: string
          reason?: string | null
          rule_id?: string | null
          territory_id?: string | null
        }
        Update: {
          assigned_user_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          org_id?: string
          reason?: string | null
          rule_id?: string | null
          territory_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "territory_assignments_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "territory_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "territory_assignments_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "territories"
            referencedColumns: ["id"]
          },
        ]
      }
      territory_members: {
        Row: {
          territory_id: string
          user_id: string
          weight: number
        }
        Insert: {
          territory_id: string
          user_id: string
          weight?: number
        }
        Update: {
          territory_id?: string
          user_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "territory_members_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "territories"
            referencedColumns: ["id"]
          },
        ]
      }
      territory_rules: {
        Row: {
          active: boolean
          assigned_user_id: string | null
          conditions: Json
          created_at: string
          id: string
          name: string
          org_id: string
          priority: number
          territory_id: string
          updated_at: string
          use_round_robin: boolean
        }
        Insert: {
          active?: boolean
          assigned_user_id?: string | null
          conditions?: Json
          created_at?: string
          id?: string
          name?: string
          org_id: string
          priority?: number
          territory_id: string
          updated_at?: string
          use_round_robin?: boolean
        }
        Update: {
          active?: boolean
          assigned_user_id?: string | null
          conditions?: Json
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          priority?: number
          territory_id?: string
          updated_at?: string
          use_round_robin?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "territory_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "territory_rules_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "territories"
            referencedColumns: ["id"]
          },
        ]
      }
      ticket_types: {
        Row: {
          color: string
          created_at: string
          description: string | null
          event_id: string
          id: string
          max_per_order: number
          name: string
          org_id: string
          price: number
          quantity: number
          sale_end: string | null
          sale_start: string | null
          sold: number
        }
        Insert: {
          color?: string
          created_at?: string
          description?: string | null
          event_id: string
          id?: string
          max_per_order?: number
          name: string
          org_id: string
          price?: number
          quantity?: number
          sale_end?: string | null
          sale_start?: string | null
          sold?: number
        }
        Update: {
          color?: string
          created_at?: string
          description?: string | null
          event_id?: string
          id?: string
          max_per_order?: number
          name?: string
          org_id?: string
          price?: number
          quantity?: number
          sale_end?: string | null
          sale_start?: string | null
          sold?: number
        }
        Relationships: [
          {
            foreignKeyName: "ticket_types_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticket_types_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      timesheets: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          break_minutes: number
          clock_in: string | null
          clock_out: string | null
          created_at: string
          date: string
          employee_id: string
          hours_worked: number | null
          id: string
          notes: string | null
          org_id: string
          overtime_hours: number
          status: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          break_minutes?: number
          clock_in?: string | null
          clock_out?: string | null
          created_at?: string
          date: string
          employee_id: string
          hours_worked?: number | null
          id?: string
          notes?: string | null
          org_id: string
          overtime_hours?: number
          status?: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          break_minutes?: number
          clock_in?: string | null
          clock_out?: string | null
          created_at?: string
          date?: string
          employee_id?: string
          hours_worked?: number | null
          id?: string
          notes?: string | null
          org_id?: string
          overtime_hours?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheets_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "timesheets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      vehicle_fuel_logs: {
        Row: {
          created_at: string
          date: string
          fuel_type: string
          id: string
          km_since_last: number | null
          liters: number
          notes: string | null
          odometer_km: number | null
          org_id: string
          price_per_liter: number
          station_name: string | null
          total_cost: number | null
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          date?: string
          fuel_type?: string
          id?: string
          km_since_last?: number | null
          liters?: number
          notes?: string | null
          odometer_km?: number | null
          org_id: string
          price_per_liter?: number
          station_name?: string | null
          total_cost?: number | null
          vehicle_id: string
        }
        Update: {
          created_at?: string
          date?: string
          fuel_type?: string
          id?: string
          km_since_last?: number | null
          liters?: number
          notes?: string | null
          odometer_km?: number | null
          org_id?: string
          price_per_liter?: number
          station_name?: string | null
          total_cost?: number | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_fuel_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_fuel_logs_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_maintenance: {
        Row: {
          completed_date: string | null
          cost: number
          created_at: string
          description: string | null
          id: string
          maintenance_type: string
          next_service_km: number | null
          notes: string | null
          odometer_at_service: number | null
          org_id: string
          provider_name: string | null
          scheduled_date: string | null
          status: string
          title: string
          vehicle_id: string
        }
        Insert: {
          completed_date?: string | null
          cost?: number
          created_at?: string
          description?: string | null
          id?: string
          maintenance_type?: string
          next_service_km?: number | null
          notes?: string | null
          odometer_at_service?: number | null
          org_id: string
          provider_name?: string | null
          scheduled_date?: string | null
          status?: string
          title: string
          vehicle_id: string
        }
        Update: {
          completed_date?: string | null
          cost?: number
          created_at?: string
          description?: string | null
          id?: string
          maintenance_type?: string
          next_service_km?: number | null
          notes?: string | null
          odometer_at_service?: number | null
          org_id?: string
          provider_name?: string | null
          scheduled_date?: string | null
          status?: string
          title?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_maintenance_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_maintenance_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicle_trips: {
        Row: {
          created_at: string
          destination: string | null
          driver_name: string
          end_odometer: number | null
          end_time: string | null
          id: string
          km_driven: number | null
          notes: string | null
          org_id: string
          origin: string | null
          purpose: string | null
          start_odometer: number | null
          start_time: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          destination?: string | null
          driver_name: string
          end_odometer?: number | null
          end_time?: string | null
          id?: string
          km_driven?: number | null
          notes?: string | null
          org_id: string
          origin?: string | null
          purpose?: string | null
          start_odometer?: number | null
          start_time?: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          destination?: string | null
          driver_name?: string
          end_odometer?: number | null
          end_time?: string | null
          id?: string
          km_driven?: number | null
          notes?: string | null
          org_id?: string
          origin?: string | null
          purpose?: string | null
          start_odometer?: number | null
          start_time?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_trips_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_trips_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          active: boolean
          assigned_to_name: string | null
          brand: string | null
          created_at: string
          fuel_type: string
          id: string
          insurance_expiry: string | null
          model: string | null
          name: string
          notes: string | null
          odometer_km: number
          org_id: string
          plate: string | null
          status: string
          updated_at: string
          vin: string | null
          vtv_expiry: string | null
          year: number | null
        }
        Insert: {
          active?: boolean
          assigned_to_name?: string | null
          brand?: string | null
          created_at?: string
          fuel_type?: string
          id?: string
          insurance_expiry?: string | null
          model?: string | null
          name: string
          notes?: string | null
          odometer_km?: number
          org_id: string
          plate?: string | null
          status?: string
          updated_at?: string
          vin?: string | null
          vtv_expiry?: string | null
          year?: number | null
        }
        Update: {
          active?: boolean
          assigned_to_name?: string | null
          brand?: string | null
          created_at?: string
          fuel_type?: string
          id?: string
          insurance_expiry?: string | null
          model?: string | null
          name?: string
          notes?: string | null
          odometer_km?: number
          org_id?: string
          plate?: string | null
          status?: string
          updated_at?: string
          vin?: string | null
          vtv_expiry?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_catalog_items: {
        Row: {
          category: string | null
          currency: string
          description: string | null
          id: string
          images: string[]
          is_active: boolean
          last_updated: string
          lead_time_days: number
          min_order_qty: number
          name: string
          org_id: string
          sku: string
          specs: Json
          stock_available: number
          supplier_id: string
          unit_price: number
        }
        Insert: {
          category?: string | null
          currency?: string
          description?: string | null
          id?: string
          images?: string[]
          is_active?: boolean
          last_updated?: string
          lead_time_days?: number
          min_order_qty?: number
          name: string
          org_id: string
          sku: string
          specs?: Json
          stock_available?: number
          supplier_id: string
          unit_price?: number
        }
        Update: {
          category?: string | null
          currency?: string
          description?: string | null
          id?: string
          images?: string[]
          is_active?: boolean
          last_updated?: string
          lead_time_days?: number
          min_order_qty?: number
          name?: string
          org_id?: string
          sku?: string
          specs?: Json
          stock_available?: number
          supplier_id?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "vendor_catalog_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_catalog_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_invoices: {
        Row: {
          amount: number
          approved_at: string | null
          approved_by: string | null
          created_at: string
          currency: string
          due_date: string | null
          file_url: string | null
          id: string
          invoice_date: string
          invoice_number: string
          items: Json
          notes: string | null
          org_id: string
          paid_at: string | null
          purchase_order_ref: string | null
          status: string
          supplier_id: string
        }
        Insert: {
          amount: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          currency?: string
          due_date?: string | null
          file_url?: string | null
          id?: string
          invoice_date: string
          invoice_number: string
          items?: Json
          notes?: string | null
          org_id: string
          paid_at?: string | null
          purchase_order_ref?: string | null
          status?: string
          supplier_id: string
        }
        Update: {
          amount?: number
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          currency?: string
          due_date?: string | null
          file_url?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: string
          items?: Json
          notes?: string | null
          org_id?: string
          paid_at?: string | null
          purchase_order_ref?: string | null
          status?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_invoices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_messages: {
        Row: {
          attachments: string[]
          body: string
          created_at: string
          id: string
          is_read: boolean
          org_id: string
          sender_type: string
          subject: string | null
          supplier_id: string
          thread_id: string | null
        }
        Insert: {
          attachments?: string[]
          body: string
          created_at?: string
          id?: string
          is_read?: boolean
          org_id: string
          sender_type: string
          subject?: string | null
          supplier_id: string
          thread_id?: string | null
        }
        Update: {
          attachments?: string[]
          body?: string
          created_at?: string
          id?: string
          is_read?: boolean
          org_id?: string
          sender_type?: string
          subject?: string | null
          supplier_id?: string
          thread_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_messages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_messages_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_portal_access: {
        Row: {
          created_at: string
          email: string
          id: string
          is_active: boolean
          last_login: string | null
          org_id: string
          permissions: string[]
          portal_token: string
          supplier_id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          is_active?: boolean
          last_login?: string | null
          org_id: string
          permissions?: string[]
          portal_token?: string
          supplier_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean
          last_login?: string | null
          org_id?: string
          permissions?: string[]
          portal_token?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_portal_access_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_portal_access_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouse_bins: {
        Row: {
          active: boolean
          capacity: number | null
          code: string
          created_at: string
          description: string | null
          id: string
          org_id: string
          warehouse_id: string
          zone_id: string
        }
        Insert: {
          active?: boolean
          capacity?: number | null
          code: string
          created_at?: string
          description?: string | null
          id?: string
          org_id: string
          warehouse_id: string
          zone_id: string
        }
        Update: {
          active?: boolean
          capacity?: number | null
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          org_id?: string
          warehouse_id?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_bins_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_bins_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_bins_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "warehouse_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouse_zones: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          org_id: string
          warehouse_id: string
          zone_type: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          org_id: string
          warehouse_id: string
          zone_type?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          warehouse_id?: string
          zone_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "warehouse_zones_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warehouse_zones_warehouse_id_fkey"
            columns: ["warehouse_id"]
            isOneToOne: false
            referencedRelation: "warehouses"
            referencedColumns: ["id"]
          },
        ]
      }
      warehouses: {
        Row: {
          active: boolean
          address: string | null
          code: string | null
          created_at: string
          id: string
          is_default: boolean
          manager: string | null
          name: string
          org_id: string
          phone: string | null
        }
        Insert: {
          active?: boolean
          address?: string | null
          code?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          manager?: string | null
          name: string
          org_id: string
          phone?: string | null
        }
        Update: {
          active?: boolean
          address?: string | null
          code?: string | null
          created_at?: string
          id?: string
          is_default?: boolean
          manager?: string | null
          name?: string
          org_id?: string
          phone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "warehouses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      warranty_claims: {
        Row: {
          actual_ready: string | null
          assigned_to: string | null
          attachments: string[]
          claim_number: string
          cost_customer: number
          cost_labor: number
          cost_parts: number
          covered_by_warranty: boolean
          created_at: string
          customer_email: string | null
          customer_id: string | null
          customer_name: string
          customer_phone: string | null
          description: string
          estimated_ready: string | null
          id: string
          issue_type: string
          org_id: string
          priority: string
          product_id: string | null
          product_name: string
          purchase_date: string | null
          resolution: string | null
          serial_number: string | null
          status: string
          updated_at: string
          warranty_end: string | null
        }
        Insert: {
          actual_ready?: string | null
          assigned_to?: string | null
          attachments?: string[]
          claim_number: string
          cost_customer?: number
          cost_labor?: number
          cost_parts?: number
          covered_by_warranty?: boolean
          created_at?: string
          customer_email?: string | null
          customer_id?: string | null
          customer_name: string
          customer_phone?: string | null
          description: string
          estimated_ready?: string | null
          id?: string
          issue_type?: string
          org_id: string
          priority?: string
          product_id?: string | null
          product_name: string
          purchase_date?: string | null
          resolution?: string | null
          serial_number?: string | null
          status?: string
          updated_at?: string
          warranty_end?: string | null
        }
        Update: {
          actual_ready?: string | null
          assigned_to?: string | null
          attachments?: string[]
          claim_number?: string
          cost_customer?: number
          cost_labor?: number
          cost_parts?: number
          covered_by_warranty?: boolean
          created_at?: string
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string
          customer_phone?: string | null
          description?: string
          estimated_ready?: string | null
          id?: string
          issue_type?: string
          org_id?: string
          priority?: string
          product_id?: string | null
          product_name?: string
          purchase_date?: string | null
          resolution?: string | null
          serial_number?: string | null
          status?: string
          updated_at?: string
          warranty_end?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "warranty_claims_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warranty_claims_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warranty_claims_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "warranty_claims_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products_public"
            referencedColumns: ["id"]
          },
        ]
      }
      warranty_events: {
        Row: {
          claim_id: string
          created_at: string
          created_by: string | null
          id: string
          note: string
          status: string
        }
        Insert: {
          claim_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          note: string
          status: string
        }
        Update: {
          claim_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "warranty_events_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "warranty_claims"
            referencedColumns: ["id"]
          },
        ]
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
      whatsapp_campaigns: {
        Row: {
          coupon_code: string | null
          created_at: string
          failed_count: number
          id: string
          message: string
          org_id: string
          segment: string
          sent_at: string | null
          sent_count: number
          status: string
        }
        Insert: {
          coupon_code?: string | null
          created_at?: string
          failed_count?: number
          id?: string
          message: string
          org_id: string
          segment?: string
          sent_at?: string | null
          sent_count?: number
          status?: string
        }
        Update: {
          coupon_code?: string | null
          created_at?: string
          failed_count?: number
          id?: string
          message?: string
          org_id?: string
          segment?: string
          sent_at?: string | null
          sent_count?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_campaigns_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      withholding_records: {
        Row: {
          amount: number
          base_amount: number
          certificate_number: string | null
          counterpart_cuit: string | null
          counterpart_name: string
          created_at: string
          date: string
          direction: string
          id: string
          notes: string | null
          org_id: string
          rate_pct: number
          reference_id: string | null
          reference_type: string | null
          withholding_type: string
        }
        Insert: {
          amount: number
          base_amount?: number
          certificate_number?: string | null
          counterpart_cuit?: string | null
          counterpart_name: string
          created_at?: string
          date?: string
          direction?: string
          id?: string
          notes?: string | null
          org_id: string
          rate_pct?: number
          reference_id?: string | null
          reference_type?: string | null
          withholding_type: string
        }
        Update: {
          amount?: number
          base_amount?: number
          certificate_number?: string | null
          counterpart_cuit?: string | null
          counterpart_name?: string
          created_at?: string
          date?: string
          direction?: string
          id?: string
          notes?: string | null
          org_id?: string
          rate_pct?: number
          reference_id?: string | null
          reference_type?: string | null
          withholding_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "withholding_records_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      active_promotions: {
        Row: {
          applies_to: string | null
          banner_color: string | null
          banner_text: string | null
          category_names: string[] | null
          coupon_code: string | null
          created_at: string | null
          description: string | null
          discount_value: number | null
          ends_at: string | null
          id: string | null
          max_uses: number | null
          min_order_value: number | null
          name: string | null
          org_id: string | null
          product_ids: string[] | null
          show_countdown: boolean | null
          starts_at: string | null
          status: string | null
          type: string | null
          updated_at: string | null
          uses_count: number | null
          uses_per_customer: number | null
        }
        Insert: {
          applies_to?: string | null
          banner_color?: string | null
          banner_text?: string | null
          category_names?: string[] | null
          coupon_code?: string | null
          created_at?: string | null
          description?: string | null
          discount_value?: number | null
          ends_at?: string | null
          id?: string | null
          max_uses?: number | null
          min_order_value?: number | null
          name?: string | null
          org_id?: string | null
          product_ids?: string[] | null
          show_countdown?: boolean | null
          starts_at?: string | null
          status?: string | null
          type?: string | null
          updated_at?: string | null
          uses_count?: number | null
          uses_per_customer?: number | null
        }
        Update: {
          applies_to?: string | null
          banner_color?: string | null
          banner_text?: string | null
          category_names?: string[] | null
          coupon_code?: string | null
          created_at?: string | null
          description?: string | null
          discount_value?: number | null
          ends_at?: string | null
          id?: string | null
          max_uses?: number | null
          min_order_value?: number | null
          name?: string | null
          org_id?: string | null
          product_ids?: string[] | null
          show_countdown?: boolean | null
          starts_at?: string | null
          status?: string | null
          type?: string | null
          updated_at?: string | null
          uses_count?: number | null
          uses_per_customer?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "promotions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
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
      contracts_expiring_soon: {
        Row: {
          auto_renewal: boolean | null
          contract_number: string | null
          created_at: string | null
          created_by: string | null
          currency: string | null
          customer_email: string | null
          customer_id: string | null
          customer_name: string | null
          days_until_expiry: number | null
          deal_id: string | null
          description: string | null
          document_url: string | null
          end_date: string | null
          id: string | null
          org_id: string | null
          renewal_days: number | null
          signed_at: string | null
          signed_ip: string | null
          signer_name: string | null
          start_date: string | null
          status: string | null
          tags: string[] | null
          terms: string | null
          title: string | null
          type: string | null
          updated_at: string | null
          value: number | null
        }
        Insert: {
          auto_renewal?: boolean | null
          contract_number?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          days_until_expiry?: never
          deal_id?: string | null
          description?: string | null
          document_url?: string | null
          end_date?: string | null
          id?: string | null
          org_id?: string | null
          renewal_days?: number | null
          signed_at?: string | null
          signed_ip?: string | null
          signer_name?: string | null
          start_date?: string | null
          status?: string | null
          tags?: string[] | null
          terms?: string | null
          title?: string | null
          type?: string | null
          updated_at?: string | null
          value?: number | null
        }
        Update: {
          auto_renewal?: boolean | null
          contract_number?: string | null
          created_at?: string | null
          created_by?: string | null
          currency?: string | null
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          days_until_expiry?: never
          deal_id?: string | null
          description?: string | null
          document_url?: string | null
          end_date?: string | null
          id?: string | null
          org_id?: string | null
          renewal_days?: number | null
          signed_at?: string | null
          signed_ip?: string | null
          signer_name?: string | null
          start_date?: string | null
          status?: string | null
          tags?: string[] | null
          terms?: string | null
          title?: string | null
          type?: string | null
          updated_at?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "contracts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_pending_followups: {
        Row: {
          created_at: string | null
          customer_name: string | null
          follow_up_date: string | null
          id: string | null
          org_id: string | null
          outcome: string | null
          summary: string | null
          type: string | null
          urgency: string | null
        }
        Insert: {
          created_at?: string | null
          customer_name?: string | null
          follow_up_date?: string | null
          id?: string | null
          org_id?: string | null
          outcome?: string | null
          summary?: string | null
          type?: string | null
          urgency?: never
        }
        Update: {
          created_at?: string | null
          customer_name?: string | null
          follow_up_date?: string | null
          id?: string | null
          org_id?: string | null
          outcome?: string | null
          summary?: string | null
          type?: string | null
          urgency?: never
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
      crm_pipeline_forecast: {
        Row: {
          avg_probability: number | null
          deal_count: number | null
          org_id: string | null
          pipeline_id: string | null
          rotting_count: number | null
          stage_id: string | null
          stage_name: string | null
          total_value: number | null
          weighted_value: number | null
          win_probability: number | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_deals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "crm_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_deals_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "crm_stages"
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
      ecommerce_funnel: {
        Row: {
          abandoned: number | null
          conversion_rate: number | null
          converted: number | null
          day: string | null
          org_id: string | null
          sessions_with_items: number | null
          store_id: string | null
          total_sessions: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ecommerce_stores_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gamification_leaderboard: {
        Row: {
          badges_earned: string[] | null
          current_level: number | null
          current_streak: number | null
          email: string | null
          org_id: string | null
          rank_position: number | null
          stats: Json | null
          total_xp: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gamification_profiles_org_id_fkey"
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
      nps_survey_stats: {
        Row: {
          avg_score: number | null
          detractors: number | null
          last_response_at: string | null
          name: string | null
          org_id: string | null
          passives: number | null
          promoters: number | null
          survey_id: string | null
          total_responses: number | null
          type: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nps_surveys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      vendor_pending_summary: {
        Row: {
          approved_amount: number | null
          last_invoice: string | null
          org_id: string | null
          paid_amount: number | null
          pending_amount: number | null
          pending_count: number | null
          supplier_id: string | null
          supplier_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendor_invoices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      activate_scheduled_promotions: { Args: never; Returns: number }
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
      apply_territory_rules: {
        Args: {
          p_attributes: Json
          p_entity_id: string
          p_entity_type: string
          p_org_id: string
        }
        Returns: string
      }
      award_badge: {
        Args: {
          p_awarded_by: string
          p_badge_id: string
          p_message?: string
          p_org_id: string
          p_staff_name: string
          p_user_id: string
        }
        Returns: string
      }
      award_xp: {
        Args: {
          p_event: string
          p_metadata?: Json
          p_org_id: string
          p_user_id: string
          p_xp: number
        }
        Returns: {
          leveled_up: boolean
          new_level: number
          new_xp: number
        }[]
      }
      calc_sl_depreciation: {
        Args: { p_cost: number; p_life_years: number; p_salvage: number }
        Returns: number
      }
      calculate_shipping_cost: {
        Args: {
          p_carrier_id: string
          p_order_value: number
          p_org_id: string
          p_weight_kg: number
          p_zone_id: string
        }
        Returns: {
          base_cost: number
          carrier_name: string
          estimated_days: number
          is_free: boolean
          service_name: string
          total_cost: number
          weight_cost: number
        }[]
      }
      check_overdue_debts: { Args: never; Returns: undefined }
      check_rotting_deals: { Args: { p_org_id: string }; Returns: number }
      complete_inventory_transfer: {
        Args: { p_transfer_id: string }
        Returns: undefined
      }
      compute_moving_average_forecast: {
        Args: {
          p_horizon_days?: number
          p_org_id: string
          p_product_id: string
          p_window_days?: number
        }
        Returns: {
          confidence: number
          lower_bound: number
          predicted_units: number
          upper_bound: number
        }[]
      }
      compute_moving_avg_forecast: {
        Args: {
          p_horizon?: number
          p_org_id: string
          p_product_id?: string
          p_window?: number
        }
        Returns: {
          confidence_hi: number
          confidence_lo: number
          day: string
          predicted_units: number
        }[]
      }
      compute_reorder_point: {
        Args: {
          p_lead_time_days?: number
          p_org_id: string
          p_product_id: string
          p_safety_stock_days?: number
        }
        Returns: number
      }
      compute_scenario_variance: {
        Args: { p_base_id: string; p_category?: string; p_comp_id: string }
        Returns: {
          base_total: number
          category: string
          comp_total: number
          name: string
          variance_abs: number
          variance_pct: number
        }[]
      }
      end_expired_promotions: { Args: never; Returns: number }
      eval_territory_conditions: {
        Args: { p_attributes: Json; p_conditions: Json }
        Returns: boolean
      }
      expire_overdue_contracts: { Args: never; Returns: number }
      expire_overdue_trials: { Args: never; Returns: undefined }
      generate_claim_number: { Args: { p_org_id: string }; Returns: string }
      generate_download_token: { Args: never; Returns: string }
      generate_dropship_number: { Args: { p_org_id: string }; Returns: string }
      generate_gift_card_code: { Args: never; Returns: string }
      generate_license_key: { Args: never; Returns: string }
      generate_org_slug: { Args: { _name: string }; Returns: string }
      generate_payroll: {
        Args: { p_org_id: string; p_period_id: string }
        Returns: number
      }
      generate_rental_number: { Args: { p_org_id: string }; Returns: string }
      generate_request_number: { Args: { p_org_id: string }; Returns: string }
      generate_service_order_number: {
        Args: { p_org_id: string }
        Returns: string
      }
      generate_ticket_code: { Args: never; Returns: string }
      generate_ticket_number: { Args: { p_org_id: string }; Returns: string }
      generate_tracking_code: { Args: { p_org_id: string }; Returns: string }
      get_afip_stats: {
        Args: { p_days?: number; p_org_id: string }
        Returns: {
          authorized: number
          day: string
          pending: number
          rejected: number
          total: number
          total_amount: number
        }[]
      }
      get_bcg_matrix: {
        Args: { p_org_id: string }
        Returns: {
          growth_rate: number
          market_share: number
          product_id: string
          product_name: string
          quadrant: string
          revenue_ltm: number
        }[]
      }
      get_carrier_performance: {
        Args: { p_days?: number; p_org_id: string }
        Returns: {
          avg_days: number
          carrier_id: string
          carrier_name: string
          late: number
          on_time: number
          on_time_rate: number
          returned: number
          total_shipments: number
        }[]
      }
      get_cashflow_summary: {
        Args: { p_from: string; p_org_id: string; p_to: string }
        Returns: {
          flow_date: string
          inflow: number
          net: number
          outflow: number
          running_total: number
        }[]
      }
      get_customer_journey: {
        Args: { p_customer_id: string; p_org_id: string }
        Returns: {
          channel: string
          occurred_at: string
          sentiment: string
          stage_name: string
          subject: string
          touchpoint_id: string
          touchpoint_type: string
        }[]
      }
      get_customer_sentiment: {
        Args: { p_days?: number; p_org_id: string }
        Returns: {
          avg_sentiment: number
          customer_id: string
          health_score: number
          last_touchpoint: string
          negative_count: number
          positive_count: number
          total_touchpoints: number
        }[]
      }
      get_influencer_portal: {
        Args: { p_token: string }
        Returns: {
          actual_posts: number
          content_submitted_at: string
          content_url: string
          delivery_date: string
          exchange_type: string
          expected_posts: number
          goal_notes: string
          id: string
          influencer_name: string
          product_name: string
          quantity: number
          status: string
        }[]
      }
      get_next_cbte_number: {
        Args: { p_org_id: string; p_punto_venta: number; p_tipo_cbte: number }
        Returns: number
      }
      get_org_role: {
        Args: { _org_id: string; _user_id: string }
        Returns: string
      }
      get_product_recommendations: {
        Args: { p_limit?: number; p_org_id: string; p_product_id: string }
        Returns: {
          recommended_product_id: string
          score: number
        }[]
      }
      get_revenue_waterfall: {
        Args: { p_months?: number; p_org_id: string }
        Returns: {
          cumulative_deferred: number
          deferred: number
          new_contracts: number
          period_month: string
          recognized: number
        }[]
      }
      get_top_recommendations: {
        Args: { p_limit?: number; p_org_id: string }
        Returns: {
          action_url: string | null
          confidence: number
          created_at: string
          data_points: Json
          description: string
          effort: string
          entity_id: string | null
          entity_type: string | null
          expires_at: string | null
          id: string
          impact_estimate: number
          org_id: string
          rec_type: string
          status: string
          title: string
          user_feedback: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "ai_recommendations"
          isOneToOne: false
          isSetofReturn: true
        }
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
      increment_kb_helpful: { Args: { article_id: string }; Returns: undefined }
      increment_kb_views: { Args: { article_id: string }; Returns: undefined }
      is_email_suppressed: {
        Args: { p_email: string; p_org_id: string }
        Returns: boolean
      }
      is_org_member: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      is_platform_admin: { Args: { _user_id: string }; Returns: boolean }
      next_quote_number: { Args: { p_org_id: string }; Returns: string }
      process_drip_unsubscribe: {
        Args: { p_ip?: unknown; p_token: string; p_user_agent?: string }
        Returns: Json
      }
      rebuild_cooccurrences: { Args: { p_org_id: string }; Returns: undefined }
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
      record_rule_fire: { Args: { p_rule_id: string }; Returns: undefined }
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
      renew_subscription: {
        Args: { p_subscription_id: string }
        Returns: string
      }
      run_abc_analysis: {
        Args: { p_org_id: string; p_period_days?: number }
        Returns: number
      }
      seed_budget_categories: { Args: { p_org_id: string }; Returns: undefined }
      seed_crm_pipeline: { Args: { p_org_id: string }; Returns: string }
      seed_default_alert_rules: {
        Args: { p_org_id: string }
        Returns: undefined
      }
      seed_default_permissions: {
        Args: { p_org_id: string }
        Returns: undefined
      }
      seed_default_price_list: {
        Args: { p_org_id: string }
        Returns: undefined
      }
      seed_demo_data: {
        Args: { p_org_id: string; p_user_id: string }
        Returns: Json
      }
      seed_document_categories: {
        Args: { p_org_id: string }
        Returns: undefined
      }
      seed_gamification_badges: {
        Args: { p_org_id: string }
        Returns: undefined
      }
      seed_gamification_config: {
        Args: { p_org_id: string }
        Returns: undefined
      }
      seed_journey_stages: { Args: { p_org_id: string }; Returns: undefined }
      seed_tax_rates: { Args: { p_org_id: string }; Returns: undefined }
      submit_influencer_content: {
        Args: {
          p_actual_posts: number
          p_content_url: string
          p_exchange_id: string
          p_token: string
        }
        Returns: boolean
      }
      sync_segment_members: { Args: { p_segment_id: string }; Returns: number }
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
