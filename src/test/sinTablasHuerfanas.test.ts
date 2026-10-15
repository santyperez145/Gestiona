import { describe, it, expect } from "vitest";
import fs from "node:fs";

// 2026-10-15: pantallas que leían tablas que nada escribe (siempre vacías, sin
// forma de cargarlas). IIBB ahora tiene alta; Monedas dejó las pestañas muertas.
describe("sin pantallas sobre tablas huérfanas", () => {
  it("IIBB se puede cargar, pausar y borrar", () => {
    const src = fs.readFileSync("src/pages/TaxManagementPage.tsx", "utf8");
    expect(src).toContain('supabase.from("iibb_registrations").insert(');
    expect(src).toContain('supabase.from("iibb_registrations").update({ active: !reg.active })');
    expect(src).toContain('supabase.from("iibb_registrations").delete()');
  });
  it("Monedas no lee exposición ni transacciones que nada llena", () => {
    const src = fs.readFileSync("src/pages/MultiCurrencyPage.tsx", "utf8");
    expect(src).not.toContain('"fx_exposure"');
    expect(src).not.toContain('"multi_currency_transactions"');
  });
});
