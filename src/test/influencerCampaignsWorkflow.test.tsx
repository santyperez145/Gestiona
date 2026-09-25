import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InfluencerCampaignsPage from '@/pages/InfluencerCampaignsPage';
import InfluencerMarketingPage from '@/pages/InfluencerMarketingPage';
import { campaignErrorMessage, type InfluencerCampaign } from '@/lib/influencerCampaignsDB';

const mocks = vi.hoisted(() => ({ org: { id: 'org-a' }, permissions: { canView: true, canCreate: true, canEdit: true }, list: vi.fn(), creators: vi.fn(), save: vi.fn(), transition: vi.fn(), success: vi.fn() }));
vi.mock('@/lib/orgContext', () => ({ useOrg: () => ({ activeOrg: mocks.org }) }));
vi.mock('@/lib/permissionsContext', () => ({ useModulePerms: () => mocks.permissions }));
vi.mock('@/lib/influencersDB', () => ({ listInfluencers: mocks.creators, isActiveInfluencer: (status: string) => ['active', 'activo'].includes(status) }));
vi.mock('@/lib/influencerCampaignsDB', async original => ({ ...await original<typeof import('@/lib/influencerCampaignsDB')>(), listInfluencerCampaigns: mocks.list, saveInfluencerCampaign: mocks.save, transitionInfluencerCampaign: mocks.transition }));
vi.mock('sonner', () => ({ toast: { success: mocks.success } }));

const campaign: InfluencerCampaign = { id: 'campaign-a', org_id: 'org-a', title: 'Lanzamiento de colección', brief: 'Mostrar materiales y usos del producto', channel: 'instagram', objective: 'sales', budget_ars: 15000, due_date: '2026-12-20', status: 'draft', version: 1, created_at: '2026-09-21', updated_at: '2026-09-21', influencer_campaign_creators: [{ influencer_id: 'creator-a' }] };
let clients: QueryClient[] = [];
function open(url = '/influencer-marketing/campanas', overview = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client);
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}>{overview ? <InfluencerMarketingPage /> : <InfluencerCampaignsPage />}</MemoryRouter></QueryClientProvider>;
  return { ...render(tree()), tree, client };
}
beforeEach(() => {
  mocks.org = { id: 'org-a' }; Object.assign(mocks.permissions, { canCreate: true, canEdit: true });
  mocks.list.mockReset().mockResolvedValue([campaign]);
  mocks.creators.mockReset().mockResolvedValue([{ id: 'creator-a', name: 'Creadora real', status: 'activo', followers_ig: 2500 }]);
  mocks.save.mockReset().mockResolvedValue('campaign-a'); mocks.transition.mockReset().mockResolvedValue(undefined); mocks.success.mockClear();
});
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients = []; });

describe('campañas con API simulada y componentes reales', () => {
  it('muestra campañas persistidas y nombres de estado traducidos', async () => {
    open(); expect(await screen.findByRole('button', { name: campaign.title })).toBeVisible();
    expect(screen.queryByText('draft')).not.toBeInTheDocument();
  });
  it('crea con creadores reales, bloquea doble envío y no anuncia notificaciones', async () => {
    let finish!: (id: string) => void;
    mocks.save.mockImplementation(() => new Promise<string>(resolve => { finish = resolve; }));
    open('/influencer-marketing/campanas?nueva=1');
    fireEvent.change(await screen.findByLabelText('Nombre de la campaña'), { target: { value: 'Campaña nueva' } });
    fireEvent.click(await screen.findByRole('checkbox', { name: /Creadora real/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar campaña' }));
    expect(screen.getByRole('button', { name: 'Guardando...' })).toBeDisabled();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledWith('org-a', expect.objectContaining({ title: 'Campaña nueva', creator_ids: ['creator-a'], version: 0 }));
    await act(async () => { finish('campaign-a'); });
    expect(mocks.success).not.toHaveBeenCalledWith(expect.stringMatching(/notificados|lanzada/i));
  });
  it('conserva el formulario cuando falla el guardado y no expone errores SQL', async () => {
    mocks.save.mockRejectedValue(new Error('relation private_table does not exist'));
    open('/influencer-marketing/campanas?campana=campaign-a');
    fireEvent.change(await screen.findByLabelText('Nombre de la campaña'), { target: { value: 'Conservar cambios' } });
    await screen.findByRole('checkbox', { name: /Creadora real/ });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar campaña' }));
    // El editor también monta el chat por creador (otro role="alert"): se busca
    // el mensaje del guardado por texto, no por rol genérico.
    expect(await screen.findByText(/No pudimos guardar/)).toBeVisible();
    expect(screen.getByDisplayValue('Conservar cambios')).toBeVisible();
    expect(screen.queryByText(/private_table/)).not.toBeInTheDocument();
  });
  it('no permite crear ni editar con permisos de lectura', async () => {
    mocks.permissions.canCreate = false; mocks.permissions.canEdit = false;
    open('/influencer-marketing/campanas?campana=campaign-a');
    expect(await screen.findByLabelText('Nombre de la campaña')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Guardar campaña' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Activar seguimiento' })).not.toBeInTheDocument();
  });
  it('una falla de carga no se representa como listado vacío', async () => {
    mocks.list.mockRejectedValue(new Error('network'));
    open(); expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar');
    expect(screen.queryByText('Todavía no hay campañas')).not.toBeInTheDocument();
  });
  it('no reutiliza el listado de otra organización', async () => {
    const view = open(); await screen.findByRole('button', { name: campaign.title });
    mocks.org = { id: 'org-b' }; mocks.list.mockResolvedValue([]); view.rerender(view.tree());
    expect(screen.queryByRole('button', { name: campaign.title })).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledWith('org-b'));
  });
  it('pide confirmación para cambiar estado e informa que no envía ni paga', async () => {
    open('/influencer-marketing/campanas?campana=campaign-a');
    fireEvent.click(await screen.findByRole('button', { name: 'Activar seguimiento' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('ni realiza pagos');
    expect(mocks.transition).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(mocks.transition).toHaveBeenCalledWith('org-a', campaign, 'active'));
  });
  it('el resumen cuenta campañas, no contratos ni ventas pagadas', async () => {
    mocks.list.mockResolvedValue([{ ...campaign, status: 'active' }]);
    open('/influencer-marketing', true);
    expect(await screen.findByText('Campañas en curso')).toBeVisible();
    expect(screen.getByRole('link', { name: /Nueva campaña/ })).toHaveAttribute('href', '/influencer-marketing/campanas?nueva=1');
    expect(screen.queryByText('CPM')).not.toBeInTheDocument();
  });
  it('explica conflictos de edición sin mostrar el mensaje técnico', () => {
    expect(campaignErrorMessage({ message: 'campaign_conflict' })).toContain('otra sesión');
  });
});
