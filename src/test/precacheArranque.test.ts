import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { importsEstaticos, piezasDelArranque, piezasDelHtml, transformarPrecache } from "../../scripts/precache-arranque.mjs";

/** Un build de juguete con la forma del de verdad. */
function buildDePrueba() {
  const dist = mkdtempSync(path.join(tmpdir(), "nerqia-precache-"));
  mkdirSync(path.join(dist, "assets"));
  writeFileSync(path.join(dist, "index.html"), [
    '<script type="module" crossorigin src="/assets/index-A1.js"></script>',
    '<link rel="modulepreload" crossorigin href="/assets/client-B2.js">',
    '<link rel="modulepreload" crossorigin href="/assets/auth-C3.js">',
  ].join("\n"));
  const chunks: Record<string, string> = {
    "index-A1.js": 'import{a}from"./client-B2.js";import"./auth-C3.js";const p=()=>import("./ProductsPage-D4.js");',
    "client-B2.js": "export const a=1;",
    "auth-C3.js": "export const b=1;",
    "ProductsPage-D4.js": "export default 1;",
    "POSPage-E5.js": 'import{a}from"./client-B2.js";import{t}from"./ticket-F6.js";',
    "ticket-F6.js": 'import{pdf}from"./vendor-pdf-G7.js";export const t=1;',
    "vendor-pdf-G7.js": "export const pdf=1;",
    "vendor-xlsx-H8.js": "export const x=1;",
    "vendor-react-I9.js": "export const r=1;",
  };
  for (const [nombre, codigo] of Object.entries(chunks)) writeFileSync(path.join(dist, "assets", nombre), codigo);
  return dist;
}

const entrada = (url: string) => ({ url, revision: null, size: 1 });

describe("precache del service worker", () => {
  it("lee del html y de los chunks lo que se importa de forma estática, no los import() dinámicos", () => {
    expect(piezasDelHtml('<script src="/assets/index-A1.js"></script><link href="/assets/x-B.js">')).toEqual(["assets/index-A1.js", "assets/x-B.js"]);
    expect(importsEstaticos('import{a}from"./client-B2.js";import"./auth-C3.js";import("./Page-D4.js")')).toEqual(["assets/client-B2.js", "assets/auth-C3.js"]);
  });

  it("el arranque es el entry con sus piezas más el POS con todo lo que importa", () => {
    const piezas = piezasDelArranque(buildDePrueba());
    expect([...piezas].sort()).toEqual([
      "assets/POSPage-E5.js", "assets/auth-C3.js", "assets/client-B2.js", "assets/index-A1.js", "assets/ticket-F6.js", "assets/vendor-pdf-G7.js",
    ]);
  });

  it("guarda el arranque y los vendors livianos; las páginas y xlsx se cachean al abrirse", async () => {
    const dist = buildDePrueba();
    const urls = [
      "index.html", "assets/index-A1.js", "assets/client-B2.js", "assets/auth-C3.js", "assets/ProductsPage-D4.js", "assets/POSPage-E5.js",
      "assets/ticket-F6.js", "assets/vendor-pdf-G7.js", "assets/vendor-xlsx-H8.js", "assets/vendor-react-I9.js", "assets/index-A1.css",
    ];
    const { manifest } = await transformarPrecache(dist)(urls.map(entrada));
    expect(manifest.map((e: { url: string }) => e.url).sort()).toEqual([
      "assets/POSPage-E5.js", "assets/auth-C3.js", "assets/client-B2.js", "assets/index-A1.css", "assets/index-A1.js",
      "assets/ticket-F6.js", "assets/vendor-pdf-G7.js", "assets/vendor-react-I9.js", "index.html",
    ]);
  });

  it("si una pieza del arranque no entra al precache, el build falla", async () => {
    const dist = buildDePrueba();
    await expect(transformarPrecache(dist)([entrada("index.html"), entrada("assets/index-A1.js")]))
      .rejects.toThrow(/assets\/client-B2\.js/);
  });

  it("vite usa el cálculo del build, no una lista de nombres", () => {
    const config = readFileSync("vite.config.ts", "utf8");
    expect(config).toContain('manifestTransforms: [transformarPrecache(path.resolve(__dirname, "dist"))]');
    expect(config).not.toContain("assets/!(POSPage|index|vendor)*-*.js");
  });
});

describe("red de seguridad del arranque en index.html", () => {
  const html = readFileSync("index.html", "utf8");
  const guarda = html.match(/<script>\s*(\(function \(\) \{[\s\S]*?\}\)\(\);)\s*<\/script>/)?.[1] ?? "";

  function instalar() {
    sessionStorage.clear();
    document.body.innerHTML = '<div id="root"></div>';
    const recargar = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { reload: recargar } });
    new Function(guarda)();
    return recargar;
  }

  function fallaDe(src: string) {
    const script = document.createElement("script");
    Object.defineProperty(script, "src", { value: src });
    document.head.appendChild(script);
    script.dispatchEvent(new Event("error"));
  }

  it("está antes que cualquier script de la app", () => {
    expect(guarda).not.toBe("");
    expect(html.indexOf("nerqia.recarga-por-version")).toBeLessThan(html.indexOf('<script type="module"'));
  });

  it("una pieza de /assets que no carga recarga una vez; la segunda muestra un aviso con botón", async () => {
    const recargar = instalar();
    fallaDe("https://nerqia.app/assets/client-viejo.js");
    await vi.waitFor(() => expect(recargar).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem("nerqia.recarga-por-version")).toBe("1");

    fallaDe("https://nerqia.app/assets/client-viejo.js");
    expect(recargar).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="alert"]')).toHaveTextContent("Hay una versión nueva de Nerqia");
    expect(document.querySelector('[role="alert"] button')).toHaveTextContent("Abrir la versión nueva");
  });

  it("no toca nada por un script de terceros", () => {
    const recargar = instalar();
    fallaDe("https://connect.facebook.net/en_US/fbevents.js");
    expect(recargar).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("nerqia.recarga-por-version")).toBeNull();
  });

  it("main.tsx limpia la marca cuando la app arranca bien", () => {
    expect(readFileSync("src/main.tsx", "utf8")).toContain('sessionStorage.removeItem("nerqia.recarga-por-version")');
  });
});
