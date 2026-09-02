import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
