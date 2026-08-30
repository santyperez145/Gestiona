import { describe, expect, it } from "vitest";
import {
  allocateSalesReturnRefund,
  salesReturnLineAmount,
  salesReturnTotal,
  type SalesReturnPreviewLine,
  type SalesReturnPreviewPayment,
} from "@/lib/salesReturn";

const line: SalesReturnPreviewLine = {
  sale_id: "sale-1",
  product_id: "product-1",
  variant_id: null,
  product_name: "Producto",
  sold_quantity: 3,
  returned_quantity: 0,
  available_quantity: 3,
  sold_amount: 100,
  returned_amount: 0,
  available_amount: 100,
  unit_refund_amount: 33.33,
  invoice_id: null,
  paid: true,
};

const payment = (
  id: string,
  saleMethod: string,
  available: number,
): SalesReturnPreviewPayment => ({
  payment_transaction_id: id,
  sale_method: saleMethod,
  provider: saleMethod,
  method: saleMethod,
  paid_amount: available,
  refunded_amount: 0,
  available_amount: available,
  execution_mode: saleMethod === "efectivo" ? "cash" : "manual_external",
});

describe("salesReturn", () => {
  it("calcula parciales y deja el redondeo exacto en la última unidad", () => {
    expect(salesReturnLineAmount(line, 1)).toBe(33.33);
    expect(salesReturnLineAmount(line, 2)).toBe(66.67);
    expect(salesReturnLineAmount(line, 3)).toBe(100);
    expect(salesReturnLineAmount(line, 99)).toBe(100);
  });

  it("suma únicamente los renglones seleccionados", () => {
    const second = { ...line, sale_id: "sale-2", sold_amount: 50, available_amount: 50 };
    expect(salesReturnTotal([line, second], { "sale-1": 1, "sale-2": 3 })).toBe(83.33);
  });

  it("reparte un reintegro sobre el split original y conserva centavos", () => {
    expect(allocateSalesReturnRefund([
      payment("cash", "efectivo", 5000),
      payment("transfer", "transferencia", 5000),
    ], 3333.33)).toEqual([
      { payment_transaction_id: "cash", sale_method: "efectivo", amount: 1666.67 },
      { payment_transaction_id: "transfer", sale_method: "transferencia", amount: 1666.66 },
    ]);
  });

  it("no inventa un reintegro cuando el saldo de cobros no alcanza", () => {
    expect(allocateSalesReturnRefund([payment("cash", "efectivo", 20)], 20.02)).toEqual([]);
    expect(allocateSalesReturnRefund([], 10)).toEqual([]);
  });
});
