import { Link } from 'react-router-dom';
import { ArrowRight, ClipboardList, Gift, Plus, Target, Users, Wallet } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useOrg } from '@/lib/orgContext';
import { useModulePerms } from '@/lib/permissionsContext';
import { isActiveInfluencer, listInfluencers } from '@/lib/influencersDB';
import { useInfluencerCampaigns } from '@/hooks/useInfluencerCampaigns';
import { CAMPAIGN_STATUSES } from '@/lib/influencerCampaignsDB';
import PageHeader from '@/components/shared/PageHeader';
import WorkspaceState from '@/components/shared/WorkspaceState';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export default function InfluencerMarketingPage() {
  const { activeOrg } = useOrg();
  const { canCreate } = useModulePerms('influencers');
  const campaigns = useInfluencerCampaigns();
  const creators = useQuery({ queryKey: ['influencer-creators', activeOrg?.id], queryFn: () => listInfluencers(activeOrg!.id), enabled: Boolean(activeOrg?.id), refetchOnWindowFocus: false });
  if (campaigns.isPending || creators.isPending) return <WorkspaceState kind="initial-loading" title="Cargando Influencers" />;
  if (campaigns.isError || creators.isError) return <WorkspaceState kind="error-recoverable" title="No pudimos cargar el resumen" actionLabel="Reintentar" onAction={() => { void campaigns.refetch(); void creators.refetch(); }} />;
  const rows = campaigns.data ?? [];
  const active = rows.filter(item => item.status === 'active');
  const budget = active.reduce((sum, item) => sum + Number(item.budget_ars), 0);
  const metrics = [
    { label: 'Campañas en curso', value: active.length.toLocaleString('es-AR'), icon: Target, color: 'text-primary' },
    { label: 'Borradores', value: rows.filter(item => item.status === 'draft').length.toLocaleString('es-AR'), icon: ClipboardList, color: 'text-amber-700 dark:text-amber-300' },
    { label: 'Creadores activos', value: (creators.data ?? []).filter(item => isActiveInfluencer(item.status)).length.toLocaleString('es-AR'), icon: Users, color: 'text-teal-700 dark:text-teal-300' },
    { label: 'Presupuesto en curso', value: new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(budget), icon: Wallet, color: 'text-foreground' },
  ];
  return <div className="space-y-7">
    <PageHeader icon={Target} eyebrow="Nerqia · Influencers" title="Resumen" actions={canCreate && <Button asChild><Link to="/influencer-marketing/campanas?nueva=1"><Plus className="mr-2 h-4 w-4" />Nueva campaña</Link></Button>} />
    <dl className="grid grid-cols-1 gap-5 border-y border-border py-5 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(metric => <div key={metric.label} className="min-w-0"><dt className="flex items-center gap-2 text-xs text-muted-foreground"><metric.icon className={`h-4 w-4 ${metric.color}`} />{metric.label}</dt><dd className="mt-2 break-words text-2xl font-semibold tabular-nums">{metric.value}</dd></div>)}</dl>
    <section aria-labelledby="recent-campaigns"><div className="mb-4 flex items-center justify-between gap-3"><h2 id="recent-campaigns" className="text-base font-semibold">Campañas recientes</h2><Button asChild variant="ghost" size="sm"><Link to="/influencer-marketing/campanas">Ver todas<ArrowRight className="ml-2 h-4 w-4" /></Link></Button></div>
      {!rows.length ? <WorkspaceState kind="empty-first-use" title="Todavía no hay campañas" /> : <div className="divide-y divide-border">{rows.slice(0, 6).map(item => <Link key={item.id} to={`/influencer-marketing/campanas?campana=${item.id}`} className="flex items-center gap-3 py-4 hover:bg-muted/20"><Target className="h-5 w-5 shrink-0 text-primary" /><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{item.influencer_campaign_creators.length} creadores asignados</p></div><Badge variant="outline">{CAMPAIGN_STATUSES[item.status]}</Badge><ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" /></Link>)}</div>}
    </section>
    <nav aria-label="Operación de creadores" className="grid gap-3 border-t border-border pt-5 sm:grid-cols-3">{[
      { to: 'creadores', label: 'Directorio de creadores', icon: Users }, { to: 'canjes', label: 'Canjes de productos', icon: Gift }, { to: 'pagos', label: 'Comisiones y pagos', icon: Wallet },
    ].map(item => <Button key={item.to} variant="outline" asChild className="h-auto min-h-11 justify-start whitespace-normal text-left"><Link to={`/influencer-marketing/${item.to}`}><item.icon className="mr-2 h-4 w-4 shrink-0" />{item.label}</Link></Button>)}</nav>
  </div>;
}
