import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Ningún test lee un archivo que ya no existe.
 *
 * ── Por qué ───────────────────────────────────────────────────────────────
 *
 * Varias guardas de este repo funcionan leyendo código fuente: `publicSurface`,
 * `edgeFunctionAuth`, `noPastedCredentials`, `sinSimulacion`, `apiPublicaEndurecida`.
 * Casi todas hacen el `readFileSync` **en el cuerpo del módulo**, fuera de un
 * `it()`.
 *
 * ⚠️ Eso tiene una consecuencia que no se ve: si el archivo leído se borra o se
 * mueve, el ENOENT ocurre al importar, vitest marca la suite como fallada
 * **y ninguno de sus tests corre**. El conteo de "N tests passed" no baja —
 * baja el de archivos, que es la línea de arriba— así que la salida sigue
 * pareciendo sana y el número que se cita en la documentación sigue subiendo.
 *
 * Pasó de verdad: `sinSimulacion.test.ts` leía `src/pages/AIChatAdvancedPage.tsx`,
 * la página se fusionó en Inteligencia el 2026-08-27 (commit `ed859f8`), y sus
 * 10 tests dejaron de correr sin que nadie lo notara. Los que vigilaban que el
 * chat de IA no fabricara el conteo de tokens.
 *
 * Este test encuentra el problema en el origen —la ruta escrita— y no en el
 * síntoma.
 */

const ROOT = resolve(__dirname, "../..");
const DIR = resolve(__dirname);

/** Rutas del repo escritas como literal dentro de un test. */
const RUTA = /["'`](src\/[^"'`]+\.(?:tsx?|css)|supabase\/functions\/[^"'`]+\.ts|e2e\/[^"'`]+\.ts)["'`]/g;

describe("los tests leen archivos que existen", () => {
  const archivos = readdirSync(DIR).filter(f => f.endsWith(".test.ts"));

  it("el escaneo mira tests de verdad", () => {
    expect(archivos.length).toBeGreaterThan(50);
  });

  it("ninguna ruta literal apunta al vacío", () => {
    const rotas: string[] = [];

    for (const archivo of archivos) {
      const texto = readFileSync(resolve(DIR, archivo), "utf8");
      const lineas = texto.split("\n");

      lineas.forEach((linea, i) => {
        // Un comentario puede nombrar un archivo que ya no está: contar la
        // historia de algo borrado es exactamente para lo que sirven.
        const limpia = linea.trim();
        if (limpia.startsWith("//") || limpia.startsWith("*")) return;

        // ⚠️ `existsSync` es lo contrario de un problema: un test que pregunta
        // si el archivo está maneja él mismo el caso de que no. Varias guardas
        // exigen que algo NO exista —`ApiKeysManager.tsx`, el sistema de keys
        // que no autenticaba nada— y marcarlas sería pedir que vuelva.
        if (linea.includes("existsSync")) return;

        for (const m of linea.matchAll(RUTA)) {
          const ruta = m[1];
          // Un glob o un fragmento armado no es una ruta que se pueda abrir.
          if (ruta.includes("*") || ruta.includes("${")) continue;
          if (!existsSync(resolve(ROOT, ruta))) {
            rotas.push(`${archivo}:${i + 1} → ${ruta}`);
          }
        }
      });
    }

    expect(rotas, [
      "Un test nombra un archivo que no existe.",
      "",
      "Si el `readFileSync` está en el cuerpo del módulo, el ENOENT ocurre al",
      "importar y NINGÚN test de ese archivo corre — sin que el conteo de tests",
      "pasados baje. Así estuvo `sinSimulacion.test.ts` desde el commit ed859f8.",
      "",
      "Se arregla apuntando al archivo nuevo, o —mejor— buscándolo por lo que",
      "hace, como quedó `archivoDelChat()` en ese mismo test.",
      "",
      ...rotas,
    ].join("\n")).toEqual([]);
  });
});
