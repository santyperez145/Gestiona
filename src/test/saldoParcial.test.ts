import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { combinaConSaldo, repartoDelSaldo, textoUsarSaldo } from "@/lib/saldoParcial";

const fmt = (n: number) => `$ ${n.toLocaleString("es-AR")}`;

describe("saldo a favor parcial en los pedidos online", () => {
  it("reparte lo que paga el saldo y lo que resta", () => {
    expect(repartoDelSaldo(300, 1000)).toEqual({ aplicado: 300, resta: 700 });
    expect(repartoDelSaldo(5000, 1000)).toEqual({ aplicado: 1000, resta: 0 });
    expect(repartoDelSaldo(-10, 1000)).toEqual({ aplicado: 0, resta: 1000 });
  });

  it("se combina con transferencia o efectivo (Mercado Pago, en un paso siguiente)", () => {
    expect(combinaConSaldo("transferencia")).toBe(true);
    expect(combinaConSaldo(" Efectivo ")).toBe(true);
    expect(combinaConSaldo("gestiona_pay")).toBe(false);
    expect(combinaConSaldo("saldo_a_favor")).toBe(false);
  });

  it("le dice al comprador cuánto paga y cómo", () => {
    expect(textoUsarSaldo(40000, 60000, "transferencia", fmt)).toBe("Usar mi saldo a favor ($ 40.000) y pagar $ 20.000 por transferencia");
    expect(textoUsarSaldo(40000, 60000, "efectivo", fmt)).toBe("Usar mi saldo a favor ($ 40.000) y pagar $ 20.000 en efectivo");
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

  it("el checkout, la página del pedido y el panel lo muestran", () => {
    expect(readFileSync("src/storefront/StoreCheckout.tsx", "utf8")).toContain('supabase.rpc("aplicar_saldo_a_pedido" as never');
    expect(readFileSync("src/storefront/StoreOrder.tsx", "utf8")).toContain('<CopyField label="Importe" value={fmt(aPagar)} />');
    expect(readFileSync("src/components/ecommerce/StoreOrderInspector.tsx", "utf8")).toContain("Marcar como cobrado (${formatARS(aCobrar)})");
  });
});
