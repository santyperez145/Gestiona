import {
  canConfirmManualStorePayment,
  canFulfillStoreOrder,
  canRetryStorePayment,
  countActionableUnpaidOrders,
  HORAS_PAGO_DIGITAL_VIVO,
  isStorePaymentActionableNow,
  isStorePaymentReversed,
  storeOrderPaymentLabel,
} from "@/lib/storeOrderPayment";

describe("estados de pago de la tienda", () => {
  it("no confunde una reversión con un pedido que se puede cobrar o despachar", () => {
    for (const status of ["refunded", "charged_back"]) {
      expect(isStorePaymentReversed(status)).toBe(true);
      expect(canRetryStorePayment(status)).toBe(false);
      expect(canFulfillStoreOrder(status)).toBe(false);
    }
  });

  it("mantiene el reintento sólo para cobros sin acreditar", () => {
    expect(canRetryStorePayment("pending")).toBe(true);
    expect(canRetryStorePayment("failed")).toBe(true);
    expect(canRetryStorePayment("paid")).toBe(false);
    expect(canRetryStorePayment("partial")).toBe(false);
  });

  it("permite confirmar a mano transferencia/efectivo, no Nerqia Pay", () => {
    expect(canConfirmManualStorePayment({
      payment_status: "pending",
      payment_method: "transferencia",
    })).toBe(true);
    expect(canConfirmManualStorePayment({
      payment_status: "pending",
      payment_method: "efectivo",
    })).toBe(true);
    expect(canConfirmManualStorePayment({
      payment_status: "pending",
      payment_method: "gestiona_pay",
    })).toBe(false);
    expect(canConfirmManualStorePayment({
      payment_status: "pending",
      payment_method: "mercadopago",
    })).toBe(false);
    expect(canConfirmManualStorePayment({
      payment_status: "paid",
      payment_method: "transferencia",
    })).toBe(false);
  });

  it("expone etiquetas operativas en español", () => {
    expect(storeOrderPaymentLabel("refunded")).toBe("Pago devuelto");
    expect(storeOrderPaymentLabel("charged_back")).toBe("Contracargo");
  });

  it("el Foco no grita un Mercado Pago pendiente de hace un mes", () => {
    const ahora = new Date("2026-09-02T18:00:00.000Z");
    expect(isStorePaymentActionableNow({
      payment_status: "pending",
      payment_method: "mercadopago",
      created_at: "2026-07-29T18:12:40.003Z",
    }, ahora)).toBe(false);
    expect(isStorePaymentActionableNow({
      payment_status: "pending",
      payment_method: "gestiona_pay",
      created_at: new Date(ahora.getTime() - 2 * 3600e3).toISOString(),
    }, ahora)).toBe(true);
    expect(isStorePaymentActionableNow({
      payment_status: "pending",
      payment_method: "transferencia",
      created_at: "2026-07-29T18:11:54.878Z",
    }, ahora)).toBe(true);
    const medidos = countActionableUnpaidOrders([
      { payment_status: "pending", payment_method: "mercadopago", created_at: "2026-07-29T18:12:40.003Z" },
      { payment_status: "pending", payment_method: "mercadopago", created_at: "2026-07-30T04:49:58.716Z" },
      { payment_status: "pending", payment_method: "mercadopago", created_at: "2026-07-31T02:24:49.622Z" },
      { payment_status: "pending", payment_method: "transferencia", created_at: "2026-07-29T18:11:54.878Z" },
    ], ahora);
    expect(medidos).toBe(1);
    expect(HORAS_PAGO_DIGITAL_VIVO).toBe(72);
  });
});
