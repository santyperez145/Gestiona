import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canConfirmManualStorePayment, esPedidoACuentaCorriente, storeOrderManualPayActionLabel } from "@/lib/storeOrderPayment";

describe("pedido mayorista a cuenta corriente en el panel", () => {
  it("se aprueba sólo pendiente, con su propio texto", () => {
    expect(esPedidoACuentaCorriente("Cuenta_Corriente")).toBe(true);
    expect(canConfirmManualStorePayment({ payment_status: "pending", payment_method: "cuenta_corriente" })).toBe(true);
    expect(canConfirmManualStorePayment({ payment_status: "failed", payment_method: "cuenta_corriente" })).toBe(false);
    expect(storeOrderManualPayActionLabel({ payment_status: "pending", payment_method: "cuenta_corriente" })).toBe("Aprobar a cuenta");
    expect(storeOrderManualPayActionLabel({ payment_status: "pending", payment_method: "transferencia" })).toBe("Marcar cobrado");
  });

  it("la aprobación usa la función de la base, no la de cobro manual", () => {
    const panel = readFileSync("src/components/ecommerce/StoreOrdersWorkspace.tsx", "utf8");
    expect(panel).toContain('supabase.rpc("confirmar_pedido_cuenta_corriente" as never, { p_order_id: order.id } as never)');
    expect(panel).toContain("if (esPedidoACuentaCorriente(order.payment_method)) { await aprobarACuentaCorriente(order); return; }");
  });
});
