import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const migration = readFileSync(
  resolve(ROOT, "supabase/migrations/20260815000005_store_fulfillment_location.sql"),
  "utf8",
);
const storePage = readFileSync(resolve(ROOT, "src/pages/EcommerceStorePage.tsx"), "utf8");

describe("depósito de despacho de la tienda", () => {
  it("guarda una foto inmutable del depósito de la tienda y no acepta un UUID del checkout", () => {
    expect(migration).toContain("fulfillment_location_id uuid");
    expect(migration).toContain("assign_store_order_fulfillment_location");
    expect(migration).toContain("NEW.fulfillment_location_id := v_location_id");
    expect(migration).toContain("La sucursal de despacho de una orden no se puede cambiar");
    expect(migration).toContain("validate_store_fulfillment_location");
  });

  it("mantiene un saldo de variante por sucursal y no infiere una distribución entre depósitos", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.location_variant_stock");
    expect(migration).toContain("ON CONFLICT (location_id, variant_id) DO UPDATE");
    expect(migration).toContain("HAVING count(*) = 1");
    expect(migration).toContain("Con dos o más no se adivina");
    expect(migration).toContain("public.stock_disponible(v_pid, v_vid, NEW.fulfillment_location_id)");
  });

  it("conserva variante y ubicación al cobrar y al recibir una devolución", () => {
    expect(migration).toContain("variant_id, location_id, product_name, quantity");
    expect(migration).toContain("v_order.fulfillment_location_id");
    expect(migration).toContain("FOR UPDATE;");
    expect(migration).toContain("El ciclo venta/devolución no cerró por ubicación");
  });

  it("da al comercio una elección explícita, con un modo global honesto", () => {
    expect(storePage).toContain("GLOBAL_FULFILLMENT_LOCATION");
    expect(storePage).toContain("Depósito de despacho");
    expect(storePage).toContain('supabase.from("locations")');
    expect(storePage).toContain("fulfillment_location_id: storeForm.fulfillment_location_id");
    expect(storePage).toContain("Stock global (sin sucursal)");
  });
});
