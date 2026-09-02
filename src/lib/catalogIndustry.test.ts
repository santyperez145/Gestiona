import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  elCatalogoOperaPerfumes,
  elCatalogoOperaVapers,
  esCategoriaPerfume,
  esCategoriaVaper,
  laFichaEsPerfume,
  laFichaEsTecnologia,
  laFichaEsVaper,
} from "./catalogIndustry";

function leer(rel: string) {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

describe("el workspace no se presenta como una vertical si el comercio no lo es", () => {
  it("un comercio sin rubro y sin productos de esa familia no opera el rubro", () => {
    expect(elCatalogoOperaPerfumes({ industryCode: null, categories: [] })).toBe(false);
    expect(elCatalogoOperaPerfumes({ industryCode: undefined, categories: [null, ""] })).toBe(false);
    expect(elCatalogoOperaVapers({ industryCode: null, categories: [] })).toBe(false);
  });

  it("un comercio de otro rubro no hereda el chrome olfativo ni el de vapers", () => {
    expect(elCatalogoOperaPerfumes({ industryCode: "indumentaria", categories: ["remeras"] })).toBe(false);
    expect(elCatalogoOperaPerfumes({ industryCode: "vapers", categories: ["vaper"] })).toBe(false);
    expect(elCatalogoOperaVapers({ industryCode: "indumentaria", categories: ["remeras"] })).toBe(false);
    expect(elCatalogoOperaVapers({ industryCode: "perfumes", categories: ["perfume_arabe"] })).toBe(false);
  });

  it("quien eligió el rubro, o ya cargó esa categoría, sí opera", () => {
    expect(elCatalogoOperaPerfumes({ industryCode: "perfumes", categories: [] })).toBe(true);
    expect(elCatalogoOperaPerfumes({
      industryCode: "otro",
      categories: ["perfume_arabe"],
    })).toBe(true);
    expect(elCatalogoOperaVapers({ industryCode: "vapers", categories: [] })).toBe(true);
    expect(elCatalogoOperaVapers({ industryCode: "otro", categories: ["liquido"] })).toBe(true);
    expect(esCategoriaPerfume("perfume_diseñador")).toBe(true);
    expect(esCategoriaPerfume("vaper")).toBe(false);
    expect(esCategoriaVaper("vaper")).toBe(true);
    expect(esCategoriaVaper("perfume_arabe")).toBe(false);
  });

  it("la ficha de producto mira el tipo tipado antes que la categoría", () => {
    expect(laFichaEsPerfume({ productTypeSlug: "perfume", category: null })).toBe(true);
    expect(laFichaEsPerfume({ productTypeSlug: "perfume", category: "remeras" })).toBe(true);
    expect(laFichaEsPerfume({ productTypeSlug: "plato", category: "perfume_arabe" })).toBe(false);
    expect(laFichaEsPerfume({ productTypeSlug: null, category: "perfume_arabe" })).toBe(true);
    expect(laFichaEsPerfume({ productTypeSlug: "", category: "vaper" })).toBe(false);

    expect(laFichaEsVaper({ productTypeSlug: "dispositivo-vape", category: null })).toBe(true);
    expect(laFichaEsVaper({ productTypeSlug: "e-liquid", category: "remeras" })).toBe(true);
    expect(laFichaEsVaper({ productTypeSlug: "perfume", category: "vaper" })).toBe(false);
    expect(laFichaEsVaper({ productTypeSlug: null, category: "liquido" })).toBe(true);

    expect(laFichaEsTecnologia({ productTypeSlug: "tecnologia", category: null })).toBe(true);
    expect(laFichaEsTecnologia({ productTypeSlug: "perfume", category: "electronico" })).toBe(false);
    expect(laFichaEsTecnologia({ productTypeSlug: null, category: "electronico" })).toBe(true);
  });

  it("Productos no ofrece el buscador olfativo sin preguntar al catálogo", () => {
    const pagina = leer("src/pages/ProductsPage.tsx");
    expect(pagina).toContain("elCatalogoOperaPerfumes");
    expect(pagina).toContain("{operaPerfumes && (");
    expect(pagina).toContain("Buscador perfume");
    expect(pagina).toContain("laFichaEsPerfume");
    expect(pagina).toContain("laFichaEsVaper");
    expect(pagina).toContain("laFichaEsTecnologia");
  });

  it("Clientes no ofrece preferencias olfativas ni vapers sin preguntar al catálogo", () => {
    const pagina = leer("src/pages/CustomersPage.tsx");
    expect(pagina).toContain("elCatalogoOperaPerfumes");
    expect(pagina).toContain("elCatalogoOperaVapers");
    expect(pagina).toContain("operaPerfumes && (");
    expect(pagina).toContain("Preferencias olfativas");
    expect(pagina).toContain("Compra vapers");
  });

  it("el catálogo interno no ofrece filtros de perfume sin preguntar al catálogo", () => {
    const pagina = leer("src/pages/CatalogPage.tsx");
    expect(pagina).toContain("elCatalogoOperaPerfumes");
    expect(pagina).toContain("operaPerfumes && (");
    expect(pagina).toContain("Filtros de perfume");
  });

  it("Reportes no consulta fichas olfativas si el comercio no opera perfumes", () => {
    const pagina = leer("src/pages/ReportsPage.tsx");
    expect(pagina).toContain("elCatalogoOperaPerfumes");
    expect(pagina).toContain("Ingresos por familia olfativa");
  });
});
