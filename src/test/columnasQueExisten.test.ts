import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, sep } from "node:path";

const ROOT = resolve(__dirname, "../..");
const leer = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const TYPES = leer("src/integrations/supabase/types.ts");

/**
 * Las columnas de una tabla o vista, según los tipos generados por Supabase.
 *
 * `types.ts` se regenera desde la base con `gen types`, así que es el esquema
 * real y no una copia a mano. Devuelve `null` para lo que no está: puede ser
 * un RPC, una tabla nueva sin regenerar tipos, o una vista de otro schema, y
 * en esos casos este test no tiene nada que decir.
 */
const CACHE = new Map<string, Set<string> | null>();
function columnasDe(rel: string): Set<string> | null {
  if (CACHE.has(rel)) return CACHE.get(rel)!;
  const marca = `      ${rel}: {\n        Row: {\n`;
  const i = TYPES.indexOf(marca);
  if (i === -1) { CACHE.set(rel, null); return null; }
  const cuerpo = TYPES.slice(i + marca.length, TYPES.indexOf("\n        }", i));
  const cols = new Set(
    cuerpo.split("\n")
      .map(l => /^([a-z_0-9]+)\??:/.exec(l.trim())?.[1])
      .filter(Boolean) as string[],
  );
  CACHE.set(rel, cols);
  return cols;
}

function archivosFuente(dir = "src"): string[] {
  const salida: string[] = [];
  for (const entrada of readdirSync(resolve(ROOT, dir))) {
    const rel = join(dir, entrada);
    const abs = resolve(ROOT, rel);
    if (statSync(abs).isDirectory()) {
      if (entrada === "test" || entrada === "node_modules") continue;
      salida.push(...archivosFuente(rel));
    } else if (/\.tsx?$/.test(entrada) && entrada !== "types.ts") {
      salida.push(rel.split(sep).join("/"));
    }
  }
  return salida;
}

interface Pedido { archivo: string; rel: string; columna: string }

/**
 * Cada `.from("tabla")….select("a,b,c")` con lista simple de columnas.
 *
 * Se saltean los que traen paréntesis (joins embebidos) o `*`: ahí la sintaxis
 * de PostgREST se vuelve un lenguaje propio y verificarla a medias daría
 * falsos positivos, que es peor que no verificar.
 */
