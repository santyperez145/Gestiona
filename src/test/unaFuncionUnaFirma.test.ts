import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Una función, una firma.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * ⚠️ El 2026-08-28 **contratar un plan abortaba**, y la función que hace que
 * bajar de plan baje los límites de verdad nunca había corrido una sola vez.
 *
 *     ERROR: 42725: function public.avisar_a_los_que_mandan(
 *            uuid, text, text, unknown, unknown, unknown) is not unique
 *
 * Una migración creó la función con 6 parámetros y otra, dos días después, la
 * volvió a declarar con 7 usando `CREATE OR REPLACE`.
 *
 * 📌 **`CREATE OR REPLACE FUNCTION` no puede cambiar una firma: agrega una
 * sobrecarga.** Y como el parámetro nuevo tenía `DEFAULT`, la de 7 también
 * aceptaba 6 argumentos: toda llamada con 6 quedó ambigua.
 *
 * ⚠️ Lo caro es que el efecto no se parece a la causa. Ninguna pantalla dijo
 * «hay dos funciones con el mismo nombre»: dijo que no se pudo contratar el
 * plan. Y el trigger de `subscriptions` abortaba el alta entera.
 *
 * Esta guarda compara las declaraciones entre migraciones y falla cuando una
 * función cambia su cantidad de parámetros sin dropear la versión anterior.
 */

const MIGRACIONES = join(process.cwd(), "supabase", "migrations");

/**
 * Convivencias conocidas, con el motivo escrito.
 *
 * ⚠️ Una entrada acá no es «esto está bien»: es «esto se midió y se decidió
 * cuándo arreglarlo». Agregar una es una decisión que hay que poder defender.
 */
const CONVIVEN: Record<string, string> = {
  cuenta_de_cobro:
    "No son una vieja y una nueva: son dos diseños distintos que chocaron de " +
    "nombre. La de 1 argumento (POS) devuelve NULL ante un método desconocido " +
    "para que el llamador deje rastro, y normaliza mayúsculas y espacios. La " +
    "de 2 (ventas) tiene fallback a Caja y agrega que una venta no cobrada es " +
    "un crédito. Como no tienen DEFAULT, no hay ambigüedad 42725: cada llamada " +
    "resuelve por cantidad de argumentos. Lo que sí falta es unificarlas, y " +
    "eso toca el libro mayor. Medido el 2026-08-28: 0 ventas sin cobrar y 0 " +
    "ventas con source='pos', así que la divergencia es latente y " +
    "audit_resultado_divergente sigue en 0. Va como slice propio con su " +
    "verificación, no colgado de otro commit.",
};

interface Declaracion {
  nombre: string;
  params: number;
  archivo: string;
}

/** Cuenta los parámetros de una lista, ignorando comas dentro de paréntesis. */
function contarParametros(lista: string): number {
  const limpia = lista.trim();
  if (!limpia) return 0;
  let n = 1, prof = 0;
  for (const c of limpia) {
    if (c === "(" || c === "[") prof++;
    else if (c === ")" || c === "]") prof--;
    else if (c === "," && prof === 0) n++;
  }
  return n;
}

function declaraciones(): Declaracion[] {
  const salida: Declaracion[] = [];

  for (const archivo of readdirSync(MIGRACIONES).filter(f => f.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(MIGRACIONES, archivo), "utf8");

    const re = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?(\w+)\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      // Recortar hasta el paréntesis que cierra la lista de parámetros.
      let i = m.index + m[0].length - 1, prof = 0, fin = -1;
      for (; i < sql.length; i++) {
        if (sql[i] === "(") prof++;
        else if (sql[i] === ")") { prof--; if (prof === 0) { fin = i; break; } }
      }
      if (fin < 0) continue;
      const lista = sql.slice(m.index + m[0].length, fin);
      salida.push({ nombre: m[1], params: contarParametros(lista), archivo });
    }
  }
  return salida;
}

/** ¿Alguna migración dropea explícitamente esa función? */
function seDropea(nombre: string): boolean {
  return readdirSync(MIGRACIONES)
    .filter(f => f.endsWith(".sql"))
    .some(f => new RegExp(
      `DROP\\s+FUNCTION\\s+(?:IF\\s+EXISTS\\s+)?(?:public\\.)?${nombre}\\s*\\(`, "i",
    ).test(readFileSync(join(MIGRACIONES, f), "utf8")));
}

describe("una función, una firma", () => {
  const todas = declaraciones();

  it("hay declaraciones para revisar", () => {
    // Si esto da poco, el parser se rompió y el test pasaría vacío.
    expect(todas.length).toBeGreaterThan(200);
  });

  it("ninguna función cambia su cantidad de parámetros sin dropear la anterior", () => {
    const porNombre = new Map<string, Declaracion[]>();
    for (const d of todas) {
      const previas = porNombre.get(d.nombre) ?? [];
      previas.push(d);
      porNombre.set(d.nombre, previas);
    }

    const ambiguas: string[] = [];

    for (const [nombre, decls] of porNombre) {
      const aridades = [...new Set(decls.map(d => d.params))];
      if (aridades.length < 2) continue;
      if (seDropea(nombre)) continue;
      if (nombre in CONVIVEN) continue;

      const donde = decls
        .map(d => `${d.params} params en ${d.archivo}`)
        .filter((v, i, a) => a.indexOf(v) === i);
      ambiguas.push(`${nombre}: ${donde.join(" · ")}`);
    }

    expect(
      ambiguas,
      `Estas funciones se declaran con distinta cantidad de parámetros en más ` +
        `de una migración. CREATE OR REPLACE no cambia una firma: crea una ` +
        `sobrecarga, y si el parámetro nuevo tiene DEFAULT toda llamada con la ` +
        `cantidad vieja queda ambigua (42725). Ya rompió el alta de ` +
        `suscripciones y la aplicación de límites del plan. Se arregla con un ` +
        `DROP FUNCTION explícito de la versión anterior:\n\n  ` +
        ambiguas.join("\n  ") + "\n",
    ).toEqual([]);
  });

  it("cada convivencia tiene un motivo escrito, no un nombre suelto", () => {
    for (const [nombre, motivo] of Object.entries(CONVIVEN)) {
      expect(motivo.length, `${nombre} convive sin explicar por qué`)
        .toBeGreaterThan(150);
    }
  });

  it("la lista de convivencias no crece sin que nadie lo note", () => {
    /**
     * 📌 Un tope explícito. Si mañana hay tres funciones conviviendo, la
     * pregunta no es «agrego otra entrada» sino «por qué esto pasa seguido».
     */
    expect(
      Object.keys(CONVIVEN).length,
      "hay más funciones conviviendo de las que se decidieron a conciencia",
    ).toBeLessThanOrEqual(1);
  });
});
