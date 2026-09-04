import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const viewports = [
  { width: 360, height: 800 },
  { width: 768, height: 900 },
  { width: 1024, height: 900 },
  { width: 1440, height: 1000 },
];

for (const viewport of viewports) {
  test(`landing a ${viewport.width}px: primera acción y continuidad sin desborde`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');

    await expect(page.getByRole('heading', {
      level: 1,
      name: 'Nerqia, tu tienda online conectada a todo tu negocio.',
    })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Crear mi tienda gratis' })).toBeVisible();

    const layout = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      proofTop: document.querySelector('#tienda')?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY,
      viewportHeight: window.innerHeight,
    }));

    expect(layout.scrollWidth, `desborda ${layout.scrollWidth - layout.clientWidth}px`).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.proofTop, 'el hero no deja ninguna señal de la sección siguiente').toBeLessThan(layout.viewportHeight);

    if (viewport.width < 820) {
      const menu = page.getByRole('button', { name: 'Abrir menú' });
      await expect(menu).toBeVisible();
      await menu.click();
      await expect(page.getByRole('navigation', { name: 'Navegación principal' }).getByRole('link', { name: 'Finance' })).toBeVisible();
    }
  });
}

test('las superficies cambian contenido y sostienen WCAG A/AA', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Tienda online' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toContainText('Tu marca, tu dominio y una tienda preparada para vender.');
  await page.getByRole('tab', { name: 'Tienda online' }).press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Gestión' })).toHaveAttribute('aria-selected', 'true');

  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blockers = result.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious');
  if (blockers.length > 0) {
    const detail = blockers.flatMap(violation => violation.nodes.map(node => (
      `${violation.id} ${node.target.join(' ')}: ${node.failureSummary ?? violation.help}`
    ))).join('\n');
    throw new Error(detail);
  }
});
