import { describe, expect, it } from "vitest";
import { gananciaRealDeCanjes, ventasDelCanje, ventasMedidasPorCanje } from "@/lib/ventasDeCanje";

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

describe("ganancia real de los canjes (Creators ↔ Profit)", () => {
  const conVentas = [
    { influencer_id: "ana", sale_id: "s1", commission_ars: 100, referral_code: "ANA10", sale_total_ars: 1000, created_at: "2026-09-15T00:00:00Z" },
    { influencer_id: "ana", sale_id: "s2", commission_ars: 200, referral_code: "ANA10", sale_total_ars: 2000, created_at: "2026-10-05T00:00:00Z" },
  ];
  const inversion = (c: { id: string }) => ({ viejo: 300, nuevo: 500, manual: 9999, vacio: 0 } as Record<string, number>)[c.id];

  it("margen de las ventas medidas − comisiones − inversión de esos canjes", () => {
    const r = gananciaRealDeCanjes(canjes, conVentas, new Map([["s1", 600], ["s2", 900]]), inversion);
    expect(r).toEqual({ ganancia: 400, margen: 1500, comisiones: 300, inversion: 800, canjesMedidos: 2, ventasMedidas: 2, ventasSinMargen: 0 });
  });

  it("vender más de lo invertido puede ser perder plata", () => {
    const r = gananciaRealDeCanjes(canjes, conVentas, new Map([["s1", 50], ["s2", 80]]), inversion);
    // Vendió 3.000 contra 800 invertidos, pero el margen fue 130.
    expect(r.ganancia).toBe(-970);
  });

  it("sin margen conocido no hay número: dice cuántas ventas faltan", () => {
    const r = gananciaRealDeCanjes(canjes, conVentas, new Map([["s1", 400], ["s2", null]]), inversion);
    expect(r.ganancia).toBeNull();
    expect(r.ventasSinMargen).toBe(1);
    expect(gananciaRealDeCanjes(canjes, conVentas, new Map(), inversion).ventasSinMargen).toBe(2);
  });

  it("sin ventas medidas no inventa ganancia", () => {
    expect(gananciaRealDeCanjes(canjes, [], new Map(), inversion)).toMatchObject({ ganancia: null, canjesMedidos: 0 });
  });
});
