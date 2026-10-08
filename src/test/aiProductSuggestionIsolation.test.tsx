import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAIProductSuggest } from '@/hooks/useAIProductSuggest';

const state = vi.hoisted(() => ({ user: 'one', login: 'first', categoriesLoading: false, categoriesError: null as string | null,
  options: [{ slug: 'herramientas', label: 'Herramientas', nivel: 0 }], session: vi.fn() }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: state.user ? { id: state.user, last_sign_in_at: state.login } : null }) }));
vi.mock('@/components/products/CategorySelect', () => ({ useOrgCategories: () => ({ opciones: state.options,
  cargando: state.categoriesLoading, error: state.categoriesError }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession: state.session } } }));
const response = (content: unknown, finalNewline = true) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(content) } }] })}${finalNewline ? '\n\ndata: [DONE]\n\n' : ''}`);
const good = { category: 'herramientas', description: 'Martillo de mano', brand: '', unit: '', tags: ['martillo'] };
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  state.user = 'one'; state.login = 'first'; state.options = [{ slug: 'herramientas', label: 'Herramientas', nivel: 0 }];
  state.categoriesLoading = false; state.categoriesError = null;
  state.session.mockReset().mockImplementation(async () => ({ data: { session: { user: { id: state.user }, access_token: 'fixture-token' } } }));
  fetcher = vi.fn().mockImplementation(async () => response(good));
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function ask(result: { current: ReturnType<typeof useAIProductSuggest> }, name = 'Martillo') {
  act(() => result.current.suggest(name));
  await act(async () => { await vi.advanceTimersByTimeAsync(800); });
}

describe('sugerencias de catalogo aisladas y revisables', () => {
  it('no solicita IA sin beneficio y retira cache al perderlo', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useAIProductSuggest('org', enabled), { initialProps: { enabled: false } });
    await ask(result);
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
    rerender({ enabled: true });
    await ask(result);
    expect(result.current.result).not.toBeNull();
    rerender({ enabled: false });
    expect(result.current.result).toBeNull();
    await ask(result);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('no consulta IA con categorias pendientes o inaccesibles', async () => {
    state.categoriesLoading = true;
    const { result, rerender } = renderHook(() => useAIProductSuggest('org'));
    await ask(result);
    expect(fetcher).not.toHaveBeenCalled();
    state.categoriesLoading = false; state.categoriesError = 'private failure'; rerender();
    await ask(result);
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.error).not.toContain('private');
    state.categoriesError = null; rerender();
    await ask(result);
    expect(result.current.result?.category).toBe('herramientas');
  });
  it('devuelve categoria propia y etiqueta humana, nunca precios aunque el modelo los invente', async () => {
    fetcher.mockResolvedValueOnce(response({ ...good, priceMin: 10, priceMax: 999999, stock: 80 }));
    const { result } = renderHook(() => useAIProductSuggest('org'));
    await ask(result);
    expect(result.current.result).toMatchObject({ category: 'herramientas', categoryLabel: 'Herramientas', description: 'Martillo de mano' });
    expect(result.current.result).not.toHaveProperty('priceMax');
    expect(result.current.result).not.toHaveProperty('stock');
    const request = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(request).toEqual({ purpose: 'catalog-suggestion', productName: 'Martillo', orgId: 'org' });
    expect(result.current.query).toBe('Martillo');
  });
  it('debounce evita pedir una sugerencia por cada tecla y cachea solo dentro de la instancia', async () => {
    const { result } = renderHook(() => useAIProductSuggest('org'));
    act(() => { result.current.suggest('Mart'); result.current.suggest('Martillo'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    await ask(result);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('descarta la respuesta tardia del producto anterior y no apaga la carga nueva', async () => {
    let finish!: (value: Response) => void;
    fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(() => useAIProductSuggest('org'));
    await ask(result, 'Martillo');
    const signal = fetcher.mock.calls[0][1].signal;
    await ask(result, 'Destornillador');
    expect(signal.aborted).toBe(true);
    await act(async () => finish(response({ description: 'Respuesta antigua' })));
    expect(result.current.query).toBe('Destornillador');
    expect(result.current.result?.description).toBe('Martillo de mano');
    expect(result.current.error).toBeNull();
  });
  it.each(['org', 'user', 'login', 'category'] as const)('retira datos y cache al cambiar %s', async field => {
    const { result, rerender } = renderHook(({ org }) => useAIProductSuggest(org), { initialProps: { org: 'first' } });
    await ask(result);
    if (field === 'user') state.user = 'two';
    if (field === 'login') state.login = 'second';
    if (field === 'category') state.options = [{ slug: 'ropa', label: 'Ropa', nivel: 0 }];
    rerender({ org: field === 'org' ? 'second' : 'first' });
    expect(result.current.result).toBeNull();
    await ask(result);
    expect(fetcher).toHaveBeenCalledTimes(2);
    if (field === 'category') expect(result.current.result?.category).toBeUndefined();
  });
  it('no reutiliza sugerencias entre formularios ni sesiones cerradas', async () => {
    const first = renderHook(() => useAIProductSuggest('org'));
    await ask(first.result); first.unmount();
    const second = renderHook(() => useAIProductSuggest('org'));
    expect(second.result.current.result).toBeNull();
    await ask(second.result);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([null, 'other'])('no usa anon ni una sesion de otro usuario (%s)', async user => {
    state.session.mockResolvedValue({ data: { session: user ? { user: { id: user }, access_token: 'wrong-fixture' } : null } });
    const { result } = renderHook(() => useAIProductSuggest('org'));
    await ask(result);
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.error).not.toBeNull();
  });
  it('interpreta el ultimo evento sin salto final y conserva error recuperable sin detalles internos', async () => {
    fetcher.mockResolvedValueOnce(response(good, false));
    const { result } = renderHook(() => useAIProductSuggest('org'));
    await ask(result);
    expect(result.current.result?.description).toBe('Martillo de mano');
    fetcher.mockResolvedValueOnce(new Response('private-token-provider-error', { status: 503 }));
    await ask(result, 'Taladro');
    expect(result.current.result).toBeNull();
    expect(result.current.error).not.toContain('private-token');
    expect(result.current.loading).toBe(false);
    await ask(result, 'Taladro');
    expect(result.current.error).toBeNull();
  });
  it('consume el evento delta real del servidor y rechaza un stream que termina con error', async () => {
    fetcher.mockResolvedValueOnce(new Response(`data: ${JSON.stringify({ delta: JSON.stringify(good) })}\n\ndata: [DONE]\n\n`));
    const { result } = renderHook(() => useAIProductSuggest('org'));
    await ask(result);
    expect(result.current.result?.description).toBe('Martillo de mano');
    fetcher.mockResolvedValueOnce(new Response(`data: ${JSON.stringify({ delta: JSON.stringify(good) })}\n\ndata: {"error":"private-provider-error"}\n\n`));
    await ask(result, 'Taladro');
    expect(result.current.result).toBeNull();
    expect(result.current.error).not.toContain('private');
  });
  it('rechaza contenido HTML, categorias ajenas y salidas no estructuradas', async () => {
    fetcher.mockResolvedValueOnce(response({ category: 'ajena', description: '<script>wrong</script>', brand: 123 }));
    const { result } = renderHook(() => useAIProductSuggest('org'));
    await ask(result);
    expect(result.current.result).toBeNull();
    expect(result.current.error).not.toBeNull();
  });
  it('clear y desmontaje cancelan el trabajo pendiente sin otra peticion', async () => {
    const { result, unmount } = renderHook(() => useAIProductSuggest('org'));
    act(() => { result.current.suggest('Martillo'); result.current.clear(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(fetcher).not.toHaveBeenCalled();
    act(() => result.current.suggest('Martillo'));
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
