import { describe, it, expect } from "vitest";
import { deriveOrderSLA, STORE_ORDER_STALE_HOURS } from "@/lib/storeOrderQueue";

describe("deriveOrderSLA — guardia de evidencia, sin inventar datos", () => {
  it("normal cuando fulfillment ya está resuelto", () => {
    const r = deriveOrderSLA({
      created_at: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
      fulfillment_status: "delivered",
      payment_status: "paid",
    });
    expect(r.slaStatus).toBe("normal");
    expect(r.actionRequired).toBeNull();
  });

  it("alert cuando está pendiente y pasa horas de stale", () => {
    const r = deriveOrderSLA({
      created_at: new Date(Date.now() - (STORE_ORDER_STALE_HOURS + 2) * 3600_000).toISOString(),
      fulfillment_status: "pending",
      payment_status: "paid",
    });
    expect(r.slaStatus).toBe("alert");
    expect(r.actionRequired).toMatch(/Preparar despacho/);
  });

  it("overdue cuando pasa el doble de stale y sigue pendiente", () => {
    const r = deriveOrderSLA({
      created_at: new Date(Date.now() - (STORE_ORDER_STALE_HOURS * 2.5) * 3600_000).toISOString(),
      fulfillment_status: "pending",
      payment_status: "paid",
    });
    expect(r.slaStatus).toBe("overdue");
    expect(r.actionRequired).toMatch(/Atrasado SLA/);
  });

  it("sin inventar datos si no hay fulfillment pendiente", () => {
    const r = deriveOrderSLA({
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 100).toISOString(),
      fulfillment_status: "shipped",
      payment_status: "paid",
    });
    expect(r.slaStatus).toBe("normal");
  });
});