import { describe, it, expect } from "vitest";
import { areaDeRuta } from "@/lib/areaDeRuta";

// 2026-10-15: Cheques y Conciliación decían «Nerqia · Commerce».
describe("el encabezado dice el área de la pantalla", () => {
  it("usa el grupo del menú", () => {
    expect(areaDeRuta("/cheques")).toBe("Nerqia · Cobros y facturación");
    expect(areaDeRuta("/finance/banco")).toMatch(/^Nerqia/);
    expect(areaDeRuta("/no-existe")).toBe("Nerqia");
  });
});
