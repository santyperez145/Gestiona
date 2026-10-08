import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import * as XLSX from "xlsx";

test.use({ serviceWorkers: "block" });
const orgId = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000001";

// All Auth/API requests are synthetic, including writes. No merchant data is touched.
async function mockImporter(page: Page, staging = false) {
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
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  let session: Record<string, unknown> | undefined;
  let stagedRows: unknown[] = [];
  await page.route(`${url}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    const readRpc = ['/rest/v1/rpc/get_my_platform_announcements', '/rest/v1/rpc/org_entitlements', '/rest/v1/rpc/get_product_plan_usage'].includes(path);
    if (!['GET', 'HEAD'].includes(route.request().method()) && !path.startsWith('/auth/') && !readRpc) {
      writes.push(path);
      requests.push({ path, body: route.request().postDataJSON() });
    }
    let result: unknown = [];
    if (path === "/auth/v1/user") result = user;
    else if (path === "/rest/v1/memberships") result = [{ org_id: orgId, role: "owner", organization: {
      id: orgId, name: "ZZ Ferretería", slug: "zz-import", owner_user_id: userId, onboarding_completed: true,
      onboarding_goal: "explore", plan_id: null, trial_ends_at: null, logo_url: null } }];
    else if (path === "/rest/v1/settings") result = [{ org_id: orgId, user_id: userId, business_name: "ZZ Ferretería", exchange_rate: 1000 }];
    else if (path.endsWith('/get_product_plan_usage')) result = { products_used: 0, max_products: null };
    else if (staging && path.endsWith('/start_catalog_import')) {
      const body = route.request().postDataJSON();
      session = { ok: true, id: body.p_session_id, org_id: body.p_org_id, filename: body.p_filename,
        source_format: body.p_source_format, source_system: body.p_source_system, source_rows: body.p_source_rows,
        total: body.p_total, options: body.p_options, status: 'preparing', prepared: 0, applied: 0,
        skip_invalid: false, valid: 0, invalid: 0, creates: 0, updates: 0, created: 0, updated: 0,
        stock_movements: 0, skipped: 0, variants: 0, images: 0, variants_created: 0,
        variants_updated: 0, redirects: 0, reconciled: false };
      result = session;
    } else if (staging && path.endsWith('/stage_catalog_import_chunk')) {
      const body = route.request().postDataJSON();
      stagedRows = body.p_rows.map((normalized: unknown, index: number) => ({ id: `zz-row-${index}`,
        session_position: body.p_position + index, normalized, action: 'create', status: 'pending',
        validation_errors: [], validation_warnings: [] }));
      session = { ...session, status: 'ready', prepared: body.p_position + body.p_rows.length,
        valid: body.p_rows.length, creates: body.p_rows.length };
      result = session;
    } else if (staging && path === '/rest/v1/product_import_rows') result = stagedRows;
    await route.fulfill({ status: 200, json: result });
  });
  return { writes, requests };
}

function columnDestination(importer: Locator, letter: string) {
  return importer.getByRole('combobox', { name: new RegExp(`^Destino de columna ${letter}:`) });
}

async function assignColumn(page: Page, importer: Locator, letter: string, destination: string) {
  await columnDestination(importer, letter).click();
  const escaped = destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page.getByRole('option', { name: new RegExp(`^${escaped}(?: · Obligatorio)?$`) }).click();
}

function columnConfirmation(importer: Locator) {
  return importer.getByRole('checkbox', { name: 'Confirmo que cada columna corresponde al dato indicado', exact: true });
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
  const { writes } = await mockImporter(page);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/productos?importar=1');
  const importer = page.getByRole('dialog', { name: 'Importar catálogo' });
  await importer.locator('input[type="file"]').setInputFiles(excelFile());
  await expect(importer.getByRole('combobox', { name: 'Hoja del archivo' })).toHaveText('Catálogo');
  await expect(importer.getByRole('combobox', { name: 'Fila de encabezados' })).toHaveText(/^Fila 3/);
  await expect(columnDestination(importer, 'A')).toHaveText('Código / SKU');
  await expect(columnDestination(importer, 'B')).toHaveText(/^Nombre del producto/);
  await expect(columnDestination(importer, 'C')).toHaveText('Marca');
  await expect(importer.getByText('Ejemplos: 000012', { exact: true })).toBeVisible();
  await expect(importer.getByRole('cell', { name: 'ZZ Martillo', exact: true })).toBeVisible();
  await expect(importer.getByRole('cell', { name: '000012', exact: true })).toBeVisible();
  const prepare = importer.getByRole('button', { name: 'Preparar y validar' });
  await expect(prepare).toBeDisabled();
  await importer.getByRole('combobox', { name: 'Moneda del costo de origen' }).click();
  await page.getByRole('option', { name: 'Pesos argentinos (ARS)', exact: true }).click();
  await expect(prepare).toBeDisabled();
  await columnConfirmation(importer).check();
  await expect(prepare).toBeEnabled();
  await assignColumn(page, importer, 'C', 'No importar');
  await expect(columnConfirmation(importer)).not.toBeChecked();
  await importer.getByRole('button', { name: 'Restaurar detección', exact: true }).click();
  await expect(columnDestination(importer, 'C')).toHaveText('Marca');
  await expect(columnConfirmation(importer)).not.toBeChecked();
  await expect(prepare).toBeDisabled();
  await expect(importer.getByRole('combobox', { name: 'Moneda del costo de origen' })).toHaveText('Confirmá la moneda del costo');
  await importer.getByRole('combobox', { name: 'Moneda del costo de origen' }).click();
  await page.getByRole('option', { name: 'Pesos argentinos (ARS)', exact: true }).click();
  await columnConfirmation(importer).check();
  await expect(prepare).toBeEnabled();
  for (const width of [360, 390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await columnDestination(importer, 'A').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(columnDestination(importer, 'A')).toBeVisible();
    expect((await columnDestination(importer, 'A').boundingBox())!.height).toBeGreaterThanOrEqual(40);
    await page.screenshot({ path: testInfo.outputPath(`catalog-import-${width}.png`) });
  }
  const violations = (await new AxeBuilder({ page }).include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations.filter(item => ['serious', 'critical'].includes(item.impact));
  expect(violations).toEqual([]);
  // A duplicate identity column cannot be assigned without review.
  await importer.getByRole('button', { name: 'Cambiar archivo', exact: true }).click();
  await importer.locator('input[type="file"]').setInputFiles(excelFile(true));
  await expect(columnDestination(importer, 'B')).toHaveText('No importar');
  await expect(columnDestination(importer, 'C')).toHaveText('No importar');
  await expect(prepare).toBeDisabled();
  await assignColumn(page, importer, 'B', 'Nombre del producto');
  await expect(importer.getByRole('cell', { name: 'ZZ Martillo', exact: true })).toBeVisible();
  await expect(prepare).toBeDisabled(); // Currency still needs explicit confirmation.
  expect(writes).toEqual([]); expect(errors).toEqual([]);
});

for (const platform of ["shopify", "tiendanube"]) {
  test(`costos ${platform}: confirmar ARS sin perder agrupación ni escribir catálogo`, async ({ page }) => {
    const { writes } = await mockImporter(page);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const book = XLSX.utils.book_new();
    const matrix = platform === "shopify"
      ? [["Handle", "Title", "Variant SKU", "Variant Price", "Option1 Name", "Option1 Value", "Cost per item"], ["zz-camisa", "ZZ Camisa", "ZZ-S", 1000, "Talle", "S", 500], ["zz-camisa", "", "ZZ-M", 1200, "Talle", "M", 600]]
      : [["Identificador de URL", "Nombre", "SKU", "Precio", "Nombre de propiedad 1", "Valor de propiedad 1", "Costo"], ["zz-camisa", "ZZ Camisa", "ZZ-S", 1000, "Talle", "S", 500], ["zz-camisa", "", "ZZ-M", 1200, "Talle", "M", 600]];
    matrix[0].push('Notas internas');
    matrix.slice(1).forEach(row => row.push(''));
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
    await expect(importer.getByRole('cell', { name: 'ZZ Camisa', exact: true })).toBeVisible();
    await expect(currency).toHaveText('Pesos argentinos (ARS)');
    await expect(prepare).toBeDisabled();
    await columnConfirmation(importer).check();
    await expect(prepare).toBeEnabled();
    await expect(columnDestination(importer, 'B')).toHaveText(/^Nombre del producto/);
    await expect(columnDestination(importer, 'C')).toHaveText('Código / SKU');
    await assignColumn(page, importer, 'C', 'No importar');
    await expect(columnConfirmation(importer)).not.toBeChecked();
    await expect(prepare).toBeDisabled();
    await assignColumn(page, importer, 'C', 'Código / SKU');
    await columnConfirmation(importer).check();
    await expect(prepare).toBeEnabled();
    await assignColumn(page, importer, 'F', 'No importar');
    await expect(columnConfirmation(importer)).not.toBeChecked();
    await expect(columnConfirmation(importer)).toBeDisabled();
    await expect(prepare).toBeDisabled();
    await expect(importer.getByText('Corregí la asignación antes de continuar', { exact: true })).toBeVisible();
    await assignColumn(page, importer, 'H', 'Propiedad 1: valor');
    await expect(columnConfirmation(importer)).not.toBeChecked();
    await expect(columnConfirmation(importer)).toBeDisabled();
    await expect(prepare).toBeDisabled();
    await expect(importer.getByText('Corregí la asignación antes de continuar', { exact: true })).toBeVisible();
    await assignColumn(page, importer, 'H', 'No importar');
    await assignColumn(page, importer, 'F', 'Propiedad 1: valor');
    await columnConfirmation(importer).check();
    await expect(prepare).toBeEnabled();
    expect(writes).toEqual([]); expect(errors).toEqual([]);
  });
}

test('mapeo manual: reasigna SKU, omite precio y persiste sólo la selección revisada sin aprobar', async ({ page }) => {
  const { writes, requests } = await mockImporter(page, true);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['Artículo del listado', 'Identificador interno', 'Código del fabricante', 'Precio de venta', 'Nota de proveedor'],
    ['ZZ Taladro', '000079', 'PROV-99', 2000, 'No cambiar datos operativos'],
  ]), 'Catálogo');
  await page.goto('/productos?importar=1');
  const importer = page.getByRole('dialog', { name: 'Importar catálogo' });
  await importer.locator('input[type="file"]').setInputFiles({ name: 'zz-mapeo-manual.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) });
  const prepare = importer.getByRole('button', { name: 'Preparar y validar' });
  await expect(columnDestination(importer, 'A')).toHaveText('No importar');
  await expect(columnDestination(importer, 'D')).toHaveText('Precio normal / lista');
  await expect(prepare).toBeDisabled();
  await assignColumn(page, importer, 'A', 'Nombre del producto');
  await assignColumn(page, importer, 'B', 'Código / SKU');
  await columnConfirmation(importer).check();
  await expect(prepare).toBeEnabled();
  await columnDestination(importer, 'C').click();
  await expect(page.getByRole('option', { name: 'Código / SKU', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await assignColumn(page, importer, 'B', 'No importar');
  await expect(columnConfirmation(importer)).not.toBeChecked();
  await expect(prepare).toBeDisabled();
  await assignColumn(page, importer, 'C', 'Código / SKU');
  await assignColumn(page, importer, 'D', 'No importar');
  await expect(importer.getByRole('cell', { name: 'PROV-99', exact: true })).toBeVisible();
  await columnConfirmation(importer).check();
  expect(writes).toEqual([]);
  await prepare.click();
  await expect(importer.getByText('Validación completa', { exact: true })).toBeVisible();
  await expect(importer.getByRole('button', { name: 'Aprobar 1 filas', exact: true })).toBeEnabled();
  expect(writes).toEqual(['/rest/v1/rpc/start_catalog_import', '/rest/v1/rpc/stage_catalog_import_chunk']);
  const options = requests[0].body.p_options as Record<string, unknown>;
  expect(options.column_mapping).toEqual({ '0': 'name', '1': '', '2': 'sku', '3': '', '4': '' });
  const products = requests[1].body.p_rows as Record<string, unknown>[];
  expect(products).toHaveLength(1);
  expect(products[0]).toMatchObject({ name: 'ZZ Taladro', sku: 'PROV-99' });
  expect(products[0]).not.toHaveProperty('sale_price_ars');
  expect(products[0].provided).not.toContain('sale_price_ars');
  expect(products[0]).toHaveProperty('source_record');
  expect(JSON.parse(String(products[0].source_record))).toEqual({
    headers: ['Artículo del listado', 'Identificador interno', 'Código del fabricante', 'Precio de venta', 'Nota de proveedor'],
    values: ['ZZ Taladro', '000079', 'PROV-99', 2000, 'No cambiar datos operativos'],
  });
  expect(errors).toEqual([]);
});
