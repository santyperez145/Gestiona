/**
 * C20 — persistencia del intento de compra entre pestañas.
 *
 * El checkout ya conserva la clave idempotente en localStorage y en memoria.
 * Este spec simula la concurrencia real: el comprador inicia una compra en una
 * pestaña, la deja en curso y abre otra pestaña con el mismo carrito. La segunda
 * pestaña debe recuperar el mismo intento, no crear una orden duplicada.
 *
 * Mutating requests are intercepted; only catalogue reads reach Supabase.
 * No se escribe en producción: los RPCs devuelven null y el create falla.
 */
import { test, expect } from "@playwright/test";

const SLUG = process.env.E2E_STORE_SLUG ?? "exentryimports";
const tienda = (ruta = "") => `/tienda/${SLUG}${ruta}`;

test.beforeEach(async ({ page }) => {
  for (const rpc of ["record_store_visit", "save_store_cart_v3", "start_store_checkout_v2"]) {
    await page.route(`**/rest/v1/rpc/${rpc}`, route => route.fulfill({ status: 200, json: null }));
  }
  await page.route("**/functions/v1/**", route => route.fulfill({ status: 200, json: {} }));
});

test("recupera el mismo intento al abrir una segunda pestaña con el mismo carrito", async ({ page }, testInfo) => {
  // 1. Agregar un producto al carrito y al storage.
  await page.goto(tienda("/productos"));
  const fichas = page.locator(`a[href*="/tienda/${SLUG}/producto/"]`);
  await expect(fichas.first()).toBeVisible();
  await fichas.first().click();
  await page.getByRole("button", { name: / agregar al carrito/i }).click();

  // 2. Ir al checkout yllenar datos parcialmente (el storage del intento se escribe al enviar).
  await page.goto(tienda("/checkout"));
  await page.getByLabel("Nombre y apellido *").fill("ZZ Checkout");
  await page.getByLabel("Email *", { exact: true }).fill("checkout@example.test");

  // 3. Intercepción que frena la primera creación de orden.
  const keys: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/rest/v1/rpc/create_store_order*", async route => {
    const payload = route.request().postDataJSON();
    keys.push(payload.p_idempotency_key);
    if (keys.length === 1) await pending;
    await route.fulfill({ status: 200, json: { total: 100 } });
  });

  const action = page.getByRole("button", { name: /Finalizar compra|Pagar con Nerqia Pay/ }).filter({ visible: true });
  await expect(action).toBeEnabled();
  await action.click();

  // 4. Mientras la orden está en curso, la clave debe estar en localStorage.
  const storageKey = await page.evaluate(() => {
    const prefix = "nerqia.store.checkout.attempt.";
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix)) return k;
    }
    return null;
  });
  expect(storageKey, "el intento de checkout debe persistir en localStorage").toBeTruthy();

  // 5. Abrir una segunda pestaña (mismo storage) y verificar que recupera la misma clave.
  const page2 = await page.context().newPage();
  await page2.route("**/functions/v1/**", route => route.fulfill({ status: 200, json: {} }));
  await page2.route("**/rest/v1/rpc/record_store_visit", route => route.fulfill({ status: 200, json: null }));
  await page2.route("**/rest/v1/rpc/save_store_cart_v3", route => route.fulfill({ status: 200, json: null }));
  await page2.route("**/rest/v1/rpc/start_store_checkout_v2", route => route.fulfill({ status: 200, json: null }));
  await page2.goto(tienda("/checkout"));

  // La segunda pestaña debe tener el mismo carrito (sincronización por storage).
  await expect(page2.getByText("Tu pedido")).toBeVisible();

  // 6. En la segunda pestaña, al enviar, debe reutilizar la misma clave.
  const action2 = page2.getByRole("button", { name: /Finalizar compra|Pagar con Nerqia Pay/ }).filter({ visible: true });
  await expect(action2).toBeEnabled();
  await action2.click();

  release();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[1], "la segunda pestaña debe reutilizar la misma clave idempotente").toBe(keys[0]);

  await page2.close();
});