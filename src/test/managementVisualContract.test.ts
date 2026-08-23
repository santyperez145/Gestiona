import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

function tsxFiles(directory: string, prefix = ''): string[] {
  return readdirSync(resolve(process.cwd(), directory), { withFileTypes: true })
    .flatMap(entry => {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return tsxFiles(`${directory}/${entry.name}`, relative);
      return entry.name.endsWith('.tsx') ? [relative] : [];
    });
}

describe('contrato visual transversal de Gestión', () => {
  it('Business, Finance y Platform envuelven todas sus páginas con el mismo contrato', () => {
    const layouts = [
      'src/components/AppLayout.tsx',
      'src/components/finance-product/FinanceLayout.tsx',
      'src/components/PlatformLayout.tsx',
    ];

    for (const path of layouts) {
      expect(source(path), `${path} quedó fuera del sistema transversal`)
        .toContain('workspace-page workspace-route-surface');
    }
  });

  it('formularios base usan superficies claras y el mismo foco violeta', () => {
    const controls = [
      'src/components/ui/input.tsx',
      'src/components/ui/select.tsx',
      'src/components/ui/textarea.tsx',
    ];

    for (const path of controls) {
      const contents = source(path);
      expect(contents).toContain('bg-card/90');
      expect(contents).toContain('border-primary/55');
      expect(contents).not.toContain('bg-muted/40');
    }
  });

  it('navegación, tarjetas y tablas comparten la dirección marketplace', () => {
    expect(source('src/components/ui/tabs.tsx')).toContain('data-[state=active]:bg-card');
    expect(source('src/components/ui/card.tsx')).toContain('rounded-[12px]');
    expect(source('src/components/ui/table.tsx')).toContain('bg-primary/[0.035]');
    expect(source('src/components/shared/EmptyState.tsx')).toContain('border-dashed border-primary/20');
    expect(source('src/components/shared/DataPagination.tsx')).toContain('aria-live="polite"');
    for (const path of [
      'src/pages/AdminPage.tsx',
      'src/pages/ProductsPage.tsx',
      'src/pages/PurchasesPage.tsx',
      'src/pages/ReportsPage.tsx',
      'src/pages/SalesPage.tsx',
    ]) {
      expect(source(path), `${path} volvió a paginar con controles propios`)
        .toContain('<DataPagination');
    }
  });

  it('el wrapper universal alcanza también a páginas que aún no declaran workspace-page', () => {
    const css = source('src/index.css');

    expect(css).toContain('.workspace-route-surface');
    expect(css).toContain('.light .workspace-route-surface [class~="bg-card"]');
    expect(css).toContain('.light .workspace-route-surface table tbody tr:hover');
  });

  it('las excepciones heredadas usan el mismo encabezado sin quitar el foco del POS', () => {
    const alignedPages = [
      'src/pages/FinanceOverviewPage.tsx',
      'src/pages/FinanceDocumentsPage.tsx',
      'src/pages/PlatformAnnouncementsPage.tsx',
      'src/pages/ProfilePage.tsx',
      'src/pages/SettingsPage.tsx',
    ];

    for (const path of alignedPages) {
      expect(source(path), `${path} conserva un encabezado aislado`).toContain('<PageHeader');
    }

    expect(source('src/pages/POSPage.tsx')).toContain('h-[calc(100vh-4rem)]');
    expect(source('src/pages/POSPage.tsx')).not.toContain('<PageHeader');
  });

  it('ninguna página vuelve a crear un select nativo fuera del primitive compartido', () => {
    const pages = readdirSync(resolve(process.cwd(), 'src/pages'))
      .filter(path => path.endsWith('.tsx'));
    const offenders = pages.filter(path => /<select\b/.test(source(`src/pages/${path}`)));

    expect(offenders, 'Los selects nativos rompen foco, contraste y menú entre módulos')
      .toEqual([]);
  });

  it('las fechas de Gestión conservan semántica nativa bajo el Input canónico', () => {
    const withoutBlockComments = (contents: string) => contents.replace(/\/\*[\s\S]*?\*\//g, '');
    const rawTemporalInput = /<input\b[^>]*\btype=["'](?:date|datetime-local|month)["'][^>]*>/;
    const pageOffenders = readdirSync(resolve(process.cwd(), 'src/pages'))
      .filter(path => path.endsWith('.tsx') && !path.startsWith('Public'))
      .filter(path => rawTemporalInput.test(withoutBlockComments(source(`src/pages/${path}`))));
    const componentOffenders = tsxFiles('src/components')
      .filter(path => !path.startsWith('ui/'))
      .filter(path => rawTemporalInput.test(withoutBlockComments(source(`src/components/${path}`))));

    expect([...pageOffenders, ...componentOffenders], 'Una fecha volvió a duplicar estilo, foco o tema')
      .toEqual([]);
    expect(source('src/components/ui/input.tsx')).toContain('[&[type=date]]:[color-scheme:light]');
    expect(source('src/components/ui/input.tsx')).toContain('dark:[&[type=date]]:[color-scheme:dark]');
  });

  it('los componentes internos usan Select y Storefront conserva sólo excepciones mobile explícitas', () => {
    const components = tsxFiles('src/components');
    const componentOffenders = components.filter(path => /<select\b/.test(source(`src/components/${path}`)));
    expect(componentOffenders, 'Un componente del SaaS volvió a introducir un select nativo')
      .toEqual([]);

    const storefrontExceptions = Object.fromEntries(
      tsxFiles('src/storefront')
        .map(path => [path, source(`src/storefront/${path}`).match(/<select\b/g)?.length || 0] as const)
        .filter(([, count]) => count > 0),
    );
    expect(storefrontExceptions, 'Checkout/listado mobile sólo admiten las excepciones documentadas')
      .toEqual({
        'StoreCheckout.tsx': 2,
        'StoreProducts.tsx': 1,
      });
  });

  it('los overlays de Gestión usan primitives y sólo conserva fullscreen técnicos explícitos', () => {
    const componentOverlays = tsxFiles('src/components')
      .filter(path => !path.startsWith('ui/'))
      .map(path => [`components/${path}`, source(`src/components/${path}`).match(/fixed\s+inset-0/g)?.length || 0] as const);
    const pageOverlays = readdirSync(resolve(process.cwd(), 'src/pages'))
      .filter(path => path.endsWith('.tsx') && !path.startsWith('Public'))
      .map(path => [`pages/${path}`, source(`src/pages/${path}`).match(/fixed\s+inset-0/g)?.length || 0] as const);

    const exceptions = Object.fromEntries(
      [...componentOverlays, ...pageOverlays].filter(([, count]) => count > 0),
    );

    expect(exceptions, 'Un modal manual volvió a duplicar Dialog/Sheet/Popover')
      .toEqual({
        'components/AppLayout.tsx': 1, // backdrop del rail mobile, no modal
        'components/inventory/StockCountTab.tsx': 1, // cámara fullscreen
        'pages/POSPage.tsx': 1, // cámara fullscreen del POS
        'pages/PurchasesPage.tsx': 1, // cámara fullscreen de compras
      });
  });
});
