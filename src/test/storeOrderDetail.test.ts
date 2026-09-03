import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  STORE_ORDER_LIST_SELECT,
  buildStoreOrderDetail,
  findStoreOrderForInspect,
  formatStoreOrderAddress,
  isStoreOrderInspectId,
  parseStoreOrderItems,
  storeOrderPaymentMethodLabel,
} from "@/lib/storeOrderDetail";
import type { StoreOrderInspectRow } from "@/lib/storeOrderDetail";

function order(partial: Partial<StoreOrderInspectRow> = {}): StoreOrderInspectRow {
  return {
    id: partial.id ?? "11111111-1111-1111-8111-111111111111",
    order_number: partial.order_number ?? "TN-1001",
    customer_name: partial.customer_name ?? "María Pérez",
    customer_email: partial.customer_email ?? "maria@example.com",
    customer_phone: partial.customer_phone ?? "1155551234",
    total: partial.total ?? 15000,
    payment_status: partial.payment_status ?? "paid",
    fulfillment_status: partial.fulfillment_status ?? "pending",
    tracking_number: partial.tracking_number ?? null,
    created_at: partial.created_at ?? "2026-09-01T12:00:00Z",
    payment_method: partial.payment_method ?? "mercadopago",
    subtotal: partial.subtotal ?? 14000,
    shipping_cost: partial.shipping_cost ?? 1000,
    items: partial.items ?? [
      { name: "Perfume", quantity: 2, unit_price: 7000, total: 14000 },
    ],
    shipping_address: partial.shipping_address ?? {
      calle: "Av. Corrientes 1234",
      ciudad: "CABA",
      provincia: "CABA",
      cp: "1043",
    },
    ...partial,
  };
}

describe("inspector de un pedido de tienda", () => {
  it("no abre un id que no está en la cola autorizada", () => {
    const rows = [order(), order({ id: "22222222-2222-2222-8222-222222222222" })];
    expect(findStoreOrderForInspect(rows, "otra-org")).toBeNull();
    expect(findStoreOrderForInspect(rows, null)).toBeNull();
    expect(findStoreOrderForInspect(rows, rows[1].id)?.id).toBe("22222222-2222-2222-8222-222222222222");
  });

  it("un filtro no es la fuente de la ficha: busca en la cola completa", () => {
    const workspace = readFileSync(resolve(process.cwd(), "src/components/ecommerce/StoreOrdersWorkspace.tsx"), "utf8");
    expect(workspace).toContain("findStoreOrderForInspect(orders,");
    expect(workspace).not.toContain("findStoreOrderForInspect(visible");
    expect(workspace).not.toContain("findStoreOrderForInspect(filtered");
    expect(workspace).toContain(`.select(STORE_ORDER_LIST_SELECT)`);
    expect(STORE_ORDER_LIST_SELECT).not.toMatch(/public_access_token|access_token|cost_usd|cost_ars/);
  });

  it("lee ítems del checkout sin inventar un nombre ni un total", () => {
    expect(parseStoreOrderItems(null)).toEqual([]);
    expect(parseStoreOrderItems([
      { name: "A", quantity: 2, unit_price: 10, total: 20 },
      { product_name: "B", quantity: 1, unit_price_ars: 5 },
    ])).toEqual([
      { name: "A", quantity: 2, unit_price: 10, total: 20 },
      { name: "B", quantity: 1, unit_price: 5, total: 5 },
    ]);
  });

  it("arma dirección en español y también acepta claves viejas en inglés", () => {
    expect(formatStoreOrderAddress({
      street: "Mitre 100", city: "Rosario", province: "Santa Fe", zip: "2000",
    }).texto).toBe("Mitre 100 · Rosario, Santa Fe · 2000");
  });

  it("nombra el medio de cobro; Gestiona Pay, no mercadopago crudo", () => {
    expect(storeOrderPaymentMethodLabel("gestiona_pay")).toBe("Gestiona Pay");
    expect(storeOrderPaymentMethodLabel("mercadopago")).toBe("Gestiona Pay");
    expect(storeOrderPaymentMethodLabel("transferencia")).toBe("Transferencia");
    expect(storeOrderPaymentMethodLabel("")).toBe("Sin medio");
  });

  it("resume unidades e importes de línea sin calcular un margen", () => {
    const detail = buildStoreOrderDetail(order());
    expect(detail).toMatchObject({
      units: 2,
      itemsTotal: 14000,
      paymentMethodLabel: "Gestiona Pay",
    });
    expect(detail?.address.texto).toContain("Corrientes");
    expect(JSON.stringify(detail)).not.toMatch(/margen|profit|cost_of_goods/i);
  });

  it("sólo trata como deep link un UUID", () => {
    expect(isStoreOrderInspectId("11111111-1111-1111-8111-111111111111")).toBe(true);
    expect(isStoreOrderInspectId("pending")).toBe(false);
    expect(isStoreOrderInspectId("")).toBe(false);
  });
});
