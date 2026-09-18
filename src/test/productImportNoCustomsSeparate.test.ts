import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const importer = readFileSync(resolve(root, "src/components/products/ProductsExcelImport.tsx"), "utf8");
const productImportLib = readFileSync(resolve(root, "src/lib/productImport.ts"), "utf8");
const invoiceDialog = readFileSync(resolve(root, "src/components/products/InvoiceImportDialog.tsx"), "utf8");

describe("C28.1: el 15% de aduana/pasero/impuestos ya no es un cálculo aparte", () => {
  it("el importador Excel no tiene un input configurable de aduana/pasero", () => {
    expect(importer).not.toMatch(/Aduana \/ pasero/i);
    expect(importer).not.toMatch(/customsPercent/i);
    expect(importer).not.toMatch(/setCustomsPercent/i);
  });

  it("el importador Excel no envía p_customs_percent al RPC", () => {
    expect(importer).not.toMatch(/p_customs_percent/i);
  });

  it("el preview del importador no multiplica el costo por 1.15", () => {
    expect(productImportLib).not.toMatch(/params\.customsPercent/i);
    expect(productImportLib).not.toMatch(/customsPercent/i);
    // totalCostUSD debe ser igual al costo cargado, sin aduana aparte
    expect(productImportLib).toContain("const totalCostUSD = cost ?? 0;");
  });

  it("el importador de facturas IA no calcula customsFee como porcentaje aparte del costo", () => {
    // El customsPct ya es constante (15), no se saca de settings
    expect(invoiceDialog).toContain("const customsPct = 15;");
    expect(invoiceDialog).not.toMatch(/settings\?\.customs_percent/i);
  });

  it("el importador de facturas IA guarda cost_usd como el costo total (ya incluye aduana)", () => {
    // totalCostUSD ya incluye el 15% porque costUSD es el costo total (no se suma aparte)
    expect(invoiceDialog).toContain("const totalCostUSD = costUSD;");  // Eliminado el cálculo de customsFee
    expect(invoiceDialog).toContain("cost_usd: parseFloat(costUSD.toFixed(4))");
    expect(invoiceDialog).toContain("total_cost_usd: parseFloat(totalCostUSD.toFixed(4))");
  });
});