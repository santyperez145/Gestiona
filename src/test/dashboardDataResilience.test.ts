import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");
const dashboard = read("src/pages/Dashboard.tsx");
const store = read("src/lib/supabaseStore.ts");

describe("dashboard operativo", () => {
  it("versiona todas las secciones que renderiza", () => {
    for (const name of [
      "DashboardKPIsSection",
      "DashboardHealthSection",
      "DashboardCustomersSection",
      "DashboardSalesSection",
    ]) {
      expect(existsSync(resolve(ROOT, `src/components/dashboard/${name}.tsx`)), name).toBe(true);
      expect(dashboard).toContain(`@/components/dashboard/${name}`);
    }
  });

  it("una fuente financiera secundaria no derriba ventas y productos", () => {
    expect(dashboard).toContain("Promise.allSettled");
    expect(dashboard).toContain("OPTIONAL_DASHBOARD_SOURCES");
    expect(dashboard).toContain("requiredFailures");
    expect(dashboard).toContain("optionalFailures");
    expect(dashboard).toContain("previous?.expenses ?? []");
    expect(dashboard).toContain("previous?.debts ?? []");
    expect(dashboard).toContain("previous?.purchases ?? []");
  });

  it("no crea datos de muestra al abrir el panel", () => {
    expect(dashboard).not.toContain("seedProductsForUser");
  });

  it("no presenta clientes como tasa de conversion", () => {
    expect(dashboard).not.toContain("conversionRate:");
    expect(dashboard).toContain("periodCustomers: stats.uniqueCustomers");
  });

  it("canales diferencia pedidos, unidades e ingresos", () => {
    expect(dashboard).toContain("revenue: number; orders: number; units: number");
    expect(dashboard).toContain("channelMap[src].orders += 1");
    expect(dashboard).toContain("channelMap[src].units += Number(s.quantity || 0)");
  });

  it("consulta todas las fuentes con la organizacion activa explicita", () => {
    for (const source of [
      "getProductsDB",
      "getSalesDB",
      "getPurchasesDB",
      "getDebtsDB",
      "getSettingsDB",
      "getExpensesDB",
    ]) {
      expect(dashboard).toContain(`${source}(user.id, activeOrg.id)`);
    }
    expect(store).toContain("if (organizationId) return organizationId");
  });

  it("aísla widgets, realtime y preferencias por organizacion", () => {
    expect(dashboard).toContain(".eq('org_id', activeOrg.id)");
    expect(dashboard).toContain("filter: `org_id=eq.${activeOrg.id}`");
    expect(dashboard).toContain('orgViewKey("dashboard.weekly_target", activeOrg?.id)');
    expect(dashboard).toContain('orgViewKey(`dashboard.monthly_target.${currentYearMonth}`, activeOrg?.id)');
    expect(dashboard).not.toContain("noSalesAlertDismissed");
  });
});

describe("Finance sin paneles ficticios", () => {
  it("elimina la antigua pantalla con cifras hardcodeadas", () => {
    expect(existsSync(resolve(ROOT, "src/pages/FinanceAIPage.tsx"))).toBe(false);
    expect(existsSync(resolve(ROOT, "src/components/finance/FinanceDashboard.tsx"))).toBe(false);
  });
});
