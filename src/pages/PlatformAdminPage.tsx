import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrg } from '@/lib/orgContext';
import { Navigate } from 'react-router-dom';
import { Building2, Users, DollarSign, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  trial_ends_at: string | null;
  plan_name: string | null;
  member_count: number;
  status: string;
}

export default function PlatformAdminPage() {
  const { isPlatformAdmin, loading: orgLoading } = useOrg();
  const [rows, setRows] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ orgs: 0, users: 0, mrr: 0, active: 0 });

  useEffect(() => {
    if (!isPlatformAdmin) return;
    (async () => {
      const [{ data: orgs }, { data: subs }, { data: plans }, { count: usersCount }] = await Promise.all([
        supabase.from('organizations').select('id, name, slug, created_at, trial_ends_at, plan_id'),
        supabase.from('subscriptions').select('org_id, plan_id, status'),
        supabase.from('plans').select('id, name, price_usd_monthly'),
        supabase.from('memberships').select('user_id', { count: 'exact', head: true }),
      ]);
      const planMap = new Map((plans || []).map(p => [p.id, p]));
      const subMap = new Map((subs || []).map(s => [s.org_id, s]));
      const memCounts: Record<string, number> = {};
      const { data: mems } = await supabase.from('memberships').select('org_id');
      (mems || []).forEach(m => { memCounts[m.org_id] = (memCounts[m.org_id] || 0) + 1; });

      const enriched: OrgRow[] = (orgs || []).map(o => {
        const sub = subMap.get(o.id);
        const plan = sub ? planMap.get(sub.plan_id) : (o.plan_id ? planMap.get(o.plan_id) : null);
        return {
          id: o.id, name: o.name, slug: o.slug, created_at: o.created_at, trial_ends_at: o.trial_ends_at,
          plan_name: plan?.name || '—',
          member_count: memCounts[o.id] || 0,
          status: sub?.status || 'trialing',
        };
      });
      setRows(enriched);

      const mrr = (subs || []).filter(s => s.status === 'active').reduce((acc, s) => {
        const p = planMap.get(s.plan_id);
        return acc + (p?.price_usd_monthly || 0);
      }, 0);
      setStats({
        orgs: enriched.length,
        users: usersCount || 0,
        mrr,
        active: (subs || []).filter(s => s.status === 'active').length,
      });
      setLoading(false);
    })();
  }, [isPlatformAdmin]);

  if (orgLoading) return <div className="p-8">Cargando...</div>;
  if (!isPlatformAdmin) return <Navigate to="/" replace />;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold">Platform Admin</h1>
        <p className="text-sm text-muted-foreground">Vista global de la plataforma Gestiona.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { l: 'Organizaciones', v: stats.orgs, i: Building2 },
          { l: 'Usuarios totales', v: stats.users, i: Users },
          { l: 'Suscripciones activas', v: stats.active, i: TrendingUp },
          { l: 'MRR (USD)', v: `$${stats.mrr}`, i: DollarSign },
        ].map(s => (
          <div key={s.l} className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">{s.l}</span>
              <s.i className="w-4 h-4 text-primary" />
            </div>
            <div className="text-2xl font-display font-bold">{s.v}</div>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="p-5 border-b border-border">
          <h2 className="font-semibold">Organizaciones</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3">Nombre</th>
                <th className="text-left px-4 py-3">Plan</th>
                <th className="text-left px-4 py-3">Estado</th>
                <th className="text-left px-4 py-3">Miembros</th>
                <th className="text-left px-4 py-3">Creada</th>
                <th className="text-left px-4 py-3">Trial</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? <tr><td colSpan={6} className="text-center p-6 text-muted-foreground">Cargando...</td></tr>
              : rows.map(r => (
                <tr key={r.id} className="hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium">{r.name} <span className="text-xs text-muted-foreground">/{r.slug}</span></td>
                  <td className="px-4 py-3">{r.plan_name}</td>
                  <td className="px-4 py-3"><Badge variant={r.status === 'active' ? 'default' : 'outline'}>{r.status}</Badge></td>
                  <td className="px-4 py-3">{r.member_count}</td>
                  <td className="px-4 py-3 text-muted-foreground">{new Date(r.created_at).toLocaleDateString('es-AR')}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.trial_ends_at ? new Date(r.trial_ends_at).toLocaleDateString('es-AR') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}