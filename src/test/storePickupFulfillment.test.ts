import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { introPedidoPagado } from "@/lib/storeOrderBuyerCopy";

const ROOT = process.cwd();
const leer = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("retiro en tienda no es un despacho", () => {
  const migracion = leer("supabase/migrations/20260902000100_retiro_no_es_despacho.sql");
  const dialogo = leer("src/components/ecommerce/OrderShipmentDialog.tsx");
  const cola = leer("src/lib/storeOrderQueue.ts");

  it("la RPC cierra pickup sin etiqueta y no deja shipped en un retiro", () => {
    expect(migracion).toContain("CREATE OR REPLACE FUNCTION public.update_store_order_fulfillment");
    expect(migracion).toContain("El retiro en tienda no se despacha");
    expect(migracion).toContain("carrier");
    expect(migracion).toContain("sucursal");
    expect(migracion).toContain("Primero prepará el envío de la orden");
    expect(migracion).toContain("REVOKE ALL ON FUNCTION public.update_store_order_fulfillment");
    expect(migracion).toContain("GRANT EXECUTE ON FUNCTION public.update_store_order_fulfillment");
    expect(migracion).toContain("TO authenticated");
  });

  it("el diálogo de retiro marca retirado, no imprime etiqueta", () => {
    expect(dialogo).toContain("esPedidoRetiro");
    expect(dialogo).toContain("Marcar como retirado");
    expect(dialogo).toContain("Retiro de");
  });

  it("la cola tiene vista retirar distinta de despachar", () => {
    expect(cola).toContain('"retirar"');
    expect(cola).toContain("isStoreOrderAwaitingPickup");
    expect(cola).toContain("countFulfillmentPulse");
  });
});

describe("gracias y mail no prometen un envío en un retiro", () => {
  const horario = leer("supabase/migrations/20260902000120_horario_de_retiro.sql");
  const gracias = leer("src/storefront/StoreOrder.tsx");
  const mail = leer("supabase/functions/store-order-email/index.ts");
  const checkout = leer("src/storefront/StoreCheckout.tsx");

  it("la RPC pública expone horario y carrier al final, con DROP de firma", () => {
    expect(horario).toContain("DROP FUNCTION IF EXISTS public.get_store_by_slug(text)");
    expect(horario).toContain("pickup_instructions text");
    expect(horario).toContain("shipping_provinces text[],");
    expect(horario).toContain("DROP FUNCTION IF EXISTS public.get_store_order_secure");
    expect(horario).toContain("carrier text");
    expect(horario).toContain("shipping_service text");
    expect(horario).toContain("NULLIF(btrim(COALESCE(s.pickup_instructions, '')), '')");
  });

  it("la página de gracias usa el mismo criterio que la cola", () => {
    expect(gracias).toContain("esPedidoRetiro(order)");
    expect(gracias).toContain("introPedidoPagado(esRetiro)");
    expect(gracias).toContain("etiquetaCostoEntrega(esRetiro)");
    expect(gracias).toContain("etiquetaDireccionEntrega(esRetiro)");
    expect(gracias).toContain("textoWhatsAppPedido");
    expect(gracias).toContain("introPagoRevertido(esRetiro)");
    expect(gracias).not.toContain("Ya estamos preparando tu envío. Te escribimos");
    expect(gracias).not.toContain("Quedo atento para coordinar el pago.");
  });

  it("el mail al comprador no dice envío cuando el carrier es retiro", () => {
    expect(mail).toContain("function esPedidoRetiro");
    expect(mail).toContain("introPedidoPagado(esPedidoRetiro(order))");
    expect(mail).toContain(introPedidoPagado(true));
    expect(mail).toContain(introPedidoPagado(false));
    expect(mail).toContain("carrier, shipping_service");
    expect(mail).toContain("pickup_address, pickup_instructions");
  });

  it("el checkout muestra el horario sólo si el comercio lo cargó", () => {
    expect(checkout).toContain("store?.pickup_instructions?.trim()");
    expect(leer("src/pages/EcommerceStorePage.tsx")).toContain("pickup_instructions: storeForm.pickup_instructions");
  });

  it("el mail de estado no dice entregado/en camino en un retiro", () => {
    const status = leer("supabase/functions/store-order-status-email/index.ts");
    expect(status).toContain("function esPedidoRetiro");
    expect(status).toContain("copyEstadoPedido(event, retiro)");
    expect(status).toContain("Tu pedido fue retirado");
    expect(status).toContain("carrier, shipping_service");
  });

  it("el seguimiento público no promete envío en un retiro", () => {
    const tracking = leer("src/storefront/OrderTracking.tsx");
    const migracion = leer("supabase/migrations/20260902000130_seguimiento_retiro.sql");
    expect(tracking).toContain("pasosSeguimiento");
    expect(tracking).toContain("esRetiro");
    expect(tracking).not.toMatch(/const PASOS = \[[\s\S]*Preparando el envío/);
    expect(migracion).toContain("COALESCE(v_del.carrier, v_order.carrier)");
    expect(migracion).toContain("shipping_service");
    expect(leer("src/storefront/StoreOrder.tsx")).toContain("esRetiro={esRetiro}");
  });
});
