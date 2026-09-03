import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const panel = readFileSync(resolve(ROOT, "src/components/ecommerce/StoreOrdersPanel.tsx"), "utf8");
const page = readFileSync(resolve(ROOT, "src/pages/EcommerceStorePage.tsx"), "utf8");
const workspace = readFileSync(resolve(ROOT, "src/components/ecommerce/StoreOrdersWorkspace.tsx"), "utf8");
const ordersPage = readFileSync(resolve(ROOT, "src/pages/StoreOrdersPage.tsx"), "utf8");
const manifest = readFileSync(resolve(ROOT, "src/app/routeManifest.ts"), "utf8");
const focus = readFileSync(resolve(ROOT, "src/lib/dashboardFocus.ts"), "utf8");

describe("cola de pedidos en Commerce", () => {
  it("persiste búsqueda y vista en la URL, no en un chip en inglés", () => {
    expect(panel).not.toContain('params.set("tab", "orders")');
    expect(panel).toContain('params.set("vista", next.view)');
    expect(panel).toContain('params.set("q", next.query)');
    expect(panel).toContain('params.set("orden", next.sort)');
    expect(panel).toContain('params.set("medio", next.medio)');
    expect(panel).toContain("parseStoreOrderView");
    expect(panel).toContain("parseStoreOrderSort");
    expect(panel).toContain("parseStoreOrderMedio");
    expect(panel).not.toMatch(/\["pending", "processing"/);
  });

  it("exporta el recorte visible y no ofrece un despacho masivo sin autoridad", () => {
    expect(panel).toContain("buildStoreOrdersCsv");
    expect(panel).toContain("filterStoreOrders");
    expect(panel).toContain("Exportar CSV");
    expect(panel).not.toMatch(/seleccionad|bulk|Marcar como enviado/i);
    expect(panel).toContain("WorkspaceState");
    expect(panel).toContain("STORE_ORDER_SORTS");
    expect(panel).toContain("STORE_ORDER_MEDIOS");
    expect(panel).toContain('aria-label="Ordenar pedidos"');
    expect(panel).toContain('aria-label="Filtrar por medio de pago"');
    expect(panel).toContain("md:hidden");
  });

  it("Pedidos vive en /pedidos-online; Commerce redirige bookmarks tab=orders", () => {
    expect(page).not.toContain("StoreOrdersWorkspace");
    expect(page).toContain("storeOrdersCanonicalPath");
    expect(page).toContain('requestedTab !== "orders"');
    expect(page).toContain('to="/pedidos-online"');
    expect(page).not.toContain('id: "orders"');
    expect(panel).not.toContain("standalone");
    expect(focus).toContain("/pedidos-online?vista=despachar");
    expect(focus).toContain("/pedidos-online?vista=retirar");
    expect(focus).toContain("storeFirstSaleSharePath");
  });

  it("el inspector conserva la cola, representa la selección en URL y es fullscreen en mobile", () => {
    expect(workspace).toContain('searchParams.get("pedido")');
    expect(workspace).toContain("findStoreOrderForInspect(orders,");
    expect(workspace).toContain('params.set("pedido", orderId)');
    expect(workspace).toContain('params.delete("pedido")');
    expect(workspace).toContain("StoreOrderInspector");
    expect(manifest).toContain('path: "/pedidos-online"');
    expect(manifest).toContain("StoreOrdersPage");
    expect(page).not.toContain("findStoreOrderForInspect(visible");
    const inspector = readFileSync(resolve(ROOT, "src/components/ecommerce/StoreOrderInspector.tsx"), "utf8");
    expect(inspector).toContain('data-testid="store-order-inspector"');
    expect(inspector).toContain('className="flex w-full flex-col p-0 sm:max-w-2xl"');
    expect(inspector).toContain("OperationMarginPanel");
    expect(panel).toContain("onInspect");
    expect(panel).toContain('aria-label={`Ver detalle de ${o.order_number}`}');
  });
});
