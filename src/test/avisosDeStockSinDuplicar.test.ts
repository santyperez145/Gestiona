import { describe, it, expect } from "vitest";
import fs from "node:fs";

// 2026-10-14: el aviso persistente de stock bajo lo guarda la base
// (`trg_notify_low_stock`). El hook lo volvía a insertar desde cada pestaña
// abierta, uno por producto (hasta 50 por sentencia en una importación), y
// llenaba la pantalla de cartelitos: 10.893 avisos «stock bajo» en 30 días.
describe("avisos de stock en el panel", () => {
  const hook = fs.readFileSync("src/hooks/useStockAlerts.ts", "utf8");

  it("el panel no inserta notificaciones: las guarda la base", () => {
    expect(hook).not.toMatch(/from\(["']notifications["']\)/);
    expect(hook).not.toContain("insertNotification(");
  });

  it("con muchos productos a la vez muestra un solo resumen", () => {
    expect(hook).toContain("if (cruzaron.length > 3) {");
    expect(hook).toContain('id: "stock-bajo-resumen"');
  });
});
