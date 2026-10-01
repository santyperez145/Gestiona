import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import InfluencerExchangesPage from '@/pages/InfluencerExchangesPage';
const mocks = vi.hoisted(() => ({ canEdit: true, rpc: vi.fn(), user: { id: 'brand-owner' } }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('@/lib/permissionsContext', () => ({ useModulePerms: () => ({ canEdit: mocks.canEdit }) }));
vi.mock('@/lib/supabaseStore', () => ({
  getExchangesDB: async () => [{ id: 'exchange-a', influencer_name: 'Nombre repetido', product_name: 'Producto real', quantity: 1, expected_posts: 2, actual_posts: 0, status: 'pendiente', influencer_id: null }],
  formatARS: (value: number) => String(value),
}));
vi.mock('@/lib/influencersDB', () => ({
  listInfluencers: async () => [{ id: 'creator-a', name: 'Creadora A', email: 'zz-a@invalid.test' }],
  listInfluencerContracts: async () => [], listDeliverables: async () => [], listPayments: async () => [], listBrandPortals: async () => [],
}));
vi.mock('@/lib/marketingExtraDB', () => ({ listExchangeConfigs: async () => [] }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeEach(() => { mocks.canEdit = true; mocks.rpc.mockReset().mockResolvedValue({ data: true, error: null }); });
afterEach(cleanup);
function open() { render(<MemoryRouter><InfluencerExchangesPage /></MemoryRouter>); }
describe('brand explicitly assigns a creator to an exchange', () => {
  it('view-only permission does not expose assignment actions', async () => {
    mocks.canEdit = false; open();
    await screen.findByText('Producto real');
    expect(screen.queryByRole('button', { name: 'Vincular creador' })).not.toBeInTheDocument();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('opens a selection without inferring identity from the repeated name', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Vincular creador' }));
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(screen.getByText(/no se asigna por nombre/)).toBeVisible();
    const dialog = screen.getByRole('dialog');
    const trigger = dialog.querySelector('[role="combobox"]') as HTMLElement;
    fireEvent.click(trigger);
    fireEvent.pointerDown(await screen.findByRole('option', { name: /Creadora A/ }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Vincular creador' }).at(-1));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('brand_link_creator_exchange', { p_exchange_id: 'exchange-a', p_influencer_id: 'creator-a' }));
    expect(await screen.findByRole('button', { name: 'Copiar portal de Nombre repetido' })).toBeVisible();
  });
});
