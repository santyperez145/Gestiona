import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import ProductsPage from '@/pages/ProductsPage';

const fixtures = vi.hoisted(() => ({
  org: { id: 'zz-org', name: 'ZZ Ferretería' },
  settings: { exchange_rate: 1000, business_name: 'ZZ Ferretería' },
  product: {
    id: 'zz-product', name: 'Tornillo M8', brand: 'Marca', category: 'herramientas', gender: 'unisex',
    sku: '000012', barcode: '0771234567890', sale_price_ars: 1500, discount_price_ars: 1200,
    cost_usd: 1, total_cost_usd: 1, cost_currency: 'USD', stock: 5, maneja_stock: true,
    tags: [], user_id: 'zz-user', org_id: 'zz-org',
  },
  writes: vi.fn(),
  qr: vi.fn(),
  error: vi.fn(),
}));
const localQrData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

vi.mock('qrcode', () => ({ toDataURL: fixtures.qr }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'zz-user' }, loading: false }) }));
vi.mock('@/lib/orgContext', () => ({
  useOrg: () => ({ activeOrg: fixtures.org, activeRole: 'admin', loading: false }),
  requireActiveOrgId: () => fixtures.org.id, getActiveOrgId: () => fixtures.org.id,
}));
vi.mock('@/lib/usePermissions', () => ({ useModulePermissions: () => ({
  canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true, loading: false,
}) }));
vi.mock('@/lib/useEntitlements', () => ({ useEntitlements: () => ({ productLimit: null, plan: { name: 'ZZ' } }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: fixtures.error } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => {
  let single = false;
  const query: Record<string, unknown> = {
    then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: single ? null : [], count: 0, error: null }).then(resolve),
  };
  for (const method of ['select', 'eq', 'gte', 'order', 'limit', 'in', 'is']) query[method] = () => query;
  query.maybeSingle = () => { single = true; return query; };
  for (const method of ['insert', 'update', 'upsert', 'delete']) query[method] = (...args: unknown[]) => {
    fixtures.writes(method, ...args); throw new Error('This read-only print test must never mutate data');
  };
  return query;
} } }));
vi.mock('@/lib/supabaseStore', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/supabaseStore')>(),
  getProductsDB: vi.fn(() => Promise.resolve([{ ...fixtures.product }])),
  getSettingsDB: vi.fn(() => Promise.resolve({ ...fixtures.settings })),
  getVariantsByUserDB: vi.fn().mockResolvedValue([]),
  addProductDB: fixtures.writes, updateProductDB: fixtures.writes, deleteProductDB: fixtures.writes,
  setStockAbsoluteDB: fixtures.writes,
}));
vi.mock('@/components/products/CategorySelect', () => ({
  default: () => null,
  useOrgCategories: () => ({ opciones: [{ slug: 'herramientas', label: 'Herramientas' }],
    categorias: [{ id: 'zz-category', name: 'Herramientas', slug: 'herramientas' }] }),
}));
vi.mock('@/components/shared/IdentityHealthPanel', () => ({ default: () => null }));
vi.mock('@/components/products/ProductPriceListsSection', () => ({ default: () => null }));
vi.mock('@/components/products/ProductsExcelImport', () => ({ default: () => null }));
vi.mock('@/components/products/CompletarPesos', () => ({ default: () => null }));

beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  fixtures.qr.mockReset().mockResolvedValue(localQrData);
  fixtures.settings.business_name = 'ZZ Ferretería';
  Object.assign(fixtures.product, { name: 'Tornillo M8', brand: 'Marca', category: 'herramientas', gender: 'unisex', sku: '000012', barcode: '0771234567890' });
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const reports = ['Etiquetas de precio', 'Etiquetas QR', 'Lista de precios para imprimir', 'Inventario sin movimiento'] as const;

async function openCatalog() {
  render(<MemoryRouter><TooltipProvider><ProductsPage /></TooltipProvider></MemoryRouter>);
  await screen.findByRole('region', { name: 'Tabla de productos' });
}

async function selectPrintAction(reportName: typeof reports[number]) {
  if (reportName === 'Inventario sin movimiento') {
    fireEvent.click(screen.getByRole('tab', { name: /^Operación/ }));
    fireEvent.click(screen.getByTitle('Exportar PDF de productos sin movimiento'));
  } else {
    fireEvent.keyDown(screen.getByRole('button', { name: 'Más acciones de productos' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: reportName }));
  }
}

async function printFromPage(reportName: typeof reports[number]) {
  const write = vi.fn();
  vi.spyOn(window, 'open').mockReturnValue({
    document: { write, close: vi.fn() }, focus: vi.fn(), print: vi.fn(), closed: false,
  } as unknown as Window);
  await openCatalog(); await selectPrintAction(reportName);
  await waitFor(() => expect(write).toHaveBeenCalledOnce());
  expect(fixtures.writes).not.toHaveBeenCalled();
  return new DOMParser().parseFromString(String(write.mock.calls[0][0]), 'text/html');
}

