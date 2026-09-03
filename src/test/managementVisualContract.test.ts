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

  it('Productos jerarquiza la acción primaria sin perder herramientas avanzadas', () => {
    const products = source('src/pages/ProductsPage.tsx');

    expect(products).toContain('aria-label="Más acciones de productos"');
    expect(products).toContain('<DropdownMenuLabel>Exportar y etiquetar</DropdownMenuLabel>');
    expect(products).toContain('<DropdownMenuLabel>Administrar catálogo</DropdownMenuLabel>');
    expect(products).toContain('aria-label="Vista lista" aria-pressed={productView === \'list\'}');
    expect(products).toContain('aria-label="Vista grilla" aria-pressed={productView === \'grid\'}');
    for (const action of [
      'Exportar Excel',
      'Lista de precios para imprimir',
      'Etiquetas de precio',
      'Etiquetas QR',
      'Códigos de barras',
      'Importar Excel/CSV',
      'Tipos y atributos',
      'Ajuste masivo de precios',
      'Oferta por categoría',
      'Completar pesos',
      'Calculadora de rentabilidad',
    ]) {
      expect(products, `Productos perdió la acción ${action}`).toContain(action);
    }
  });

  it('Productos usa editores extensos fullscreen y conserva acciones mobile alcanzables', () => {
    const products = source('src/pages/ProductsPage.tsx');
    const importer = source('src/components/products/ProductsExcelImport.tsx');

    expect(products).toContain('const FULLSCREEN_PRODUCT_WORKSPACE = "flex h-[100dvh] max-h-[100dvh]');
    expect(products.match(/<DialogContent size="full"/g)).toHaveLength(2);
    expect(products).toContain('className="min-h-0 flex-1 overflow-hidden"');
    expect(products).toContain('className="min-h-0 flex-1 overflow-y-auto overscroll-contain"');
    expect(products).toContain("aria-label={product ? `Editar ${product.name}` : 'Crear producto'}");
    expect(products).toContain('className="z-20 shrink-0 border-t');
    expect(products).toContain('sm:grid-cols-[minmax(0,1fr)_7rem_9rem_auto]');
    expect(products).toContain('aria-label={`Eliminar ${v.variant_name}`}');
    expect(products).toContain("const [variantType, setVariantType] = useState(product?.variant_type || 'otro')");
    expect(products).toContain("const variantLabel = 'Variantes'");
    expect(products).toContain("toast.error('Esa variante ya existe')");
    expect(products).not.toContain("sabor: 'Sabores'");
    expect(products).not.toContain('sabores/variantes');
    expect(products).toContain('<DialogHeader className="sr-only">\n            <DialogTitle>Importar catálogo</DialogTitle>');
    expect(products).not.toContain('className="bg-card border-border max-h-[90vh] overflow-y-auto">\n                  <DialogHeader><DialogTitle className="font-display">{editing');

    expect(importer).toContain('className="h-full overflow-y-auto overscroll-contain bg-card"');
    expect(importer).toContain('Deslizá la vista previa horizontalmente');
    expect(importer).toContain('aria-label="Vista previa de productos importados"');
    expect(importer).toContain('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end');
    expect(importer).not.toContain('max-h-[86vh]');
  });

  it('Productos no descarta una ficha editada sin confirmación explícita', () => {
    const products = source('src/pages/ProductsPage.tsx');
    const confirmation = source('src/components/shared/ConfirmDialog.tsx');

    expect(products).toContain('const [productFormDirty, setProductFormDirty] = useState(false)');
    expect(products).toContain('onOpenChange={handleProductEditorOpenChange}');
    expect(products).toContain('onInputCapture={markDirty}');
    expect(products).toContain("window.addEventListener('beforeunload', warnBeforeUnload)");
    expect(products).toContain('title="¿Descartar los cambios del producto?"');
    expect(products).toContain('confirmText="Descartar cambios"');
    expect(products).toContain('cancelText="Seguir editando"');
    expect(products).toContain('onChange={value => { markDirty(); setCategory(value); }}');
    expect(confirmation).toContain('trigger?: ReactNode');
    expect(confirmation).toContain('<AlertDialog open={open} onOpenChange={onOpenChange}>');
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

    for (const path of [
      'src/components/integrations/TiendanubeExcelImport.tsx',
      'src/components/products/ProductsExcelImport.tsx',
      'src/components/products/ProductsPriceImport.tsx',
      'src/pages/BankReconciliationPage.tsx',
      'src/pages/CustomersPage.tsx',
    ]) {
      const contents = source(path);
      expect(contents, `${path} dejó de usar el selector estructurado`).toContain('<FilePicker');
      expect(contents, `${path} volvió a crear un transporte de archivo local`).not.toMatch(/<input\b[^>]*\btype=["']file["']/);
    }
    expect(source('src/components/shared/FilePicker.tsx')).toContain('onDrop=');
    expect(source('src/components/shared/FilePicker.tsx')).toContain('role="alert"');
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
    expect(storefrontExceptions, 'Checkout/listado/carrito/PDP sólo admiten las excepciones documentadas')
      .toEqual({
        'StoreCheckout.tsx': 2,
        // Drawer: cotizar flete por provincia antes del checkout (ESTANDAR §5.10).
        'StoreLayout.tsx': 1,
        'StoreProducts.tsx': 1,
        // Ficha: mismo cotizador antes de Agregar (sesión 142).
        'StoreShippingQuote.tsx': 1,
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
