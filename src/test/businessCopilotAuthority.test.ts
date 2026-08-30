import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const leer = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

describe("Business Copilot conserva autoridad, privacidad y costo en el servidor", () => {
  const dashboard = leer("src/pages/Dashboard.tsx");
  const pulse = leer("src/components/dashboard/AIProactiveWidget.tsx");
  const briefing = leer("src/components/shared/DailyBriefingModal.tsx");
  const edge = leer("supabase/functions/ai-analysis/index.ts");

  it("no monta llamadas automáticas cuando el plan no habilita IA", () => {
    expect(dashboard).toContain("useEntitlements()");
    expect(dashboard).toMatch(/visibleDashboardSection\s*===\s*"dashboard-overview"[^\n]*!entitlementsLoading\s*&&\s*canUseAI\s*&&\s*<AIProactiveWidget/);
    expect(dashboard).toMatch(/visibleDashboardSection\s*===\s*"dashboard-intelligence"[^\n]*!entitlementsLoading\s*&&\s*canUseAI\s*\?\s*\(\s*<AIPrediction/);
    expect(dashboard).toContain('to="/mi-plan"');
    expect(dashboard).toContain("Activar IA");
  });

  it("pulso y briefing mandan sólo intención y organización", () => {
    expect(pulse).toContain('type: "daily_pulse"');
    expect(pulse).toContain("orgId,");
    expect(pulse).not.toMatch(/body:\s*\{[^}]*\bdata\s*:/s);
    expect(pulse).not.toContain("rawSales");
    expect(pulse).not.toContain("rawExpenses");

    expect(briefing).toContain('type: "daily_briefing"');
    expect(briefing).toContain("orgId }");
    expect(briefing).not.toContain("buildPrompt");
    expect(briefing).not.toContain("/functions/v1/ai-chat");
    expect(briefing).not.toContain("messages:");
    expect(briefing).not.toContain("briefingData");
    expect(briefing).toContain("data.summary");
  });

  it("valida tenant y plan antes de reconstruir el contexto bajo RLS", () => {
    const membership = edge.indexOf('.from("memberships")');
    const entitlement = edge.indexOf("exigirBeneficio(req, orgId");
    const context = edge.indexOf("cargarContextoDiario(sb, orgId)");
    expect(membership).toBeGreaterThan(0);
    expect(entitlement).toBeGreaterThan(membership);
    expect(context).toBeGreaterThan(entitlement);
    expect(edge).toContain('new Set(["daily_pulse", "daily_briefing"])');
    expect(edge).toContain('analysisData = type === "daily_briefing" ? context.briefing : context.pulse');
  });

  it("minimiza datos personales antes de llamar al proveedor", () => {
    const contexto = edge.slice(
      edge.indexOf("async function cargarContextoDiario"),
      edge.indexOf("const PROMPTS"),
    );
    expect(contexto).not.toContain("customer_name");
    expect(contexto).not.toContain("customer_id");
    expect(contexto).toContain('select("business_name")');
    expect(contexto).toContain('select("product_name,quantity,total_ars,profit_ars,date")');
  });

  it("muestra fallos recuperables en vez de ocultarlos", () => {
    expect(pulse).toContain("setError(cause instanceof Error");
    expect(pulse).toContain("Reintentar");
    expect(briefing).toContain("setError(cause instanceof Error");
    expect(briefing).toContain("Reintentar");
  });
});
