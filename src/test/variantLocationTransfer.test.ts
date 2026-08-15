import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const migration = readFileSync(
  resolve(ROOT, "supabase/migrations/20260815000006_variant_location_transfers.sql"),
  "utf8",
);
const locations = readFileSync(resolve(ROOT, "src/pages/LocationsPage.tsx"), "utf8");

describe("transferencias de variantes entre depósitos", () => {
  it("exige una variante al mover un producto que las tiene y conserva la compatibilidad del producto simple", () => {
    expect(migration).toContain("p_variant_id       uuid DEFAULT NULL");
    expect(migration).toContain("Este producto tiene variantes: elegí el talle, sabor o presentación");
    expect(migration).toContain("p_variant_id=>p_variant_id");
    expect(migration).toContain("DROP FUNCTION IF EXISTS public.transfer_stock_between_locations(uuid, uuid, uuid, integer, text)");
  });

  it("valida el saldo de variante en origen, registra las dos puntas y no expone el RPC a anon", () => {
    expect(migration).toContain("FROM public.location_variant_stock lvs");
    expect(migration).toContain("FOR UPDATE;");
    expect(migration).toContain("'transfer_out'");
    expect(migration).toContain("'transfer_in'");
    expect(migration).toContain("variant_id,\n    product_name, variant_name");
    expect(migration).toContain("FROM PUBLIC, anon;");
    expect(migration).toContain("La transferencia de variante no cerró");
  });

  it("la pantalla deja elegir la presentación física y nunca inserta saldos desde el navegador", () => {
    expect(locations).toContain("Producto o variante");
    expect(locations).toContain("location_variant_stock");
    expect(locations).toContain("productsWithVariants");
    expect(locations).toContain("p_variant_id: selectedItem.variant_id");
    expect(locations).not.toContain('.from("location_variant_stock").insert');
  });
});
