import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("las funciones leen deudas con sus columnas reales", () => {
  it("ninguna función filtra debts por `paid` ni lee `amount` (no existen: status y remaining_ars)", () => {
    const dir = resolve(process.cwd(), "supabase/functions");
    const malas: string[] = [];
    for (const fn of readdirSync(dir)) {
      let src = "";
      try { src = readFileSync(join(dir, fn, "index.ts"), "utf8"); } catch { continue; }
      for (const m of src.matchAll(/from\(["']debts["']\)[\s\S]{0,300}?;/g)) {
        if (/\.eq\(["']paid["']/.test(m[0]) || /select\(["'][^"']*\bamount\b/.test(m[0])) malas.push(fn);
      }
    }
    expect(malas).toEqual([]);
  });

  it("check-alerts usa status y remaining_ars y no se calla el error", () => {
    const src = readFileSync(resolve(process.cwd(), "supabase/functions/check-alerts/index.ts"), "utf8");
    expect(src).toContain('.in("status", ["pending", "partial"])');
    expect(src).toContain("if (errDeudas) throw new Error(");
  });
});
