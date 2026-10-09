import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

test.use({ serviceWorkers: 'block' });
const orgId = '00000000-0000-4000-8000-000000000102';
const userId = '00000000-0000-4000-8000-000000000101';
const toolTypeId = '00000000-0000-4000-8000-000000000103';
const perfumeTypeId = '00000000-0000-4000-8000-000000000104';
const serviceTypeId = '00000000-0000-4000-8000-000000000105';
const diameterId = '00000000-0000-4000-8000-000000000106';
const timeId = '00000000-0000-4000-8000-000000000107';
const toolId = '00000000-0000-4000-8000-000000000108';
const legacyId = '00000000-0000-4000-8000-000000000109';
const perfumeId = '00000000-0000-4000-8000-000000000110';

const product = (id: string, name: string, category: string, productTypeId: string) => ({
  id, name, category, product_type_id: productTypeId, org_id: orgId, user_id: userId,
  brand: 'ZZ Marca', sku: id === toolId ? '000012' : id === legacyId ? '000013' : '000014',
  barcode: id === toolId ? '0771234567890' : id === legacyId ? '0771234567891' : '0771234567892', stock: 8, maneja_stock: true,
  cost_ars: 1000, cost_currency: 'ARS', cost_usd: 0, sale_price_ars: 2000,
  discount_price_ars: null, low_stock_threshold: 3, gender: null, content_ml: null,
  is_active: true, image_url: null, tags: [], expiry_date: null, expected_restock_at: null,
  created_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:00Z',
});
const productType = (id: string, name: string, slug: string, stock = true) => ({
  id, name, slug, org_id: orgId, active: true, source: 'custom', maneja_stock: stock,
  description: null, template_code: null, template_version: null,
  created_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:00Z',
});
const definitions = (typeId: string) => typeId === toolTypeId ? [{
  id: diameterId, org_id: orgId, product_type_id: toolTypeId, name: 'Diámetro', slug: 'diametro',
  data_type: 'number', unit: 'mm', options: [], required: false, filterable: true, sort_order: 0,
  created_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:00Z',
}] : typeId === serviceTypeId ? [{
  id: timeId, org_id: orgId, product_type_id: serviceTypeId, name: 'Tiempo de servicio', slug: 'tiempo',
  data_type: 'number', unit: 'min', options: [], required: false, filterable: true, sort_order: 0,
  created_at: '2026-10-09T00:00:00Z', updated_at: '2026-10-09T00:00:00Z',
}] : [];
type AttributeResponder = (route: Route, typeId: string) => Promise<void>;

