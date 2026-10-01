import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Edit } from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { supabase } from "@/integrations/supabase/client";
import {
  getExchangesDB, addExchangeDB, updateExchangeDB, deleteExchangeDB, generateInfluencerCode, formatARS as _fmt,
} from "@/lib/supabaseStore";
import { useAuth } from "@/lib/auth";
import { useModulePerms } from "@/lib/permissionsContext";
import { listInfluencers, listInfluencerContracts, listDeliverables, createDeliverable, updateDeliverable, deleteDeliverable, listPayments, listBrandPortals, type Influencer } from "@/lib/influencersDB";
import CommercePageHeader from "@/components/commerce/CommercePageHeader";
import CommerceKPICard from "@/components/commerce/CommerceKPICard";
import CommerceEmptyState from "@/components/commerce/CommerceEmptyState";
import { toast } from "sonner";
import { TableSkeleton } from "@/components/shared/PageSkeleton";
import { Activity, BarChart3, BarChart4, Bell, Building2, Calendar, CheckCircle, CheckCircle2, Copy, DollarSign, ExternalLink, Eye, FileSpreadsheet, Gift, Instagram, Link2, Mail, Megaphone, RefreshCw, Send, Shield, Sparkles, Store, Target, Trash2, Users, Wallet, Zap } from "lucide-react";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { PageHeader } from "@/components/shared/PageHeader";
import { useMemo } from "react";
import { calcInfluencerROI, calcCPM, calcFulfillmentRate } from "@/lib/businessCalc";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { TrendingUp } from "lucide-react";
import { Activity as ActivityIcon } from "lucide-react";
import { BarChart as BarChartIcon } from "lucide-react";
import { BarChart3 as BarChart3Icon } from "lucide-react";
import { RefreshCw as RefreshCw2 } from "lucide-react";
import { FileSpreadsheet as FileSpreadsheetIcon } from "lucide-react";
import { Tag as TagIcon } from "lucide-react";
import { Link2 as Link2Icon } from "lucide-react";
import { ExternalLink as ExternalLinkIcon } from "lucide-react";
import { logAudit } from "@/lib/auditLog";
import { listExchangeConfigs, ExchangeConfig } from "@/lib/marketingExtraDB";
import { useParams } from "react-router-dom";
import { useCallback } from "react";
import { Gift as GiftIcon } from "lucide-react";

/**
 * Canjes & Influencers — gestión completa de campañas, contratos, entregables, pagos y brand portal.
 */
