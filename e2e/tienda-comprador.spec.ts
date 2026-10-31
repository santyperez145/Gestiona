import { expect, test } from "@playwright/test";
import { exigirBackendReal } from "./backendReal";

/**
 * El comprador con cuenta, de punta a punta contra la base real (2026-10-30).
 *
 * La semilla (`semilla-e2e-local.mjs`) le da $ 50.000 de saldo a favor, la
 * tienda vende minorista y mayorista, y hay un producto sólo para este
 * recorrido. Sin mocks: cada paso pasa por las funciones de la base
 * (mi_saldo_en_tienda, solicitar_cotizacion_tienda, create_store_order con
 * saldo, mis_cotizaciones_tienda, request_store_return con cambio).
 */
exigirBackendReal();

const SLUG = process.env.E2E_STORE_SLUG ?? "exentryimports";
const EMAIL = process.env.E2E_BUYER_EMAIL ?? "";
const PASSWORD = process.env.E2E_BUYER_PASSWORD ?? "";
const PRODUCTO = "ZZ Cotizable mayorista";
const PRODUCTO_CARO = "ZZ Pedido grande";
const PRODUCTO_PREVENTA = "ZZ Zócalo en preventa";
const tienda = (path = "") => `/tienda/${SLUG}${path}`;

test("el comprador ve su saldo, pide cotización, paga con saldo y pide un cambio", async ({ page }, testInfo) => {
  test.skip(!EMAIL || !PASSWORD, "Sin comprador de prueba (sólo en el E2E contra la base local).");
  // Un solo navegador: el recorrido consume saldo y pedidos de cotización.
  test.skip(testInfo.project.name !== "chromium", "El recorrido corre una vez, en escritorio.");
  test.setTimeout(240_000);

  // 1. Entra con su cuenta y ve su saldo.
  await page.goto(tienda("/cuenta"));
  await page.getByLabel("Email", { exact: true }).fill(EMAIL);
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.getByRole("heading", { name: /^Hola/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Tenés .+ de saldo a favor/)).toBeVisible({ timeout: 20_000 });

  // 2. Arma el carrito.
  await page.goto(tienda(`/productos?q=${encodeURIComponent("Cotizable")}`));
  const ficha = page.locator(`a[href*="/tienda/${SLUG}/producto/"]`).filter({ hasText: PRODUCTO }).first();
  await expect(ficha).toBeVisible({ timeout: 30_000 });
  await ficha.click();
  await page.getByTestId("product-add-to-cart").click();

  // 3. Pide cotización desde el carrito; el carrito queda como estaba.
  await page.goto(tienda("/carrito"));
  await page.getByRole("button", { name: "Pedir cotización" }).click();
  await page.getByLabel(/Algo que debamos saber/).fill("Obra del E2E: entrega en 15 días");
  await page.getByRole("button", { name: "Enviar pedido de cotización" }).click();
  await expect(page.getByText(/llegó a la tienda/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(PRODUCTO).first()).toBeVisible();

  // 4. Paga con su saldo a favor (retiro en el local: no pide domicilio).
  await page.goto(tienda("/checkout"));
  await page.getByLabel("Nombre y apellido *").fill("ZZ Comprador E2E");
  await page.getByLabel("Email *", { exact: true }).fill(EMAIL);
  const conSaldo = page.getByLabel("Con mi saldo a favor");
  await expect(conSaldo).toBeVisible({ timeout: 20_000 });
  await conSaldo.check();
  await expect(page.getByText(/Saldo disponible:/)).toBeVisible();
  const finalizar = page.getByRole("button", { name: /Finalizar compra/ }).filter({ visible: true });
  await expect(finalizar).toBeEnabled({ timeout: 20_000 });
  await finalizar.click();
  // Pagado en el acto con el saldo: la página del pedido lo confirma.
  await expect(page.getByRole("heading", { name: "¡Pago confirmado!" })).toBeVisible({ timeout: 30_000 });

  // 5. En Mi cuenta: la cotización esperando respuesta y el pedido pagado.
  await page.goto(tienda("/cuenta"));
  await expect(page.getByRole("heading", { name: "Mis cotizaciones" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/Esperando respuesta de la tienda/).first()).toBeVisible();
  const cambiar = page.getByRole("link", { name: /Cambiar o devolver/ }).first();
  await expect(cambiar).toBeVisible({ timeout: 20_000 });

  // 6. Pide un cambio desde el pedido, con la orden y el email ya cargados.
  await cambiar.click();
  await expect(page.getByRole("button", { name: /Quiero cambiarlo/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Número de orden")).not.toHaveValue("");
  await page.getByLabel("Qué querés a cambio").fill("El mismo, en otra medida");
  await page.getByRole("button", { name: "Enviar el pedido" }).click();
  await expect(page.getByRole("heading", { name: "Pedido registrado" })).toBeVisible({ timeout: 20_000 });

  // 7. Saldo parcial (20261030001400): un pedido más caro que lo que le queda
  //    de saldo; usa el saldo y transfiere el resto.
  await page.goto(tienda(`/productos?q=${encodeURIComponent("Pedido grande")}`));
  const caro = page.locator(`a[href*="/tienda/${SLUG}/producto/"]`).filter({ hasText: PRODUCTO_CARO }).first();
  await expect(caro).toBeVisible({ timeout: 30_000 });
  await caro.click();
  await page.getByTestId("product-add-to-cart").click();
  await page.goto(tienda("/checkout"));
  await page.getByLabel("Nombre y apellido *").fill("ZZ Comprador E2E");
  await page.getByLabel("Email *", { exact: true }).fill(EMAIL);
  await page.getByLabel("Transferencia bancaria").check();
  await expect(page.getByLabel(/Usar mi saldo a favor/)).toBeChecked({ timeout: 20_000 });
  const finalizarParcial = page.getByRole("button", { name: /Finalizar compra/ }).filter({ visible: true });
  await expect(finalizarParcial).toBeEnabled({ timeout: 20_000 });
  await finalizarParcial.click();
  await expect(page.getByRole("heading", { name: "¡Gracias por tu compra!" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Pagaste .+ con tu saldo a favor/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("A pagar", { exact: true })).toBeVisible();

  // 8. Preventa (20261030001900): sin stock, se compra en preventa y el
  //    pedido dice qué llega después. El saldo ya se usó entero.
  await page.goto(tienda(`/productos?q=${encodeURIComponent("preventa")}`));
  const tarjeta = page.locator("article").filter({ hasText: PRODUCTO_PREVENTA }).first();
  await expect(tarjeta.getByText("Preventa", { exact: true })).toBeVisible({ timeout: 30_000 });
  await tarjeta.getByRole("button", { name: "Comprar en preventa" }).click();
  await page.goto(tienda("/checkout"));
  await expect(page.getByTestId("checkout-preventa")).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Nombre y apellido *").fill("ZZ Comprador E2E");
  await page.getByLabel("Email *", { exact: true }).fill(EMAIL);
  await page.getByLabel("Transferencia bancaria").check();
  const finalizarPreventa = page.getByRole("button", { name: /Finalizar compra/ }).filter({ visible: true });
  await expect(finalizarPreventa).toBeEnabled({ timeout: 20_000 });
  await finalizarPreventa.click();
  await expect(page.getByRole("heading", { name: "¡Gracias por tu compra!" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/1 unidad es de preventa/)).toBeVisible({ timeout: 20_000 });
});