// Every Auth/API request is synthetic. Unexpected writes/functions are aborted,
// so these editor scenarios never save products, attributes, inventory or money.
async function mockCatalog(page: Page, options: {
  perfume?: boolean; serviceType?: boolean; attributes?: AttributeResponder;
} = {}) {
  const url = process.env.VITE_SUPABASE_URL ?? 'https://hummeopatkniwkyrrhwc.supabase.co';
  const storageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: userId, email: 'zz-industry@invalid.test', aud: 'authenticated', role: 'authenticated',
    created_at: '2026-10-09T00:00:00Z', app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { full_name: 'ZZ Catálogo' }, identities: [], factors: [] };
  const token = [Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
    Buffer.from(JSON.stringify({ sub: userId, role: 'authenticated', exp: expires, aal: 'aal1' })).toString('base64url'),
    Buffer.from('synthetic-ui-only').toString('base64url')].join('.');
  await page.addInitScript(({ storageKey, session, orgId }) => {
    localStorage.setItem(storageKey, JSON.stringify(session)); localStorage.setItem('gestiona.activeOrgId', orgId);
  }, { storageKey, orgId, session: { access_token: token, refresh_token: 'synthetic-ui-only', token_type: 'bearer',
    expires_at: expires, expires_in: 3600, user } });
  const products = options.perfume
    ? [{ ...product(perfumeId, 'ZZ PERFUME', 'perfume_arabe', perfumeTypeId), gender: 'masculino', content_ml: 100 }]
    : [product(toolId, 'ZZ MECHA', 'herramientas', toolTypeId), product(legacyId, 'ZZ HERRAMIENTA LEGACY', 'perfume_arabe', toolTypeId)];
  const types = options.perfume ? [productType(perfumeTypeId, 'Perfume', 'perfume')]
    : [productType(toolTypeId, 'Herramienta', 'herramienta'), ...(options.serviceType ? [productType(serviceTypeId, 'Servicio', 'servicio', false)] : [])];
  const writes: string[] = [];
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route(`${url}/**`, async route => {
    const requestUrl = new URL(route.request().url()); const path = requestUrl.pathname;
    const readRpc = ['/rest/v1/rpc/get_my_platform_announcements', '/rest/v1/rpc/org_entitlements', '/rest/v1/rpc/get_product_plan_usage'].includes(path);
    if (path.startsWith('/functions/') || (!['GET', 'HEAD'].includes(route.request().method()) && !path.startsWith('/auth/') && !readRpc)) {
      writes.push(`${route.request().method()} ${path}`); await route.abort(); return;
    }
    let result: unknown = [];
    if (path === '/auth/v1/user') result = user;
    else if (path === '/rest/v1/memberships') result = [{ org_id: orgId, role: 'owner', organization: {
      id: orgId, name: 'ZZ Catálogo adaptable', slug: 'zz-industry', owner_user_id: userId,
      onboarding_completed: true, onboarding_goal: 'explore', plan_id: null, trial_ends_at: null, logo_url: null } }];
    else if (path === '/rest/v1/settings') result = [{ org_id: orgId, user_id: userId, business_name: 'ZZ Catálogo adaptable',
      exchange_rate: 1000, industry_code: options.perfume ? 'perfumes' : 'ferreteria' }];
    else if (path === '/rest/v1/products') result = requestUrl.searchParams.get('select') === 'category'
      ? products.map(item => ({ category: item.category })) : products;
    else if (path === '/rest/v1/ecommerce_categories') result = [
      { id: 'zz-tools', org_id: orgId, slug: 'herramientas', name: 'Herramientas', parent_id: null, sort_order: 0 },
      { id: 'zz-perfumes', org_id: orgId, slug: 'perfume_arabe', name: 'Perfumes', parent_id: null, sort_order: 1 },
    ];
    else if (path === '/rest/v1/product_types') result = types;
    else if (path === '/rest/v1/attribute_definitions') {
      const typeId = requestUrl.searchParams.get('product_type_id')?.replace(/^eq\./, '') ?? '';
      if (options.attributes) { await options.attributes(route, typeId); return; }
      result = definitions(typeId);
    } else if (path === '/rest/v1/product_attribute_values') {
      const productId = requestUrl.searchParams.get('product_id')?.replace(/^eq\./, '');
      result = productId === toolId || productId === legacyId ? [{
        id: 'zz-diameter-value', org_id: orgId, product_id: productId, attribute_definition_id: diameterId, value_number: 10,
        value_text: null, value_boolean: null, value_date: null, value_json: null,
      }] : [];
    }
    else if (path.endsWith('/org_entitlements')) result = { vigente: true, motivo_de_corte: null, dias_de_gracia: 0,
      ia: false, ia_restante: 0, max_products: null, max_users: null, max_sales_per_month: null };
    else if (path.endsWith('/get_product_plan_usage')) result = { products_used: products.length, max_products: null };
    await route.fulfill({ status: 200, json: result });
  });
  return { writes, errors };
}

