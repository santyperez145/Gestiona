import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import InfluencerInvitationPage from '@/pages/InfluencerInvitationPage';

const mocks = vi.hoisted(() => ({ get: vi.fn(), respond: vi.fn() }));
vi.mock('@/lib/influencersDB', () => ({
  getInfluencerInvitation: mocks.get,
  respondInfluencerInvitation: mocks.respond,
}));

const invitation = {
  id: 'inv-1', status: 'pending', expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  email: 'creadora@example.com', campaign_title: 'Lanzamiento de otoño', campaign_brief: 'Video original con la colección',
  campaign_due_date: '2026-10-20', channel: 'instagram', influencer_name: 'Creadora Real', org_name: 'Marca Real',
};

function open(token = 'tok-1') {
  return render(
    <MemoryRouter initialEntries={[`/invitacion-creador/${token}`]}>
      <Routes>
        <Route path="/invitacion-creador/:token" element={<InfluencerInvitationPage />} />
      </Routes>
    </MemoryRouter>
  );
}
beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue(invitation);
  mocks.respond.mockReset().mockResolvedValue('accepted');
});
afterEach(cleanup);

describe('invitación pública a creadores', () => {
  it('muestra campaña, brief y expiración de una invitación pendiente', async () => {
    open();
    expect(await screen.findByText('Creadora Real')).toBeVisible();
    expect(screen.getByText('Lanzamiento de otoño')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Aceptar' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'No puedo' })).toBeVisible();
  });

  it('acepta la invitación y confirma el resultado sin exponer errores técnicos', async () => {
    mocks.respond.mockResolvedValueOnce('accepted');
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Aceptar' }));
    expect(await screen.findByText('Colaboración aceptada')).toBeVisible();
    expect(mocks.respond).toHaveBeenCalledWith('tok-1', 'accept');
  });

  it('rechaza la invitación y lo comunica en español', async () => {
    mocks.respond.mockResolvedValueOnce('declined');
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'No puedo' }));
    expect(await screen.findByText('Invitación rechazada')).toBeVisible();
  });

  it('una expiración se ve como estado, no como error técnico', async () => {
    mocks.respond.mockRejectedValueOnce(new Error('invitation_expired'));
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Aceptar' }));
    expect(await screen.findByText('La invitación expiró. Pedile a la marca que te envíe una nueva.')).toBeVisible();
    expect(screen.queryByText(/invitation_expired/)).not.toBeInTheDocument();
  });

  it('una invitación ya vencida no ofrece acciones', async () => {
    mocks.get.mockResolvedValueOnce({ ...invitation, status: 'expired', expires_at: new Date(Date.now() - 86400000).toISOString() });
    open();
    expect(await screen.findByText('Esta invitación expiró')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Aceptar' })).not.toBeInTheDocument();
  });

  it('un token inválido muestra un mensaje recuperable', async () => {
    mocks.get.mockRejectedValueOnce(new Error('invalid_token'));
    open();
    expect(await screen.findByText('Invitación no disponible')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Aceptar' })).not.toBeInTheDocument();
  });
});