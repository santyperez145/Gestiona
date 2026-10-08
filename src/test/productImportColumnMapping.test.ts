import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { mapProductWorkbook, readProductWorkbook } from "@/lib/productImportWorkbook";

function workbook(matrix: unknown[][], origin = "A1") {
  const book = XLSX.utils.book_new(); const sheet: XLSX.WorkSheet = {};
  XLSX.utils.sheet_add_aoa(sheet, matrix, { origin });
  const range = XLSX.utils.decode_range(sheet["!ref"]!); range.s = XLSX.utils.decode_cell(origin); sheet["!ref"] = XLSX.utils.encode_range(range);
  XLSX.utils.book_append_sheet(book, sheet, "Productos");
  return readProductWorkbook(XLSX.write(book, { type: "array", bookType: "xlsx" }));
}
const platformMatrix = (platform: "shopify" | "tiendanube") => platform === "shopify" ? [
  ["Handle", "Title", "Variant SKU", "Variant Price", "Option1 Name", "Option1 Value", "Variant Inventory Qty", "Cost per item", "Barcode", "Image Src", "Observaciones"],
  ["zz-camisa", "ZZ Camisa", "0001", 1000, "Talle", "S", 2, 500, "00001", "https://cdn.example.com/zz.jpg", "ZZ Nota"],
  ["zz-camisa", "", "0002", 1200, "", "M", 3, 600, "00002", "", "ZZ Otra nota"],
] : [
  ["Identificador de URL", "Nombre", "SKU", "Precio", "Nombre de propiedad 1", "Valor de propiedad 1", "Stock", "Costo", "Código de barras", "URL de imagen", "Observaciones"],
  ["zz-camisa", "ZZ Camisa", "0001", 1000, "Talle", "S", 2, 500, "00001", "https://cdn.example.com/zz.jpg", "ZZ Nota"],
  ["zz-camisa", "", "0002", 1200, "", "M", 3, 600, "00002", "", "ZZ Otra nota"],
];

