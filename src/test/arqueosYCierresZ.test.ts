import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("arqueos y cierres Z: la base guarda lo fiscal", () => {
  const sql = readFileSync("supabase/migrations/20261023000700_arqueos_y_cierres_z.sql", "utf8");

  it("un Z confirmado y un arqueo registrado no se editan", () => {
    expect(sql).toContain("RAISE EXCEPTION 'El cierre Z % ya está confirmado: no se puede modificar'");
    expect(sql).toContain("RAISE EXCEPTION 'Un arqueo registrado no se modifica: hacé uno nuevo'");
  });

  it("un Z que no cierra no se confirma, y los faltantes se avisan", () => {
    expect(sql).toContain("IF p_confirmar AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_obs) o WHERE o->>'nivel' = 'error') THEN");
    expect(sql).toContain("Falta cargar del Z %s al %s");
  });

  it("el cierre electrónico sólo se guarda si coincide con lo autorizado, sin homologación", () => {
    expect(sql).toContain("RAISE EXCEPTION 'El informe no coincide con lo autorizado por ARCA:%'");
    expect(sql).toContain("AND COALESCE(i.afip_environment, '') <> 'homologacion'");
  });

  it("el arqueo de cierre cierra el turno por el camino de siempre", () => {
    expect(sql).toContain("v_cierre := public.pos_cash_session_close(v_session.id, round(p_efectivo, 2), v_motivo);");
    expect(sql).toContain("RAISE EXCEPTION 'El arqueo tiene diferencias contra el sistema: escribí el motivo.'");
  });
});
