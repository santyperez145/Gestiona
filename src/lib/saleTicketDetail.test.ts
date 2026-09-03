import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildSaleTicketDetail, marginOperationIdForSale, type SaleTicketLine } from "./saleTicketDetail";

const lines: SaleTicketLine[] = [
  {
    id: "line-a",
    sale_transaction_id: "ticket-12345678",
    product_name: "Producto A",
    quantity: 2,
    total_ars: 4000,
    cost_of_goods_ars: 2200,
    profit_ars: 1800,
    paid: true,
    payment_method: "efectivo",
    source: "pos",
    customer_name: "Ada",
    seller_name: "Nora",
    date: "2026-08-29",
  },
  {
    id: "line-b",
    sale_transaction_id: "ticket-12345678",
    product_name: "Producto B",
    quantity: 1,
    total_ars: 2000,
    cost_of_goods_ars: 1200,
    profit_ars: 800,
    paid: false,
    payment_method: "transferencia",
    source: "pos",
    customer_name: "Ada",
    seller_name: "Nora",
    invoice_id: "invoice-1",
    returned: true,
    returned_quantity: 1,
    date: "2026-08-29",
  },
  {
    id: "line-other",
    sale_transaction_id: "ticket-other",
    product_name: "No pertenece",
    quantity: 99,
    total_ars: 99999,
    profit_ars: 99999,
    paid: true,
  },
];

describe("detalle canónico de un ticket de venta", () => {
  it("agrupa sólo las líneas del ticket elegido y reconcilia sus importes", () => {
    const detail = buildSaleTicketDetail(lines, "line-a");

    expect(detail?.lines.map(line => line.id)).toEqual(["line-a", "line-b"]);
    expect(detail).toMatchObject({
      code: "12345678",
      units: 3,
      totalArs: 6000,
      costArs: 3400,
      profitArs: 2600,
      marginPercent: 43.333333333333336,
    });
  });

  it("explica cobro parcial, factura y devolución sin convertirlos en un estado verde", () => {
    const detail = buildSaleTicketDetail(lines, "line-b");

    expect(detail).toMatchObject({
      allPaid: false,
      partiallyPaid: true,
      invoicedLines: 1,
      hasReturn: true,
      returnedUnits: 1,
      paymentMethods: ["efectivo", "transferencia"],
    });
  });

  it("mantiene una venta heredada sin transaction id como un único registro", () => {
    const legacy = buildSaleTicketDetail([
      { id: "legacy-abcdef12", quantity: 1, total_ars: 100, profit_ars: 25, paid: true },
      { id: "legacy-other", quantity: 3, total_ars: 300, profit_ars: 90, paid: true },
    ], "legacy-abcdef12");

    expect(legacy?.isGrouped).toBe(false);
    expect(legacy?.lines).toHaveLength(1);
    expect(legacy?.code).toBe("ABCDEF12");
    expect(legacy?.marginOperationId).toBe("legacy-abcdef12");
  });

  it("una venta de tienda usa ecommerce_order_id para el margen canónico", () => {
    const detail = buildSaleTicketDetail([
      {
        id: "sale-line-1",
        source: "tienda_online",
        ecommerce_order_id: "order-aaaa-bbbb",
        sale_transaction_id: "ticket-should-not-win",
        quantity: 1,
        total_ars: 1000,
        profit_ars: 400,
        paid: true,
      },
    ], "sale-line-1");

    expect(detail?.id).toBe("ticket-should-not-win");
    expect(detail?.marginOperationId).toBe("order-aaaa-bbbb");
    expect(detail?.ecommerceOrderId).toBe("order-aaaa-bbbb");
    expect(marginOperationIdForSale({
      id: "x",
      source: "tienda_online",
      ecommerce_order_id: null,
      sale_transaction_id: "tx-1",
    })).toBe("tx-1");
  });

  it("no inventa un registro cuando el deep link no pertenece a la lectura autorizada", () => {
    expect(buildSaleTicketDetail(lines, "otra-organizacion")).toBeNull();
    expect(buildSaleTicketDetail(lines, null)).toBeNull();
  });

  it("normaliza números inválidos sin contaminar el resumen", () => {
    const detail = buildSaleTicketDetail([
      { id: "bad-number", quantity: Number.NaN, total_ars: Number.POSITIVE_INFINITY, profit_ars: 10 },
    ], "bad-number");

    expect(detail).toMatchObject({ units: 0, totalArs: 0, costArs: 0, profitArs: 10, marginPercent: null });
  });

  it("declara una devolución legacy sin inventar cuántas unidades fueron devueltas", () => {
    const detail = buildSaleTicketDetail([
      { id: "legacy-return", quantity: 2, total_ars: 200, returned: true, returned_quantity: 0 },
    ], "legacy-return");

    expect(detail).toMatchObject({ hasReturn: true, returnedUnits: 0 });
  });
});

describe("contrato de navegación del inspector de Ventas", () => {
  const page = readFileSync(resolve(process.cwd(), "src/pages/SalesPage.tsx"), "utf8");

  it("conserva la lista, representa la selección en URL y es fullscreen en mobile", () => {
    expect(page).toContain('const selectedSaleId = searchParams.get("sale")');
    expect(page).toContain("buildSaleTicketDetail(sales, selectedSaleId)");
    expect(page).not.toContain("buildSaleTicketDetail(filtered, selectedSaleId)");
    expect(page).toContain('next.set("sale", saleId)');
    expect(page).toContain('next.delete("sale")');
    expect(page).toContain('data-testid="sale-ticket-inspector"');
    expect(page).toContain('className="flex w-full flex-col p-0 sm:max-w-2xl"');
    expect(page).toContain('aria-label={`Ver detalle de ${s.product_name || "la venta"}`}');
    expect(page).toContain("operationId={detail.marginOperationId}");
  });
});
