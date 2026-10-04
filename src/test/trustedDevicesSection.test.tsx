import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TrustedDevicesSection from '@/components/auth/TrustedDevicesSection';

const mocks = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock('@/lib/trustedDevice', () => ({
  canRememberDevice: () => true,
  trustedDeviceCommand: mocks.command,
  TrustedDeviceError: class TrustedDeviceError extends Error {},
}));

const current = {
  id: '00000000-0000-4000-8000-000000000001',
  label: 'Navegador principal',
  createdAt: '2026-10-04T12:00:00Z',
  lastUsedAt: '2026-10-04T12:00:00Z',
  expiresAt: '2026-10-11T12:00:00Z',
};

beforeEach(() => { mocks.command.mockReset(); });
afterEach(cleanup);

describe('dispositivos recordados del perfil', () => {
  it('distingue una lista vacía de un navegador recordado', async () => {
    mocks.command.mockResolvedValue({ trusted: false, devices: [] });
    render(<TrustedDevicesSection userId="user-1" hasVerifiedMfa onRequireFreshMfa={vi.fn()} />);
    expect(await screen.findByText('Todavía no hay dispositivos recordados.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recordar este navegador por 7 días' })).toBeInTheDocument();
    expect(screen.queryByText(/este navegador está recordado/i)).not.toBeInTheDocument();
    expect(mocks.command).toHaveBeenCalledWith('list');
  });

  it('sólo registra este navegador después de la verificación MFA', async () => {
    mocks.command.mockImplementation(async (action: string) => action === 'list'
      ? { trusted: false, devices: [] }
      : { trusted: true, expiresAt: current.expiresAt });
    const verify = vi.fn().mockResolvedValue(true);
    render(<TrustedDevicesSection userId="user-1" hasVerifiedMfa onRequireFreshMfa={verify} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Recordar este navegador por 7 días' }));
    await waitFor(() => expect(verify).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('register'));
  });

  it('si se cancela la verificación, no registra un dispositivo', async () => {
    mocks.command.mockResolvedValue({ trusted: false, devices: [] });
    render(<TrustedDevicesSection userId="user-1" hasVerifiedMfa onRequireFreshMfa={vi.fn().mockResolvedValue(false)} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Recordar este navegador por 7 días' }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(1));
    expect(mocks.command).not.toHaveBeenCalledWith('register');
  });

  it('olvida el navegador actual mediante cookie sin exponer una credencial', async () => {
    mocks.command.mockImplementation(async (action: string) => action === 'list'
      ? { trusted: true, currentDeviceId: current.id, expiresAt: current.expiresAt, devices: [current] }
      : { trusted: false });
    render(<TrustedDevicesSection userId="user-1" hasVerifiedMfa onRequireFreshMfa={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Olvidar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledWith('revoke', undefined));
  });

  it('no carga ni marca confianza si 2FA no está configurado', async () => {
    render(<TrustedDevicesSection userId="user-1" hasVerifiedMfa={false} onRequireFreshMfa={vi.fn()} />);
    expect(await screen.findByText('Activá 2FA para poder recordar este navegador.')).toBeInTheDocument();
    expect(mocks.command).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('descarta una respuesta tardía al cambiar de cuenta', async () => {
    let finishOld!: (value: unknown) => void;
    const oldRequest = new Promise(resolve => { finishOld = resolve; });
    mocks.command.mockImplementationOnce(() => oldRequest).mockResolvedValue({
      trusted: false, devices: [{ ...current, id: '00000000-0000-4000-8000-000000000002', label: 'Navegador de la nueva cuenta' }],
    });
    const verify = vi.fn();
    const { rerender } = render(<TrustedDevicesSection userId="user-1" hasVerifiedMfa onRequireFreshMfa={verify} />);
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(1));
    rerender(<TrustedDevicesSection userId="user-2" hasVerifiedMfa onRequireFreshMfa={verify} />);
    expect(await screen.findByText('Navegador de la nueva cuenta')).toBeInTheDocument();
    await act(async () => {
      finishOld({ trusted: true, devices: [{ ...current, label: 'Dispositivo de la cuenta anterior' }] });
      await oldRequest;
    });
    expect(screen.queryByText('Dispositivo de la cuenta anterior')).not.toBeInTheDocument();
    expect(screen.queryByText(/este navegador está recordado/i)).not.toBeInTheDocument();
  });
});
