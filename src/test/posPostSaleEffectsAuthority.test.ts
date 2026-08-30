import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(resolve(
  root,
  "supabase/migrations/20260829000043_pos_ticket_post_sale_effects.sql",
), "utf8");
const pos = readFileSync(resolve(root, "src/pages/POSPage.tsx"), "utf8");
const store = readFileSync(resolve(root, "src/lib/supabaseStore.ts"), "utf8");

describe("efectos comerciales autoritativos por ticket", () => {
  it("reconcilia fidelidad y alerta contra sale_transaction", () => {
    expect(migration).toContain("public.reconcile_sale_transaction_effects");
    expect(migration).toContain("sale.sale_transaction_id = p_transaction_id");
    expect(migration).toContain("floor(v_total / 1000.0)::integer * v_points_per_1000");
    expect(migration).toContain("'sale_transaction'");
  });

  it("es idempotente y recalcula al anular", () => {
    expect(migration).toContain("loyalty_points_org_ticket_sale_uidx");
    expect(migration).toContain("notifications_org_sale_transaction_uidx");
    expect(migration).toContain("ON CONFLICT (org_id, reference_id, reason)");
    expect(migration).toContain("AFTER INSERT OR UPDATE OR DELETE ON public.sales");
    expect(migration).toContain("IF v_lines = 0 THEN");
  });

  it("no devuelve al navegador la autoridad de postventa", () => {
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("TO service_role");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.trg_reconcile_sale_transaction_effects()",
    );
  });

  it("elimina la doble escritura client-side", () => {
    expect(pos).not.toContain("awardLoyaltyPointsForSale");
    expect(pos).not.toContain('type: "venta_grande"');
    expect(store).not.toContain("export async function awardLoyaltyPointsForSale");
  });

  it("los fallos secundarios quedan visibles sin deshacer la venta", () => {
    expect(migration).toContain("RAISE WARNING 'No se pudieron reconciliar efectos del ticket %: %'");
    expect(migration).not.toContain("EXCEPTION WHEN OTHERS THEN\n  RETURN NEW");
  });
});
