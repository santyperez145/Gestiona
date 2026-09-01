import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const panel = readFileSync(resolve(ROOT, "src/components/ecommerce/StoreOrdersPanel.tsx"), "utf8");
const page = readFileSync(resolve(ROOT, "src/pages/EcommerceStorePage.tsx"), "utf8");
const focus = readFileSync(resolve(ROOT, "src/lib/dashboardFocus.ts"), "utf8");

describe("cola de pedidos en Commerce", () => {
  it("persiste búsqueda y vista en la URL, no en un chip en inglés", () => {
    expect(panel).toContain('params.set("tab", "orders")');
    expect(panel).toContain('params.set("vista", next.view)');
    expect(panel).toContain('params.set("q", next.query)');
    expect(panel).toContain("parseStoreOrderView");
    expect(panel).not.toMatch(/\["pending", "processing"/);
  });

  it("exporta el recorte visible y no ofrece un despacho masivo sin autoridad", () => {
    expect(panel).toContain("buildStoreOrdersCsv");
    expect(panel).toContain("filterStoreOrders");
    expect(panel).toContain("Exportar CSV");
    expect(panel).not.toMatch(/seleccionad|bulk|Marcar como enviado/i);
    expect(panel).toContain("WorkspaceState");
    expect(panel).toContain("md:hidden");
  });

  it("el tab Pedidos deja de ser una tabla suelta y el Foco aterriza en la cola", () => {
    expect(page).toContain("StoreOrdersPanel");
    expect(page).toContain("STORE_ORDER_QUEUE_LIMIT");
    expect(page).toContain('params.delete("q")');
    expect(page).toContain('params.delete("vista")');
    expect(focus).toContain("/tienda-online?tab=orders&vista=despachar");
  });
});
