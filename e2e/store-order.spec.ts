import { expect, test } from "@playwright/test";

const slug = process.env.E2E_STORE_SLUG ?? "exentryimports";
const orderNumber = "ZZ-RECOVERY";
const order = {
  order_number: orderNumber, customer_name: "ZZ Test", customer_email: "checkout@example.test",
  items: [{ name: "Producto de prueba", quantity: 1, unit_price: 100, total: 100 }],
  subtotal: 100, shipping_cost: 0, total: 100, payment_method: "gestiona_pay",
  payment_status: "pending", fulfillment_status: "pending", shipping_address: {},
  created_at: "2026-09-10T10:00:00Z", access_token: null,
};

test("recupera la consulta y los botones de pago sin crear otra compra", async ({ page }, testInfo) => {
  // Synthetic order and payment endpoints never reach the real backend.
  for (const rpc of ["record_store_visit", "save_store_cart_v3", "start_store_checkout_v2"]) {
    await page.route(`**/rest/v1/rpc/${rpc}`, route => route.fulfill({ status: 200, json: null }));
  }
  await page.route("**/rest/v1/rpc/create_store_order*", route => route.abort());
  await page.route("**/functions/v1/**", route => route.abort());
  const paymentRequests: Array<{ action: string; orderNumber: string }> = [];
  await page.route("**/functions/v1/store-pay", route => {
    paymentRequests.push(route.request().postDataJSON());
    return route.abort("failed");
  });
  let failRead = true;
  let paymentStatus = "pending";
  await page.route("**/rest/v1/rpc/get_store_order*", route => failRead
    ? route.abort("failed")
    : route.fulfill({ status: 200, json: { ...order, payment_status: paymentStatus } }));
  await page.route("**/rest/v1/rpc/get_order_tracking", route => route.fulfill({ status: 200, json: {
    found: true, fulfillment_status: "pending", ordered_at: order.created_at,
  } }));
  await page.goto(`/tienda/${slug}/orden/${orderNumber}`);
  await expect(page.getByRole("heading", { name: "No pudimos cargar tu pedido" })).toBeVisible();
  await expect(page.getByLabel("Email de la compra")).toHaveCount(0);
  failRead = false;
  await page.getByRole("button", { name: "Reintentar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "¡Gracias por tu compra!" })).toBeVisible();

  const card = page.getByRole("button", { name: /Pagar con tarjeta/ });
  await card.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(card).toBeEnabled();
  await page.getByRole("button", { name: "Otros medios" }).click();
  await expect(page.getByRole("button", { name: "Otros medios" })).toBeEnabled();
  await expect(page.getByRole("alert")).toBeVisible();
  expect(paymentRequests.map(request => request.action)).toEqual(["brick-config", "redirect"]);
  expect(paymentRequests.every(request => request.orderNumber === orderNumber)).toBe(true);
  await expect(page.getByText(/Failed to fetch|Edge Function|FunctionsFetchError/)).toHaveCount(0);
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  await page.screenshot({ path: testInfo.outputPath("order-recovery.png"), fullPage: true });
  paymentStatus = "paid";
  await page.getByRole("button", { name: "Actualizar estado del pedido" }).click();
  await expect(page.getByRole("heading", { name: "¡Pago confirmado!" })).toBeVisible();
  await expect(card).toHaveCount(0);
  expect(paymentRequests).toHaveLength(2);
});
