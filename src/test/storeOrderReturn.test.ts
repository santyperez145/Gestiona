import { describe, expect, it } from "vitest";
import {
  calcularDiasArrepentimiento,
  estaEnPlazoArrepentimiento,
  returnStatusLabel,
  returnStatusTone,
  returnTipoLabel,
} from "@/lib/storeOrderReturn";

describe("devoluciones y arrepentimiento legal en órdenes de ecommerce", () => {
  describe("calcularDiasArrepentimiento", () => {
    it("devuelve 10 días completos si la orden no fue entregada aún (delivered_at null)", () => {
      expect(calcularDiasArrepentimiento(null)).toBe(10);
      expect(calcularDiasArrepentimiento(undefined)).toBe(10);
      expect(calcularDiasArrepentimiento("")).toBe(10);
    });

    it("devuelve 10 días si la fecha entregada es inválida", () => {
      expect(calcularDiasArrepentimiento("fecha-invalida")).toBe(10);
    });

    it("calcula los días restantes descontando desde la entrega", () => {
      const now = new Date("2026-09-10T12:00:00Z");
      // Entregado hace 3 días exactos
      const delivered3DaysAgo = "2026-09-07T12:00:00Z";
      expect(calcularDiasArrepentimiento(delivered3DaysAgo, now)).toBe(7);

      // Entregado hace 9 días
      const delivered9DaysAgo = "2026-09-01T12:00:00Z";
      expect(calcularDiasArrepentimiento(delivered9DaysAgo, now)).toBe(1);

      // Entregado hace 10 días exactos
      const delivered10DaysAgo = "2026-08-31T12:00:00Z";
      expect(calcularDiasArrepentimiento(delivered10DaysAgo, now)).toBe(0);

      // Entregado hace 15 días (plazo expirado, no da negativo)
      const delivered15DaysAgo = "2026-08-26T12:00:00Z";
      expect(calcularDiasArrepentimiento(delivered15DaysAgo, now)).toBe(0);
    });
  });

  describe("estaEnPlazoArrepentimiento", () => {
    it("devuelve true si restan días", () => {
      const now = new Date("2026-09-10T12:00:00Z");
      expect(estaEnPlazoArrepentimiento("2026-09-05T12:00:00Z", now)).toBe(true);
      expect(estaEnPlazoArrepentimiento(null, now)).toBe(true);
    });

    it("devuelve false si expiró el plazo", () => {
      const now = new Date("2026-09-10T12:00:00Z");
      expect(estaEnPlazoArrepentimiento("2026-08-20T12:00:00Z", now)).toBe(false);
    });
  });

  describe("etiquetas y tonos", () => {
    it("formatea correctamente los estados", () => {
      expect(returnStatusLabel("pending")).toBe("Pendiente");
      expect(returnStatusLabel("approved")).toBe("Aprobado");
      expect(returnStatusLabel("rejected")).toBe("Rechazado");
      expect(returnStatusLabel("received")).toBe("Mercadería recibida");
      expect(returnStatusLabel("refunded")).toBe("Reintegrado");
      expect(returnStatusLabel("desconocido")).toBe("desconocido");
    });

    it("formatea correctamente el tipo legal", () => {
      expect(returnTipoLabel("arrepentimiento")).toBe("Arrepentimiento (Ley 24.240)");
      expect(returnTipoLabel("falla")).toBe("Falla / Garantía legal");
    });

    it("asigna tonos semánticos a los estados", () => {
      expect(returnStatusTone("pending")).toContain("amber");
      expect(returnStatusTone("approved")).toContain("blue");
      expect(returnStatusTone("resolved")).toContain("emerald");
      expect(returnStatusTone("rejected")).toContain("destructive");
    });
  });
});
