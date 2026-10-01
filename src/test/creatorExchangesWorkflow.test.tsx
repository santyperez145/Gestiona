import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CreatorExchangesSection from '@/components/creator/CreatorExchangesSection';
const mocks = vi.hoisted(() => ({ exchanges: [] as any[], submit: vi.fn() }));
vi.mock('@/lib/creatorContext', () => ({ useCreator: () => ({ exchanges: mocks.exchanges, submitExchangeContent: mocks.submit }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }));
beforeEach(() => {
  mocks.exchanges = [{ id: 'ex-1', org_name: 'Marca A', product_name: 'Producto real', quantity: 1, expected_posts: 2, actual_posts: 0, status: 'pendiente', content_url: null, content_submitted_at: null, goal_notes: 'Dos publicaciones' }];
  mocks.submit.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);
describe('assigned creator exchange content', () => {
  it('submits HTTPS publication and declared count without auto-approving', async () => {
    render(<CreatorExchangesSection />);
    fireEvent.change(screen.getByLabelText('Enlace de la publicación'), { target: { value: 'https://example.invalid/post' } });
    fireEvent.change(screen.getByLabelText('Publicaciones'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar contenido' }));
    await waitFor(() => expect(mocks.submit).toHaveBeenCalledWith('ex-1', 'https://example.invalid/post', 2));
    expect(screen.getByText('Pendiente')).toBeVisible();
  });
  it('rejects credential-bearing URLs before invoking the server', () => {
    render(<CreatorExchangesSection />);
    fireEvent.change(screen.getByLabelText('Enlace de la publicación'), { target: { value: 'https://secret@example.invalid/post' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar contenido' }));
    expect(screen.getByRole('alert')).toHaveTextContent('HTTPS');
    expect(mocks.submit).not.toHaveBeenCalled();
  });
  it('preserves input after a denied submission and never renders internal errors', async () => {
    mocks.submit.mockRejectedValueOnce({ code: '42501', message: 'exchange_access_denied' });
    render(<CreatorExchangesSection />);
    fireEvent.change(screen.getByLabelText('Enlace de la publicación'), { target: { value: 'https://example.invalid/post' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar contenido' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tu sesión no permite');
    expect(screen.getByLabelText('Enlace de la publicación')).toHaveValue('https://example.invalid/post');
    expect(screen.queryByText('exchange_access_denied')).not.toBeInTheDocument();
  });
  it('does not offer edits on a closed exchange', () => {
    mocks.exchanges[0].status = 'cumplido';
    render(<CreatorExchangesSection />);
    expect(screen.getByText('Cumplido')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Enviar contenido' })).not.toBeInTheDocument();
  });
  it('distinguishes an unassigned inbox from a failed load', () => {
    mocks.exchanges = [];
    render(<CreatorExchangesSection />);
    expect(screen.getByText(/Todavía no tenés canjes vinculados/)).toBeVisible();
  });
});
