import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260929001050_seller_commission_finance_authority.sql",
  "utf8",
);
const page = readFileSync("src/pages/SellerCommissionsPage.tsx", "utf8");
const drill = readFileSync("scripts/seller-commission-matrix.sql", "utf8");

describe("autoridad financiera de comisiones de vendedores", () => {
  it("calcula ventas cobradas netas de devoluciones en la base", () => {
    expect(migration).toContain("sale.paid");
    expect(migration).toContain("sale.returned_quantity");
    expect(migration).toContain("v_sales * v_member.commission_percent / 100");
  });

  it("mantiene una sola liquidacion server-side por vendedor y periodo", () => {
    expect(migration).toContain("seller_payouts_calculation_key_unique");
    expect(migration).toContain("ON CONFLICT (calculation_key)");
    expect(migration).toContain("v_row.status = 'paid'");
    expect(migration).toContain("REVOKE ALL ON TABLE public.seller_payouts");
  });

  it("solo confirma dinero con referencia, gasto y asiento", () => {
    expect(migration).toContain("char_length(v_reference) < 3");
    expect(migration).toContain("INSERT INTO public.expenses");
    expect(migration).toContain("public.ledger_asentar_gasto(v_expense)");
    expect(migration).toContain("payment_reference = v_reference");
  });

  it("la UI delega configuracion, calculo y pago a RPC", () => {
    expect(page).toContain("configureSellerCommission");
    expect(page).toContain("generateSellerCommission");
    expect(page).toContain("settleSellerCommission");
    expect(page).not.toContain('.from("seller_payouts").insert');
    expect(page).not.toContain('.from("seller_payouts").update');
  });

  it("certifica el recorrido real y revierte todos los datos de ensayo", () => {
    expect(drill).toContain("public.generate_seller_commission");
    expect(drill).toContain("public.settle_seller_commission");
    expect(drill).toContain("public.ledger_entries");
    expect(drill).toContain("seller commission matrix rollback");
  });
});
