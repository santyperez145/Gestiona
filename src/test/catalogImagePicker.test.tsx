import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CatalogImagePicker from '@/components/products/CatalogImagePicker';
import { useCatalogImages } from '@/hooks/useCatalogImages';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), user: 'one', session: 'login-one' }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: mocks.user ? { id: mocks.user } : null, session: { user: { id: mocks.user, last_sign_in_at: mocks.session }, expires_at: 9999999999 } }) }));
vi.mock('@/lib/edgeErrors', () => ({ mensajeDeEdgeFunction: async () => 'No pudimos completar la imagen.' }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  functions: { invoke: mocks.invoke }, storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://test.supabase.co/storage/v1/object/public/product-images/${path}` } }) }) },
} }));
const candidate = { id: '11111111-1111-4111-8111-111111111111', title: 'Bosch GSB 13', thumbnail: 'https://api.openverse.org/thumb',
  url: 'https://upload.wikimedia.org/tool.jpg', source_url: 'https://commons.wikimedia.org/source', creator: 'Autor', license: 'cc0',
  license_url: 'https://creativecommons.org/publicdomain/zero/1.0/', match: { label: 'Modelo en el titulo', exact_product: false as const, brand_matched: true, model_matched: true }, license_version: '1.0' };
const own = 'https://test.supabase.co/storage/v1/object/public/product-images/org/catalog/11111111-1111-4111-8111-111111111111.webp';
beforeEach(() => { mocks.invoke.mockReset(); mocks.user = 'one'; mocks.session = 'login-one'; });
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe('revision y aislamiento de imagenes', () => {
  it('requiere ambas revisiones y agrega solamente la copia propia, no una URL del proveedor', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { ok: true, results: [candidate] } }).mockResolvedValueOnce({ data: { ok: true, url: own } });
    const onSelect = vi.fn(); const onOpenChange = vi.fn();
    render(<CatalogImagePicker open orgId="org" name="Taladro" brand="Bosch" onSelect={onSelect} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Revisar' }));
    const apply = screen.getByRole('button', { name: 'Copiar y agregar' });
    expect(apply).toBeDisabled();
    const checks = screen.getAllByRole('checkbox');
    fireEvent.click(checks[0]); expect(apply).toBeDisabled();
    fireEvent.click(checks[1]); fireEvent.click(apply);
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(own));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.invoke.mock.calls[1][1].body).toMatchObject({ action: 'acquire', candidate_id: candidate.id, review_product: true, review_rights: true });
    expect(mocks.invoke.mock.calls[1][1].body).not.toHaveProperty('url');
  });
  it.each(['org', 'name', 'brand', 'login', 'close'])('descarta una copia tardia tras cambio de %s', async change => {
    let finish!: (value: unknown) => void;
    mocks.invoke.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const props = { org: 'org', name: 'Taladro', brand: 'Bosch', enabled: true };
    const { result, rerender } = renderHook(p => useCatalogImages(p.org, undefined, p.name, p.brand, p.enabled), { initialProps: props });
    let operation!: Promise<string | null>;
    act(() => { operation = result.current.acquire(candidate); });
    expect(result.current.loading).toBe(true);
    if (change === 'login') mocks.session = 'second-login';
    rerender({ ...props, ...(change === 'close' ? { enabled: false } : change === 'login' ? {} : { [change]: 'other' }) });
    expect(result.current.loading).toBe(false);
    await act(async () => { finish({ data: { ok: true, url: own } }); await operation; });
    expect(await operation).toBeNull(); expect(result.current.candidates).toEqual([]);
  });
  it('conserva resultados y permite reintentar ante error, sin texto interno', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { ok: true, results: [candidate] } }).mockResolvedValueOnce({ error: new Error('private database SQL') });
    const { result } = renderHook(() => useCatalogImages('org', undefined, 'Taladro', 'Bosch'));
    await act(async () => { await result.current.search(); });
    await act(async () => { await result.current.acquire(candidate); });
    expect(result.current.candidates).toHaveLength(1); expect(result.current.error).not.toContain('SQL');
    expect(result.current.loading).toBe(false);
  });
  it('rechaza respuestas que pretenden agregar otra fuente u organizacion', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { ok: true, url: candidate.url } });
    const { result } = renderHook(() => useCatalogImages('org', undefined, 'Taladro', 'Bosch'));
    await act(async () => { expect(await result.current.acquire(candidate)).toBeNull(); });
    expect(result.current.error).toBeTruthy();
  });
});
