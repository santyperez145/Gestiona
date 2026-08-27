import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Toda función que el navegador invoca deja pasar sus headers.
 *
 * ── Por qué ───────────────────────────────────────────────────────────────
 *
 * `supabase-js` manda `x-client-info` en **cada** llamada a una Edge Function.
 * Si la función no lo declara en `Access-Control-Allow-Headers`, el navegador
 * ni siquiera llega a ejecutarla: el preflight falla y el POST muere en
 * `net::ERR_FAILED`.
 *
 * ⚠️ Pasó en producción el 2026-08-27 al contratar un plan:
 *
 *     Access to fetch at '.../functions/v1/mp-subscribe' has been blocked by
 *     CORS policy: Request header field x-client-info is not allowed by
 *     Access-Control-Allow-Headers in preflight response.
 *
 * Lo caro es que **el error no habla del negocio**. La suscripción no se podía
 * contratar y el mensaje era de CORS: nada que ver con planes, precios ni
 * MercadoPago. Sin este test, el próximo se descubre igual — con un comercio
 * intentando pagar.
 *
 * 📌 No alcanza con `x-client-info`: las versiones nuevas del cliente agregan
 * los `x-supabase-client-*`, así que arreglar sólo el primero deja el mismo
 * bug esperando en el header siguiente. La lista completa ya está en
 * `generate-description`.
 *
 * ── Qué NO exige ──────────────────────────────────────────────────────────
 *
 * Sólo mira las funciones que el navegador realmente invoca, deducidas de
 * `supabase.functions.invoke("...")` en `src/`. Un webhook que llama el
 * servidor de un proveedor no tiene preflight y no necesita nada de esto:
 * pedírselo sería ruido.
 */

const ROOT = resolve(__dirname, "../..");
const FUNCIONES = resolve(ROOT, "supabase/functions");

/** Las funciones que el cliente invoca de verdad. */
function invocadasDesdeElNavegador(): string[] {
  const nombres = new Set<string>();
  const recorrer = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) { if (e !== "test") recorrer(p); continue; }
      if (!/\.tsx?$/.test(e)) continue;
      const texto = readFileSync(p, "utf8");
      for (const m of texto.matchAll(/functions\.invoke\(\s*["'`]([a-z0-9-]+)["'`]/g)) {
        nombres.add(m[1]);
      }
    }
  };
  recorrer(resolve(ROOT, "src"));
  return [...nombres].sort();
}

describe("el navegador llega a las funciones que invoca", () => {
  const invocadas = invocadasDesdeElNavegador();

  it("el escaneo encuentra funciones invocadas", () => {
    expect(invocadas.length).toBeGreaterThan(15);
  });

  it("todas dejan pasar x-client-info", () => {
    const culpables: string[] = [];

    for (const nombre of invocadas) {
      const archivo = resolve(FUNCIONES, nombre, "index.ts");
      if (!existsSync(archivo)) continue; // se invoca una que no existe: no es este test
      const texto = readFileSync(archivo, "utf8");

      // Sin cabecera CORS declarada no hay nada que revisar acá.
      if (!/Access-Control-Allow-Headers/i.test(texto)) continue;

      const m = texto.match(/["']Access-Control-Allow-Headers["']\s*:\s*["']([^"']*)["']/i);
      if (!m) continue;
      if (!m[1].toLowerCase().includes("x-client-info")) {
        culpables.push(`${nombre} → "${m[1]}"`);
      }
    }

    expect(culpables, [
      "Una función que el navegador invoca no deja pasar `x-client-info`.",
      "",
      "`supabase-js` lo manda siempre, así que el preflight falla y la llamada",
      "muere antes de ejecutar la función. El error que ve el comercio es de",
      "CORS y no dice nada del negocio — así se perdió la contratación de un",
      "plan el 2026-08-27.",
      "",
      "La lista que funciona, la misma de `generate-description`:",
      '  "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version"',
      "",
      ...culpables,
    ].join("\n")).toEqual([]);
  });
});
