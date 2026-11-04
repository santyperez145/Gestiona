import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { combinaConSaldo, DIAS_RESERVA_SALDO, repartoDelSaldo, textoEstadoDelSaldo, textoUsarSaldo } from "@/lib/saldoParcial";

const fmt = (n: number) => `$ ${n.toLocaleString("es-AR")}`;

describe("saldo a favor parcial en los pedidos online", () => {
  it("reparte lo que paga el saldo y lo que resta", () => {
    expect(repartoDelSaldo(300, 1000)).toEqual({ aplicado: 300, resta: 700 });
    expect(repartoDelSaldo(5000, 1000)).toEqual({ aplicado: 1000, resta: 0 });
    expect(repartoDelSaldo(-10, 1000)).toEqual({ aplicado: 0, resta: 1000 });
  });

  it("se combina con transferencia, efectivo o Nerqia Pay", () => {
    expect(combinaConSaldo("transferencia")).toBe(true);
    expect(combinaConSaldo(" Efectivo ")).toBe(true);
    expect(combinaConSaldo("gestiona_pay")).toBe(true);
    expect(combinaConSaldo("mercadopago")).toBe(true);
    expect(combinaConSaldo("saldo_a_favor")).toBe(false);
    expect(combinaConSaldo("cuenta_corriente")).toBe(false);
  });

  it("le dice al comprador cuánto paga y cómo", () => {
    expect(textoUsarSaldo(40000, 60000, "transferencia", fmt)).toBe("Usar mi saldo a favor ($ 40.000) y pagar $ 20.000 por transferencia");
    expect(textoUsarSaldo(40000, 60000, "efectivo", fmt)).toBe("Usar mi saldo a favor ($ 40.000) y pagar $ 20.000 en efectivo");
    expect(textoUsarSaldo(40000, 60000, "gestiona_pay", fmt)).toBe("Usar mi saldo a favor ($ 40.000) y pagar $ 20.000 con Nerqia Pay");
    expect(textoUsarSaldo(80000, 60000, "transferencia", fmt)).toBe("Usar mi saldo a favor ($ 60.000): cubre todo el pedido");
  });

  it("la base aplica una vez, devuelve si no se paga y reparte venta y asiento", () => {
    const sql = readFileSync("supabase/migrations/20261030001400_saldo_parcial_en_pedidos.sql", "utf8");
    expect(sql).toContain("IF COALESCE(v_order.saldo_aplicado_ars, 0) > 0 THEN");
    expect(sql).toContain("PERFORM pg_advisory_xact_lock(hashtextextended('saldo_a_favor:' || v_cliente::text, 0));");
    expect(sql).toContain("format('Devolución del saldo aplicado al pedido %s', NEW.order_number)");
    expect(sql).toContain("jsonb_build_object('method', 'saldo_a_favor', 'amount', v_parte)");
    expect(sql).toContain("jsonb_build_object('cuenta', '1.2.01', 'debe', v_saldo,");
  });

  it("un pedido impago reserva el saldo y lo devuelve sólo cuando corresponde", () => {
    const sql = readFileSync("supabase/migrations/20261030001500_saldo_reservado_en_pedidos.sql", "utf8");
    expect(sql).toContain("BEFORE UPDATE OF payment_status, fulfillment_status ON public.ecommerce_orders");
    // Cancelado sin pagar: vuelve y el pedido deja de tenerlo aplicado.
    expect(sql).toContain("AND NEW.payment_status IN ('pending', 'failed')");
    expect(sql).toContain("NEW.saldo_aplicado_ars := 0;");
    // El plazo de la base es el que lee el comprador.
    expect(sql).toContain(`AND m.created_at < now() - interval '${DIAS_RESERVA_SALDO} days'`);
    // Un contracargo lo decide el comercio.
    expect(sql).toContain("IF v_order.payment_status IS DISTINCT FROM 'charged_back' THEN");
    expect(sql).toContain("Este pedido ya usó tu saldo a favor y te lo devolvimos.");
  });

  it("le dice al comprador qué pasa con su saldo", () => {
    expect(textoEstadoDelSaldo("pending")).toBe("Si el pedido no se paga en 7 días, el saldo vuelve a tu cuenta.");
    expect(textoEstadoDelSaldo("failed")).toBe("Si el pedido no se paga en 7 días, el saldo vuelve a tu cuenta.");
    expect(textoEstadoDelSaldo("refunded")).toBe("Como el pedido se reintegró, ese saldo volvió a tu cuenta.");
    expect(textoEstadoDelSaldo("paid")).toBeNull();
    expect(textoEstadoDelSaldo("charged_back")).toBeNull();
  });

  it("el email pide transferir sólo lo que resta, aunque la columna no haya llegado", () => {
    const email = readFileSync("supabase/functions/store-order-email/index.ts", "utf8");
    expect(email).toContain("Transferí exactamente ${money(aPagar)}.");
    expect(email).toContain("order, itemsRows: rows, saldoAplicado,");
    expect(readFileSync("supabase/functions/_shared/saldoDelPedido.ts", "utf8"))
      .toContain('if (code === "42703" || code === "PGRST204") return 0;');
  });

  it("el checkout, la página del pedido y el panel lo muestran", () => {
    expect(readFileSync("src/storefront/StoreCheckout.tsx", "utf8")).toContain('supabase.rpc("aplicar_saldo_a_pedido" as never');
    // 2026-11-04: el importe de la transferencia se muestra con centavos si
    // los hay y se copia sin signo ni puntos; sigue siendo lo que resta
    // después del saldo (aPagar), no el total.
    const pedido = readFileSync("src/storefront/StoreOrder.tsx", "utf8");
    expect(pedido).toContain("value={importeVisibleTransferencia(aPagar, store?.currency)}");
    expect(pedido).toContain("copyValue={importeParaCopiar(aPagar)}");
    const ficha = readFileSync("src/components/ecommerce/StoreOrderInspector.tsx", "utf8");
    expect(ficha).toContain("Marcar como cobrado (${formatARS(aCobrar)})");
    expect(ficha).toContain('detail.order.payment_status === "charged_back" && (');
  });
});
