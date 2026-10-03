import { createContext, useContext, useEffect, useState, useRef, ReactNode, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { retryRead } from '@/lib/transientRead';

export type OrgRole = 'owner' | 'admin' | 'vendedor' | 'viewer';

/**
 * Rol del staff de la PLATAFORMA — ortogonal a `OrgRole`.
 * Ser staff de plataforma no otorga ningún permiso dentro de una organización:
 * son dos superficies separadas (ver `useUserRole`).
 */
export type PlatformRole = 'superadmin' | 'support' | 'finance';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  owner_user_id: string;
  plan_id: string | null;
  trial_ends_at: string | null;
  onboarding_completed: boolean;
  onboarding_goal: 'pos' | 'online' | 'explore';
}

export interface Membership {
  org_id: string;
  role: OrgRole;
  organization: Organization;
}

interface OrgContextValue {
  loading: boolean;
  loadError: boolean;
  platformLoadError: boolean;
  memberships: Membership[];
  activeOrg: Organization | null;
  activeRole: OrgRole | null;
  switchOrg: (orgId: string) => void;
  refresh: () => Promise<void>;
  isPlatformAdmin: boolean;
  platformRole: PlatformRole | null;
}

const OrgContext = createContext<OrgContextValue | undefined>(undefined);

const ACTIVE_ORG_KEY = 'gestiona.activeOrgId';
// PostgREST can briefly return PGRST002 while its database connection/schema
// cache recovers. Access bootstrap is a read-only security boundary, so it may
// wait one attempt longer than ordinary page reads without reusing stale roles.
const ACCESS_READ_RETRY_OPTIONS = {
  delaysMs: [150, 450, 900] as const,
  maxAttempts: 4,
};

// Global accessor used by non-React code (supabaseStore, etc.)
let _activeOrgId: string | null = null;
let _activeRole: OrgRole | null = null;
export function getActiveOrgId(): string | null {
  // A remembered preference is not evidence of a current membership.
  return _activeOrgId;
}
export function getActiveRole(): OrgRole | null {
  return _activeRole;
}
export function requireActiveOrgId(): string {
  const id = getActiveOrgId();
  if (!id) throw new Error('No hay una organización activa. Recargá la página.');
  return id;
}

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [activeOrg, setActiveOrg] = useState<Organization | null>(null);
  const [activeRole, setActiveRole] = useState<OrgRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [platformRole, setPlatformRole] = useState<PlatformRole | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [platformLoadError, setPlatformLoadError] = useState(false);
  const [loadedUserId, setLoadedUserId] = useState<string | null | undefined>(undefined);
  const userId = user?.id ?? null;
  const currentUserId = useRef(userId);
  if (currentUserId.current !== userId) { _activeOrgId = null; _activeRole = null; }
  currentUserId.current = userId;
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++requestRef.current;
    const isCurrent = () => request === requestRef.current && currentUserId.current === userId;
    setLoading(true);
    setLoadError(false);
    setPlatformLoadError(false);
    _activeOrgId = null; _activeRole = null;
    if (!userId) {
      setMemberships([]); setActiveOrg(null); setActiveRole(null);
      setPlatformRole(null);
      setLoadedUserId(null);
      setLoading(false);
      return;
    }
    // Independent authorities load together. Failure of one never grants the other.
    const [membershipResult, platformResult] = await Promise.allSettled([
      retryRead(() => supabase.from('memberships')
        .select('org_id, role, organization:organizations(*)').eq('user_id', userId), ACCESS_READ_RETRY_OPTIONS),
      retryRead(() => supabase.from('platform_admins')
        .select('user_id, role').eq('user_id', userId).maybeSingle(), ACCESS_READ_RETRY_OPTIONS),
    ]);
    if (!isCurrent()) return;
    const membershipError = membershipResult.status === 'rejected' ? membershipResult.reason : membershipResult.value.error;
    if (membershipError) {
      console.error('[OrgProvider] membership read failed', { code: membershipError.code ?? 'transport' });
      setLoadError(true);
      setMemberships([]); setActiveOrg(null); setActiveRole(null);
    } else {
      const data = membershipResult.status === 'fulfilled' ? membershipResult.value.data : null;
      const mems = (data || []).filter(m => m.organization) as unknown as Membership[];
      setMemberships(mems);
      const stored = localStorage.getItem(ACTIVE_ORG_KEY);
      const picked = mems.find(m => m.org_id === stored) || mems[0] || null;
      if (picked) {
        setActiveOrg(picked.organization);
        setActiveRole(picked.role);
        _activeOrgId = picked.org_id; _activeRole = picked.role;
        localStorage.setItem(ACTIVE_ORG_KEY, picked.org_id);
      } else {
        setActiveOrg(null); setActiveRole(null);
      }
    }
    const platformError = platformResult.status === 'rejected' ? platformResult.reason : platformResult.value.error;
    if (platformError) {
      console.error('[OrgProvider] platform role read failed', { code: platformError.code ?? 'transport' });
      setPlatformLoadError(true);
      setPlatformRole(null);
    } else {
      const pa = platformResult.status === 'fulfilled' ? platformResult.value.data : null;
      const role = pa?.role;
      setPlatformRole(role === 'superadmin' || role === 'support' || role === 'finance' ? role : null);
    }
    setLoadedUserId(userId);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (!authLoading) void refresh();
    return () => { requestRef.current += 1; _activeOrgId = null; _activeRole = null; };
  }, [authLoading, refresh]);

  const switchOrg = useCallback((orgId: string) => {
    if (loading || loadError || loadedUserId !== userId) return;
    const m = memberships.find(x => x.org_id === orgId);
    if (!m) return;
    setActiveOrg(m.organization);
    setActiveRole(m.role);
    _activeOrgId = m.org_id;
    _activeRole = m.role;
    localStorage.setItem(ACTIVE_ORG_KEY, m.org_id);
  }, [memberships, loading, loadError, loadedUserId, userId]);

  const sameUser = loadedUserId === userId;

  return (
    <OrgContext.Provider value={{
      loading: authLoading || loading || !sameUser,
      loadError: sameUser && loadError, platformLoadError: sameUser && platformLoadError,
      memberships: sameUser ? memberships : [], activeOrg: sameUser ? activeOrg : null,
      activeRole: sameUser ? activeRole : null, switchOrg, refresh,
      platformRole: sameUser ? platformRole : null, isPlatformAdmin: sameUser && platformRole !== null,
    }}>
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used within OrgProvider');
  return ctx;
}
