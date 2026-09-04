import { describe, expect, it } from "vitest";
import {
  buildStoreOrdersCsv,
  canBulkFulfillStoreOrder,
  countBulkFulfillmentCandidates,
  countFulfillmentPulse,
  countStoreOrderViews,
  countStoreOrdersNeedingAttention,
  filterStoreOrders,
  isStoreOrderStale,
  isStoreOrderAwaitingFulfillment,
  matchesStoreOrderSearch,
  parseStoreOrderMedio,
  parseStoreOrderBulkResponse,
  parseStoreOrderSort,
  parseStoreOrderView,
  sortStoreOrders,
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
    payment_method: partial.payment_method ?? null,
    carrier: partial.carrier ?? null,
    shipping_service: partial.shipping_service ?? null,
    fulfillment_status: partial.fulfillment_status ?? "pending",
    tracking_number: partial.tracking_number ?? null,
    created_at: partial.created_at ?? "2026-09-01T12:00:00Z",
  };
}

describe("cola de pedidos de la tienda", () => {
  it("no trata un chip en inglés como vista", () => {
    expect(parseStoreOrderView("pending")).toBe("todas");
    expect(parseStoreOrderView("despachar")).toBe("despachar");
    expect(parseStoreOrderView("atrasados")).toBe("atrasados");
    expect(parseStoreOrderView("retirar")).toBe("retirar");
    expect(parseStoreOrderView(null)).toBe("todas");
  });

  it("normaliza orden y medio desde la URL", () => {
    expect(parseStoreOrderSort("mayor")).toBe("mayor");
    expect(parseStoreOrderSort("otra")).toBe("recientes");
    expect(parseStoreOrderMedio("digital")).toBe("digital");
    expect(parseStoreOrderMedio("sin-medio")).toBe("todos");
  });

  it("etiqueta la entrega en el idioma de trabajo", () => {
    expect(storeOrderFulfillmentLabel("pending")).toBe("Pendiente");
    expect(storeOrderFulfillmentLabel("processing")).toBe("Para despachar");
    expect(storeOrderFulfillmentLabel("processing", { carrier: "retiro" })).toBe("Para retirar");
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
      order({ id: "a", payment_status: "paid", fulfillment_status: "pending", created_at: "2099-01-01T10:00:00Z" }),
      order({ id: "b", payment_status: "failed", fulfillment_status: "pending", created_at: "2099-01-01T10:00:00Z" }),
      order({ id: "c", payment_status: "paid", fulfillment_status: "delivered", created_at: "2099-01-01T10:00:00Z" }),
    ];
    expect(countStoreOrderViews(rows)).toEqual({
      todas: 3,
      retirar: 0,
      despachar: 1,
      atrasados: 0,
      pago: 1,
      enviadas: 0,
      entregadas: 1,
      canceladas: 0,
    });
    expect(countStoreOrdersNeedingAttention(rows)).toBe(2);
  });

  it("retiro pagado no entra a despachar — Square/Shopify tienen cola de pickup", () => {
    const retiro = order({
      id: "r",
      carrier: "retiro",
      shipping_service: "sucursal",
      payment_status: "paid",
      fulfillment_status: "processing",
    });
    const domicilio = order({ id: "d", payment_status: "paid", fulfillment_status: "processing" });
    expect(filterStoreOrders([retiro, domicilio], { view: "retirar" }).map(r => r.id)).toEqual(["r"]);
    expect(filterStoreOrders([retiro, domicilio], { view: "despachar" }).map(r => r.id)).toEqual(["d"]);
    expect(countFulfillmentPulse([retiro, domicilio])).toEqual({ despachar: 1, retirar: 1 });
  });

  it("marca atrasados sólo para pagados sin fulfillment hace más de 24h", () => {
    const now = new Date("2026-09-03T12:00:00Z");
    const stale = order({ created_at: "2026-09-02T08:00:00Z", payment_status: "paid", fulfillment_status: "pending" });
    const fresh = order({ created_at: "2026-09-03T10:00:00Z", payment_status: "paid", fulfillment_status: "pending" });
    const unpaid = order({ created_at: "2026-09-01T08:00:00Z", payment_status: "pending", fulfillment_status: "pending" });
    expect(isStoreOrderStale(stale, now)).toBe(true);
    expect(isStoreOrderStale(fresh, now)).toBe(false);
    expect(isStoreOrderStale(unpaid, now)).toBe(false);
    expect(filterStoreOrders([stale, fresh, unpaid], { view: "atrasados", now }).length).toBe(1);
  });

  it("filtra por medio y ordena por monto cuando se pide", () => {
    const rows = [
      order({ id: "a", payment_method: "transferencia", total: 300 }),
      order({ id: "b", payment_method: "efectivo", total: 100 }),
      order({ id: "c", payment_method: "mercadopago", total: 200 }),
    ];
    const digital = filterStoreOrders(rows, { medio: "digital", sort: "mayor" });
    expect(digital.map(r => r.id)).toEqual(["c"]);
    const transfer = filterStoreOrders(rows, { medio: "transferencia", sort: "mayor" });
    expect(transfer.map(r => r.id)).toEqual(["a"]);
    expect(sortStoreOrders(rows, "menor").map(r => r.id)).toEqual(["b", "c", "a"]);
  });

  it("separa despacho de entrega/retiro antes del bulk", () => {
    const domicilioPendiente = order({ id: "d1", fulfillment_status: "processing" });
    const domicilioEnCamino = order({ id: "d2", fulfillment_status: "shipped" });
    const retiro = order({ id: "r", carrier: "retiro", fulfillment_status: "processing" });
    const impago = order({ id: "u", payment_status: "pending", fulfillment_status: "processing" });
    expect(canBulkFulfillStoreOrder(domicilioPendiente, "shipped")).toBe(true);
    expect(canBulkFulfillStoreOrder(domicilioPendiente, "delivered")).toBe(false);
    expect(canBulkFulfillStoreOrder(domicilioEnCamino, "delivered")).toBe(true);
    expect(canBulkFulfillStoreOrder(retiro, "shipped")).toBe(false);
    expect(canBulkFulfillStoreOrder(retiro, "delivered")).toBe(true);
    expect(canBulkFulfillStoreOrder(impago, "shipped")).toBe(false);
    expect(countBulkFulfillmentCandidates([domicilioPendiente, domicilioEnCamino, retiro, impago], "delivered")).toBe(2);
  });

  it("rechaza una respuesta masiva incompleta en vez de fingir éxito", () => {
    expect(parseStoreOrderBulkResponse(null)).toBeNull();
    expect(parseStoreOrderBulkResponse({ ok: true, status: "inventado", results: [] })).toBeNull();
    const parsed = parseStoreOrderBulkResponse({
      ok: true,
      requested: 2,
      unique: 2,
      status: "shipped",
      changed: 1,
      unchanged: 0,
      skipped: 1,
      duplicates: 0,
      results: [
        { order_id: "a", order_number: "A-1", outcome: "changed" },
        { order_id: "b", order_number: "B-2", outcome: "skipped", reason: "Primero prepará el envío" },
      ],
    });
    expect(parsed?.changed).toBe(1);
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
      .toBe("nerqia-pedidos-tienda-2026-09-01.csv");
  });
});
