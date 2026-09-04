import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260904000080_store_order_bulk_fulfillment.sql"),
  "utf8",
);
const types = readFileSync(resolve(process.cwd(), "src/integrations/supabase/types.ts"), "utf8");

describe("fulfillment masivo de pedidos", () => {
  it("reutiliza la transición individual y limita el lote", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.bulk_update_store_order_fulfillment");
    expect(migration).toContain("public.update_store_order_fulfillment(v_order_id, v_status)");
    expect(migration).toContain("v_requested > 50");
    expect(migration).toContain("FOR UPDATE");
    expect(migration).toContain("org_id = p_org_id");
  });

  it("exige permiso tenant, no filtra IDs externos y audita el resumen", () => {
    expect(migration).toContain("public.has_permission(p_org_id, 'ecommerce', 'edit')");
    expect(migration).toContain("Pedido no encontrado en esta tienda");
    expect(migration).toContain("'fulfillment_bulk', 'ecommerce_order'");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("TO authenticated");
  });

  it("devuelve cambios, no-ops y omisiones por fila", () => {
    expect(migration).toContain("'outcome', 'changed'");
    expect(migration).toContain("'outcome', 'unchanged'");
    expect(migration).toContain("'outcome', 'skipped'");
    expect(migration).toContain("'outcome', 'duplicate'");
    expect(migration).toContain("No se pudo actualizar este pedido");
    expect(types).toContain("bulk_update_store_order_fulfillment:");
  });
});
