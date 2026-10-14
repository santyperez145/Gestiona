import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { cantidadSugerida, enlaceDeWhatsAppDeOrden, textoDeOrdenParaWhatsApp } from "@/lib/ordenesDeCompra";

// 2026-10-14 (funciones incoherentes): «Enviar OC» sólo cambiaba el estado y el
// modal de Proveedores mandaba un producto con un número inventado y una
// cotización fija. Ahora se envía la orden guardada, completa.
describe("enviar una orden de compra", () => {
  const orden = {
    order_number: "OC-0007", supplier_name: "Distribuidora Norte", currency: "ARS", total_amount: 12500.5,
    expected_date: "2026-10-20", notes: "Entregar por la mañana",
    items: [{ product_name: "Cable 2,5 mm", sku: "CAB-25", quantity_ordered: 12.5 }, { product_name: "Térmica 20A", quantity_ordered: 2 }],
  };

  it("el WhatsApp lleva todos los renglones, el total en su moneda y la entrega", () => {
    const t = textoDeOrdenParaWhatsApp(orden, "Ferretería");
    expect(t).toContain("orden de compra OC-0007 de Ferretería");
    expect(t).toContain("• Cable 2,5 mm (CAB-25): 12,5");
    expect(t).toContain("• Térmica 20A: 2");
    expect(t).toContain("Total: $ 12.500,50");
    expect(t).toContain("Entrega esperada: 20/10/2026");
    expect(t).toContain("Entregar por la mañana");
    expect(textoDeOrdenParaWhatsApp({ ...orden, currency: "USD", total_amount: 30 }, "F")).toContain("Total: US$ 30,00");
  });

  it("el enlace sólo sale con un teléfono que sirve", () => {
    expect(enlaceDeWhatsAppDeOrden("+54 9 11 5555-1234", "hola")).toBe("https://wa.me/5491155551234?text=hola");
    expect(enlaceDeWhatsAppDeOrden("123", "hola")).toBeNull();
    expect(enlaceDeWhatsAppDeOrden(null, "hola")).toBeNull();
  });

  it("la cantidad sugerida lleva el stock a tres veces el mínimo", () => {
    expect(cantidadSugerida({ stock: 2, low_stock_threshold: 5 })).toBe(13);
    expect(cantidadSugerida({ stock: 40, low_stock_threshold: 5 })).toBe(1);
    expect(cantidadSugerida({ stock: null, low_stock_threshold: null })).toBe(9);
  });

  it("el correo lo arma el servidor desde la orden guardada, no desde el navegador", () => {
    const fn = fs.readFileSync("supabase/functions/send-supplier-po/index.ts", "utf8");
    expect(fn).toContain('.from("purchase_order_items")');
    expect(fn).not.toMatch(/productName|unitCostUSD|PO-\$\{Date\.now/);
    const modal = fs.readFileSync("src/components/shared/SupplierPOModal.tsx", "utf8");
    expect(modal).toContain('supabase.rpc("guardar_orden_de_compra"');
    expect(modal).not.toMatch(/1700|send-supplier-po/);
    const pagina = fs.readFileSync("src/pages/PurchaseOrdersPage.tsx", "utf8");
    expect(pagina).not.toContain('onAdvanceStatus("sent")');
    expect(pagina).toContain("<EnviarOrdenDialog");
  });
});
