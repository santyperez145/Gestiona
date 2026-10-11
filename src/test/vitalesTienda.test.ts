import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { clasificarVital, clsDeCambios, LIMITES_VITALES, tipoDePagina } from "@/lib/vitalesTienda";
import { resumirVitales, type FilaVitales } from "@/lib/vitalesPlataforma";

describe("Core Web Vitals de la tienda", () => {
  it("clasifica con los rangos de Google, igual que la base", () => {
    expect(clasificarVital("lcp", 2500)).toBe("buena");
    expect(clasificarVital("lcp", 3200)).toBe("regular");
    expect(clasificarVital("lcp", 4001)).toBe("mala");
    expect(clasificarVital("cls", 0.1)).toBe("buena");
    expect(clasificarVital("cls", 0.3)).toBe("mala");
    expect(clasificarVital("inp", 500)).toBe("regular");
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261011001000_vitales_de_tienda.sql"), "utf8");
    expect(sql).toContain(`('lcp', p_lcp, ${LIMITES_VITALES.lcp.bueno}::numeric, ${LIMITES_VITALES.lcp.malo}::numeric`);
    expect(sql).toContain(`('cls', p_cls, ${LIMITES_VITALES.cls.bueno}, ${LIMITES_VITALES.cls.malo},`);
    expect(sql).toContain(`('inp', p_inp, ${LIMITES_VITALES.inp.bueno}, ${LIMITES_VITALES.inp.malo},`);
  });

  it("reconoce el tipo de página con y sin base", () => {
    expect(tipoDePagina("/tienda/famatina", "/tienda/famatina")).toBe("inicio");
    expect(tipoDePagina("/tienda/famatina/", "/tienda/famatina")).toBe("inicio");
    expect(tipoDePagina("/tienda/famatina/productos", "/tienda/famatina")).toBe("productos");
    expect(tipoDePagina("/tienda/famatina/producto/abc", "/tienda/famatina")).toBe("producto");
    expect(tipoDePagina("/carrito", "")).toBe("otra");
    expect(tipoDePagina("/", "")).toBe("inicio");
  });

  it("CLS toma la peor ventana de cambios", () => {
    expect(clsDeCambios([])).toBe(0);
    expect(clsDeCambios([{ startTime: 0, value: 0.05 }, { startTime: 500, value: 0.05 }, { startTime: 3000, value: 0.2 }])).toBeCloseTo(0.2);
    expect(clsDeCambios([{ startTime: 0, value: 0.1 }, { startTime: 800, value: 0.1 }])).toBeCloseTo(0.2);
  });

  it("la tienda mide la página de entrada y manda al salir sin romper nada", () => {
    const layout = readFileSync(resolve(process.cwd(), "src/storefront/StoreLayout.tsx"), "utf8");
    const lib = readFileSync(resolve(process.cwd(), "src/lib/vitalesTienda.ts"), "utf8");
    expect(layout).toContain("iniciarVitalesTienda(store.slug, tipoDePagina(paginaDeEntrada.current, base));");
    expect(lib).toContain("keepalive: true");
    expect(lib).toContain(".catch(() => { /* best-effort */ });");
  });
});

describe("velocidad de tiendas en Platform", () => {
  const f = (org: string, metrica: FilaVitales["metrica"], visitas: number, pct: number | null): FilaVitales =>
    ({ org_id: org, comercio: org, metrica, visitas, buenas: 0, regulares: 0, malas: 0, pct_buenas: pct });

  it("pasa con ≥ 75% en las tres, no pasa si una con datos está abajo, si no «pocos datos»", () => {
    const r = resumirVitales([
      f("a", "lcp", 50, 90), f("a", "inp", 50, 80), f("a", "cls", 50, 76),
      f("b", "lcp", 50, 60), f("b", "inp", 5, 100),
      f("c", "lcp", 10, 100),
    ]);
    expect(r.map(c => [c.org_id, c.estado])).toEqual([["b", "no_pasa"], ["c", "pocos_datos"], ["a", "pasa"]]);
  });
});
