import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isStaleBuildError,
} from "@/lib/staleBuildRecovery";

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

  it("la recuperación que borra caches sólo existe detrás de una acción manual", () => {
    const recovery = readFileSync(resolve(process.cwd(), "src/lib/staleBuildRecovery.ts"), "utf8");
    expect(recovery).toContain("forceStaleBuildRecovery");
    expect(recovery).toContain("void hardReload()");
    expect(recovery).not.toContain("recoverFromStaleBuild");
  });

  it("el fallback de React no recarga durante render", () => {
    const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
    expect(app).toContain("onClick={forceStaleBuildRecovery}");
    expect(app).not.toContain("recoverFromStaleBuild()");
  });

  it("los errores de preload conservan la pantalla y anuncian la versión", () => {
    const main = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");
    expect(main).toContain("announceUpdateAvailable()");
    expect(main).toContain("event.preventDefault()");
    expect(main).not.toContain("recoverFromStaleBuild");
  });

  it("mantiene la recuperación temprana y evita fallback HTML para archivos estáticos", () => {
    const main = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");
    const vercel = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as {
      rewrites: Array<{ source: string }>;
      headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
    };

    expect(main).toContain('window.addEventListener("vite:preloadError"');
    expect(main).toContain("announceUpdateAvailable()");
    const fallbackSource = vercel.rewrites.at(-1)?.source ?? "";
    expect(fallbackSource).toContain("api/");
    expect(fallbackSource).toContain("assets/");
    expect(fallbackSource).toContain("developer/");
    expect(fallbackSource).toContain("robots");
    expect(fallbackSource).toContain("sitemap");
    expect(vercel.headers).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "/sw.js" }),
      expect.objectContaining({ source: "/registerSW.js" }),
    ]));
  });
});