async function openEditor(page: Page, name: string) {
  await page.getByRole('button', { name: `Editar ${name}`, exact: true }).click();
  return page.getByRole('dialog', { name: 'Editar producto', exact: true });
}
function attributeInput(editor: Locator, label: string) {
  return editor.getByText(label, { exact: true }).locator('..').getByRole('spinbutton');
}
async function checkEditorLayout(page: Page, editor: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const violations = (await new AxeBuilder({ page }).include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations
    .filter(item => ['serious', 'critical'].includes(item.impact));
  expect(violations).toEqual([]);
  const submit = editor.getByRole('button', { name: /^(Guardar cambios|Crear producto)$/ });
  expect((await submit.boundingBox())!.height).toBeGreaterThanOrEqual(40);
}

test('ferretería: atributos propios, alta neutral y tipo explícito antes que categoría legacy', async ({ page }, testInfo) => {
  const mock = await mockCatalog(page);
  await page.goto('/productos');
  await expect(page.getByRole('region', { name: 'Tabla de productos' }).first()).toBeVisible();
  let editor = await openEditor(page, 'ZZ MECHA');
  await expect(editor.locator('#product-type')).toHaveText('Herramienta');
  await expect(attributeInput(editor, 'Diámetro (mm)')).toHaveValue('10');
  await expect(editor.locator('#product-gender')).toHaveCount(0);
  await expect(editor.locator('#product-content-ml')).toHaveCount(0);
  await expect(editor.getByText('Creación inteligente — Perfume', { exact: true })).toHaveCount(0);
  for (const width of [360, 390, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 900 });
    await editor.locator('#product-type').scrollIntoViewIfNeeded();
    await expect(editor.locator('#product-type')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`hardware-editor-${width}.png`) });
  }
  await checkEditorLayout(page, editor);
  await editor.getByRole('button', { name: 'Cerrar', exact: true }).click();
  editor = await openEditor(page, 'ZZ HERRAMIENTA LEGACY');
  await expect(editor.locator('#product-type')).toHaveText('Herramienta');
  await expect(editor.locator('#product-gender')).toHaveCount(0);
  await expect(editor.locator('#product-content-ml')).toHaveCount(0);
  await expect(editor.getByText('Creación inteligente — Perfume', { exact: true })).toHaveCount(0);
  await editor.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click();
  editor = page.getByRole('dialog', { name: 'Nuevo producto', exact: true });
  await expect(editor.locator('#product-type')).toHaveText('Herramienta');
  await expect(editor.getByPlaceholder('Ej: ART-0001', { exact: true })).toBeVisible();
  await expect(editor.locator('#product-gender')).toHaveCount(0);
  await expect(editor.locator('#product-content-ml')).toHaveCount(0);
  await editor.getByRole('button', { name: /^Variantes/ }).click();
  await editor.getByRole('combobox', { name: 'Tipo de variante' }).click();
  await page.getByRole('option', { name: 'Medida', exact: true }).click();
  await editor.getByRole('button', { name: 'Importar lista', exact: true }).click();
  await expect(editor.locator('#product-variant-bulk')).not.toHaveAttribute('placeholder', /Menta|Frutilla/);
  await checkEditorLayout(page, editor);
  expect(mock.writes).toEqual([]); expect(mock.errors).toEqual([]);
});

test('perfumería: conserva género, contenido y ficha especializada', async ({ page }, testInfo) => {
  const mock = await mockCatalog(page, { perfume: true });
  await page.goto('/productos');
  await expect(page.getByRole('button', { name: 'Buscador perfume' })).toBeVisible();
  const editor = await openEditor(page, 'ZZ PERFUME');
  await expect(editor.locator('#product-type')).toHaveText('Perfume');
  await expect(editor.locator('#product-gender')).toHaveText('Masculino');
  await expect(editor.locator('#product-content-ml')).toHaveValue('100');
  await expect(editor.getByText('Creación inteligente — Perfume', { exact: true })).toBeVisible();
  await checkEditorLayout(page, editor);
  await page.screenshot({ path: testInfo.outputPath('perfume-editor.png') });
  expect(mock.writes).toEqual([]); expect(mock.errors).toEqual([]);
});

