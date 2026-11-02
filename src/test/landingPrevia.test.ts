import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MARCA, cssPrimero, insertarLandingPrevia } from "../../scripts/landing-previa.mjs";
import { landingEstatica } from "@/prerender/landingEstatica";

/**
 * La landing en HTML (2026-11-02): el build la deja en index.html para que el
 * título se pinte sin esperar el JavaScript, y React la cambia por la viva.
 */
describe("landing previa", () => {
  it("renderiza la landing completa, con la marca que busca el script de arranque", () => {
    const html = landingEstatica();
    expect(html).toContain("data-landing");
    expect(html).toMatch(/<h1[\s>]/);
    expect(html).toContain('href="/precios"');
  });

  it("la pone en la plantilla y no publica una previa rota", () => {
    const indice = readFileSync("index.html", "utf8");
    expect(indice).toContain(`<template id="plantilla-landing">${MARCA}</template>`);
    expect(insertarLandingPrevia(indice, '<div data-landing=""><h1>Hola</h1></div>'))
      .toContain('<template id="plantilla-landing"><div data-landing=""><h1>Hola</h1></div></template>');
    expect(() => insertarLandingPrevia(indice, "<div>vacía</div>")).toThrow(/data-landing/);
    expect(() => insertarLandingPrevia("<html></html>", '<div data-landing><h1>x</h1></div>')).toThrow(/marca/);
  });

  it("sólo se muestra en la raíz de Nerqia y sin sesión, y la saca la landing viva", () => {
    const indice = readFileSync("index.html", "utf8");
    expect(indice).toContain('deNerqia && !conSesion && location.pathname === "/"');
    expect(indice).toContain('raiz.querySelector("[data-landing]")');
    // Un cargador no la saca; cualquier otra pantalla sí (un error, el login).
    expect(indice).toContain(".app-boot-shell, .animate-spin");
  });

  it("el CSS se pide antes que el JavaScript del arranque", () => {
    const html = [
      "<head>",
      '    <script type="module" crossorigin src="/assets/index-a.js"></script>',
      '    <link rel="modulepreload" crossorigin href="/assets/vendor-b.js">',
      '    <link rel="stylesheet" crossorigin href="/assets/index-c.css">',
      "</head>",
    ].join("\n");
    const salida = cssPrimero(html);
    expect(salida.indexOf("index-c.css")).toBeLessThan(salida.indexOf("index-a.js"));
    expect(salida.match(/stylesheet/g)).toHaveLength(1);
    expect(cssPrimero("<head></head>")).toBe("<head></head>");
  });
});
