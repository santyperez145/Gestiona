import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  labelMissingMarginComponent,
  marginGapAction,
  marginGapActions,
} from "@/lib/channelMargins";

const ROOT = process.cwd();
const MANIFEST = readFileSync(resolve(ROOT, "src/app/routeManifest.ts"), "utf8");

describe("margen canónico en el punto de decisión", () => {
  it("rótulos de faltantes son legibles", () => {
    expect(labelMissingMarginComponent("costo_mercaderia")).toContain("mercadería");
    expect(labelMissingMarginComponent("comision_cobro")).toContain("comisión");
    expect(labelMissingMarginComponent("liquidacion_cobro")).toContain("liquidación");
    expect(labelMissingMarginComponent("desconocido_xyz")).toBe("desconocido_xyz");
  });

  it("cada CTA mapea a una ruta real o declara que no hay acción", () => {
    const cogs = marginGapAction("costo_mercaderia");
    expect(cogs.href).toBe("/productos");
    expect(cogs.note).toMatch(/próximas ventas|no reescribe/i);
    expect(MANIFEST).toContain('path: "/productos"');

    expect(marginGapAction("comision_cobro").href).toBe("/movimientos");
    expect(marginGapAction("liquidacion_cobro").href).toBe("/movimientos");
    expect(MANIFEST).toContain('path: "/movimientos"');

    expect(marginGapAction("iva").href).toBe("/afip");
    expect(marginGapAction("devolucion_neta").href).toBe("/devoluciones");

    const envioPos = marginGapAction("costo_envio_real", { channel: "pos" });
    expect(envioPos.href).toBeNull();
    expect(envioPos.note).toMatch(/transportista|tarifas/i);

    const envioMeli = marginGapAction("costo_envio_real", { channel: "mercadolibre" });
    expect(envioMeli.href).toBe("/integraciones?tab=conexiones");

    const dedup = marginGapActions(["comision_cobro", "comision_cobro", "iva"]);
    expect(dedup.map((g) => g.code)).toEqual(["comision_cobro", "iva"]);
  });

  it("inspectores leen sale_margin_operations y no inventan fees", () => {
    const panel = readFileSync(resolve(ROOT, "src/components/shared/OperationMarginPanel.tsx"), "utf8");
    const store = readFileSync(resolve(ROOT, "src/components/ecommerce/StoreOrderInspector.tsx"), "utf8");
    const sales = readFileSync(resolve(ROOT, "src/pages/SalesPage.tsx"), "utf8");
    const ticket = readFileSync(resolve(ROOT, "src/lib/saleTicketDetail.ts"), "utf8");

    expect(panel).toContain('.from("sale_margin_operations")');
    expect(panel).toContain("SELECT_COLS");
    expect(panel).toContain("contribution_margin_ars");
    expect(panel).toContain("Envío real");
    expect(panel).toContain("marginGapActions");
    expect(panel).not.toMatch(/paymentFees|bestPromoPrice|products\.cost/);
    expect(panel).toContain("isMissingRelation");

    expect(store).toContain("OperationMarginPanel");
    expect(store).toContain("operationId={detail.order.id}");
    expect(sales).toContain("OperationMarginPanel");
    expect(sales).toContain("operationId={detail.marginOperationId}");
    expect(sales).not.toContain("operationId={detail.id}");
    expect(ticket).toContain("marginOperationIdForSale");
    expect(ticket).toContain("tienda_online");
  });
});
