import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const leer = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const migracion = leer("supabase/migrations/20260901000020_checkout_sin_pay_muerto.sql");
const migracionCanonico = leer("supabase/migrations/20260902000030_gestiona_pay_medio_canonico.sql");
const storeBySlug = leer("src/storefront/storeContext.tsx");
const checkout = leer("src/storefront/StoreCheckout.tsx");
const readiness = leer("src/lib/storeReadiness.ts");

/**
 * Gestiona Pay conectado y el medio marcado en la tienda no son lo mismo.
 * Si el checkout lista un medio que store-pay no puede cobrar, el comprador
 * llega al final y la plataforma parece rota.
 */
describe("checkout sin Pay muerto", () => {
  it("la vitrina pública filtra los medios, no el interruptor del comercio", () => {
    expect(migracion).toContain("public.medios_de_pago_vivos(s.org_id, s.payment_methods)");
    expect(migracion).toContain("CREATE OR REPLACE FUNCTION public.get_store_by_slug");
    expect(migracion).not.toMatch(/UPDATE\s+public\.ecommerce_stores[\s\S]{0,80}payment_methods/);
  });

  it("Gestiona Pay exige token y medio habilitado, no sólo el toggle", () => {
    expect(migracion).toContain("FROM public.payment_connections c");
    expect(migracion).toContain("c.access_token IS NOT NULL");
    expect(migracion).toContain("o.habilitado");
    expect(migracion).toContain("o.conectado_at IS NOT NULL");
  });

  it("Stripe y PayPal no salen aunque hayan quedado en un array viejo", () => {
    expect(migracion).toContain("NOT IN ('stripe', 'paypal')");
  });

  it("una orden no entra con un rail que no se puede cobrar; gestiona_pay es canónico", () => {
    expect(migracion).toContain("BEFORE INSERT ON public.ecommerce_orders");
    expect(migracion).toContain("Gestiona Pay no está activo");
    expect(migracion).toContain("NEW.payment_method IN ('stripe', 'paypal')");
    expect(migracionCanonico).toContain("NEW.payment_method IN ('mercadopago', 'gestiona_pay')");
    expect(migracionCanonico).toContain("THEN 'gestiona_pay'");
  });

  it("las funciones internas no quedan llamables por anon", () => {
    expect(migracion).toMatch(
      /REVOKE ALL ON FUNCTION public\.gestiona_pay_listo\(uuid\) FROM PUBLIC/,
    );
    expect(migracion).toMatch(
      /REVOKE ALL ON FUNCTION public\.medios_de_pago_vivos\(uuid, text\[\]\) FROM PUBLIC/,
    );
  });

  it("el cliente no vuelve a inventar transferencia si la lista viene vacía", () => {
    expect(storeBySlug).toContain("mediosDePagoOfrecibles(row.payment_methods)");
    expect(checkout).toContain("mediosDePagoOfrecibles(store?.payment_methods)");
    expect(checkout).not.toContain('["transferencia"]');
    expect(readiness).toContain("id: 'pay-rail'");
  });

  it("transferencia sin CBU/alias no sale en la vitrina ni entra como orden", () => {
    const viva = leer("supabase/migrations/20260902000140_transferencia_viva_y_publicar.sql");
    expect(viva).toContain("CREATE OR REPLACE FUNCTION public.transferencia_tienda_lista");
    expect(viva).toContain("m <> 'transferencia'");
    expect(viva).toContain("OR public.transferencia_tienda_lista(p_org_id)");
    expect(viva).toContain("Faltan CBU o alias para cobrar por transferencia");
    expect(viva).toContain("CREATE OR REPLACE FUNCTION public.medios_de_pago_vivos");
  });

  it("la fixture reversible vive junto a la migración", () => {
    const fixture = leer("supabase/verificaciones/20260901_checkout_sin_pay_muerto.sql");
    expect(fixture).toContain("ROLLBACK");
    expect(fixture).toContain("mp_ofrecido_sin_pay");
    expect(fixture).toContain("anon_pay_listo");
  });
});
