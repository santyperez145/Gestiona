import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Un `Select` con todo el catálogo dibuja 11.000 opciones y traba la pantalla;
// los selectores de producto usan `ProductCombobox`, que busca y dibuja 50.
const LISTA_DE_PRODUCTOS_EN_SELECT = /[pP]roducts(\.filter\([^)]*\))?\.map\(\s*\(?\w+\)?\s*=>\s*\(?\s*<SelectItem/;

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap(nombre => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivos(ruta);
    return ruta.endsWith(".tsx") ? [ruta] : [];
  });
}

describe("selectores de producto en catálogos grandes", () => {
  it("ninguna pantalla vuelca la lista de productos en un Select", () => {
    const culpables = archivos("src").filter(ruta => LISTA_DE_PRODUCTOS_EN_SELECT.test(readFileSync(ruta, "utf8")));
    expect(culpables).toEqual([]);
  });
});
