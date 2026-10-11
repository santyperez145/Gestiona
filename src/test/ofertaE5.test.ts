import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mostrarOfertaE5, pospuestaHasta, semanasDeUso, yaPaga } from "@/lib/ofertaE5";

const ahora = new Date("2026-10-30T12:00:00Z");
const base = { orgCreadaAt: "2026-10-02T12:00:00Z", rol: "owner", planCode: "trial", estado: "plan_gratis", pospuestaHasta: null, ahora };

describe("oferta de Starter a las 4 semanas (E5)", () => {
  it("cuenta semanas desde el alta del comercio", () => {
    expect(semanasDeUso("2026-10-02T12:00:00Z", ahora)).toBe(4);
    expect(semanasDeUso("2026-10-10T12:00:00Z", ahora)).toBe(2);
    expect(semanasDeUso(undefined, ahora)).toBeNull();
    expect(semanasDeUso("no es fecha", ahora)).toBeNull();
  });

  it("se ofrece al dueño o administrador con 4 semanas que no paga", () => {
    expect(mostrarOfertaE5(base)).toBe(true);
    expect(mostrarOfertaE5({ ...base, rol: "admin" })).toBe(true);
    expect(mostrarOfertaE5({ ...base, rol: "vendedor" })).toBe(false);
    expect(mostrarOfertaE5({ ...base, orgCreadaAt: "2026-10-10T12:00:00Z" })).toBe(false);
  });

  it("no se ofrece a quien ya paga, y la prueba no cuenta como pago", () => {
    expect(yaPaga("starter", "active")).toBe(true);
    expect(yaPaga("trial", "trialing")).toBe(false);
    expect(yaPaga("starter", "past_due")).toBe(false);
    expect(mostrarOfertaE5({ ...base, planCode: "pro", estado: "active" })).toBe(false);
  });

  it("«Más adelante» la esconde 14 días", () => {
    const hasta = pospuestaHasta(ahora);
    expect(mostrarOfertaE5({ ...base, pospuestaHasta: hasta })).toBe(false);
    expect(mostrarOfertaE5({ ...base, pospuestaHasta: hasta, ahora: new Date("2026-11-14T12:00:00Z") })).toBe(true);
  });

  it("el Inicio la muestra y Mi plan baja hasta la cuenta", () => {
    const dashboard = readFileSync(resolve(process.cwd(), "src/pages/Dashboard.tsx"), "utf8");
    const oferta = readFileSync(resolve(process.cwd(), "src/components/dashboard/OfertaStarterE5.tsx"), "utf8");
    const panel = readFileSync(resolve(process.cwd(), "src/components/plan/LoQueReemplazaNerqia.tsx"), "utf8");
    expect(dashboard).toContain("<OfertaStarterE5 />");
    expect(oferta).toContain('to="/mi-plan#lo-que-reemplaza"');
    expect(panel).toContain('window.location.hash !== "#lo-que-reemplaza"');
  });
});
