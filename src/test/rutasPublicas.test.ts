import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { esRutaPublica } from "@/lib/rutasPublicas";

// 2026-10-15: con sesión del panel, la tienda se remontaba al cargar la
// organización y volvía a pedir su catálogo de cero.
describe("rutas públicas fuera del cambio de organización", () => {
  it("reconoce las públicas y no las del panel", () => {
    expect(esRutaPublica("/tienda/ferreteriafamatina")).toBe(true);
    expect(esRutaPublica("/tienda/x/producto/1")).toBe(true);
    expect(esRutaPublica("/pagar/abc")).toBe(true);
    expect(esRutaPublica("/invitacion/tok")).toBe(true);
    expect(esRutaPublica("/tienda-online")).toBe(false);
    expect(esRutaPublica("/ventas")).toBe(false);
    expect(esRutaPublica("/")).toBe(false);
  });
  it("las públicas no se remontan con la organización", () => {
    const app = fs.readFileSync("src/App.tsx", "utf8");
    expect(app.indexOf("if (esRutaPublica(location.pathname))")).toBeLessThan(app.indexOf('return <AppLoader label="Cambiando organización..." />'));
  });
});
