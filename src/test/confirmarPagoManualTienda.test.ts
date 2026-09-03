import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const leer = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("confirmar pago manual de tienda", () => {
  const migracion = leer("supabase/migrations/20260902000050_confirmar_pago_manual_tienda.sql");
  const migracionMarca = leer("supabase/migrations/20260903000070_nerqia_identidad_canonica.sql");
  const inspector = leer("src/components/ecommerce/StoreOrderInspector.tsx");
  const page = leer("src/components/ecommerce/StoreOrdersWorkspace.tsx");

  it("la RPC exige permiso, acota a offline y no queda abierta a anon", () => {
    expect(migracion).toContain("exigir_permiso");
    expect(migracion).toContain("ecommerce");
    expect(migracion).toContain("transferencia");
    expect(migracion).toContain("efectivo");
    expect(migracion).toContain("mark_store_order_paid");
    expect(migracion).toContain("REVOKE ALL ON FUNCTION public.confirmar_pago_manual_tienda");
    expect(migracion).toContain("GRANT EXECUTE ON FUNCTION public.confirmar_pago_manual_tienda");
    expect(migracion).toContain("TO authenticated");
    expect(migracion).toMatch(/IF has_function_privilege\(\s*'anon'/);
  });

  it("no deja confirmar Nerqia Pay a mano", () => {
    expect(migracion).toContain("Gestiona Pay se acredita");
    expect(migracionMarca).toContain("replace(v_definition, 'Gestiona Pay', 'Nerqia Pay')");
    expect(migracion).toContain("NOT IN ('transferencia', 'efectivo')");
  });

  it("el inspector ofrece Marcar como cobrado y la página llama la RPC", () => {
    expect(inspector).toContain("canConfirmManualStorePayment");
    expect(inspector).toContain("Marcar como cobrado");
    expect(page).toContain("confirmar_pago_manual_tienda");
    expect(page).toContain("onConfirmPaid");
    expect(page).toContain("useConfirmDialog");
  });
});
