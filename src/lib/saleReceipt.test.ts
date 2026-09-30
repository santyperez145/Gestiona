import { describe, expect, it } from "vitest";
import { buildSaleReceiptHtml, escapePrintHtml } from "@/lib/saleReceipt";
import type { SaleTicketDetail } from "@/lib/saleTicketDetail";

const detail: SaleTicketDetail = {
  id: "tx-1",
  marginOperationId: "tx-1",
  ecommerceOrderId: null,
  code: "ABC12345",
  selected: { id: "line-1" },
  lines: [
    { id: "line-1", product_name: "Producto <script>alert(1)</script>", quantity: 2, total_ars: 1200 },
    { id: "line-2", product_name: "Segundo producto", quantity: 1, total_ars: 800 },
  ],
  isGrouped: true,
  units: 3,
  totalArs: 2000,
  costArs: 900,
  profitArs: 1100,
  marginPercent: 55,
  allPaid: true,
  partiallyPaid: false,
  invoicedLines: 0,
  hasReturn: false,
  returnedUnits: 0,
  customerName: "Cliente <b>real</b>",
  sellerNames: [],
  paymentMethods: ["efectivo"],
  sources: ["pos"],
  date: "2026-09-30T12:00:00.000Z",
};

describe("recibo comercial de una venta", () => {
  it("escapa contenido controlado por usuarios antes de abrir una ventana", () => {
    expect(escapePrintHtml('<img src=x onerror="alert(1)">')).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
  });

  it("imprime el ticket completo y lo distingue de una factura", () => {
    const html = buildSaleReceiptHtml(detail, "Mi <tienda>");
    expect(html).toContain("Producto &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Segundo producto");
    expect(html).toContain("Mi &lt;tienda&gt;");
    expect(html).toContain("RECIBO COMERCIAL NO FISCAL");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("api.qrserver.com");
  });
});
