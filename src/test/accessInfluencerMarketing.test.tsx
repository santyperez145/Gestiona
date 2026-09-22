import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import InfluencerMarketingGate from '@/components/influencers/InfluencerMarketingGate';
import { businessRoutes, influencerMarketingProductRoutes, moduleForPath, businessAliases } from '@/app/routeManifest';

const state = vi.hoisted(() => ({ role: 'admin', canView: true, loading: false }));
vi.mock('@/lib/orgContext', () => ({ useOrg: () => ({ activeOrg: { id: 'org' }, activeRole: state.role, loading: false }) }));
vi.mock('@/lib/permissionsContext', () => ({ useModulePerms: () => ({ canView: state.canView, loading: state.loading }) }));
afterEach(() => { cleanup(); state.role = 'admin'; state.canView = true; state.loading = false; });

describe('acceso y rutas de Influencers', () => {
  it.each(['owner', 'admin'])('permite %s con permiso resuelto', role => {
    state.role = role;
    render(<InfluencerMarketingGate><p>Contenido privado</p></InfluencerMarketingGate>);
    expect(screen.getByText('Contenido privado')).toBeVisible();
  });
  it.each(['viewer', 'vendedor', 'support'])('no convierte %s en administrador', role => {
    state.role = role;
    render(<InfluencerMarketingGate><p>Contenido privado</p></InfluencerMarketingGate>);
    expect(screen.queryByText('Contenido privado')).not.toBeInTheDocument();
    expect(screen.getByText('Sin acceso a Influencers')).toBeVisible();
  });
  it('respeta denegaciones incluso para administradores', () => {
    state.canView = false;
    render(<InfluencerMarketingGate><p>Contenido privado</p></InfluencerMarketingGate>);
    expect(screen.queryByText('Contenido privado')).not.toBeInTheDocument();
  });
  it('no muestra datos mientras se cargan permisos', () => {
    state.loading = true;
    render(<InfluencerMarketingGate><p>Contenido privado</p></InfluencerMarketingGate>);
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Contenido privado')).not.toBeInTheDocument();
  });
  it('todas las rutas canónicas se montan dentro del router de la superficie', () => {
    const routes = influencerMarketingProductRoutes();
    expect(routes.length).toBeGreaterThan(4);
    expect(new Set(routes.map(route => route.path)).size).toBe(routes.length);
    for (const route of routes) {
      expect(route.path === '/influencer-marketing' || route.path.startsWith('/influencer-marketing/')).toBe(true);
      expect(moduleForPath(route.path)).toBe('influencers');
      expect(businessRoutes('admin').some(item => item.id === route.id)).toBe(false);
    }
  });
  it('conserva entradas antiguas sin montar páginas duplicadas', () => {
    const aliases = new Map(businessAliases());
    expect(aliases.get('/influencers')).toBe('/influencer-marketing/creadores');
    expect(aliases.get('/brief-composer')).toBe('/influencer-marketing/campanas?nueva=1');
    expect(aliases.get('/canjes')).toBe('/influencer-marketing/canjes');
    expect(aliases.get('/brand-portal')).toBe('/influencer-marketing/creadores');
  });
  it('incluye las rutas canónicas de paridad Go-Marz', () => {
    const paths = influencerMarketingProductRoutes().map(r => r.path);
    expect(paths).toContain('/influencer-marketing');
    expect(paths).toContain('/influencer-marketing/campanas');
    expect(paths).toContain('/influencer-marketing/descubrimiento');
    expect(paths).toContain('/influencer-marketing/creadores');
    expect(paths).toContain('/influencer-marketing/registro');
    expect(paths).toContain('/influencer-marketing/entregables');
    expect(paths).toContain('/influencer-marketing/contratos');
    expect(paths).toContain('/influencer-marketing/pagos');
    expect(paths).toContain('/influencer-marketing/canjes');
  });
});
