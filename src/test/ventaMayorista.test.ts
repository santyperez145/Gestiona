import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("venta mayorista online: la base decide", () => {
  const sql = readFileSync("supabase/migrations/20261023000600_venta_mayorista.sql", "utf8");

  it("el carrito y el checkout aplican la lista del comprador aprobado", () => {
    expect(sql).toContain("public.cliente_mayorista_de_tienda(v_store_id), p_product_id, p_qty, v_base_mayorista");
    expect(sql).toContain("'mayorista', v_mayorista IS NOT NULL,");
  });

  it("el comprador no puede aprobarse solo ni vincularse a un cliente", () => {
    expect(sql).toContain("IF COALESCE(current_setting('nerqia.mayorista', true), '') = 'on' THEN");
    expect(sql).toContain("NEW.mayorista_estado := OLD.mayorista_estado;");
    expect(sql).toContain("PERFORM public.exigir_permiso(v_ficha.org_id, 'customers', 'edit', 'aprobar o rechazar una cuenta mayorista');");
  });

  it("la cuenta corriente no está en la lista pública y se valida en el checkout", () => {
    expect(sql).toContain("AND m NOT IN ('stripe', 'paypal', 'cuenta_corriente')");
    expect(sql).toContain("RAISE EXCEPTION 'La cuenta corriente no está habilitada para tu cuenta.'");
    expect(sql).toContain("v_comprometido := public.saldo_comprometido_cliente(v_cliente);");
  });

  it("al aprobar un pedido a cuenta nace la venta sin cobrar con su deuda", () => {
    expect(sql).toContain("v_customer_id, COALESCE(v_deudor, v_order.customer_name), now(), NOT v_a_cuenta,");
    expect(sql).toContain("INSERT INTO public.debts (");
    expect(sql).toContain("PERFORM public.exigir_permiso(v_order.org_id, 'ecommerce', 'edit', 'aprobar un pedido a cuenta corriente');");
  });

  it("los helpers no se pueden llamar desde afuera", () => {
    for (const fn of ["precio_lista_cliente(uuid, uuid, integer, numeric)", "cliente_mayorista_de_tienda(uuid)", "saldo_comprometido_cliente(uuid)"]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`);
    }
  });
});
