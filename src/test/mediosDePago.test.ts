import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { nombreDelMedio } from "@/lib/mediosDePago";

// 2026-10-15, recorriendo la app publicada: Ventas mostraba «Mercado_pago».
describe("nombre del medio de pago", () => {
  it("los códigos guardados se muestran con su nombre", () => {
    expect(nombreDelMedio("mercado_pago")).toBe("Mercado Pago");
    expect(nombreDelMedio("credito")).toBe("Tarjeta de crédito");
    expect(nombreDelMedio("fiado")).toBe("Fiado (cuenta corriente)");
    expect(nombreDelMedio(null)).toBe("Efectivo");
    expect(nombreDelMedio("billetera_virtual")).toBe("Billetera virtual");
  });
  it("Ventas no muestra el código crudo", () => {
    const ventas = fs.readFileSync("src/pages/SalesPage.tsx", "utf8");
    expect(ventas).not.toContain("{s.payment_method || 'efectivo'}");
    expect(ventas).not.toContain("🏷️");
  });
});
