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
    "nombre, y cada llamador usa el correcto. La de 1 argumento (POS) es un " +
    "mapa puro método→cuenta que devuelve NULL ante un método desconocido para " +
    "que el llamador deje rastro, y normaliza mayúsculas y espacios. La de 2 " +
    "(ventas) trae la regla de no-cobrado adentro y cae a Caja ante lo " +
    "desconocido. Como ninguna tiene DEFAULT, no hay ambigüedad 42725: cada " +
    "llamada resuelve por cantidad de argumentos. " +
    "⚠️ CORRECCIÓN de lo que este comentario decía antes: NO hay una " +
    "divergencia contable. Se afirmó que una venta fiada del mostrador " +
    "entraría a Caja como cobrada, y es falso — `ledger_asentar_venta_pos` " +
    "resuelve el no-cobrado ANTES de llamar a cuenta_de_cobro, con un " +
    "`IF v_r.paid IS FALSE OR v_r.payment_method = 'fiado' THEN ... 1.2.01 " +
    "... CONTINUE`, y su propio comentario explica por qué («fiado NO es " +
    "caja»). O sea que el POS aplica la misma regla, más arriba y más " +
    "explícita. Lo que queda es duplicación de nombre, no de criterio: " +
    "unificarlas tocaría el libro mayor sin ganar correctitud, así que no se " +
    "toca. Medido el 2026-08-28: 0 ventas sin cobrar y " +
    "audit_resultado_divergente en 0.",
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
    // Los comentarios de una firma pueden contener listas o ejemplos. Sus
    // comas y paréntesis no forman parte de la aridad de PostgreSQL.
    const sql = readFileSync(join(MIGRACIONES, archivo), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/--.*$/gm, "");

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

/**
 * Funciones que alguna migración dropea explícitamente.
 *
 * ⚠️ Antes `seDropea` releía las ~300 migraciones por cada nombre ambiguo. El
 * resultado era correcto, pero bajo la suite paralela tardaba 13–20 s y vencía
 * el timeout de 5 s; aislado tardaba 2 s. Se indexa una vez sin cambiar qué se
 * considera un DROP válido.
 */
function funcionesDropeadas(): Set<string> {
  const resultado = new Set<string>();
  const patron = /DROP\s+FUNCTION\s+(?:IF\s+EXISTS\s+)?(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi;
  for (const archivo of readdirSync(MIGRACIONES).filter(f => f.endsWith('.sql'))) {
    const sql = readFileSync(join(MIGRACIONES, archivo), 'utf8');
    for (const match of sql.matchAll(patron)) resultado.add(match[1].toLowerCase());
  }
  return resultado;
}

const DROPEADAS = funcionesDropeadas();
const seDropea = (nombre: string): boolean => DROPEADAS.has(nombre.toLowerCase());

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
