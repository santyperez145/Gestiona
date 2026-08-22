import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

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
});
