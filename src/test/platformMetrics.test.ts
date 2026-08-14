import { describe, expect, it } from "vitest";
import { calculateChannelMetrics, calculatePlatformMetrics, calculateStockAccuracyMetrics, type PlatformActivationRow, type PlatformHealthRow, type PlatformStockAccuracyRow, withActivationTimes, withChannelActivationTimes } from "@/lib/platformMetrics";

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

const baseChannelRow = (overrides: Partial<PlatformActivationRow> = {}): PlatformActivationRow => ({
  org_id: "org-1",
  org_name: "Negocio 1",
  slug: "negocio-1",
  org_creada: "2026-01-01T00:00:00.000Z",
  store_id: "store-1",
  store_slug: "negocio-1",
  store_is_active: true,
  store_published_at: "2026-01-03T00:00:00.000Z",
  store_publication_known: true,
  first_online_order_at: "2026-01-06T00:00:00.000Z",
  online_orders_total: 3,
  online_orders_30d: 2,
  first_pos_sale_at: "2026-01-04T00:00:00.000Z",
  pos_sales_total: 5,
  pos_sales_30d: 4,
  uses_online: true,
  uses_pos: true,
  is_omnichannel: true,
  days_to_store_publish: 2,
  days_to_first_online_order: 5,
  ...overrides,
});

const baseStockRow = (overrides: Partial<PlatformStockAccuracyRow> = {}): PlatformStockAccuracyRow => ({
  org_id: "org-1",
  org_name: "Negocio 1",
  slug: "negocio-1",
  productos_total: 10,
  productos_medidos: 8,
  productos_coinciden: 6,
  productos_descuadrados: 2,
  productos_sin_kardex: 2,
  productos_stock_negativo: 1,
  precision_pct: 75,
  ultimo_movimiento_at: "2026-08-14T00:00:00.000Z",
  conteos_cerrados: 1,
  ultimo_conteo_at: "2026-08-13T00:00:00.000Z",
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

  it("mide adopcion por canal sobre eventos confirmados", () => {
    const metrics = calculateChannelMetrics([
      baseChannelRow(),
      baseChannelRow({
        org_id: "org-2",
        store_is_active: false,
        store_publication_known: false,
        store_published_at: null,
        first_online_order_at: null,
        uses_online: false,
        first_pos_sale_at: "2026-01-07T00:00:00.000Z",
        uses_pos: true,
        is_omnichannel: false,
        days_to_store_publish: null,
        days_to_first_online_order: null,
      }),
    ]);
    expect(metrics.organizationsWithStorePublished).toBe(1);
    expect(metrics.organizationsWithStoreActive).toBe(1);
    expect(metrics.organizationsWithStorePublicationKnown).toBe(1);
    expect(metrics.organizationsWithOnline).toBe(1);
    expect(metrics.organizationsWithPos).toBe(2);
    expect(metrics.omnichannelOrganizations).toBe(1);
    expect(metrics.omnichannelRate).toBe(50);
    expect(metrics.averageDaysToStorePublish).toBe(2);
    expect(metrics.averageDaysToFirstOnlineOrder).toBe(5);
  });

  it("calcula tiempos desde fechas solo cuando la base no envio el espejo numerico", () => {
    const row = baseChannelRow({ days_to_store_publish: null, days_to_first_online_order: null });
    const [activation] = withChannelActivationTimes([row]);
    expect(activation.daysToStorePublish).toBe(2);
    expect(activation.daysToFirstOnlineOrder).toBe(5);
  });

  it("mide precision solo sobre productos con Kardex y conserva los no medidos", () => {
    const metrics = calculateStockAccuracyMetrics([
      baseStockRow(),
      baseStockRow({
        org_id: "org-2",
        productos_total: 4,
        productos_medidos: 0,
        productos_coinciden: 0,
        productos_descuadrados: 0,
        productos_sin_kardex: 4,
        productos_stock_negativo: 0,
        precision_pct: null,
      }),
    ]);
    expect(metrics.totalOrganizations).toBe(2);
    expect(metrics.organizationsWithMeasuredStock).toBe(1);
    expect(metrics.totalProducts).toBe(14);
    expect(metrics.measuredProducts).toBe(8);
    expect(metrics.matchingProducts).toBe(6);
    expect(metrics.mismatchingProducts).toBe(2);
    expect(metrics.unmeasuredProducts).toBe(6);
    expect(metrics.accuracyPct).toBe(75);
    expect(metrics.rows[0].productos_descuadrados).toBe(2);
  });
});
