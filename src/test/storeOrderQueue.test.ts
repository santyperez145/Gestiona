import { describe, expect, it } from "vitest";
import {
  buildStoreOrdersCsv,
  countStoreOrderViews,
  filterStoreOrders,
  isStoreOrderAwaitingFulfillment,
  matchesStoreOrderSearch,
  parseStoreOrderView,
  storeOrderFulfillmentLabel,
  storeOrdersCsvFilename,
  type StoreOrderQueueRow,
} from "@/lib/storeOrderQueue";

function order(partial: Partial<StoreOrderQueueRow> = {}): StoreOrderQueueRow {
  return {
    id: partial.id ?? "1",
    order_number: partial.order_number ?? "TN-1001",
    customer_name: partial.customer_name ?? "María Pérez",
    customer_email: partial.customer_email ?? "maria@example.com",
    customer_phone: partial.customer_phone ?? "11 5555-1234",
    total: partial.total ?? 15000,
    payment_status: partial.payment_status ?? "paid",
    fulfillment_status: partial.fulfillment_status ?? "pending",
    tracking_number: partial.tracking_number ?? null,
    created_at: partial.created_at ?? "2026-09-01T12:00:00Z",
  };
}

describe("cola de pedidos de la tienda", () => {
  it("no trata un chip en inglés como vista", () => {
    expect(parseStoreOrderView("pending")).toBe("todas");
    expect(parseStoreOrderView("despachar")).toBe("despachar");
    expect(parseStoreOrderView(null)).toBe("todas");
  });

  it("etiqueta la entrega en el idioma de trabajo", () => {
    expect(storeOrderFulfillmentLabel("pending")).toBe("Pendiente");
    expect(storeOrderFulfillmentLabel("processing")).toBe("Para despachar");
    expect(storeOrderFulfillmentLabel("shipped")).toBe("Enviada");
  });

  it("busca por número, cliente, email, teléfono y seguimiento", () => {
    const row = order({ tracking_number: "AR123" });
    expect(matchesStoreOrderSearch(row, "tn-1001")).toBe(true);
    expect(matchesStoreOrderSearch(row, "maria")).toBe(true);
    expect(matchesStoreOrderSearch(row, "MARIA@EXAMPLE.COM")).toBe(true);
    expect(matchesStoreOrderSearch(row, "5555")).toBe(true);
    expect(matchesStoreOrderSearch(row, "ar123")).toBe(true);
    expect(matchesStoreOrderSearch(row, "inexistente")).toBe(false);
  });

  it("ignora tildes al buscar el nombre", () => {
    expect(matchesStoreOrderSearch(order(), "maria perez")).toBe(true);
  });

  it("acepta el monto como lo escribe un comercio argentino", () => {
    const row = order({ total: 15000.5 });
    expect(matchesStoreOrderSearch(row, "15000,50")).toBe(true);
    expect(matchesStoreOrderSearch(row, "$15.000,50")).toBe(true);
    expect(matchesStoreOrderSearch(row, "999")).toBe(false);
  });

  it("para despachar es lo pagado que todavía no salió — no un pago revertido", () => {
    expect(isStoreOrderAwaitingFulfillment(order({ payment_status: "paid", fulfillment_status: "pending" }))).toBe(true);
    expect(isStoreOrderAwaitingFulfillment(order({ payment_status: "paid", fulfillment_status: "unfulfilled" }))).toBe(true);
    expect(isStoreOrderAwaitingFulfillment(order({ payment_status: "paid", fulfillment_status: "processing" }))).toBe(true);
    expect(isStoreOrderAwaitingFulfillment(order({ payment_status: "refunded", fulfillment_status: "pending" }))).toBe(false);
    expect(isStoreOrderAwaitingFulfillment(order({ payment_status: "pending", fulfillment_status: "pending" }))).toBe(false);
    expect(isStoreOrderAwaitingFulfillment(order({ payment_status: "paid", fulfillment_status: "shipped" }))).toBe(false);
  });

  it("combina vista y búsqueda sin inventar filas de otra cola", () => {
    const rows = [
      order({ id: "a", order_number: "A-1", payment_status: "paid", fulfillment_status: "pending" }),
      order({ id: "b", order_number: "B-2", payment_status: "pending", fulfillment_status: "pending", customer_name: "Ana" }),
      order({ id: "c", order_number: "C-3", payment_status: "paid", fulfillment_status: "shipped" }),
    ];
    expect(filterStoreOrders(rows, { view: "despachar" }).map(r => r.id)).toEqual(["a"]);
    expect(filterStoreOrders(rows, { view: "pago" }).map(r => r.id)).toEqual(["b"]);
    expect(filterStoreOrders(rows, { view: "enviadas", query: "Ana" })).toEqual([]);
    expect(filterStoreOrders(rows, { view: "todas", query: "ana" }).map(r => r.id)).toEqual(["b"]);
  });

  it("cuenta cada vista sobre la cola cargada, no sobre el recorte de búsqueda", () => {
    const rows = [
      order({ id: "a", payment_status: "paid", fulfillment_status: "pending" }),
      order({ id: "b", payment_status: "failed", fulfillment_status: "pending" }),
      order({ id: "c", payment_status: "paid", fulfillment_status: "delivered" }),
    ];
    expect(countStoreOrderViews(rows)).toEqual({
      todas: 3,
      despachar: 1,
      pago: 1,
      enviadas: 0,
      entregadas: 1,
      canceladas: 0,
    });
  });

  it("exporta el conjunto filtrado con celdas escapadas y sin fórmulas", () => {
    const csv = buildStoreOrdersCsv([
      order({
        order_number: 'TN-"1"',
        customer_name: "=CMD",
        customer_email: 'a"b@example.com',
        total: 10,
      }),
    ]);
    expect(csv).toContain('"numero","cliente","email","telefono","total","pago","entrega","seguimiento","fecha"');
    expect(csv).toContain('"TN-""1"""');
    expect(csv).toContain('"\'=CMD"');
    expect(csv).toContain('"a""b@example.com"');
    expect(csv).toContain('"Pagado"');
    expect(csv).toContain('"Pendiente"');
  });

  it("nombra el CSV con el día UTC", () => {
    expect(storeOrdersCsvFilename(new Date("2026-09-01T10:00:00Z")))
      .toBe("gestiona-pedidos-tienda-2026-09-01.csv");
  });
});
