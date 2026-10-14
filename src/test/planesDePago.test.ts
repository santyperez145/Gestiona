import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { estadoDelPlan, frecuenciaDeFechas, previsualizarCuotas, sumarPeriodos, type PlanDePago } from "@/lib/planesDePago";

// 2026-10-14 (páginas legacy): el plan de cuotas vivía en el navegador y
// «cuota pagada» era un tilde sin cobro; las cuotas redondeadas no sumaban el
// saldo. Ahora el plan está en la base (20261014001300) y el estado de cada
// cuota sale de lo cobrado a la deuda.
const plan = (pagadoAlCrear = 100): PlanDePago => ({
  id: "p", debt_id: "d", frecuencia: "mensual", pagado_al_crear: pagadoAlCrear,
  cuotas: [{ fecha: "2026-01-10", monto: 300 }, { fecha: "2026-02-10", monto: 300 }, { fecha: "2026-03-10", monto: 300 }],
});

describe("planes de pago: estado de las cuotas", () => {
  it("una cuota está pagada cuando lo cobrado desde el plan la cubre", () => {
    const e = estadoDelPlan(plan(), 100 + 450, "2026-02-01");
    expect(e.cuotas.map(c => [c.estado, c.cobrado, c.falta])).toEqual([["pagada", 300, 0], ["parcial", 150, 150], ["pendiente", 0, 300]]);
    expect(e.pagadas).toBe(1);
    expect(e.proxima?.numero).toBe(2);
    expect(e.proxima?.falta).toBe(150);
  });

  it("lo cobrado antes de armar el plan no cuenta como cuota", () => {
    expect(estadoDelPlan(plan(100), 100, "2026-01-01").pagadas).toBe(0);
  });

  it("una cuota sin cubrir con la fecha pasada está vencida", () => {
    const e = estadoDelPlan(plan(), 100 + 300, "2026-02-15");
    expect(e.cuotas.map(c => c.estado)).toEqual(["pagada", "vencida", "pendiente"]);
    expect(e.vencidas).toBe(1);
  });

  it("todo cobrado: sin próxima cuota", () => {
    expect(estadoDelPlan(plan(), 1000, "2026-12-31").proxima).toBeNull();
  });
});

describe("planes de pago: cronograma igual al de la base", () => {
  it("las cuotas suman exacto el saldo; la última absorbe el redondeo", () => {
    const cuotas = previsualizarCuotas(900, 7, "mensual", "2026-01-31");
    expect(cuotas[0].monto).toBe(128.57);
    expect(cuotas[6].monto).toBe(128.58);
    expect(Math.round(cuotas.reduce((s, c) => s + c.monto, 0) * 100) / 100).toBe(900);
  });

  it("los meses se ajustan al último día y las semanas no saltean", () => {
    expect(sumarPeriodos("2026-01-31", "mensual", 1)).toBe("2026-02-28");
    expect(sumarPeriodos("2026-01-31", "mensual", 2)).toBe("2026-03-31");
    expect(sumarPeriodos("2026-03-01", "quincenal", 1)).toBe("2026-03-15");
    expect(sumarPeriodos("2026-12-28", "semanal", 1)).toBe("2027-01-04");
  });

  it("un plan viejo del navegador recupera su frecuencia", () => {
    expect(frecuenciaDeFechas(["2026-01-01", "2026-01-08"])).toBe("semanal");
    expect(frecuenciaDeFechas(["2026-01-01", "2026-01-15"])).toBe("quincenal");
    expect(frecuenciaDeFechas(["2026-01-01", "2026-02-01"])).toBe("mensual");
  });

  it("la pantalla ya no guarda planes en el navegador ni tiene tildes de pagada", () => {
    const pagina = fs.readFileSync("src/pages/DebtsPage.tsx", "utf8");
    expect(pagina).not.toMatch(/localStorage\.setItem\(plansKey/);
    expect(pagina).not.toContain("toggleInstallmentPaid");
    expect(pagina).toContain("guardarPlanDB(planningDebt.id, vista.length, planFreq, planStart)");
    expect(pagina).toContain("setMontoSugerido(estado.proxima!.falta);");
  });
});
