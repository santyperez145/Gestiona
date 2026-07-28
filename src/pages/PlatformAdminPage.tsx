import { useEffect, useState, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrg } from '@/lib/orgContext';
import { Navigate } from 'react-router-dom';
import {
  Building2, Users, DollarSign, TrendingUp, Search, RefreshCw,
  Clock, CheckCircle2, XCircle, Zap, Shield, Ban, Trash2,
  Edit2, AlertTriangle, Crown, UserX, UserCheck, ChevronRight,
  MoreHorizontal, CalendarDays, Activity, Headphones, Pause, Play,
  History, ShoppingCart, Package, Server, TrendingDown,
  KeyRound, Link2, Copy, UserPlus, Mail, FileDown, Loader2,
} from 'lucide-react';
import SystemHealthTab from '@/components/platform/SystemHealthTab';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import PageHeader from '@/components/shared/PageHeader';
import KPICard from '@/components/shared/KPICard';
import { usePageTitle } from '@/hooks/usePageTitle';

// ── Types ────────────────────────────────────────────────────────────────────

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  trial_ends_at: string | null;
  plan_name: string | null;
  plan_id: string | null;
  plan_price: number;
  member_count: number;
  status: string;
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  lastSignIn: string | null;
  banned: boolean;
  memberships: { role: string; orgName: string }[];
  isPlatformAdmin?: boolean;
}

interface PlanRow {
  id: string;
  name: string;
  description: string | null;
  price_usd_monthly: number;
  price_usd_yearly: number;
  max_products: number | null;
  max_sales_per_month: number | null;
  max_users: number | null;
  ai_enabled: boolean;
  backups_enabled: boolean;
  custom_branding: boolean;
  stripe_price_id_monthly: string | null;
  stripe_price_id_yearly: string | null;
  features: string[] | null;
  sort_order: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  active:   { label: 'Activo',      color: 'bg-green-500/15 text-green-400 border-green-500/20',     icon: CheckCircle2 },
  trialing: { label: 'Trial',       color: 'bg-blue-500/15 text-blue-400 border-blue-500/20',        icon: Zap },
  past_due: { label: 'Pago pend',   color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20', icon: Clock },
  canceled: { label: 'Cancelado',   color: 'bg-red-500/15 text-red-400 border-red-500/20',           icon: XCircle },
  paused:   { label: 'Pausado',     color: 'bg-muted text-muted-foreground border-border',            icon: Clock },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const adminCall = async (action: string, params: Record<string, unknown> = {}) => {
  const { data, error } = await supabase.functions.invoke('platform-admin-action', {
    body: { action, ...params },
  });
  if (error) {
    // Try to extract the real error message from the response body
    const ctx = (error as { context?: unknown }).context;
    if (ctx) {
      try {
        const ctxAny = ctx as { json?: () => Promise<any> };
        const body = typeof ctxAny.json === 'function' ? await ctxAny.json() : null;
        if (body?.error) throw new Error(body.error);
      } catch (parseErr) {
        if (parseErr instanceof Error && parseErr.message !== error.message) throw parseErr;
      }
    }
    const msg = error.message || '';
    if (msg.includes('Failed to send') || msg.includes('NetworkError') || msg.includes('fetch')) {
      throw new Error('No se pudo conectar con la función. Verificá que esté desplegada en Supabase.');
    }
    throw new Error(msg || 'Error de red');
  }
  if (!data?.ok) throw new Error(data?.error || 'Error desconocido');
  return data;
};

const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString('es-AR') : '—';
const fmtFull = (d: string | null) => d ? new Date(d).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

// ── Main Component ────────────────────────────────────────────────────────────

export default function PlatformAdminPage() {
  usePageTitle("Platform Admin");
  const { isPlatformAdmin, loading: orgLoading } = useOrg();
  const [tab, setTab] = useState('overview');

  // Overview data
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [platformAdminIds, setPlatformAdminIds] = useState<Set<string>>(new Set());
  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [stats, setStats] = useState({
    orgs: 0, users: 0, mrr: 0, arr: 0,
    active: 0, trialing: 0, canceled: 0, past_due: 0, trialConversion: 0,
    growth30d: 0, churnRate: 0, arpu: 0,
  });

  // Org tab state
  const [orgSearch, setOrgSearch] = useState('');
  const [orgSort, setOrgSort] = useState<'created' | 'name' | 'status' | 'plan'>('created');
  const [orgStatusFilter, setOrgStatusFilter] = useState<string>('all');

  // User tab state
  const [userSearch, setUserSearch] = useState('');

  // Dialogs
  const [extendDialog, setExtendDialog] = useState<{ open: boolean; org: OrgRow | null }>({ open: false, org: null });
  const [extendDays, setExtendDays] = useState('7');
  const [planDialog, setPlanDialog] = useState<{ open: boolean; org: OrgRow | null }>({ open: false, org: null });
  const [planDialogPlanId, setPlanDialogPlanId] = useState('');
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; org: OrgRow | null }>({ open: false, org: null });
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [editPlanDialog, setEditPlanDialog] = useState<{ open: boolean; plan: PlanRow | null }>({ open: false, plan: null });
  const [editPlanForm, setEditPlanForm] = useState<Partial<PlanRow>>({});
  const [saving, setSaving] = useState(false);

  // Create org dialog
  const [createOrgDialog, setCreateOrgDialog] = useState(false);
  const [newOrgForm, setNewOrgForm] = useState({
    name: '', ownerEmail: '', ownerName: '', planId: '', trialDays: '14', sendInvite: true,
  });
  const [createdInviteLink, setCreatedInviteLink] = useState<string | null>(null);

  // Support tab state
  const [adminLogs, setAdminLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [supportOrgSearch, setSupportOrgSearch] = useState('');
  const [selectedOrg, setSelectedOrg] = useState<OrgRow | null>(null);
  const [orgActivity, setOrgActivity] = useState<any>(null);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [suspendingOrgId, setSuspendingOrgId] = useState<string | null>(null);
  const [orgMembers, setOrgMembers] = useState<{ user_id: string; email: string; name: string; role: string }[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // ── Load functions ─────────────────────────────────────────────────────────

  const loadOrgs = useCallback(async () => {
    setLoadingOrgs(true);
    const [{ data: orgsData }, { data: subsData }, { data: plansData }, { data: memsData }] = await Promise.all([
      supabase.from('organizations').select('id,name,slug,created_at,trial_ends_at,plan_id').order('created_at', { ascending: false }),
      supabase.from('subscriptions').select('org_id,plan_id,status'),
      supabase.from('plans').select('id,name,price_usd_monthly'),
      supabase.from('memberships').select('org_id'),
    ]);

    const planMap = new Map((plansData || []).map(p => [p.id, p]));
    const subMap = new Map((subsData || []).map(s => [s.org_id, s]));
    const memCounts: Record<string, number> = {};
    (memsData || []).forEach(m => { memCounts[m.org_id] = (memCounts[m.org_id] || 0) + 1; });

    const enriched: OrgRow[] = (orgsData || []).map(o => {
      const sub = subMap.get(o.id);
      const plan = sub ? planMap.get(sub.plan_id) : (o.plan_id ? planMap.get(o.plan_id) : null);
      return {
        id: o.id, name: o.name, slug: o.slug,
        created_at: o.created_at, trial_ends_at: o.trial_ends_at,
        plan_name: plan?.name || '—',
        plan_id: sub?.plan_id || o.plan_id || null,
        plan_price: plan?.price_usd_monthly || 0,
        member_count: memCounts[o.id] || 0,
        status: sub?.status || 'trialing',
      };
    });
    setOrgs(enriched);

    const activeSubs = (subsData || []).filter(s => s.status === 'active');
    const mrr = activeSubs.reduce((acc, s) => acc + (planMap.get(s.plan_id)?.price_usd_monthly || 0), 0);
    const everTrialed = enriched.filter(r => r.trial_ends_at).length;
    const converted = enriched.filter(r => r.status === 'active').length;

    // Growth: orgs created in last 30 days vs prior 30 days
    const now = Date.now();
    const last30 = enriched.filter(r => new Date(r.created_at).getTime() > now - 30 * 86400000).length;
    const prior30 = enriched.filter(r => {
      const t = new Date(r.created_at).getTime();
      return t > now - 60 * 86400000 && t <= now - 30 * 86400000;
    }).length;
    const growth30d = prior30 > 0 ? Math.round(((last30 - prior30) / prior30) * 100) : (last30 > 0 ? 100 : 0);

    // Churn rate: canceled in last 30 days / active 30 days ago
    const canceled30d = (subsData || []).filter(s => s.status === 'canceled').length;
    const churnRate = activeSubs.length > 0 ? Math.round((canceled30d / (activeSubs.length + canceled30d)) * 100) : 0;

    // ARPU: MRR / active subs
    const arpu = activeSubs.length > 0 ? Math.round(mrr / activeSubs.length) : 0;

    setStats({
      orgs: enriched.length,
      users: 0,
      mrr,
      arr: mrr * 12,
      active: activeSubs.length,
      trialing: (subsData || []).filter(s => s.status === 'trialing').length,
      canceled: (subsData || []).filter(s => s.status === 'canceled').length,
      past_due: (subsData || []).filter(s => s.status === 'past_due').length,
      trialConversion: everTrialed > 0 ? Math.round((converted / everTrialed) * 100) : 0,
      growth30d,
      churnRate,
      arpu,
    });
    setLoadingOrgs(false);
  }, []);

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true);
    try {
      const [usersData, { data: paData }] = await Promise.all([
        adminCall('getUsers'),
        supabase.from('platform_admins').select('user_id'),
      ]);
      const paIds = new Set((paData || []).map((r: any) => r.user_id));
      setPlatformAdminIds(paIds);
      setUsers((usersData.users || []).map((u: UserRow) => ({ ...u, isPlatformAdmin: paIds.has(u.id) })));
      setStats(prev => ({ ...prev, users: usersData.users?.length || 0 }));
    } catch (e: any) {
      toast.error(e.message);
    }
    setLoadingUsers(false);
  }, []);

