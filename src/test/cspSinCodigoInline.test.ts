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

  it("nadie embebe el sitio ni le cambia el destino a un formulario", () => {
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("object-src 'none'");
    const cabeceras = vercel.headers.flatMap(h => h.headers);
    expect(cabeceras.find(h => h.key === "Cross-Origin-Opener-Policy")?.value).toBe("same-origin-allow-popups");
  });
});

/**
 * Permisos del navegador (2026-11-05). La política decía `camera=()`,
 * `microphone=()` y `geolocation=()`: bloqueaba también a nuestro propio
 * origen, así que en producción no andaban el escáner del POS, el conteo de
 * stock, los comandos de voz ni la ubicación del cobro con QR. Cada permiso
 * que el código usa tiene que estar habilitado para `self`.
 */
describe("la política de permisos deja usar lo que la app usa", () => {
  const permisos = vercel.headers.flatMap(h => h.headers).find(h => h.key === "Permissions-Policy")?.value ?? "";
  const fuentes = ["src/hooks/useBarcodeScan.ts", "src/components/shared/BarcodeScanModal.tsx", "src/pages/POSPage.tsx",
    "src/hooks/useSpeechRecognition.ts", "src/components/pos/PosQrCheckoutDialog.tsx"].map(f => readFileSync(f, "utf8")).join("\n");
  it.each([
    ["camera", /getUserMedia|facingMode|BarcodeDetector/],
    ["microphone", /SpeechRecognition/],
    ["geolocation", /navigator\.geolocation/],
  ])("%s habilitado para el propio sitio si el código lo usa", (permiso, uso) => {
    expect(uso.test(fuentes), `ya no se usa ${permiso}: ajustar la prueba`).toBe(true);
    expect(permisos).toContain(`${permiso}=(self)`);
  });
});
