import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260822000004_canonical_margin_facts.sql"),
  "utf8",
);
const component = readFileSync(
  resolve(process.cwd(), "src/components/analytics/ChannelMarginTab.tsx"),
  "utf8",
);

describe("autoridad canónica de margen", () => {
  it("conserva todas las ventas y no usa el costo actual para reescribir historia", () => {
    expect(migration).toContain("FROM public.sales sale");
    expect(migration).not.toContain("JOIN public.products");
    expect(migration).toContain("coalesce(sale.cost_of_goods_ars, 0) > 0");
    expect(migration).toContain("WHEN known_components = 4");
    expect(migration).toContain("contribution_margin_ars");
    expect(migration).toContain("missing_components");
  });

  it("declara la procedencia de costo, cobro, envío e IVA", () => {
    expect(migration).toContain("cogs_source");
    expect(migration).toContain("payment_fee_source");
    expect(migration).toContain("shipping_cost_source");
    expect(migration).toContain("tax_source");
    expect(migration).toContain("ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING");
    expect(migration).toContain("cash_not_applicable");
    expect(migration).toContain("pos_not_applicable");
  });

  it("separa la vista tenant del agregado sanitizado de plataforma", () => {
    expect(migration).toContain("public.is_org_member(source.org_id, auth.uid())");
    expect(migration).toContain("public.is_platform_admin(auth.uid())");
    expect(migration).toContain("REVOKE ALL ON TABLE public._sale_margin_facts_source FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("REVOKE ALL ON TABLE public.sale_margin_facts FROM PUBLIC, anon");
    expect(migration).toContain("REVOKE ALL ON TABLE public.platform_org_margin_coverage FROM PUBLIC, anon");
  });

  it("hace que la UI lea una sola autoridad y no vuelva a cruzar tablas crudas", () => {
    expect(component).toContain('.from("sale_margin_facts")');
    expect(component).not.toContain('.from("sales")');
    expect(component).not.toContain("store_order_margin_facts");
    expect(component).not.toContain("meli_order_sale_lines");
    expect(component).toContain("Pendiente");
  });
});
