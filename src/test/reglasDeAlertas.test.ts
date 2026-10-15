import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { REGLAS_DE_ALERTA, describirRegla, validarUmbral } from "@/lib/reglasDeAlertas";

// 2026-10-15: Alertas administraba reglas que nadie evaluaba y no mostraba las
// 6 que check-alerts revisa todos los días.
describe("reglas de alerta reales", () => {
  it("cubre exactamente los tipos que revisa check-alerts", () => {
    const fn = fs.readFileSync("supabase/functions/check-alerts/index.ts", "utf8");
    for (const r of REGLAS_DE_ALERTA) expect(fn).toContain(`rule.type === "${r.tipo}"`);
    expect(REGLAS_DE_ALERTA).toHaveLength(7);
  });
  it("describe y valida el umbral", () => {
    const stock = REGLAS_DE_ALERTA.find(r => r.tipo === "stock_low")!;
    const gastos = REGLAS_DE_ALERTA.find(r => r.tipo === "high_expense")!;
    const dias = REGLAS_DE_ALERTA.find(r => r.tipo === "debt_overdue")!;
    expect(describirRegla(stock, 5)).toBe("Productos activos con 5 unidades o menos.");
    expect(describirRegla(gastos, 500000)).toBe("Gastos del mes por encima de $500.000.");
    expect(validarUmbral(gastos, "500.000")).toEqual({ valor: 500000 });
    expect(validarUmbral(dias, "7,5")).toEqual({ error: "Usá días enteros" });
    expect(validarUmbral(stock, "-1")).toEqual({ error: "El mínimo es 0" });
  });
  it("la pantalla edita las reglas que corren y no tiene botones que sólo avisan", () => {
    const page = fs.readFileSync("src/pages/SmartAlertsPage.tsx", "utf8");
    expect(page).toContain('.from("alert_rules")');
    expect(page).not.toContain('.from("smart_alert_rules")');
    expect(page).not.toMatch(/onClick=\{\(\) => toast\./);
  });
});
