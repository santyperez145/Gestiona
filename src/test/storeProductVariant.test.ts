import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  etiquetaTipoVariante,
  textoCtaVariante,
  textoDisponibilidadProducto,
} from "@/lib/storeProductVariant";

const productPage = readFileSync(resolve(process.cwd(), "src/storefront/StoreProduct.tsx"), "utf8");

describe("decisión de variantes en la ficha pública", () => {
  it("no usa el stock agregado antes de elegir el SKU", () => {
    expect(textoDisponibilidadProducto({
      variants: [{ stock: 4, variant_type: "sabor" }, { stock: 0, variant_type: "sabor" }],
      selected: null,
      productStock: 4,
    })).toBe("Elegí un sabor para ver disponibilidad.");
  });

  it("explica el stock exacto de la variante elegida", () => {
    const variants = [{ stock: 0, variant_type: "talle" }, { stock: 1, variant_type: "talle" }];
    expect(textoDisponibilidadProducto({ variants, selected: variants[0], productStock: 1 }))
      .toBe("Esta variante está agotada.");
    expect(textoDisponibilidadProducto({ variants, selected: variants[1], productStock: 1 }))
      .toBe("¡Última unidad!");
  });

  it("conserva el comportamiento del producto simple", () => {
    expect(textoDisponibilidadProducto({ variants: [], selected: null, productStock: 0 })).toBe("Sin stock");
    expect(textoDisponibilidadProducto({ variants: [], selected: null, productStock: 3 })).toBe("¡Últimas 3 unidades!");
    expect(textoDisponibilidadProducto({ variants: [], selected: null, productStock: 8 })).toBe("En stock");
  });

  it("normaliza etiquetas y CTA sin reducir todo a sabores", () => {
    expect(etiquetaTipoVariante("presentacion")).toBe("Presentación");
    expect(etiquetaTipoVariante("desconocido")).toBe("Variante");
    expect(textoCtaVariante("color")).toBe("Elegí un color");
    expect(textoCtaVariante("otro")).toBe("Elegí una variante");
  });

  it("no cotiza un SKU ambiguo y deja elegir el agotado para pedir reposición", () => {
    expect(productPage).toContain("store && !faltaElegir && !agotadoParaCompra");
    expect(productPage).toContain('aria-label={`${v.variant_name}: ${agotada ? "agotado"');
    expect(productPage).toContain("setVariantId(v.id)");
    expect(productPage).toContain('<StockAlertForm productId={p.id} variantId={variantId} />');
    expect(productPage).not.toContain("disabled={v.stock <= 0}");
  });
});
