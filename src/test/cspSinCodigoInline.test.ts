import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Sin código inline (2026-11-04). La política del sitio permitía
 * `'unsafe-inline'` y `'unsafe-eval'`: cualquier XSS que se colara (como el de
 * las ventanas de impresión) corría. Ahora sólo corren los scripts del propio
 * sitio y los dos de index.html, por su hash. El bundle no usa eval.
 *
 * ⚠️ Si se cambia un script inline de index.html, su hash cambia y el
 * navegador lo bloquea en producción: esta prueba lo detecta antes y dice qué
 * hash poner en vercel.json.
 */
const indice = readFileSync("index.html", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as { headers: Array<{ headers: Array<{ key: string; value: string }> }> };
const csp = vercel.headers.flatMap(h => h.headers).find(h => h.key === "Content-Security-Policy")?.value ?? "";
const scriptSrc = /script-src([^;]*)/.exec(csp)?.[1] ?? "";

const inlineEjecutables = [...indice.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")(?![^>]*type="module")[^>]*>([\s\S]*?)<\/script>/g)]
  .map(m => `'sha256-${createHash("sha256").update(m[1]).digest("base64")}'`);

describe("la política del sitio no deja correr código inyectado", () => {
  it("script-src no permite inline ni eval", () => {
    expect(scriptSrc).not.toBe("");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("cada script inline de index.html está autorizado por su hash", () => {
    expect(inlineEjecutables.length).toBeGreaterThan(0);
    for (const hash of inlineEjecutables) {
      expect(scriptSrc, `falta ${hash} en script-src de vercel.json`).toContain(hash);
    }
  });

  it("no quedan hashes de scripts que ya no existen", () => {
    const autorizados = scriptSrc.match(/'sha256-[^']+'/g) ?? [];
    expect(autorizados.sort()).toEqual([...inlineEjecutables].sort());
  });
});
