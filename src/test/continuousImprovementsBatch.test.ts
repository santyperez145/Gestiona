import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const storeCart = readFileSync(resolve(root, "src/storefront/StoreCart.tsx"), "utf8");
const influencerPayments = readFileSync(resolve(root, "src/pages/InfluencerPaymentsPage.tsx"), "utf8");

describe("mejoras continuas: barra de envio gratis en carrito y datos de cobro en retiros", () => {
  it("muestra la barra de progreso de envío gratis dinámico en el carrito de la tienda", () => {
    expect(storeCart).toContain("freeShippingThreshold > 0");
    expect(storeCart).toContain("freeShippingPct");
    expect(storeCart).toContain("¡Sumá");
    expect(storeCart).toContain("más para tener");
    expect(storeCart).toContain("Envío Gratis");
    expect(storeCart).toContain("¡Genial! Tu pedido tiene Envío Gratis");
  });

  it("la tabla de retiros de influencers muestra los datos de cobro cargados por el creador", () => {
    expect(influencerPayments).toContain("Datos de cobro");
    expect(influencerPayments).toContain("w.notes || 'Sin datos cargados'");
  });
});
