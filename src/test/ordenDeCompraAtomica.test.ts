import { describe, it, expect } from "vitest";
import fs from "node:fs";

// 2026-10-14 (páginas legacy): crear una OC insertaba la cabecera y después
// los renglones, editar los borraba y reinsertaba, y nadie calculaba los
// totales (toda orden mostraba $0). Reposición cargaba compras programadas
// sueltas. Ahora todo pasa por guardar_orden_de_compra (20261014001200).
describe("órdenes de compra en una sola operación", () => {
  const pagina = fs.readFileSync("src/pages/PurchaseOrdersPage.tsx", "utf8");
  const reposicion = fs.readFileSync("src/components/inventory/ReposicionView.tsx", "utf8");
  const sql = fs.readFileSync("supabase/migrations/20261014001200_guardar_orden_de_compra.sql", "utf8");

  it("la pantalla guarda cabecera y renglones juntos, sin inserts sueltos", () => {
    expect(pagina).toContain('supabase.rpc("guardar_orden_de_compra"');
    expect(pagina).not.toMatch(/from\("purchase_orders"\)\.insert/);
    expect(pagina).not.toMatch(/from\("purchase_order_items"\)\.(insert|delete)/);
  });

  it("reposición crea una orden por proveedor, no compras programadas", () => {
    expect(reposicion).toContain('supabase.rpc("guardar_orden_de_compra"');
    expect(reposicion).not.toMatch(/from\("purchases"\)\.insert/);
    expect(reposicion).toContain('const clave = item.supplierId ?? "__sin__";');
  });

  it("la base calcula los totales, verifica productos y respeta el estado", () => {
    expect(sql).toContain("v_neto := round(round(v_cant, 3) * round(v_costo, 4), 2);");
    expect(sql).toContain("total_amount = v_sub + v_impuesto - v_descuento");
    expect(sql).toContain("FROM public.products WHERE id = v_prod AND org_id = p_org;");
    expect(sql).toContain("IF v_estado NOT IN ('draft', 'sent', 'confirmed') THEN");
    expect(sql).toContain("public.generate_po_number(p_org)");
    expect(sql).toContain("SECURITY INVOKER");
  });
});
