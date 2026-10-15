import { describe, it, expect } from "vitest";
import { embudoMonotono, parseStorePerformanceSnapshot } from "@/lib/storeFirstPublish";

// 2026-10-15, recorriendo la app publicada: «Rendimiento de la tienda» de
// Exentry decía «Las métricas recibidas no son válidas» para siempre. La base
// devolvía 2 sesiones que iniciaron el pago y 1 con productos (el evento de
// carrito se empezó a medir el 4/9) y el control descartaba todo el bloque.
const real = {
  channels: [
    { orders: 0, channel: "direct", sessions: 1535, orders_paid: 0, paid_revenue_ars: 0, converted_sessions: 0, sessions_with_items: 0, checkout_started_sessions: 1 },
    { orders: 0, channel: "referral", sessions: 41, orders_paid: 0, paid_revenue_ars: 0, converted_sessions: 0, sessions_with_items: 1, checkout_started_sessions: 1 },
    { orders: 0, channel: "organic_search", sessions: 4, orders_paid: 0, paid_revenue_ars: 0, converted_sessions: 0, sessions_with_items: 0, checkout_started_sessions: 0 },
    { orders: 0, channel: "social", sessions: 3, orders_paid: 0, paid_revenue_ars: 0, converted_sessions: 0, sessions_with_items: 0, checkout_started_sessions: 0 },
  ],
  store_id: "7a86302b-379f-408e-8f46-c264debdca9b", period_to: null, comparison: null, orders_paid: 2, period_from: null,
  snapshot_at: "2026-10-15T04:41:32.291765+00:00", orders_total: 7, sessions_total: 1583, paid_revenue_ars: 2.0, attributed_orders: 0,
  recoverable_carts: 0, converted_sessions: 0, sessions_with_items: 1, attribution_started_at: "2026-09-04T00:00:00+00:00",
  visit_retention_months: 13, checkout_started_sessions: 2, checkout_tracking_started_at: "2026-09-04T03:41:11+00:00",
};

describe("rendimiento de la tienda con datos reales", () => {
  it("acepta el embudo invertido y lo muestra corregido", () => {
    const r = parseStorePerformanceSnapshot(real);
    expect(r).not.toBeNull();
    expect(r?.sessionsWithItems).toBe(2);
    expect(r?.checkoutStartedSessions).toBe(2);
    expect(r?.channels.find(c => c.channel === "direct")?.sessionsWithItems).toBe(1);
  });
  it("el embudo nunca crece hacia abajo ni supera las sesiones", () => {
    expect(embudoMonotono(10, 1, 3, 5)).toEqual({ conItems: 5, checkout: 5, convertidas: 5 });
    expect(embudoMonotono(2, 9, 1, 0)).toEqual({ conItems: 2, checkout: 1, convertidas: 0 });
  });
  it("lo estructural se sigue rechazando", () => {
    expect(parseStorePerformanceSnapshot({ ...real, orders_paid: 99 })).toBeNull();
    expect(parseStorePerformanceSnapshot({ ...real, sessions_total: 5 })).toBeNull();
  });
});
