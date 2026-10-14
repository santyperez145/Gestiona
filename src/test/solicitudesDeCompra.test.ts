import { describe, it, expect } from "vitest";
import fs from "node:fs";

// 2026-10-14 (funciones incoherentes): las solicitudes se numeraban «temp», un
// vendedor quedaba con una solicitud vacía, cualquiera aprobaba la suya y
// «pedida» / «recibida» eran etiquetas. La matriz
// scripts/solicitudes-de-compra-matrix.sql prueba la base; esto, la pantalla.
describe("solicitudes de compra", () => {
  const tab = fs.readFileSync("src/components/purchases/PurchaseRequestsTab.tsx", "utf8");
  const migracion = fs.readFileSync("supabase/migrations/20261014001900_solicitudes_de_compra.sql", "utf8");

  it("se guardan en una operación que numera la base, con productos del catálogo", () => {
    expect(tab).toContain('supabase.rpc("guardar_solicitud_de_compra"');
    expect(tab).not.toContain('request_number: "temp"');
    expect(tab).not.toContain('from("purchase_request_items").insert');
    expect(tab).toContain("<ProductCombobox");
  });

  it("pedida sólo convirtiéndola en orden, y recibida sólo con la orden", () => {
    expect(tab).toContain('supabase.rpc("convertir_solicitud_en_orden"');
    expect(tab).not.toMatch(/cambiarEstado\([^)]*"ordered"|cambiarEstado\([^)]*"received"/);
    expect(migracion).toContain("Una solicitud pasa a «pedida» al convertirla en orden de compra");
    expect(migracion).toContain("Sólo el dueño o un administrador aprueban o rechazan solicitudes");
  });

  it("aprobar se muestra sólo a dueño o administrador", () => {
    expect(tab).toContain('const puedeAprobar = activeRole === "owner" || activeRole === "admin";');
  });
});
