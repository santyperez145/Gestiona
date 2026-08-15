import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pos = readFileSync(resolve(process.cwd(), "src/pages/POSPage.tsx"), "utf8");

describe("POS y reservas de tienda", () => {
  it("consulta sólo reservas activas de órdenes online y conserva producto + variante", () => {
    expect(pos).toContain('.from("stock_reservations")');
    expect(pos).toContain('.eq("status", "active")');
    expect(pos).toContain('.not("order_id", "is", null)');
    expect(pos).toContain("reservationKey(reservation.product_id, reservation.variant_id)");
  });

  it("advierte antes de vender unidades apartadas, sin convertir la reserva en un bloqueo", () => {
    expect(pos).toContain("Esta venta usaría stock apartado para un pedido que espera pago.");
    expect(pos).toContain("Atención: esta venta consume stock reservado por pedido(s) online pendiente(s) de pago.");
    expect(pos).toContain("¿Confirmar igualmente?");
    expect(pos).toContain("recordMemberStockMovementDB");
  });
});
