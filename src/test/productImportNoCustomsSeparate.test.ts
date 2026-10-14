import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const importer = readFileSync(resolve(root, "src/components/products/ProductsExcelImport.tsx"), "utf8");
const productImportLib = readFileSync(resolve(root, "src/lib/productImport.ts"), "utf8");
const lectorDeFactura = readFileSync(resolve(root, "src/components/compras/LectorDeFactura.tsx"), "utf8");

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
    expect(productImportLib).toContain(": cost ?? 0;");
  });

  it("la factura del proveedor no suma aduana ni pasero: el costo es el que figura", () => {
    // 2026-10-14: la factura leída con IA precarga una compra (registrar_compra)
    // con el costo unitario de la factura; no hay porcentaje aparte.
    expect(lectorDeFactura).not.toMatch(/customs|pasero|aduana/i);
    expect(lectorDeFactura).toContain("costo: Number(it.unit_price) > 0 ? Number(it.unit_price) : 0");
  });
});
