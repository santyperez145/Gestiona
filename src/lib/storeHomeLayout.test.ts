import { describe, expect, it } from "vitest";
import {
  coleccionDeBloque,
  coleccionDeSeccion,
  layoutsIguales,
  parseStorefrontLayout,
  HOME_SECTIONS_WITH_COLLECTION,
  DEFAULT_STOREFRONT_LAYOUT,
} from "./storeHomeLayout";

describe("colecciones por bloque de vitrina", () => {
  it("acepta slugs válidos y sanea basura a sin-filtro", () => {
    expect(coleccionDeSeccion("Perfumes-Arabes")).toBe("perfumes-arabes");
    expect(coleccionDeSeccion("  vapers  ")).toBe("vapers");
    expect(coleccionDeSeccion("")).toBeUndefined();
    expect(coleccionDeSeccion("../../etc")).toBeUndefined();
    expect(coleccionDeSeccion(42)).toBeUndefined();
    expect(coleccionDeSeccion(null)).toBeUndefined();
  });

  it("sólo los bloques que soportan colección la conservan al parsear", () => {
    const raw = {
      sections: [
        { id: "destacados", enabled: true, collection: "Perfumes" },
        { id: "novedades", enabled: true, collection: "ropa-deportiva" },
        { id: "ofertas", enabled: true, collection: "no-debe-quedar" },
      ],
    };
    const parsed = parseStorefrontLayout(raw);
    const destacados = parsed.sections.find(s => s.id === "destacados");
    const novedades = parsed.sections.find(s => s.id === "novedades");
    const ofertas = parsed.sections.find(s => s.id === "ofertas");
    expect(destacados?.collection).toBe("perfumes");
    expect(novedades?.collection).toBe("ropa-deportiva");
    expect(ofertas?.collection).toBeUndefined();
    expect(HOME_SECTIONS_WITH_COLLECTION.has("ofertas")).toBe(false);
  });

  it("un layout default sigue guardándose como null: la colección no cuenta en bloques que no la usan", () => {
    const conBasura = parseStorefrontLayout({
      sections: [
        ...DEFAULT_STOREFRONT_LAYOUT.sections,
        // Basura en un bloque que no soporta colección: no es personalización.
        { id: "ofertas", enabled: true, collection: "no-deberia-contar" },
      ],
    });
    expect(conBasura.sections.find(s => s.id === "ofertas")?.collection).toBeUndefined();
    expect(layoutsIguales(conBasura, DEFAULT_STOREFRONT_LAYOUT)).toBe(true);
  });

  it("un layout con colección real es personalizado y difiere del default", () => {
    const conColeccion = parseStorefrontLayout({
      sections: [{ id: "destacados", enabled: true, collection: "perfumes" }],
    });
    expect(layoutsIguales(conColeccion, DEFAULT_STOREFRONT_LAYOUT)).toBe(false);
    expect(conColeccion.sections.find(s => s.id === "destacados")?.collection).toBe("perfumes");
  });
});