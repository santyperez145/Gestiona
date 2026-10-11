import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CRITERIOS_TESIS, experimentosTesis, type MedicionesTesis } from "@/lib/experimentosTesis";

const hoy: MedicionesTesis = {
  e1: { ventas: 3, comercio: "Ferreteria Famatina" },
  e2: { total: 0, confirman: 0 },
  e3: { minutos: null, terminadas: 0, intentos: 12 },
  e4: { marcas: 0 },
  e5: { con_4_semanas: 2, pagan: 0 },
};

describe("experimentos de la tesis", () => {
  it("los criterios y fechas coinciden con TESIS.md §9", () => {
    const tesis = readFileSync(resolve(process.cwd(), "docs/TESIS.md"), "utf8");
    const fila = (id: string) => tesis.split("\n").find(l => l.startsWith(`| ${id} |`)) ?? "";
    expect(fila("E1")).toContain(`≥ ${CRITERIOS_TESIS.E1.ventasPorSemana} ventas/semana`);
    expect(fila("E1")).toContain(CRITERIOS_TESIS.E1.fecha);
    expect(fila("E2")).toContain(`${CRITERIOS_TESIS.E2.entrevistas} entrevistas`);
    expect(fila("E2")).toContain(`≥ ${CRITERIOS_TESIS.E2.confirman} usan`);
    expect(fila("E2")).toContain(CRITERIOS_TESIS.E2.fecha);
    expect(fila("E3")).toContain(`< ${CRITERIOS_TESIS.E3.minutos} min`);
    expect(fila("E3")).toContain(CRITERIOS_TESIS.E3.fecha);
    expect(fila("E4")).toContain(`≥ ${CRITERIOS_TESIS.E4.marcas} marca nueva`);
    expect(fila("E4")).toContain(CRITERIOS_TESIS.E4.fecha);
    expect(fila("E5")).toContain(`≥ ${CRITERIOS_TESIS.E5.pct}%`);
    expect(fila("E5")).toContain(CRITERIOS_TESIS.E5.fecha);
  });

  it("con lo medido hoy todo está en curso y dice qué falta", () => {
    const xs = experimentosTesis(hoy, "2026-10-11");
    expect(xs.map(x => x.estado)).toEqual(["en_curso", "en_curso", "en_curso", "en_curso", "en_curso"]);
    expect(xs[0].medido).toBe("3 ventas en los últimos 7 días (Ferreteria Famatina)");
    expect(xs[2].medido).toBe("Ninguna importación terminada (12 intentos)");
    expect(xs[4].medido).toBe("0 de 2 pagan (0%)");
  });

  it("marca logrado al cumplir y vencido si pasó la fecha sin cumplir", () => {
    const xs = experimentosTesis({
      ...hoy, e1: { ventas: 25, comercio: "X" }, e3: { minutos: 12, terminadas: 1, intentos: 2 },
    }, "2026-11-08");
    expect(xs[0].estado).toBe("logrado");
    expect(xs[2].estado).toBe("logrado");
    expect(xs[1].estado).toBe("vencido");
    expect(xs[3].estado).toBe("en_curso");
  });

  it("Platform tiene la pestaña", () => {
    const pagina = readFileSync(resolve(process.cwd(), "src/pages/PlatformMetricsPage.tsx"), "utf8");
    expect(pagina).toContain('{tab === "experiments" && <ExperimentosTesis />}');
  });
});
