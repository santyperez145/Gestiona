import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { confirmaHipotesis, parsearHerramientas, resumirE2, type EntrevistaE2 } from "@/lib/entrevistasE2";

const e = (over: Partial<EntrevistaE2>): EntrevistaE2 => ({
  id: Math.random().toString(), fecha: "2026-10-15", puerta: "catalogo_grande", comercio: "ZZ", rubro: null,
  herramientas: [], pago_mensual_ars: null, margen_sin_respuesta: false, preguntas_sin_respuesta: null, notas: null, ...over,
});
const confirma = (puerta: EntrevistaE2["puerta"] = "catalogo_grande") => e({ puerta, herramientas: ["A", "B", "C"], margen_sin_respuesta: true });

describe("E2: herramientas sueltas que duelen y se pagan", () => {
  it("confirma sólo con 3+ herramientas y el margen sin respuesta", () => {
    expect(confirmaHipotesis(confirma())).toBe(true);
    expect(confirmaHipotesis(e({ herramientas: ["A", "B"], margen_sin_respuesta: true }))).toBe(false);
    expect(confirmaHipotesis(e({ herramientas: ["A", "B", "C"], margen_sin_respuesta: false }))).toBe(false);
    expect(confirmaHipotesis(e({ herramientas: ["A", " ", "C"], margen_sin_respuesta: true }))).toBe(false);
  });

  it("está en curso, se valida con 10 y se refuta cuando ya no llega", () => {
    expect(resumirE2([]).estado).toBe("en_curso");
    expect(resumirE2(Array.from({ length: 10 }, () => confirma())).estado).toBe("validada");
    // 6 entrevistas que no confirman: quedan 9 por hacer, 0 + 9 < 10.
    expect(resumirE2(Array.from({ length: 6 }, () => e({}))).estado).toBe("refutada");
    expect(resumirE2(Array.from({ length: 5 }, () => e({}))).estado).toBe("en_curso");
  });

  it("cuenta por puerta lo que falta y la mediana de lo que pagan", () => {
    const r = resumirE2([confirma("marca_influencers"), e({ puerta: "muchos_gastos", pago_mensual_ars: 30000 }), e({ pago_mensual_ars: 10000 })]);
    expect(r.porPuerta).toEqual({ catalogo_grande: 1, marca_influencers: 1, muchos_gastos: 1 });
    expect(r.faltanPorPuerta).toEqual({ catalogo_grande: 4, marca_influencers: 4, muchos_gastos: 4 });
    expect(r.pagoMediano).toBe(20000);
    expect(resumirE2([e({})]).pagoMediano).toBeNull();
  });

  it("lee las herramientas como las escribe quien entrevista", () => {
    expect(parsearHerramientas("Excel, Tango; tiendanube\nexcel,  ")).toEqual(["Excel", "Tango", "tiendanube"]);
  });

  it("la tabla es sólo de plataforma y la pestaña existe", () => {
    const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261010002600_entrevistas_e2.sql"), "utf8");
    const page = readFileSync(resolve(process.cwd(), "src/pages/PlatformMetricsPage.tsx"), "utf8");
    expect(migration).toContain("USING (public.is_platform_admin(auth.uid()))");
    expect(migration).toContain("WITH CHECK (public.is_platform_admin(auth.uid()))");
    expect(page).toContain("<EntrevistasE2 />");
  });
});
