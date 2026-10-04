import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

// Worker-originated requests bypass page.route; synthetic sessions must never reach live Auth.
test.use({ serviceWorkers: 'block' });

const userId = '00000000-0000-4000-8000-000000000001';
const fixtureAccount = {
  user_id: userId, email: 'zz-creator@invalid.test', display_name: 'Creadora de prueba',
  onboarding_completed: true, public_slug: null, profile_public: false, discoverable: false,
  country_code: 'AR', moderation_status: 'draft', identity_status: 'unverified',
};

// This is a synthetic, intercepted UI session, not live authentication evidence.
// Every Supabase request is fulfilled here; no email or money can leave the test.
async function mockCreator(page: Page, failEarnings = false, destinationLabel = 'Mercado Pago') {
  const url = process.env.VITE_SUPABASE_URL ?? 'https://hummeopatkniwkyrrhwc.supabase.co';
  const storageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: userId, email: fixtureAccount.email, aud: 'authenticated', role: 'authenticated',
    created_at: '2026-10-01T00:00:00Z', app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { account_type: 'creator' }, identities: [], factors: [] };
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: userId, role: 'authenticated', exp: expires, aal: 'aal1' })).toString('base64url'), Buffer.from('synthetic-ui-only').toString('base64url')].join('.');
  await page.addInitScript(({ storageKey, session }) => localStorage.setItem(storageKey, JSON.stringify(session)), {
    storageKey, session: { access_token: token, refresh_token: 'synthetic-ui-only', token_type: 'bearer', expires_at: expires, expires_in: 3600, user },
  });
  const calls: { name: string; body: unknown }[] = [];
  await page.route('**/*.supabase.co/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/creator_earnings') && failEarnings) {
      await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: 'permission denied' }) }); return;
    }
    let result: unknown = [];
    if (path === '/auth/v1/user') result = user;
    else if (path === '/rest/v1/creator_accounts') result = [fixtureAccount];
    else if (path.endsWith('/creator_earnings')) result = { total_commissions_ars: 1500, total_sales_count: 3, paid_ars: 500, pending_withdrawals_ars: 0, available_ars: 1000 };
    else if (path.endsWith('/creator_exchanges')) result = [{ id: '00000000-0000-4000-8000-000000000002', org_name: 'Marca de prueba', product_name: 'Producto de prueba', quantity: 1, status: 'pendiente', exchange_type: 'canje', expected_posts: 2, actual_posts: 0, content_url: null, content_submitted_at: null, delivery_date: null, goal_notes: 'Dos publicaciones' }];
    else if (path.endsWith('/creator_payout_destinations_list')) result = [{ id: '00000000-0000-4000-8000-000000000003', provider: 'mercadopago', provider_label: destinationLabel, identifier_masked: 'z***@invalid.test', is_default: true }];
    else if (path.endsWith('/creator_submit_exchange_content') || path.endsWith('/creator_request_withdrawal')) {
      calls.push({ name: path.split('/').at(-1), body: route.request().postDataJSON() }); result = true;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });
  return calls;
}

