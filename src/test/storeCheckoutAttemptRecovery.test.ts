import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { webcrypto } from "node:crypto";
import {
  clearStoreCheckoutAttemptForOrder,
  discardStoreCheckoutAttempt,
  markStoreCheckoutOrderCreated,
  parseCreatedStoreOrder,
  prepareStoreCheckoutAttempt,
  readStoreCheckoutAttempt,
  storeCheckoutPayloadFingerprint,
  storeCheckoutAttemptStorageKey,
} from "@/lib/storeCheckoutAttempt";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("recuperación del intento de checkout", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("crypto", webcrypto);
  });

  it("reutiliza la clave después de una recarga para el mismo payload", async () => {
    const payload = {
      p_customer_email: "cliente@ejemplo.com",
      p_items: [{ product_id: "p1", quantity: 1 }],
      p_shipping: { provincia: "B" },
    };
    const fingerprint = await storeCheckoutPayloadFingerprint(payload);
    expect(fingerprint).toHaveLength(64);
    expect(fingerprint).not.toContain("cliente");

    const createKey = vi.fn()
      .mockReturnValueOnce("attempt-1")
      .mockReturnValueOnce("attempt-2");
    const first = prepareStoreCheckoutAttempt({
      storage: localStorage,
      slug: "demo",
      cartToken: "cart-1",
      fingerprint,
      createKey,
      now: 1_000,
    });
    const afterReload = prepareStoreCheckoutAttempt({
      storage: localStorage,
      slug: "demo",
      cartToken: "cart-1",
      fingerprint,
      createKey,
      now: 2_000,
    });

    expect(afterReload.idempotencyKey).toBe(first.idempotencyKey);
    expect(createKey).toHaveBeenCalledTimes(1);
  });

  it("no abre otra compra al cambiar datos de un intento sin respuesta", async () => {
    const base = { p_items: [{ product_id: "p1", quantity: 1 }] };
    const changed = { p_items: [{ product_id: "p1", quantity: 2 }] };
    const first = prepareStoreCheckoutAttempt({
      storage: localStorage,
      slug: "demo",
      cartToken: "cart-1",
      fingerprint: await storeCheckoutPayloadFingerprint(base),
      createKey: () => "attempt-1",
      now: 1_000,
    });
    const second = prepareStoreCheckoutAttempt({
      storage: localStorage,
      slug: "demo",
      cartToken: "cart-1",
      fingerprint: await storeCheckoutPayloadFingerprint(changed),
      createKey: () => "attempt-2",
      now: 2_000,
    });

    expect(first.idempotencyKey).toBe("attempt-1");
    expect(second.idempotencyKey).toBe("attempt-1");
  });

  it("permite una compra nueva e idéntica después de finalizar la anterior", () => {
    const args = {
      storage: localStorage, slug: "demo", cartToken: "cart-1",
      fingerprint: "a".repeat(64), createKey: vi.fn().mockReturnValueOnce("first").mockReturnValueOnce("second"),
    };
    const first = prepareStoreCheckoutAttempt(args);
    markStoreCheckoutOrderCreated(localStorage, first, "ORD1");
    discardStoreCheckoutAttempt(localStorage, "demo", "cart-1");
    expect(prepareStoreCheckoutAttempt(args).idempotencyKey).toBe("second");
  });

  it("tolera storage bloqueado y registros corruptos sin guardar datos personales", async () => {
    const fingerprint = await storeCheckoutPayloadFingerprint({ email: "private@example.test" });
    const attempt = prepareStoreCheckoutAttempt({
      storage: null, slug: "demo", cartToken: "cart-1", fingerprint, createKey: () => "first",
    });
    expect(attempt.idempotencyKey).toBe("first");
    expect(JSON.stringify(attempt)).not.toContain("private@example.test");
    expect(readStoreCheckoutAttempt(null, "demo", "cart-1")).toBeNull();
    localStorage.setItem(storeCheckoutAttemptStorageKey("demo", "broken"), "not-json");
    markStoreCheckoutOrderCreated(localStorage, attempt, "ORD1");
    clearStoreCheckoutAttemptForOrder(localStorage, "demo", "ORD1");
    expect(readStoreCheckoutAttempt(localStorage, "demo", "cart-1")).toBeNull();
  });

  it("no mezcla tiendas ni acepta números que cambien la ruta", () => {
    prepareStoreCheckoutAttempt({
      storage: localStorage, slug: "one", cartToken: "cart-1", fingerprint: "a".repeat(64), createKey: () => "first",
    });
    expect(readStoreCheckoutAttempt(localStorage, "two", "cart-1")).toBeNull();
    expect(parseCreatedStoreOrder({ order_number: "../checkout" })).toBeNull();
    expect(parseCreatedStoreOrder({ order_number: "ORD1?email=private" })).toBeNull();
  });

  it("recuerda la orden creada y la limpia al completar el handoff", async () => {
    const attempt = prepareStoreCheckoutAttempt({
      storage: localStorage,
      slug: "demo",
      cartToken: "cart-1",
      fingerprint: await storeCheckoutPayloadFingerprint({ p_items: ["p1"] }),
      createKey: () => "attempt-1",
      now: 1_000,
    });
    markStoreCheckoutOrderCreated(localStorage, attempt, "ORD000123", 2_000);

    expect(readStoreCheckoutAttempt(localStorage, "demo", "cart-1", 3_000)).toMatchObject({
      phase: "order_created",
      orderNumber: "ORD000123",
    });
    clearStoreCheckoutAttemptForOrder(localStorage, "demo", "ORD000123");
    expect(readStoreCheckoutAttempt(localStorage, "demo", "cart-1", 3_000)).toBeNull();
  });

  it("descarta intentos vencidos y respuestas sin número", async () => {
    prepareStoreCheckoutAttempt({
      storage: localStorage,
      slug: "demo",
      cartToken: "cart-1",
      fingerprint: await storeCheckoutPayloadFingerprint({ p_items: ["p1"] }),
      createKey: () => "expired",
      now: 1_000,
    });

    expect(readStoreCheckoutAttempt(localStorage, "demo", "cart-1", 24 * 60 * 60 * 1000 + 1_001)).toBeNull();
    expect(parseCreatedStoreOrder(null)).toBeNull();
    expect(parseCreatedStoreOrder({ total: 10 })).toBeNull();
    expect(parseCreatedStoreOrder({ order_number: "ORD000123", cart_replayed: true })).toEqual({
      orderNumber: "ORD000123",
      replayed: true,
    });
  });
});

describe("integración de recuperación del checkout", () => {
  const checkout = read("src/storefront/StoreCheckout.tsx");
  const order = read("src/storefront/StoreOrder.tsx");

  it("el navegador persiste la clave sin persistir el payload y valida la respuesta", () => {
    expect(checkout).toContain("storeCheckoutPayloadFingerprint(orderPayload)");
    expect(checkout).toContain("prepareStoreCheckoutAttempt");
    expect(checkout).toContain("parseCreatedStoreOrder(data)");
    expect(checkout).toContain("markStoreCheckoutOrderCreated");
    expect(order).toContain("clearStoreCheckoutAttemptForOrder");
  });
});
