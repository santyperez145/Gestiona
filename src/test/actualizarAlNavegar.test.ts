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

  it("nunca recarga en bucle: una vez por minuto como mucho", async () => {
    const sw = await import("@/lib/swUpdate");
    sw.announceUpdateAvailable();
    expect(sw.recargarPorVersionNueva(1_000_000)).toBe(true);
    expect(sw.recargarPorVersionNueva(1_030_000)).toBe(false);
    expect(sw.recargarPorVersionNueva(1_061_000)).toBe(true);
    expect(recargas.n).toBe(2);
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
});
