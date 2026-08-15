// Contrato compartido por el export portable (D5) y el respaldo gestionado
// (D8). Mantener una sola lista evita que un backup diga cubrir relaciones
// distintas de las que declara el manifiesto de portabilidad.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

export const SNAPSHOT_SCHEMA_VERSION = 1;
export const MAX_ROWS_PER_TABLE = 50_000;

/** Datos del negocio cuyo contrato tiene `org_id` propio y se pueden portar. */
export const SNAPSHOT_TABLES = [
  // Catálogo, compras e inventario
  "products", "product_variants", "product_perfume_details", "product_batches",
  "product_bundles", "product_bundle_items", "product_combos", "quantity_discounts",
  "price_lists", "price_history", "stock_movements", "stock_reservations", "stock_history",
  "stock_counts", "stock_count_items", "locations", "location_stock", "location_variant_stock", "warehouses",
  "warehouse_bins", "warehouse_zones", "inventory_transfers", "inventory_transfer_items", "stock_transfers",
  "purchases", "purchase_orders", "purchase_order_items", "purchase_order_receipts",
  "purchase_requests", "suppliers", "supplier_payments", "supplier_debts",
  // Ventas, caja, finanzas y fiscal
  "sales", "sale_items", "sale_transactions", "quotes", "invoices", "debts", "debt_payments", "expenses",
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

export const EXCLUDED_CREDENTIAL_STORES = [
  "afip_credentials", "payment_connections", "meli_connections", "api_keys", "org_api_keys",
  "oauth_states", "portal_sessions", "push_subscriptions", "webhook_configs",
] as const;

const SECRET_SETTINGS_COLUMNS = new Set([
  "mp_access_token", "api_key", "mp_webhook_secret", "webhook_secret", "smtp_pass",
  "evolution_api_key", "ml_access_token", "ml_refresh_token",
]);

// `settings` concentra configuración útil y secretos históricos en la misma
// fila. La selección es positiva para que una columna secreta futura no se
// filtre por accidente antes de que alguien actualice este contrato.
export const SETTINGS_SNAPSHOT_COLUMNS = [
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

export type SnapshotStatus = "exported" | "empty" | "truncated" | "error";
export type SnapshotTableResult = {
  table: string;
  status: SnapshotStatus;
  row_count: number;
  available_row_count?: number;
  rows: Record<string, unknown>[];
  reason?: string;
};

export type OrganizationSnapshot = {
  schema_version: number;
  generated_at: string;
  org_id: string;
  max_rows_per_table: number;
  tables: SnapshotTableResult[];
  excluded_credentials: readonly string[];
};

function redactRow(table: string, row: Record<string, unknown>) {
  const safe = { ...row };
  if (table === "settings") {
    for (const column of SECRET_SETTINGS_COLUMNS) delete safe[column];
  }
  // El payload crudo del proveedor de pagos no es estable ni necesario para
  // reconstruir la contabilidad y puede contener datos de terceros.
  if (table === "payment_transactions") delete safe.raw;
  return safe;
}

/**
 * Lee una organización con service_role y deja evidencia por tabla. Un backup
 * nunca se considera completo si una tabla falla o queda truncada.
 */
export async function collectOrganizationSnapshot(
  admin: SupabaseClient,
  orgId: string,
): Promise<OrganizationSnapshot> {
  const tables: SnapshotTableResult[] = [];
  for (const table of SNAPSHOT_TABLES) {
    const { data, error, count } = await admin
      .from(table)
      .select(table === "settings" ? SETTINGS_SNAPSHOT_COLUMNS.join(",") : "*", { count: "exact" })
      .eq("org_id", orgId)
      .limit(MAX_ROWS_PER_TABLE + 1);

    if (error) {
      tables.push({
        table,
        status: "error",
        row_count: 0,
        rows: [],
        reason: error.code ? `No se pudo leer la tabla (${error.code})` : "No se pudo leer la tabla",
      });
      continue;
    }
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

  return {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    org_id: orgId,
    max_rows_per_table: MAX_ROWS_PER_TABLE,
    tables,
    excluded_credentials: EXCLUDED_CREDENTIAL_STORES,
  };
}

export function snapshotIsComplete(snapshot: Pick<OrganizationSnapshot, "tables">): boolean {
  return snapshot.tables.every(table => table.status === "exported" || table.status === "empty");
}

/** El manifiesto se guarda sin las filas; el archivo privado conserva el dato. */
export function snapshotManifest(snapshot: OrganizationSnapshot) {
  return {
    schema_version: snapshot.schema_version,
    generated_at: snapshot.generated_at,
    org_id: snapshot.org_id,
    max_rows_per_table: snapshot.max_rows_per_table,
    tables: snapshot.tables.map(({ rows: _rows, ...table }) => table),
    excluded_credentials: snapshot.excluded_credentials,
  };
}

export async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Prueba que un archivo descargado sigue siendo el snapshot que se registró y
 * que no es un manifiesto aparentemente exitoso con una tabla incompleta.
 */
export function validateSnapshot(
  value: unknown,
  expectedOrgId: string,
): { ok: boolean; reason?: string } {
  if (!value || typeof value !== "object") return { ok: false, reason: "El archivo no contiene un objeto JSON" };
  const snapshot = value as Partial<OrganizationSnapshot>;
  if (snapshot.schema_version !== SNAPSHOT_SCHEMA_VERSION) return { ok: false, reason: "La versión del snapshot no es compatible" };
  if (snapshot.org_id !== expectedOrgId) return { ok: false, reason: "El snapshot pertenece a otra organización" };
  if (!Array.isArray(snapshot.tables) || snapshot.tables.length !== SNAPSHOT_TABLES.length) {
    return { ok: false, reason: "El snapshot no cubre el conjunto esperado de tablas" };
  }
  const expected = new Set(SNAPSHOT_TABLES);
  for (const table of snapshot.tables) {
    if (!table || typeof table !== "object" || !expected.has(table.table as typeof SNAPSHOT_TABLES[number])) {
      return { ok: false, reason: "El snapshot contiene una tabla no reconocida" };
    }
    if (table.status !== "exported" && table.status !== "empty") {
      return { ok: false, reason: `La tabla ${table.table} no está completa` };
    }
    if (!Array.isArray(table.rows) || table.rows.length !== table.row_count) {
      return { ok: false, reason: `La cantidad de filas de ${table.table} no coincide` };
    }
  }
  return { ok: true };
}
