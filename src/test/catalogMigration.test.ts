import { describe, expect, it } from "vitest";
import {
  detectCatalogMigrationSource,
  parseCatalogMigrationRows,
} from "@/lib/catalogMigration";

describe("migración de catálogo Shopify", () => {
  it("reconoce el contrato oficial actual y agrupa variantes e imágenes por URL handle", () => {
    const result = parseCatalogMigrationRows([
      {
        "URL handle": "remera-lino",
        Title: "Remera de lino",
        Description: "<p>Liviana &amp; fresca</p>",
        Vendor: "Norte",
        Type: "Remeras",
        Tags: "verano, lino",
        "Published on online store": "true",
        Status: "active",
        "Option1 name": "Talle",
        "Option1 value": "S",
        SKU: "REM-S",
        Barcode: "779000000001",
        Price: "25000",
        "Compare-at price": "30000",
        "Inventory quantity": "4",
        "Product image URL": "https://cdn.example.com/remera-1.jpg",
      },
      {
        "URL handle": "remera-lino",
        "Option1 value": "M",
        SKU: "REM-M",
        Price: "26000",
        "Inventory quantity": "6",
        "Product image URL": "https://cdn.example.com/remera-2.jpg",
        "Variant image URL": "https://cdn.example.com/remera-m.jpg",
      },
    ], "products_export.csv");

    expect(result.source).toBe("shopify");
    expect(result).toMatchObject({ sourceRows: 2, variantCount: 2, imageCount: 2, redirectCount: 1 });
    expect(result.products[0]).toMatchObject({
      name: "Remera de lino",
      brand: "Norte",
      category: "remeras",
      description: "Liviana & fresca",
      sale_price_ars: 30000,
      discount_price_ars: 25000,
      stock: 10,
      source_path: "/products/remera-lino",
      tags: ["verano", "lino"],
    });
    expect(result.products[0].variants).toEqual([
      expect.objectContaining({ name: "S", variant_type: "Talle", sku: "REM-S", stock: 4, provided: expect.arrayContaining(["variant_type"]) }),
      expect.objectContaining({ name: "M", variant_type: "Talle", sku: "REM-M", stock: 6, image_url: "https://cdn.example.com/remera-m.jpg", provided: expect.arrayContaining(["variant_type"]) }),
    ]);
  });

  it("mantiene compatibilidad con los encabezados históricos que Shopify todavía exporta", () => {
    const result = parseCatalogMigrationRows([{
      Handle: "mate-negro",
      Title: "Mate negro",
      "Body (HTML)": "<strong>Acero</strong>",
      "Option1 Name": "Title",
      "Option1 Value": "Default Title",
      "Variant SKU": "MAT-01",
      "Variant Price": "12500.50",
      "Variant Inventory Qty": "3",
      "Image Src": "http://inseguro.example.com/mate.jpg",
    }]);

    expect(result.products[0]).toMatchObject({
      name: "Mate negro",
      sku: "MAT-01",
      sale_price_ars: 12500.5,
      stock: 3,
      variants: [],
    });
    expect(result.products[0].image_urls).toBeUndefined();
  });
});

describe("migración de catálogo Tiendanube", () => {
  it("usa el Identificador de URL como identidad y conserva variantes de la plantilla oficial", () => {
    const result = parseCatalogMigrationRows([
      {
        "Identificador de URL": "zapatilla-urbana",
        Nombre: "Zapatilla urbana",
        Categorías: "Calzado, Novedades",
        Descripción: "<p>Cuero sintético</p>",
        Marca: "Andes",
        "Nombre de propiedad 1": "Talle",
        "Valor de propiedad 1": "40",
        Precio: "52000",
        "Precio promocional": "48000",
        Stock: "2",
        SKU: "ZAP-40",
        "Código de barras": "779100000040",
        "Mostrar en tienda": "SI",
        Tags: "urbano, calzado",
        Peso: "0.8",
      },
      {
        "Identificador de URL": "zapatilla-urbana",
        "Valor de propiedad 1": "41",
        Precio: "52000",
        Stock: "3",
        SKU: "ZAP-41",
      },
    ], "productos.csv");

    expect(result.source).toBe("tiendanube");
    expect(result).toMatchObject({ variantCount: 2, redirectCount: 1 });
    expect(result.products[0]).toMatchObject({
      name: "Zapatilla urbana",
      brand: "Andes",
      category: "calzado",
      sale_price_ars: 52000,
      discount_price_ars: 48000,
      stock: 5,
      weight_kg: 0.8,
      source_path: "/productos/zapatilla-urbana",
      published: true,
    });
    expect(result.products[0].variants?.[1]).toMatchObject({
      name: "41", sku: "ZAP-41", stock: 3, provided: expect.arrayContaining(["variant_type"]),
    });
  });

  it("interpreta guion de stock como inventario no controlado", () => {
    const result = parseCatalogMigrationRows([{
      "Identificador de URL": "servicio-personalizado",
      Nombre: "Servicio personalizado",
      Precio: "15000",
      Stock: "-",
    }]);
    expect(result.products[0]).toMatchObject({ maneja_stock: false });
    expect(result.products[0].stock).toBeUndefined();
  });
});

describe("detección y fallback", () => {
  it("detecta Nerqia y conserva el importador genérico como fallback", () => {
    expect(detectCatalogMigrationSource([{ Nombre: "Producto", "Precio Venta ARS": 10 }])).toBe("nerqia");
    expect(parseCatalogMigrationRows([{ Producto: "Genérico", Precio: 1000 }]).products[0])
      .toMatchObject({ name: "Genérico", sale_price_ars: 1000 });
  });

  it("sólo marca Empretienda cuando el archivo lo declara", () => {
    expect(detectCatalogMigrationSource([{ Nombre: "Producto", Precio: 100 }], "catalogo_empretienda.xlsx"))
      .toBe("empretienda");
  });
});
