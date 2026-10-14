import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { configurePublicStore } from "./publicStoreFixture";

const SLUG = process.env.E2E_STORE_SLUG ?? "exentryimports";
const CATALOG = `/tienda/${SLUG}/productos`;
const STORE_RPC = "**/rest/v1/rpc/get_store_by_slug";
const CART_KEY = `gestiona.store.cart.${SLUG}`;

// Las lecturas reales (precondición y recuperación) pueden colgarse en la red
// del runner: la tienda las reintenta sola hasta 4 veces de 4 s por recurso
// (tienda y catálogo, ~20 s cada uno). Esperar menos que ese plazo hacía fallar
// la precondición mientras la app se estaba recuperando como corresponde
// (CI 2026-10-14). Lo que se verifica (error accesible, intentos, carrito) no
// cambia.
const PLAZO_DE_RECUPERACION = 45_000;

async function productVisible(page: Page) {
  await expect(page.locator(`a[href*="/tienda/${SLUG}/producto/"]`).first()).toBeVisible({ timeout: PLAZO_DE_RECUPERACION });
}

test.beforeEach(async ({ page }) => {
  // A live, bounded baseline must pass. Injected failures then own lookup
  // timing; catalogue and variant reads remain real except the targeted fault.
  await configurePublicStore(page, SLUG, row => row);
  // These tests only read production; analytics/cart writes stay in the browser.
  for (const rpc of ["record_store_visit", "save_store_cart_v3", "start_store_checkout_v2"]) {
    await page.route(`**/rest/v1/rpc/${rpc}`, route => route.fulfill({
      status: 200, contentType: "application/json", body: "null",
    }));
  }
});

test("a hung store lookup is aborted and retried without a manual reload", async ({ page }) => {
  test.setTimeout(90_000);
  let attempts = 0;
  await page.route(STORE_RPC, async route => {
    if (++attempts === 1) return; // Deliberately leave the first read unanswered.
    await route.fallback(); // Restore the verified baseline after the injected hang.
  });
  await page.goto(CATALOG);
  await productVisible(page);
  expect(attempts).toBe(2);
  await expect(page.locator('[data-storefront-state="error"]')).toHaveCount(0);
});

// El catálogo se lee con get_store_catalog_completo (un JSON, sin el tope de
// 1.000 filas, 2026-10-14).
for (const resource of ["get_store_by_slug", "get_store_catalog_completo", "get_store_variants"]) {
test(`${resource}: failed reads offer an accessible retry without losing the cart or leaking internals`, async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  await page.goto(CATALOG);
  await productVisible(page);
  await page.locator(`a[href*="/tienda/${SLUG}/producto/"]`).first().click();
  await page.getByTestId("product-add-to-cart").click();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "[]").length, CART_KEY))
    .toBeGreaterThan(0);
  const savedCart = await page.evaluate(key => localStorage.getItem(key), CART_KEY);
  let attempts = 0;
  const rpcRoute = `**/rest/v1/rpc/${resource}`;
  await page.route(rpcRoute, async route => {
    attempts += 1;
    if (resource === "get_store_variants") {
      await route.fulfill({
        status: 403, contentType: "application/json",
        body: JSON.stringify({ code: "42501", message: "ZZ private backend detail" }),
      });
    }
    // Other reads remain unanswered until the browser's deadline aborts them.
  });
  await page.goto(CATALOG);
  const error = page.locator('[data-storefront-state="error"]');
  // Store lookup + resource each allow four 4s attempts (0,3 s, 1 s y 2,5 s
  // entre intentos, 2026-10-14); keep the test bounded without expiring before
  // the recovery contract's own deadlines. The automatic reload starts 5 s
  // after the error, so the attempt count is still exact here.
  await expect(error).toBeVisible({ timeout: 60_000 });
  expect(attempts).toBe(resource === "get_store_variants" ? 1 : 4);
  await expect(error).toContainText("Tu carrito sigue guardado");
  await expect(error).not.toContainText(/ETIMEDOUT|supabase|SQL|service_role|private backend/i);
  expect(await page.evaluate(key => localStorage.getItem(key), CART_KEY)).toBe(savedCart);
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(audit.violations.filter(v => ["critical", "serious"].includes(v.impact ?? ""))).toEqual([]);
  expect(await page.evaluate(key => localStorage.getItem(key), CART_KEY)).toBe(savedCart);
  await page.screenshot({ path: testInfo.outputPath("store-read-retry.png"), fullPage: true });
  await page.unroute(rpcRoute);
  await page.getByRole("button", { name: "Reintentar" }).click();
  await productVisible(page);
  await expect(error).toHaveCount(0);
});
}
