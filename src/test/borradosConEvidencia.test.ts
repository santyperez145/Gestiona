import { describe, it, expect } from "vitest";
import fs from "node:fs";

// 2026-10-14: borrar una venta cobrada/facturada/fiada o una deuda con cobros
// dejaba la caja, la factura o el cliente con datos que ya no cuadraban. La
// base lo rechaza (matrices venta-/deuda-cobrada-no-se-borra) y las pantallas
// muestran el motivo en vez de un error sin atrapar.
describe("lo que tiene evidencia no se borra", () => {
  it("Ventas y Cuentas corrientes atrapan el rechazo y muestran el motivo", () => {
    const ventas = fs.readFileSync("src/pages/SalesPage.tsx", "utf8");
    const deudas = fs.readFileSync("src/pages/DebtsPage.tsx", "utf8");
    expect(ventas).toContain('toast.error("No se puede borrar esta venta"');
    expect(deudas).toContain('toast.error("No se puede borrar esta deuda"');
  });
  it("los guardias están en la base", () => {
    expect(fs.readFileSync("supabase/migrations/20261014002400_venta_cobrada_no_se_borra.sql", "utf8")).toContain("BEFORE DELETE ON public.sales");
    expect(fs.readFileSync("supabase/migrations/20261014002500_deuda_cobrada_no_se_borra.sql", "utf8")).toContain("BEFORE DELETE ON public.debts");
  });

  it("tampoco se reescribe: importe, cantidad, producto y cobro de una venta con evidencia", () => {
    const m = fs.readFileSync("supabase/migrations/20261014002900_venta_con_evidencia_no_se_reescribe.sql", "utf8");
    expect(m).toContain("BEFORE UPDATE ON public.sales");
    expect(m).toContain("corregila con una devolución");
  });
});
