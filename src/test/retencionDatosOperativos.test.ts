import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261011001500_retencion_datos_operativos.sql"), "utf8");

describe("retención de datos operativos", () => {
  it("sólo borra historial de cron viejo y preparación de importaciones canceladas", () => {
    expect(sql).toContain("DELETE FROM cron.job_run_details WHERE end_time < now() - interval '14 days';");
    expect(sql).toContain("AND s.status = 'cancelled' AND s.updated_at < now() - interval '7 days';");
    const deletes = sql.match(/DELETE FROM [\w.]+/g) ?? [];
    expect(deletes).toEqual(["DELETE FROM cron.job_run_details", "DELETE FROM public.product_import_rows"]);
  });

  it("corre todos los días y la app no puede invocarla", () => {
    expect(sql).toContain("cron.schedule('podar-datos-operativos', '53 4 * * *'");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.podar_datos_operativos() FROM PUBLIC, anon, authenticated;");
  });
});
