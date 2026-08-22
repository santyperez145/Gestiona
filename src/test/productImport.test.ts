import { describe, expect, it } from "vitest";
import {
  buildProductImportRow,
  parseImportNumber,
  previewProductImportRow,
  productImportFormat,
} from "@/lib/productImport";

describe("parseImportNumber", () => {
  it.each([
    [25.5, 25.5],
    ["25.50", 25.5],
    ["25,50", 25.5],
    ["$ 35.000", 35_000],
    ["1.234,56", 1234.56],
    ["1,234.56", 1234.56],
    ["1.234.567", 1_234_567],
    ["0.500", 0.5],
  ])("interpreta %j como %s", (input, expected) => {
    expect(parseImportNumber(input)).toBe(expected);
  });

  it.each([null, undefined, "", "abc", "12-3", Number.NaN])("rechaza %j", input => {
    expect(parseImportNumber(input)).toBeNull();
  });
});

describe("buildProductImportRow", () => {
  it("acepta encabezados en español, conserva el decimal y deriva categoría", () => {
    const row = buildProductImportRow({
      Nombre: "Perfume Floral 100ml",
      Marca: "Ejemplo",
      "Costo USD": "25.50",
      "Precio Venta ARS": "$ 65.000",
      Stock: "10",
    });

    expect(row).toMatchObject({
      name: "Perfume Floral 100ml",
      brand: "Ejemplo",
      cost_usd: 25.5,
      sale_price_ars: 65_000,
      stock: 10,
      category: "perfume_diseñador",
      gender: "unisex",
    });
  });

  it("no confunde código de barras con SKU", () => {
    const row = buildProductImportRow({ Nombre: "Producto", "Código de barras": "7791234567890" });
    expect(row.barcode).toBe("7791234567890");
    expect(row.sku).toBeUndefined();
  });

  it("una celda vacía no entra en provided ni borra un dato existente", () => {
    const row = buildProductImportRow({ Nombre: "Producto", Marca: "", Stock: "" });
    expect(row.provided).toEqual(["name"]);
    expect(row.brand).toBeUndefined();
    expect(row.stock).toBeUndefined();
  });

  it("preserva un número inválido para que el servidor lo rechace", () => {
    const row = buildProductImportRow({ Nombre: "Producto", Stock: "diez", Precio: 1000 });
    expect(row.stock).toBe("diez");
    expect(row.provided).toContain("stock");
  });

  it("detecta género desde el nombre aunque no exista esa columna", () => {
    expect(buildProductImportRow({ Producto: "Fragancia femenina" }).gender).toBe("femenino");
  });
});

describe("previewProductImportRow", () => {
  const params = {
    exchangeRate: 1_500,
    customsPercent: 10,
    defaultMarginPercent: 50,
    autoFillSalePrice: true,
  };

  it("sugiere el precio y calcula margen con los mismos parámetros del RPC", () => {
    const row = buildProductImportRow({ Nombre: "Producto", Costo: 10, Stock: 3 });
    const preview = previewProductImportRow(row, params);
    expect(preview.totalCostUSD).toBeCloseTo(11);
    expect(preview.salePriceARS).toBe(24_750);
    expect(preview.profitARS).toBe(8_250);
    expect(preview.marginPercent).toBeCloseTo(33.33, 1);
  });

  it("señala stock fraccionario y costo ausente antes de enviar", () => {
    const row = buildProductImportRow({ Nombre: "Producto", Precio: 1000, Stock: "2,5" });
    expect(previewProductImportRow(row, params).localIssues).toEqual([
      "Stock inválido",
      "Margen incompleto: falta costo",
    ]);
  });
});

describe("productImportFormat", () => {
  it.each(["catalogo.xlsx", "CATALOGO.XLS", "productos.csv"])("admite %s", filename => {
    expect(productImportFormat(filename)).not.toBeNull();
  });

  it("rechaza formatos sin soporte", () => {
    expect(productImportFormat("catalogo.pdf")).toBeNull();
  });
});
