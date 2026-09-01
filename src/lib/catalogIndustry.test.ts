import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { elCatalogoOperaPerfumes, esCategoriaPerfume } from "./catalogIndustry";

describe("el catálogo no se presenta como perfumería si el comercio no lo es", () => {
  it("un comercio sin rubro y sin productos de perfume no opera perfumes", () => {
    expect(elCatalogoOperaPerfumes({ industryCode: null, categories: [] })).toBe(false);
    expect(elCatalogoOperaPerfumes({ industryCode: undefined, categories: [null, ""] })).toBe(false);
  });

  it("un comercio de otro rubro no hereda el buscador olfativo", () => {
    expect(elCatalogoOperaPerfumes({ industryCode: "indumentaria", categories: ["remeras"] })).toBe(false);
    expect(elCatalogoOperaPerfumes({ industryCode: "vapers", categories: ["vaper"] })).toBe(false);
  });

  it("quien eligió perfumes, o ya cargó esa categoría, sí opera el rubro", () => {
    expect(elCatalogoOperaPerfumes({ industryCode: "perfumes", categories: [] })).toBe(true);
    expect(elCatalogoOperaPerfumes({
      industryCode: "otro",
      categories: ["perfume_arabe"],
    })).toBe(true);
    expect(esCategoriaPerfume("perfume_diseñador")).toBe(true);
    expect(esCategoriaPerfume("vaper")).toBe(false);
  });

  it("Productos no ofrece el buscador olfativo sin preguntar al catálogo", () => {
    const pagina = readFileSync(resolve(process.cwd(), "src/pages/ProductsPage.tsx"), "utf8");
    expect(pagina).toContain("elCatalogoOperaPerfumes");
    expect(pagina).toContain("{operaPerfumes && (");
    expect(pagina).toContain("Buscador perfume");
  });
});
