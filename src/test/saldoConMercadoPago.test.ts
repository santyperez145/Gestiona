import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { acreditarPagoDePedido, montoACobrar, saldoAplicadoDe } from "../../supabase/functions/_shared/saldoDelPedido";

/** Un admin de Supabase mínimo: una lectura de pedidos y dos RPC. */
function admin(opciones: {
  lectura?: { data: unknown; error: unknown };
  rpc?: Record<string, { data: unknown; error: unknown }>;
}) {
  const rpc = vi.fn(async (nombre: string, _argumentos?: Record<string, unknown>) =>
    opciones.rpc?.[nombre] ?? { data: null, error: null });
  const consulta = {
    select: () => consulta,
    eq: () => consulta,
    maybeSingle: async () => opciones.lectura ?? { data: null, error: null },
  };
  return { from: () => consulta, rpc };
}

describe("saldo a favor combinado con Nerqia Pay", () => {
  it("Mercado Pago cobra el total menos el saldo aplicado", () => {
    expect(montoACobrar(60000, 40000)).toBe(20000);
    expect(montoACobrar(1000, 0)).toBe(1000);
    expect(montoACobrar(1000, 1000)).toBe(0);
    expect(montoACobrar(100.1, 33.37)).toBe(66.73);
  });

  it("lee el saldo aplicado; sin la columna todavía es cero, otro error se propaga", async () => {
    expect(await saldoAplicadoDe(admin({ lectura: { data: { saldo_aplicado_ars: "300.50" }, error: null } }), "zz")).toBe(300.5);
    expect(await saldoAplicadoDe(admin({ lectura: { data: null, error: { code: "42703" } } }), "zz")).toBe(0);
    await expect(saldoAplicadoDe(admin({ lectura: { data: null, error: { code: "57014", message: "timeout" } } }), "zz"))
      .rejects.toMatchObject({ code: "57014" });
  });

  it("acredita con el importe que informó Mercado Pago y respeta lo que decide la base", async () => {
    const acreditado = admin({ rpc: { acreditar_pago_de_pedido: { data: { ok: true }, error: null } } });
    const r1 = await acreditarPagoDePedido(acreditado, { orderId: "zz-o", paymentId: "zz-p", monto: 20000 });
    expect(r1).toMatchObject({ acreditado: true, error: null });
    expect(acreditado.rpc).toHaveBeenCalledWith("acreditar_pago_de_pedido", {
      p_order_id: "zz-o", p_payment_id: "zz-p", p_monto: 20000, p_method: "mercado_pago",
    });

    const distinto = admin({ rpc: { acreditar_pago_de_pedido: { data: { ok: false, motivo: "monto_distinto" }, error: null } } });
    expect(await acreditarPagoDePedido(distinto, { orderId: "zz-o", paymentId: "zz-p", monto: 500 }))
      .toMatchObject({ acreditado: false, error: null });

    // Un importe que no es un número positivo no se manda: decide la base.
    const sinMonto = admin({ rpc: { acreditar_pago_de_pedido: { data: { ok: true }, error: null } } });
    await acreditarPagoDePedido(sinMonto, { orderId: "zz-o", paymentId: "zz-p", monto: 0 });
    expect(sinMonto.rpc.mock.calls[0][1]).toMatchObject({ p_monto: null });
  });

  it("si la base todavía no tiene la función, acredita por el camino de siempre", async () => {
    const vieja = admin({ rpc: {
      acreditar_pago_de_pedido: { data: null, error: { code: "PGRST202", message: "not found" } },
      mark_store_order_paid: { data: { ok: true }, error: null },
    } });
    expect(await acreditarPagoDePedido(vieja, { orderId: "zz-o", paymentId: "zz-p", monto: 1000 }))
      .toMatchObject({ acreditado: true, error: null });
    expect(vieja.rpc).toHaveBeenLastCalledWith("mark_store_order_paid", {
      p_order_id: "zz-o", p_payment_id: "zz-p", p_method: "mercado_pago",
    });

    const caida = admin({ rpc: { acreditar_pago_de_pedido: { data: null, error: { code: "08006", message: "conexión" } } } });
    expect(await acreditarPagoDePedido(caida, { orderId: "zz-o", paymentId: "zz-p", monto: 1000 }))
      .toMatchObject({ acreditado: false, error: { code: "08006" } });
    expect(caida.rpc).toHaveBeenCalledTimes(1);
  });

  it("store-pay, el webhook y el email usan lo que resta", () => {
    const storePay = readFileSync("supabase/functions/store-pay/index.ts", "utf8");
    expect(storePay).toContain("const cobrar = montoACobrar(total, saldoAplicado);");
    expect(storePay).toContain("total_amount: String(order.cobrar),");
    expect(storePay).toContain("return json({ publicKey, amount: order.cobrar });");
    expect(storePay).toContain("acreditarPagoDePedido(admin, { orderId: order.id, paymentId, monto: providerAmount })");
    expect(storePay).not.toContain('admin.rpc("mark_store_order_paid"');
    const webhook = readFileSync("supabase/functions/mercadopago-webhook/index.ts", "utf8");
    expect(webhook).toContain("acreditarPagoDePedido(admin, {");
    expect(webhook).toContain("if (!paidErr && acreditacion.acreditado) {");
    expect(webhook).not.toContain('admin.rpc("mark_store_order_paid"');
    expect(readFileSync("supabase/functions/store-order-email/index.ts", "utf8"))
      .toContain('import { montoACobrar, saldoAplicadoDe } from "../_shared/saldoDelPedido.ts";');
  });

  it("la base acredita según el importe, vence pagos abiertos y reintegra lo que cobró Mercado Pago", () => {
    const sql = readFileSync("supabase/migrations/20261030001700_saldo_con_mercado_pago.sql", "utf8");
    expect(sql).toContain("BEFORE INSERT ON public.payment_intents");
    expect(sql).toContain("IF abs(round(p_monto, 2) - v_cobrar) <= 0.01 THEN");
    expect(sql).toContain("IF v_saldo > 0 AND abs(round(p_monto, 2) - v_total) <= 0.01 THEN");
    expect(sql).toContain("'motivo', 'monto_distinto'");
    expect(sql).toContain("PERFORM public.vencer_intentos_de_pago_del_pedido(NEW.id);");
    expect(sql).toContain("una devolución parcial se resuelve con saldo a favor");
    expect(sql).toContain("WHEN v_total_refund >= round(v_order.total - COALESCE(v_order.saldo_aplicado_ars, 0), 2) THEN 'refunded'");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.acreditar_pago_de_pedido(uuid, text, numeric, text) TO service_role;");
  });

  it("el checkout no abre Mercado Pago si el saldo cubrió todo o si no se pudo aplicar", () => {
    const checkout = readFileSync("src/storefront/StoreCheckout.tsx", "utf8");
    expect(checkout).toContain("if (esMedioGestionaPay(form.metodo) && !saldoCubrioTodo && !saldoError) {");
    expect(readFileSync("src/storefront/StoreOrder.tsx", "utf8")).toContain("Pagar con tarjeta {fmt(aPagar)}");
  });
});
