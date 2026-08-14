import { describe, expect, it } from "vitest";
import { calculatePlatformMetrics, type PlatformHealthRow, withActivationTimes } from "@/lib/platformMetrics";

const baseRow = (overrides: Partial<PlatformHealthRow> = {}): PlatformHealthRow => ({
  org_id: "org-1",
  org_name: "Negocio 1",
  slug: "negocio-1",
  org_creada: "2026-01-01T00:00:00.000Z",
  onboarding_completed: true,
  plan_name: "Pro",
  subscription_status: "active",
  gmv_30d: 100,
  gmv_prev_30d: 80,
  gmv_total: 500,
  comision_30d: 5,
  comision_total: 25,
  cobros_30d: 2,
  cobros_total: 4,
  ultimo_cobro: "2026-01-10T00:00:00.000Z",
  primer_cobro: "2026-01-03T00:00:00.000Z",
  dias_sin_cobrar: 0,
  miembros: 1,
  productos: 8,
  tiendas_activas: 1,
  variacion_pct: 25,
  senal: "creciendo",
  ...overrides,
});

describe("platformMetrics", () => {
  it("calcula el tiempo de alta hasta primer cobro", () => {
    expect(withActivationTimes([baseRow()])[0].daysToFirstCharge).toBe(2);
  });

  it("no inventa un tiempo cuando faltan fechas o son invalidas", () => {
    expect(withActivationTimes([baseRow({ primer_cobro: null }), baseRow({ org_creada: "bad" })])
      .map(row => row.daysToFirstCharge)).toEqual([null, null]);
  });

  it("construye el funnel y las tasas sobre el total de organizaciones", () => {
    const metrics = calculatePlatformMetrics([
      baseRow(),
      baseRow({ org_id: "org-2", onboarding_completed: false, productos: 0, tiendas_activas: 0, cobros_total: 0, subscription_status: "trialing", senal: "sin_activar" }),
    ]);
    expect(metrics.totalOrganizations).toBe(2);
    expect(metrics.onboardingRate).toBe(50);
    expect(metrics.catalogRate).toBe(50);
    expect(metrics.storeRate).toBe(50);
    expect(metrics.activationRate).toBe(50);
    expect(metrics.trialOrganizations).toBe(1);
    expect(metrics.signalCounts.sin_activar).toBe(1);
  });

  it("calcula promedio y mediana sin mezclar organizaciones sin cobro", () => {
    const metrics = calculatePlatformMetrics([
      baseRow(),
      baseRow({ org_id: "org-2", org_creada: "2026-01-01T00:00:00.000Z", primer_cobro: "2026-01-11T00:00:00.000Z" }),
      baseRow({ org_id: "org-3", primer_cobro: null, cobros_total: 0 }),
    ]);
    expect(metrics.averageDaysToFirstCharge).toBe(6);
    expect(metrics.medianDaysToFirstCharge).toBe(6);
    expect(metrics.activationTimes[2].daysToFirstCharge).toBeNull();
  });

  it("suma GMV y comision sin convertir null en NaN", () => {
    const metrics = calculatePlatformMetrics([baseRow({ gmv_30d: null, gmv_total: null, comision_30d: null })]);
    expect(metrics.gmv30d).toBe(0);
    expect(metrics.gmvTotal).toBe(0);
    expect(metrics.commission30d).toBe(0);
  });
});

