import { describe, it, expect } from "vitest";
import fs from "node:fs";

// PostgREST corta cada consulta en 1.000 filas sin avisar. El respaldo
// descartó semanas de copias por eso (2026-10-13). Ventas, compras y gastos
// alimentan los totales del Dashboard: tienen que llegar completos.
const s = fs.readFileSync("src/lib/supabaseStore.ts", "utf8");

function cuerpo(nombre: string) {
  const i = s.indexOf(`export async function ${nombre}(`);
  return s.slice(i, s.indexOf("\n}\n", i));
}

describe("los cargadores de ventas, compras y gastos traen todas las filas", () => {
  for (const [fn, tabla] of [["getSalesDB", "sales"], ["getPurchasesDB", "purchases"], ["getExpensesDB", "expenses"]]) {
    it(`${fn} pagina en vez de un select suelto`, () => {
      const c = cuerpo(fn);
      expect(c).toContain(`selectOrgRowsByDate('${tabla}', orgId)`);
      expect(c).not.toMatch(/\.select\('\*'\)/);
    });
  }

  it("el cargador pagina por id y devuelve de la más nueva a la más vieja", () => {
    const c = s.slice(s.indexOf("async function selectOrgRowsByDate("), s.indexOf("// ========= PURCHASES ========="));
    expect(c).toContain("selectAllRows");
    expect(c).toContain(".order('id')");
    expect(c).toMatch(/localeCompare/);
  });
});
