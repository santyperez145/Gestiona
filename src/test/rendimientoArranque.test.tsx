import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ErrorBoundaryApp from "@/components/shared/ErrorBoundaryApp";
import { leerFilas, percentil, tabla } from "../../scripts/resumen-rendimiento.mjs";

function Rompe(): JSX.Element {
  throw new Error("zz roto");
}

describe("el arranque no carga Sentry (≈60 % del archivo inicial, 2026-10-31)", () => {
  it("main y App no lo importan de forma estática; se carga en diferido y sólo con DSN", () => {
    const main = readFileSync("src/main.tsx", "utf8");
    const app = readFileSync("src/App.tsx", "utf8");
    expect(main).not.toMatch(/^import .*["']\.\/lib\/sentry["']/m);
    expect(main).toContain('void import("./lib/sentry")');
    expect(main).toContain('getOptionalEnv("VITE_SENTRY_DSN")');
    expect(app).not.toContain("@sentry/react");
    expect(readFileSync("src/lib/registroDeErrores.ts", "utf8")).not.toContain("@/lib/sentry");
  });

  it("el borde de errores muestra el respaldo y avisa al registro propio", () => {
    const onError = vi.fn();
    const consola = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundaryApp onError={onError} fallback={({ error }) => <p>Algo salió mal: {(error as Error).message}</p>}>
        <Rompe />
      </ErrorBoundaryApp>,
    );
    expect(screen.getByText("Algo salió mal: zz roto")).toBeVisible();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "zz roto" }));
    consola.mockRestore();
  });
});

describe("resumen de rendimiento por pantalla", () => {
  const filas = leerFilas([
    JSON.stringify({ ruta: "/a", titulo: 300, listo: 900, lcp: 400, cls: 0, tareasLargas: 0, bloqueo: 0, jsKb: 300, archivosJs: 10, consultas: 3, consultaMasLenta: 120 }),
    "basura",
    JSON.stringify({ ruta: "/b", titulo: 800, listo: 2500, lcp: 900, cls: 0.02, tareasLargas: 2, bloqueo: 140, jsKb: 420, archivosJs: 14, consultas: 9, consultaMasLenta: 700 }),
  ].join("\n"));

  it("ignora líneas rotas y ordena de la pantalla más lenta a la más rápida", () => {
    expect(filas).toHaveLength(2);
    const md = tabla(filas);
    expect(md.indexOf("| /b |")).toBeLessThan(md.indexOf("| /a |"));
    expect(md).toContain("listo: p50 900 · p90 2500 · máx 2500");
  });

  it("percentil", () => {
    expect(percentil([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentil([5, 1, 3, 2, 4], 90)).toBe(5);
    expect(percentil([], 50)).toBe(0);
  });
});
