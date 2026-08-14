// Export portable de una organización.
//
// No se hace desde el navegador: un miembro común puede ver datos operativos
// por RLS, pero llevarse la organización entera es una acción del owner. Esta
// función usa service_role sólo después de verificar esa pertenencia y responde
// un manifiesto por tabla; un fallo jamás se convierte en "no había datos".
//
// Credenciales OAuth, claves API, sesiones y secretos de webhooks quedan fuera
// incluso para el dueño. Son credenciales de acceso, no datos portables del
// negocio, y exportarlas rompería el límite que las mantiene fuera del cliente.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { requireUser } from "../_shared/requireUser.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_ROWS_PER_TABLE = 50_000;

/** Datos del negocio cuyo contrato tiene `org_id` propio y se pueden portar. */
const EXPORTABLE_TABLES = [
  // Catálogo, compras e inventario
  "products", "product_variants", "product_perfume_details", "product_batches",
  "product_bundles", "product_bundle_items", "product_combos", "quantity_discounts",
  "price_lists", "price_history", "stock_movements", "stock_reservations", "stock_history",
  "stock_counts", "stock_count_items", "locations", "location_stock", "warehouses",
  "warehouse_bins", "warehouse_zones", "inventory_transfers", "inventory_transfer_items",
  "purchases", "purchase_orders", "purchase_order_items", "purchase_order_receipts",
  "purchase_requests", "suppliers", "supplier_payments", "supplier_debts",
  // Ventas, caja, finanzas y fiscal
  "sales", "sale_items", "quotes", "invoices", "debts", "debt_payments", "expenses",
  "financial_movements", "financial_line_items", "financial_scenarios", "cash_sessions",
  "cash_entries", "cashflow_entries", "cash_projections", "customer_payments", "cheques",
  "payment_links", "payment_transactions", "return_requests", "returns", "shipments", "deliveries",
  "tax_declarations", "tax_rates", "withholding_records",
  // Clientes, CRM, fidelidad y tareas
  "customers", "customer_notes", "customer_segments", "customer_subscriptions",
  "customer_communications", "customer_referrals", "crm_contacts", "crm_deals",
  "crm_pipelines", "crm_stages", "crm_followups", "crm_activities", "deals", "deal_activities",
  "loyalty_programs", "loyalty_members", "loyalty_points", "loyalty_transactions",
  "loyalty_rewards", "loyalty_tiers", "tasks", "notifications", "notification_log",
  // Tienda, logística, marketing e integraciones de negocio
  "ecommerce_stores", "ecommerce_orders", "ecommerce_cart_sessions", "ecommerce_categories",
  "store_customers", "store_pages", "store_banners", "store_wishlists", "store_stock_alerts",
  "shipping_zones", "shipping_rates", "shipping_carriers", "carriers", "webhook_deliveries",
  "marketing_posts", "marketing_templates", "marketing_themes", "email_campaigns",
  "email_events", "email_suppressions", "email_unsubscribes", "whatsapp_campaigns",
  "drip_sequences", "drip_sequence_steps", "drip_enrollments", "influencers",
  "influencer_exchanges", "influencer_payouts", "influencer_sales",
  // Equipo, configuración y evidencia operativa
  "memberships", "role_permissions", "org_invitations", "settings", "custom_field_defs",
  "audit_logs", "integration_logs", "alert_rules", "alert_events", "automation_flows",
  "automation_runs", "ai_offer_recommendations", "ai_recommendations", "ai_chat_sessions",
  "ai_chat_messages", "recommendation_events", "recommendation_rules", "saved_reports",
  "kpi_goals", "kpi_dashboards", "kpi_widgets", "documents", "document_categories",
  "document_versions", "document_access_log", "subscriptions", "subscription_invoices",
  "meli_listings", "meli_orders",
] as const;

const EXCLUDED_CREDENTIAL_STORES = [
  "afip_credentials", "payment_connections", "meli_connections", "api_keys", "org_api_keys",
  "oauth_states", "portal_sessions", "push_subscriptions", "webhook_configs",
] as const;

const SECRET_SETTINGS_COLUMNS = new Set([
  "mp_access_token", "api_key", "mp_webhook_secret", "webhook_secret", "smtp_pass",
  "evolution_api_key", "ml_access_token", "ml_refresh_token",
]);

