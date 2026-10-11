import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("cerrar caja con diferencia exige motivo", () => {
  it("el servidor rechaza sin motivo desde $1 y guarda el motivo en la auditoría", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261011002100_caja_diferencia_con_motivo.sql"), "utf8");
    expect(sql).toContain("IF abs(v_difference) >= 1 AND NULLIF(btrim(COALESCE(p_notes, '')), '') IS NULL THEN");
    expect(sql).toContain("'motivo', NULLIF(left(btrim(COALESCE(p_notes, '')), 1000), '')");
  });

  it("la pantalla usa el mismo umbral y lo pide antes de enviar", () => {
    const page = readFileSync(resolve(process.cwd(), "src/pages/CashSessionPage.tsx"), "utf8");
    expect(page).toContain("if (Math.abs(closingDiff ?? 0) >= 1 && !closingNotes.trim()) {");
    expect(page).toContain('"Motivo de la diferencia (obligatorio)"');
    expect(page).not.toContain("Math.abs(closingDiff) < 100");
  });
});
