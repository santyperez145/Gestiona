import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrg } from '@/lib/orgContext';
import { Navigate } from 'react-router-dom';
import { Building2, Users, DollarSign, TrendingUp, TrendingDown, Search, RefreshCw, Clock, CheckCircle2, XCircle, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  trial_ends_at: string | null;
  plan_name: string | null;
  plan_price: number;
  member_count: number;
  status: string;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  active:    { label: 'Activo',    color: 'bg-green-500/15 text-green-400 border-green-500/20',  icon: CheckCircle2 },
  trialing:  { label: 'Trial',     color: 'bg-blue-500/15 text-blue-400 border-blue-500/20',     icon: Zap },
  past_due:  { label: 'Pago pend', color: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20', icon: Clock },
  canceled:  { label: 'Cancelado', color: 'bg-red-500/15 text-red-400 border-red-500/20',        icon: XCircle },
  paused:    { label: 'Pausado',   color: 'bg-muted text-muted-foreground border-border',         icon: Clock },
};

export default function PlatformAdminPage() {
  const { isPlatformAdmin, loading: orgLoading } = useOrg();
  const [rows, setRows] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'created' | 'name' | 'status' | 'plan'>('created');
  const [stats, setStats] = useState({
    orgs: 0, users: 0, mrr: 0, arr: 0,
    active: 0, trialing: 0, canceled: 0, past_due: 0,
    trialConversion: 0,
  });

  const load = async () => {
    if (!isPlatformAdmin) return;
    setLoading(true);
    const [{ data: orgs }, { data: subs }, { data: plans }, { count: usersCount }] = await Promise.all([
      supabase.from('organizations').select('id, name, slug, created_at, trial_ends_at, plan_id').order('created_at', { ascending: false }),
      supabase.from('subscriptions').select('org_id, plan_id, status'),
      supabase.from('plans').select('id, name, price_usd_monthly'),
      supabase.from('memberships').select('user_id', { count: 'exact', head: true }),
    ]);

    const planMap = new Map((plans || []).map(p => [p.id, p]));
    const subMap = new Map((subs || []).map(s => [s.org_id, s]));
    const { data: mems } = await supabase.from('memberships').select('org_id');
    const memCounts: Record<string, number> = {};
    (mems || []).forEach(m => { memCounts[m.org_id] = (memCounts[m.org_id] || 0) + 1; });

    const enriched: OrgRow[] = (orgs || []).map(o => {
      const sub = subMap.get(o.id);
      const plan = sub ? planMap.get(sub.plan_id) : (o.plan_id ? planMap.get(o.plan_id) : null);
      return {
        id: o.id, name: o.name, slug: o.slug,
        created_at: o.created_at, trial_ends_at: o.trial_ends_at,
        plan_name: plan?.name || '—',
        plan_price: plan?.price_usd_monthly || 0,
        member_count: memCounts[o.id] || 0,
        status: sub?.status || 'trialing',
      };
    });
    setRows(enriched);

    const activeSubs = (subs || []).filter(s => s.status === 'active');
    const mrr = activeSubs.reduce((acc, s) => acc + (planMap.get(s.plan_id)?.price_usd_monthly || 0), 0);
    const totalTrials = (subs || []).filter(s => s.status === 'trialing').length;
    const everTrialed = enriched.filter(r => r.trial_ends_at).length;
    const converted = enriched.filter(r => r.status === 'active').length;

    setStats({
      orgs: enriched.length,
      users: usersCount || 0,
      mrr,
      arr: mrr * 12,
      active: activeSubs.length,
      trialing: totalTrials,
      canceled: (subs || []).filter(s => s.status === 'canceled').length,
      past_due: (subs || []).filter(s => s.status === 'past_due').length,
      trialConversion: everTrialed > 0 ? Math.round((converted / everTrialed) * 100) : 0,
    });
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [isPlatformAdmin]);

  const filtered = useMemo(() => {
    let list = [...rows];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(r => r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q) || r.plan_name?.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name, 'es');
      if (sortBy === 'status') return a.status.localeCompare(b.status);
      if (sortBy === 'plan') return (a.plan_name || '').localeCompare(b.plan_name || '');
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    return list;
  }, [rows, search, sortBy]);

  if (orgLoading) return <div className="p-8 text-muted-foreground text-sm">Verificando permisos...</div>;
  if (!isPlatformAdmin) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">Platform Admin</h1>
          <p className="text-sm text-muted-foreground">Vista global de todos los tenants de Gestiona.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />Actualizar
        </Button>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { l: 'Organizaciones', v: stats.orgs, i: Building2, sub: `${stats.trialing} en trial` },
          { l: 'Usuarios totales', v: stats.users, i: Users, sub: `${stats.orgs} orgs` },
          { l: 'MRR', v: `$${stats.mrr.toLocaleString()}`, i: DollarSign, sub: `ARR: $${stats.arr.toLocaleString()}` },
          { l: 'Conversión trial', v: `${stats.trialConversion}%`, i: TrendingUp, sub: `${stats.active} pagos activos` },
        ].map(s => (
          <div key={s.l} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">{s.l}</span>
              <s.i className="w-4 h-4 text-primary" />
            </div>
            <div className="text-2xl font-display font-bold">{s.v}</div>
            <p className="text-xs text-muted-foreground mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Status breakdown */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { l: 'Activos', v: stats.active, color: 'text-green-400' },
          { l: 'En trial', v: stats.trialing, color: 'text-blue-400' },
          { l: 'Pago pendiente', v: stats.past_due, color: 'text-yellow-400' },
          { l: 'Cancelados', v: stats.canceled, color: 'text-red-400' },
        ].map(s => (
          <div key={s.l} className="rounded-xl border border-border bg-card/50 p-3 text-center">
            <div className={`text-2xl font-bold ${s.color}`}>{s.v}</div>
            <p className="text-xs text-muted-foreground mt-0.5">{s.l}</p>
          </div>
        ))}
      </div>

      {/* Org table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-border flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <h2 className="font-semibold flex-1">Organizaciones ({filtered.length})</h2>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar..." className="pl-8 h-8 text-sm bg-muted" />
            </div>
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value as typeof sortBy)}
              className="h-8 text-xs bg-muted border border-border rounded-md px-2 text-foreground"
            >
              <option value="created">Más nuevas</option>
              <option value="name">Nombre</option>
              <option value="status">Estado</option>
              <option value="plan">Plan</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Organización</th>
                <th className="text-left px-4 py-3">Plan</th>
                <th className="text-left px-4 py-3">Estado</th>
                <th className="text-right px-4 py-3">MRR</th>
                <th className="text-right px-4 py-3">Usuarios</th>
                <th className="text-left px-4 py-3">Creada</th>
                <th className="text-left px-4 py-3">Trial hasta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading
                ? <tr><td colSpan={7} className="text-center p-8 text-muted-foreground">Cargando...</td></tr>
                : filtered.length === 0
                ? <tr><td colSpan={7} className="text-center p-8 text-muted-foreground">Sin resultados</td></tr>
                : filtered.map(r => {
                    const sc = STATUS_CONFIG[r.status] || STATUS_CONFIG.paused;
                    const Icon = sc.icon;
                    const trialExpired = r.trial_ends_at && new Date(r.trial_ends_at) < new Date();
                    return (
                      <tr key={r.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <div className="font-medium">{r.name}</div>
                          <div className="text-xs text-muted-foreground">/{r.slug}</div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{r.plan_name}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${sc.color}`}>
                            <Icon className="w-3 h-3" />{sc.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs">
                          {r.status === 'active' ? `$${r.plan_price}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-right">{r.member_count}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{new Date(r.created_at).toLocaleDateString('es-AR')}</td>
                        <td className="px-4 py-3 text-xs">
                          {r.trial_ends_at
                            ? <span className={trialExpired ? 'text-destructive' : 'text-muted-foreground'}>
                                {new Date(r.trial_ends_at).toLocaleDateString('es-AR')}
                                {trialExpired ? ' ✗' : ''}
                              </span>
                            : <span className="text-muted-foreground/40">—</span>
                          }
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
