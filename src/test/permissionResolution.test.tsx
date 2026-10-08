import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { PermissionsProvider, useModulePerms, useRefreshPermissions } from '@/lib/permissionsContext';
import { useModulePermissions } from '@/lib/usePermissions';
import { resolveModulePermissions } from '@/lib/permissionPolicy';

const state = vi.hoisted(() => ({ org: 'one', role: 'admin', memberRole: 'admin', user: 'first', signIn: 'original', member: true, request: vi.fn() }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: state.user ? { id: state.user, last_sign_in_at: state.signIn } : null, loading: false }) }));
vi.mock('@/lib/orgContext', () => ({ useOrg: () => ({ activeOrg: state.org ? { id: state.org } : null, activeRole: state.member ? state.memberRole : null, loading: false }) }));
vi.mock('@/lib/useUserRole', () => ({ useUserRole: () => ({ role: state.role, loading: false }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: () => {
  const query: any = { select: () => query, eq: () => query, then: (resolve: any, reject: any) => state.request().then(resolve, reject) };
  return query;
} } }));
const wrapper = ({ children }: { children: ReactNode }) => <PermissionsProvider>{children}</PermissionsProvider>;
beforeEach(() => { state.org = 'one'; state.role = 'admin'; state.memberRole = 'admin'; state.user = 'first'; state.signIn = 'original'; state.member = true; state.request.mockReset().mockResolvedValue({ data: [], error: null }); });
afterEach(cleanup);

describe('permisos compartidos por rutas y acciones', () => {
  it.each([
    ['admin', true, true, true], ['vendedor', true, false, false], ['viewer', false, false, false],
  ] as const)('respeta defaults de %s', (role, create, edit, remove) => {
    expect(resolveModulePermissions(role)).toMatchObject({ canCreate: create, canEdit: edit, canDelete: remove });
  });
  it('respeta denegaciones administrativas y grants de edicion sin creacion', () => {
    expect(resolveModulePermissions('admin', { can_edit: false, can_delete: false })).toMatchObject({ canEdit: false, canDelete: false });
    expect(resolveModulePermissions('viewer', { can_edit: true, can_create: false })).toMatchObject({ canEdit: true, canCreate: false });
  });
  it('consulta una vez y comparte el resultado entre hooks antiguos y navegacion', async () => {
    state.request.mockResolvedValue({ data: [{ module: 'products', can_view: true, can_create: false, can_edit: true, can_delete: false }], error: null });
    const { result } = renderHook(() => [useModulePerms('products'), useModulePermissions('products')], { wrapper });
    expect(result.current[0].canEdit).toBe(false);
    await waitFor(() => expect(result.current[0].loading).toBe(false));
    expect(result.current[0]).toEqual(result.current[1]);
    expect(result.current[1]).toMatchObject({ canEdit: true, canCreate: false, canDelete: false });
    expect(state.request).toHaveBeenCalledTimes(1);
  });
  it.each(['response', 'rejection'])('deniega ante error %s en lugar de conceder defaults admin', async mode => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    if (mode === 'response') state.request.mockResolvedValue({ data: null, error: { code: '42501' } });
    else state.request.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useModulePermissions('products'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ canView: false, canCreate: false, canEdit: false, canDelete: false });
    expect(result.current.error).toBe('No pudimos verificar tus permisos. Reintentá para continuar.');
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
  it('nunca arrastra permisos ni respuestas tardias de otra organizacion', async () => {
    let resolveOld!: (value: unknown) => void;
    state.request.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const { result, rerender } = renderHook(() => useModulePermissions('products'), { wrapper });
    state.org = 'two'; state.role = 'viewer'; rerender();
    expect(result.current.canEdit).toBe(false);
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => resolveOld({ data: [{ module: 'products', can_edit: true }], error: null }));
    expect(result.current.canEdit).toBe(false);
  });
  it('actualiza permisos tras guardar sin recargar la pagina', async () => {
    const { result } = renderHook(() => ({ perms: useModulePermissions('products'), refresh: useRefreshPermissions() }), { wrapper });
    await waitFor(() => expect(result.current.perms.canEdit).toBe(true));
    state.request.mockResolvedValue({ data: [{ module: 'products', can_edit: false }], error: null });
    act(() => result.current.refresh?.());
    await waitFor(() => expect(result.current.perms.loading).toBe(false));
    expect(result.current.perms.canEdit).toBe(false);
  });
  it.each(['user', 'signIn', 'memberRole'] as const)('descarta permisos y errores al cambiar %s dentro de la misma org', async field => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result, rerender } = renderHook(() => useModulePermissions('products'), { wrapper });
    await waitFor(() => expect(result.current.canEdit).toBe(true));
    let finish!: (value: unknown) => void;
    state.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    state[field] = field === 'memberRole' ? 'owner' : 'changed';
    rerender();
    expect(result.current).toMatchObject({ loading: true, canView: false, error: null });
    await act(async () => finish({ data: null, error: { code: '42501', message: 'private technical details' } }));
    expect(result.current).toMatchObject({ loading: false, canView: false });
    expect(result.current.error).not.toContain('private technical details');
    log.mockRestore();
  });
  it('recupera una lectura fallida con retry sin habilitar defaults mientras espera', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    state.request.mockResolvedValueOnce({ data: null, error: { code: '42501' } });
    const { result } = renderHook(() => ({ perms: useModulePermissions('products'), refresh: useRefreshPermissions() }), { wrapper });
    await waitFor(() => expect(result.current.perms.error).not.toBeNull());
    act(() => result.current.refresh?.());
    expect(result.current.perms).toMatchObject({ loading: true, canView: false, error: null });
    await waitFor(() => expect(result.current.perms.canView).toBe(true));
    expect(result.current.perms.error).toBeNull();
    expect(state.request).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });
  it('owner respeta overrides de admin, igual que has_permission productivo', async () => {
    state.memberRole = 'owner';
    state.request.mockResolvedValue({ data: [{ module: 'products', can_view: false, can_create: false, can_edit: false, can_delete: false, can_export: false }], error: null });
    const { result } = renderHook(() => useModulePermissions('products'), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current).toMatchObject({ canView: false, canCreate: false, canEdit: false, canDelete: false, canExport: false });
  });
  it('el logout retira acceso y una respuesta anterior no lo restaura', async () => {
    let finish!: (value: unknown) => void;
    state.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const { result, rerender } = renderHook(() => useModulePermissions('products'), { wrapper });
    state.user = ''; rerender();
    expect(result.current.canView).toBe(false);
    await act(async () => finish({ data: [], error: null }));
    expect(result.current.canView).toBe(false);
    state.user = 'first'; rerender();
    expect(result.current).toMatchObject({ loading: true, canView: false });
    await waitFor(() => expect(result.current.canView).toBe(true));
  });
  it('sin provider o membresia no concede acceso aunque haya un rol residual', () => {
    const outside = renderHook(() => useModulePermissions('products'));
    expect(outside.result.current.canEdit).toBe(false);
    state.member = false;
    const inside = renderHook(() => useModulePermissions('products'), { wrapper });
    expect(inside.result.current.canView).toBe(false);
    expect(state.request).not.toHaveBeenCalled();
  });
});
