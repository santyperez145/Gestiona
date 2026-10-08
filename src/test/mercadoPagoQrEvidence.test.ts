import { afterEach, describe, expect, it, vi } from "vitest";
import { mercadoPagoQrEvidence, reconcileMercadoPagoPosQrOrder } from "../../supabase/functions/_shared/mercadoPagoOrders";

const order = () => ({
  id: "ORD_TEST", type: "qr", status: "processed", status_detail: "accredited",
  currency: "ARS", user_id: "123", external_reference: "posqr_TEST",
  total_amount: "100.25", total_paid_amount: "100.25",
  transactions: { payments: [{ id: "PAY_TEST", reference: { id: "456" },
    amount: "100.25", paid_amount: "100.25", status: "processed", status_detail: "accredited" }] },
});

afterEach(() => vi.unstubAllGlobals());

describe("provider QR payment evidence", () => {
  it("accepts complete accreditation and reads the official nested reference", () => {
    expect(mercadoPagoQrEvidence(order())).toMatchObject({ valid: true, paid: 100.25, paymentReference: "456" });
  });

  it.each([null, undefined, "", "NaN", "Infinity", "1e2", "100.251", "-100.25", "0", true, {}, "9999999999999999"])(
    "never treats invalid paid amount %s as money", (value) => {
      expect(mercadoPagoQrEvidence({ ...order(), total_paid_amount: value }).valid).toBe(false);
    },
  );

  it.each([
    { total_paid_amount: "50" }, { currency: "USD" }, { type: "online" },
    { status: "created" }, { status_detail: "partially_refunded" },
  ])("rejects incomplete or unrelated order %j", (change) => {
    expect(mercadoPagoQrEvidence({ ...order(), ...change }).valid).toBe(false);
  });

  it.each([
    { paid_amount: undefined }, { paid_amount: "50" }, { amount: "90" },
    { status: "pending" }, { status_detail: "partially_refunded" }, { id: "" },
  ])("rejects unaccredited payment %j", (change) => {
    const sample = order();
    const payment = { ...sample.transactions.payments[0], ...change };
    expect(mercadoPagoQrEvidence({ ...sample, transactions: { payments: [payment] } }).valid).toBe(false);
  });

  it("rejects multiple payments instead of inspecting only the first", () => {
    const sample = order();
    expect(mercadoPagoQrEvidence({ ...sample, transactions: { payments: [...sample.transactions.payments, ...sample.transactions.payments] } }).valid).toBe(false);
  });

  it("passes paid total and normalized evidence to the server, never falls back to requested total", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { state: "manual_review" }, error: null });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await reconcileMercadoPagoPosQrOrder({ rpc }, "fixture-token", "SESSION", { ...order(), total_paid_amount: undefined });
    expect(fetch).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("pos_qr_apply_provider", expect.objectContaining({
      p_gross: null, p_net: null,
      p_raw: expect.objectContaining({ order_total_amount: 100.25, order_paid_amount: null, provider_merchant_id: "123" }),
    }));
  });

  it.each([
    { id: 999 }, { status: "pending" }, { currency_id: "USD" },
    { transaction_amount: 50 }, { collector_id: 999 },
  ])("does not invent a settlement from unrelated legacy payment %j", async (change) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 456, status: "approved", currency_id: "ARS", transaction_amount: 100.25,
      collector_id: 123, transaction_details: { net_received_amount: 90 }, ...change,
    }), { status: 200 })));
    const rpc = vi.fn().mockResolvedValue({ data: { state: "completed" }, error: null });
    await reconcileMercadoPagoPosQrOrder({ rpc }, "fixture-token", "SESSION", order());
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_net: null, p_raw: { settlement_source: "payments_api_evidence_mismatch" } });
  });

  it("looks up the payment reference and accepts only the matching settlement", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 456, status: "approved", currency_id: "ARS", transaction_amount: 100.25,
      collector_id: 123, transaction_details: { net_received_amount: 90 },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const rpc = vi.fn().mockResolvedValue({ data: { state: "completed" }, error: null });
    await reconcileMercadoPagoPosQrOrder({ rpc }, "fixture-token", "SESSION", order());
    expect(fetch).toHaveBeenCalledWith("https://api.mercadopago.com/v1/payments/456", expect.anything());
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_payment_id: "456", p_gross: 100.25, p_net: 90 });
  });
});
