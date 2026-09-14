import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pos = readFileSync(resolve(process.cwd(), "src/pages/POSPage.tsx"), "utf8");
const panelE2e = readFileSync(resolve(process.cwd(), "e2e/panel.spec.ts"), "utf8");

describe("contrato operativo de la cola offline del POS", () => {
  it("presenta tickets canónicos y no filas de venta como si fueran operaciones", () => {
    expect(pos).toContain("summarizePosOfflineQueue(offlineSales, offlineClock)");
    expect(pos).toContain("offlineQueue.ticketCount");
    expect(pos).toContain("offlineQueue.units");
    expect(pos).toContain("offlineQueue.totalARS");
    expect(pos).not.toContain("{offlineSales.length} venta");
  });

  it("no oculta una sincronización parcial ni reintenta en loop", () => {
    expect(pos).toContain("autoSyncAttemptedRef.current = true");
    expect(pos).toContain("setOfflineSyncError");
    expect(pos).toContain("console.error(`[POS offline] No se pudo sincronizar el ticket");
    expect(pos).toContain('toast.error("La sincronización quedó incompleta"');
  });

  it("eliminó la migración legacy heredada y opera solo con la cola canónica", () => {
    expect(pos).toContain("const own = JSON.parse(localStorage.getItem(offlineKey)");
    expect(pos).not.toContain("const legacyKey = \"gestiona.pos.offline_sales.default\"");
    expect(pos).not.toContain("const untouchedLegacy = legacy.filter");
    expect(pos).not.toContain("const migrating = legacy.filter");
    expect(pos).not.toContain("localStorage.setItem(legacyKey");
    expect(pos).toContain("Se mantiene la clave de la organización activa; la migración de legacy se retiró porque el POS opera exclusivamente con `offlineKey` actual.");
  });

  it("persiste una venta offline antes de limpiar o emitir el recibo", () => {
    const persist = pos.indexOf("localStorage.setItem(offlineKey, JSON.stringify(pending))");
    const state = pos.indexOf("setOfflineSales(pending)", persist);
    const soldSnapshot = pos.indexOf("const soldItems = cart.map");
    const receipt = pos.indexOf("setReceipt({ items: soldItems", persist);

    expect(persist).toBeGreaterThan(-1);
    expect(soldSnapshot).toBeGreaterThan(-1);
    expect(state).toBeGreaterThan(persist);
    expect(receipt).toBeGreaterThan(state);
  });

  it("bloquea nuevas ventas offline si el dispositivo no puede conservarlas", () => {
    expect(pos).toContain("const [offlineStorageError, setOfflineStorageError]");
    expect(pos).toContain("(!isOnline && !!offlineStorageError)");
    expect(pos).toContain('role="alert"');
    expect(pos).toContain("La venta no se registró porque el dispositivo no pudo guardarla offline");
  });

  it("el drill E2E intercepta toda escritura y limpia el fixture local aun si falla", () => {
    const route = panelE2e.indexOf('page.route("**/rest/v1/rpc/create_sales_transaction_v3"');
    const seed = panelE2e.indexOf("window.localStorage.setItem", route);
    const reconnect = panelE2e.indexOf("context.setOffline(false)", seed);
    const cleanup = panelE2e.indexOf("window.localStorage.removeItem", reconnect);

    expect(route).toBeGreaterThan(-1);
    expect(seed).toBeGreaterThan(route);
    expect(reconnect).toBeGreaterThan(seed);
    expect(cleanup).toBeGreaterThan(reconnect);
    expect(panelE2e).toContain('let phase: "hold" | "partial" = "hold"');
    expect(panelE2e).toContain("await context.setOffline(true)");
  });
});
