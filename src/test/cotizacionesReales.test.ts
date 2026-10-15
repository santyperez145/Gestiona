import { describe, it, expect } from "vitest";
import fs from "node:fs";

// 2026-10-15: «Actualizar tasas» sólo mostraba «Tasas actualizadas» sin traer nada.
describe("monedas y cotizaciones", () => {
  const src = fs.readFileSync("src/pages/MultiCurrencyPage.tsx", "utf8");
  it("el botón trae las cotizaciones de verdad y avisa si falla", () => {
    expect(src).not.toContain('toast.info("Tasas actualizadas")');
    expect(src).toContain("const r = await refrescarVivo();");
    expect(src).toContain('toast.error("No pudimos traer las cotizaciones');
  });
  it("sin tasas propias muestra las del día", () => {
    expect(src).toContain("useExchangeRates(true)");
  });
});
