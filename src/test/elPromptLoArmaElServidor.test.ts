import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * El prompt lo arma el servidor. El navegador manda intención y datos.
 *
 * ── Por qué ───────────────────────────────────────────────────────────────
 *
 * `AIProactiveWidget` llamaba a `ai-analysis` con `type: "predict_sales"` y le
 * adjuntaba un campo `instructions` de primer nivel con su propio pedido:
 * «Dame 4 sugerencias concretas y breves». La función leía `{ type, data }` y
 * nada más, así que ese texto **se descartaba en silencio**: armaba el informe
 * de cinco secciones de `predict_sales`, el widget le pasaba `parseBullets`
 * —que corta en la quinta línea— y el Dashboard mostraba el arranque de
 * «📈 PREDICCIÓN» cortado a mitad de idea, rotulado «Sugerencias IA».
 * No fallaba, no avisaba. Medido el 2026-08-27: se descartaban tres campos,
 * `instructions`, `data.expenses` y `data.kpis`.
 *
 * 📌 Se arregló creando `daily_pulse`, un tipo que arma el servidor — **no**
 * haciendo llegar `instructions` al prompt. Un texto libre del cliente metido
 * en el system/user convierte una función de análisis de negocio en un LLM de
 * propósito general pagado con `ANTHROPIC_API_KEY`, y la anon key va en el
 * bundle: cualquiera con sesión podría dictarle el prompt y pisar el
 * guardrail. Es la misma regla que precios y stock — el cliente manda ids e
 * intención, el servidor decide.
 *
 * ⚠️ Y es un bug que vuelve solo, porque mandar el texto desde la pantalla es
 * lo cómodo: no hay que deployar la función. Por eso el test y no una nota.
 */
describe("el prompt lo arma el servidor", () => {
  const ROOT = resolve(__dirname, "../..");

  /** Funciones que gastan crédito de Anthropic armando un prompt. */
  const FUNCIONES_IA = [
    "generate-description",
    "generate-social-copy",
    "ai-analysis",
    "predict-sales",
    "extract-invoice",
    "ai-deal-coach",
  ];

  /**
   * Nombres que significan «acá va texto que termina dentro del prompt».
   *
   * 📌 `message` / `messages` quedan afuera a propósito: son el contenido de
   * una conversación, que es de la persona por definición. La diferencia es
   * que un mensaje es **dato** que el prompt del servidor enmarca, y una
   * instrucción es el prompt mismo. `ai-chat` va por `fetch` (SSE) y por eso
   * tampoco entra en la lista de arriba.
   */
  const CAMPOS_DE_PROMPT = [
    "instructions",
    "instruction",
    "prompt",
    "prompts",
    "systemPrompt",
    "system_prompt",
    "userPrompt",
    "user_prompt",
    "system",
    "extraPrompt",
  ];

  /** El texto de la llamada, desde el nombre de la función hasta su `)`. */
  function textoDeLaLlamada(src: string, fn: string): string | null {
    const marca = new RegExp(`(?:llamarIA|functions\\.invoke)\\(\\s*["']${fn}["']`);
    const m = marca.exec(src);
    if (!m) return null;
    let nivel = 0;
    for (let i = src.indexOf("(", m.index); i < src.length; i++) {
      if (src[i] === "(") nivel++;
      else if (src[i] === ")" && --nivel === 0) return src.slice(m.index, i + 1);
    }
    return null;
  }

  function pantallasQueLlamanIA(): string[] {
    const encontrados: string[] = [];
    const recorrer = (dir: string) => {
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        const p = resolve(dir, d.name);
        if (d.isDirectory()) { recorrer(p); continue; }
        if (!d.name.endsWith(".tsx") && !d.name.endsWith(".ts")) continue;
        encontrados.push(p);
      }
    };
    for (const raiz of ["src/components", "src/pages"]) recorrer(resolve(ROOT, raiz));
    return encontrados;
  }

  it("ninguna pantalla le dicta el prompt a una función de IA", () => {
    const culpables: string[] = [];

    for (const p of pantallasQueLlamanIA()) {
      const src = readFileSync(p, "utf8");
      for (const fn of FUNCIONES_IA) {
        const llamada = textoDeLaLlamada(src, fn);
        if (!llamada) continue;
        for (const campo of CAMPOS_DE_PROMPT) {
          if (new RegExp(`\\b${campo}\\s*:`).test(llamada)) {
            culpables.push(`${p.replace(ROOT, "").replace(/\\/g, "/")} → ${fn} manda \`${campo}\``);
          }
        }
      }
    }

    expect(
      culpables,
      `el prompt de una función de IA no se manda desde el navegador: ${culpables.join(", ")}. ` +
      "Si hace falta otra salida, se agrega un `type` a PROMPTS en la Edge Function " +
      "(como `daily_pulse`), que es texto del servidor y no se puede pisar desde el cliente.",
    ).toEqual([]);
  });

  it("cada `type` que pide el navegador existe en la función", () => {
    /**
     * ⚠️ La mitad espejo: si el cliente pide un `type` que no está en
     * `PROMPTS`, la función corta con «Invalid analysis type» — un 500 que la
     * pantalla muestra como «Error al analizar». Falla fuerte, pero falla, y
     * este test lo agarra antes del deploy.
     */
    const fuente = readFileSync(
      resolve(ROOT, "supabase/functions/ai-analysis/index.ts"), "utf8",
    );
    const mapa = fuente.slice(fuente.indexOf("const PROMPTS"), fuente.indexOf("\nserve("));
    const tipos = new Set([...mapa.matchAll(/^ {2}(\w+): \(data\) =>/gm)].map(m => m[1]));

    expect(tipos.size, "no se pudo leer PROMPTS de ai-analysis").toBeGreaterThan(0);
    expect(tipos.has("daily_pulse"), "falta `daily_pulse`, el pulso del Dashboard").toBe(true);

    const pedidos: string[] = [];
    for (const p of pantallasQueLlamanIA()) {
      const llamada = textoDeLaLlamada(readFileSync(p, "utf8"), "ai-analysis");
      if (!llamada) continue;
      for (const m of llamada.matchAll(/\btype:\s*["'](\w+)["']/g)) {
        if (!tipos.has(m[1])) {
          pedidos.push(`${p.replace(ROOT, "").replace(/\\/g, "/")} pide "${m[1]}"`);
        }
      }
    }

    expect(
      pedidos,
      `estos \`type\` no existen en PROMPTS (${[...tipos].join(", ")}): ${pedidos.join(", ")}`,
    ).toEqual([]);
  });
});