  const loadPlans = useCallback(async () => {
    setLoadingPlans(true);
    const { data } = await supabase.from('plans').select('*').order('sort_order');
    setPlans((data || []) as PlanRow[]);
    setLoadingPlans(false);
  }, []);

  useEffect(() => {
    if (!isPlatformAdmin) return;
    loadOrgs();
    loadPlans();
  }, [isPlatformAdmin, loadOrgs, loadPlans]);

  useEffect(() => {
    if (tab === 'users' && users.length === 0 && isPlatformAdmin) loadUsers();
  }, [tab, isPlatformAdmin, users.length, loadUsers]);

  useEffect(() => {
    if (tab === 'support' && adminLogs.length === 0 && isPlatformAdmin) loadAdminLogs();
  }, [tab, isPlatformAdmin, adminLogs.length]);

  const loadAdminLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const res = await adminCall('getAdminLogs', { limit: 50 });
      setAdminLogs(res.logs || []);
    } catch (e: any) {
      toast.error(`No se pudieron cargar los logs: ${e.message}`);
    }
    setLoadingLogs(false);
  }, []);

  const loadOrgActivity = useCallback(async (orgId: string) => {
    setLoadingActivity(true);
    setOrgActivity(null);
    try {
      const res = await adminCall('getOrgActivity', { orgId });
      setOrgActivity(res);
    } catch { /* silently fail */ }
    setLoadingActivity(false);
  }, []);

  const loadOrgMembers = useCallback(async (orgId: string) => {
    setLoadingMembers(true);
    setOrgMembers([]);
    try {
      const res = await adminCall('getOrgMembers', { orgId });
      setOrgMembers(res.members || []);
    } catch { /* silently fail */ }
    setLoadingMembers(false);
  }, []);

  const handleUpdateMemberRole = async (orgId: string, userId: string, newRole: string) => {
    try {
      await adminCall('updateMemberRole', { orgId, userId, role: newRole });
      setOrgMembers(prev => prev.map(m => m.user_id === userId ? { ...m, role: newRole } : m));
      toast.success('Rol actualizado');
    } catch (e: any) { toast.error(e.message); }
  };

  const handleRemoveMember = async (orgId: string, userId: string, email: string) => {
    if (!confirm(`¿Remover a ${email} de la organización?`)) return;
    try {
      await adminCall('removeMember', { orgId, userId });
      setOrgMembers(prev => prev.filter(m => m.user_id !== userId));
      toast.success('Miembro removido');
    } catch (e: any) { toast.error(e.message); }
  };

  const handleSuspendOrg = async (org: OrgRow) => {
    setSuspendingOrgId(org.id);
    try {
      await adminCall('suspendOrg', { orgId: org.id });
      toast.success(`${org.name} suspendida`);
      setSelectedOrg(prev => prev?.id === org.id ? { ...prev, status: 'paused' } : prev);
      loadOrgs();
    } catch (e: any) { toast.error(e.message); }
    setSuspendingOrgId(null);
  };

  const handleReactivateOrg = async (org: OrgRow) => {
    setSuspendingOrgId(org.id);
    try {
      await adminCall('reactivateOrg', { orgId: org.id });
      toast.success(`${org.name} reactivada`);
      setSelectedOrg(prev => prev?.id === org.id ? { ...prev, status: 'active' } : prev);
      loadOrgs();
    } catch (e: any) { toast.error(e.message); }
    setSuspendingOrgId(null);
  };

  const supportFilteredOrgs = useMemo(() => {
    if (!supportOrgSearch) return orgs.slice(0, 20);
    const q = supportOrgSearch.toLowerCase();
    return orgs.filter(r =>
      r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q)
    ).slice(0, 20);
  }, [orgs, supportOrgSearch]);

  const ACTION_LABELS: Record<string, string> = {
    extendTrial: 'Extendió trial',
    changePlan: 'Cambió plan',
    deleteOrg: 'Eliminó org',
    toggleBanUser: 'Baneó/desbaneó usuario',
    addPlatformAdmin: 'Agregó admin',
    removePlatformAdmin: 'Removió admin',
    updatePlan: 'Actualizó plan',
    suspendOrg: 'Suspendió org',
    reactivateOrg: 'Reactivó org',
    createOrg: 'Creó organización',
    generateMagicLink: 'Generó magic link',
    resetUserPassword: 'Reseteó contraseña',
    updateMemberRole: 'Cambió rol de miembro',
    removeMember: 'Removió miembro',
  };

  // ── Org actions ────────────────────────────────────────────────────────────

  const handleExtendTrial = async () => {
    if (!extendDialog.org) return;
    setSaving(true);
    try {
      const res = await adminCall('extendTrial', { orgId: extendDialog.org.id, days: parseInt(extendDays) || 7 });
      toast.success(`Trial extendido hasta ${fmt(res.newExpiry)}`);
      setExtendDialog({ open: false, org: null });
      loadOrgs();
    } catch (e: any) { toast.error(e.message); }
    setSaving(false);
  };

  const handleChangePlan = async () => {
    if (!planDialog.org || !planDialogPlanId) return;
    setSaving(true);
    try {
      await adminCall('changePlan', { orgId: planDialog.org.id, planId: planDialogPlanId });
      toast.success('Plan actualizado');
      setPlanDialog({ open: false, org: null });
      loadOrgs();
    } catch (e: any) { toast.error(e.message); }
    setSaving(false);
  };

  const handleDeleteOrg = async () => {
    if (!deleteDialog.org || deleteConfirm !== deleteDialog.org.name) return;
    setSaving(true);
    try {
      await adminCall('deleteOrg', { orgId: deleteDialog.org.id });
      toast.success('Organización eliminada');
      setDeleteDialog({ open: false, org: null });
      setDeleteConfirm('');
      loadOrgs();
    } catch (e: any) { toast.error(e.message); }
    setSaving(false);
  };

  const exportOrgsCSV = () => {
    const headers = ['Nombre', 'Slug', 'Plan', 'Estado', 'MRR USD', 'Usuarios', 'Trial Termina', 'Creada'];
    const rows = filteredOrgs.map(r => [
      r.name, r.slug, r.plan_name || '', r.status,
      r.status === 'active' ? r.plan_price : 0,
      r.member_count,
      r.trial_ends_at ? new Date(r.trial_ends_at).toISOString().slice(0, 10) : '',
      new Date(r.created_at).toISOString().slice(0, 10),
    ]);
    const csv = [
      headers.join(','),
      ...rows.map(r => r.map(c => {
        const s = String(c);
        return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(',')),
    ].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orgs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${rows.length} organizaciones exportadas`);
  };

  const handleCreateOrg = async () => {
    if (!newOrgForm.name.trim() || !newOrgForm.ownerEmail.trim()) {
      toast.error('Nombre y email del owner son requeridos');
      return;
    }
    setSaving(true);
    try {
      const res = await adminCall('createOrg', {
        name: newOrgForm.name.trim(),
        ownerEmail: newOrgForm.ownerEmail.trim().toLowerCase(),
        ownerName: newOrgForm.ownerName.trim() || undefined,
        planId: newOrgForm.planId || undefined,
        trialDays: parseInt(newOrgForm.trialDays) || 14,
        sendInvite: newOrgForm.sendInvite,
      });
      toast.success(res.existing ? 'Org creada para usuario existente' : 'Org y usuario creados');
      if (res.inviteLink) setCreatedInviteLink(res.inviteLink);
      else {
        setCreateOrgDialog(false);
        setNewOrgForm({ name: '', ownerEmail: '', ownerName: '', planId: '', trialDays: '14', sendInvite: true });
      }
      loadOrgs();
      if (users.length > 0) loadUsers();
    } catch (e: any) { toast.error(e.message); }
    setSaving(false);
  };

  // ── User actions ───────────────────────────────────────────────────────────

  const handleToggleBan = async (u: UserRow) => {
    const newBan = !u.banned;
    try {
      await adminCall('toggleBanUser', { userId: u.id, ban: newBan });
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, banned: newBan } : x));
      toast.success(newBan ? 'Usuario baneado' : 'Usuario desbaneado');
    } catch (e: any) { toast.error(e.message); }
  };

  const handleResetPassword = async (u: UserRow) => {
    if (!confirm(`¿Enviar email de recuperación de contraseña a ${u.email}?`)) return;
    try {
      await adminCall('resetUserPassword', { userId: u.id });
      toast.success(`Email enviado a ${u.email}`);
    } catch (e: any) { toast.error(e.message); }
  };

  const handleGenerateMagicLink = async (u: UserRow) => {
    try {
      const res = await adminCall('generateMagicLink', { userId: u.id, type: 'magiclink' });
      await navigator.clipboard.writeText(res.action_link || '');
      toast.success('Magic link copiado al portapapeles', {
        description: 'Compartilo por un canal seguro. Es de un solo uso.',
      });
    } catch (e: any) { toast.error(e.message); }
  };

  const handleTogglePlatformAdmin = async (u: UserRow) => {
    const isPA = platformAdminIds.has(u.id);
    try {
      await adminCall(isPA ? 'removePlatformAdmin' : 'addPlatformAdmin', { userId: u.id });
      const updated = new Set(platformAdminIds);
      if (isPA) updated.delete(u.id);
      else updated.add(u.id);
      setPlatformAdminIds(updated);
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, isPlatformAdmin: !isPA } : x));
      toast.success(isPA ? 'Admin de plataforma removido' : 'Admin de plataforma agregado');
    } catch (e: any) { toast.error(e.message); }
  };

  // ── Plan actions ───────────────────────────────────────────────────────────

  const handleSavePlan = async () => {
    if (!editPlanDialog.plan) return;
    setSaving(true);
    try {
      await adminCall('updatePlan', { planId: editPlanDialog.plan.id, updates: editPlanForm });
      toast.success('Plan actualizado');
      setEditPlanDialog({ open: false, plan: null });
      loadPlans();
    } catch (e: any) { toast.error(e.message); }
    setSaving(false);
  };

  // ── Filtered lists ─────────────────────────────────────────────────────────

  const filteredOrgs = useMemo(() => {
    let list = [...orgs];
    if (orgStatusFilter !== 'all') {
      list = list.filter(r => r.status === orgStatusFilter);
    }
    if (orgSearch) {
      const q = orgSearch.toLowerCase();
      list = list.filter(r => r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      if (orgSort === 'name') return a.name.localeCompare(b.name, 'es');
      if (orgSort === 'status') return a.status.localeCompare(b.status);
      if (orgSort === 'plan') return (a.plan_name || '').localeCompare(b.plan_name || '');
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return list;
  }, [orgs, orgSearch, orgSort, orgStatusFilter]);

  const filteredUsers = useMemo(() => {
    if (!userSearch) return users;
    const q = userSearch.toLowerCase();
    return users.filter(u =>
      u.email.toLowerCase().includes(q) ||
      u.name.toLowerCase().includes(q) ||
      u.memberships.some(m => m.orgName?.toLowerCase().includes(q))
    );
  }, [users, userSearch]);

  // ── Guard ──────────────────────────────────────────────────────────────────

  if (orgLoading) return <div className="p-8 text-muted-foreground text-sm">Verificando permisos...</div>;
  if (!isPlatformAdmin) return <Navigate to="/" replace />;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        icon={Crown}
        title="Platform Admin"
        description="Control total de todos los tenants de Gestiona"
        actions={
          <Button variant="outline" size="sm" onClick={() => { loadOrgs(); if (tab === 'users') loadUsers(); if (tab === 'plans') loadPlans(); }} disabled={loadingOrgs}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loadingOrgs ? 'animate-spin' : ''}`} /> Actualizar
          </Button>
        }
      />

      {/* KPIs — Row 1: Business metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Organizaciones" value={stats.orgs} icon={Building2} color="primary"
          sub={`${stats.trialing} en trial · ${stats.active} activas`} />
        <KPICard label="MRR" value={`$${stats.mrr.toLocaleString()}`} icon={DollarSign} color="success"
          sub={`ARR est.: $${stats.arr.toLocaleString()}`} />
        <KPICard label="Crecimiento 30d" value={`${stats.growth30d >= 0 ? '+' : ''}${stats.growth30d}%`}
          icon={stats.growth30d >= 0 ? TrendingUp : TrendingDown}
          color={stats.growth30d >= 0 ? "success" : "destructive"}
          sub="nuevas orgs vs 30d previos" />
        <KPICard label="Conversión trial" value={`${stats.trialConversion}%`} icon={TrendingUp}
          color={stats.trialConversion >= 50 ? "success" : "warning"}
          sub={`ARPU: $${stats.arpu} · Churn: ${stats.churnRate}%`} />
      </div>

      {/* KPIs — Row 2: Health status */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label="Activos" value={stats.active} icon={CheckCircle2} color="success" sub="pagos al día" />
        <KPICard label="En trial" value={stats.trialing} icon={Zap} color="blue" sub="períodos de prueba" />
        <KPICard label="Pago pendiente" value={stats.past_due} icon={Clock} color="warning" sub="requieren acción" />
        <KPICard label="Cancelados" value={stats.canceled} icon={XCircle} color="destructive" sub="bajas confirmadas" />
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="bg-muted/50 flex-wrap">
          <TabsTrigger value="overview" className="gap-2"><Activity className="w-3.5 h-3.5" /> Resumen</TabsTrigger>
          <TabsTrigger value="orgs" className="gap-2"><Building2 className="w-3.5 h-3.5" /> Orgs ({orgs.length})</TabsTrigger>
          <TabsTrigger value="users" className="gap-2"><Users className="w-3.5 h-3.5" /> Usuarios</TabsTrigger>
          <TabsTrigger value="plans" className="gap-2"><DollarSign className="w-3.5 h-3.5" /> Planes</TabsTrigger>
          <TabsTrigger value="support" className="gap-2"><Headphones className="w-3.5 h-3.5" /> Soporte</TabsTrigger>
          <TabsTrigger value="system" className="gap-2"><Server className="w-3.5 h-3.5" /> Sistema</TabsTrigger>
        </TabsList>

        {/* ── OVERVIEW TAB ── */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          {/* Health + Revenue breakdown */}
          <div className="grid gap-4 lg:grid-cols-5">
            {/* Subscription health */}
            <div className="bg-card border border-border/60 rounded-[10px] p-4 space-y-3 lg:col-span-2">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm">Salud de suscripciones</h3>
              </div>
              <div className="space-y-2.5">
                {[
                  { label: 'Activos',          value: stats.active,   color: 'bg-emerald-500', textColor: 'text-emerald-400' },
                  { label: 'En trial',         value: stats.trialing, color: 'bg-blue-500',    textColor: 'text-blue-400'    },
                  { label: 'Pago pendiente',   value: stats.past_due, color: 'bg-yellow-500',  textColor: 'text-yellow-400'  },
                  { label: 'Cancelados',       value: stats.canceled, color: 'bg-red-500',     textColor: 'text-red-400'     },
                ].map(({ label, value, color, textColor }) => {
                  const pct = stats.orgs > 0 ? Math.round((value / stats.orgs) * 100) : 0;
                  return (
                    <div key={label} className="space-y-1 pb-12">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{label}</span>
                        <span className={`font-semibold ${textColor}`}>
                          {value} <span className="font-normal text-muted-foreground">({pct}%)</span>
                        </span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="pt-2 border-t border-border grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-xs font-mono font-bold">{stats.churnRate}%</p>
                  <p className="text-[10px] text-muted-foreground">Churn</p>
                </div>
                <div className="border-x border-border">
                  <p className="text-xs font-mono font-bold">{stats.trialConversion}%</p>
                  <p className="text-[10px] text-muted-foreground">Conv. trial</p>
                </div>
                <div>
                  <p className="text-xs font-mono font-bold">${stats.arpu}</p>
                  <p className="text-[10px] text-muted-foreground">ARPU</p>
                </div>
              </div>
            </div>

            {/* Plan revenue breakdown */}
            <div className="bg-card border border-border/60 rounded-[10px] p-4 space-y-3 lg:col-span-3">
              <div className="flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm flex-1">Revenue por plan</h3>
                <span className="text-xs text-muted-foreground">
                  MRR: <span className="font-mono font-bold text-foreground">${stats.mrr.toLocaleString()}</span>
                </span>
              </div>
              {plans.filter(p => p.price_usd_monthly > 0).length === 0 ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-2.5">
                  {plans.filter(p => p.price_usd_monthly > 0).map(p => {
                    const planOrgs = orgs.filter(o => o.plan_id === p.id && o.status === 'active');
                    const planMrr = planOrgs.length * p.price_usd_monthly;
                    const pct = stats.mrr > 0 ? Math.round((planMrr / stats.mrr) * 100) : 0;
                    return (
                      <div key={p.id} className="flex items-center gap-3">
                        <div className="w-28 shrink-0">
                          <p className="text-xs font-medium truncate">{p.name}</p>
                          <p className="text-[10px] text-muted-foreground">{planOrgs.length} org{planOrgs.length !== 1 ? 's' : ''} activas</p>
                        </div>
                        <div className="flex-1 h-2 rounded-full bg-muted/40 overflow-hidden">
                          <div className="h-full bg-primary/70 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs font-mono font-medium w-24 text-right shrink-0">
                          ${planMrr.toLocaleString()}<span className="text-muted-foreground font-normal">/mo</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="pt-2 border-t border-border flex items-center justify-between text-xs">
                <span className="text-muted-foreground">ARR estimado</span>
                <span className="font-mono font-bold">${stats.arr.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Recent orgs */}
          <div className="bg-card border border-border/60 rounded-[10px] overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h3 className="font-semibold text-sm">Organizaciones recientes</h3>
              <button
                onClick={() => setTab('orgs')}
                className="text-xs text-primary hover:underline flex items-center gap-1"
              >
                Ver todas <ChevronRight className="w-3 h-3" />
              </button>
            </div>
            {loadingOrgs ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : orgs.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">No hay organizaciones aún</div>
            ) : (
              orgs.slice(0, 8).map(r => {
                const sc = STATUS_CONFIG[r.status] || STATUS_CONFIG.paused;
                const Icon = sc.icon;
                return (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-3 border-b border-border/50 hover:bg-muted/20 last:border-0 transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{r.name}</p>
                      <p className="text-xs text-muted-foreground">/{r.slug} · {r.member_count} usuario{r.member_count !== 1 ? 's' : ''}</p>
                    </div>
                    <div className="text-right shrink-0 hidden sm:block">
                      <p className="text-xs font-mono">{r.status === 'active' && r.plan_price > 0 ? `$${r.plan_price}/mo` : '—'}</p>
                      <p className="text-[10px] text-muted-foreground truncate max-w-[80px]">{r.plan_name}</p>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border shrink-0 ${sc.color}`}>
                      <Icon className="w-3 h-3" />{sc.label}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0 hidden lg:block">{fmt(r.created_at)}</span>
                  </div>
                );
              })
            )}
          </div>
        </TabsContent>

        {/* ── ORGS TAB ── */}
        <TabsContent value="orgs" className="mt-4">
          <div className="bg-card border border-border/60 rounded-[10px] overflow-hidden">
            <div className="p-4 border-b border-border flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                <h2 className="font-semibold flex-1 text-sm">Organizaciones ({filteredOrgs.length})</h2>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <div className="relative flex-1 sm:w-64">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input value={orgSearch} onChange={e => setOrgSearch(e.target.value)} placeholder="Buscar..." className="pl-8 h-8 text-sm bg-muted" />
                  </div>
                  <select value={orgSort} onChange={e => setOrgSort(e.target.value as typeof orgSort)}
                    className="h-8 text-xs bg-muted border border-border rounded-md px-2 text-foreground">
                    <option value="created">Más nuevas</option>
                    <option value="name">Nombre</option>
                    <option value="status">Estado</option>
                    <option value="plan">Plan</option>
                  </select>
                  <Button size="sm" variant="outline" className="h-8" onClick={exportOrgsCSV} title="Exportar CSV">
                    <FileDown className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline ml-1.5">CSV</span>
                  </Button>
                  <Button size="sm" className="h-8" onClick={() => setCreateOrgDialog(true)}>
                    <UserPlus className="w-3.5 h-3.5 sm:mr-1.5" />
                    <span className="hidden sm:inline">Nueva org</span>
                  </Button>
                </div>
              </div>
              {/* Status filter chips */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {[
                  { key: 'all',      label: 'Todas',        count: orgs.length },
                  { key: 'active',   label: 'Activas',      count: orgs.filter(o => o.status === 'active').length },
                  { key: 'trialing', label: 'Trial',        count: orgs.filter(o => o.status === 'trialing').length },
                  { key: 'past_due', label: 'Pago pend.',   count: orgs.filter(o => o.status === 'past_due').length },
                  { key: 'canceled', label: 'Canceladas',   count: orgs.filter(o => o.status === 'canceled').length },
                  { key: 'paused',   label: 'Pausadas',     count: orgs.filter(o => o.status === 'paused').length },
                ].filter(f => f.key === 'all' || f.count > 0).map(f => (
                  <button
                    key={f.key}
                    onClick={() => setOrgStatusFilter(f.key)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${
                      orgStatusFilter === f.key
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted/30 text-muted-foreground border-border/40 hover:bg-muted/50'
                    }`}
                  >
                    {f.label}
                    <span className={`${orgStatusFilter === f.key ? 'opacity-75' : 'opacity-60'}`}>{f.count}</span>
                  </button>
                ))}
              </div>
            </div>
            {/* Mobile: card list */}
            <div className="md:hidden divide-y divide-border">
              {loadingOrgs
                ? <div className="text-center p-6 text-muted-foreground text-sm">Cargando...</div>
                : filteredOrgs.length === 0
                ? <div className="text-center p-6 text-muted-foreground text-sm">Sin resultados</div>
                : filteredOrgs.map(r => {
                    const sc = STATUS_CONFIG[r.status] || STATUS_CONFIG.paused;
                    const Icon = sc.icon;
                    const trialExpired = r.trial_ends_at && new Date(r.trial_ends_at) < new Date();
                    return (
                      <div key={r.id} className="p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium truncate">{r.name}</p>
                            <p className="text-xs text-muted-foreground truncate">/{r.slug} · {r.member_count} usuarios</p>
                          </div>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border shrink-0 ${sc.color}`}>
                            <Icon className="w-2.5 h-2.5" />{sc.label}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>{r.plan_name} {r.status === 'active' && r.plan_price > 0 ? `· $${r.plan_price}/mo` : ''}</span>
                          {r.trial_ends_at && (
                            <span className={trialExpired ? 'text-destructive' : ''}>
                              Trial: {fmt(r.trial_ends_at)}
                            </span>
                          )}
                        </div>
                        <div className="flex gap-1 pt-1">
                          <Button variant="outline" size="sm" className="h-7 px-2 flex-1 text-xs"
                            onClick={() => { setExtendDialog({ open: true, org: r }); setExtendDays('7'); }}>
                            <CalendarDays className="w-3 h-3 mr-1" />Trial
                          </Button>
                          <Button variant="outline" size="sm" className="h-7 px-2 flex-1 text-xs"
                            onClick={() => { setPlanDialog({ open: true, org: r }); setPlanDialogPlanId(r.plan_id || ''); }}>
                            <ChevronRight className="w-3 h-3 mr-1" />Plan
                          </Button>
                          <Button variant="outline" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                            onClick={() => { setDeleteDialog({ open: true, org: r }); setDeleteConfirm(''); }}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
            </div>

            {/* Desktop: table */}
            <div className="overflow-x-auto hidden md:block">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-3">Organización</th>
                    <th className="text-left px-4 py-3">Plan</th>
                    <th className="text-left px-4 py-3">Estado</th>
                    <th className="text-right px-4 py-3">MRR</th>
                    <th className="text-right px-4 py-3 hidden md:table-cell">Usuarios</th>
                    <th className="text-left px-4 py-3 hidden lg:table-cell">Creada</th>
                    <th className="text-left px-4 py-3 hidden lg:table-cell">Trial</th>
                    <th className="text-right px-4 py-3">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loadingOrgs
                    ? <tr><td colSpan={8} className="text-center p-8 text-muted-foreground">Cargando...</td></tr>
                    : filteredOrgs.length === 0
                    ? <tr><td colSpan={8} className="text-center p-8 text-muted-foreground">Sin resultados</td></tr>
                    : filteredOrgs.map(r => {
                        const sc = STATUS_CONFIG[r.status] || STATUS_CONFIG.paused;
                        const Icon = sc.icon;
                        const trialExpired = r.trial_ends_at && new Date(r.trial_ends_at) < new Date();
                        return (
                          <tr key={r.id} className="hover:bg-muted/20 transition-colors">
                            <td className="px-4 py-3">
                              <div className="font-medium">{r.name}</div>
                              <div className="text-xs text-muted-foreground">/{r.slug}</div>
                            </td>
                            <td className="px-4 py-3 text-muted-foreground text-xs">{r.plan_name}</td>
                            <td className="px-4 py-3">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${sc.color}`}>
                                <Icon className="w-3 h-3" />{sc.label}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right font-mono text-xs">
                              {r.status === 'active' ? `$${r.plan_price}` : '—'}
                            </td>
                            <td className="px-4 py-3 text-right hidden md:table-cell">{r.member_count}</td>
                            <td className="px-4 py-3 text-muted-foreground text-xs hidden lg:table-cell">{fmt(r.created_at)}</td>
                            <td className="px-4 py-3 text-xs hidden lg:table-cell">
                              {r.trial_ends_at
                                ? <span className={trialExpired ? 'text-destructive' : 'text-muted-foreground'}>
                                    {fmt(r.trial_ends_at)}{trialExpired ? ' ✗' : ''}
                                  </span>
                                : <span className="text-muted-foreground/40">—</span>}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" title="Extender trial"
                                  onClick={() => { setExtendDialog({ open: true, org: r }); setExtendDays('7'); }}>
                                  <CalendarDays className="w-3.5 h-3.5" />
                                </Button>
                                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" title="Cambiar plan"
                                  onClick={() => { setPlanDialog({ open: true, org: r }); setPlanDialogPlanId(r.plan_id || ''); }}>
                                  <ChevronRight className="w-3.5 h-3.5" />
                                </Button>
                                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-destructive hover:text-destructive" title="Eliminar org"
                                  onClick={() => { setDeleteDialog({ open: true, org: r }); setDeleteConfirm(''); }}>
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* ── USERS TAB ── */}
        <TabsContent value="users" className="mt-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input value={userSearch} onChange={e => setUserSearch(e.target.value)} placeholder="Buscar por email o nombre..." className="pl-8 h-8 text-sm bg-muted" />
            </div>
            <Button variant="outline" size="sm" onClick={loadUsers} disabled={loadingUsers}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loadingUsers ? 'animate-spin' : ''}`} /> Recargar
            </Button>
          </div>
          <div className="bg-card border border-border/60 rounded-[10px] overflow-hidden">
            {/* Mobile: card list */}
            <div className="sm:hidden divide-y divide-border">
              {loadingUsers
                ? <div className="text-center p-6 text-muted-foreground text-sm">Cargando usuarios...</div>
                : filteredUsers.length === 0
                ? <div className="text-center p-6 text-muted-foreground text-sm">Sin usuarios</div>
                : filteredUsers.map(u => (
                  <div key={u.id} className={`p-3 space-y-2 ${u.banned ? 'opacity-60' : ''}`}>
                    <div className="flex items-start gap-2">
                      <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                        {(u.name || u.email).charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm leading-tight truncate">{u.name || '(sin nombre)'}</p>
                        <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                        {u.memberships.length > 0 && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {u.memberships.slice(0, 2).map(m => `${m.orgName} (${m.role})`).join(', ')}
                            {u.memberships.length > 2 && ` +${u.memberships.length - 2}`}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {u.banned && <Ban className="w-3.5 h-3.5 text-destructive" />}
                        {u.isPlatformAdmin && <Crown className="w-3.5 h-3.5 text-primary" />}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 items-center text-[10px]">
                      <label className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/30">
                        <Switch checked={u.banned} onCheckedChange={() => handleToggleBan(u)} className="data-[state=checked]:bg-destructive scale-75" />
                        Banear
                      </label>
                      <label className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/30">
                        <Switch checked={u.isPlatformAdmin || false} onCheckedChange={() => handleTogglePlatformAdmin(u)} className="data-[state=checked]:bg-primary scale-75" />
                        Admin
                      </label>
                      <Button variant="outline" size="sm" className="h-6 px-1.5 text-[10px]" onClick={() => handleResetPassword(u)}>
                        <KeyRound className="w-2.5 h-2.5 mr-1" /> Reset
                      </Button>
                      <Button variant="outline" size="sm" className="h-6 px-1.5 text-[10px]" onClick={() => handleGenerateMagicLink(u)}>
                        <Link2 className="w-2.5 h-2.5 mr-1" /> Link
                      </Button>
                    </div>
                  </div>
                ))}
            </div>

            {/* Desktop: table */}
            <div className="overflow-x-auto hidden sm:block">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-3">Usuario</th>
                    <th className="text-left px-4 py-3 hidden md:table-cell">Organizaciones</th>
                    <th className="text-left px-4 py-3 hidden lg:table-cell">Último acceso</th>
                    <th className="text-center px-4 py-3">Baneado</th>
                    <th className="text-center px-4 py-3">Platform Admin</th>
                    <th className="text-right px-4 py-3">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loadingUsers
                    ? <tr><td colSpan={6} className="text-center p-8 text-muted-foreground">Cargando usuarios...</td></tr>
                    : filteredUsers.length === 0
                    ? <tr><td colSpan={6} className="text-center p-8 text-muted-foreground">Sin usuarios</td></tr>
                    : filteredUsers.map(u => (
                      <tr key={u.id} className={`hover:bg-muted/20 transition-colors ${u.banned ? 'opacity-60' : ''}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                              {(u.name || u.email).charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-medium text-sm leading-tight">{u.name || '(sin nombre)'}</p>
                              <p className="text-xs text-muted-foreground">{u.email}</p>
                            </div>
                            {u.banned && <Ban className="w-3.5 h-3.5 text-destructive" />}
                            {u.isPlatformAdmin && <Crown className="w-3.5 h-3.5 text-primary" />}
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <div className="flex flex-wrap gap-1">
                            {u.memberships.length === 0
                              ? <span className="text-xs text-muted-foreground/40">Sin org</span>
                              : u.memberships.slice(0, 2).map((m, i) => (
                                <span key={i} className="text-xs bg-muted px-1.5 py-0.5 rounded-md text-muted-foreground">
                                  {m.orgName} ({m.role})
                                </span>
                              ))}
                            {u.memberships.length > 2 && <span className="text-xs text-muted-foreground">+{u.memberships.length - 2}</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell">
                          {fmtFull(u.lastSignIn)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Switch
                            checked={u.banned}
                            onCheckedChange={() => handleToggleBan(u)}
                            className="data-[state=checked]:bg-destructive"
                          />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Switch
                            checked={u.isPlatformAdmin || false}
                            onCheckedChange={() => handleTogglePlatformAdmin(u)}
                            className="data-[state=checked]:bg-primary"
                          />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost" size="sm" className="h-7 w-7 p-0"
                              title="Enviar email de reset de contraseña"
                              onClick={() => handleResetPassword(u)}
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost" size="sm" className="h-7 w-7 p-0"
                              title="Generar magic link (copia al portapapeles)"
                              onClick={() => handleGenerateMagicLink(u)}
                            >
                              <Link2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* ── PLANS TAB ── */}
        <TabsContent value="plans" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {loadingPlans
              ? <div className="col-span-3 text-center p-8 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />Cargando planes...
                </div>
              : plans.map((p, idx) => {
                  const planOrgs = orgs.filter(o => o.plan_id === p.id);
                  const activeOrgs = planOrgs.filter(o => o.status === 'active');
                  const planMrr = activeOrgs.length * p.price_usd_monthly;
                  const tierColors = [
                    'from-muted/20 to-muted/5 border-border/60',
                    'from-blue-500/10 to-blue-500/5 border-blue-500/20',
                    'from-purple-500/10 to-purple-500/5 border-purple-500/20',
                    'from-amber-500/10 to-amber-500/5 border-amber-500/20',
                  ];
                  const gradient = tierColors[idx % tierColors.length];
                  return (
                    <div key={p.id} className={`bg-gradient-to-br ${gradient} border rounded-[10px] p-5 space-y-4`}>
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2 mb-0.5">
                            <h3 className="font-display font-bold text-lg">{p.name}</h3>
                            {p.price_usd_monthly === 0 && (
                              <Badge variant="outline" className="text-[10px] text-muted-foreground">Gratis</Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">{p.description || 'Sin descripción'}</p>
                        </div>
                        <Button variant="outline" size="sm" className="shrink-0" onClick={() => { setEditPlanDialog({ open: true, plan: p }); setEditPlanForm({ ...p }); }}>
                          <Edit2 className="w-3.5 h-3.5 mr-1.5" /> Editar
                        </Button>
                      </div>

                      {/* Usage stats */}
                      <div className="grid grid-cols-3 gap-2 p-3 rounded-lg bg-background/40 border border-border/30">
                        <div className="text-center">
                          <p className="text-sm font-bold">{planOrgs.length}</p>
                          <p className="text-[10px] text-muted-foreground">Total orgs</p>
                        </div>
                        <div className="text-center border-x border-border/30">
                          <p className="text-sm font-bold text-emerald-400">{activeOrgs.length}</p>
                          <p className="text-[10px] text-muted-foreground">Activas</p>
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-bold font-mono">${planMrr.toLocaleString()}</p>
                          <p className="text-[10px] text-muted-foreground">MRR</p>
                        </div>
                      </div>

                      <div className="space-y-1.5 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Precio mensual</span>
                          <span className="font-mono font-medium">{p.price_usd_monthly > 0 ? `$${p.price_usd_monthly}/mo` : 'Gratis'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Precio anual</span>
                          <span className="font-mono font-medium">{p.price_usd_yearly > 0 ? `$${p.price_usd_yearly}/yr` : '—'}</span>
                        </div>
                        <div className="border-t border-border/50 my-2" />
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Productos</span>
                          <span>{p.max_products ?? '∞'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Ventas/mes</span>
                          <span>{p.max_sales_per_month ?? '∞'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Usuarios</span>
                          <span>{p.max_users ?? '∞'}</span>
                        </div>
                        <div className="border-t border-border/50 my-2" />
                        <div className="flex gap-2 flex-wrap">
                          {p.ai_enabled && <Badge variant="outline" className="text-xs text-primary border-primary/30">IA</Badge>}
                          {p.backups_enabled && <Badge variant="outline" className="text-xs">Backups</Badge>}
                          {p.custom_branding && <Badge variant="outline" className="text-xs">Branding</Badge>}
                        </div>
                      </div>
                    </div>
                  );
                })}
          </div>
        </TabsContent>

        {/* ── SUPPORT TAB ── */}
        <TabsContent value="support" className="mt-4 space-y-5">
          <div className="grid gap-5 lg:grid-cols-2">

            {/* Org lookup */}
            <div className="bg-card border border-border/60 rounded-[10px] overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <Building2 className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-sm flex-1">Buscar organización</h3>
              </div>
              <div className="p-4 space-y-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    value={supportOrgSearch}
                    onChange={e => setSupportOrgSearch(e.target.value)}
                    placeholder="Nombre o slug..."
                    className="pl-8 h-8 text-sm bg-muted"
                  />
                </div>
                <div className="space-y-1 max-h-52 overflow-y-auto">
                  {supportFilteredOrgs.map(org => {
                    const sc = STATUS_CONFIG[org.status] || STATUS_CONFIG.paused;
                    const Icon = sc.icon;
                    return (
                      <button
                        key={org.id}
                        onClick={() => { setSelectedOrg(org); loadOrgActivity(org.id); loadOrgMembers(org.id); }}
                        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors hover:bg-muted/40 ${selectedOrg?.id === org.id ? 'bg-muted/60' : ''}`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{org.name}</p>
                          <p className="text-xs text-muted-foreground">/{org.slug} · {org.member_count} users</p>
                        </div>
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium border shrink-0 ${sc.color}`}>
                          <Icon className="w-2.5 h-2.5" />{sc.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Org detail */}
              {selectedOrg && (
                <div className="border-t border-border p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-sm">{selectedOrg.name}</h4>
                    <div className="flex gap-2">
                      {selectedOrg.status === 'paused' ? (
                        <Button size="sm" variant="outline" className="h-7 text-xs border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
                          onClick={() => handleReactivateOrg(selectedOrg)}
                          disabled={suspendingOrgId === selectedOrg.id}>
                          <Play className={`w-3 h-3 mr-1 ${suspendingOrgId === selectedOrg.id ? 'animate-spin' : ''}`} />
                          {suspendingOrgId === selectedOrg.id ? '...' : 'Reactivar'}
                        </Button>
                      ) : (
                        <Button size="sm" variant="outline" className="h-7 text-xs border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10"
                          onClick={() => handleSuspendOrg(selectedOrg)}
                          disabled={suspendingOrgId === selectedOrg.id}>
                          <Pause className={`w-3 h-3 mr-1 ${suspendingOrgId === selectedOrg.id ? 'animate-spin' : ''}`} />
                          {suspendingOrgId === selectedOrg.id ? '...' : 'Suspender'}
                        </Button>
                      )}
                    </div>
                  </div>
                  {loadingActivity ? (
                    <div className="text-xs text-muted-foreground">Cargando actividad...</div>
                  ) : orgActivity ? (
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { l: 'Ventas total', v: orgActivity.totalSales ?? '—', icon: ShoppingCart },
                        { l: 'Productos', v: orgActivity.totalProducts ?? '—', icon: Package },
                        { l: 'Deudas pend.', v: orgActivity.totalDebts ?? '—', icon: AlertTriangle },
                      ].map(s => (
                        <div key={s.l} className="bg-muted/30 rounded-lg p-2 text-center">
                          <s.icon className="w-3.5 h-3.5 mx-auto mb-1 text-muted-foreground" />
                          <p className="text-sm font-bold">{s.v}</p>
                          <p className="text-[10px] text-muted-foreground">{s.l}</p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {orgActivity?.recentSales?.length > 0 && (
                    <div className="space-y-1 pb-12">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Últimas ventas</p>
                      {orgActivity.recentSales.map((s: any) => (
                        <div key={s.id} className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground truncate flex-1">{s.product_name || 'Venta'}</span>
                          <span className="font-mono ml-2 shrink-0">${Number(s.total_ars || 0).toLocaleString('es-AR')}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Members & roles */}
                  <div className="space-y-2 pt-2 border-t border-border">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                        Miembros ({orgMembers.length})
                      </p>
                      {loadingMembers && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                    </div>
                    <div className="space-y-1 pb-12">
                      {orgMembers.map(m => (
                        <div key={m.user_id} className="flex items-center gap-2 text-xs p-2 rounded-lg bg-muted/20">
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{m.name || m.email.split('@')[0]}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{m.email}</p>
                          </div>
                          <Select
                            value={m.role}
                            onValueChange={(v) => handleUpdateMemberRole(selectedOrg.id, m.user_id, v)}
                          >
                            <SelectTrigger className="h-7 w-24 text-[10px] shrink-0">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="owner">Owner</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="vendedor">Vendedor</SelectItem>
                              <SelectItem value="viewer">Viewer</SelectItem>
                            </SelectContent>
                          </Select>
                          {m.role !== 'owner' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-destructive hover:text-destructive shrink-0"
                              onClick={() => handleRemoveMember(selectedOrg.id, m.user_id, m.email)}
                              title="Remover de la org"
                            >
                              <UserX className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      ))}
                      {!loadingMembers && orgMembers.length === 0 && (
                        <p className="text-xs text-muted-foreground italic">Sin miembros registrados</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Admin audit log */}
            <div className="bg-card border border-border/60 rounded-[10px] overflow-hidden">
              <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-primary" />
                  <h3 className="font-semibold text-sm">Acciones de admins</h3>
                </div>
                <Button variant="ghost" size="sm" className="h-7 px-2" onClick={loadAdminLogs} disabled={loadingLogs}>
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingLogs ? 'animate-spin' : ''}`} />
                </Button>
              </div>
              <div className="overflow-y-auto max-h-[400px] divide-y divide-border">
                {loadingLogs ? (
                  <div className="p-6 text-center text-muted-foreground text-sm">Cargando...</div>
                ) : adminLogs.length === 0 ? (
                  <div className="p-6 text-center text-muted-foreground text-sm">Sin acciones registradas aún</div>
                ) : adminLogs.map(log => (
                  <div key={log.id} className="px-4 py-2.5 flex items-start gap-2 hover:bg-muted/10">
                    <Shield className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">
                        {ACTION_LABELS[log.action] || log.action}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {log.admin_email || 'Admin desconocido'}
                      </p>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {fmtFull(log.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── SYSTEM TAB ── */}
        <TabsContent value="system" className="mt-4">
          <SystemHealthTab />
        </TabsContent>
      </Tabs>

      {/* ── CREATE ORG DIALOG ── */}
      <Dialog
        open={createOrgDialog}
        onOpenChange={(open) => {
          setCreateOrgDialog(open);
          if (!open) {
            setCreatedInviteLink(null);
            setNewOrgForm({ name: '', ownerEmail: '', ownerName: '', planId: '', trialDays: '14', sendInvite: true });
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-primary" /> Crear organización
            </DialogTitle>
          </DialogHeader>

          {createdInviteLink ? (
            <div className="space-y-4 py-2">
              <div className="flex items-start gap-3 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-green-400">Organización creada</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Enviale este link al cliente para que entre y configure su cuenta. Es de un solo uso.
                  </p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Link de invitación / acceso</Label>
                <div className="flex gap-2">
                  <Input value={createdInviteLink} readOnly className="font-mono text-[10px] h-9" />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(createdInviteLink);
                      toast.success('Copiado');
                    }}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => setCreateOrgDialog(false)}>Cerrar</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label>Nombre del negocio</Label>
                <Input
                  value={newOrgForm.name}
                  onChange={(e) => setNewOrgForm({ ...newOrgForm, name: e.target.value })}
                  placeholder="Perfumería Andrea"
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Email del owner</Label>
                <Input
                  type="email"
                  value={newOrgForm.ownerEmail}
                  onChange={(e) => setNewOrgForm({ ...newOrgForm, ownerEmail: e.target.value })}
                  placeholder="cliente@ejemplo.com"
                  className="h-9"
                />
                <p className="text-[10px] text-muted-foreground">
                  Si ya existe, se le crea solo la org. Si no, se crea el usuario también.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Nombre del owner (opcional)</Label>
                <Input
                  value={newOrgForm.ownerName}
                  onChange={(e) => setNewOrgForm({ ...newOrgForm, ownerName: e.target.value })}
                  placeholder="Andrea Pérez"
                  className="h-9"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Plan inicial</Label>
                  <Select
                    value={newOrgForm.planId || '__default__'}
                    onValueChange={(v) => setNewOrgForm({ ...newOrgForm, planId: v === '__default__' ? '' : v })}
                  >
                    <SelectTrigger className="h-9"><SelectValue placeholder="Por defecto (trial)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">Por defecto (trial)</SelectItem>
                      {plans.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} {p.price_usd_monthly > 0 ? `($${p.price_usd_monthly}/mo)` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Días de trial</Label>
                  <Input
                    type="number"
                    min="0"
                    max="365"
                    value={newOrgForm.trialDays}
                    onChange={(e) => setNewOrgForm({ ...newOrgForm, trialDays: e.target.value })}
                    className="h-9"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between pt-2">
                <div>
                  <Label className="font-normal">Generar magic link al crear</Label>
                  <p className="text-[10px] text-muted-foreground">Recibís un link para enviarle al cliente</p>
                </div>
                <Switch
                  checked={newOrgForm.sendInvite}
                  onCheckedChange={(v) => setNewOrgForm({ ...newOrgForm, sendInvite: v })}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOrgDialog(false)}>Cancelar</Button>
                <Button onClick={handleCreateOrg} disabled={saving}>
                  {saving ? 'Creando...' : 'Crear organización'}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── EXTEND TRIAL DIALOG ── */}
      <Dialog open={extendDialog.open} onOpenChange={open => setExtendDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Extender trial</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Org: <span className="font-medium text-foreground">{extendDialog.org?.name}</span>
            </p>
            {extendDialog.org?.trial_ends_at && (
              <p className="text-sm text-muted-foreground">
                Trial actual: <span className="font-medium">{fmt(extendDialog.org.trial_ends_at)}</span>
              </p>
            )}
            <div className="space-y-1.5">
              <Label>Días a agregar</Label>
              <Input
                type="number" min="1" max="365"
                value={extendDays}
                onChange={e => setExtendDays(e.target.value)}
                className="h-9"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendDialog({ open: false, org: null })}>Cancelar</Button>
            <Button onClick={handleExtendTrial} disabled={saving}>
              {saving ? 'Guardando...' : 'Extender'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── CHANGE PLAN DIALOG ── */}
      <Dialog open={planDialog.open} onOpenChange={open => setPlanDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cambiar plan</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Org: <span className="font-medium text-foreground">{planDialog.org?.name}</span>
            </p>
            <div className="space-y-1.5">
              <Label>Plan</Label>
              <Select value={planDialogPlanId} onValueChange={setPlanDialogPlanId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Seleccionar plan" />
                </SelectTrigger>
                <SelectContent>
                  {plans.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} — ${p.price_usd_monthly}/mo
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanDialog({ open: false, org: null })}>Cancelar</Button>
            <Button onClick={handleChangePlan} disabled={saving || !planDialogPlanId}>
              {saving ? 'Guardando...' : 'Guardar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── DELETE ORG DIALOG ── */}
      <Dialog open={deleteDialog.open} onOpenChange={open => { setDeleteDialog(prev => ({ ...prev, open })); setDeleteConfirm(''); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-destructive flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Eliminar organización
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Esta acción es <strong>irreversible</strong>. Se eliminarán todos los datos de{' '}
              <strong className="text-foreground">{deleteDialog.org?.name}</strong>.
            </p>
            <div className="space-y-1.5">
              <Label>Escribí el nombre de la org para confirmar</Label>
              <Input
                value={deleteConfirm}
                onChange={e => setDeleteConfirm(e.target.value)}
                placeholder={deleteDialog.org?.name}
                className="h-9"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog({ open: false, org: null })}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDeleteOrg}
              disabled={saving || deleteConfirm !== deleteDialog.org?.name}>
              {saving ? 'Eliminando...' : 'Eliminar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── EDIT PLAN DIALOG ── */}
      <Dialog open={editPlanDialog.open} onOpenChange={open => setEditPlanDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar plan: {editPlanDialog.plan?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Nombre</Label>
                <Input value={editPlanForm.name || ''} onChange={e => setEditPlanForm(p => ({ ...p, name: e.target.value }))} className="h-9" />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Descripción</Label>
                <Input value={editPlanForm.description || ''} onChange={e => setEditPlanForm(p => ({ ...p, description: e.target.value }))} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label>Precio mensual (USD)</Label>
                <Input type="number" min="0" value={editPlanForm.price_usd_monthly ?? ''} onChange={e => setEditPlanForm(p => ({ ...p, price_usd_monthly: parseFloat(e.target.value) || 0 }))} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label>Precio anual (USD)</Label>
                <Input type="number" min="0" value={editPlanForm.price_usd_yearly ?? ''} onChange={e => setEditPlanForm(p => ({ ...p, price_usd_yearly: parseFloat(e.target.value) || 0 }))} className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label>Máx. productos (vacío = ilimitado)</Label>
                <Input type="number" min="0" value={editPlanForm.max_products ?? ''} onChange={e => setEditPlanForm(p => ({ ...p, max_products: e.target.value ? parseInt(e.target.value) : null }))} className="h-9" placeholder="∞" />
              </div>
              <div className="space-y-1.5">
                <Label>Máx. ventas/mes</Label>
                <Input type="number" min="0" value={editPlanForm.max_sales_per_month ?? ''} onChange={e => setEditPlanForm(p => ({ ...p, max_sales_per_month: e.target.value ? parseInt(e.target.value) : null }))} className="h-9" placeholder="∞" />
              </div>
              <div className="space-y-1.5">
                <Label>Máx. usuarios</Label>
                <Input type="number" min="0" value={editPlanForm.max_users ?? ''} onChange={e => setEditPlanForm(p => ({ ...p, max_users: e.target.value ? parseInt(e.target.value) : null }))} className="h-9" placeholder="∞" />
              </div>
              <div className="space-y-1.5">
                <Label>Stripe Price ID (mensual)</Label>
                <Input value={editPlanForm.stripe_price_id_monthly || ''} onChange={e => setEditPlanForm(p => ({ ...p, stripe_price_id_monthly: e.target.value || null }))} className="h-9 font-mono text-xs" placeholder="price_..." />
              </div>
              <div className="space-y-1.5">
                <Label>Stripe Price ID (anual)</Label>
                <Input value={editPlanForm.stripe_price_id_yearly || ''} onChange={e => setEditPlanForm(p => ({ ...p, stripe_price_id_yearly: e.target.value || null }))} className="h-9 font-mono text-xs" placeholder="price_..." />
              </div>
            </div>
            <div className="space-y-3 border-t border-border pt-3">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Funcionalidades</Label>
              {[
                { key: 'ai_enabled', label: 'IA Insights habilitada' },
                { key: 'backups_enabled', label: 'Backups habilitados' },
                { key: 'custom_branding', label: 'Branding personalizado' },
              ].map(f => (
                <div key={f.key} className="flex items-center justify-between">
                  <Label className="font-normal">{f.label}</Label>
                  <Switch
                    checked={!!(editPlanForm as Record<string, unknown>)[f.key]}
                    onCheckedChange={v => setEditPlanForm(p => ({ ...p, [f.key]: v }))}
                  />
                </div>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPlanDialog({ open: false, plan: null })}>Cancelar</Button>
            <Button onClick={handleSavePlan} disabled={saving}>
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
