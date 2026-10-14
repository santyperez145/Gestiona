import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabaseStore", () => ({ calculateTaxes: () => ({ totalTax: 0 }) }));

import { projectCashFlow } from "@/lib/cashFlow";

// 2026-10-14: la proyección sacaba las salidas a proveedores de las «compras
// programadas», que ya no existen. Ahora salen de lo que se les debe.
describe("flujo de caja: pagos a proveedores", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-14T15:00:00")); });
  afterEach(() => { vi.useRealTimers(); });

  const proyectar = (supplierDebts: Parameters<typeof projectCashFlow>[0]["supplierDebts"]) =>
    projectCashFlow({ initialCash: 100_000, windowDays: 30, sales: [], debts: [], expenses: [], supplierDebts, settings: {} });

  it("lo que vence en la ventana sale en su fecha; lo vencido, hoy; lo pagado o lejano, nunca", () => {
    const r = proyectar([
      { supplier_name: "Distribuidora", remaining_ars: 20_000, due_date: "2026-10-20", status: "pending" },
      { supplier_name: "Mayorista", remaining_ars: 5_000, due_date: "2026-10-01", status: "partial" },
      { supplier_name: "Pagado", remaining_ars: 0, due_date: "2026-10-20", status: "paid" },
      { supplier_name: "Lejano", remaining_ars: 9_000, due_date: "2027-01-01", status: "pending" },
    ]);
    expect(r.movements.filter(m => m.kind === "supplier_payment").map(m => [m.date, m.amount, m.label])).toEqual([
      ["2026-10-14", -5_000, "Vencido · Pago a Mayorista"],
      ["2026-10-20", -20_000, "Pago a Distribuidora"],
    ]);
    expect(r.endingBalance).toBe(75_000);
  });

  it("sin cuentas a pagar no inventa salidas", () => {
    expect(proyectar([]).movements).toEqual([]);
  });
});
