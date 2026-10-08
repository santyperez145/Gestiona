import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

test.use({ serviceWorkers: "block" });
const slug = "zz-search";
const base = `/tienda/${slug}`;
const productId = "00000000-0000-4000-8000-000000000001";
const products = [
  { id: productId, name: "LATTAFA KHAMRAH", brand: "LATTAFA", category: "perfumeria", stock: 5 },
  { id: "00000000-0000-4000-8000-000000000002", name: "LATTAFA ASAD", brand: "LATTAFA", category: "perfumeria", stock: 4 },
  { id: "00000000-0000-4000-8000-000000000003", name: "TALADRO INDUSTRIAL", brand: "ZZ Tool", category: "herramientas", stock: 0 },
].map((p, i) => ({ ...p, sale_price_ars: 10000 + i * 10000, description: "Producto de prueba local",
  discount_price_ars: null, promo_price: null, image_url: null, total_sold: 3 - i, created_at: "2026-10-08T00:00:00Z" }));

async function mockStore(page: Page) {
  const requests: string[] = [];
  // No production activity, cart writes, analytics, messages or provider calls.
  await page.route("**/*.supabase.co/**", async route => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    let data: unknown = [];
    if (path.endsWith("/get_store_by_slug")) data = [{ org_id: productId, owner_user_id: productId,
      name: "ZZ Tienda", slug, theme: "clean", currency: "ARS", payment_methods: ["efectivo"],
      shipping_mode: "free", shipping_cost: 0, nav_links: [], storefront_layout: null,
      social_links: {}, pickup_enabled: false }];
    else if (path.endsWith("/get_store_catalog_products")) data = products;
    else if (path.endsWith("/get_store_categories")) data = [
      { id: "zz-perfumeria", slug: "perfumeria", name: "Perfumería", productos: 2, sort_order: 0 },
      { id: "zz-herramientas", slug: "herramientas", name: "Herramientas", productos: 1, sort_order: 1 },
    ];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  });
  return requests;
}

async function openSearch(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) < 640) await page.getByRole("button", { name: "Menú", exact: true }).click();
  return page.getByRole("combobox", { name: "Buscar productos" }).filter({ visible: true });
}

test("typo: predictive search, Enter, URL and facets use the same matches", async ({ page }, testInfo) => {
  const requests = await mockStore(page);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/productos`);
  const search = await openSearch(page);
  await search.fill("lataffa");
  await expect(page.getByRole("option", { name: /LATTAFA KHAMRAH/ })).toBeVisible();
  const initialReads = requests.filter(p => p.endsWith("/get_store_catalog_products")).length;
  expect(initialReads).toBe(1);
  await search.press("Enter");
  await expect(page.getByRole("heading", { name: "Resultados para “lataffa”" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("coincidencias aproximadas");
  await expect(page.locator(".storefront-products__grid .storefront-product-card")).toHaveCount(2);
  await expect(page).toHaveURL(/q=lataffa/);
  if ((page.viewportSize()?.width ?? 1280) < 640) await page.getByRole("button", { name: /^Filtros/ }).click();
  await page.getByRole("button", { name: "Herramientas", exact: true }).click();
  await expect(page.getByText("No encontramos productos con esos filtros", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/cat=herramientas/);
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.getByRole("button", { name: "Todas", exact: true }).click();
  await expect(page.locator(".storefront-products__grid .storefront-product-card")).toHaveCount(2);
  expect(requests.filter(p => p.endsWith("/get_store_catalog_products")).length).toBe(initialReads);
  const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(audit.violations.filter(v => ["critical", "serious"].includes(v.impact ?? ""))).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("store-search-results.png"), fullPage: true });
});

test("keyboard: active option, Escape, Tab and pointer activation do not select a hidden result", async ({ page }) => {
  await mockStore(page);
  await page.goto(`${base}/productos`);
  const search = await openSearch(page);
  await search.fill("lattafa");
  await search.press("ArrowDown");
  const listId = await search.getAttribute("aria-controls");
  await expect(search).toHaveAttribute("aria-activedescendant", `${listId}-0`);
  await expect(page.locator(`[id="${listId}-0"]`)).toHaveAttribute("aria-selected", "true");
  await search.press("Escape");
  await expect(search).toHaveAttribute("aria-expanded", "false");
  await expect(search).not.toHaveAttribute("aria-activedescendant", /.+/);
  await search.press("Enter");
  await expect(page).toHaveURL(/productos\?q=lattafa$/);
  const reopened = await openSearch(page);
  await expect(page.getByRole("heading", { name: "Resultados para “lattafa”" })).toBeVisible();
  await reopened.fill("khamrah");
  await expect(page.getByRole("option", { name: /LATTAFA KHAMRAH/ })).toBeVisible();
  await reopened.press("Tab");
  await expect(page.getByRole("button", { name: "Borrar la búsqueda" }).filter({ visible: true })).toBeFocused();
  await page.getByRole("button", { name: "Borrar la búsqueda" }).filter({ visible: true }).press("Tab");
  const allResults = page.getByRole("button", { name: "Ver todo lo que coincide", exact: false });
  await expect(allResults).toBeFocused();
  await allResults.press("Escape");
  await expect(reopened).toBeFocused();
  await expect(reopened).toHaveAttribute("aria-expanded", "false");
  await reopened.click();
  await expect(reopened).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("option", { name: /LATTAFA KHAMRAH/ }).click();
  await expect(page).toHaveURL(new RegExp(`/producto/${productId}$`));
  await expect(page.getByRole("heading", { name: "LATTAFA KHAMRAH", exact: true })).toBeVisible();
});

test("a matching sold-out product remains discoverable without being offered as available", async ({ page }) => {
  await mockStore(page);
  await page.goto(`${base}/productos`);
  const search = await openSearch(page);
  await search.fill("taladro");
  await expect(page.getByRole("option", { name: /TALADRO INDUSTRIAL/ })).toBeVisible();
  await search.press("Enter");
  await expect(page.locator(".storefront-products__grid .storefront-product-card")).toHaveCount(1);
  await expect(page.getByText("Sin stock", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".storefront-products__grid").getByRole("button", { name: "Agregar al carrito", exact: true })).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("two search inputs have distinct accessible popups; list fits at tablet width", async ({ page }, testInfo) => {
  await mockStore(page);
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(`${base}/productos`);
  const header = page.getByRole("combobox", { name: "Buscar productos" });
  await header.fill("lattafa");
  const headerId = await header.getAttribute("aria-controls");
  await page.getByRole("button", { name: "Menú", exact: true }).click();
  const panel = page.getByRole("combobox", { name: "Buscar productos" }).nth(1);
  await panel.fill("lattafa");
  const panelId = await panel.getAttribute("aria-controls");
  expect(panelId).not.toBe(headerId);
  await expect(panel).toHaveAttribute("aria-expanded", "true");
  const violations = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations;
  expect(violations.filter(v => ["critical", "serious"].includes(v.impact ?? ""))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("store-search-tablet.png") });
});
