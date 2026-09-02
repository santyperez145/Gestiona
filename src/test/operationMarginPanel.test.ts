import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { labelMissingMarginComponent } from "@/lib/channelMargins";

const ROOT = process.cwd();

describe("margen canónico en el punto de decisión", () => {
  it("rótulos de faltantes son legibles", () => {
    expect(labelMissingMarginComponent("costo_mercaderia")).toContain("mercadería");
    expect(labelMissingMarginComponent("comision_cobro")).toContain("comisión");
    expect(labelMissingMarginComponent("desconocido_xyz")).toBe("desconocido_xyz");
  });

  it("inspectores leen sale_margin_operations y no inventan fees", () => {
    const panel = readFileSync(resolve(ROOT, "src/components/shared/OperationMarginPanel.tsx"), "utf8");
    const store = readFileSync(resolve(ROOT, "src/components/ecommerce/StoreOrderInspector.tsx"), "utf8");
    const sales = readFileSync(resolve(ROOT, "src/pages/SalesPage.tsx"), "utf8");

    expect(panel).toContain('.from("sale_margin_operations")');
    expect(panel).toContain("SELECT_COLS");
    expect(panel).toContain("contribution_margin_ars");
    expect(panel).toContain("Envío real");
    expect(panel).not.toMatch(/paymentFees|bestPromoPrice|products\.cost/);
    expect(panel).toContain("isMissingRelation");

    expect(store).toContain("OperationMarginPanel");
    expect(store).toContain("operationId={detail.order.id}");
    expect(sales).toContain("OperationMarginPanel");
    expect(sales).toContain("operationId={detail.id}");
  });
});
