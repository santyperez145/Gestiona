import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const SLUG = process.env.E2E_STORE_SLUG ?? "exentryimports";
const CATALOG = `/tienda/${SLUG}/productos`;
const STORE_RPC = "**/rest/v1/rpc/get_store_by_slug";
const CART_KEY = `gestiona.store.cart.${SLUG}`;

async function productVisible(page: Page) {
  await expect(page.locator(`a[href*="/tienda/${SLUG}/producto/"]`).first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  // These tests only read production; analytics/cart writes stay in the browser.
  for (const rpc of ["record_store_visit", "save_store_cart_v3", "start_store_checkout_v2"]) {
    await page.route(`**/rest/v1/rpc/${rpc}`, route => route.fulfill({
      status: 200, contentType: "application/json", body: "null",
    }));
  }
});

test("a hung store lookup is aborted and retried without a manual reload", async ({ page }) => {
  let attempts = 0;
  await page.route(STORE_RPC, async route => {
    if (++attempts === 1) return; // Deliberately leave the first read unanswered.
    await route.continue();
  });
  await page.goto(CATALOG);
  await productVisible(page);
  expect(attempts).toBe(2);
  await expect(page.locator('[data-storefront-state="error"]')).toHaveCount(0);
});

for (const resource of ["get_store_by_slug", "get_store_catalog_products", "get_store_variants"]) {
test(`${resource}: failed reads offer an accessible retry without losing the cart or leaking internals`, async ({ page }, testInfo) => {
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
  await expect(error).toBeVisible();
  expect(attempts).toBe(resource === "get_store_variants" ? 1 : 2);
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