describe('catalog print output treats persisted merchant data as text', () => {
  it.each(reports)('%s cannot turn names, codes or business data into active HTML', async reportName => {
    fixtures.settings.business_name = '</title><script>alert(1)</script><title>';
    Object.assign(fixtures.product, {
      name: '<svg/onload=alert(1)>', brand: '<img src=x onerror=alert(1)>',
      category: '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
      gender: '<input autofocus onfocus=alert(1)>', sku: '<script>alert(1)</script>',
    });
    const document = await printFromPage(reportName);
    expect(document.querySelector('script, svg, iframe, input, [onerror], [onload], [onfocus]')).toBeNull();
    expect(document.querySelectorAll('img')).toHaveLength(reportName === 'Etiquetas QR' ? 1 : 0);
    expect(document.body.textContent).toContain(fixtures.settings.business_name);
    expect(document.body.textContent).toContain(fixtures.product.name);
    if (reportName !== 'Inventario sin movimiento') expect(document.body.textContent).toContain(fixtures.product.brand);
    if (reportName === 'Lista de precios para imprimir') {
      expect(document.body.textContent).toContain(fixtures.product.category);
      expect(document.body.textContent).toContain(fixtures.product.gender);
    } else if (reportName !== 'Inventario sin movimiento') expect(document.body.textContent).toContain(fixtures.product.sku);
    if (reportName === 'Etiquetas QR') {
      expect(document.querySelector('img')!.getAttribute('src')).toBe(localQrData);
      expect(document.documentElement.outerHTML).not.toContain('api.qrserver.com');
      expect(fixtures.qr).toHaveBeenCalledOnce();
      expect(JSON.parse(fixtures.qr.mock.calls[0][0])).toEqual({ id: fixtures.product.id, name: fixtures.product.name, price: 1200 });
    }
  });

  it.each(['Etiquetas de precio', 'Etiquetas QR'] as const)('%s also escapes the barcode fallback when there is no SKU', async reportName => {
    fixtures.product.sku = '';
    fixtures.product.barcode = '<img src=x onerror=alert(1)>';
    const document = await printFromPage(reportName);
    expect(document.querySelector('.sku')!.textContent).toBe(fixtures.product.barcode);
    expect(document.querySelector('[onerror]')).toBeNull();
    expect(document.querySelectorAll('img')).toHaveLength(reportName === 'Etiquetas QR' ? 1 : 0);
  });

  it.each(reports)('%s preserves readable legitimate text without double escaping', async reportName => {
    fixtures.settings.business_name = 'Ferretería & Hermanos "Sur"';
    fixtures.product.name = 'Tornillo <M8> & arandela';
    fixtures.product.brand = 'A&B';
    const document = await printFromPage(reportName);
    expect(document.body.textContent).toContain(fixtures.settings.business_name);
    expect(document.body.textContent).toContain(fixtures.product.name);
    expect(document.body.textContent).not.toContain('&amp;');
    if (reportName !== 'Inventario sin movimiento') expect(document.body.textContent).toContain('A&B');
    if (reportName === 'Etiquetas de precio') {
      expect(document.querySelector('.price')!.textContent).toMatch(/1[.,]200/);
      expect(document.querySelector('.old-price')!.textContent).toMatch(/1[.,]500/);
    }
  });
});

describe('local QR printing failure and recovery', () => {
  it('does not start QR generation when the browser blocked the popup', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    await openCatalog(); await selectPrintAction('Etiquetas QR');
    expect(fixtures.error).toHaveBeenCalledWith('Permití las ventanas emergentes para imprimir las etiquetas QR.');
    expect(fixtures.qr).not.toHaveBeenCalled(); expect(fixtures.writes).not.toHaveBeenCalled();
  });

  it('closes a failed popup, hides technical errors and allows a clean retry without changing products', async () => {
    const write = vi.fn(); const close = vi.fn();
    vi.spyOn(window, 'open').mockReturnValue({
      document: { write, close: vi.fn() }, focus: vi.fn(), print: vi.fn(), close, closed: false,
    } as unknown as Window);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fixtures.qr.mockRejectedValueOnce(new Error('ZZ private catalog payload'));
    await openCatalog(); await selectPrintAction('Etiquetas QR');
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(write).not.toHaveBeenCalled();
    expect(fixtures.error).toHaveBeenCalledWith('No se pudieron generar las etiquetas QR. Reintentá; tus productos no se modificaron.');
    expect(fixtures.error.mock.calls.flat().join(' ')).not.toContain('ZZ private');
    await selectPrintAction('Etiquetas QR');
    await waitFor(() => expect(write).toHaveBeenCalledOnce());
    expect(fixtures.writes).not.toHaveBeenCalled();
  });

  it('opens before async generation and skips writing into a popup closed while QR was pending', async () => {
    const write = vi.fn(); const print = vi.fn();
    const popup = { document: { write, close: vi.fn() }, focus: vi.fn(), print, closed: false };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    let finish!: (data: string) => void;
    fixtures.qr.mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve; }));
    await openCatalog(); await selectPrintAction('Etiquetas QR');
    await waitFor(() => expect(fixtures.qr).toHaveBeenCalledOnce());
    expect(open).toHaveBeenCalledOnce(); expect(write).not.toHaveBeenCalled();
    popup.closed = true;
    await act(async () => finish(localQrData));
    expect(write).not.toHaveBeenCalled(); expect(print).not.toHaveBeenCalled();
    expect(fixtures.error).not.toHaveBeenCalled(); expect(fixtures.writes).not.toHaveBeenCalled();
  });
});
