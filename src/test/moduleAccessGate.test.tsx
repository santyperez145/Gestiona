import { useEffect } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ModuleGuard from '@/components/auth/ModuleGuard';
import ModuleAccessGate from '@/components/auth/ModuleAccessGate';

const state = vi.hoisted(() => ({ loading: false, canView: true, error: null as string | null, mount: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/permissionsContext', () => ({ useModulePerms: () => state, useRefreshPermissions: () => state.refresh }));
function PrivatePage() {
  useEffect(() => { state.mount(); }, []);
  return <p>Contenido del negocio</p>;
}
const view = (path = '/productos') => render(<MemoryRouter initialEntries={[path]}><ModuleGuard><PrivatePage /></ModuleGuard></MemoryRouter>);
beforeEach(() => { state.loading = false; state.canView = true; state.error = null; state.mount.mockClear(); state.refresh.mockClear(); });
afterEach(cleanup);

describe('barrera compartida de modulos', () => {
  it.each(['/productos', '/ventas', '/tienda-online', '/mi-plan', '/analytics'])('no monta %s ni dispara lecturas mientras verifica permisos', path => {
    state.loading = true;
    view(path);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Contenido del negocio')).not.toBeInTheDocument();
    expect(state.mount).not.toHaveBeenCalled();
  });
  it('muestra un error recuperable, no una denegacion ni datos protegidos', () => {
    state.canView = false;
    state.error = 'No pudimos verificar tus permisos. Reintentá para continuar.';
    view();
    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos verificar tu acceso');
    expect(screen.queryByText('Sin acceso a esta sección')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(state.refresh).toHaveBeenCalledOnce();
    expect(state.mount).not.toHaveBeenCalled();
  });
  it('respeta una denegacion resuelta y no ofrece un retry engañoso', () => {
    state.canView = false;
    view();
    expect(screen.getByRole('status')).toHaveTextContent('Sin acceso a esta sección');
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(state.mount).not.toHaveBeenCalled();
  });
  it('monta contenido solo despues de una lectura permitida', () => {
    view();
    expect(screen.getByText('Contenido del negocio')).toBeVisible();
    expect(state.mount).toHaveBeenCalledOnce();
  });
  it('conserva las rutas abiertas del manifest, no les inventa un permiso', () => {
    state.loading = true;
    state.canView = false;
    view('/');
    expect(screen.getByText('Contenido del negocio')).toBeVisible();
  });
  it('la misma barrera acepta el contexto de una superficie propia', () => {
    state.canView = false;
    render(<ModuleAccessGate module="influencers" title="Influencers"><PrivatePage /></ModuleAccessGate>);
    expect(screen.getByText('Sin acceso a Influencers')).toBeVisible();
    expect(state.mount).not.toHaveBeenCalled();
  });
});
