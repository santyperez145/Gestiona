import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { fmtPct } from "@/lib/porcentaje";

// 2026-10-15: Análisis mostraba «Margen promedio 30.2%» con punto decimal.
describe("porcentajes con coma decimal", () => {
  it("se escriben como en Argentina", () => {
    expect(fmtPct(30.24)).toBe("30,2%");
    expect(fmtPct(-5)).toBe("-5,0%");
    expect(fmtPct(Number.NaN)).toBe("0,0%");
    expect(fmtPct(12.345, 2)).toBe("12,35%");
  });
  it("ninguna pantalla vuelve a mostrarlos con toFixed y punto", () => {
    let usos = "";
    try {
      usos = execSync(`git grep -n "toFixed(1)}%" -- src ":!src/test"`, { encoding: "utf8" }).trim();
    } catch (e) {
      if ((e as { status?: number }).status !== 1) throw e;
    }
    expect(usos).toBe("");
  }, 30_000);
});
