import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import InfluencerPortalPage from '@/pages/InfluencerPortalPage';
import { toast } from 'sonner';

const mocks = vi.hoisted(() => ({
  portal: vi.fn(),
  earnings: vi.fn(),
  withdrawals: vi.fn(),
  request: vi.fn(),
  submitContent: vi.fn(),
}));
vi.mock('@/lib/influencersDB', () => ({
  getCreatorEarnings: mocks.earnings,
  listCreatorWithdrawals: mocks.withdrawals,
  requestCreatorWithdrawal: mocks.request,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: mocks.portal },
}));

const exchanges = [{
  id: 'ex-1', influencer_name: 'Creadora Real', product_name: 'Perfume Test', quantity: 1,
  status: 'pendiente', exchange_type: 'canje', expected_posts: 2, actual_posts: null,
  content_url: null, content_submitted_at: null, delivery_date: null, goal_notes: null,
}];
const earnings = {
  influencer_id: 'creator-1', influencer_name: 'Creadora Real',
  total_generated_ars: 150000, total_commissions_ars: 22500, total_sales_count: 3,
  paid_ars: 10000, pending_withdrawals_ars: 0, available_ars: 12500,
};

function open(token = 'tok-1') {
  return render(
    <MemoryRouter initialEntries={[`/portal-influencer/${token}`]}>
      <Routes>
        <Route path="/portal-influencer/:token" element={<InfluencerPortalPage />} />
      </Routes>
    </MemoryRouter>
  );
}
beforeEach(() => {
  mocks.portal.mockReset().mockResolvedValue({ data: exchanges, error: null });
  mocks.earnings.mockReset().mockResolvedValue(earnings);
  mocks.withdrawals.mockReset().mockResolvedValue([]);
  mocks.request.mockReset().mockResolvedValue({ id: 'w-1', status: 'pending' });
});
afterEach(cleanup);

describe('portal del creador — ingresos y retiros', () => {
  it('muestra saldo disponible, generado y retirado reales', async () => {
    open();
    expect(await screen.findByText('Tus ingresos')).toBeVisible();
    expect(await screen.findByText('$ 12.500,00')).toBeVisible();
    expect(screen.getByText('$ 22.500,00')).toBeVisible();
    expect(screen.getByText('$ 10.000,00')).toBeVisible();
  });

  it('solicita un retiro y confirma en español', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: /Solicitar retiro/ }));
    fireEvent.change(screen.getByLabelText('Monto a retirar (ARS)'), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }));
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith('tok-1', 5000));
    expect(toast.success).toHaveBeenCalledWith('Solicitud de retiro enviada. La marca la va a revisar.');
  });

  it('bloquea el botón cuando el saldo es cero', async () => {
    mocks.earnings.mockResolvedValueOnce({ ...earnings, available_ars: 0 });
    open();
    expect(await screen.findByText('Tus ingresos')).toBeVisible();
    expect(await screen.findByRole('button', { name: /Solicitar retiro/ })).toBeDisabled();
  });

  it('monto que supera el saldo se comunica como estado, no error técnico', async () => {
    mocks.request.mockRejectedValueOnce(new Error('insufficient_balance'));
    open();
    fireEvent.click(await screen.findByRole('button', { name: /Solicitar retiro/ }));
    fireEvent.change(await screen.findByLabelText('Monto a retirar (ARS)'), { target: { value: '10000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }));
    expect(await screen.findByText('El monto supera tu saldo disponible.')).toBeVisible();
  });
});