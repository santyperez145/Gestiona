import { test, expect } from "@playwright/test";

const SLUG = process.env.E2E_STORE_SLUG ?? "exentryimports";
const anchos = [375, 640, 700, 767, 768, 1280];

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
