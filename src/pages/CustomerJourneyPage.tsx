import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { usePageTitle } from "@/hooks/usePageTitle";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import PageHeader from "@/components/shared/PageHeader";
import {
  Map, Users, TrendingUp, Heart, AlertTriangle, Plus, Search,
  MessageCircle, Mail, Phone, ShoppingCart, Star, RefreshCw,
  Smile, Meh, Frown, Zap, CheckCircle2, ChevronDown, ChevronUp, Loader2
} from "lucide-react";

const STAGE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  awareness:     { bg: "bg-blue-500/10",    text: "text-blue-400",    border: "border-blue-500/30" },
  consideration: { bg: "bg-indigo-500/10",  text: "text-indigo-400",  border: "border-indigo-500/30" },
  decision:      { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/30" },
  retention:     { bg: "bg-yellow-500/10",  text: "text-yellow-400",  border: "border-yellow-500/30" },
  advocacy:      { bg: "bg-pink-500/10",    text: "text-pink-400",    border: "border-pink-500/30" },
  churn_risk:    { bg: "bg-red-500/10",     text: "text-red-400",     border: "border-red-500/30" },
};

const TOUCHPOINT_ICONS: Record<string, any> = {
  sale: ShoppingCart, support_ticket: MessageCircle, email_open: Mail,
  email_click: Mail, whatsapp: MessageCircle, call: Phone, chat: MessageCircle,
  review: Star, refund: RefreshCw, loyalty_redeem: Heart,
  nps_response: Star, cart_abandon: ShoppingCart,
};

interface JourneyStage {
  id: string;
  name: string;
  stage_type: string;
  customers: number;
  description: string;
}

interface JourneyCustomer {
  id: string;
  name: string;
  email: string;
  stage: string;
  health: number;
  touchpoints: number;
  last_contact: string;
  sentiment: string;
  ltv: number;
}

interface Touchpoint {
  id: string;
  type: string;
  channel: string;
  subject: string;
  sentiment: string;
  date: string;
}

interface Automation {
  id: string;
  name: string;
  trigger: string;
  action: string;
  active: boolean;
  runs: number;
}

function SentimentIcon({ sentiment }: { sentiment: string }) {
  if (sentiment === "positive") return <Smile className="w-3.5 h-3.5 text-emerald-400" />;
  if (sentiment === "negative") return <Frown className="w-3.5 h-3.5 text-red-400" />;
  return <Meh className="w-3.5 h-3.5 text-yellow-400" />;
}

function HealthBar({ value }: { value: number }) {
  const color = value >= 75 ? "bg-emerald-400" : value >= 50 ? "bg-yellow-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-muted rounded-full">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs font-semibold">{value}</span>
    </div>
  );
}

