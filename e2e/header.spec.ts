import { test, expect } from "@playwright/test";

const SLUG = process.env.E2E_STORE_SLUG ?? "exentryimports";
const anchos = [375, 640, 700, 767, 768, 1280];

test.beforeEach(async ({ page }) => {
  await page.route('**/rest/v1/rpc/record_store_visit', route => route.fulfill({ status: 200, json: null }));
});

test('newsletter contains the intrinsic email width without hiding its controls', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(`/tienda/${SLUG}`);
  const form = page.getByRole('form', { name: 'Suscribirse al newsletter' });
  await expect(form).toBeVisible();
  const email = form.getByRole('textbox', { name: 'Email para recibir novedades' });
  // Native input sizing differs across fonts/platforms; size stresses min-content
  // without submitting an address or changing the shop's production data.
  await email.evaluate(input => { (input as HTMLInputElement).size = 80; });
  await form.scrollIntoViewIfNeeded();
  const geometry = await form.evaluate(element => ({
    right: element.getBoundingClientRect().right,
    scroll: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(geometry.scroll).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport);
  await expect(email).toBeInViewport();
  await expect(form.getByRole('button', { name: 'Suscribirme' })).toBeInViewport();
});

for (const w of anchos) {
  test(`header a ${w}px: se puede buscar y no desborda`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(`/tienda/${SLUG}`);
    await expect(page.locator('a[href*="/producto/"]').first()).toBeVisible();

    const { visibles, scrollW, clientW } = await page.evaluate(() => {
      const i = [...document.querySelectorAll('input[placeholder*="Buscar"]')];
      return {
        visibles: i.filter(x => (x as HTMLElement).offsetParent !== null).length,
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      };
    });

    expect(scrollW, `desborda ${scrollW - clientW}px`).toBeLessThanOrEqual(clientW);

    if (w < 640) {
      // Abajo de sm el buscador vive en el menú desplegable.
      await page.getByRole("button", { name: /menú|menu/i }).first().click();
      const trasMenu = await page.evaluate(() =>
        [...document.querySelectorAll('input[placeholder*="Buscar"]')]
          .filter(x => (x as HTMLElement).offsetParent !== null).length);
      expect(trasMenu, "sin buscador ni abriendo el menú").toBeGreaterThan(0);
    } else {
      expect(visibles, "no hay buscador visible").toBeGreaterThan(0);
    }
  });
}
