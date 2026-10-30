import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { saldoDesdeRespuesta } from "@/storefront/useSaldoTienda";
import { avisoCheckoutMedioPago, etiquetaMedioCheckout } from "@/lib/storeOrderBuyerCopy";

describe("cambios y saldo a favor online: la base decide", () => {
  const sql = readFileSync("supabase/migrations/20261030000200_cambios_y_saldo_online.sql", "utf8");

  it("el cambio respeta el plazo de la tienda y exige el detalle", () => {
    expect(sql).toContain("IF v_store.plazo_cambio_dias = 0 THEN");
    expect(sql).toContain("IF now() > v_order.created_at + make_interval(days => v_store.plazo_cambio_dias) THEN");
    expect(sql).toContain("CHECK (tipo IN ('arrepentimiento', 'falla', 'cambio'))");
  });

  it("el crédito de una devolución entra al saldo una sola vez", () => {
    expect(sql).toContain("ON public.saldo_a_favor_movimientos(return_request_id) WHERE return_request_id IS NOT NULL;");
    expect(sql).toContain("ON CONFLICT (return_request_id) WHERE return_request_id IS NOT NULL DO NOTHING;");
  });

  it("pagar con saldo: cerradura por cliente, saldo suficiente y pedido pagado por su total", () => {
    expect(sql).toContain("PERFORM pg_advisory_xact_lock(hashtextextended('saldo_a_favor:' || v_cliente_saldo::text, 0));");
    expect(sql).toContain("IF v_saldo < v_total THEN");
    expect(sql).toContain("PERFORM public.mark_store_order_paid(v_order_id, 'saldo-' || (v_resultado->>'order_number'), 'saldo_a_favor');");
  });

  it("los medios internos nunca son públicos", () => {
    expect(sql).toContain("AND m NOT IN ('stripe', 'paypal', 'cuenta_corriente', 'saldo_a_favor')");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.cliente_del_comprador(uuid) FROM PUBLIC, anon, authenticated;");
  });

  it("una base reconstruida queda con customer_id como producción", () => {
    expect(sql).toContain("ALTER TABLE public.return_requests RENAME COLUMN client_id TO customer_id;");
  });
});

describe("saldo del comprador en la tienda", () => {
  it("lee la respuesta sin confiar en su forma", () => {
    expect(saldoDesdeRespuesta({ saldo: "1500.5", plazo_cambio_dias: 30 })).toEqual({ saldo: 1500.5, plazoCambioDias: 30 });
    expect(saldoDesdeRespuesta({ saldo: -200, plazo_cambio_dias: 0 })).toEqual({ saldo: 0, plazoCambioDias: 0 });
    expect(saldoDesdeRespuesta(null)).toEqual({ saldo: 0, plazoCambioDias: 0 });
    expect(saldoDesdeRespuesta({ saldo: "x", plazo_cambio_dias: "y" })).toEqual({ saldo: 0, plazoCambioDias: 0 });
  });

  it("el checkout nombra el medio y avisa que queda pagado", () => {
    expect(etiquetaMedioCheckout("saldo_a_favor", false)).toBe("Con mi saldo a favor");
    expect(avisoCheckoutMedioPago({ metodo: "saldo_a_favor", esRetiro: true })).toContain("queda pagado");
  });
});