describe("elección explícita de todas las columnas", () => {
  it("expone columnas desconocidas, letra física y tres muestras acotadas sin importarlas", () => {
    const book = workbook([["Nombre", "SKU", "Precio", "Notas"], ["ZZ Uno", "0001", 1, "a".repeat(500)], ["ZZ Dos", "0002", 0, "b"], ["ZZ Tres", "0003", 2, "c"], ["ZZ Cuatro", "0004", 3, "d"]], "B4");
    const result = mapProductWorkbook(book, "zz.xlsx");
    expect(result.columns[0]).toMatchObject({ letter: "B", suggestedTarget: "name", samples: ["ZZ Uno", "ZZ Dos", "ZZ Tres"] });
    expect(result.columns[3]).toMatchObject({ letter: "E", suggestedTarget: "", samples: ["a".repeat(120), "b", "c"] });
    expect(result.columnMapping["3"]).toBe(""); expect(result.parsed.products[0]).not.toHaveProperty("Notas");
    expect(JSON.parse(String(result.parsed.products[0].source_record)).values[3]).toHaveLength(500);
    expect(result.parsed.products[0].source_row).toBe(5);
  });
  it("ofrece todos los campos legacy adicionales y omitirlos impide su resurrección", () => {
    const book = workbook([["Nombre", "SKU", "Precio", "Precio Oferta", "Género", "Contenido ml", "Stock mínimo", "Marca"], ["ZZ Perfume mujer", "0001", 200, 180, "masculino", 50, 3, "ZZ Marca"]]);
    const automatic = mapProductWorkbook(book, "zz.xlsx");
    expect(automatic.mappingFields.map(field => field.id)).toEqual(expect.arrayContaining(["discount_price_ars", "gender", "content_ml", "low_stock_threshold"]));
    expect(automatic.parsed.products[0]).toMatchObject({ gender: "masculino", content_ml: 50, low_stock_threshold: 3, discount_price_ars: 180 });
    expect(automatic.parsed.products[0]).not.toHaveProperty("category");
    const selected = mapProductWorkbook(book, "zz.xlsx", { columnMapping: { "0": "name", "1": "sku", "2": "sale" } });
    for (const field of ["gender", "content_ml", "low_stock_threshold", "discount_price_ars", "brand"]) {
      expect(selected.parsed.products[0]).not.toHaveProperty(field); expect(selected.parsed.products[0].provided).not.toContain(field);
    }
    expect(selected.mappingIssues).toEqual([]);
  });
  it("permite corregir nombre, SKU, precio y campos adicionales hacia encabezados desconocidos", () => {
    const book = workbook([["Nombre", "SKU", "Precio", "Otro artículo", "Otro código", "Importe", "Umbral"], ["ZZ Erróneo", "BAD", 99, "ZZ Correcto", "0007", 250, 0]]);
    const result = mapProductWorkbook(book, "zz.xlsx", { columnMapping: { "3": "name", "4": "sku", "5": "sale", "6": "low_stock_threshold" } });
    expect(result.parsed.products[0]).toMatchObject({ name: "ZZ Correcto", sku: "0007", sale_price_ars: 250, low_stock_threshold: 0 });
    expect(result.mappingIssues).toEqual([]);
  });
  it("no elige entre aliases distintos ni convierte Descripción en nombre ante Nombre ambiguo", () => {
    const result = mapProductWorkbook(workbook([["Nombre", "Nombre", "Descripción", "SKU", "Código", "Costo ARS", "Costo USD"], ["ZZ Uno", "ZZ Dos", "Detalle", "A", "B", 10, 20]]), "zz.xlsx");
    expect(result.mapping).toMatchObject({ name: "", sku: "", cost: "", description: "2" });
    expect(result.mappingIssues.join(" ")).toMatch(/Nombre.*varias columnas.*Código.*varias columnas.*Costo.*varias columnas/);
    expect(result.parsed.products[0]).toMatchObject({ name: "", description: "Detalle" });
    expect(result.parsed.products[0]).not.toHaveProperty("sku"); expect(result.parsed.products[0]).not.toHaveProperty("cost_usd");
    const chosen = mapProductWorkbook(workbook([["Nombre", "SKU", "Código"], ["ZZ Uno", "A", "B"]]), "zz.xlsx", { columnMapping: { "0": "name", "1": "", "2": "sku" } });
    expect(chosen.mappingIssues).toEqual([]); expect(chosen.parsed.products[0].sku).toBe("B");
  });
  it("rechaza destinos, índices y asignaciones duplicadas sin importar valores ambiguos", () => {
    const result = mapProductWorkbook(workbook([["Nombre", "SKU", "Código", "Precio"], ["ZZ Uno", "A", "B", 100]]), "zz.xlsx", { columnMapping: { "0": "name", "1": "sku", "2": "sku", "3": "inventado", "9": "sale", "01": "stock" } });
    expect(result.mappingIssues.join(" ")).toMatch(/inválido.*no existe.*no existe.*más de una columna/);
    expect(result.parsed.products[0]).not.toHaveProperty("sku"); expect(result.parsed.products[0]).not.toHaveProperty("sale_price_ars");
  });
  it("un costo manual sin unidad requiere moneda y la confirmación no convierte importes", () => {
    const book = workbook([["Nombre", "Importe", "Costo ARS", "Precio"], ["ZZ Uno", 25, 100, 200]]);
    const options = { columnMapping: { "0": "name", "1": "cost", "3": "sale" } };
    expect(mapProductWorkbook(book, "zz.xlsx", options).costCurrencyAmbiguous).toBe(true);
    expect(mapProductWorkbook(book, "zz.xlsx", { ...options, costCurrency: "ARS" }).parsed.products[0]).toMatchObject({ cost_ars: 25 });
    const usd = mapProductWorkbook(book, "zz.xlsx", { ...options, costCurrency: "USD" });
    expect(usd.parsed.products[0]).toMatchObject({ cost_usd: 25 }); expect(usd.parsed.products[0]).not.toHaveProperty("cost_ars");
    expect(mapProductWorkbook(book, "zz.xlsx", { columnMapping: { "0": "name", "3": "sale" } }).costCurrencyAmbiguous).toBe(false);
  });
  it("conserva exactamente la semántica legacy cuando una sesión previa trae mapping", () => {
    const book = workbook([["Nombre", "SKU", "Precio", "Género", "Contenido ml", "Stock mínimo", "Precio Oferta"], ["ZZ Perfume mujer", "0001", 200, "masculino", 50, 3, 180]]);
    const initial = mapProductWorkbook(book, "zz.xlsx");
    const legacy = mapProductWorkbook(book, "zz.xlsx", { mapping: initial.mapping });
    expect(legacy.mappingIssues).toEqual([]);
    expect(legacy.parsed.products[0]).toMatchObject({ gender: "femenino", content_ml: 50, low_stock_threshold: 3, discount_price_ars: 180 });
    expect(legacy.parsed.products[0].provided).toEqual(expect.arrayContaining(["gender", "content_ml", "low_stock_threshold", "discount_price_ars"]));
  });
  it.each(["shopify", "tiendanube"] as const)("%s permite reasignar y omitir campos sin dividir variantes ni revivir valores", platform => {
    const book = workbook(platformMatrix(platform)); const detected = mapProductWorkbook(book, "zz.xlsx");
    expect(detected.mappingIssues).toEqual([]); expect(detected.mappingFields.find(field => field.id === "handle")?.required).toBe(true);
    const choices = { ...detected.columnMapping, "2": "", "6": "", "7": "", "8": "", "9": "", "10": "description" };
    const result = mapProductWorkbook(book, "zz.xlsx", { columnMapping: choices });
    expect(result.mappingIssues).toEqual([]); expect(result.parsed.products).toHaveLength(1); expect(result.parsed.variantCount).toBe(2);
    expect(result.parsed.products[0]).toMatchObject({ external_key: "zz-camisa", description: "ZZ Nota", variants: [expect.objectContaining({ name: "S" }), expect.objectContaining({ name: "M" })] });
    for (const field of ["sku", "barcode", "stock", "cost_usd", "cost_ars", "image_urls", "maneja_stock", "published", "is_active"]) {
      expect(result.parsed.products[0]).not.toHaveProperty(field); expect(result.parsed.products[0].provided).not.toContain(field);
    }
    for (const variant of result.parsed.products[0].variants!) for (const field of ["sku", "barcode", "stock", "image_url"]) {
      expect(variant).not.toHaveProperty(field); expect(variant.provided).not.toContain(field);
    }
    expect(JSON.parse(String(result.parsed.products[0].source_record))).toMatchObject({ scope: "first_row", source_row_count: 2, values: expect.arrayContaining(["ZZ Nota"]) });
    expect(result.parsed.redirectCount).toBe(1);
  });
  it.each(["shopify", "tiendanube"] as const)("%s bloquea pérdida de identidad o estructura, incluso remap hacia valores vacíos", platform => {
    const matrix = platformMatrix(platform); matrix[0].push("Vacía", "Nombre parcial"); matrix[1].push("", "S"); matrix[2].push("", "");
    const book = workbook(matrix); const detected = mapProductWorkbook(book, "zz.xlsx");
    for (const altered of [{ "0": "" }, { "4": "" }, { "5": "" }, { "5": "", "11": "option1_value" }, { "5": "", "12": "option1_value" }, { "4": "", "11": "option1_name" }]) {
      const result = mapProductWorkbook(book, "zz.xlsx", { columnMapping: { ...detected.columnMapping, ...altered } });
      expect(result.mappingIssues.length).toBeGreaterThan(0); expect(result.parsed.products).toEqual([]);
    }
  });
  it("un par de opciones elegido manualmente desde encabezados desconocidos también es estructural", () => {
    const book = workbook([["Handle", "Title", "Color nuevo"], ["zz", "ZZ Uno", "Azul"]]);
    const result = mapProductWorkbook(book, "zz.xlsx", { columnMapping: { "0": "handle", "1": "name", "2": "option1_value" } });
    expect(result.mappingFields.find(field => field.id === "option1_name")?.required).toBe(true);
    expect(result.mappingIssues.join(" ")).toMatch(/Propiedad 1: nombre/); expect(result.parsed.products).toEqual([]);
  });
  it.each(["shopify", "tiendanube"] as const)("%s no escribe booleanos derivados de celdas vacías", platform => {
    const matrix = platform === "shopify" ? [["Handle", "Title", "Variant Price", "Variant Inventory Qty", "Published", "Status"], ["zz", "ZZ Uno", 100, "", "", ""]] : [["Identificador de URL", "Nombre", "Precio", "Stock", "Mostrar en tienda"], ["zz", "ZZ Uno", 100, "", ""]];
    const result = mapProductWorkbook(workbook(matrix), "zz.xlsx");
    for (const field of ["published", "is_active", "maneja_stock"]) {
      expect(result.parsed.products[0]).not.toHaveProperty(field); expect(result.parsed.products[0].provided).not.toContain(field);
    }
    const legacy = mapProductWorkbook(workbook(matrix), "zz.xlsx", { legacyPlatform: true });
    expect(legacy.mappingIssues).toEqual([]); expect(legacy.parsed.products[0]).toMatchObject({ published: true, is_active: true, maneja_stock: false });
  });
  it.each(["shopify", "tiendanube"] as const)("%s usa publicación real de otra fila del grupo y bloquea contradicciones", platform => {
    const matrix = platformMatrix(platform);
    matrix[0].push(platform === "shopify" ? "Published" : "Mostrar en tienda"); matrix[1].push(""); matrix[2].push("false");
    const result = mapProductWorkbook(workbook(matrix), "zz.xlsx");
    expect(result.parsed.products[0]).toMatchObject({ published: false }); expect(result.mappingIssues).toEqual([]);
    matrix[1][11] = "true";
    const conflicting = mapProductWorkbook(workbook(matrix), "zz.xlsx");
    expect(conflicting.mappingIssues.join(" ")).toMatch(/contradictorios/); expect(conflicting.parsed.products[0]).not.toHaveProperty("published");
  });
  it("preserva formato numérico de identidad, SKU y barcode de plataforma fuera de A1", () => {
    const book = XLSX.utils.book_new(); const sheet: XLSX.WorkSheet = {};
    XLSX.utils.sheet_add_aoa(sheet, [["Handle", "Title", "Variant SKU", "Variant Price", "Barcode"], [12, "ZZ Uno", 7, 100, 42]], { origin: "B4" });
    sheet.B5.z = "000000"; sheet.D5.z = "0000"; sheet.F5.z = "00000000";
    sheet["!ref"] = "B4:F5";
    XLSX.utils.book_append_sheet(book, sheet, "Productos");
    const result = mapProductWorkbook(readProductWorkbook(XLSX.write(book, { type: "array", bookType: "xlsx" })), "zz.xlsx");
    expect(result.parsed.products[0]).toMatchObject({ external_key: "000012", sku: "0007", barcode: "00000042", source_path: "/products/000012", source_row: 5 });
    expect(result.columns[0]).toMatchObject({ letter: "B", samples: ["000012"] });
  });
  it("conserva cien variantes sin inflar el registro acotado de origen del producto", () => {
    const matrix: unknown[][] = [["Handle", "Title", "Variant SKU", "Variant Price", "Option1 Name", "Option1 Value", "Observaciones"]];
    for (let index = 0; index < 100; index++) matrix.push(["zz", index ? "" : "ZZ Cien", `ZZ-${index}`, 100, index ? "" : "Talle", String(index), "z".repeat(500)]);
    const result = mapProductWorkbook(workbook(matrix), "zz.xlsx");
    expect(result.mappingIssues).toEqual([]); expect(result.parsed.products[0].variants).toHaveLength(100);
    expect(new TextEncoder().encode(String(result.parsed.products[0].source_record)).byteLength).toBeLessThan(16_384);
    expect(JSON.parse(String(result.parsed.products[0].source_record))).toMatchObject({ source_row_count: 100, scope: "first_row" });
  });
});
