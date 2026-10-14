import { describe, it, expect } from "vitest";
import fs from "node:fs";

// 2026-10-14 (páginas legacy, pedido del dueño): los links de pago se cargaban
// a mano y, cuando Mercado Pago los aprobaba, el webhook sólo los marcaba
// pagados: la venta no existía, no bajaba stock ni aparecía en reportes.
describe("links de pago", () => {
  const pagina = fs.readFileSync("src/pages/PaymentLinksPage.tsx", "utf8");
  const webhook = fs.readFileSync("supabase/functions/mercadopago-webhook/index.ts", "utf8");
  const sql = fs.readFileSync("supabase/migrations/20261014001100_link_de_pago_registra_la_venta.sql", "utf8");

  it("los ítems salen del catálogo (o por código) y guardan el producto", () => {
    expect(pagina).toContain("<ProductCombobox<ProductoDeLink>");
    expect(pagina).toContain("productoPorCodigo(catalogo ?? [], codigo)");
    expect(pagina).toContain("...(i.productId ? { productId: i.productId } : {}),");
  });

  it("un error al leer los links se avisa en vez de mostrar la lista vacía", () => {
    expect(pagina).toContain("if (linksError) throw linksError;");
  });

  it("el webhook registra la venta sólo de links propios y con el pago aprobado; si falla, MP reintenta", () => {
    expect(webhook).toContain('if (isApproved && /^link[-:]/.test(externalRef)) {');
    expect(webhook).toContain('admin.rpc("registrar_venta_de_link", { p_link_id: link.id })');
    expect(webhook).toContain("throw new ReintentarWebhook(`registrar_venta_de_link: ${ventaErr.message}`);");
  });

  it("la base: sólo el servidor la llama, es idempotente y nunca rechaza un cobro ya hecho por datos del ítem", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.registrar_venta_de_link\(uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.registrar_venta_de_link(uuid) TO service_role;");
    expect(sql).toContain("IF l.sale_transaction_id IS NOT NULL THEN");
    expect(sql).toContain("'link_de_pago'");
    // Un producto ajeno o una cantidad inválida pasa a renglón libre, no a error.
    expect(sql).toContain("v_libres := v_libres || to_jsonb(");
  });
});
