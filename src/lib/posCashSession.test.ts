import { describe, expect, it } from "vitest";
import { summarizePosCashSession } from "./posCashSession";

describe("summarizePosCashSession", () => {
  it("cuenta un ticket aunque tenga dos medios de pago", () => {
    const summary = summarizePosCashSession(10_000, [
      { entry_type: "opening", payment_method: "efectivo", amount_ars: 10_000 },
      { entry_type: "sale_in", payment_method: "efectivo", amount_ars: 4_000, sale_transaction_id: "ticket-1" },
      { entry_type: "sale_in", payment_method: "credito", amount_ars: 6_000, sale_transaction_id: "ticket-1" },
    ]);

    expect(summary.ticketCount).toBe(1);
    expect(summary.salesTotal).toBe(10_000);
    expect(summary.cashNet).toBe(4_000);
    expect(summary.cardTotal).toBe(6_000);
    expect(summary.expectedCash).toBe(14_000);
  });

  it("resta devoluciones y egresos sólo del efectivo físico", () => {
    const summary = summarizePosCashSession(5_000, [
      { entry_type: "sale_in", payment_method: "efectivo", amount_ars: 8_000, reference_type: "sale", reference_id: "legacy" },
      { entry_type: "refund_out", payment_method: "efectivo", amount_ars: 2_000 },
      { entry_type: "expense_out", payment_method: "transferencia", amount_ars: 1_000 },
    ]);

    expect(summary.ticketCount).toBe(1);
    expect(summary.outflowsTotal).toBe(3_000);
    expect(summary.cashNet).toBe(6_000);
    expect(summary.expectedCash).toBe(11_000);
  });

  it("normaliza aliases y no deja que importes inválidos contaminen el cierre", () => {
    const summary = summarizePosCashSession("100", [
      { entry_type: "sale_in", payment_method: "bank_transfer", amount_ars: "250" },
      { entry_type: "sale_in", payment_method: "card", amount_ars: 300 },
      { entry_type: "sale_in", payment_method: "qr", amount_ars: 450 },
      { entry_type: "manual_in", payment_method: "cash", amount_ars: Number.NaN },
    ]);

    expect(summary.transferTotal).toBe(250);
    expect(summary.cardTotal).toBe(300);
    expect(summary.otherPaymentTotal).toBe(450);
    expect(summary.expectedCash).toBe(100);
  });

  it("hace visible un importe negativo inesperado en vez de ocultarlo", () => {
    const summary = summarizePosCashSession(500, [
      { entry_type: "sale_in", payment_method: "efectivo", amount_ars: -200 },
    ]);

    expect(summary.salesTotal).toBe(-200);
    expect(summary.cashNet).toBe(-200);
    expect(summary.expectedCash).toBe(300);
  });
});
