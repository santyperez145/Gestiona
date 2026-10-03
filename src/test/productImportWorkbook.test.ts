import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { mapProductWorkbook, readProductWorkbook } from "@/lib/productImportWorkbook";
import { previewProductImportRow, PRODUCT_IMPORT_MAX_BYTES } from "@/lib/productImport";

const headers = ["CODIGO", "DESCRIPCION", "STOCK", "VENTA", "COSTO", "CODIGO BARRA 1", "CODIGO BARRA 2", "CODIGO BARRA 3", "CODIGO PROVEEDOR", "FECHA ULT ACT", "CODIGO MARCA", "MARCA", "CLASIFICACION", "RUBRO", "CODIGO PROVEEDOR", "PROVEEDOR", "PRECIO DE LISTA"];
function workbook(matrix: unknown[][], format: "xlsx" | "biff8" = "xlsx") {
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(matrix), "Productos");
  return readProductWorkbook(XLSX.write(book, { type: "array", bookType: format }));
}
const sample = ["000001", "ZZ Tornillo sintético", -3, 160, 100, "001234", "009876", "008765", "ZZ-SKU-PROV", 45678, "ZZ-MARCA", "***SIN DATOS***", "ZZ Clase", "Ferretería", "ZZ-ENTIDAD-PROV", "ZZ Proveedor sintético", 200];

describe("Excel legacy y mapeo de productos", () => {
  it.each(["xlsx", "biff8"] as const)("lee %s, conserva códigos y no confunde lista con descuento condicionado", format => {
    const parsed = mapProductWorkbook(workbook([headers, sample], format), "zz-ferreteria.xls");
    expect(parsed.profile).toBe("hardware"); expect(parsed.costCurrency).toBe("ARS");
    const product = parsed.parsed.products[0];
    expect(product).toMatchObject({ name: "ZZ Tornillo sintético", sku: "000001", barcode: "001234", barcode_aliases: ["009876", "008765"], cost_ars: 100, sale_price_ars: 200, stock: -3, category: "Ferretería", tags: ["ZZ Clase"], source_row: 2 });
    expect(product).not.toHaveProperty("cost_usd"); expect(product).not.toHaveProperty("discount_price_ars"); expect(product.provided).not.toContain("brand");
    const source = JSON.parse(String(product.source_record));
    expect(source.headers.filter((h: string) => h === "CODIGO PROVEEDOR")).toHaveLength(2);
    expect(source.values[8]).toBe("ZZ-SKU-PROV"); expect(source.values[14]).toBe("ZZ-ENTIDAD-PROV"); expect(source.values[3]).toBe(160);
    expect(parsed.columns[8].label).toContain("columna I"); expect(parsed.columns[14].label).toContain("columna O");
    expect(parsed.negativeStock).toBe(1);
    expect(previewProductImportRow(product, { exchangeRate: 0, defaultMarginPercent: 0, autoFillSalePrice: false })).toMatchObject({ salePriceARS: 200, profitARS: 100 });
  });
  it("conserva formato numérico con ceros y posición real de la fila", () => {
    const book = XLSX.utils.book_new(); const sheet = XLSX.utils.aoa_to_sheet([[], [], ["Nombre", "SKU", "Precio", "Costo ARS"], ["ZZ Ejemplo", 12, 200, 100]]);
    sheet.B4.z = "000000"; XLSX.utils.book_append_sheet(book, sheet, "Productos");
    const result = mapProductWorkbook(readProductWorkbook(XLSX.write(book, { type: "array", bookType: "xlsx" })), "zz.xlsx");
    expect(result.parsed.products[0]).toMatchObject({ sku: "000012", source_row: 4, cost_ars: 100 });
  });
  it("permite elegir USD y cambiar la columna de precio explícitamente", () => {
    const book = workbook([headers, sample]); const initial = mapProductWorkbook(book, "zz.xls");
    const mapped = mapProductWorkbook(book, "zz.xls", { mapping: { ...initial.mapping, sale: "3" }, costCurrency: "USD" });
    expect(mapped.parsed.products[0]).toMatchObject({ cost_usd: 100, sale_price_ars: 160 });
    expect(mapped.parsed.products[0]).not.toHaveProperty("cost_ars");
  });
  it("retiene stock fraccionario, códigos duplicados y valores cero para revisión", () => {
    const result = mapProductWorkbook(workbook([headers, sample, ["000001", "ZZ Otro", 1.5, 0, 0, "", "", "", "", "", "", "", "", "", "", "", 0]]), "zz.xls");
    expect(result.fractionalStock).toBe(1); expect(result.duplicateCodes).toBe(1);
    expect(result.parsed.products[1]).toMatchObject({ cost_ars: 0, stock: 1.5, sale_price_ars: 0 });
  });
  it("conserva descripción, oferta, género y contenido de la plantilla nativa", () => {
    const result = mapProductWorkbook(workbook([["Nombre", "Descripción", "Costo USD", "Precio Venta ARS", "Precio Oferta", "Contenido ml", "Género"], ["ZZ Native", "Detalle nativo", 10, 20000, 18000, 100, "femenino"]]), "zz.xlsx");
    expect(result.parsed.products[0]).toMatchObject({ description: "Detalle nativo", discount_price_ars: 18000, cost_usd: 10, content_ml: 100, gender: "femenino" });
  });
  it("no pierde agrupación de variantes de Shopify", () => {
    const result = mapProductWorkbook(workbook([["Handle", "Title", "Variant SKU", "Variant Price", "Option1 Name", "Option1 Value"], ["zz-camisa", "ZZ Camisa", "ZZ-S", 1000, "Talle", "S"], ["zz-camisa", "", "ZZ-M", 1200, "Talle", "M"]]), "shopify.csv");
    expect(result.profile).toBe("platform"); expect(result.parsed.products).toHaveLength(1); expect(result.parsed.products[0].variants).toHaveLength(2);
    expect(() => mapProductWorkbook(workbook([headers, sample]), "zz.xls", { sheetName: "No existe" })).toThrow("vacía");
  });
  it("recorre 50.000 filas sintéticas sin truncar y rechaza 50.001", () => {
    const matrix: unknown[][] = [["Nombre", "SKU", "Costo ARS", "Precio"]];
    for (let i = 0; i < 50_000; i++) matrix.push(["ZZ Sintético", String(i).padStart(6, "0"), 100, 200]);
    const parsed = mapProductWorkbook(workbook(matrix), "zz-large.xlsx");
    expect(parsed.parsed.products).toHaveLength(50_000); expect(parsed.parsed.products[49_999].sku).toBe("049999");
    matrix.push(["ZZ Exceso", "050000", 100, 200]);
    expect(() => mapProductWorkbook(workbook(matrix), "zz-too-large.xlsx")).toThrow("50.000");
  }, 30_000);
  it("limita archivos vacíos o demasiado pesados antes de parsearlos", () => {
    expect(() => readProductWorkbook(new ArrayBuffer(0))).toThrow("50 MB");
    expect(() => readProductWorkbook(new ArrayBuffer(PRODUCT_IMPORT_MAX_BYTES + 1))).toThrow("50 MB");
  });
});