export default function InfluencerExchangesPage() {
  const { user } = useAuth();
  const permissions = useModulePerms('influencers');
  const [linkingExchange, setLinkingExchange] = useState<any>(null);
  const [linkedCreatorId, setLinkedCreatorId] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [exchanges, setExchanges] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [pageTab, setPageTab] = useState<"canjes" | "liquidaciones" | "contratos" | "entregables" | "pagos" | "brand" | "dashboard">("canjes");
  const [statusConfigs, setStatusConfigs] = useState<ExchangeConfig[]>([]);
  const [typeConfigs, setTypeConfigs] = useState<ExchangeConfig[]>([]);
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [deliverables, setDeliverables] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [brandProfiles, setBrandProfiles] = useState<any[]>([]);
  const [searchContract, setSearchContract] = useState("");
  const [searchDeliverable, setSearchDeliverable] = useState("");

  const STATUS_MAP = useMemo(() => {
    const m: Record<string, { label: string; class: string }> = {};
    statusConfigs.forEach(s => { m[s.code] = { label: s.label, class: s.color_class }; });
    return m;
  }, [statusConfigs]);
  const TYPE_MAP = useMemo(() => {
    const m: Record<string, string> = {};
    typeConfigs.forEach(t => { m[t.code] = t.label; });
    return m;
  }, [typeConfigs]);

  const reload = async () => {
    if (user) { setExchanges(await getExchangesDB(user.id)); setLoading(false); }
  };

  const reloadAll = async () => {
    setLoading(true);
    try {
      if (user) {
        const [ex, inf, c, d, pmts, bp] = await Promise.all([
          getExchangesDB(user.id),
          listInfluencers(),
          listInfluencerContracts(),
          listDeliverables(),
          listPayments(),
          listBrandPortals(),
        ]);
        setExchanges(ex);
        setInfluencers(inf);
        setContracts(c);
        setDeliverables(d);
        setPayments(pmts);
        setBrandProfiles(bp);
      }
    } catch {
      // swallow
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    listExchangeConfigs('status').then(setStatusConfigs).catch(() => {});
    listExchangeConfigs('type').then(setTypeConfigs).catch(() => {});
    reloadAll();
  }, [user]);

  const filtered = exchanges.filter(e => {
    if (filter !== 'all' && e.status !== filter) return false;
    if (search && !e.influencer_name.toLowerCase().includes(search.toLowerCase()) && !e.product_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const filteredContracts = contracts.filter(c => {
    const q = searchContract.toLowerCase();
    return (c.influencer_name || "").toLowerCase().includes(q);
  });

  const filteredDeliverables = deliverables.filter(d => {
    const q = searchDeliverable.toLowerCase();
    return (d.description || "").toLowerCase().includes(q) || (d.influencer_name || "").toLowerCase().includes(q) || (d.campaign_name || "").toLowerCase().includes(q);
  });

  // KPIs from real data
  const totalInversion = exchanges.reduce((s, e) => s + Number(e.product_value_ars) * e.quantity, 0);
  const totalSalesGenerated = exchanges.reduce((s, e) => s + Number(e.sales_generated_ars || 0), 0);
  const totalReach = exchanges.reduce((s, e) => s + (e.influencer_followers || 0) * (e.actual_posts || e.expected_posts || 1), 0);
  const totalExpected = exchanges.reduce((s, e) => s + (e.expected_posts || 0), 0);
  const totalActual = exchanges.reduce((s, e) => s + (e.actual_posts || 0), 0);
  const fulfillmentRate = calcFulfillmentRate(totalActual, totalExpected);
  const uniqueInfluencers = new Set(exchanges.map(e => e.influencer_instagram || e.influencer_name)).size;
  const roiPct = calcInfluencerROI(totalSalesGenerated, totalInversion);
  const cpm = calcCPM(totalInversion, totalReach);

  const pendingDeliverables = deliverables.filter((d: any) => d.status === "pendiente" || d.status === "en_progreso").length;
  const completedDeliverables = deliverables.filter((d: any) => d.status === "completado" || d.status === "entregado").length;
  const totalContractAmount = contracts.reduce((s, c) => s + Number(c.contract_amount || 0), 0);
  const totalPaid = payments.filter((p: any) => p.status === "completed").reduce((s, p) => s + Number(p.amount || 0), 0);

  const handleDelete = async (ex: any) => {
    await deleteExchangeDB(ex.id);
    if (user) await logAudit(user.id, 'delete', 'exchange', ex.id, { influencer: ex.influencer_name, product: ex.product_name });
    reload();
    toast.success("Canje eliminado");
  };

  const handleUpdateStatus = async (ex: any, newStatus: string) => {
    const updates: any = { status: newStatus };
    if (newStatus === 'publicado' && ex.actual_posts === 0) updates.actual_posts = 1;
    await updateExchangeDB(ex.id, updates);
    reload();
    toast.success(`Estado actualizado a ${STATUS_MAP[newStatus]?.label}`);
  };

  const handleUpdatePosts = async (ex: any, posts: number) => {
    await updateExchangeDB(ex.id, { actual_posts: posts });
    reload();
  };

  // Sharing a URL never assigns identity or grants access.
  const [portalBusy, setPortalBusy] = useState<string | null>(null);
  const handleCopyPortalLink = async (exchange: any) => {
    if (!exchange.influencer_id) return;
    setPortalBusy(exchange.id);
    try {
      const link = `${window.location.origin}/portal-creador?tab=canjes`;
      await navigator.clipboard.writeText(link);
      toast.success("Enlace del portal copiado", { description: "El creador deberá iniciar sesión con el email de su perfil." });
    } catch (cause) {
      console.error('[influencers] copiar portal', cause);
      toast.error("No pudimos copiar el enlace. Volvé a intentar.");
    } finally {
      setPortalBusy(null);
    }
  };

  const linkCreator = async () => {
    if (!permissions.canEdit || linkBusy || !linkedCreatorId || !linkingExchange) return;
    setLinkBusy(true); setLinkError('');
    try {
      const { error } = await supabase.rpc('brand_link_creator_exchange', {
        p_exchange_id: linkingExchange.id, p_influencer_id: linkedCreatorId,
      });
      if (error) throw error;
      setExchanges(previous => previous.map(exchange => exchange.id === linkingExchange.id ? { ...exchange, influencer_id: linkedCreatorId } : exchange));
      setLinkingExchange(null);
      toast.success('Creador vinculado al canje');
    } catch (cause) {
      console.error('[influencers] vincular creador al canje', cause);
      setLinkError('No pudimos vincular el creador. Revisá los permisos, el email del perfil y si el canje ya tiene una entrega.');
    } finally { setLinkBusy(false); }
  };

  // Tab content component
  const renderTab = () => {
    switch (pageTab) {
      case "dashboard":
        return (
          <div className="grid gap-4 md:grid-cols-4">
            <CommerceKPICard title="Inversión" value={_fmt(totalInversion)} icon={Target} description="Costo real" />
            <CommerceKPICard title="Ventas generadas" value={totalSalesGenerated > 0 ? _fmt(totalSalesGenerated) : "Sin datos"} icon={DollarSign} description={roiPct !== null ? `ROI ${roiPct > 0 ? '+' : ''}${roiPct.toFixed(0)}%` : "Cargá ventas atribuidas"} />
            <CommerceKPICard title="Cumplimiento" value={`${fulfillmentRate.toFixed(0)}%`} icon={CheckCircle} description={`${totalActual}/${totalExpected} posts`} />
            <CommerceKPICard title="CPM" value={cpm !== null ? _fmt(cpm) : "—"} icon={Megaphone} description={`${(totalReach / 1000).toFixed(1)}K alcance`} />
          </div>
        );
      case "liquidaciones":
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Liquidaciones</h3>
            <div className="overflow-x-auto rounded-[10px] border border-border/60 bg-card">
              <table className="w-full text-sm">
                <thead><tr className="border-b">
                  <th className="text-left p-3">Influencer</th>
                  <th className="text-left p-3">Ventas</th>
                  <th className="text-right p-3">Comisiones</th>
                  <th className="text-right p-3">Pagadas</th>
                </tr></thead>
                <tbody>
                  {influencers.map(inf => {
                    const infSales = exchanges.filter(e => e.influencer_name === inf.name);
                    const totalComm = infSales.reduce((s, e) => s + Number(e.commission_ars || 0), 0);
                    const paidComm = infSales.filter(e => e.paid).reduce((s, e) => s + Number(e.commission_ars || 0), 0);
                    return (
                      <tr key={inf.id} className="border-t border-border">
                        <td className="p-3 font-medium">{inf.name}</td>
                        <td className="p-3">{infSales.length}</td>
                        <td className="p-3 text-right">{_fmt(totalComm)}</td>
                        <td className="p-3 text-right">{_fmt(paidComm)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      case "contratos":
        return (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold">Contratos</h3>
              <Input placeholder="Buscar contrato…" value={searchContract} onChange={(e) => setSearchContract(e.target.value)} className="pl-8 h-8 w-64 text-sm" />
            </div>
            {loading && contracts.length === 0 ? (
              <div className="flex min-h-[30vh] items-center justify-center text-sm text-muted-foreground">Cargando contratos…</div>
            ) : (
              <div className="overflow-x-auto rounded-[10px] border border-border/60 bg-card">
                <table className="w-full text-sm">
                  <thead><tr className="border-b">
                    <th className="text-left p-3">Influencer</th>
                    <th className="text-left p-3">Tipo</th>
                    <th className="text-right p-3">Monto</th>
                    <th className="text-center p-3">Firmado</th>
                    <th className="text-center p-3">Estado</th>
                  </tr></thead>
                  <tbody>
                    {filteredContracts.map(c => (
                      <tr key={c.id} className="border-t border-border hover:bg-muted/30">
                        <td className="p-3 font-medium">{c.influencer_name}</td>
                        <td className="p-3">{c.contract_type}</td>
                        <td className="p-3 text-right">{_fmt(c.contract_amount)}</td>
                        <td className="p-3 text-center">{c.is_signed ? "✅" : "⏳"}</td>
                        <td className="p-3 text-center">{c.status}</td>
                      </tr>
                    ))}
                    {filteredContracts.length === 0 && (
                      <tr><td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">Sin contratos</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      case "entregables":
        return (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-semibold">Entregables con Fechas</h3>
              <Input placeholder="Buscar entregable…" value={searchDeliverable} onChange={(e) => setSearchDeliverable(e.target.value)} className="pl-8 h-8 w-64 text-sm" />
            </div>
            {loading && deliverables.length === 0 ? (
              <div className="flex min-h-[30vh] items-center justify-center text-sm text-muted-foreground">Cargando entregables…</div>
            ) : (
              <div className="overflow-x-auto rounded-[10px] border border-border/60 bg-card">
                <table className="w-full text-sm">
                  <thead><tr className="border-b">
                    <th className="text-left p-3">Campaña</th>
                    <th className="text-left p-3">Influencer</th>
                    <th className="text-left p-3">Descripción</th>
                    <th className="text-center p-3">Fecha Límite</th>
                    <th className="text-center p-3">Estado</th>
                  </tr></thead>
                  <tbody>
                    {filteredDeliverables.map(d => (
                      <tr key={d.id} className="border-t border-border hover:bg-muted/30">
                        <td className="p-3">{d.campaign_name || d.influencer_name || "—"}</td>
                        <td className="p-3">{d.influencer_name || "—"}</td>
                        <td className="p-3">{d.description || "—"}</td>
                        <td className="p-3 text-center">{d.due_date || "—"}</td>
                        <td className="p-3 text-center">{d.status || "—"}</td>
                      </tr>
                    ))}
                    {filteredDeliverables.length === 0 && (
                      <tr><td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">Sin entregables</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      case "pagos":
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Pagos a Influencers</h3>
            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-lg border border-border/60 p-4 bg-card">
                <p className="text-xs text-muted-foreground">Comisiones generadas</p>
                <p className="text-xl font-bold">{_fmt(totalInversion)}</p>
              </div>
              <div className="rounded-lg border border-border/60 p-4 bg-card">
                <p className="text-xs text-muted-foreground">Pagos realizados</p>
                <p className="text-xl font-bold">{_fmt(totalPaid)}</p>
              </div>
              <div className="rounded-lg border border-border/60 p-4 bg-card">
                <p className="text-xs text-muted-foreground">Pendientes</p>
                <p className="text-xl font-bold">{deliverables.filter((d: any) => d.status !== "completado" && d.status !== "entregado").length}</p>
              </div>
              <div className="rounded-lg border border-border/60 p-4 bg-card">
                <p className="text-xs text-muted-foreground">Tasa conversión</p>
                <p className="text-xl font-bold">{exchanges.length > 0 ? ((exchanges.filter((e: any) => e.paid).length / exchanges.length) * 100).toFixed(1) : 0}%</p>
              </div>
            </div>
            <div className="overflow-x-auto rounded-[10px] border border-border/60 bg-card">
              <table className="w-full text-sm">
                <thead><tr className="border-b">
                  <th className="text-left p-3">Liquidación</th>
                  <th className="text-left p-3">Influencer</th>
                  <th className="text-right p-3">Monto</th>
                  <th className="text-center p-3">Estado</th>
                </tr></thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="p-3">{p.payout_id || p.id}</td>
                      <td className="p-3">{p.influencer_name || "—"}</td>
                      <td className="p-3 text-right">{_fmt(p.amount)}</td>
                      <td className="p-3 text-center">{p.status || "pending"}</td>
                    </tr>
                  ))}
                  {payments.length === 0 && (
                    <tr><td colSpan={4} className="p-6 text-center text-sm text-muted-foreground">Sin pagos registrados</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        );
      case "brand":
        return (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Portal de Marca — Perfiles de Marcas</h3>
            <div className="grid gap-4 md:grid-cols-3">
              {brandProfiles.map(bp => (
                <div key={bp.id} className="rounded-lg border border-border/60 p-4 bg-card">
                  <p className="text-sm font-semibold">{bp.portal_name || bp.influencer_name}</p>
                  <p className="text-xs text-muted-foreground">{bp.category || "—"} · @{bp.instagram_handle || "—"}</p>
                  <div className="mt-2 flex gap-2">
                    <span className="text-xs text-muted-foreground">{(bp.followers_ig || 0).toLocaleString()} seg.</span>
                    <span className="text-xs text-muted-foreground">{(bp.engagement_rate || 0).toFixed(1)}% engagement</span>
                  </div>
                </div>
              ))}
            </div>
            {brandProfiles.length === 0 && (
              <p className="text-sm text-muted-foreground">Sin perfiles de marca registrados.</p>
            )}
          </div>
        );
      default: // "canjes"
        return (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Input placeholder="Buscar influencer o producto..." value={search} onChange={e => setSearch(e.target.value)} className="bg-muted border-border sm:max-w-xs" />
              <Select value={filter} onValueChange={setFilter}>
                <SelectTrigger className="bg-muted border-border w-full sm:w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {statusConfigs.map(s => <SelectItem key={s.code} value={s.code}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">No hay canjes registrados.</div>
            ) : (
              <div className="overflow-x-auto rounded-[10px] border border-border/60 bg-card">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border text-muted-foreground">
                    <th className="text-left p-3 font-medium">Influencer</th>
                    <th className="text-left p-3 font-medium">Producto</th>
                    <th className="text-center p-3 font-medium">Código</th>
                    <th className="text-right p-3 font-medium">Inversión</th>
                    <th className="text-right p-3 font-medium">Ventas atribuidas</th>
                    <th className="text-center p-3 font-medium">Posts</th>
                    <th className="text-center p-3 font-medium">Estado</th>
                    <th className="text-right p-3 font-medium">Portal del creador</th>
                  </tr></thead>
                  <tbody>
                    {filtered.map(ex => (
                      <tr key={ex.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                        <td className="p-3">
                          <p className="font-medium">{ex.influencer_name}</p>
                          {ex.influencer_instagram && <p className="text-xs text-muted-foreground">@{ex.influencer_instagram}</p>}
                        </td>
                        <td className="p-3">{ex.product_name}</td>
                        <td className="p-3 text-center font-mono text-xs">{ex.discount_code || "—"}</td>
                        <td className="p-3 text-right font-medium">{_fmt(Number(ex.product_value_ars) * ex.quantity)}</td>
                        <td className="p-3 text-right">{_fmt(Number(ex.sales_generated_ars || 0))}</td>
                        <td className="p-3 text-center">{ex.actual_posts || 0}/{ex.expected_posts || 0}</td>
                        <td className="p-3 text-center">{ex.status}</td>
                        <td className="p-3 text-right">
                          {!ex.influencer_id && <p className="mb-2 text-xs text-muted-foreground">Sin creador vinculado</p>}
                          {permissions.canEdit && !ex.content_submitted_at && <Button size="sm" variant="outline" onClick={() => { setLinkingExchange(ex); setLinkedCreatorId(ex.influencer_id ?? ''); setLinkError(''); }}><Link2 className="mr-1 h-3.5 w-3.5" />{ex.influencer_id ? 'Cambiar creador' : 'Vincular creador'}</Button>}
                          {ex.influencer_id && <Button size="icon" variant="ghost" title="Copiar enlace del portal" aria-label={`Copiar portal de ${ex.influencer_name}`} disabled={portalBusy === ex.id} onClick={() => void handleCopyPortalLink(ex)}><Copy className="h-4 w-4" /></Button>}
                          {ex.content_url?.startsWith('https://') && <a className="mt-2 block text-xs text-primary underline" href={ex.content_url} target="_blank" rel="noopener noreferrer">Revisar contenido</a>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
    }
  };

  if (loading && exchanges.length === 0 && pageTab !== "canjes" && pageTab !== "dashboard") {
    return <TableSkeleton rows={5} cols={6} />;
  }

  return (
    <div className="space-y-6 pb-12">
      <PageHeader icon={Gift} title="Influencer Marketing" description="Canjes, campañas, contratos, pagos y portal de marca — datos reales del Core" />

      {/* Tabs internos */}
      <div className="flex flex-wrap gap-1 bg-muted/30 p-1 rounded-xl w-fit">
        {[
          { id: "dashboard", label: "Panel de Control" },
          { id: "canjes", label: "Canjes" },
          { id: "liquidaciones", label: "Liquidaciones" },
          { id: "contratos", label: "Contratos" },
          { id: "entregables", label: "Entregables" },
          { id: "pagos", label: "Pagos" },
          { id: "brand", label: "Portal de Marca" },
        ].map(t => (
          <button key={t.id} onClick={() => setPageTab(t.id as any)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${pageTab === t.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{t.label}</button>
        ))}
      </div>

      {/* KPIs para canjes y dashboard */}
      {(pageTab === "canjes" || pageTab === "dashboard") && exchanges.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <CommerceKPICard title="Inversión (costo)" value={_fmt(totalInversion)} icon={Target} description="Lo que realmente costó" />
          <CommerceKPICard title="Ventas generadas" value={totalSalesGenerated > 0 ? _fmt(totalSalesGenerated) : "Sin datos"} icon={DollarSign} description={roiPct !== null ? `ROI ${roiPct > 0 ? '+' : ''}${roiPct.toFixed(0)}%` : "Cargá ventas atribuidas"} />
          <CommerceKPICard title="Cumplimiento" value={`${fulfillmentRate.toFixed(0)}%`} icon={CheckCircle} description={`${totalActual}/${totalExpected} posts`} />
          <CommerceKPICard title="CPM" value={cpm !== null ? _fmt(cpm) : "—"} icon={Megaphone} description={`${(totalReach / 1000).toFixed(1)}K alcance`} />
        </div>
      )}

      {/* Dashboard summary */}
      {pageTab === "dashboard" && (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="rounded-lg border border-border/60 p-4 bg-card">
              <p className="text-xs text-muted-foreground">Contratos activos</p>
              <p className="text-xl font-bold">{contracts.filter((c: any) => c.status === "active").length}</p>
            </div>
            <div className="rounded-lg border border-border/60 p-4 bg-card">
              <p className="text-xs text-muted-foreground">Entregables pendientes</p>
              <p className="text-xl font-bold">{pendingDeliverables}</p>
            </div>
            <div className="rounded-lg border border-border/60 p-4 bg-card">
              <p className="text-xs text-muted-foreground">Contratos firmados</p>
              <p className="text-xl font-bold">{contracts.filter((c: any) => c.is_signed).length}</p>
            </div>
            <div className="rounded-lg border border-border/60 p-4 bg-card">
              <p className="text-xs text-muted-foreground">Pagos completados</p>
              <p className="text-xl font-bold">{payments.filter((p: any) => p.status === "completed").length}</p>
            </div>
          </div>
          {/* ROI Chart */}
          {exchanges.filter(e => Number(e.sales_generated_ars || 0) > 0).length > 0 && (() => {
            const chartData = exchanges
              .filter(e => Number(e.product_value_ars) * e.quantity > 0)
              .map(e => {
                const inv = Number(e.product_value_ars) * e.quantity;
                const sales = Number(e.sales_generated_ars || 0);
                const roi = inv > 0 && sales > 0 ? ((sales - inv) / inv * 100) : 0;
                return { name: (e.influencer_name || "").split(' ')[0], roi: parseFloat(roi.toFixed(1)), inv, sales };
              })
              .sort((a, b) => b.roi - a.roi)
              .slice(0, 8);
            return (
              <div className="bg-card border border-border/60 rounded-xl p-4">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5"><BarChart3 className="w-3.5 h-3.5" />ROI por Influencer (%)</h3>
                <ResponsiveContainer width="100%" height={120}>
                  <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 9 }} tickFormatter={v => `${v}%`} />
                    <Tooltip formatter={(v: any) => [`${v}%`, 'ROI']} contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: 11 }} />
                    <Bar dataKey="roi" radius={[3, 3, 0, 0]}>
                      {chartData.map((entry, i) => (
                        <Cell key={i} fill={entry.roi >= 0 ? 'hsl(var(--success))' : 'hsl(var(--destructive))'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            );
          })()}
        </>
      )}

      {renderTab()}
      <Dialog open={Boolean(linkingExchange)} onOpenChange={value => { if (!value && !linkBusy) setLinkingExchange(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Vincular creador al canje</DialogTitle><DialogDescription>{linkingExchange?.product_name}. El creador ingresará con el email de su perfil; no se asigna por nombre.</DialogDescription></DialogHeader>
          <div className="space-y-2"><Label htmlFor="exchange-creator">Creador</Label><Select value={linkedCreatorId} onValueChange={setLinkedCreatorId} disabled={linkBusy}><SelectTrigger id="exchange-creator"><SelectValue placeholder="Seleccioná un perfil con email" /></SelectTrigger><SelectContent>{influencers.filter(item => item.email?.trim()).map(item => <SelectItem key={item.id} value={item.id}>{item.name} · {item.email}</SelectItem>)}</SelectContent></Select></div>
          {linkError && <p role="alert" className="text-sm text-destructive">{linkError}</p>}
          <DialogFooter><Button variant="outline" onClick={() => setLinkingExchange(null)} disabled={linkBusy}>Cancelar</Button><Button onClick={() => void linkCreator()} disabled={linkBusy || !linkedCreatorId}>Vincular creador</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
