import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorkspaceState from '@/components/shared/WorkspaceState';
import { WORKSPACE_STATE_KINDS } from '@/components/shared/workspaceStateContract';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

afterEach(() => {
  document.body.innerHTML = '';
});

describe('contrato transversal de estados del workspace', () => {
  it('cubre los doce estados exigidos por el estándar competitivo', () => {
    expect(WORKSPACE_STATE_KINDS).toEqual([
      'initial-loading', 'refreshing', 'empty-first-use', 'empty-filtered',
      'error-recoverable', 'permission', 'offline', 'stale', 'partial',
      'conflict', 'rate-limited', 'success',
    ]);
  });

  it('initial loading conserva estructura, nombre accesible y aria-busy', () => {
    render(<WorkspaceState kind="initial-loading" title="Leyendo órdenes" loadingRows={3} />);
    const state = screen.getByRole('status');
    expect(state).toHaveAttribute('aria-busy', 'true');
    expect(state).toHaveAttribute('data-workspace-state', 'initial-loading');
    expect(screen.getByText('Leyendo órdenes')).toHaveClass('sr-only');
  });

  it('errores, offline y conflictos anuncian con alert; el resto con status', () => {
    for (const kind of WORKSPACE_STATE_KINDS.filter(kind => kind !== 'initial-loading')) {
      const { unmount } = render(<WorkspaceState kind={kind} title={kind} />);
      const expectedRole = ['error-recoverable', 'offline', 'conflict'].includes(kind) ? 'alert' : 'status';
      expect(screen.getByRole(expectedRole)).toHaveAttribute('data-workspace-state', kind);
      unmount();
    }
  });

  it('ofrece recuperación explícita sin convertir el error en vacío', () => {
    const retry = vi.fn();
    render(<WorkspaceState kind="error-recoverable" title="No cargó" description="La consulta falló." actionLabel="Reintentar" onAction={retry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByText('La consulta falló.')).toBeVisible();
  });

  it('Finance adopta carga estable, error recuperable, offline y éxito comunes', () => {
    const finance = source('src/pages/FinanceDocumentsPage.tsx');
    for (const kind of ['initial-loading', 'error-recoverable', 'offline', 'success']) {
      expect(finance).toContain(`kind="${kind}"`);
    }
    expect(finance).not.toContain('function Feedback(');
    expect(finance).not.toContain('function EmptyState()');
    expect(finance).toContain('request !== loadRequest.current || activeOrgIdRef.current !== orgId');
    expect(finance).toContain('loadedOrgId === activeOrg?.id ? documents : []');
  });

  it('Compras distingue primer uso, filtros, parcial, stale y offline', () => {
    const purchases = source('src/pages/PurchaseOrdersPage.tsx');
    for (const kind of ['empty-first-use', 'empty-filtered', 'partial', 'stale', 'offline']) {
      expect(purchases).toContain(`kind="${kind}"`);
    }
    expect(purchases).toContain('Las órdenes están disponibles, pero faltan');
    expect(purchases).toContain('initialLoadFailed');
  });

  it('Reportes distingue carga, refresh, errores y cobertura parcial en sus sub-vistas', () => {
    const reports = source('src/pages/ReportsPage.tsx');
    for (const kind of ['initial-loading', 'refreshing', 'error-recoverable', 'offline', 'stale', 'partial']) {
      expect(reports, `Reportes no declara el estado ${kind}`).toContain(`kind="${kind}"`);
    }
    expect(reports).toContain('kind={logs.length === 0 ? "empty-first-use" : "empty-filtered"}');
    expect(reports).toContain('Promise.allSettled');
    expect(reports).toContain('console.error(\'[Reportes]');
    expect(reports).not.toContain('getOrgMembersWithProfilesDB(user.id).catch(() => [])');
    expect(reports).toContain('Never render the previous organization');
  });
});
