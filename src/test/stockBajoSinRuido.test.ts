import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("avisos de stock bajo sin ruido", () => {
  it("el aviso inmediato sólo sale de productos vendidos y no se repite sin leer", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261011001400_stock_bajo_sin_ruido.sql"), "utf8");
    expect(sql).toContain("AND EXISTS (SELECT 1 FROM public.sales s WHERE s.product_id = NEW.id)");
    expect(sql).toContain("AND n.entity_type = 'product' AND n.entity_id = NEW.id::text AND NOT n.read");
  });

  it("el resumen diario sólo cuenta lo que se vendió alguna vez", () => {
    const fn = readFileSync(resolve(process.cwd(), "supabase/functions/check-stock-alerts/index.ts"), "utf8");
    expect(fn).toContain('.gt("total_sold", 0)');
  });
});
