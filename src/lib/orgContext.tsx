import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';

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

// Global accessor used by non-React code (supabaseStore, etc.)
let _activeOrgId: string | null = null;
let _activeRole: OrgRole | null = null;
export function getActiveOrgId(): string | null {
  return _activeOrgId || (typeof localStorage !== 'undefined' ? localStorage.getItem(ACTIVE_ORG_KEY) : null);
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

  const refresh = useCallback(async (isInitial = false) => {
    if (!user) {
      setMemberships([]); setActiveOrg(null); setActiveRole(null);
      setPlatformRole(null);
      _activeOrgId = null; _activeRole = null;
      setLoading(false);
      return;
    }
    // Only show the loading spinner on first load — background refreshes are silent
    if (isInitial) setLoading(true);
    const { data, error } = await supabase
      .from('memberships')
      .select('org_id, role, organization:organizations(*)')
      .eq('user_id', user.id);
    if (error) {
      console.error('Error loading memberships', error);
      setMemberships([]); setLoading(false); return;
    }
    const mems = (data || []).filter(m => m.organization) as unknown as Membership[];
    setMemberships(mems);

    // Pick active org: localStorage > first
    const stored = localStorage.getItem(ACTIVE_ORG_KEY);
    const picked = mems.find(m => m.org_id === stored) || mems[0] || null;
    if (picked) {
      setActiveOrg(picked.organization);
      setActiveRole(picked.role);
      _activeOrgId = picked.org_id;
      _activeRole = picked.role;
      localStorage.setItem(ACTIVE_ORG_KEY, picked.org_id);
    } else {
      setActiveOrg(null); setActiveRole(null);
      _activeOrgId = null; _activeRole = null;
    }

    // Staff de plataforma (superficie separada del tenant)
    const { data: pa } = await supabase
      .from('platform_admins')
      .select('user_id, role')
      .eq('user_id', user.id)
      .maybeSingle();
    setPlatformRole(pa ? (((pa as { role?: string }).role as PlatformRole) || 'superadmin') : null);

    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (!authLoading) refresh(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id]); // user?.id — avoids re-run on same-user token refreshes

  const switchOrg = useCallback((orgId: string) => {
    const m = memberships.find(x => x.org_id === orgId);
    if (!m) return;
    setActiveOrg(m.organization);
    setActiveRole(m.role);
    _activeOrgId = m.org_id;
    _activeRole = m.role;
    localStorage.setItem(ACTIVE_ORG_KEY, m.org_id);
  }, [memberships]);

  return (
    <OrgContext.Provider value={{
      loading, memberships, activeOrg, activeRole, switchOrg, refresh,
      platformRole, isPlatformAdmin: platformRole !== null,
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
