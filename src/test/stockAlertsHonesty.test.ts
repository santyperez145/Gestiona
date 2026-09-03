import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  countPendingStockAlerts,
  filterPendingStockAlerts,
  stockAlertState,
  stockAlertsByProduct,
  stockAlertsQueueHref,
} from "@/lib/stockAlerts";
import { construirPendientes } from "@/lib/dashboardFocus";

const ROOT = process.cwd();

describe("avisos de reposición (Back in stock)", () => {
  it("distingue pendiente, listo para avisar y enviado", () => {
    expect(stockAlertState({ notified_at: "2026-09-01", product_stock: 0 })).toBe("enviado");
    expect(stockAlertState({ notified_at: null, product_stock: 3 })).toBe("listo_para_avisar");
    expect(stockAlertState({ notified_at: null, product_stock: 0 })).toBe("pendiente");
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
  });

  it("Foco y Commerce aterrizan en Recuperación → reposición", () => {
    expect(stockAlertsQueueHref()).toBe("/tienda-online?tab=carritos&vista=reposicion");
    const p = construirPendientes({
      sinStock: 0, stockBajo: 0,
      deudasPendientes: 0, deudaTotalARS: 0, deudasVencidas30: 0,
      seguimientosHoy: 0, pedidosPorDespachar: 0,
      avisosReposicion: 2,
      tiendaPublicada: true,
    });
    expect(p.some((x) => x.id === "avisos-reposicion")).toBe(true);
    expect(p.find((x) => x.id === "avisos-reposicion")?.destino)
      .toBe("/tienda-online?tab=carritos&vista=reposicion");

    const store = readFileSync(resolve(ROOT, "src/pages/EcommerceStorePage.tsx"), "utf8");
    expect(store).toContain("StockAlertsPanel");
    expect(store).toContain('vista", "reposicion"');
    expect(store).toContain("Recuperación");

    const cron = readFileSync(
      resolve(ROOT, "supabase/functions/notify-back-in-stock/index.ts"),
      "utf8",
    );
    expect(cron).toContain("falta PUBLIC_BASE_URL");
    expect(cron).not.toMatch(/\$\{link \? `/);
  });
});
