import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  countPendingStockAlerts,
  filterPendingStockAlerts,
  stockAlertChannelCopy,
  stockAlertState,
  stockAlertStateLabel,
  stockAlertsByProduct,
  stockAlertsQueueHref,
} from "@/lib/stockAlerts";
import { construirPendientes } from "@/lib/dashboardFocus";

const ROOT = process.cwd();

describe("avisos de reposición (Back in stock)", () => {
  it("distingue pendiente, listo, canal no listo y enviado", () => {
    expect(stockAlertState({ notified_at: "2026-09-01", product_stock: 0 })).toBe("enviado");
    expect(stockAlertState({ notified_at: null, product_stock: 3 })).toBe("listo_para_avisar");
    expect(stockAlertState({ notified_at: null, product_stock: 0 })).toBe("pendiente");
    expect(stockAlertState(
      { notified_at: null, product_stock: 3 },
      { ready: false },
    )).toBe("canal_no_listo");
    expect(stockAlertState(
      { notified_at: null, product_stock: 3 },
      { ready: true },
    )).toBe("listo_para_avisar");
    expect(stockAlertStateLabel("canal_no_listo")).toMatch(/email no configurado/i);
  });

  it("la cola sólo muestra no notificados y agrupa demanda", () => {
    const rows = filterPendingStockAlerts([
      {
        id: "1", email: "a@b.c", product_id: "p1", variant_id: null,
        notified_at: null, created_at: "2026-09-03T12:00:00Z",
        product_name: "A", product_stock: 2,
      },
      {
        id: "2", email: "c@d.e", product_id: "p1", variant_id: null,
        notified_at: "2026-09-02T12:00:00Z", created_at: "2026-09-01T12:00:00Z",
        product_name: "A", product_stock: 2,
      },
      {
        id: "3", email: "e@f.g", product_id: "p2", variant_id: null,
        notified_at: null, created_at: "2026-09-03T11:00:00Z",
        product_name: "B", product_stock: 0,
      },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["1", "3"]);
    expect(countPendingStockAlerts(rows)).toBe(2);
    expect(stockAlertsByProduct(rows)[0]).toMatchObject({
      productId: "p1", waiting: 0, ready: 1,
    });
    expect(stockAlertsByProduct(rows, { ready: false })[0]).toMatchObject({
      productId: "p1", waiting: 1, ready: 0,
    });
  });

  it("no promete aviso automático sin canal de email", () => {
    expect(stockAlertChannelCopy({
      channel: { ready: false, merchantSmtp: false, platformEmail: false },
    }).title).toMatch(/no puede salir/i);
    expect(stockAlertChannelCopy({
      channel: { ready: true, merchantSmtp: false, platformEmail: true },
    }).body).toMatch(/plataforma/i);

    const panel = readFileSync(
      resolve(ROOT, "src/components/ecommerce/StockAlertsPanel.tsx"),
      "utf8",
    );
    expect(panel).toContain("emailChannel");
    expect(panel).toContain("stockAlertChannelCopy");
    const recovery = readFileSync(
      resolve(ROOT, "src/components/ecommerce/StoreRecoveryWorkspace.tsx"),
      "utf8",
    );
    expect(recovery).toContain("loadEmailChannel");
    expect(recovery).toContain("emailChannel={emailChannel}");
    const cron = readFileSync(
      resolve(ROOT, "supabase/functions/notify-back-in-stock/index.ts"),
      "utf8",
    );
    expect(cron).toContain("sin canal de email");
  });

  it("Foco y Pedidos aterrizan en Recuperación → reposición", () => {
    expect(stockAlertsQueueHref()).toBe("/pedidos-online?cola=recuperacion&vista=reposicion");
    const p = construirPendientes({
      sinStock: 0, stockBajo: 0,
      deudasPendientes: 0, deudaTotalARS: 0, deudasVencidas30: 0,
      seguimientosHoy: 0, pedidosPorDespachar: 0,
      avisosReposicion: 2,
      tiendaPublicada: true,
    });
    expect(p.some((x) => x.id === "avisos-reposicion")).toBe(true);
    expect(p.find((x) => x.id === "avisos-reposicion")?.destino)
      .toBe("/pedidos-online?cola=recuperacion&vista=reposicion");

    const recovery = readFileSync(
      resolve(ROOT, "src/components/ecommerce/StoreRecoveryWorkspace.tsx"),
      "utf8",
    );
    expect(recovery).toContain("StockAlertsPanel");
    expect(recovery).toContain('"reposicion"');
    const ordersPage = readFileSync(resolve(ROOT, "src/pages/StoreOrdersPage.tsx"), "utf8");
    expect(ordersPage).toContain("Recuperación");
    const commerce = readFileSync(resolve(ROOT, "src/pages/EcommerceStorePage.tsx"), "utf8");
    expect(commerce).toContain("storeRecoveryCanonicalPath");
    expect(commerce).not.toContain("StockAlertsPanel");

    const cron = readFileSync(
      resolve(ROOT, "supabase/functions/notify-back-in-stock/index.ts"),
      "utf8",
    );
    expect(cron).toContain("falta PUBLIC_BASE_URL");
    expect(cron).not.toMatch(/\$\{link \? `/);
  });
});
