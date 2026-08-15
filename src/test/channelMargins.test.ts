import { describe, expect, it } from "vitest";
import { buildChannelMarginLines, summarizeChannelMargins } from "@/lib/channelMargins";

describe("margen por canal", () => {
  it("sólo declara un margen completo cuando los cuatro conceptos están medidos", () => {
    const lines = buildChannelMarginLines(
      [
        { id: "ml", product_id: "p", product_name: "Producto", source: "mercadolibre", quantity: 1, total_ars: 1000, cost_of_goods_ars: 400 },
        { id: "store", product_id: "p", product_name: "Producto", source: "tienda_online", quantity: 1, total_ars: 1000, cost_of_goods_ars: 400 },
      ],
      [{ sale_id: "store", payment_fee_ars: 50, carrier_shipping_cost_ars: 100, tax_ars: 210 }],
      [{ sale_id: "ml", sale_fee_ars: 130, seller_shipping_cost_ars: 120 }],
    );

    expect(lines.find(line => line.saleId === "ml")?.marginAfterMeasuredCostsARS).toBeNull();
    expect(lines.find(line => line.saleId === "store")?.marginAfterMeasuredCostsARS).toBe(240);
  });

  it("agrupa por producto y canal, preservando cero como dato y null como pendiente", () => {
    const lines = buildChannelMarginLines(
      [
        { id: "a", product_id: "p", product_name: "Producto", source: "mercadolibre", quantity: 1, total_ars: 100, cost_of_goods_ars: 20 },
        { id: "b", product_id: "p", product_name: "Producto", source: "mercadolibre", quantity: 2, total_ars: 200, cost_of_goods_ars: 40 },
      ],
      [],
      [
        { sale_id: "a", sale_fee_ars: 0, seller_shipping_cost_ars: 0 },
        { sale_id: "b", sale_fee_ars: 20, seller_shipping_cost_ars: 30 },
      ],
    );

    expect(summarizeChannelMargins(lines)).toEqual([{
      productId: "p", productName: "Producto", channel: "mercadolibre",
      lines: 2, units: 3, revenueARS: 300, cogsARS: 60,
      paymentFeeARS: 20, carrierShippingCostARS: 30, taxARS: null,
      marginAfterMeasuredCostsARS: null, pending: ["IVA por línea"],
    }]);
  });

  it("deja POS explícitamente incompleto hasta que exista la liquidación por venta", () => {
    const [summary] = summarizeChannelMargins(buildChannelMarginLines(
      [{ id: "pos", product_id: "p", product_name: "Producto", source: "pos", quantity: 1, total_ars: 500, cost_of_goods_ars: 200 }],
      [], [],
    ));

    expect(summary.marginAfterMeasuredCostsARS).toBeNull();
    expect(summary.pending).toEqual(["comisión de cobro", "IVA por línea"]);
  });
});
