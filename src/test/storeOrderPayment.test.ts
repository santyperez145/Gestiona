import { describe, expect, it } from "vitest";
import {
  canFulfillStoreOrder,
  canRetryStorePayment,
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

  it("expone etiquetas operativas en español", () => {
    expect(storeOrderPaymentLabel("refunded")).toBe("Pago devuelto");
    expect(storeOrderPaymentLabel("charged_back")).toBe("Contracargo");
  });
});
