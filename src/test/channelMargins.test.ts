import { describe, expect, it } from "vitest";
import { summarizeChannelMargins, summarizeMarginCoverage, type CanonicalMarginFact } from "@/lib/channelMargins";

const fact = (overrides: Partial<CanonicalMarginFact> = {}): CanonicalMarginFact => ({
  sale_id: "sale-1",
  product_id: "product-1",
  product_name: "Producto",
  channel: "pos",
  quantity: 1,
  revenue_ars: 1000,
  cogs_ars: 400,
  payment_fee_ars: 50,
  shipping_cost_ars: 0,
  tax_ars: 210,
  contribution_margin_ars: 340,
  coverage_pct: 100,
  is_explainable: true,
  missing_components: [],
  ...overrides,
});

describe("margen canónico por canal", () => {
  it("agrupa importes persistidos sin recalcular un margen incompleto", () => {
    const summary = summarizeChannelMargins([
      fact(),
      fact({
        sale_id: "sale-2",
        quantity: 2,
        revenue_ars: 2000,
        cogs_ars: null,
        contribution_margin_ars: null,
        coverage_pct: 75,
        is_explainable: false,
        missing_components: ["costo_mercaderia"],
      }),
    ])[0];

    expect(summary.revenueARS).toBe(3000);
    expect(summary.units).toBe(3);
    expect(summary.cogsARS).toBeNull();
    expect(summary.paymentFeeARS).toBe(100);
    expect(summary.contributionMarginARS).toBeNull();
    expect(summary.coveragePct).toBe(87.5);
    expect(summary.pending).toEqual(["costo de mercadería"]);
  });

  it("conserva las ventas históricas sin producto ni canal confiable", () => {
    const [summary] = summarizeChannelMargins([
      fact({
        sale_id: "legacy",
        product_id: null,
        product_name: null,
        channel: "sin_atribuir",
        cogs_ars: null,
        shipping_cost_ars: null,
        tax_ars: null,
        contribution_margin_ars: null,
        coverage_pct: 25,
        is_explainable: false,
        missing_components: ["costo_mercaderia", "costo_envio_real", "iva"],
      }),
    ]);

    expect(summary.productId).toBe("line:legacy");
    expect(summary.productName).toBe("Producto sin nombre");
    expect(summary.channel).toBe("sin_atribuir");
    expect(summary.pending).toEqual(["costo de mercadería", "costo real de envío", "IVA"]);
  });

  it("mide cobertura de ingresos y de cada fuente por separado", () => {
    const coverage = summarizeMarginCoverage([
      fact(),
      fact({
        sale_id: "partial",
        revenue_ars: 3000,
        cogs_ars: null,
        shipping_cost_ars: null,
        tax_ars: null,
        contribution_margin_ars: null,
        coverage_pct: 25,
        is_explainable: false,
        missing_components: ["costo_mercaderia", "costo_envio_real", "iva"],
      }),
    ]);

    expect(coverage).toMatchObject({
      lines: 2,
      explainableLines: 1,
      revenueARS: 4000,
      explainableRevenueARS: 1000,
      explainableRevenuePct: 25,
      averageCoveragePct: 62.5,
      cogsKnownLines: 1,
      paymentFeeKnownLines: 2,
      shippingKnownLines: 1,
      taxKnownLines: 1,
    });
  });
});
