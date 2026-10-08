import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import * as XLSX from "xlsx";

test.use({ serviceWorkers: "block" });
const orgId = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000001";

// All Auth/API requests are synthetic, including writes. No merchant data is touched.
async function mockImporter(page: Page) {
  const url = process.env.VITE_SUPABASE_URL ?? "https://hummeopatkniwkyrrhwc.supabase.co";
  const storageKey = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: userId, email: "zz-import@invalid.test", aud: "authenticated", role: "authenticated",
    created_at: "2026-10-08T00:00:00Z", app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { full_name: "ZZ Importación" }, identities: [], factors: [] };
  const token = [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url"),
    Buffer.from(JSON.stringify({ sub: userId, role: "authenticated", exp: expires, aal: "aal1" })).toString("base64url"),
    Buffer.from("synthetic-ui-only").toString("base64url")].join(".");
  await page.addInitScript(({ storageKey, session, orgId }) => {
    localStorage.setItem(storageKey, JSON.stringify(session)); localStorage.setItem("gestiona.activeOrgId", orgId);
  }, { storageKey, orgId, session: { access_token: token, refresh_token: "synthetic-ui-only", token_type: "bearer", expires_at: expires, expires_in: 3600, user } });
  const writes: string[] = [];
  await page.route(`${url}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    const readRpc = ['/rest/v1/rpc/get_my_platform_announcements', '/rest/v1/rpc/org_entitlements', '/rest/v1/rpc/get_product_plan_usage'].includes(path);
    if (!['GET', 'HEAD'].includes(route.request().method()) && !path.startsWith('/auth/') && !readRpc) writes.push(path);
    let result: unknown = [];
    if (path === "/auth/v1/user") result = user;
    else if (path === "/rest/v1/memberships") result = [{ org_id: orgId, role: "owner", organization: {
      id: orgId, name: "ZZ Ferretería", slug: "zz-import", owner_user_id: userId, onboarding_completed: true,
      onboarding_goal: "explore", plan_id: null, trial_ends_at: null, logo_url: null } }];
    else if (path === "/rest/v1/settings") result = [{ org_id: orgId, user_id: userId, business_name: "ZZ Ferretería", exchange_rate: 1000 }];
    else if (path.endsWith('/get_product_plan_usage')) result = { products_used: 0, max_products: null };
    await route.fulfill({ status: 200, json: result });
  });
  return writes;
}

function excelFile(ambiguous = false) {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Ayuda", "Archivo sintético, no importar"]]), "Instrucciones");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Stock", "Precio"], [],
    ["Código de artículo", ambiguous ? "Nombre" : "Nombre del producto", ambiguous ? "Nombre" : "Marca", "Costo", "Precio de venta"],
    ["000012", "ZZ Martillo", ambiguous ? "ZZ Otro nombre" : "ZZ Marca", 1000, 2000],
  ]), "Catálogo");
  return { name: "zz-catalogo.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: XLSX.write(book, { type: "buffer", bookType: "xlsx" }) };
}

test("importador Excel: detecta hoja/fila, confirma moneda y conserva revisión sin escrituras", async ({ page }, testInfo) => {
  const writes = await mockImporter(page);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/productos?importar=1');
  const importer = page.getByRole('dialog', { name: 'Importar catálogo' });
  await importer.locator('input[type="file"]').setInputFiles(excelFile());
  await expect(importer.getByRole('combobox', { name: 'Hoja del archivo' })).toHaveText('Catálogo');
  await expect(importer.getByRole('combobox', { name: 'Fila de encabezados' })).toHaveText(/^Fila 3/);
  await expect(importer.getByText('ZZ Martillo', { exact: true })).toBeVisible();
  await expect(importer.getByText('000012', { exact: true })).toBeVisible();
  const prepare = importer.getByRole('button', { name: 'Preparar y validar' });
  await expect(prepare).toBeDisabled();
  await importer.getByRole('combobox', { name: 'Moneda del costo de origen' }).click();
  await page.getByRole('option', { name: 'Pesos argentinos (ARS)', exact: true }).click();
  await expect(prepare).toBeEnabled();
  for (const width of [360, 390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await importer.getByRole('combobox', { name: 'Fila de encabezados' }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(importer.getByRole('combobox', { name: 'Fila de encabezados' })).toBeVisible();
    expect((await importer.getByRole('combobox', { name: 'Fila de encabezados' }).boundingBox())!.height).toBeGreaterThanOrEqual(40);
    await page.screenshot({ path: testInfo.outputPath(`catalog-import-${width}.png`) });
  }
  const violations = (await new AxeBuilder({ page }).include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.filter(item => ['serious', 'critical'].includes(item.impact));
  expect(violations).toEqual([]);
  // A duplicate identity column cannot be assigned without review.
  await importer.getByRole('button', { name: 'Cambiar archivo', exact: true }).click();
  await importer.locator('input[type="file"]').setInputFiles(excelFile(true));
  await expect(importer.getByRole('combobox', { name: 'Nombre del producto', exact: true })).toHaveText('No importar esta columna');
  await expect(prepare).toBeDisabled();
  await importer.getByRole('combobox', { name: 'Nombre del producto', exact: true }).click();
  await page.getByRole('option', { name: 'Nombre · columna B', exact: true }).click();
  await expect(importer.getByText('ZZ Martillo', { exact: true })).toBeVisible();
  await expect(prepare).toBeDisabled(); // Currency still needs explicit confirmation.
  expect(writes).toEqual([]); expect(errors).toEqual([]);
});

for (const platform of ["shopify", "tiendanube"]) {
  test(`costos ${platform}: confirmar ARS sin perder agrupación ni escribir catálogo`, async ({ page }) => {
    const writes = await mockImporter(page);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const book = XLSX.utils.book_new();
    const matrix = platform === "shopify"
      ? [["Handle", "Title", "Variant SKU", "Variant Price", "Option1 Name", "Option1 Value", "Cost per item"], ["zz-camisa", "ZZ Camisa", "ZZ-S", 1000, "Talle", "S", 500], ["zz-camisa", "", "ZZ-M", 1200, "Talle", "M", 600]]
      : [["Identificador de URL", "Nombre", "SKU", "Precio", "Nombre de propiedad 1", "Valor de propiedad 1", "Costo"], ["zz-camisa", "ZZ Camisa", "ZZ-S", 1000, "Talle", "S", 500], ["zz-camisa", "", "ZZ-M", 1200, "Talle", "M", 600]];
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(matrix), "Catálogo");
    await page.goto('/productos?importar=1');
    const importer = page.getByRole('dialog', { name: 'Importar catálogo' });
    await importer.locator('input[type="file"]').setInputFiles({ name: 'zz-platform.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) });
    const currency = importer.getByRole('combobox', { name: 'Moneda del costo de origen' });
    const prepare = importer.getByRole('button', { name: 'Preparar y validar' });
    await expect(prepare).toBeDisabled();
    await expect(currency).toBeEnabled();
    await currency.click();
    await page.getByRole('option', { name: 'Pesos argentinos (ARS)', exact: true }).click();
    await expect(importer.getByText('ZZ Camisa', { exact: true })).toBeVisible();
    await expect(currency).toHaveText('Pesos argentinos (ARS)');
    await expect(prepare).toBeEnabled();
    await expect(importer.getByRole('combobox', { name: 'Nombre del producto', exact: true })).toHaveCount(0);
    expect(writes).toEqual([]); expect(errors).toEqual([]);
  });
}
