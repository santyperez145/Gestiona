import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("las facturas llevan la fecha del día argentino", () => {
  it("un disparador antes de insertar corrige el «hoy» de una sesión en UTC", () => {
    const sql = readFileSync("supabase/migrations/20261030001600_factura_con_fecha_argentina.sql", "utf8");
    expect(sql).toContain("SELECT (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date;");
    expect(sql).toContain("BEFORE INSERT ON public.invoices");
    expect(sql).toContain("IF NEW.issue_date = CURRENT_DATE THEN");
    // Una fecha elegida a propósito no se toca: sólo se corrige «hoy».
    expect(sql).not.toMatch(/NEW\.issue_date := v_hoy;\s*END IF;\s*NEW\.issue_date/);
  });

  it("la matriz de cierres Z corre en el día argentino a cualquier hora", () => {
    const matriz = readFileSync("scripts/arqueos-y-cierres-z-matrix.sql", "utf8");
    expect(matriz).toContain("PERFORM set_config('timezone', 'America/Argentina/Buenos_Aires', true);");
    expect(readFileSync("scripts/migraciones-pendientes.mjs", "utf8"))
      .toContain("'20261030001600': 'scripts/factura-con-fecha-argentina-matrix.sql'");
  });
});
