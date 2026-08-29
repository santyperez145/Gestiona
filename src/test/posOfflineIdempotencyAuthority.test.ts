import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const migration = readFileSync(
  resolve(ROOT, "supabase/migrations/20260829000030_pos_offline_ticket_idempotency.sql"),
  "utf8",
);
const store = readFileSync(resolve(ROOT, "src/lib/supabaseStore.ts"), "utf8");
const pos = readFileSync(resolve(ROOT, "src/pages/POSPage.tsx"), "utf8");
const sales = readFileSync(resolve(ROOT, "src/pages/SalesPage.tsx"), "utf8");

describe("autoridad e idempotencia del ticket offline", () => {
  it("persiste una clave unica por organizacion en el padre comercial", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS client_transaction_id uuid");
    expect(migration).toContain("sale_transactions_org_client_transaction_uidx");
    expect(migration).toContain("(org_id, client_transaction_id)");
    expect(migration).toContain("pg_advisory_xact_lock");
  });

  it("devuelve el ticket existente y rechaza reutilizar la clave con otros renglones", () => {
    expect(migration).toContain("'reused', true");
    expect(migration).toContain("v_existing_sale_ids IS DISTINCT FROM v_incoming_sale_ids");
    expect(migration).toContain("La clave de ticket ya fue usada con otro contenido");
  });

  it("registra deuda, cupon y canje dentro de la transaccion del servidor", () => {
    expect(migration).toContain("INSERT INTO public.debts");
    expect(migration).toContain("SET current_uses = current_uses + 1");
    expect(migration).toContain("UPDATE public.influencer_exchanges");
    expect(migration).toContain("debts_org_sale_uidx");
  });

  it("el navegador ya no incrementa cupones ni suma ROI despues del commit", () => {
    expect(store).not.toContain("export async function incrementCouponUse");
    expect(store).not.toContain("export async function attributeSaleToExchange");
    expect(pos).not.toContain("incrementCouponUse");
    expect(sales).not.toContain("incrementCouponUse");
    expect(sales).not.toContain("attributeSaleToExchange");
  });

  it("marca el origen offline y transmite la atribucion al RPC", () => {
    expect(pos).toContain("offline_origin: !isOnline");
    expect(store).toContain("influencer_exchange_id: attributedExchangeId");
    expect(migration).toContain("v_offline_origin");
    expect(migration).toContain("influencer_exchange_id");
  });

  it("normaliza el esquema historico de cupones al contrato que consumen POS y Ventas", () => {
    expect(store).toContain("data.discount_percent");
    expect(store).toContain("data.discount_fixed_ars");
    expect(store).toContain("discount_type: percentage > 0 ? 'percentage' : 'fixed'");
    expect(store).toContain("discount_value: percentage > 0 ? percentage : fixed");
  });
});
