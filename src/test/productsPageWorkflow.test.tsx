import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import ProductsPage, { ProductForm } from '@/pages/ProductsPage';
import { listProductTypes } from '@/lib/productTypes';

const mocks = vi.hoisted(() => ({
  permissions: { canView: true, canCreate: true, canEdit: true, canDelete: true, canExport: true, loading: false },
  org: { id: 'org', name: 'Prueba' }, limit: null as number | null,
  remove: vi.fn(), update: vi.fn(), add: vi.fn(), stock: vi.fn(), success: vi.fn(), error: vi.fn(),
  product: { id: 'product', name: 'Producto de prueba', brand: 'Marca', category: 'accesorios', sale_price_ars: 15000, cost_ars: 10000, cost_currency: 'ARS', stock: 5, maneja_stock: true, tags: [], user_id: 'user', org_id: 'org' },
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'user' }, loading: false }) }));
vi.mock('@/lib/orgContext', () => ({ useOrg: () => ({ activeOrg: mocks.org, activeRole: 'admin', loading: false }), requireActiveOrgId: () => mocks.org.id, getActiveOrgId: () => mocks.org.id }));
vi.mock('@/lib/usePermissions', () => ({ useModulePermissions: () => mocks.permissions }));
vi.mock('@/lib/useEntitlements', () => ({ useEntitlements: () => ({ productLimit: mocks.limit, plan: { name: 'Prueba' } }) }));
vi.mock('@/lib/auditLog', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/broadcastSync', () => ({ broadcastSync: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock('@/hooks/useAIProductSuggest', () => ({ useAIProductSuggest: () => ({ suggest: vi.fn(), clear: vi.fn(), loading: false, result: null }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => {
  let single = false;
  const query: any = { then: (resolve: any) => Promise.resolve({ data: single ? null : [], count: 0, error: null }).then(resolve) };
  for (const method of ['select', 'eq', 'gte', 'order', 'limit', 'in', 'is', 'upsert']) query[method] = () => query;
  query.maybeSingle = () => { single = true; return query; };
  return query;
} } }));
vi.mock('@/lib/supabaseStore', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/supabaseStore')>(),
  getProductsDB: vi.fn(() => Promise.resolve([{ ...mocks.product }])),
  getSettingsDB: vi.fn().mockResolvedValue({ exchange_rate: 1000, business_name: 'Prueba' }),
  getVariantsByUserDB: vi.fn().mockResolvedValue([]), getVariantsDB: vi.fn().mockResolvedValue([]),
  deleteProductDB: mocks.remove, updateProductDB: mocks.update, addProductDB: mocks.add, setStockAbsoluteDB: mocks.stock,
}));
vi.mock('@/components/products/CategorySelect', () => ({
  default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <select aria-label="Categoría de prueba" value={value} onChange={event => onChange(event.target.value)}>
    <option value="">Sin categoría</option>
    <option value="accesorios">Accesorios</option>
    <option value="perfume_arabe">Perfume árabe</option>
    <option value="nicho">Perfume nicho</option>
    <option value="vaper">Vaper</option>
  </select>,
  useOrgCategories: () => ({ opciones: [{ slug: 'accesorios', label: 'Accesorios' }], categorias: [{ id: 'category', name: 'Accesorios', slug: 'accesorios' }] }),
}));
vi.mock('@/components/products/ProductTypesManager', () => ({ default: () => null }));
vi.mock('@/components/shared/IdentityHealthPanel', () => ({ default: () => null }));
vi.mock('@/components/products/ProductPriceListsSection', () => ({ default: () => null }));
vi.mock('@/components/products/ProductsExcelImport', () => ({ default: () => null }));
vi.mock('@/components/products/CompletarPesos', () => ({ default: () => null }));
vi.mock('@/lib/productTypes', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/productTypes')>(),
  listProductTypes: vi.fn().mockResolvedValue([]), listAttributeDefinitions: vi.fn().mockResolvedValue([]),
  listProductAttributeValues: vi.fn().mockResolvedValue([]), saveProductAttributeValues: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  localStorage.clear();
  mocks.org = { id: 'org', name: 'Prueba' };
  mocks.limit = null;
  Object.assign(mocks.permissions, { canCreate: true, canEdit: true, canDelete: true });
  for (const mock of [mocks.remove, mocks.update, mocks.add, mocks.stock]) mock.mockReset().mockResolvedValue(undefined);
  mocks.success.mockClear(); mocks.error.mockClear();
  vi.mocked(listProductTypes).mockResolvedValue([]);
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openPage() {
  const result = render(<MemoryRouter><TooltipProvider><ProductsPage /></TooltipProvider></MemoryRouter>);
  await screen.findByRole('region', { name: 'Tabla de productos' });
  return result;
}
describe('flujo real de Productos con backend simulado', () => {
  it('conserva el contenido de una alta perfume al cambiar de categoría dentro del mismo tipo', async () => {
    vi.mocked(listProductTypes).mockResolvedValue([{ id: 'perfume', org_id: 'org', name: 'Perfume', slug: 'perfume',
      source: 'custom', active: true, maneja_stock: true, description: null, template_code: null,
      template_version: null, created_at: '', updated_at: '' }]);
    render(<TooltipProvider><ProductForm product={null} settings={{ exchange_rate: 1000 }} userId="user" orgId="org" onDirtyChange={() => {}} onSave={() => {}} /></TooltipProvider>);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Tipo de producto' })).toHaveTextContent('Perfume'));
    fireEvent.change(screen.getByLabelText('Categoría de prueba'), { target: { value: 'perfume_arabe' } });
    fireEvent.change(screen.getByLabelText('Contenido (ml)'), { target: { value: '100' } });
    expect(screen.getByLabelText('Contenido (ml)')).toHaveValue(100);
    fireEvent.change(screen.getByLabelText('Categoría de prueba'), { target: { value: 'nicho' } });
    expect(screen.getByLabelText('Contenido (ml)')).toHaveValue(100);
    expect(screen.getByRole('combobox', { name: 'Tipo de producto' })).toHaveTextContent('Perfume');
    expect(mocks.add).not.toHaveBeenCalled(); expect(mocks.stock).not.toHaveBeenCalled();
  });
  it('el Pod ofrece capacidades enteras compatibles con el esquema, sin atajos decimales', async () => {
    render(<TooltipProvider><ProductForm product={null} settings={{ exchange_rate: 1000 }} userId="user" orgId="org" onDirtyChange={() => {}} onSave={() => {}} /></TooltipProvider>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Crear producto' })).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText('Categoría de prueba'), { target: { value: 'vaper' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pod / Cartucho' }));
    expect(screen.queryByRole('button', { name: '1.8ml' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '2.5ml' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '2ml' }));
    expect(screen.getByLabelText('Capacidad (ml)')).toHaveValue(2);
    expect(mocks.add).not.toHaveBeenCalled(); expect(mocks.stock).not.toHaveBeenCalled();
  });
  it('editar un artículo genérico no inventa ni reescribe género, volumen ni precio pack ocultos', async () => {
    render(<TooltipProvider><ProductForm product={{ ...mocks.product, gender: 'masculino', content_ml: 100, price_2x_ars: 200 }} settings={{ exchange_rate: 1000 }} userId="user" orgId="org" onDirtyChange={() => {}} onSave={() => {}} /></TooltipProvider>);
    const form = screen.getByRole('form');
    await waitFor(() => expect(within(form).getByRole('button', { name: 'Guardar cambios' })).not.toBeDisabled());
    expect(screen.queryByLabelText('Género')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Contenido (ml)')).not.toBeInTheDocument();
    fireEvent.submit(form);
    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
    for (const field of ['gender', 'content_ml', 'price_2x_ars']) expect(mocks.update.mock.calls[0][1]).not.toHaveProperty(field);
  });
  it('un tipo explícito ajeno a perfumes prevalece sobre la categoría heredada', async () => {
    vi.mocked(listProductTypes).mockResolvedValue([{ id: 'tool', name: 'Herramienta', slug: 'herramienta', source: 'custom', maneja_stock: true } as any]);
    render(<TooltipProvider><ProductForm product={{ ...mocks.product, category: 'perfume_arabe', product_type_id: 'tool' }} settings={{ exchange_rate: 1000 }} userId="user" orgId="org" onDirtyChange={() => {}} onSave={() => {}} /></TooltipProvider>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar cambios' })).not.toBeDisabled());
    expect(screen.queryByLabelText('Género')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Contenido (ml)')).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole('form'));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
    expect(mocks.update.mock.calls[0][1]).not.toHaveProperty('content_ml');
  });
  it('no trunca un volumen decimal de perfume antes de persistir', async () => {
    render(<TooltipProvider><ProductForm product={{ ...mocks.product, category: 'perfume_arabe', content_ml: 100 }} settings={{ exchange_rate: 1000 }} userId="user" orgId="org" onDirtyChange={() => {}} onSave={() => {}} /></TooltipProvider>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar cambios' })).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText('Contenido (ml)'), { target: { value: '2.5' } });
    fireEvent.submit(screen.getByRole('form'));
    expect(await screen.findByRole('alert')).toHaveTextContent('número entero');
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('conserva la escritura nativa del nombre y descripcion al marcar el formulario sucio', async () => {
    await openPage();
    fireEvent.click(screen.getByRole('button', { name: /^Nuevo$/ }));
    const editor = await screen.findByRole('dialog', { name: 'Nuevo producto' });
    const name = within(editor).getByPlaceholderText('Ej: Nombre del producto');
    fireEvent.input(name, { target: { value: 'Martillo' } });
    expect(name).toHaveValue('MARTILLO');
    const description = within(editor).getByPlaceholderText('Notas sobre el producto');
    fireEvent.input(description, { target: { value: 'Herramienta de mano' } });
    expect(description).toHaveValue('Herramienta de mano');
    expect(name).toHaveValue('MARTILLO');
    expect(mocks.add).not.toHaveBeenCalled();
  });
  it('abre el editor aun sin permiso de crear y con limite de plan alcanzado', async () => {
    mocks.permissions.canCreate = false; mocks.limit = 1;
    await openPage();
    fireEvent.click(screen.getByRole('button', { name: 'Editar Producto de prueba' }));
    expect(await screen.findByRole('dialog', { name: 'Editar producto' })).toBeVisible();
    expect(screen.getByDisplayValue('Producto de prueba')).toBeInTheDocument();
  });
  it('editar guarda una sola vez y no ajusta inventario sin cambio de stock', async () => {
    let finish!: () => void;
    mocks.update.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    await openPage();
    fireEvent.click(screen.getByRole('button', { name: 'Editar Producto de prueba' }));
    const form = await screen.findByRole('form', { name: 'Editar Producto de prueba' });
    fireEvent.submit(form); fireEvent.submit(form);
    await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: 'Guardando producto…' })).toBeDisabled();
    await act(async () => finish());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.stock).not.toHaveBeenCalled();
  });
  it('duplicar crea una ficha nueva sin reutilizar identificadores ni inventario', async () => {
    await openPage();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicar Producto de prueba' }));
    expect(await screen.findByRole('dialog', { name: 'Nuevo producto' })).toBeVisible();
    fireEvent.submit(screen.getByRole('form', { name: 'Crear producto' }));
    await waitFor(() => expect(mocks.add).toHaveBeenCalledTimes(1));
    expect(mocks.add.mock.calls[0][0]).toMatchObject({ name: 'COPIA DE PRODUCTO DE PRUEBA', stock: 0, sku: null, barcode: null });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('eliminar abre confirmacion; cancelar no escribe y confirmar elimina con tenant', async () => {
    await openPage();
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Producto de prueba' }));
    let confirmation = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancelar' }));
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Producto de prueba' }));
    confirmation = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirmation).getByRole('button', { name: /Eliminar$/ }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('product', 'org'));
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
  });
  it('muestra error recuperable sin SQL ni exito falso al rechazar eliminacion', async () => {
    mocks.remove.mockRejectedValueOnce({ code: '23503', message: 'private foreign_key product_id' });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await openPage();
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar Producto de prueba' }));
    const confirmation = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirmation).getByRole('button', { name: /Eliminar$/ }));
    expect(await screen.findByText(/Este producto tiene operaciones vinculadas/)).toBeVisible();
    expect(screen.queryByText(/foreign_key/)).not.toBeInTheDocument();
    expect(mocks.success).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Eliminar Producto de prueba' })).not.toBeDisabled());
    log.mockRestore();
  });
  it('solo lectura no permite editar, crear, duplicar ni eliminar', async () => {
    mocks.permissions = { ...mocks.permissions, canCreate: false, canEdit: false, canDelete: false };
    await openPage();
    expect(screen.queryByRole('button', { name: /^(Editar|Duplicar|Eliminar) Producto de prueba$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nuevo' })).not.toBeInTheDocument();
  });
});
