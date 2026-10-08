import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOrgCategoryNames } from '@/hooks/useOrgCategoryNames';
import { useOrgCategories } from '@/components/products/CategorySelect';

const state = vi.hoisted(() => ({ requests: [] as Array<{
  table: string; org?: string; resolve: (value: { data: unknown; error: unknown }) => void;
}> }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: (table: string) => {
  let resolve!: (value: { data: unknown; error: unknown }) => void;
  const promise = new Promise(res => { resolve = res; });
  const request = { table, org: undefined as string | undefined, resolve };
  state.requests.push(request);
  const query = {
    select: () => query, order: () => query,
    eq: (column: string, value: string) => { if (column === 'org_id') request.org = value; return query; },
    then: promise.then.bind(promise),
  };
  return query;
} } }));
beforeEach(() => { state.requests = []; });
afterEach(cleanup);
async function complete(org: string, name: string, error: unknown = null) {
  await act(async () => {
    for (const request of state.requests.filter(request => request.org === org)) {
      request.resolve({ data: request.table === 'products' ? [{ category: name }]
        : [{ id: name, name, slug: name, parent_id: null, sort_order: 0, is_active: true }], error });
    }
  });
}

describe('taxonomia del negocio activo', () => {
  it.each(['labels', 'options'])('oculta datos anteriores al cambiar de negocio (%s)', async mode => {
    const { result, rerender } = renderHook(({ org }) => mode === 'labels'
      ? useOrgCategoryNames(org) : useOrgCategories(org), { initialProps: { org: 'one' } });
    await complete('one', 'primera');
    expect(result.current.categorias).toHaveLength(1);
    rerender({ org: 'two' });
    expect(result.current.categorias).toEqual([]);
    expect(result.current.cargando).toBe(true);
    await complete('two', 'segunda');
    expect(result.current.categorias[0].slug).toBe('segunda');
    rerender({ org: '' });
    expect(result.current.categorias).toEqual([]);
    expect(result.current.cargando).toBe(false);
  });
  it('descarta categorias y slugs tardios de otro negocio', async () => {
    const { result, rerender } = renderHook(({ org }) => useOrgCategories(org), { initialProps: { org: 'one' } });
    rerender({ org: 'two' });
    await complete('two', 'correcta');
    await complete('one', 'ajena');
    expect(result.current.opciones).toEqual([{ slug: 'correcta', label: 'correcta', nivel: 0 }]);
    expect(result.current.cargando).toBe(false);
  });
  it('un reintento mas nuevo gana aunque la respuesta anterior llegue despues', async () => {
    const { result } = renderHook(() => useOrgCategoryNames('one'));
    act(() => { void result.current.recargar(); });
    const [previous, latest] = state.requests;
    await act(async () => latest.resolve({ data: [{ slug: 'nueva', name: 'Nueva' }], error: null }));
    await act(async () => previous.resolve({ data: [{ slug: 'vieja', name: 'Vieja' }], error: null }));
    expect(result.current.nombre('nueva')).toBe('Nueva');
    expect(result.current.categorias[0].slug).toBe('nueva');
  });
  it('muestra un error recuperable sin filtrar el mensaje interno', async () => {
    const { result } = renderHook(() => useOrgCategories('one'));
    await complete('one', 'ajena', { code: '42501', message: 'private policy details' });
    expect(result.current.error).toContain('Reintent');
    expect(result.current.error).not.toContain('private');
    expect(result.current.opciones).toEqual([]);
    act(() => { void result.current.recargar(); });
    await complete('one', 'correcta');
    expect(result.current.error).toBeNull();
    expect(result.current.opciones[0].slug).toBe('correcta');
  });
});
