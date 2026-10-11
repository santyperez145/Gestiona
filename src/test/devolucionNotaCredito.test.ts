import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("de la devolución a su nota de crédito", () => {
  const devoluciones = readFileSync(resolve(process.cwd(), "src/pages/DevolucionesPage.tsx"), "utf8");
  const facturas = readFileSync(resolve(process.cwd(), "src/pages/InvoicesPage.tsx"), "utf8");

  it("Devoluciones busca la factura de la venta y abre su nota de crédito", () => {
    expect(devoluciones).toContain("navigate(invoiceId ? `/facturas?invoice=${encodeURIComponent(invoiceId)}&nc=1` : \"/facturas\");");
    expect(devoluciones).not.toContain('onClick={() => navigate("/facturas")}><ReceiptText');
  });

  it("Facturas abre el diálogo una vez, sólo con CAE, y emitir sigue siendo del comercio", () => {
    expect(facturas).toContain('if (ncParam !== "1" || !requestedInvoiceId || !canManage) return;');
    expect(facturas).toContain('next.delete("nc");');
    expect(facturas).toContain('abrirNotaDeCredito(inv, "Devolución");');
    expect(facturas).toContain("onClick={() => abrirNotaDeCredito(inv)}");
  });
});
