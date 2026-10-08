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
  it("detecta catálogo tras portada vacía/instrucciones y encabezado precedido por un resumen", () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), "Portada");
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Instrucciones", "Leer antes de importar"]]), "Ayuda");
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Stock", "Precio"], [100, 200], [], ["Código de artículo", "Nombre del producto", "Costo en pesos", "Precio de venta"], ["0007", "ZZ Martillo", 1000, 2000]]), "Catálogo");
    const result = mapProductWorkbook(readProductWorkbook(XLSX.write(book, { type: "array", bookType: "xlsx" })), "zz-erp.xlsx");
    expect(result.sheetName).toBe("Catálogo"); expect(result.headerRow).toBe(4);
    expect(result.costCurrency).toBe("ARS"); expect(result.costCurrencyAmbiguous).toBe(false);
    expect(result.parsed.products).toHaveLength(1);
    expect(result.parsed.products[0]).toMatchObject({ sku: "0007", name: "ZZ Martillo", source_row: 5, cost_ars: 1000, sale_price_ars: 2000 });
  });
  it("no elige silenciosamente un costo/identificador repetido y conserva ambas columnas", () => {
    const book = workbook([["Nombre", "CÓDIGO", "Codigo", "Costo", "COSTO", "Precio"], ["ZZ Ambiguo", "0001", "0002", 10, 20, 30]]);
    const result = mapProductWorkbook(book, "zz.xlsx");
    expect(result.mapping).toMatchObject({ sku: "", cost: "", name: "0", sale: "5" });
    expect(result.columns[1].label).toBe("CÓDIGO · columna B");
    expect(result.columns[2].label).toBe("Codigo · columna C");
    expect(result.detectionWarnings.join(" ")).toMatch(/Código.*varias columnas.*Costo.*varias columnas/);
    expect(result.parsed.products[0]).not.toHaveProperty("sku");
    expect(result.parsed.products[0]).not.toHaveProperty("cost_usd");
    const chosen = mapProductWorkbook(book, "zz.xlsx", { mapping: { ...result.mapping, sku: "2", cost: "4" }, costCurrency: "ARS", headerRow: result.headerRow });
    expect(chosen.parsed.products[0]).toMatchObject({ sku: "0002", cost_ars: 20 });
    expect(chosen.detectionWarnings).toEqual([]);
  });
  it("una plantilla de plataforma sin productos no desplaza la hoja poblada", () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Handle", "Title", "Variant SKU"]]), "Plantilla vacía");
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Nombre", "SKU", "Precio"], ["ZZ Real", "0001", 100]]), "Catálogo");
    const result = mapProductWorkbook(readProductWorkbook(XLSX.write(book, { type: "array", bookType: "xlsx" })), "zz.xlsx");
    expect(result.sheetName).toBe("Catálogo"); expect(result.parsed.products[0].name).toBe("ZZ Real");
  });
  it("exige confirmar moneda del costo sin unidad y permite corregir la fila explícitamente", () => {
    const book = workbook([["Nombre", "SKU", "Costo"], ["ZZ Uno", "0001", 10], ["Nombre", "SKU", "Costo", "Precio"], ["ZZ Dos", "0002", 20, 30]]);
    const suggested = mapProductWorkbook(book, "zz.xlsx");
    expect(suggested.headerRow).toBe(3); expect(suggested.costCurrencyAmbiguous).toBe(true);
    const corrected = mapProductWorkbook(book, "zz.xlsx", { headerRow: 1, costCurrency: "ARS" });
    expect(corrected.headerRow).toBe(1); expect(corrected.costCurrencyAmbiguous).toBe(false);
    expect(corrected.parsed.products[0]).toMatchObject({ cost_ars: 10, source_row: 2 });
    expect(() => mapProductWorkbook(book, "zz.xlsx", { headerRow: 2.5 })).toThrow("encabezados válida");
    expect(() => mapProductWorkbook(book, "zz.xlsx", { headerRow: 21 })).toThrow("encabezados válida");
  });
  it("no recupera costos ARS por el parser legacy cuando el mapeo los excluyó", () => {
    const book = workbook([["Nombre", "SKU", "Costo ARS", "COSTO ARS", "Precio"], ["ZZ Seguro", "0001", 100, 200, 300]]);
    const result = mapProductWorkbook(book, "zz.xlsx");
    expect(result.mapping.cost).toBe("");
    expect(result.parsed.products[0]).not.toHaveProperty("cost_ars");
    expect(result.parsed.products[0]).not.toHaveProperty("cost_usd");
    const selected = mapProductWorkbook(book, "zz.xlsx", { mapping: { ...result.mapping, cost: "3" }, costCurrency: "USD" });
    expect(selected.parsed.products[0]).toMatchObject({ cost_usd: 200 });
    expect(selected.parsed.products[0]).not.toHaveProperty("cost_ars");
    expect(selected.parsed.products[0].provided).not.toContain("cost_ars");
  });
  it("avisa de hojas empatadas y permite cambiar sin reutilizar un mapeo de otra hoja", () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Nombre", "SKU", "Costo ARS"], ["ZZ ARS", "0001", 10]]), "Pesos");
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["SKU", "Costo USD", "Nombre"], ["0002", 20, "ZZ USD"]]), "Dólares");
    const loaded = readProductWorkbook(XLSX.write(book, { type: "array", bookType: "xlsx" }));
    expect(mapProductWorkbook(loaded, "zz.xlsx").detectionWarnings.join(" ")).toContain("varias hojas");
    const next = mapProductWorkbook(loaded, "zz.xlsx", { sheetName: "Dólares" });
    expect(next.costCurrency).toBe("USD"); expect(next.mapping.name).toBe("2");
    expect(next.parsed.products[0]).toMatchObject({ name: "ZZ USD", cost_usd: 20, sku: "0002" });
  });
  it.each(["shopify", "tiendanube"])("detecta hoja %s con preámbulo y conserva identidad/variantes", platform => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Guía", "No importar"]]), "Ayuda");
    const matrix = platform === "shopify"
      ? [["Reporte", "2026"], ["Handle", "Title", "Variant SKU", "Variant Price", "Option1 Name", "Option1 Value"], ["zz-camisa", "ZZ Camisa", "ZZ-S", 1000, "Talle", "S"], ["zz-camisa", "", "ZZ-M", 1200, "Talle", "M"]]
      : [["Reporte", "2026"], ["Identificador de URL", "Nombre", "SKU", "Precio", "Nombre de propiedad 1", "Valor de propiedad 1"], ["zz-camisa", "ZZ Camisa", "ZZ-S", 1000, "Talle", "S"], ["zz-camisa", "", "ZZ-M", 1200, "Talle", "M"]];
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(matrix), "Productos");
    const result = mapProductWorkbook(readProductWorkbook(XLSX.write(book, { type: "array", bookType: "xlsx" })), "zz.xlsx");
    expect(result.profile).toBe("platform"); expect(result.parsed.source).toBe(platform);
    expect(result.headerRow).toBe(2); expect(result.parsed.products).toHaveLength(1);
    expect(result.parsed.products[0].variants).toHaveLength(2);
  });
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
  it.each(["shopify", "tiendanube"])("no supone USD para costos %s y conserva variantes al confirmar ARS", platform => {
    const matrix = platform === "shopify"
      ? [["Handle", "Title", "Variant SKU", "Variant Price", "Option1 Name", "Option1 Value", "Cost per item"], ["zz-camisa", "ZZ Camisa", "ZZ-S", 1000, "Talle", "S", 500], ["zz-camisa", "", "ZZ-M", 1200, "Talle", "M", 600]]
      : [["Identificador de URL", "Nombre", "SKU", "Precio", "Nombre de propiedad 1", "Valor de propiedad 1", "Costo"], ["zz-camisa", "ZZ Camisa", "ZZ-S", 1000, "Talle", "S", 500], ["zz-camisa", "", "ZZ-M", 1200, "Talle", "M", 600]];
    const book = workbook(matrix);
    const detected = mapProductWorkbook(book, "zz-platform.xlsx");
    expect(detected.costCurrencyAmbiguous).toBe(true);
    const pesos = mapProductWorkbook(book, "zz-platform.xlsx", { costCurrency: "ARS" });
    const dollars = mapProductWorkbook(book, "zz-platform.xlsx", { costCurrency: "USD" });
    expect(pesos.costCurrencyAmbiguous).toBe(false);
    expect(pesos.parsed.products[0]).toMatchObject({ cost_ars: 500, sale_price_ars: 1000 });
    expect(pesos.parsed.products[0]).not.toHaveProperty("cost_usd");
    expect(pesos.parsed.products[0].provided).toContain("cost_ars");
    expect(pesos.parsed.products[0].provided).not.toContain("cost_usd");
    expect(pesos.parsed.products[0].variants).toEqual(dollars.parsed.products[0].variants);
    expect(dollars.parsed.products[0]).toMatchObject({ cost_usd: 500 });
    expect(dollars.parsed.products[0]).not.toHaveProperty("cost_ars");
    expect(mapProductWorkbook(workbook(matrix.map(row => row.slice(0, -1))), "zz.xlsx").costCurrencyAmbiguous).toBe(false);
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
  it("conserva ceros y columnas físicas cuando la hoja empieza fuera de A1", () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([]);
    XLSX.utils.sheet_add_aoa(sheet, [["Nombre", "SKU", "Costo ARS", "Precio", "Proveedor", "Proveedor"], ["ZZ Desplazado", 12, 100, 200, "ZZ Artículo", "ZZ Empresa"]], { origin: "B4" });
    sheet.C5.z = "000000";
    XLSX.utils.book_append_sheet(book, sheet, "Productos");
    const result = mapProductWorkbook(readProductWorkbook(XLSX.write(book, { type: "array", bookType: "xlsx" })), "zz-offset.xlsx");
    expect(result.parsed.products[0]).toMatchObject({ sku: "000012", cost_ars: 100, source_row: 5 });
    expect(result.columns.slice(-2).map(column => column.label)).toEqual(["Proveedor · columna F", "Proveedor · columna G"]);
  });
  it("rechaza una lectura recortada aunque la hoja declare pocas filas de producto", () => {
    const book = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([]);
    XLSX.utils.sheet_add_aoa(sheet, [["Nombre", "SKU", "Costo ARS", "Precio"], ["ZZ Primera", "000001", 100, 200], ["ZZ Última", "000002", 100, 200]], { origin: "A50021" });
    XLSX.utils.book_append_sheet(book, sheet, "Productos");
    const loaded = readProductWorkbook(XLSX.write(book, { type: "array", bookType: "xlsx" }));
    expect(() => mapProductWorkbook(loaded, "zz-truncated.xlsx")).toThrow("vista truncada");
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
