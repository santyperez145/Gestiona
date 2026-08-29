import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isStaleBuildError,
  shouldRecoverStaleBuild,
  STALE_BUILD_LOOP_WINDOW_MS,
} from "@/lib/staleBuildRecovery";

const NOW = 1_800_000_000_000;

describe("recuperación de un build obsoleto", () => {
  it.each([
    "Failed to fetch dynamically imported module: /assets/ProductsPage-old.js",
    "Importing a module script failed",
    "Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of \"text/html\"",
    "ChunkLoadError: Loading chunk 42 failed",
  ])("reconoce el síntoma de chunk viejo: %s", message => {
    expect(isStaleBuildError(new TypeError(message))).toBe(true);
  });

  it("no confunde un error funcional con un deploy nuevo", () => {
    expect(isStaleBuildError(new Error("No hay stock disponible"))).toBe(false);
  });

  it("permite el primer rescate y otro deploy posterior en la misma sesión", () => {
    expect(shouldRecoverStaleBuild(null, NOW)).toBe(true);
    expect(shouldRecoverStaleBuild(NOW - 60_000, NOW)).toBe(true);
  });

  it("corta sólo las recargas consecutivas que formarían un loop", () => {
    expect(shouldRecoverStaleBuild(NOW - 200, NOW)).toBe(false);
    expect(shouldRecoverStaleBuild(NOW - STALE_BUILD_LOOP_WINDOW_MS, NOW)).toBe(true);
  });

  it("una marca corrupta no deja la app bloqueada", () => {
    expect(shouldRecoverStaleBuild(Number.NaN, NOW)).toBe(true);
  });

  it("mantiene la recuperación temprana y evita fallback HTML para archivos estáticos", () => {
    const main = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");
    const vercel = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as {
      rewrites: Array<{ source: string }>;
      headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    };

    expect(main).toContain('window.addEventListener("vite:preloadError"');
    expect(main).toContain("recoverFromStaleBuild()");
    const fallbackSource = vercel.rewrites.at(-1)?.source ?? "";
    expect(fallbackSource).toContain("api/");
    expect(fallbackSource).toContain("assets/");
    expect(fallbackSource).toContain("developer/");
    expect(vercel.headers).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "/sw.js" }),
      expect.objectContaining({ source: "/registerSW.js" }),
    ]));
  });
});
