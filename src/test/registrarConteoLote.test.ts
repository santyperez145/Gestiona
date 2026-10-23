import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("toma física en tandas", () => {
  const sql = readFileSync("supabase/migrations/20261023000500_registrar_conteo_lote.sql", "utf8");
  const pantalla = readFileSync("src/components/inventory/StockCountTab.tsx", "utf8");

  it("la base registra la tanda en un UPDATE, con permiso y todo o nada", () => {
    expect(sql).toContain("PERFORM public.exigir_permiso(v_org, 'inventory', 'edit', 'registrar un conteo');");
    expect(sql).toContain("IF jsonb_array_length(p_items) > 2000 THEN");
    expect(sql).toContain("IF v_registrados <> v_total THEN");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.registrar_conteo_lote(uuid, jsonb) FROM PUBLIC, anon;");
  });

  it("la pantalla manda tandas de 1.000 y sólo vuelve a de a uno si falta la migración", () => {
    expect(pantalla).toContain('supabase.rpc("registrar_conteo_lote" as never');
    expect(pantalla).toContain("countedRows.slice(i, i + 1000)");
    expect(pantalla).toContain("if (error && i === 0 && isMissingFunction(error)) porTandas = false;");
  });
});