// `settings` concentra configuración útil y secretos históricos en la misma
// fila. No alcanza con borrar los secretos conocidos después de `select('*')`:
// una columna secreta futura se filtraría hasta que alguien actualice esta
// función. Por eso la selección es positiva y el borrado de arriba queda como
// defensa adicional ante una edición accidental de esta lista.
const SETTINGS_EXPORT_COLUMNS = [
  "id", "user_id", "org_id", "created_at", "updated_at", "business_name", "logo_url",
  "primary_color", "secondary_color", "industry_code", "exchange_rate", "customs_percent",
  "default_discount_percent", "discount_cash_percent", "discount_transfer_percent",
  "discount_debit_percent", "discount_credit_percent", "volume_discount_threshold",
  "volume_discount_percent", "decant_margin_10ml", "decant_margin_5ml", "decant_margin_2_5ml",
  "initial_cash_ars", "expense_categories", "pasero_commission_percent", "usd_rate_oficial",
  "usd_rate_blue", "usd_rate_mep", "usd_rate_updated_at", "tax_enabled", "tax_iva_percent",
  "tax_iibb_percent", "tax_monotributo_monthly", "tax_prices_include_iva", "afip_cuit",
  "afip_razon_social", "afip_domicilio", "afip_punto_venta", "afip_environment", "afip_tipo_emisor",
  "afip_ta_expires_at", "whatsapp_number", "default_cta_text", "receipt_footer", "catalog_bg_color",
  "catalog_card_color", "catalog_accent_color", "brand_palettes", "category_pricing", "monthly_targets",
  "crm_segments", "loyalty_enabled", "loyalty_points_per_1000", "loyalty_points_value_ars",
  "referral_enabled", "referral_bonus_ars", "referral_bonus_points", "bank_cbu", "bank_alias",
  "bank_name", "bank_holder", "low_stock_threshold", "large_sale_threshold_ars", "margin_alert_percent",
  "expense_ratio_alert_percent", "overdue_check_window_hours", "cash_flow_warning_threshold_ars",
  "daily_sales_alert_threshold", "daily_margin_alert_threshold", "stock_dormido_days", "max_overstock_units",
  "max_ai_discount_percent", "ai_tone", "whatsapp_digest_enabled", "whatsapp_birthday_enabled",
  "mfa_required", "costo_por_pedido", "costo_almacenamiento_anual_pct", "fiscal_id_required_above",
] as const;

type ExportStatus = "exported" | "empty" | "truncated" | "error";
type ExportTableResult = {
  table: string;
  status: ExportStatus;
  row_count: number;
  available_row_count?: number;
  rows: Record<string, unknown>[];
  reason?: string;
};

function redactRow(table: string, row: Record<string, unknown>) {
  const safe = { ...row };
  if (table === "settings") {
    for (const column of SECRET_SETTINGS_COLUMNS) delete safe[column];
  }
  // El payload sin procesar puede contener datos que el proveedor no garantiza
  // estables ni necesarios para reconstruir la contabilidad del comercio.
  if (table === "payment_transactions") delete safe.raw;
  return safe;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  const auth = await requireUser(req, corsHeaders);
  if (auth.response) return auth.response;

  let body: { orgId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Cuerpo JSON inválido" }, 400);
  }
  const orgId = body.orgId;
  if (!orgId) return json({ error: "orgId requerido" }, 400);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRole) return json({ error: "Configuración de export no disponible" }, 503);
  const admin = createClient(url, serviceRole);

  const { data: membership, error: membershipError } = await admin
    .from("memberships")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (membershipError) return json({ error: "No se pudo verificar el acceso a la organización" }, 500);
  if (membership?.role !== "owner") {
    return json({ error: "Sólo el dueño puede exportar toda la organización" }, 403);
  }

  const tables: ExportTableResult[] = [];
  for (const table of EXPORTABLE_TABLES) {
    const { data, error, count } = await admin
      .from(table)
      .select(table === "settings" ? SETTINGS_EXPORT_COLUMNS.join(",") : "*", { count: "exact" })
      .eq("org_id", orgId)
      .limit(MAX_ROWS_PER_TABLE + 1);

    if (error) {
      // El manifiesto preserva la evidencia del fallo sin devolver el mensaje
      // crudo de PostgreSQL ni transformar una denegación en una tabla vacía.
      tables.push({
        table,
        status: "error",
        row_count: 0,
        rows: [],
        reason: error.code ? `No se pudo leer la tabla (${error.code})` : "No se pudo leer la tabla",
      });
      continue;
    }

    // PostgREST puede imponer un máximo de filas aunque el cliente pida más.
    // Sin `count` no hay manera honesta de distinguir esa respuesta de una
    // tabla completa; se declara error y no se entrega un CSV incompleto.
    if (count === null) {
      tables.push({
        table,
        status: "error",
        row_count: 0,
        rows: [],
        reason: "No se pudo verificar la cantidad total de filas",
      });
      continue;
    }

    const sourceRows = (data ?? []) as Record<string, unknown>[];
    const truncated = count > sourceRows.length || sourceRows.length > MAX_ROWS_PER_TABLE;
    const rows = sourceRows.slice(0, MAX_ROWS_PER_TABLE).map(row => redactRow(table, row));
    tables.push({
      table,
      status: truncated ? "truncated" : rows.length === 0 ? "empty" : "exported",
      row_count: rows.length,
      available_row_count: count,
      rows,
      ...(truncated ? { reason: `Se exportaron ${rows.length.toLocaleString("es-AR")} de ${count.toLocaleString("es-AR")} filas` } : {}),
    });
  }

  return json({
    schema_version: 1,
    generated_at: new Date().toISOString(),
    org_id: orgId,
    max_rows_per_table: MAX_ROWS_PER_TABLE,
    tables,
    excluded_credentials: EXCLUDED_CREDENTIAL_STORES,
  });
});
