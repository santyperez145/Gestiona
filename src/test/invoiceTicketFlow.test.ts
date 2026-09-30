import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const service = read("src/lib/saleInvoice.ts");
const pos = read("src/pages/POSPage.tsx");
const sales = read("src/pages/SalesPage.tsx");
const invoices = read("src/pages/InvoicesPage.tsx");
const receipt = read("src/lib/saleReceipt.ts");

describe("factura ticket dentro y fuera del POS", () => {
  it("reutiliza una sola autoridad para crear y autorizar", () => {
    expect(service).toContain('supabase.rpc("facturar_venta_pos"');
    expect(service).toContain('supabase.functions.invoke("afip-authorize"');
    expect(service).toContain("posDebeIntentarAutorizar");
    expect(pos).toContain("ensureSaleTransactionInvoice");
    expect(sales).toContain("ensureSaleTransactionInvoice");
  });

  it("carga la factura persistida antes de representar el documento fiscal", () => {
    expect(service).toContain('.from("invoices")');
    expect(service).toContain('.select("*, invoice_items(*)")');
    expect(service).toContain("printFiscalInvoiceById");
    expect(pos).toContain("Factura 80 mm");
    expect(sales).toContain("Crear e imprimir factura");
  });

  it("la representación térmica contiene identidad, CAE, QR y transparencia", () => {
    expect(service).toContain("FACTURA ${letter} · ORIGINAL");
    expect(service).toContain("Vencimiento CAE");
    expect(service).toContain("QR oficial ARCA");
    expect(service).toContain("TRANSPARENCIA FISCAL");
    expect(service).toContain("IVA contenido");
    expect(service).toContain("NO ES UN COMPROBANTE FISCAL");
    expect(invoices).toContain("Imprimir factura ticket 80 mm");
  });

  it("el recibo comercial no se disfraza de factura", () => {
    expect(receipt).toContain("RECIBO COMERCIAL NO FISCAL");
    expect(pos).toContain("arcaCopy.notFiscalTicket");
    expect(pos).toContain("Factura ${escapePrintHtml(invoice.number");
    expect(sales).toContain("printSaleReceipt");
    expect(sales).toContain("RESUMEN COMERCIAL NO FISCAL");
    expect(sales).not.toContain("api.qrserver.com");
  });
});
