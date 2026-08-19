import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const leer = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/**
 * Guarda: nada le muestra al comercio un número o una respuesta inventada.
 *
 * ── Qué encontró esta guarda al escribirse ────────────────────────────────
 *
 * `AIChatAdvancedPage` esperaba 1200ms fingiendo pensar, devolvía texto
 * enlatado, y guardaba en `ai_chat_messages.tokens_used` un
 * `Math.random()*500+100`.
 *
 * Lo peor no era la respuesta falsa —se veía, decía "[Respuesta simulada]"—
 * sino **el número**: cualquiera que sumara esa columna para medir el costo de
 * IA leía una cifra fabricada que parecía real. Es la misma familia que el
 * descuento de stock duplicado: un número plausible que nadie mira dos veces.
 *
 * Y el selector de modelo tampoco hacía nada: ofrecía IDs que no existen en la
 * API y no llegaba al backend, que tenía el modelo fijo.
 */

const chat = leer("src/pages/AIChatAdvancedPage.tsx");
const fn = leer("supabase/functions/ai-chat/index.ts");

describe("el chat de IA no simula", () => {
  it("no fabrica el conteo de tokens", () => {
    // La única mención permitida es el comentario que explica qué se sacó.
    const codigo = chat.split("\n").filter(l => !l.trim().startsWith("//") && !l.trim().startsWith("*"));
    expect(codigo.join("\n")).not.toContain("Math.random");
  });

  it("no devuelve una respuesta enlatada", () => {
    expect(chat).not.toContain("Respuesta simulada");
    expect(chat).not.toMatch(/setTimeout\(r,\s*1200\)/);
  });

  it("llama a la Edge Function real y procesa el stream", () => {
    expect(chat).toContain("/functions/v1/ai-chat");
    expect(chat).toContain("resp.body.getReader()");
  });

  it("guarda null cuando la API no informa tokens, no un invento", () => {
    // null significa "no lo sé". Un número significa "esto pasó".
    expect(chat).toContain("let tokens: number | null = null");
    expect(chat).toContain("tokens_used: tokens");
  });

  it("no guarda un mensaje del asistente que nunca existió", () => {
    // Si el stream falla sin texto, la conversación no puede quedar con una
    // respuesta fantasma.
    expect(chat).toMatch(/if \(fallo && !texto\)/);
  });

  it("conserva el resto del buffer entre chunks", () => {
    // Un chunk de red puede cortar un evento por la mitad. Parsear sin
    // conservar el resto perdería texto en silencio.
    expect(chat).toContain("buffer = partes.pop()");
  });
});

describe("el modelo lo valida el servidor", () => {
  it("la función tiene lista blanca y no confía en el navegador", () => {
    // Un string libre desde el cliente es una vía para pedir el modelo más
    // caro que exista, y lo paga la plataforma.
    expect(fn).toContain("const MODELOS: Record<string, string>");
    expect(fn).toContain('?? "claude-sonnet-5"');
  });

  it("informa el uso real de tokens antes de terminar", () => {
    expect(fn).toContain("claudeStream.finalMessage()");
    expect(fn).toContain("input_tokens");
  });

  it("los modelos que ofrece la pantalla son los que el servidor acepta", () => {
    // Antes ofrecía IDs que no existen en la API. Si se desincronizan, elegir
    // un modelo vuelve a no hacer nada.
    for (const m of ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5"]) {
      expect(chat).toContain(m);
      expect(fn).toContain(m);
    }
  });
});

describe("no quedan respuestas simuladas en otras pantallas", () => {
  it("ninguna página de producción devuelve texto marcado como simulado", () => {
    const dirs = ["src/pages", "src/components"];
    const sospechosas: string[] = [];

    const recorrer = (dir: string) => {
      for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) { recorrer(rel); continue; }
        if (!/\.tsx?$/.test(e.name) || e.name.includes(".test.")) continue;
        const src = readFileSync(join(ROOT, rel), "utf8");
        // Se busca la construcción de un texto que se le muestra al usuario
        // diciendo que es simulado, no la palabra suelta en un comentario.
        if (/(simulatedReply|Respuesta simulada|datos de ejemplo generados)/i.test(src)) {
          sospechosas.push(rel);
        }
      }
    };
    for (const d of dirs) recorrer(d);

    expect(sospechosas).toEqual([]);
  });
});
