import { describe, it, expect, vi, beforeEach } from "vitest";
import { reserveStock, commitSale, releaseReservation } from "@/lib/posInventory";

describe("posInventory", () => {
  const mockRpc = vi.fn();

  beforeEach(() => {
    mockRpc.mockReset();
  });

  describe("reserveStock", () => {
    it("reserva stock exitosamente", async () => {
      mockRpc.mockResolvedValue({ data: { reservation_id: "r-123", available: 5, reserved: 1 } });
      const result = await reserveStock(mockRpc, { slug: "tienda", location_id: "loc-1", product_id: "p-1", quantity: 1 });
      expect(result.ok).toBe(true);
      expect(result.reservation_id).toBe("r-123");
    });

    it("rechaza cantidad negativa", async () => {
      const result = await reserveStock(mockRpc, { slug: "tienda", location_id: "loc-1", product_id: "p-1", quantity: -1 });
      expect(result.ok).toBe(false);
      expect(result.message).toBe("Cantidad inválida: debe ser un entero positivo.");
    });

    it("maneja error insuficiente stock", async () => {
      mockRpc.mockResolvedValue({ error: { message: "insufficient stock" } });
      const result = await reserveStock(mockRpc, { slug: "tienda", location_id: "loc-1", product_id: "p-1", quantity: 100 });
      expect(result.ok).toBe(false);
      expect(result.message).toBe("Sin stock disponible en esta ubicación.");
    });
  });

  describe("commitSale", () => {
    it("confirma la venta exitosamente", async () => {
      mockRpc.mockResolvedValue({ data: { sale_id: "s-456" } });
      const result = await commitSale(mockRpc, { slug: "tienda", reservation_id: "r-123" });
      expect(result.ok).toBe(true);
      expect(result.sale_id).toBe("s-456");
    });

    it("maneja error al confirmar", async () => {
      mockRpc.mockResolvedValue({ error: { message: "reservation not found" } });
      const result = await commitSale(mockRpc, { slug: "tienda", reservation_id: "r-inexistente" });
      expect(result.ok).toBe(false);
      expect(result.message).toBe("No se pudo confirmar la venta. El stock no se descuenta.");
    });
  });

  describe("releaseReservation", () => {
    it("libera la reserva exitosamente", async () => {
      mockRpc.mockResolvedValue({});
      const result = await releaseReservation(mockRpc, "tienda", "r-123");
      expect(result.ok).toBe(true);
    });
  });
});