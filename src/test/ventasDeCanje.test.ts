import { describe, expect, it } from "vitest";
import { ventasDelCanje, ventasMedidasPorCanje } from "@/lib/ventasDeCanje";

const canjes = [
  { id: "viejo", influencer_id: "ana", discount_code: "ANA10", created_at: "2026-09-01T00:00:00Z", sales_generated_ars: 999 },
  { id: "nuevo", influencer_id: "ana", discount_code: "ANA10", created_at: "2026-10-01T00:00:00Z", sales_generated_ars: 0 },
  { id: "manual", influencer_id: null, created_at: "2026-09-01T00:00:00Z", sales_generated_ars: 5000 },
  { id: "vacio", influencer_id: "beto", created_at: "2026-09-01T00:00:00Z" },
];
const ventas = [
  { influencer_id: "ana", referral_code: "ana10", sale_total_ars: 1000, created_at: "2026-09-15T00:00:00Z" },
  { influencer_id: "ana", referral_code: "ANA10", sale_total_ars: 2000, created_at: "2026-10-05T00:00:00Z" },
  { influencer_id: "ana", referral_code: "OTRO", sale_total_ars: 7000, created_at: "2026-10-06T00:00:00Z" },
  { influencer_id: "ana", referral_code: "ANA10", sale_total_ars: 300, created_at: "2026-08-01T00:00:00Z" },
];

describe("ventas de un canje", () => {
  const medidas = ventasMedidasPorCanje(canjes, ventas);

  it("cada venta va a un solo canje: el último del creador que empezó antes", () => {
    expect(medidas.get("viejo")).toBe(1000);
    expect(medidas.get("nuevo")).toBe(2000);
  });

  it("no cuenta ventas con otro código ni anteriores al canje", () => {
    expect([...medidas.values()].reduce((a, b) => a + b, 0)).toBe(3000);
  });

  it("lo medido manda sobre lo cargado a mano, y se rotula", () => {
    expect(ventasDelCanje(canjes[0], medidas)).toEqual({ monto: 1000, fuente: "medido" });
    expect(ventasDelCanje(canjes[2], medidas)).toEqual({ monto: 5000, fuente: "cargado" });
    expect(ventasDelCanje(canjes[3], medidas)).toEqual({ monto: 0, fuente: "sin_dato" });
  });
});
