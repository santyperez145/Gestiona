import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { aliasRedirects, allRoutes } from "@/app/routeManifest";

// 2026-10-14, recorriendo la app con sesión: `/pos` y `/tienda` daban «ruta
// inexistente» (la caja es `/caja` y la tienda del panel `/tienda-online`), y
// el semáforo de Platform mandaba ahí. Este test junta cada ruta interna que
// el código usa como destino y la cruza con las rutas que existen.

/** Rutas que existen: manifest, alias y las públicas con parámetros de App.tsx. */
function patrones(): string[] {
  const manifest = allRoutes().map(r => r.path);
  const alias = Object.keys(aliasRedirects());
  const app = fs.readFileSync("src/App.tsx", "utf8");
  const aMano = [...app.matchAll(/<Route path="(\/[^"]*)"/g)].map(m => m[1]);
  return [...new Set([...manifest, ...alias, ...aMano, "/login", "/"])];
}

function coincide(ruta: string, patron: string): boolean {
  const a = ruta.split("/").filter(Boolean);
  if (patron.endsWith("/*")) {
    const base = patron.slice(0, -2).split("/").filter(Boolean);
    if (base.length === 0) return false; // `/*` (ProtectedRoutes) no prueba que la pantalla exista.
    return a.length >= base.length && base.every((seg, i) => seg.startsWith(":") || seg === a[i]);
  }
  const b = patron.split("/").filter(Boolean);
  if (a.length !== b.length) return false;
  return b.every((seg, i) => seg.startsWith(":") || seg === a[i]);
}

function archivos(dir: string, out: string[] = []): string[] {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { if (!/node_modules/.test(p) && path.basename(p) !== "test") archivos(p, out); }
    else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)) out.push(p);
  }
  return out;
}

/** Destinos internos literales: navigate("/x"), to="/x", href="/x", ir: "/x". */
function destinos(): Array<{ archivo: string; ruta: string }> {
  const out: Array<{ archivo: string; ruta: string }> = [];
  const re = /(?:navigate\(\s*|\bto=\{?\s*|\bhref=\{?\s*|\bir:\s*|redirectTo:\s*|\bpath:\s*|\bhref:\s*|\bto:\s*)(["'`])(\/[^"'`\s]*)\1/g;
  for (const archivo of archivos("src")) {
    const fuente = fs.readFileSync(archivo, "utf8");
    for (const m of fuente.matchAll(re)) {
      let ruta = m[2].split(/[?#]/)[0].replace(/\$\{[^}]+\}/g, ":p");
      if (ruta.length > 1) ruta = ruta.replace(/\/$/, "");
      if (/^\/(api|functions|rest|auth|storage|assets|favicon|robots|sitemap|_)/.test(ruta)) continue;
      out.push({ archivo: archivo.split(path.sep).join("/"), ruta });
    }
  }
  return out;
}

describe("los enlaces internos apuntan a rutas que existen", () => {
  it("el matcher entiende parámetros y prefijos", () => {
    expect(coincide("/tienda/exentry/producto/1", "/tienda/:slug/*")).toBe(true);
    expect(coincide("/caja", "/caja")).toBe(true);
    expect(coincide("/pos", "/caja")).toBe(false);
  });

  it("ningún destino interno cae en «ruta inexistente»", () => {
    const todos = patrones();
    const rotos = destinos().filter(d => !todos.some(p => coincide(d.ruta, p)));
    expect(rotos.map(r => `${r.ruta} (${r.archivo})`)).toEqual([]);
  });
});
