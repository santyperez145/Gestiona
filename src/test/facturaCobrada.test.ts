import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { facturaCobrada } from "@/lib/facturaCobrada";

// 2026-10-15: Facturas decía «Pendiente cobro $1,00» por un pedido que
// Mercado Pago había cobrado el 31/7.
describe("factura cobrada", () => {
  const cobrados = { pedidos: new Set(["o1"]), ventas: new Set(["s1"]) };
  it("la factura de un pedido o una venta cobrados está cobrada", () => {
    expect(facturaCobrada({ status: "sent", ecommerce_order_id: "o1" }, cobrados)).toBe(true);
    expect(facturaCobrada({ status: "draft", sale_id: "s1" }, cobrados)).toBe(true);
    expect(facturaCobrada({ status: "sent", ecommerce_order_id: "o2" }, cobrados)).toBe(false);
  });
  it("una anulada o una nota de crédito no se dan por cobradas", () => {
    expect(facturaCobrada({ status: "canceled", ecommerce_order_id: "o1" }, cobrados)).toBe(false);
    expect(facturaCobrada({ status: "sent", ecommerce_order_id: "o1", nota_credito_de: "f1" }, cobrados)).toBe(false);
  });
  it("el pendiente de cobro no cuenta lo cobrado", () => {
    const pagina = fs.readFileSync("src/pages/InvoicesPage.tsx", "utf8");
    expect(pagina).toContain('pending: invoices.filter((i) => i.status === "sent" && !cobrada(i))');
  });
});
