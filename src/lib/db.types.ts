/**
 * db.types.ts — Supplemental type definitions for Supabase tables
 * not yet included in the auto-generated types.ts.
 *
 * Update this file when new migrations add tables, until we can
 * run `supabase gen types typescript --linked` again.
 */

// ─── Expenses ──────────────────────────────────────────────────────────────────
export interface Expense {
  id: string;
  org_id: string | null;
  user_id: string;
  description: string;
  amount_ars: number;
  category: string | null;
  date: string;
  notes: string | null;
  recurring: boolean | null;
  recurring_period: string | null;
  created_at: string;
}

// ─── Customers ─────────────────────────────────────────────────────────────────
export interface Customer {
  id: string;
  org_id: string | null;
  user_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  birthday: string | null;
  tags: string[] | null;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
}

// ─── CustomerNotes ─────────────────────────────────────────────────────────────
export interface CustomerNote {
  id: string;
  org_id: string | null;
  user_id: string;
  customer_name: string;
  type: string;
  summary: string;
  created_at: string;
}

// ─── Stock Movements ───────────────────────────────────────────────────────────
export type StockMovementType =
  | "purchase" | "sale" | "return_in" | "return_out"
  | "adjustment_in" | "adjustment_out" | "transfer_in" | "transfer_out"
  | "physical_count" | "initial";

export interface StockMovement {
  id: string;
  org_id: string;
  product_id: string | null;
  variant_id: string | null;
  product_name: string;
  variant_name: string | null;
  movement_type: StockMovementType;
  quantity: number;
  stock_before: number;
  stock_after: number;
  reference_type: string | null;
  reference_id: string | null;
  unit_cost_usd: number | null;
  unit_price_ars: number | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

// ─── Cash Entries ──────────────────────────────────────────────────────────────
export type CashEntryType =
  | "sale_in" | "debt_payment" | "expense_out"
  | "supplier_out" | "manual_in" | "manual_out"
  | "opening" | "closing";

export interface CashEntry {
  id: string;
  org_id: string;
  session_id: string | null;
  entry_type: CashEntryType;
  payment_method: string | null;
  amount_ars: number;
  reference_type: string | null;
  reference_id: string | null;
  description: string | null;
  created_by: string | null;
  created_at: string;
}

// ─── Supplier Debts ────────────────────────────────────────────────────────────
export type SupplierDebtStatus = "pending" | "partial" | "paid";

export interface SupplierDebt {
  id: string;
  org_id: string;
  supplier_id: string | null;
  supplier_name: string;
  description: string;
  amount_ars: number;
  paid_ars: number;
  remaining_ars: number; // GENERATED ALWAYS AS STORED
  due_date: string | null;
  status: SupplierDebtStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SupplierPayment {
  id: string;
  org_id: string;
  supplier_debt_id: string;
  amount_ars: number;
  method: string;
  note: string | null;
  paid_at: string;
}

// ─── Subscriptions ─────────────────────────────────────────────────────────────
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "paused";

export interface Subscription {
  id: string;
  org_id: string;
  plan_id: string;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Plans ─────────────────────────────────────────────────────────────────────
export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price_usd_monthly: number;
  price_usd_yearly: number;
  stripe_price_id_monthly: string | null;
  stripe_price_id_yearly: string | null;
  max_products: number | null;
  max_sales_per_month: number | null;
  max_users: number | null;
  ai_enabled: boolean;
  backups_enabled: boolean;
  custom_branding: boolean;
  sort_order: number;
  active: boolean;
}

// ─── Automation Flows ──────────────────────────────────────────────────────────
export interface AutomationFlow {
  id: string;
  org_id: string;
  name: string;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  action_type: string;
  action_config: Record<string, unknown>;
  active: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Helper type guard ─────────────────────────────────────────────────────────
export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];
