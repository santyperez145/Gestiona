import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";

// 2026-10-14, recorriendo la app después de un deploy: entrar a una pantalla
// todavía no abierta pedía un archivo del build anterior y rompía con «Cannot
// read properties of undefined (reading 'default')». Ahora, con una versión
// nueva pendiente, el próximo cambio de pantalla carga la versión nueva.
const recargas = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/lib/hardReload", () => ({ hardReload: async () => { recargas.n += 1; } }));

describe("actualizar al navegar", () => {
  beforeEach(() => {
    recargas.n = 0;
    sessionStorage.clear();
    vi.resetModules();
  });

  it("sin versión nueva pendiente, navegar no recarga", async () => {
    const sw = await import("@/lib/swUpdate");
    expect(sw.alCambiarDePantalla(1_000_000)).toBe(false);
    expect(recargas.n).toBe(0);
  });

  it("con versión nueva pendiente, el próximo cambio de pantalla la carga", async () => {
    const sw = await import("@/lib/swUpdate");
    sw.announceUpdateAvailable();
    expect(sw.alCambiarDePantalla(1_000_000)).toBe(true);
    expect(recargas.n).toBe(1);
  });

  // 2026-10-15: durante una publicación el servidor dio 404 unos segundos y el
  // único intento por minuto se gastó ahí. Ahora: hasta tres, con esperas de
  // 0, 8 y 20 s, en una ventana de dos minutos; nunca en bucle.
  it("nunca recarga en bucle: hasta tres veces en dos minutos, con esperas", async () => {
    const sw = await import("@/lib/swUpdate");
    sw.announceUpdateAvailable();
    expect(sw.recargarPorVersionNueva(1_000_000)).toBe(true);
    expect(sw.esperaParaRecargar(1_003_000)).toBe(5_000);
    expect(sw.recargarPorVersionNueva(1_003_000)).toBe(false);
    expect(sw.recargarPorVersionNueva(1_009_000)).toBe(true);
    expect(sw.esperaParaRecargar(1_010_000)).toBe(19_000);
    expect(sw.recargarPorVersionNueva(1_030_000)).toBe(true);
    expect(sw.esperaParaRecargar(1_060_000)).toBeNull();
    expect(sw.recargarPorVersionNueva(1_060_000)).toBe(false);
    expect(recargas.n).toBe(3);
    expect(sw.recargarPorVersionNueva(1_125_000)).toBe(true);
  });

  it("un archivo viejo que falla hasta 4 s después de navegar cuenta como parte de la navegación", async () => {
    const sw = await import("@/lib/swUpdate");
    expect(sw.navegoHaceInstantes(1_000_000)).toBe(false);
    sw.alCambiarDePantalla(1_000_000);
    expect(sw.navegoHaceInstantes(1_003_000)).toBe(true);
    expect(sw.navegoHaceInstantes(1_005_000)).toBe(false);
  });

  it("main ya no silencia el error de build viejo fuera de una navegación (era el módulo vacío)", () => {
    const main = fs.readFileSync("src/main.tsx", "utf8");
    expect(main).toContain("if (navegoHaceInstantes() && recargarPorVersionNueva()) event.preventDefault();");
    const app = fs.readFileSync("src/App.tsx", "utf8");
    expect(app).toContain("<ActualizarAlNavegar />");
  });

  // 2026-10-14: al entrar justo después de un despliegue quedaba frenada en
  // «Nueva versión disponible» hasta tocar «Actualizar».
  it("recién cargada, un archivo viejo carga la versión nueva sola, reintentando con espera", async () => {
    vi.useFakeTimers();
    const sw = await import("@/lib/swUpdate");
    expect(sw.recuperarVersionSola(1_000_000, 3_000)).toBe(0);
    expect(recargas.n).toBe(1);
    expect(sw.recuperarVersionSola(1_002_000, 3_000)).toBe(6_000);
    vi.advanceTimersByTime(6_000);
    expect(recargas.n).toBe(2);
    vi.useRealTimers();
  });

  it("con la página abierta hace rato y sin navegar, no recarga sola (puede haber trabajo)", async () => {
    const sw = await import("@/lib/swUpdate");
    expect(sw.recuperarVersionSola(1_000_000, 600_000)).toBeNull();
    expect(recargas.n).toBe(0);
  });

  it("el error de versión vieja usa el componente que intenta solo", () => {
    const app = fs.readFileSync("src/App.tsx", "utf8");
    expect(app).toContain("<VersionNueva intentarSola={isStaleBuildError(error)} />");
    expect(app).toContain("if (intentarSola && recuperarVersionSola() === null) setManual(true);");
  });
});