function columnasPedidas(): Pedido[] {
  // Las dos comillas: `supabaseStore.ts` y varios helpers usan simples, y
  // mirar solo las dobles dejaba 66 selects sin revisar — ahi vivia un bug.
  const re = /\.from\(\s*['"]([a-z_0-9]+)['"][^)]*\)\s*(?:as never\s*)?\.select\(\s*['"]([^'"]+)['"]/gs;
  const salida: Pedido[] = [];
  for (const archivo of archivosFuente()) {
    const src = leer(archivo);
    for (const m of src.matchAll(re)) {
      const [, rel, lista] = m;
      if (lista.includes("(") || lista.includes("*")) continue;
      for (let col of lista.split(",")) {
        col = col.trim();
        // PostgREST permite alias: `nombre_js:columna_real`. Lo que tiene que
        // existir es lo de la derecha.
        if (col.includes(":")) col = col.split(":", 2)[1].trim();
        if (col) salida.push({ archivo, rel, columna: col });
      }
    }
  }
  return salida;
}

/**
 * ⚠️ Por qué existe este test, con el caso que lo originó.
 *
 * La tab de Presupuestos de la ficha 360 pedía `quotes.total_ars`. Esa columna
 * **no existe** — se llama `total`. PostgREST devolvía 400, el `catch` lo
 * convertía en un toast sin loguear nada, y la tab **nunca cargó, para ningún
 * cliente**.
 *
 * Nada lo detectaba: compilaba, pasaba el lint y los 1.655 tests. Se encontró
 * abriendo la pantalla en producción con una sesión real el 2026-08-26.
 *
 * Al buscar el resto aparecieron **16 en 9 archivos**, todas confirmadas contra
 * la base, entre ellas `wallet_movimientos.saldo` en la página del libro mayor
 * y `profiles.email` en comisiones — que dejaba a **todos** los vendedores sin
 * nombre.
 *
 * ⚠️ La número 16 la escondía este mismo test: su regex miraba sólo comillas
 * dobles, y `supabaseStore.ts` y varios helpers usan simples. Eran **66 selects
 * sin revisar**, y ahí estaba `payment_connection_status.connected` en
 * `paymentStatus.ts` — el estado de cobro decía siempre «sin conectar» con la
 * cuenta vinculada. Una guarda que mira de menos es peor que ninguna, porque
 * da tranquilidad.
 *
 * `types.ts` tiene el esquema de verdad, así que una columna inventada se
 * atrapa sin base de datos y sin navegador.
 */
describe("ningún select pide una columna que no existe", () => {
  it("el escaneo encuentra selects de verdad", () => {
    // Si el regex deja de matchear, el test pasaría vacío sin probar nada.
    expect(columnasPedidas().length).toBeGreaterThan(250);
  });

  it("todas las columnas pedidas existen en su relación", () => {
    const rotos = columnasPedidas()
      .filter(p => {
        const reales = columnasDe(p.rel);
        return reales !== null && !reales.has(p.columna);
      })
      .map(p => `${p.archivo} → ${p.rel}.${p.columna}`);
    expect([...new Set(rotos)].sort()).toEqual([]);
  });
});

describe("los casos concretos que se encontraron", () => {
  it("quotes tiene `total`, no `total_ars`", () => {
    expect(columnasDe("quotes")?.has("total")).toBe(true);
    expect(columnasDe("quotes")?.has("total_ars")).toBe(false);
  });

  it("profiles no tiene email: vive en auth.users", () => {
    expect(columnasDe("profiles")?.has("email")).toBe(false);
    expect(columnasDe("profiles")?.has("display_name")).toBe(true);
  });

  it("wallet_movimientos no tiene un saldo acumulado", () => {
    // El saldo lo deriva la base con el RPC `wallet_saldo`.
    expect(columnasDe("wallet_movimientos")?.has("saldo")).toBe(false);
    expect(columnasDe("wallet_movimientos")?.has("monto")).toBe(true);
  });

  it("deals tiene value_ars y customer_id", () => {
    expect(columnasDe("deals")?.has("value_ars")).toBe(true);
    expect(columnasDe("deals")?.has("customer_id")).toBe(true);
  });
});

describe("el saldo de la billetera tiene una sola autoridad", () => {
  it("el libro mayor lo pide por el mismo RPC que la billetera", () => {
    // Dos pantallas mostrando el mismo número desde fuentes distintas es cómo
    // se llega a dos verdades. `WalletPage` ya usaba el RPC; `LibroPage` leía
    // una columna inexistente y mostraba siempre "Sin movimientos".
    expect(leer("src/pages/LibroPage.tsx")).toContain('rpc("wallet_saldo"');
    expect(leer("src/pages/WalletPage.tsx")).toContain('rpc("wallet_saldo"');
  });

  it("y lo interpreta con el mismo parser, no con uno propio", () => {
    // ⚠️ El primer arreglo cambió la columna inexistente por un parser a mano
    // que buscaba `saldo_disponible` o `saldo`. El RPC devuelve
    // `{total, moneda, en_retiro, pendiente, retirable, disponible}`: ninguna
    // de las dos. El síntoma seguía siendo "Sin movimientos" siempre, ahora
    // por otra causa. `leerSaldo` ya existía y estaba testeado.
    // Sólo el código: el comentario que explica el error lo nombra, y buscarlo
    // en todo el archivo hace fallar al test contra su propia documentación.
    // Ya pasó cuatro veces en esta sesión.
    const libro = leer("src/pages/LibroPage.tsx");
    // Se busca el ACCESO a la propiedad, no la palabra: el comentario que
    // explica el error la nombra, y buscarla suelta hace fallar al test
    // contra su propia documentacion. Ya paso cuatro veces en esta sesion.
    expect(libro).toContain("leerSaldo(data)");
    expect(libro).not.toMatch(/\.saldo_disponible/);
  });

  it("las claves que el parser lee son las que el RPC devuelve", () => {
    // Medido contra la base el 2026-08-26.
    const wallet = leer("src/lib/wallet.ts");
    for (const clave of ["pendiente", "disponible", "en_retiro", "retirable", "total"]) {
      expect(wallet).toContain(`n("${clave}")`);
    }
  });
});

describe("un error de carga deja rastro", () => {
  const clientes = leer("src/pages/CustomersPage.tsx");

  it("las tabs de la ficha loguean además del toast", () => {
    // Un toast sin log no se puede diagnosticar: así vivió el bug de
    // `total_ars` hasta que alguien abrió la pantalla.
    expect(clientes).toContain('console.error("CustomerQuotesTab:", e)');
    expect(clientes).toContain('console.error("CustomerDealsTab:", e)');
  });

  it("el libro mayor no se traga el error del saldo", () => {
    expect(leer("src/pages/LibroPage.tsx")).toContain('console.error("LibroPage / wallet_saldo:", error)');
  });
});