test('legacy link drops its token and asks for creator authentication', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/portal-influencer/zz-retired-capability');
  await expect(page).toHaveURL(/\/portal-creador$/);
  await expect(page.getByRole('heading', { name: 'Ingresá a tu portal de creador' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Iniciar sesión' })).toHaveAttribute('href', '/login?role=creator');
  await expect(page.getByText('Disponible', { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('synthetic creator UI: tabs, canje submission and withdrawal without public token', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const calls = await mockCreator(page);
  await page.goto('/portal-creador?tab=canjes');
  await expect(page.getByRole('heading', { name: 'Tus canjes' })).toBeVisible();
  await page.getByLabel('Enlace de la publicación').fill('https://example.invalid/post');
  await page.getByLabel('Publicaciones', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Enviar contenido' }).click();
  await expect.poll(() => calls.length).toBe(1);
  expect(calls[0].body).toEqual({ p_exchange_id: '00000000-0000-4000-8000-000000000002', p_content_url: 'https://example.invalid/post', p_actual_posts: 2 });
  for (const tab of ['Campañas', 'Contenido', 'Canjes', 'Ingresos', 'Contratos', 'Perfil']) {
    await page.getByRole('tab', { name: tab, exact: true }).click();
    await expect(page.getByRole('tab', { name: tab, exact: true })).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${tab} overflows`).toBe(true);
  }
  await page.getByRole('tab', { name: 'Ingresos', exact: true }).click();
  await page.getByRole('button', { name: 'Retirar', exact: true }).click();
  await page.getByLabel('Monto a retirar (ARS)').fill('500');
  await page.getByRole('button', { name: 'Confirmar solicitud' }).click();
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1].body).toEqual({ p_amount_ars: 500, p_destination_id: '00000000-0000-4000-8000-000000000003', p_notes: null });
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('tab', { name: 'Canjes', exact: true }).click();
  await page.getByRole('tab', { name: 'Canjes', exact: true }).press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Contenido', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Contenido', exact: true }).press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Canjes', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.screenshot({ path: testInfo.outputPath('creator-canjes.png'), fullPage: true });
  const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations
    .filter(item => ['critical','serious'].includes(item.impact));
  expect(violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) }))).toEqual([]);
  expect(errors).toEqual([]);
});

test('failed source is a recoverable portal error, not false role or zero balance', async ({ page }) => {
  await mockCreator(page, true);
  await page.goto('/portal-creador?tab=ingresos');
  await expect(page.getByRole('heading', { name: 'No pudimos cargar tu portal' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Volver a intentar' })).toBeVisible();
  await expect(page.getByText('Esta cuenta no es de un creador', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Disponible', { exact: true })).toHaveCount(0);
});

test('synthetic withdrawal selectors show current labels, support keyboard and contain long names', async ({ page }, testInfo) => {
  const label = `Cuenta de prueba ${'NombreExtendido'.repeat(18)}`;
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const calls = await mockCreator(page, false, label);
  await page.goto('/portal-creador?tab=ingresos');
  await page.getByRole('button', { name: 'Retirar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Solicitar retiro de comisiones' });
  const destination = dialog.getByRole('combobox', { name: 'Destino de cobro', exact: true });
  const provider = dialog.getByRole('combobox', { name: 'Proveedor', exact: true });
  const type = dialog.getByRole('combobox', { name: 'Dato requerido', exact: true });
  await expect(destination).toContainText(label);
  await expect(destination).not.toContainText('00000000-0000-4000-8000-000000000003');
  await expect(provider).toHaveText('Mercado Pago');
  await expect(type).toHaveText('Email de cuenta');
  await provider.press('ArrowDown');
  await provider.press('ArrowDown');
  await provider.press('Enter');
  await expect(provider).toHaveText('Banco');
  await expect(type).toHaveText('CBU');
  await expect(provider).toBeFocused();
  await provider.click();
  await page.getByRole('option', { name: 'Otra billetera', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(provider).toHaveText('Otra billetera');
  await expect(type).toHaveText('CVU');
  await expect(dialog.getByRole('combobox', { name: 'Billetera o plataforma', exact: true })).toHaveText('Otra');

  const widths = testInfo.project.name === 'mobile' ? [360, 390] : [768, 1024, 1280, 1440];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    const dialogSize = await dialog.evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
    expect(dialogSize.scrollWidth, `dialog clips content at ${width}px`).toBeLessThanOrEqual(dialogSize.width);
    await destination.click();
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();
    await expect(listbox).toHaveAttribute('aria-label', 'Destino de cobro');
    await expect(listbox).toHaveAccessibleName('Destino de cobro');
    await expect(listbox.getByRole('option', { selected: true })).toContainText(label);
    const bounds = await listbox.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width, `listbox overflows at ${width}px`).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    if (width === widths[0]) {
      await page.screenshot({ path: testInfo.outputPath(`withdrawal-select-${width}.png`), fullPage: true });
      const menuViolations = (await new AxeBuilder({ page }).include('[role="listbox"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations
        .filter(item => ['critical', 'serious'].includes(item.impact));
      expect(menuViolations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) }))).toEqual([]);
    }
    await destination.press('Escape');
    await expect(destination).toBeFocused();
  }
  const violations = (await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations
    .filter(item => ['critical', 'serious'].includes(item.impact));
  expect(violations.map(item => ({ id: item.id, targets: item.nodes.map(node => node.target) }))).toEqual([]);
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect(calls).toEqual([]);
  expect(errors).toEqual([]);
});
