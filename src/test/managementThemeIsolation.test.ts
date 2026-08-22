import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('aislamiento visual entre Gestión y las tiendas', () => {
  it('la configuración del negocio no reescribe los tokens globales del panel', () => {
    const hook = source('src/lib/useBusinessConfig.ts');

    expect(hook).not.toContain('document.documentElement');
    expect(hook).not.toContain("style.setProperty('--background'");
    expect(hook).not.toContain("style.setProperty('--primary'");
  });

  it('Ajustes sólo ofrece paletas para la experiencia pública', () => {
    const settings = source('src/pages/SettingsPage.tsx');

    expect(settings).not.toContain('applyColors');
    expect(settings).not.toContain('Color Principal');
    expect(settings).not.toContain('Color Secundario');
    expect(settings).toContain('Apariencia de la tienda y el catálogo');
    expect(settings).toContain('se aplican sólo a la tienda pública');
  });

  it('el storefront conserva su personalización de marca', () => {
    const publicCatalog = source('src/pages/PublicCatalogPage.tsx');
    const storeTheme = source('src/storefront/theme.ts');

    expect(publicCatalog).toContain('storeBranding?.primary_color');
    expect(storeTheme).toContain('resolveTheme');
    expect(storeTheme).toContain('primaryColor');
  });

  it('Finance respeta el tema claro en vez de forzar un rail negro', () => {
    const financeLayout = source('src/components/finance-product/FinanceLayout.tsx');

    expect(financeLayout).not.toContain('bg-slate-950');
    expect(financeLayout).toContain('bg-card text-foreground');
  });
});
