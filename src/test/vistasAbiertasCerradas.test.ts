import { describe, it, expect } from "vitest";
import fs from "node:fs";

// ADR 006, acción 1. Medido 2026-10-13: 14 vistas sin security_invoker,
// legibles desde el navegador y sin filtro por usuario. La comprobación viva
// es `scripts/vistas-abiertas-matrix.sql` (cero vistas abiertas sin marca).
const sql = fs.readFileSync("supabase/migrations/20261013000700_vistas_abiertas_cerradas.sql", "utf8");

describe("ADR 006: vistas abiertas cerradas o declaradas", () => {
  it("las vistas por negocio pasan a invoker y sin anon", () => {
    for (const v of ["active_promotions", "contracts_expiring_soon", "crm_pending_followups", "crm_pipeline_forecast",
      "deal_outcome_stats", "vendor_pending_summary", "desvio_de_comisiones"]) {
      expect(sql).toContain(`'${v}'`);
    }
    expect(sql).toContain("SET (security_invoker = true)");
    expect(sql).toContain("REVOKE ALL ON public.%I FROM anon");
  });

  it("las que siguen como dueño llevan la marca @publica o @revisada con motivo", () => {
    for (const v of ["planes_contratables", "planes_de_cuotas_posibles", "merchant_integration_catalog", "store_catalog_products", "platform_activation_cohorts"]) {
      const fila = sql.split("\n").find(l => l.includes(`('${v}', '@`)) ?? "";
      expect(fila).toMatch(/'@(publica|revisada): [^']{20,}'\)/);
    }
  });

  it("el ADR registra la acción como hecha", () => {
    const adr = fs.readFileSync("docs/ADR_006_FRONTERA_ENTRE_NEGOCIOS.md", "utf8");
    expect(adr).toMatch(/1\. \[x\] Cerrar las vistas por negocio abiertas/);
  });
});
