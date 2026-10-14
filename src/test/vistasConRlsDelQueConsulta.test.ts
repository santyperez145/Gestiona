import { describe, it, expect } from "vitest";
import fs from "node:fs";

// Medido 2026-10-13: seis vistas de `postgres` sin security_invoker salteaban
// RLS. Sin login se leían 1.662 filas del kardex de 2 negocios, los ingresos
// de la plataforma y la auditoría de todos. La prueba viva contra la base es
// `scripts/tablas-lectura-ajena-probar.mjs`.
const sql = fs.readFileSync("supabase/migrations/20261013000500_vistas_con_rls_del_que_consulta.sql", "utf8");

describe("vistas que respetan el RLS de quien consulta", () => {
  for (const v of ["kardex_summary", "ecommerce_funnel", "stock_a_reponer", "payment_operation_trace", "platform_revenue_monthly", "audit_summary"]) {
    it(`${v} pasa a security_invoker y sin acceso anónimo`, () => {
      expect(sql).toContain(`'${v}'`);
    });
  }

  it("aplica invoker, saca anon y deja a authenticated sólo con SELECT", () => {
    expect(sql).toContain("SET (security_invoker = true)");
    expect(sql).toContain("REVOKE ALL ON public.%I FROM anon");
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public\.%I FROM authenticated/);
  });

  it("queda la prueba viva de lectura ajena", () => {
    expect(fs.existsSync("scripts/tablas-lectura-ajena-probar.mjs")).toBe(true);
  });
});
