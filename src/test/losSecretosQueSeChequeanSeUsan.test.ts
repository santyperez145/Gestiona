import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * La salud de configuración dice la verdad.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * El panel de plataforma tiene una pantalla que le dice al dueño qué secretos
 * están configurados. Medido el 2026-08-28 comparándola con lo que las Edge
 * Functions **realmente leen**, estaba vieja de las dos maneras posibles:
 *
 *   - **Cuatro que chequeaba y nadie usa**: `TIENDANUBE_CLIENT_SECRET` y los
 *     tres de Twilio. WhatsApp pasó a la API oficial de Meta el 2026-08-27 y
 *     Twilio nunca se conectó. Aparecían como «falta configurar» algo que no
 *     hace falta — ruido que enseña a ignorar el panel.
 *   - **Dieciséis que el código usa y no chequeaba**, entre ellos
 *     `BACKUP_CRON_SECRET`, que desde el 2026-08-28 gatea las 19 tareas
 *     programadas, y `SMTP_PASSWORD`, del que depende todo el correo.
 *
 * ⚠️ Y había **dos listas** que tenían que coincidir: una en la Edge Function
 * y otra en el componente. Es la misma forma de romperse que ya tuvieron el
 * mapa de permisos y el reparto de roles. Ahora la autoridad es una sola —la
 * función, que es la única que puede leer el entorno— y el componente sólo le
 * pone nombre a lo que ella reporta.
 *
 * Esta guarda compara esa lista contra el código y falla cuando divergen.
 */

const FUNCIONES = join(process.cwd(), "supabase", "functions");
const ADMIN = join(FUNCIONES, "platform-admin-action", "index.ts");

/**
 * Variables que el código lee y que **no** son secretos a configurar.
 *
 * ⚠️ Cada una con el motivo: una allowlist sin explicación es cómo la lista
 * anterior llegó a tener Twilio.
 */
const NO_SON_SECRETOS: Record<string, string> = {
  SUPABASE_DB_URL:
    "La usa el runner de SQL local, no las funciones desplegadas. No se " +
    "configura en el entorno de Edge Functions.",
  DENO_DEPLOYMENT_ID:
    "La inyecta Deno Deploy para identificar el despliegue: no es un secreto " +
    "que alguien pueda cargar ni faltar.",
  PUBLIC_APP_URL:
    "Es el origen HTTPS público usado para construir links de documentación; " +
    "tiene un fallback productivo y no contiene ninguna credencial.",
};

/** Los `Deno.env.get("X")` de todas las funciones y sus módulos compartidos. */
function variablesQueElCodigoLee(): Map<string, Set<string>> {
  const uso = new Map<string, Set<string>>();

  const registrar = (archivo: string, etiqueta: string) => {
    if (!existsSync(archivo)) return;
    const src = readFileSync(archivo, "utf8");
    for (const m of src.matchAll(/Deno\.env\.get\("([A-Z0-9_]+)"\)/g)) {
      const set = uso.get(m[1]) ?? new Set<string>();
      set.add(etiqueta);
      uso.set(m[1], set);
    }
  };

  for (const e of readdirSync(FUNCIONES, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (e.name === "_shared") {
      for (const f of readdirSync(join(FUNCIONES, e.name))) {
        registrar(join(FUNCIONES, e.name, f), `_shared/${f}`);
      }
      continue;
    }
    registrar(join(FUNCIONES, e.name, "index.ts"), e.name);
  }
  return uso;
}

/** La lista que la función reporta al panel. */
function listaChequeada(): string[] {
  const src = readFileSync(ADMIN, "utf8");
  const i = src.indexOf("const names = [");
  expect(i, "no se encontró la lista `names` en platform-admin-action").toBeGreaterThan(-1);
  const bloque = src.slice(i, src.indexOf("];", i));
  return [...bloque.matchAll(/"([A-Z0-9_]+)"/g)].map((m) => m[1]);
}

describe("la salud de configuración dice la verdad", () => {
  const usa = variablesQueElCodigoLee();
  const chequea = new Set(listaChequeada());

  it("hay variables y lista para comparar", () => {
    // Si alguna da 0, el detector se rompió y el resto pasa vacío.
    expect(usa.size).toBeGreaterThan(10);
    expect(chequea.size).toBeGreaterThan(10);
  });

  it("no se chequea nada que el código no lea", () => {
    /**
     * ⚠️ Mostrar «falta configurar TWILIO_AUTH_TOKEN» cuando Twilio no se usa
     * es peor que no mostrar nada: enseña al dueño a ignorar el panel, y
     * entonces tampoco ve lo que sí importa.
     */
    const fantasmas = [...chequea].filter((n) => !usa.has(n));

    expect(
      fantasmas,
      `Estos secretos se chequean y ningún Edge Function los lee: ` +
        `${fantasmas.join(", ")}. O son de una integración que se retiró —y hay ` +
        `que sacarlos de la lista— o el código dejó de leerlos sin que nadie ` +
        `actualizara el panel.`,
    ).toEqual([]);
  });

  it("no falta nada que el código sí lea", () => {
    const faltantes = [...usa.keys()]
      .filter((n) => !chequea.has(n) && !(n in NO_SON_SECRETOS));

    expect(
      faltantes,
      `El código lee estos secretos y el panel no los muestra, así que el dueño ` +
        `no tiene forma de saber si están: ${faltantes.map(n => `${n} (${[...usa.get(n)!].slice(0,2).join(", ")})`).join("; ")}. ` +
        `Se agregan a la lista de platform-admin-action, o a NO_SON_SECRETOS ` +
        `con el motivo escrito.`,
    ).toEqual([]);
  });

  it("cada exclusión tiene un motivo escrito", () => {
    for (const [n, motivo] of Object.entries(NO_SON_SECRETOS)) {
      expect(motivo.length, `${n} está excluida sin explicar por qué`)
        .toBeGreaterThan(60);
    }
  });

  it("⚠️ el componente ya no mantiene una segunda lista", () => {
    /**
     * Dos listas que tienen que coincidir es la forma de romperse que ya
     * tuvieron el mapa de permisos y el reparto de roles en este repo. El
     * componente sólo le pone nombre a lo que la función reporta.
     */
    const tab = readFileSync(
      join(process.cwd(), "src", "components", "platform", "SystemHealthTab.tsx"),
      "utf8",
    );
    expect(
      tab.includes("EXPECTED_SECRETS"),
      "volvió a haber una lista de secretos en el componente: la autoridad es la función",
    ).toBe(false);
    expect(tab).toMatch(/Object\.entries\(\s*data\.secrets/);
  });
});
