import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CalendarCheck2, FileSignature, Loader2, Megaphone, RefreshCw, Search, Users2, WalletCards } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { usePageTitle } from "@/hooks/usePageTitle";
import {
  listDeliverables, listInfluencerCampaigns, listInfluencerContracts,
  listInfluencers, listPayments, type InfluencerCampaign,
} from "@/lib/influencersDB";

type Snapshot = {
  campaigns: InfluencerCampaign[];
  creators: Awaited<ReturnType<typeof listInfluencers>>;
  contracts: Awaited<ReturnType<typeof listInfluencerContracts>>;
  deliverables: Awaited<ReturnType<typeof listDeliverables>>;
  payments: Awaited<ReturnType<typeof listPayments>>;
};

const initial: Snapshot = { campaigns: [], creators: [], contracts: [], deliverables: [], payments: [] };
const campaignStatus: Record<InfluencerCampaign["status"], string> = {
  draft: "Borrador", recruiting: "Buscando creadores", active: "Activa",
  review: "En revisión", completed: "Completada", cancelled: "Cancelada",
};

export default function InfluencerMarketingPage() {
  usePageTitle("Influencers");
  const [snapshot, setSnapshot] = useState<Snapshot>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [campaigns, creators, contracts, deliverables, payments] = await Promise.all([
        listInfluencerCampaigns(), listInfluencers(), listInfluencerContracts(), listDeliverables(), listPayments(),
      ]);
      setSnapshot({ campaigns, creators, contracts, deliverables, payments });
    } catch (cause) {
      setSnapshot(initial);
      setError(cause instanceof Error ? cause.message : "No pudimos cargar el resumen de Influencers.");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const metrics = useMemo(() => ({
    activeCampaigns: snapshot.campaigns.filter(campaign => ["recruiting", "active", "review"].includes(campaign.status)).length,
    activeCreators: snapshot.creators.filter(creator => ["active", "activo"].includes(creator.status)).length,
    pendingDeliverables: snapshot.deliverables.filter(item => ["pendiente", "en_progreso", "entregado"].includes(item.status)).length,
    unsignedContracts: snapshot.contracts.filter(contract => contract.status === "active" && !contract.is_signed).length,
    pendingPayments: snapshot.payments.filter(payment => ["pending", "processing"].includes(payment.status)).reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
  }), [snapshot]);

  if (loading) return <div className="flex min-h-[55vh] items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Preparando el centro de campañas…</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-700 dark:text-amber-300">Nerqia Influencers</p>
          <h1 className="mt-1 text-2xl font-display font-bold">Centro de campañas</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Del objetivo a la publicación: creadores, acuerdos, entregables y pagos conectados con la operación.</p>
        </div>
        <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Actualizar</Button><Button size="sm" asChild><Link to="/influencer-marketing/campanas"><Megaphone className="mr-2 h-4 w-4" />Crear campaña</Link></Button></div>
      </div>

      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><p>{error}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => void load()}>Reintentar</Button></div>}

      {!error && <>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Kpi icon={Megaphone} label="Campañas en curso" value={String(metrics.activeCampaigns)} to="/influencer-marketing/campanas" />
          <Kpi icon={Users2} label="Creadores activos" value={String(metrics.activeCreators)} to="/influencer-marketing/creadores" />
          <Kpi icon={CalendarCheck2} label="Entregables abiertos" value={String(metrics.pendingDeliverables)} to="/influencer-marketing/entregables" attention={metrics.pendingDeliverables > 0} />
          <Kpi icon={FileSignature} label="Contratos sin firma" value={String(metrics.unsignedContracts)} to="/influencer-marketing/contratos" attention={metrics.unsignedContracts > 0} />
          <Kpi icon={WalletCards} label="Pagos pendientes" value={formatARS(metrics.pendingPayments)} to="/influencer-marketing/pagos" attention={metrics.pendingPayments > 0} />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
          <Card><CardContent className="p-0"><div className="flex items-center justify-between border-b border-border/70 px-5 py-4"><div><h2 className="font-semibold">Campañas recientes</h2><p className="text-xs text-muted-foreground">Estado, presupuesto y creadores invitados.</p></div><Button variant="ghost" size="sm" asChild><Link to="/influencer-marketing/campanas">Ver todas <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Link></Button></div>{snapshot.campaigns.length === 0 ? <Empty text="Todavía no hay campañas. Creá una y luego invitá creadores." action="Crear campaña" to="/influencer-marketing/campanas" /> : <div className="divide-y divide-border/70">{snapshot.campaigns.slice(0, 5).map(campaign => <Link key={campaign.id} to="/influencer-marketing/campanas" className="flex items-center justify-between gap-3 px-5 py-3.5 hover:bg-muted/40"><div className="min-w-0"><p className="truncate text-sm font-medium">{campaign.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{campaign.creator_count || 0} creadores · {formatARS(campaign.budget_ars)}</p></div><Badge variant="outline" className="shrink-0">{campaignStatus[campaign.status]}</Badge></Link>)}</div>}</CardContent></Card>

          <Card><CardContent className="p-5"><h2 className="font-semibold">Próximas acciones</h2><p className="mt-1 text-xs text-muted-foreground">Priorizadas por el estado operativo actual.</p><div className="mt-4 space-y-2">
            {metrics.unsignedContracts > 0 && <Action to="/influencer-marketing/contratos" icon={FileSignature} title="Revisar contratos" detail={`${metrics.unsignedContracts} sin firma`} />}
            {metrics.pendingDeliverables > 0 && <Action to="/influencer-marketing/entregables" icon={CalendarCheck2} title="Revisar entregables" detail={`${metrics.pendingDeliverables} abiertos`} />}
            {metrics.pendingPayments > 0 && <Action to="/influencer-marketing/pagos" icon={WalletCards} title="Preparar pagos" detail={formatARS(metrics.pendingPayments)} />}
            <Action to="/influencer-marketing/descubrir" icon={Search} title="Descubrir creadores" detail="Filtrar e invitar a una campaña" />
          </div></CardContent></Card>
        </div>
      </>}
    </div>
  );
}

function Kpi({ icon: Icon, label, value, to, attention = false }: { icon: typeof Megaphone; label: string; value: string; to: string; attention?: boolean }) {
  return <Link to={to}><Card className="h-full transition-colors hover:border-amber-500/30"><CardContent className="p-4"><span className={`flex h-8 w-8 items-center justify-center rounded-lg ${attention ? "bg-amber-500/12 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground"}`}><Icon className="h-4 w-4" /></span><p className="mt-3 text-xl font-semibold tabular-nums">{value}</p><p className="mt-0.5 text-xs text-muted-foreground">{label}</p></CardContent></Card></Link>;
}
function Action({ to, icon: Icon, title, detail }: { to: string; icon: typeof Megaphone; title: string; detail: string }) {
  return <Link to={to} className="flex items-center gap-3 rounded-lg border border-border/70 p-3 hover:bg-muted/40"><Icon className="h-4 w-4 text-amber-700 dark:text-amber-300" /><span className="min-w-0 flex-1"><b className="block text-sm font-medium">{title}</b><span className="block truncate text-xs text-muted-foreground">{detail}</span></span><ArrowRight className="h-3.5 w-3.5 text-muted-foreground" /></Link>;
}
function Empty({ text, action, to }: { text: string; action: string; to: string }) { return <div className="px-5 py-10 text-center"><p className="text-sm text-muted-foreground">{text}</p><Button variant="outline" size="sm" className="mt-3" asChild><Link to={to}>{action}</Link></Button></div>; }
function formatARS(value: number) { return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(value || 0); }
