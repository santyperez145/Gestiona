import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InfluencerRecords from '@/components/influencers/InfluencerRecords';

const mocks = vi.hoisted(() => ({
  org: { id: 'org-a' },
  perms: { canView: true, canCreate: true, canEdit: true, canDelete: false },
  contracts: vi.fn(),
  deliverables: vi.fn(),
  creators: vi.fn(),
  campaigns: vi.fn(),
  review: vi.fn(),
}));
vi.mock('@/lib/orgContext', () => ({ useOrg: () => ({ activeOrg: mocks.org }) }));
vi.mock('@/lib/permissionsContext', () => ({ useModulePerms: () => mocks.perms }));
vi.mock('@/lib/influencersDB', () => ({
  listInfluencerContracts: mocks.contracts,
  listInfluencerDeliverables: mocks.deliverables,
  listInfluencers: mocks.creators,
  createInfluencerReview: mocks.review,
  createContract: vi.fn(), createDeliverable: vi.fn(), deleteContract: vi.fn(), deleteDeliverable: vi.fn(),
  updateContract: vi.fn(), updateDeliverable: vi.fn(),
}));
vi.mock('@/hooks/useInfluencerCampaigns', () => ({ useInfluencerCampaigns: () => ({ data: [] }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const deliverable = {
  id: 'del-1', org_id: 'org-a', influencer_id: 'creator-1', influencer_name: 'Creadora Real',
  campaign_name: 'Lanzamiento', description: 'Reel de producto', due_date: '2026-10-01',
  status: 'completado' as const, created_at: '2026-09-01',
};

function open(kind: 'contracts' | 'deliverables' = 'deliverables') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/influencer-marketing/entregables']}>
        <InfluencerRecords kind={kind} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}
beforeEach(() => {
  mocks.perms.canCreate = true; mocks.perms.canEdit = true; mocks.perms.canDelete = false;
  mocks.contracts.mockReset().mockResolvedValue([]);
  mocks.deliverables.mockReset().mockResolvedValue([deliverable]);
  mocks.creators.mockReset().mockResolvedValue([]);
  mocks.review.mockReset().mockResolvedValue({ id: 'rev-1' });
});
afterEach(cleanup);

describe('reviews de creadores — reputación real', () => {
  it('ofrece calificar un entregable completado', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: /Calificar trabajo de Creadora Real/ }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Calificar colaboración');
  });

  it('registra la review con rating y comentario', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: /Calificar trabajo de Creadora Real/ }));
    fireEvent.click(await screen.findByRole('button', { name: '4 estrellas' }));
    fireEvent.change(screen.getByLabelText(/Comentario/), { target: { value: 'Entregó antes de la fecha' } });
    fireEvent.click(screen.getByRole('button', { name: 'Registrar review' }));
    await waitFor(() => expect(mocks.review).toHaveBeenCalledWith(expect.objectContaining({
      influencer_id: 'creator-1', deliverable_id: 'del-1', rating: 4, comment: 'Entregó antes de la fecha',
    })));
  });

  it('no ofrece calificar cuando no hay permiso de creación', async () => {
    mocks.perms.canCreate = false;
    open();
    await screen.findByText('Reel de producto');
    expect(screen.queryByRole('button', { name: /Calificar trabajo/ })).not.toBeInTheDocument();
  });

  it('expone el error sin mensaje técnico', async () => {
    mocks.review.mockRejectedValueOnce(new Error('permission denied'));
    open();
    fireEvent.click(await screen.findByRole('button', { name: /Calificar trabajo de Creadora Real/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Registrar review' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos registrar la review');
    expect(screen.queryByText(/permission_denied/i)).not.toBeInTheDocument();
  });
});