test('atributos: carga pendiente bloquea guardar y una respuesta vieja no pisa otro tipo', async ({ page }) => {
  let releaseOld!: () => void; let completedOld!: () => void;
  const pending = new Promise<void>(resolve => { releaseOld = resolve; });
  const completed = new Promise<void>(resolve => { completedOld = resolve; });
  let requests = 0;
  const mock = await mockCatalog(page, { serviceType: true, attributes: async (route, typeId) => {
    if (typeId === toolTypeId) { requests += 1; await pending; }
    await route.fulfill({ json: definitions(typeId) });
    if (typeId === toolTypeId) completedOld();
  } });
  await page.goto('/productos');
  const editor = await openEditor(page, 'ZZ MECHA');
  const save = editor.getByRole('button', { name: 'Guardar cambios', exact: true });
  await expect(editor.getByText('Cargando atributos del tipo…', { exact: true })).toBeVisible();
  await expect(save).toBeDisabled();
  await expect.poll(() => requests).toBeGreaterThan(0);
  await editor.locator('#product-type').click();
  await page.getByRole('option', { name: 'Servicio', exact: true }).click();
  await expect(attributeInput(editor, 'Tiempo de servicio (min)')).toBeVisible();
  await expect(save).toBeEnabled();
  releaseOld(); await completed;
  await expect(editor.locator('#product-type')).toHaveText('Servicio');
  await expect(attributeInput(editor, 'Tiempo de servicio (min)')).toBeVisible();
  await expect(editor.getByText('Diámetro (mm)', { exact: true })).toHaveCount(0);
  await expect(save).toBeEnabled();
  expect(mock.writes).toEqual([]); expect(mock.errors).toEqual([]);
});

test('atributos: fallo específico conserva la ficha, bloquea guardar y permite reintentar', async ({ page }) => {
  let fail = true; let requests = 0;
  const mock = await mockCatalog(page, { attributes: async (route, typeId) => {
    requests += 1;
    if (fail) await route.fulfill({ status: 503, json: { code: 'ZZ_UNAVAILABLE', message: 'ZZ private attribute failure' } });
    else await route.fulfill({ json: definitions(typeId) });
  } });
  await page.goto('/productos');
  const editor = await openEditor(page, 'ZZ MECHA');
  const save = editor.getByRole('button', { name: 'Guardar cambios', exact: true });
  await expect(editor.getByText('No se pudieron cargar los atributos del tipo.', { exact: true })).toBeVisible();
  await expect(save).toBeDisabled();
  await expect(editor.getByPlaceholder('Ej: Nombre del producto')).toHaveValue('ZZ MECHA');
  await expect(editor.getByText(/ZZ private attribute failure/)).toHaveCount(0);
  const beforeRetry = requests; fail = false;
  await editor.getByRole('button', { name: 'Reintentar atributos', exact: true }).click();
  await expect(attributeInput(editor, 'Diámetro (mm)')).toHaveValue('10');
  await expect(save).toBeEnabled();
  expect(requests).toBe(beforeRetry + 1);
  expect(mock.writes).toEqual([]); expect(mock.errors).toEqual([]);
});

test('atributos: reintentar el tipo elegido no restaura el default ni cambia su manejo de stock', async ({ page }) => {
  let fail = true;
  const mock = await mockCatalog(page, { serviceType: true, attributes: async (route, typeId) => {
    if (fail && typeId === serviceTypeId) await route.fulfill({ status: 503, json: { message: 'ZZ unavailable' } });
    else await route.fulfill({ json: definitions(typeId) });
  } });
  await page.goto('/productos');
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Nuevo producto', exact: true });
  await expect(editor.getByRole('button', { name: 'Crear producto', exact: true })).toBeEnabled();
  await editor.locator('#product-type').click();
  await page.getByRole('option', { name: 'Servicio', exact: true }).click();
  await expect(editor.getByText('No se pudieron cargar los atributos del tipo.', { exact: true })).toBeVisible();
  await expect(editor.getByRole('switch', { name: 'No lleva stock', exact: true })).toBeChecked();
  fail = false;
  await editor.getByRole('button', { name: 'Reintentar atributos', exact: true }).click();
  await expect(attributeInput(editor, 'Tiempo de servicio (min)')).toBeVisible();
  await expect(editor.locator('#product-type')).toHaveText('Servicio');
  await expect(editor.getByRole('switch', { name: 'No lleva stock', exact: true })).toBeChecked();
  await expect(editor.getByRole('button', { name: 'Crear producto', exact: true })).toBeEnabled();
  expect(mock.writes).toEqual([]); expect(mock.errors).toEqual([]);
});
