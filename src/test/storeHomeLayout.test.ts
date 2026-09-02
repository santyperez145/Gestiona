import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DEFAULT_STOREFRONT_LAYOUT,
  heroVisible,
  layoutEsPersonalizado,
  layoutParaGuardar,
  moverSeccion,
  parseStorefrontLayout,
  textoDeAnuncio,
} from "@/lib/storeHomeLayout";

describe("portada modular de la tienda", () => {
  it("vacío significa armalo solo, como el menú", () => {
    expect(layoutEsPersonalizado(null)).toBe(false);
    expect(layoutEsPersonalizado({})).toBe(false);
    const layout = parseStorefrontLayout(null);
    expect(layout.sections.map((s) => s.id)).toEqual(DEFAULT_STOREFRONT_LAYOUT.sections.map((s) => s.id));
    expect(layoutParaGuardar(layout)).toBeNull();
  });

  it("ignora ids inventados, no duplica y agrega los bloques nuevos al final", () => {
    const layout = parseStorefrontLayout({
      sections: [
        { id: "ofertas", enabled: true },
        { id: "tema-motor", enabled: true },
        { id: "ofertas", enabled: false },
        { id: "trust", enabled: false },
      ],
    });
    expect(layout.sections.map((s) => s.id).filter((id) => id === "ofertas")).toHaveLength(1);
    expect(layout.sections.map((s) => s.id as string)).not.toContain("tema-motor");
    expect(layout.sections.find((s) => s.id === "trust")?.enabled).toBe(false);
    expect(layout.sections.at(-1)?.id).toBe("novedades");
  });

  it("limpia HTML del anuncio y no inventa envío gratis", () => {
    const sucio = parseStorefrontLayout({
      announcement: { enabled: true, text: "<script>x</script>  Hasta 6 cuotas  " },
    });
    expect(sucio.announcement.text).toBe("x Hasta 6 cuotas");
    expect(textoDeAnuncio(DEFAULT_STOREFRONT_LAYOUT, { freeShippingAbove: 0, fmt: (n) => `$${n}` })).toBeNull();
    expect(textoDeAnuncio(DEFAULT_STOREFRONT_LAYOUT, { freeShippingAbove: 150000, fmt: (n) => `$${n}` }))
      .toBe("Envío gratis desde $150000");
    expect(textoDeAnuncio({ ...DEFAULT_STOREFRONT_LAYOUT, announcement: { enabled: false, text: "Hola" } }, {}))
      .toBeNull();
  });

  it("con default el hero cede a los banners; personalizado honra el interruptor", () => {
    expect(heroVisible(DEFAULT_STOREFRONT_LAYOUT, 2, false)).toBe(false);
    expect(heroVisible(DEFAULT_STOREFRONT_LAYOUT, 0, false)).toBe(true);
    const sinHero = parseStorefrontLayout({ sections: [{ id: "hero", enabled: false }] });
    expect(heroVisible(sinHero, 0, true)).toBe(false);
    const conHero = parseStorefrontLayout({ sections: [{ id: "hero", enabled: true }] });
    expect(heroVisible(conHero, 3, true)).toBe(true);
  });

  it("mover no se sale de la lista", () => {
    const a = DEFAULT_STOREFRONT_LAYOUT.sections;
    expect(moverSeccion(a, "banners", -1)).toEqual(a);
    expect(moverSeccion(a, "novedades", 1)).toEqual(a);
    expect(moverSeccion(a, "hero", -1)[0].id).toBe("hero");
  });

  it("la vitrina y el panel leen el mismo contrato", () => {
    const home = readFileSync(resolve(process.cwd(), "src/storefront/StoreHome.tsx"), "utf8");
    const layout = readFileSync(resolve(process.cwd(), "src/storefront/StoreLayout.tsx"), "utf8");
    const page = readFileSync(resolve(process.cwd(), "src/pages/EcommerceStorePage.tsx"), "utf8");
    const card = readFileSync(resolve(process.cwd(), "src/storefront/ProductCard.tsx"), "utf8");
    expect(home).toContain("parseStorefrontLayout");
    expect(home).toContain("heroVisible");
    expect(layout).toContain("textoDeAnuncio");
    expect(page).toContain("layoutParaGuardar");
    expect(card).toContain("elegí una opción");
  });
});