export default function CustomerJourneyPage() {
  usePageTitle("Customer Journey");
  const { orgId } = useOrganization();
  const [tab, setTab] = useState<"funnel" | "customers" | "automations">("funnel");
  const [search, setSearch] = useState("");
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [showNewAutomation, setShowNewAutomation] = useState(false);
  const [expandedTpId, setExpandedTpId] = useState<string | null>(null);

  const [stages, setStages] = useState<JourneyStage[]>([]);
  const [customers, setCustomers] = useState<JourneyCustomer[]>([]);
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loadingData, setLoadingData] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    setLoadingData(true);
    Promise.all([
      supabase.from("journey_stages").select("*").eq("org_id", orgId).order("sort_order"),
      supabase.from("journey_automations").select("*").eq("org_id", orgId).order("created_at", { ascending: false }),
      // Derive customers from sales — group by customer_name, determine stage from recency
      supabase.from("sales").select("customer_name, date, total_ars, profit_ars").eq("org_id", orgId).order("date", { ascending: false }).limit(500),
    ]).then(([stagesRes, autoRes, salesRes]) => {
      const stagesData: JourneyStage[] = (stagesRes.data || []).map((s: any) => ({
        id: s.id,
        name: s.name,
        stage_type: s.stage_type,
        customers: 0,  // will be filled below
        description: s.description || "",
      }));

      // Derive customers from sales
      const salesList = salesRes.data || [];
      const customerMap: Record<string, { name: string; totalARS: number; purchases: number; lastDate: string; firstDate: string }> = {};
      for (const s of salesList) {
        if (!s.customer_name) continue;
        const k = s.customer_name;
        if (!customerMap[k]) customerMap[k] = { name: k, totalARS: 0, purchases: 0, lastDate: s.date, firstDate: s.date };
        customerMap[k].totalARS += Number(s.total_ars) || 0;
        customerMap[k].purchases += 1;
        if (s.date > customerMap[k].lastDate) customerMap[k].lastDate = s.date;
        if (s.date < customerMap[k].firstDate) customerMap[k].firstDate = s.date;
      }
      const now = Date.now();
      const derivedCustomers: JourneyCustomer[] = Object.values(customerMap).map(c => {
        const daysSince = Math.floor((now - new Date(c.lastDate).getTime()) / 86400000);
        let stage = "retention";
        if (c.purchases === 1 && daysSince <= 30) stage = "decision";
        else if (daysSince > 90) stage = "churn_risk";
        else if (c.purchases >= 5 || c.totalARS >= 200000) stage = "advocacy";
        else if (daysSince <= 14) stage = "retention";
        else stage = "consideration";
        return {
          id: c.name,
          name: c.name,
          email: "",
          stage,
          health: Math.max(5, Math.min(100, 100 - daysSince)),
          touchpoints: c.purchases,
          last_contact: c.lastDate,
          sentiment: daysSince <= 14 ? "positive" : daysSince <= 45 ? "neutral" : "negative",
          ltv: c.totalARS,
        };
      });

      // Fill stage customer counts
      const stageCounts: Record<string, number> = {};
      for (const c of derivedCustomers) stageCounts[c.stage] = (stageCounts[c.stage] || 0) + 1;
      const stagesWithCounts = stagesData.map(s => ({ ...s, customers: stageCounts[s.stage_type] || 0 }));
      // If no stages in DB yet, use default stages
      const finalStages: JourneyStage[] = stagesWithCounts.length > 0 ? stagesWithCounts : [
        { id: "1", name: "Descubrimiento", stage_type: "awareness", customers: stageCounts["awareness"] || 0, description: "" },
        { id: "2", name: "Evaluación", stage_type: "consideration", customers: stageCounts["consideration"] || 0, description: "" },
        { id: "3", name: "Primera Compra", stage_type: "decision", customers: stageCounts["decision"] || 0, description: "" },
        { id: "4", name: "Cliente Activo", stage_type: "retention", customers: stageCounts["retention"] || 0, description: "" },
        { id: "5", name: "Embajador", stage_type: "advocacy", customers: stageCounts["advocacy"] || 0, description: "" },
        { id: "6", name: "Riesgo de Baja", stage_type: "churn_risk", customers: stageCounts["churn_risk"] || 0, description: "" },
      ];
      setStages(finalStages);
      setCustomers(derivedCustomers);
      if (autoRes.data) setAutomations((autoRes.data as any[]).map(a => ({
        id: a.id,
        name: a.name,
        trigger: a.trigger_type || a.trigger || "—",
        action: a.action_type || a.action || "—",
        active: a.is_active ?? true,
        runs: a.run_count || 0,
      })));
    }).finally(() => setLoadingData(false));
  }, [orgId]);

  const filteredCustomers = customers.filter(c => {
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.email.toLowerCase().includes(search.toLowerCase());
    const matchStage = !selectedStage || c.stage === selectedStage;
    return matchSearch && matchStage;
  });

  const totalCustomers = stages.reduce((acc, s) => acc + s.customers, 0);

  const TABS = [
    { id: "funnel",      label: "Funnel de Etapas" },
    { id: "customers",   label: "Clientes" },
    { id: "automations", label: "Automatizaciones" },
  ];

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Map}
        title="Customer Journey"
        description="Mapa de etapas, touchpoints e interacciones por cliente"
        actions={
          <Button size="sm" onClick={() => setShowNewAutomation(true)} className="gap-1.5 gradient-gold text-primary-foreground">
            <Plus className="w-3.5 h-3.5" />Nueva Automatización
          </Button>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/30 p-1 rounded-xl w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === t.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Loading spinner */}
      {loadingData && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
        </div>
      )}

      {/* ─── Funnel tab ─── */}
      {!loadingData && tab === "funnel" && (
        <div className="space-y-4">
          {stages.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">No hay datos</div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
              {stages.map((s, i) => {
                const c = STAGE_COLORS[s.stage_type] ?? STAGE_COLORS.awareness;
                const pct = totalCustomers > 0 ? Math.round((s.customers / totalCustomers) * 100) : 0;
                return (
                  <button key={s.id} onClick={() => setSelectedStage(selectedStage === s.stage_type ? null : s.stage_type)}
                    className={`${c.bg} border ${selectedStage === s.stage_type ? "border-primary/60" : c.border} rounded-xl p-4 text-left transition-all hover:opacity-80 relative`}>
                    {i < stages.length - 1 && (
                      <div className="hidden xl:block absolute -right-3 top-1/2 -translate-y-1/2 z-10">
                        <ChevronDown className="w-4 h-4 text-muted-foreground rotate-[-90deg]" />
                      </div>
                    )}
                    <p className="text-xs font-semibold mb-1 truncate">{s.name}</p>
                    <p className={`text-3xl font-bold font-display ${c.text}`}>{s.customers}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{pct}% del total</p>
                    <div className="mt-2 h-1 bg-black/10 rounded-full">
                      <div className={`h-1 rounded-full ${c.text.replace("text-", "bg-").replace("-400", "-400")}`} style={{ width: `${pct * 3}%`, maxWidth: "100%" }} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Sankey-like flow description */}
          <div className="bg-card border border-border/40 rounded-xl p-5">
            <h3 className="font-semibold mb-4">Transiciones de Etapa (últimos 30 días)</h3>
            <div className="space-y-2">
              {[
                { from: "Descubrimiento", to: "Evaluación",     count: 34, pct: 24 },
                { from: "Evaluación",     to: "Primera Compra", count: 21, pct: 24 },
                { from: "Primera Compra", to: "Cliente Activo", count: 58, pct: 23 },
                { from: "Cliente Activo", to: "Embajador",      count: 12, pct: 3  },
                { from: "Cliente Activo", to: "Riesgo de Baja", count: 8,  pct: 2  },
              ].map(t => (
                <div key={`${t.from}-${t.to}`} className="flex items-center gap-3 text-sm">
                  <span className="text-muted-foreground text-xs w-32 shrink-0">{t.from}</span>
                  <div className="flex-1 h-5 bg-muted/30 rounded-full relative overflow-hidden">
                    <div className="h-full bg-primary/30 rounded-full" style={{ width: `${t.pct * 3}%` }} />
                    <div className="absolute inset-y-0 left-3 flex items-center">
                      <span className="text-[10px] font-semibold">{t.count} clientes ({t.pct}%)</span>
                    </div>
                  </div>
                  <span className="text-muted-foreground text-xs w-28 shrink-0 text-right">{t.to}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── Customers tab ─── */}
      {!loadingData && tab === "customers" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input placeholder="Buscar cliente..." className="pl-9 h-8 text-sm" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="flex gap-1 flex-wrap">
              <button onClick={() => setSelectedStage(null)}
                className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${!selectedStage ? "bg-primary/15 text-primary border-primary/30" : "border-border/40 text-muted-foreground"}`}>
                Todos
              </button>
              {stages.map(s => {
                const c = STAGE_COLORS[s.stage_type] ?? STAGE_COLORS.awareness;
                return (
                  <button key={s.id} onClick={() => setSelectedStage(selectedStage === s.stage_type ? null : s.stage_type)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${selectedStage === s.stage_type ? `${c.bg} ${c.text} ${c.border}` : "border-border/40 text-muted-foreground"}`}>
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-card border border-border/40 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    {["Cliente", "Etapa", "Health Score", "Touchpoints", "Último Contacto", "Sentimiento", "LTV", ""].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomers.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">No hay datos</td>
                    </tr>
                  ) : (
                    filteredCustomers.map(c => {
                      const stage = stages.find(s => s.stage_type === c.stage);
                      const stageColors = stage ? STAGE_COLORS[stage.stage_type] : STAGE_COLORS.awareness;
                      return (
                        <tr key={c.id} className="border-b border-border/20 hover:bg-muted/20 cursor-pointer" onClick={() => setSelectedCustomer(c)}>
                          <td className="px-4 py-3">
                            <p className="font-medium text-sm">{c.name}</p>
                            <p className="text-xs text-muted-foreground">{c.email}</p>
                          </td>
                          <td className="px-4 py-3">
                            <Badge className={`${stageColors.bg} ${stageColors.text} border-0 text-xs`}>{stage?.name}</Badge>
                          </td>
                          <td className="px-4 py-3"><HealthBar value={c.health} /></td>
                          <td className="px-4 py-3 text-xs">{c.touchpoints}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{c.last_contact}</td>
                          <td className="px-4 py-3"><SentimentIcon sentiment={c.sentiment} /></td>
                          <td className="px-4 py-3 text-xs font-semibold">${c.ltv.toLocaleString("es-AR")}</td>
                          <td className="px-4 py-3 text-muted-foreground"><ChevronDown className="w-3.5 h-3.5" /></td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─── Automations tab ─── */}
      {!loadingData && tab === "automations" && (
        <div className="space-y-4">
          {automations.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">No hay datos</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {automations.map(a => (
                <div key={a.id} className="bg-card border border-border/40 rounded-xl p-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-sm">{a.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{a.runs} ejecuciones</p>
                    </div>
                    <button onClick={() => toast.success(`Automatización ${a.active ? "desactivada" : "activada"}`)}
                      className={`w-10 h-5 rounded-full transition-all ${a.active ? "bg-emerald-500" : "bg-muted"}`}>
                      <div className={`w-4 h-4 bg-white rounded-full m-0.5 transition-transform ${a.active ? "translate-x-5" : "translate-x-0"}`} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-muted/30 rounded-lg p-2">
                      <span className="text-muted-foreground block">Trigger</span>
                      <span className="font-medium">{a.trigger.replace(/_/g, " ")}</span>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-2">
                      <span className="text-muted-foreground block">Acción</span>
                      <span className="font-medium">{a.action.replace(/_/g, " ")}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Customer detail panel ─── */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border/60 rounded-2xl w-full max-w-lg shadow-2xl max-h-[80vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-border/40 flex items-center justify-between sticky top-0 bg-card">
              <div>
                <h3 className="font-semibold">{selectedCustomer.name}</h3>
                <p className="text-xs text-muted-foreground">{selectedCustomer.email}</p>
              </div>
              <button onClick={() => setSelectedCustomer(null)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="bg-muted/30 rounded-lg p-3">
                  <span className="text-xs text-muted-foreground block">Health</span>
                  <p className="text-xl font-bold mt-0.5">{selectedCustomer.health}</p>
                </div>
                <div className="bg-muted/30 rounded-lg p-3">
                  <span className="text-xs text-muted-foreground block">Touchpoints</span>
                  <p className="text-xl font-bold mt-0.5">{selectedCustomer.touchpoints}</p>
                </div>
                <div className="bg-muted/30 rounded-lg p-3">
                  <span className="text-xs text-muted-foreground block">LTV</span>
                  <p className="text-lg font-bold mt-0.5">${(selectedCustomer.ltv / 1000).toFixed(0)}K</p>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Timeline de Touchpoints</h4>
                <div className="space-y-2">
                  {([] as Touchpoint[]).map(tp => {
                    const Icon = TOUCHPOINT_ICONS[tp.type] || MessageCircle;
                    return (
                      <div key={tp.id} className="flex gap-3 p-3 bg-muted/20 rounded-lg">
                        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                          <Icon className="w-3.5 h-3.5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{tp.subject}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] text-muted-foreground">{tp.date}</span>
                            <Badge className="text-[9px] bg-muted border-0 text-muted-foreground">{tp.channel}</Badge>
                          </div>
                        </div>
                        <SentimentIcon sentiment={tp.sentiment} />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── New Automation dialog ─── */}
      {showNewAutomation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="px-6 py-4 border-b border-border/40 flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2"><Zap className="w-4 h-4 text-primary" />Nueva Automatización</h3>
              <button onClick={() => setShowNewAutomation(false)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Nombre</label>
                <Input placeholder="Ej: Re-engagement por inactividad" className="h-9" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Trigger</label>
                <select className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                  {["touchpoint_created","stage_entered","days_inactive","order_placed","support_opened","churn_risk"].map(t => (
                    <option key={t}>{t.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Acción</label>
                <select className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                  {["send_email","send_whatsapp","assign_stage","create_task","notify_team","add_tag"].map(a => (
                    <option key={a}>{a.replace(/_/g, " ")}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Demora (horas)</label>
                <Input type="number" defaultValue="0" className="h-9" min={0} />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border/40 flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setShowNewAutomation(false)}>Cancelar</Button>
              <Button onClick={() => { toast.success("Automatización creada"); setShowNewAutomation(false); }} className="gradient-gold text-primary-foreground">
                Crear Automatización
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
