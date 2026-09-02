import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * El navegador no debe pedir confirmación: ConfirmDialog / useConfirmDialog sí.
 * Un `confirm(` suelto vuelve el UX al chrome nativo y rompe el estándar.
 */

const ROOT = join(process.cwd(), "src");
const ALLOW: string[] = [
  // Ninguno: todo confirm nativo está prohibido en UI.
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "dist") continue;
      walk(full, out);
      continue;
    }
    if (!/\.(tsx|ts|jsx|js)$/.test(name)) continue;
    if (/\.test\.(tsx|ts|jsx|js)$/.test(name)) continue;
    out.push(full);
  }
  return out;
}

const NATIVE = /\bwindow\.confirm\s*\(|(?<![\w.])confirm\s*\(/g;

describe("sin confirm del navegador", () => {
  it("ningún archivo de UI llama confirm() o window.confirm()", () => {
    const hits: string[] = [];
    for (const file of walk(ROOT)) {
      const rel = relative(process.cwd(), file).replace(/\\/g, "/");
      if (ALLOW.includes(rel)) continue;
      const text = readFileSync(file, "utf8");
      // Ignorar strings en comentarios de XSS / docs dentro del archivo
      // sólo cuando la línea NO es una llamada real.
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
        if (!NATIVE.test(line)) {
          NATIVE.lastIndex = 0;
          return;
        }
        NATIVE.lastIndex = 0;
        // javascript:alert en strings de validación no cuenta
        if (/javascript:\s*alert/i.test(line)) return;
        if (/destinoOAuthPermitido|esUrlSegura|validarLink|isInternalAnnouncementPath/.test(line)) return;
        hits.push(`${rel}:${i + 1}: ${trimmed.slice(0, 120)}`);
      });
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("el primitivo propio existe y el hook lo usa", () => {
    const dialog = readFileSync(join(ROOT, "components/shared/ConfirmDialog.tsx"), "utf8");
    const hook = readFileSync(join(ROOT, "hooks/useConfirmDialog.tsx"), "utf8");
    expect(dialog).toContain("AlertDialog");
    expect(hook).toContain("ConfirmDialog");
    expect(hook).toContain("ask");
  });
});
