import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260821000058_commission_approval_gate.sql",
  "utf8",
);
const page = readFileSync("src/pages/PlatformCommissionsPage.tsx", "utf8");

describe("autoridad de comisión de plataforma", () => {
  it("un porcentaje sólo cobra si fue aprobado y está vigente", () => {
    const amountFunction = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.platform_commission_amount"),
    );
    expect(amountFunction).toContain("r.approval_status = 'approved'");
    expect(amountFunction).toContain("r.effective_from <= now()");
    expect(amountFunction).toContain("r.effective_until IS NULL OR r.effective_until > now()");
  });

  it("el monto autoritativo respeta el tratamiento fiscal aprobado", () => {
    const amountFunction = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.platform_commission_amount"),
    );
    expect(amountFunction).toContain("r.tax_treatment, r.tax_rate_pct");
    expect(amountFunction).toContain("v_rule.tax_treatment = 'added'");
    expect(amountFunction).toContain("v_rule.tax_rate_pct");
  });

  it("editar precio invalida la aprobación anterior", () => {
    const guard = migration.slice(
      migration.indexOf("guard_platform_commission_rule_lifecycle"),
      migration.indexOf("save_platform_commission_rule"),
    );
    expect(guard).toContain("NEW.approval_status := 'draft'");
    expect(guard).toContain("NEW.is_active := false");
    expect(guard).toContain("NEW.terms_version := NULL");
  });

  it("reejecutar la migración no desactiva aprobaciones posteriores", () => {
    const legacyDeactivation = migration.slice(
      migration.indexOf("DO $deactivate_unapproved_legacy_rules$"),
      migration.indexOf("CREATE OR REPLACE FUNCTION public.guard_platform_commission_rule_lifecycle"),
    );
    expect(legacyDeactivation).toContain("supabase_migrations.schema_migrations");
    expect(legacyDeactivation).toContain("version = '20260821000058'");
    expect(legacyDeactivation).toContain("IF NOT EXISTS");
  });

  it("authenticated no puede mutar la tabla por fuera de los RPC", () => {
    expect(migration).toContain(
      "REVOKE INSERT, UPDATE, DELETE ON public.platform_commission_rules FROM authenticated",
    );
    expect(migration).toContain("save_platform_commission_rule");
    expect(migration).toContain("approve_platform_commission_rule");
    expect(migration).toContain("retire_platform_commission_rule");
  });

  it("retirar inmediatamente no crea una ventana temporal inválida", () => {
    const retirement = migration.slice(
      migration.indexOf("CREATE OR REPLACE FUNCTION public.retire_platform_commission_rule"),
      migration.indexOf("-- La tabla queda de lectura"),
    );
    expect(retirement).toContain("effective_from + interval '1 microsecond'");
    expect(retirement).toContain("GREATEST(now()");
  });

  it("el panel propone, aprueba y retira sin escrituras directas", () => {
    expect(page).toContain("supabase.rpc('save_platform_commission_rule'");
    expect(page).toContain("supabase.rpc('approve_platform_commission_rule'");
    expect(page).toContain("supabase.rpc('retire_platform_commission_rule'");
    expect(page).not.toMatch(/from\(['"]platform_commission_rules['"]\)\.update/);
    expect(page).not.toMatch(/from\(['"]platform_commission_rules['"]\)\.delete/);
  });

  it("el panel guarda la propuesta visible antes de aprobarla", () => {
    const approval = page.slice(
      page.indexOf("async function approveRule"),
      page.indexOf("// ── KPIs"),
    );
    expect(approval.indexOf("save_platform_commission_rule")).toBeGreaterThan(-1);
    expect(approval.indexOf("approve_platform_commission_rule")).toBeGreaterThan(
      approval.indexOf("save_platform_commission_rule"),
    );
  });
});
