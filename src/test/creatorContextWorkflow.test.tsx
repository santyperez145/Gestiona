import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreatorProvider, useCreator } from '@/lib/creatorContext';

const mocks = vi.hoisted(() => ({
  user: { id: 'user-a', email: 'zz-a@invalid.test' } as any,
  account: vi.fn(), rpc: vi.fn(), files: vi.fn(), authLoading: false,
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: mocks.user, loading: mocks.authLoading }) }));
vi.mock('@/lib/creatorDeliverableFiles', () => ({ listCreatorDeliverableFiles: mocks.files }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: mocks.rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.account }) }) }) },
}));
const own = () => ({ user_id: mocks.user.id, email: mocks.user.email, onboarding_completed: true });
function PortalProbe() {
  const creator = useCreator();
  return <div><span>{creator.loading ? 'loading' : creator.error ? 'error' : creator.isCreator ? 'creator' : 'not-creator'}</span>
    <output aria-label="available">{creator.earnings?.available_ars}</output>
    <output aria-label="canjes">{creator.exchanges?.length}</output>
    <button onClick={() => void creator.refresh()}>refresh</button>
    <button onClick={() => void creator.submitExchangeContent('ex-1','https://example.invalid/post',2)}>submit exchange</button>
  </div>;
}
function open() { return render(<CreatorProvider><PortalProbe /></CreatorProvider>); }
beforeEach(() => {
  mocks.user = { id: 'user-a', email: 'zz-a@invalid.test' }; mocks.authLoading = false;
  mocks.account.mockReset().mockImplementation(async () => ({ data: own(), error: null }));
  mocks.files.mockReset().mockResolvedValue([]);
  mocks.rpc.mockReset().mockImplementation(async name => ({
    data: name === 'creator_earnings' ? { available_ars: 500 } : name === 'creator_exchanges' ? [{ id: 'ex-1' }] : [], error: null,
  }));
});
afterEach(cleanup);

describe('creator context: actual load authority and honest failures', () => {
  it('loads each source once and includes assigned canjes', async () => {
    open();
    expect(await screen.findByText('creator')).toBeVisible();
    expect(screen.getByLabelText('available')).toHaveTextContent('500');
    expect(screen.getByLabelText('canjes')).toHaveTextContent('1');
    expect(mocks.rpc.mock.calls.filter(([name]) => name === 'creator_earnings')).toHaveLength(1);
  });
  it('seeds a newly invited account before resolving linked profiles, without fabricating a profile', async () => {
    mocks.account.mockResolvedValueOnce({ data: null, error: null });
    open();
    expect(await screen.findByText('creator')).toBeVisible();
    expect(mocks.rpc).toHaveBeenCalledWith('creator_ensure_account', undefined);
    expect(mocks.account).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledWith('creator_linked_profiles', { p_user_id: 'user-a' });
  });
  it('does not disguise RPC permission errors as empty data or a business account', async () => {
    mocks.rpc.mockImplementation(async name => name === 'creator_earnings'
      ? { data: null, error: { code: '42501', message: 'permission denied' } } : { data: [], error: null });
    open();
    expect(await screen.findByText('error')).toBeVisible();
    expect(screen.queryByText('not-creator')).not.toBeInTheDocument();
  });
  it('handles an account read failure and retries without inventing ownership', async () => {
    mocks.account.mockResolvedValueOnce({ data: null, error: { message: 'network failed' } });
    open();
    expect(await screen.findByText('error')).toBeVisible();
    expect(mocks.rpc).not.toHaveBeenCalledWith('creator_ensure_account', undefined);
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }));
    expect(await screen.findByText('creator')).toBeVisible();
  });
  it('accepts only the explicit server non-creator decision, not any 42501', async () => {
    mocks.account.mockResolvedValueOnce({ data: null, error: null });
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'Esta cuenta no esta registrada como creador' } });
    open();
    expect(await screen.findByText('not-creator')).toBeVisible();
    expect(screen.queryByText('error')).not.toBeInTheDocument();
  });
  it('discards a response from the previous identity', async () => {
    let resolvePrevious: (value: unknown) => void;
    mocks.rpc.mockImplementation(async name => name === 'creator_earnings' && mocks.user.id === 'user-a'
      ? await new Promise(resolve => { resolvePrevious = resolve; }) : { data: name === 'creator_earnings' ? { available_ars: 900 } : [], error: null });
    const view = open();
    await waitFor(() => expect(resolvePrevious).toBeTypeOf('function'));
    mocks.user = { id: 'user-b', email: 'zz-b@invalid.test' };
    view.rerender(<CreatorProvider><PortalProbe /></CreatorProvider>);
    expect(await screen.findByText('creator')).toBeVisible();
    resolvePrevious({ data: { available_ars: 100 }, error: null });
    await waitFor(() => expect(screen.getByLabelText('available')).toHaveTextContent('900'));
  });
  it('submits content by assigned exchange ID and refreshes after success', async () => {
    open();
    await screen.findByText('creator');
    fireEvent.click(screen.getByRole('button', { name: 'submit exchange' }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('creator_submit_exchange_content', {
      p_exchange_id: 'ex-1', p_content_url: 'https://example.invalid/post', p_actual_posts: 2,
    }));
  });
});
