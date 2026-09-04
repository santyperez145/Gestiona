import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  etiquetaTipoVariante,
  precioDeVariante,
  resumenVariantesParaCard,
  textoCtaVariante,
  textoDisponibilidadProducto,
} from "@/lib/storeProductVariant";

const productPage = readFileSync(resolve(process.cwd(), "src/storefront/StoreProduct.tsx"), "utf8");
const productCard = readFileSync(resolve(process.cwd(), "src/storefront/ProductCard.tsx"), "utf8");
const visibilityMigration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20260904000090_storefront_includes_sold_out_variants.sql",
), "utf8");

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
    expect(productPage).toContain("}, [productId, products, variantId]);");
  });

  it("el catálogo público entrega también las variantes activas agotadas", () => {
    expect(visibilityMigration).toContain("CREATE OR REPLACE FUNCTION public.get_store_variants");
    expect(visibilityMigration).toContain("AND v.active");
    expect(visibilityMigration).not.toContain("AND v.stock > 0");
    expect(visibilityMigration).toContain("(v.stock > 0) DESC");
    expect(visibilityMigration).toContain("REVOKE ALL ON FUNCTION public.get_store_variants(text) FROM PUBLIC");
    expect(visibilityMigration).toContain("GRANT EXECUTE ON FUNCTION public.get_store_variants(text) TO anon, authenticated");
  });

  it("la card resume disponibilidad sin duplicar el selector de la ficha", () => {
    const variants = [
      { id: "a", stock: 2, price_override: 900 },
      { id: "b", stock: 1, price_override: 1100 },
      { id: "c", stock: 4, price_override: null },
      { id: "d", stock: 3, price_override: 950 },
      { id: "e", stock: 0, price_override: 800 },
    ];
    const resumen = resumenVariantesParaCard(variants, 1000);

    expect(resumen.disponibles).toHaveLength(4);
    expect(resumen.agotadas).toBe(1);
    expect(resumen.stockDisponible).toBe(10);
    expect(productCard).toContain('data-variant-count={tieneVariantes ? variantes.length : undefined}');
    expect(productCard).toContain('textoCtaVariante(tipoVariante).replace(/^Elegí/, "Elegir")');
    expect(productCard).not.toContain('role="radio"');
    expect(productCard).not.toContain("addToCart(p, 1, variante)");
  });

  it("la card anuncia desde el menor precio y cambia al monto exacto al elegir", () => {
    const variants = [
      { id: "a", stock: 2, price_override: 900 },
      { id: "b", stock: 1, price_override: 1200 },
      { id: "c", stock: 0, price_override: 700 },
    ];
    const inicial = resumenVariantesParaCard(variants, 1000);

    expect(inicial.precio).toBe(900);
    expect(inicial.desde).toBe(true);
    expect(precioDeVariante(1000, variants[2])).toBe(700);
    expect(precioDeVariante(1000, { price_override: 0 })).toBe(1000);
  });
});
