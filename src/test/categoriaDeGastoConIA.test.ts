import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Categoría de gasto con IA (2026-11-05). La función existía pero nadie la
 * llamaba, y con `expense_id` actualizaba el gasto con la llave de servicio
 * filtrando sólo por id: cualquier usuario con plan de IA podía cambiar gastos
 * de otro negocio. Ahora sólo sugiere, entre las categorías del negocio, y el
 * formulario de Gastos la usa cuando las palabras clave no alcanzan.
 */
const funcion = readFileSync("supabase/functions/finance-auto-categorize/index.ts", "utf8");
const pagina = readFileSync("src/pages/ExpensesPage.tsx", "utf8");

describe("sugerencia de categoría de gasto con IA", () => {
  it("la función no escribe en la base ni usa la llave de servicio", () => {
    expect(funcion).not.toMatch(/SERVICE_ROLE/);
    expect(funcion).not.toMatch(/\.update\(|\.insert\(|\.from\(/);
  });

  it("la respuesta queda restringida a las categorías del negocio", () => {
    expect(funcion).toContain("enum: [...valores, null]");
    expect(funcion).toContain("valores.includes(parsed.categoria)");
    expect(funcion).toContain('type: "json_schema"');
  });

  it("usa el Haiku vigente sin parámetros de muestreo", () => {
    expect(funcion).toContain('model: "claude-haiku-5-5"');
    expect(funcion).not.toMatch(/temperature|top_p|top_k/);
    expect(funcion).toContain('stop_reason === "refusal"');
  });

  it("Gastos la consulta sólo con plan de IA y una vez por descripción", () => {
    expect(pagina).toContain("supabase.functions.invoke('finance-auto-categorize'");
    expect(pagina).toMatch(/!canUseAI \|\| !activeOrg\?\.id/);
    expect(pagina).toContain("consultadasIA.current.has(clave)");
    expect(pagina).toContain("{sugeridaPorIA ? 'IA sugiere' : 'Sugerido'}");
  });
});
