import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * La IA se mide y tiene techo.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * ⚠️ Medido el 2026-08-28: `ai_usage_stats` existía desde hacía meses con la
 * forma correcta y **0 filas**. Ocho Edge Functions quemaban
 * `ANTHROPIC_API_KEY` y ninguna registraba una sola acción. El plan decidía la
 * IA con un booleano, así que una organización con `ia=true` podía gastar sin
 * techo y nadie sabía cuánto costaba.
 *
 * 📌 Para un producto que se va a vender, un costo por cliente sin techo ni
 * medición no es un detalle técnico: es la pregunta que hace cualquiera que
 * mire los números.
 *
 * Esta guarda falla si una función nueva que llama a Anthropic no registra su
 * consumo, o si alguien vuelve a tratar «sin tope» y «sin cupo» como lo mismo.
 */

const FUNCIONES = join(process.cwd(), "supabase", "functions");

/**
 * Funciones que llaman a Anthropic y NO registran, con el motivo escrito.
 *
 * ⚠️ La lista es corta a propósito. Agregar una entrada es una decisión que
 * hay que poder defender, no una forma de que el test pase.
 */
const SIN_REGISTRO: Record<string, string> = {
  "extract-finance-document":
    "Finance es un producto aparte (ADR 001) con su propio gate — " +
    "`finance_document_can`, no `org_entitlements`. Registrar su consumo acá " +
    "le gastaría al comercio el cupo del workspace por usar otro producto. " +
    "Separar los dos cupos exige una columna en `ai_usage_stats` y hoy sería " +
    "especulativo: medido el 2026-08-28, `finance_documents` tiene 0 filas. " +
    "Cuando Finance se use de verdad, se separa el cupo — no se registra acá.",
};

