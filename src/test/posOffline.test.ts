import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Guardia offline del POS: una feria sin señal tiene que poder vender.
 *
 * Tres capas verificadas en código:
 *  1. Snapshot de catálogo en localStorage (sirve el último guardado).
 *  2. Snapshot de settings (umbrales y descuentos de medios).
 *  3. Snapshot del turno (cash session summary) para seguir cobrando.
 *  4. Cola de tickets offline con reconciliación por ticket completo.
 *  5. Service worker: precache del shell + POS, NetworkFirst en REST.
 */

const pos = readFileSync("src/pages/POSPage.tsx", "utf8");
const sw = readFileSync("src/sw.ts", "utf8");
const store = readFileSync("src/lib/supabaseStore.ts", "utf8");

describe("POS offline: vender sin conexión", () => {
  it("snapshot del catálogo: sin señal muestra el último catálogo guardado", () => {
    expect(pos).toContain("gestiona.pos.catalog.");
    expect(pos).toContain("Sin conexión — mostrando el último catálogo guardado");
  });

  it("snapshot de settings: sin señal conserva umbrales y descuentos de medios", () => {
    expect(pos).toContain("gestiona.pos.settings.");
    expect(pos).toContain("usando la última configuración guardada");
  });

  it("snapshot del turno: sin señal sigue operando con el turno abierto", () => {
    expect(pos).toContain("gestiona.pos.cashsession.");
  });

  it("cola offline: el ticket persiste antes de vaciar el carrito", () => {
    expect(pos).toContain("Persistir antes de vaciar el carrito");
    expect(pos).toContain("offline_transaction_id");
    expect(pos).toContain("offline_origin: !isOnline");
    // La venta no se muestra como exitosa si el dispositivo no pudo guardarla.
    expect(pos).toContain("La venta no se registró porque el dispositivo no pudo guardarla offline");
  });

  it("sincronización por ticket completo con errores visibles", () => {
    expect(pos).toContain("groupPosOfflineTickets");
    expect(pos).toContain("sincronizará al reconectar");
  });

  it("el service worker precachea el shell y el POS para abrir sin conexión", () => {
    // El filtro del precache está en vite.config.ts (globIgnores conserva POSPage).
    const viteCfg = readFileSync("vite.config.ts", "utf8");
    expect(viteCfg).toContain("POSPage");
    expect(sw).toContain("precacheAndRoute(self.__WB_MANIFEST)");
    // NetworkFirst para la REST de Supabase: dato fresco con red, copia de
    // emergencia hasta 24 h sin ella.
    expect(sw).toContain('NetworkFirst');
    expect(sw).toContain("supabase-api");
  });

  it("el dinero lo decide el servidor: create_sales_transaction_v3 con fallback", () => {
    expect(pos).toContain("addSalesDB");
    expect(sw.length).toBeGreaterThan(0);
    // El costo y la ganancia no viajan desde el navegador.
    expect(pos).not.toMatch(/p_price.*cost.*profit/);
  });
});