import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { netoDesdePrecioFinal } from "@/lib/manualInvoiceTax";

// 2026-10-14, pedido del dueño: las pantallas legacy «no toman los productos,
// sólo carga manual». La factura manual se escribía renglón por renglón; ahora
// toma el producto del catálogo (o su código) y calcula el neto desde el
// precio final, porque la factura manual trabaja con netos y la base
// (`crear_factura_manual`) recalcula todo.
describe("factura manual con productos del catálogo", () => {
  it("el neto sale del precio final y la alícuota del renglón", () => {
    expect(netoDesdePrecioFinal(1210, 21)).toBe(1000);
    expect(netoDesdePrecioFinal(1105, 10.5)).toBe(1000);
    expect(netoDesdePrecioFinal(999.99, 21)).toBe(826.44);
  });

  it("sin IVA (sin ARCA o factura C) el neto es el precio final", () => {
    expect(netoDesdePrecioFinal(1500, 0)).toBe(1500);
  });

  it("la pantalla ofrece el catálogo y el lector sólo en la factura manual", () => {
    const pagina = fs.readFileSync("src/pages/InvoicesPage.tsx", "utf8");
    expect(pagina).toContain("<ProductCombobox<ProductoFactura>");
    expect(pagina).toContain("productoPorCodigo(catalogoFactura ?? [], codigoFactura)");
    expect(pagina).toContain("netoDesdePrecioFinal(Number(prod.sale_price_ars) || 0, alicuotaDe(conAlicuota))");
    // Una factura de una venta registrada no se edita: el catálogo no aparece.
    expect(pagina).toContain("{sourceSaleGrossTotal === null && (\n                  <ProductCombobox<ProductoFactura>");
  });
});