function funcionesQueLlamanAAnthropic(): string[] {
  return readdirSync(FUNCIONES, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => e.name)
    .filter((nombre) => {
      const archivo = join(FUNCIONES, nombre, "index.ts");
      if (!existsSync(archivo)) return false;
      const src = sinComentarios(readFileSync(archivo, "utf8"));
      /**
       * ⚠️ Buscar el nombre del secreto no alcanza: `platform-admin-action`
       * lo **enumera** en un chequeo de salud —junto a RESEND_API_KEY y
       * FROM_EMAIL— y no llama a Anthropic. Con esa versión el test marcaba
       * una función que no gasta un centavo, y la salida obvia habría sido
       * exceptuarla: una entrada en la allowlist para tapar un detector roto.
       *
       * Lo que gasta crédito es la **llamada**, así que eso es lo que se busca.
       */
      return /messages\.(create|stream)\s*\(/.test(src)
        || src.includes("api.anthropic.com");
    });
}

/** El cuerpo sin comentarios: un `registrarConsumoIA` citado no registra nada. */
function sinComentarios(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

describe("la IA se mide", () => {
  const funciones = funcionesQueLlamanAAnthropic();

  it("hay funciones de IA que revisar", () => {
    // Si esto da 0, el detector se rompió y el resto pasaría vacío.
    expect(funciones.length).toBeGreaterThan(5);
  });

  it("toda función que gasta crédito de Anthropic registra su consumo", () => {
    const mudas: string[] = [];

    for (const nombre of funciones) {
      if (nombre in SIN_REGISTRO) continue;
      const src = sinComentarios(
        readFileSync(join(FUNCIONES, nombre, "index.ts"), "utf8"),
      );
      // La llamada de verdad, no el import.
      if (!/registrarConsumoIA\s*\(/.test(src)) mudas.push(nombre);
    }

    expect(
      mudas,
      `Estas funciones queman crédito de Anthropic sin registrar una sola ` +
        `acción, así que el cupo del comercio nunca se gasta y el costo no se ` +
        `mide: ${mudas.join(", ")}. Se arregla llamando a registrarConsumoIA ` +
        `DESPUÉS de que el proveedor contestó, o agregando la función a ` +
        `SIN_REGISTRO con el motivo escrito.`,
    ).toEqual([]);
  });

  it("cada excepción tiene un motivo escrito, no un nombre suelto", () => {
    for (const [nombre, motivo] of Object.entries(SIN_REGISTRO)) {
      expect(motivo.length, `${nombre} está exceptuada sin explicar por qué`)
        .toBeGreaterThan(80);
    }
  });

  it("se registra contra la MISMA organización que pasó el gate", () => {
    /**
     * ⚠️ `registrarConsumoIA` escribe con `service_role`, así que no hay RLS
     * que lo frene: si una función registrara contra un `org_id` distinto del
     * que validó `exigirBeneficio`, podría gastarle el cupo a otro comercio.
     *
     * 📌 El gate ya comprueba la membresía con el JWT real. Lo que esta guarda
     * exige es que la organización sea **la misma expresión**, no una parecida
     * — que es como `ai-deal-coach` casi queda registrando contra un `orgId`
     * de otro alcance que ni siquiera existía ahí.
     */
    for (const nombre of funciones) {
      if (nombre in SIN_REGISTRO) continue;
      const src = sinComentarios(
        readFileSync(join(FUNCIONES, nombre, "index.ts"), "utf8"),
      );

      const gate = src.match(/exigirBeneficio\(\s*req\s*,\s*([^,]+?)\s*,\s*"ia"/);
      const reg = src.match(/registrarConsumoIA\(\{\s*(?:\/\/[^\n]*\n\s*)?orgId(\s*:\s*([^,\n]+?))?\s*[,\n]/);
      if (!gate || !reg) continue;

      // `orgId,` en taquigrafía significa la variable `orgId`.
      const delRegistro = (reg[2] ?? "orgId").trim();
      expect(
        delRegistro,
        `${nombre} pide el plan con «${gate[1]}» y registra el consumo contra ` +
          `«${delRegistro}»: son distintos, así que el cupo se le gasta a otra ` +
          `organización`,
      ).toBe(gate[1].trim());
    }
  });

  it("el registro va después de la respuesta, nunca antes", () => {
    // ⚠️ Registrar antes de que el proveedor conteste le cobra al comercio una
    // acción que falló — y el cupo es lo que decide si puede seguir trabajando.
    for (const nombre of funciones) {
      if (nombre in SIN_REGISTRO) continue;
      const src = sinComentarios(
        readFileSync(join(FUNCIONES, nombre, "index.ts"), "utf8"),
      );
      const registro = src.search(/registrarConsumoIA\s*\(/);
      const llamada = src.search(/messages\.(create|stream)\s*\(/);
      if (registro < 0 || llamada < 0) continue;
      expect(
        registro,
        `${nombre} registra el consumo antes de llamar a Claude: le cobraría ` +
          `al comercio una acción que todavía puede fallar`,
      ).toBeGreaterThan(llamada);
    }
  });
});

describe("sin tope no es sin cupo", () => {
  const gate = readFileSync(join(FUNCIONES, "_shared", "entitlements.ts"), "utf8");

  it("el cupo se compara contra null explícitamente", () => {
    /**
     * ⚠️ `if (!e.ia_restante)` trata `null` y `0` como lo mismo, y son
     * opuestos: `null` es sin tope —el plan Business— y `0` es sin cupo. Con
     * esa comparación, el plan que más paga sería el único que no puede usar
     * la IA.
     */
    const cuerpo = sinComentarios(gate);
    expect(
      cuerpo,
      "el corte por cupo tiene que distinguir null (sin tope) de 0 (sin cupo)",
    ).toMatch(/ia_restante\s*!==\s*null/);
    expect(
      /if\s*\(\s*!\s*e?\.?ia_restante\s*\)/.test(cuerpo),
      "hay un `!ia_restante`, que deja al plan Business sin IA",
    ).toBe(false);
  });

  it("el registro no lanza: la contabilidad no puede tumbar la respuesta", () => {
    const bloque = gate.slice(gate.indexOf("export async function registrarConsumoIA"));
    expect(bloque).toMatch(/catch/);
    // Y deja rastro: un catch mudo es cómo estos bugs se vuelven invisibles.
    expect(bloque).toMatch(/console\.error/);
  });

  it("el registro mira el .error del rpc", () => {
    /**
     * ⚠️ Un `supabase.rpc()` sin mirar `.error` convierte «no se guardó» en
     * «listo». Ya pasó con `afip_marcar_delegacion`: toda la cadena funcionaba
     * y el último paso fallaba en silencio. Si el consumo no se registra, el
     * cupo no se gasta nunca.
     */
    const bloque = sinComentarios(
      gate.slice(gate.indexOf("export async function registrarConsumoIA")),
    );
    expect(bloque).toMatch(/const\s*\{\s*error\s*\}\s*=\s*await\s+admin\.rpc/);
  });
});
