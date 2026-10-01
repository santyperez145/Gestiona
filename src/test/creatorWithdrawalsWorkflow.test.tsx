import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import CreatorPortalPage from '@/pages/CreatorPortalPage';
import { toast } from 'sonner';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), refresh: vi.fn(), context: {} as any }));
vi.mock('@/lib/creatorContext', () => ({ useCreator: () => mocks.context, CreatorProvider: ({ children }: { children: React.ReactNode }) => children }));
vi.mock('@/components/influencers/ChatNotifyCard', () => ({ default: () => null }));
vi.mock('@/components/creator/CreatorMetricReportsCard', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc, auth: { signOut: vi.fn() } } }));

function open(path = '/portal-creador?tab=ingresos') {
  return render(<MemoryRouter initialEntries={[path]}><CreatorPortalPage /></MemoryRouter>);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: { ok: true }, error: null });
  mocks.context = {
    loading: false, error: null, authenticated: true, isCreator: true,
    profile: { display_name: 'Creadora Real', email: 'zz@invalid.test', onboarding_completed: true },
    campaigns: [], deliverables: [], deliverableFiles: [], contracts: [], exchanges: [], withdrawals: [],
    payoutDestinations: [{ id: 'destination-1', provider_label: 'Mercado Pago', identifier_masked: 'z***@invalid.test', is_default: true }],
    earnings: { total_commissions_ars: 22500, total_sales_count: 3, paid_ars: 10000, pending_withdrawals_ars: 0, available_ars: 12500 },
    refresh: mocks.refresh, savePayoutDestination: vi.fn(),
  };
});
afterEach(cleanup);

describe('portal autenticado: saldo y retiros con destino propio', () => {
  it('muestra los importes reales sin pedir otra carga al montar la pagina', () => {
    open();
    expect(screen.getByText('Disponible')).toBeVisible();
    expect(screen.getByText(/12.500/)).toBeVisible();
    expect(screen.getByText(/22.500/)).toBeVisible();
    expect(screen.getByText(/10.000/)).toBeVisible();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it('solicita el retiro por sesion y destino, nunca por token o referido', async () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Retirar' }));
    fireEvent.change(screen.getByLabelText('Monto a retirar (ARS)'), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar solicitud' }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('creator_request_withdrawal', {
      p_amount_ars: 5000, p_destination_id: 'destination-1', p_notes: null,
    }));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('Solicitud de retiro enviada. La marca la revisará para transferirte.');
  });
  it('no ofrece retirar con saldo cero y exige destino cuando hay saldo', () => {
    mocks.context.earnings.available_ars = 0;
    const first = open();
    expect(screen.queryByRole('button', { name: 'Retirar' })).not.toBeInTheDocument();
    first.unmount();
    mocks.context.earnings.available_ars = 12500;
    mocks.context.payoutDestinations = [];
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Retirar' }));
    expect(screen.getByRole('button', { name: 'Confirmar solicitud' })).toBeDisabled();
  });
  it('un saldo modificado produce recuperacion sin error tecnico', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'insufficient_balance', code: '22023' } });
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Retirar' }));
    fireEvent.change(screen.getByLabelText('Monto a retirar (ARS)'), { target: { value: '10000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar solicitud' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Tu saldo cambió. Actualizá el portal y revisá el monto disponible.'));
    expect(screen.getByLabelText('Monto a retirar (ARS)')).toHaveValue(10000);
    expect(toast.error).not.toHaveBeenCalledWith('insufficient_balance');
  });
  it('muestra carga fallida como error recuperable, no como rol incorrecto', () => {
    mocks.context.error = 'No pudimos cargar tu portal.';
    mocks.context.isCreator = false;
    open();
    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos cargar tu portal.');
    expect(screen.queryByText('Esta cuenta no es de un creador')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Volver a intentar' }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it('un visitante debe iniciar sesion y no puede consultar ingresos', () => {
    mocks.context.isCreator = false; mocks.context.authenticated = false;
    open();
    expect(screen.getByRole('heading', { name: 'Ingresá a tu portal de creador' })).toBeVisible();
    expect(screen.queryByText('Disponible')).not.toBeInTheDocument();
  });
});
