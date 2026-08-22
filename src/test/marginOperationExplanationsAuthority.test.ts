import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260822000005_margin_operation_explanations.sql"),
  "utf8",
);
const table = readFileSync(
  resolve(process.cwd(), "src/components/analytics/MarginOperationsTable.tsx"),
  "utf8",
);
const tab = readFileSync(
  resolve(process.cwd(), "src/components/analytics/ChannelMarginTab.tsx"),
  "utf8",
);

describe("explicación canónica por operación", () => {
  it("conserva líneas e ingresos y exige cuatro fuentes sin blockers", () => {
    expect(migration).toContain("sum(line_count)");
    expect(migration).toContain("v_fact_revenue <> v_operation_revenue");
    expect(migration).toContain("known_components = 4 AND NOT classified.has_margin_blocker");
    expect(migration).toContain("devolucion_neta");
    expect(migration).toContain("return_pending");
  });

  it("explica el cobro dividido desde importes persistidos", () => {
    expect(migration).toContain("jsonb_array_elements");
    expect(migration).toContain("payment_mix_difference_ars");
    expect(migration).toContain("payment_method_totals");
    expect(table).toContain("Mix de cobro persistido");
    expect(table).toContain("Diferencia contra ingresos");
  });

  it("no inventa el impacto histórico de cupón o precio promocional", () => {
    expect(migration).toContain("importe_descuento_cupon");
    expect(migration).toContain("precio_referencia_historico");
    expect(migration).toContain("promotion_evidence_status");
    expect(table).toContain("Evidencia parcial");
    expect(table).toContain("Descuento medido");
  });

  it("mantiene detalle tenant y fuentes internas revocadas", () => {
    expect(migration).toContain("public.is_org_member(operation.org_id, auth.uid())");
    expect(migration).toContain("REVOKE ALL ON TABLE public._sale_margin_operations_source FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("REVOKE ALL ON TABLE public.sale_margin_operations FROM PUBLIC, anon");
    expect(tab).toContain('.from("sale_margin_operations")');
  });
});
