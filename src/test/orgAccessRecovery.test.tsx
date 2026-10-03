import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrgProvider, getActiveOrgId, getActiveRole, useOrg } from '@/lib/orgContext';

const state = vi.hoisted(() => ({ user: { id: 'user-one' } as { id: string } | null, authLoading: false, query: vi.fn() }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: state.user, loading: state.authLoading }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: (table: string) => ({
  select: () => ({ eq: (_column: string, userId: string) => {
    const promise = state.query(table, userId);
    return { then: promise.then.bind(promise), maybeSingle: () => promise };
  } }),
}) } }));

const membership = (orgId = 'org-one', role = 'owner') => ({ org_id: orgId, role, organization: { id: orgId, name: orgId } });
const ok = (data: unknown) => ({ data, error: null, status: 200 });
const outage = { data: null, error: { code: 'PGRST002', message: 'Could not query the database for the schema cache. Retrying.' }, status: 503 };
let context: ReturnType<typeof useOrg>;
function Probe() {
  context = useOrg();
  return <div>{context.loading ? 'loading' : context.loadError ? 'load-error' : context.activeOrg?.id ?? 'no-memberships'}</div>;
}

beforeEach(() => {
  state.user = { id: 'user-one' }; state.authLoading = false;
  state.query.mockReset().mockImplementation((table: string) => Promise.resolve(ok(table === 'memberships' ? [membership()] : null)));
  localStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('session-scoped access recovery', () => {
  it('retries the observed PGRST002 and publishes a verified membership', async () => {
    let attempts = 0;
    state.query.mockImplementation((table: string) => Promise.resolve(table === 'memberships' && ++attempts === 1 ? outage : ok(table === 'memberships' ? [membership()] : null)));
    render(<OrgProvider><Probe /></OrgProvider>);
    await screen.findByText('org-one');
    expect(attempts).toBe(2);
    expect(context.loadError).toBe(false);
    expect(getActiveOrgId()).toBe('org-one');
    expect(getActiveRole()).toBe('owner');
  });
  it('recovers when PostgREST returns three consecutive transient outages', async () => {
    let membershipAttempts = 0;
    state.query.mockImplementation((table: string) => Promise.resolve(table === 'memberships' && ++membershipAttempts <= 3
      ? outage
      : ok(table === 'memberships' ? [membership()] : null)));
    render(<OrgProvider><Probe /></OrgProvider>);
    await screen.findByText('org-one', {}, { timeout: 4_000 });
    expect(membershipAttempts).toBe(4);
    expect(context.loadError).toBe(false);
    expect(getActiveOrgId()).toBe('org-one');
  });
  it('does not confuse persistent outage with pending approval and manually recovers', async () => {
    state.query.mockImplementation((table: string) => Promise.resolve(table === 'memberships' ? outage : ok(null)));
    render(<OrgProvider><Probe /></OrgProvider>);
    await screen.findByText('load-error', {}, { timeout: 3_000 });
    expect(state.query.mock.calls.filter(([table]) => table === 'memberships')).toHaveLength(4);
    expect(context.activeOrg).toBeNull();
    expect(getActiveOrgId()).toBeNull();
    state.query.mockImplementation((table: string) => Promise.resolve(ok(table === 'memberships' ? [membership()] : null)));
    await act(async () => { await context.refresh(); });
    expect(screen.getByText('org-one')).toBeInTheDocument();
    expect(context.loadError).toBe(false);
  });
  it('distinguishes a successful empty membership result from a failed read', async () => {
    state.query.mockResolvedValue(ok([]));
    render(<OrgProvider><Probe /></OrgProvider>);
    await screen.findByText('no-memberships');
    expect(context.loadError).toBe(false);
    expect(getActiveOrgId()).toBeNull();
  });
  it('does not retry permission errors or authorize a stored preference', async () => {
    localStorage.setItem('gestiona.activeOrgId', 'org-forbidden');
    expect(getActiveOrgId()).toBeNull();
    state.query.mockImplementation((table: string) => Promise.resolve(table === 'memberships' ? { data: null, error: { code: '42501' }, status: 403 } : ok(null)));
    render(<OrgProvider><Probe /></OrgProvider>);
    await screen.findByText('load-error');
    expect(state.query.mock.calls.filter(([table]) => table === 'memberships')).toHaveLength(1);
    expect(getActiveRole()).toBeNull();
    expect(getActiveOrgId()).toBeNull();
  });
  it('keeps Platform authority independent when the membership read fails', async () => {
    state.query.mockImplementation((table: string) => Promise.resolve(table === 'memberships' ? { data: null, error: { code: '42501' } } : ok({ role: 'support' })));
    render(<OrgProvider><Probe /></OrgProvider>);
    await screen.findByText('load-error');
    expect(context.platformRole).toBe('support');
    expect(context.platformLoadError).toBe(false);
    expect(context.activeRole).toBeNull();
  });
  it('does not infer superadmin from a missing or unknown platform role', async () => {
    state.query.mockImplementation((table: string) => Promise.resolve(ok(table === 'memberships' ? [] : { user_id: 'user-one', role: 'unknown' })));
    render(<OrgProvider><Probe /></OrgProvider>);
    await screen.findByText('no-memberships');
    expect(context.platformRole).toBeNull();
    expect(context.isPlatformAdmin).toBe(false);
  });
  it('a Platform failure never grants staff privileges or invalidates a verified tenant', async () => {
    state.query.mockImplementation((table: string) => Promise.resolve(table === 'platform_admins' ? { data: null, error: { code: '42501' } } : ok([membership()])));
    render(<OrgProvider><Probe /></OrgProvider>);
    await screen.findByText('org-one');
    expect(context.platformLoadError).toBe(true);
    expect(context.platformRole).toBeNull();
    expect(context.loadError).toBe(false);
  });
  it('refresh failure clears stale membership authority, not just the list', async () => {
    render(<OrgProvider><Probe /></OrgProvider>);
    await screen.findByText('org-one');
    state.query.mockImplementation((table: string) => Promise.resolve(table === 'memberships' ? { data: null, error: { code: '42501' } } : ok(null)));
    await act(async () => { await context.refresh(); });
    expect(context.loadError).toBe(true);
    expect(context.activeOrg).toBeNull();
    expect(context.activeRole).toBeNull();
    expect(getActiveOrgId()).toBeNull();
    expect(getActiveRole()).toBeNull();
  });
  it('hides old identity immediately and discards its late response', async () => {
    let resolveOld: (response: unknown) => void;
    state.query.mockImplementation((table: string, userId: string) => table === 'memberships' && userId === 'user-one'
      ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve(ok(table === 'memberships' ? [membership('org-two')] : null)));
    const { rerender } = render(<OrgProvider><Probe /></OrgProvider>);
    state.user = { id: 'user-two' };
    rerender(<OrgProvider><Probe /></OrgProvider>);
    expect(context.activeOrg).toBeNull();
    await screen.findByText('org-two');
    await act(async () => { resolveOld(ok([membership()])); });
    expect(context.activeOrg?.id).toBe('org-two');
    expect(getActiveOrgId()).toBe('org-two');
  });
  it('same-user token refresh does not reload organizations; logout clears both authorities', async () => {
    const { rerender } = render(<OrgProvider><Probe /></OrgProvider>);
    await screen.findByText('org-one');
    state.query.mockClear(); state.user = { id: 'user-one' };
    rerender(<OrgProvider><Probe /></OrgProvider>);
    expect(state.query).not.toHaveBeenCalled();
    state.user = null;
    rerender(<OrgProvider><Probe /></OrgProvider>);
    await waitFor(() => expect(context.loading).toBe(false));
    expect(context.activeOrg).toBeNull();
    expect(context.platformRole).toBeNull();
    expect(getActiveOrgId()).toBeNull();
  });
});
