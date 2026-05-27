import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Kanban, Plus, TrendingUp, DollarSign, Users, Phone, Mail,
  Calendar, AlertTriangle, CheckCircle2, Clock, Star, Edit3,
  Search, Filter, ChevronRight, Activity, Target, Zap
} from "lucide-react";

// Mock pipeline stages
const STAGES = [
  { id: "s1", name: "Prospecto",    color: "#6366f1", win_probability: 10 },
  { id: "s2", name: "Calificado",   color: "#8b5cf6", win_probability: 25 },
  { id: "s3", name: "Propuesta",    color: "#f59e0b", win_probability: 50 },
  { id: "s4", name: "Negociación",  color: "#10b981", win_probability: 75 },
];

// Mock deals
const MOCK_DEALS: any[] = [
  { id: "d1", stage: "s1", title: "Distribución CABA zona norte", value: 480000, customer: "Mayorista Central SRL", owner: "Marcos R.", close: "2026-06-30", probability: 15, rotting: false, source: "outbound", last: "hace 2 días" },
  { id: "d2", stage: "s1", title: "Proveedor corporativo TechCorp", value: 1200000, customer: "TechCorp SA",          owner: "Ana G.",    close: "2026-07-15", probability: 20, rotting: false, source: "inbound",  last: "ayer" },
  { id: "d3", stage: "s2", title: "Contrato anual retail x3 locales", value: 850000, customer: "Retail Express",     owner: "Marcos R.", close: "2026-06-15", probability: 30, rotting: true,  source: "referral", last: "hace 18 días" },
  { id: "d4", stage: "s3", title: "Catering empresarial mensual",   value: 280000, customer: "Catering Delicias",    owner: "Sofia M.",  close: "2026-05-31", probability: 55, rotting: false, source: "web",      last: "hace 3 días" },
  { id: "d5", stage: "s3", title: "Equipamiento oficinas completo", value: 640000, customer: "Oficinas Modernas SRL", owner: "Carlos L.", close: "2026-06-10", probability: 60, rotting: false, source: "cold_call", last: "hoy" },
  { id: "d6", stage: "s4", title: "Acuerdo exclusivo zona sur",     value: 2100000, customer: "Distribuidora Sur SA", owner: "Ana G.",   close: "2026-05-30", probability: 80, rotting: false, source: "referral",  last: "hoy" },
];

// Mock contacts
const MOCK_CONTACTS = [
  { id: "c1", name: "Carlos Martínez", company: "TechCorp SA", role: "Dir. Compras", score: 87, stage: "prospect", email: "c.martinez@techcorp.com", phone: "+54 11 4567-8901" },
  { id: "c2", name: "Lucía Pérez",     company: "Retail Express", role: "Gerente Gral.", score: 72, stage: "customer", email: "l.perez@retail.com", phone: "+54 11 3456-7890" },
  { id: "c3", name: "Diego Ruiz",      company: "Distribuidora Sur SA", role: "CEO", score: 95, stage: "customer", email: "d.ruiz@dissur.com", phone: "+54 11 2345-6789" },
  { id: "c4", name: "Valeria Torres",  company: "Catering Delicias", role: "Socia", score: 60, stage: "lead", email: "v.torres@cateringd.com", phone: "+54 11 1234-5678" },
];

// Mock activities
const MOCK_ACTIVITIES = [
  { id: "a1", type: "call",    deal: "Acuerdo exclusivo zona sur", subject: "Llamada de seguimiento", outcome: "positive", date: "2026-05-27 11:00", completed: true },
  { id: "a2", type: "email",   deal: "Propuesta retail x3 locales", subject: "Envío de propuesta actualizada", outcome: "neutral", date: "2026-05-26 14:30", completed: true },
  { id: "a3", type: "meeting", deal: "Equipamiento oficinas", subject: "Demo de productos premium", outcome: "positive", date: "2026-05-27 16:00", completed: false },
  { id: "a4", type: "task",    deal: "TechCorp SA", subject: "Preparar contrato base", outcome: null, date: "2026-05-28 10:00", completed: false },
];

const SOURCE_COLORS: Record<string, string> = {
  inbound: "bg-emerald-500/15 text-emerald-400", outbound: "bg-blue-500/15 text-blue-400",
  referral: "bg-purple-500/15 text-purple-400", web: "bg-yellow-500/15 text-yellow-400",
  cold_call: "bg-red-500/15 text-red-400",
};

const ACT_ICONS: Record<string, any> = {
  call: Phone, email: Mail, meeting: Calendar, task: CheckCircle2, note: Edit3,
};

function DealCard({ deal, stage }: { deal: any; stage: any }) {
  return (
    <div className={`bg-card border rounded-xl p-3 text-xs space-y-2 cursor-pointer hover:border-primary/40 transition-all ${deal.rotting ? "border-orange-500/40 bg-orange-500/3" : "border-border/40"}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-sm leading-tight line-clamp-2">{deal.title}</p>
        {deal.rotting && <AlertTriangle className="w-3.5 h-3.5 text-orange-400 shrink-0 mt-0.5" />}
      </div>
      <p className="text-muted-foreground truncate">{deal.customer}</p>
      <div className="flex items-center justify-between">
        <span className="font-bold text-sm">${(deal.value / 1000).toFixed(0)}K</span>
        <Badge className={`text-[9px] ${SOURCE_COLORS[deal.source] || "bg-muted text-muted-foreground"} border-0`}>{deal.source}</Badge>
      </div>
      <div className="flex items-center justify-between text-muted-foreground">
        <span>{deal.probability}% prob.</span>
        <span>{deal.last}</span>
      </div>
      <div className="h-1 bg-muted rounded-full">
        <div className="h-1 rounded-full" style={{ width: `${deal.probability}%`, background: stage.color }} />
      </div>
    </div>
  );
}

export default function AdvancedCRMPage() {
  const { orgId } = useOrganization();
  const [tab, setTab] = useState<"kanban" | "contacts" | "activities" | "forecast">("kanban");
  const [showNewDeal, setShowNewDeal] = useState(false);
  const [search, setSearch] = useState("");
  const [newDeal, setNewDeal] = useState({ title: "", value: "", stage: "s1", probability: "20" });

  useEffect(() => {
    if (!orgId) return;
    supabase.rpc("seed_crm_pipeline", { p_org_id: orgId }).catch(() => {});
  }, [orgId]);

  const totalPipeline = MOCK_DEALS.reduce((a, d) => a + d.value, 0);
  const weightedPipeline = MOCK_DEALS.reduce((a, d) => a + d.value * d.probability / 100, 0);
  const rottingCount = MOCK_DEALS.filter(d => d.rotting).length;

  const TABS = [
    { id: "kanban",     label: "Pipeline Kanban" },
    { id: "contacts",   label: "Contactos" },
    { id: "activities", label: "Actividades" },
    { id: "forecast",   label: "Forecast" },
  ];

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
              <Kanban className="w-4 h-4 text-violet-400" />
            </div>
            <h1 className="text-2xl font-display font-bold">CRM Avanzado</h1>
          </div>
          <p className="text-sm text-muted-foreground">Pipeline de deals, contactos y forecast de revenue</p>
        </div>
        <Button size="sm" onClick={() => setShowNewDeal(true)} className="gap-1.5 gradient-gold text-primary-foreground">
          <Plus className="w-3.5 h-3.5" />Nuevo Deal
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-card border border-border/40 rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-1">Pipeline Total</p>
          <p className="text-2xl font-bold">${(totalPipeline / 1000000).toFixed(1)}M</p>
          <p className="text-xs text-muted-foreground">{MOCK_DEALS.length} deals abiertos</p>
        </div>
        <div className="bg-card border border-border/40 rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-1">Weighted Pipeline</p>
          <p className="text-2xl font-bold text-primary">${(weightedPipeline / 1000000).toFixed(2)}M</p>
          <p className="text-xs text-muted-foreground">por probabilidad</p>
        </div>
        <div className="bg-card border border-border/40 rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-1">En negociación</p>
          <p className="text-2xl font-bold text-emerald-400">${(MOCK_DEALS.filter(d => d.stage === "s4").reduce((a, d) => a + d.value, 0) / 1000000).toFixed(1)}M</p>
          <p className="text-xs text-muted-foreground">etapa final</p>
        </div>
        <div className="bg-card border border-border/40 rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-1">Deals podridos</p>
          <p className={`text-2xl font-bold ${rottingCount > 0 ? "text-orange-400" : "text-emerald-400"}`}>{rottingCount}</p>
          <p className="text-xs text-muted-foreground">sin actividad reciente</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/30 p-1 rounded-xl w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === t.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── Kanban tab ─── */}
      {tab === "kanban" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 overflow-x-auto">
          {STAGES.map(stage => {
            const stageDeals = MOCK_DEALS.filter(d => d.stage === stage.id);
            const stageTotal = stageDeals.reduce((a, d) => a + d.value, 0);
            return (
              <div key={stage.id} className="bg-muted/20 border border-border/30 rounded-xl p-3 min-w-[240px]">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: stage.color }} />
                    <span className="text-sm font-semibold">{stage.name}</span>
                    <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{stageDeals.length}</span>
                  </div>
                  <span className="text-xs font-semibold text-muted-foreground">${(stageTotal / 1000).toFixed(0)}K</span>
                </div>
                <div className="space-y-2">
                  {stageDeals.map(deal => (
                    <DealCard key={deal.id} deal={deal} stage={stage} />
                  ))}
                  <button onClick={() => { setNewDeal(p => ({ ...p, stage: stage.id })); setShowNewDeal(true); }}
                    className="w-full py-2 border-2 border-dashed border-border/30 rounded-xl text-xs text-muted-foreground hover:border-primary/40 hover:text-primary transition-all flex items-center justify-center gap-1">
                    <Plus className="w-3 h-3" />Agregar deal
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Contacts tab ─── */}
      {tab === "contacts" && (
        <div className="space-y-4">
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input placeholder="Buscar contacto..." className="pl-9 h-8 text-sm" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="bg-card border border-border/40 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    {["Contacto", "Empresa", "Rol", "Lead Score", "Etapa", "Contacto"].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {MOCK_CONTACTS.filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.company.toLowerCase().includes(search.toLowerCase())).map(c => (
                    <tr key={c.id} className="border-b border-border/20 hover:bg-muted/20 cursor-pointer">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">{c.name[0]}</div>
                          <span className="font-medium">{c.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{c.company}</td>
                      <td className="px-4 py-3 text-xs">{c.role}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-12 h-1.5 bg-muted rounded-full">
                            <div className={`h-1.5 rounded-full ${c.score >= 80 ? "bg-emerald-400" : c.score >= 60 ? "bg-yellow-400" : "bg-red-400"}`} style={{ width: `${c.score}%` }} />
                          </div>
                          <span className="text-xs font-semibold">{c.score}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3"><Badge className="bg-muted border-0 text-xs">{c.stage}</Badge></td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button className="text-muted-foreground hover:text-foreground" title={c.email}><Mail className="w-3.5 h-3.5" /></button>
                          <button className="text-muted-foreground hover:text-foreground" title={c.phone}><Phone className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─── Activities tab ─── */}
      {tab === "activities" && (
        <div className="space-y-3">
          {MOCK_ACTIVITIES.map(a => {
            const Icon = ACT_ICONS[a.type] || Activity;
            return (
              <div key={a.id} className={`bg-card border border-border/40 rounded-xl p-4 flex items-center gap-4 ${a.completed ? "opacity-70" : ""}`}>
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${a.completed ? "bg-emerald-500/10" : "bg-primary/10"}`}>
                  <Icon className={`w-4 h-4 ${a.completed ? "text-emerald-400" : "text-primary"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{a.subject}</p>
                  <p className="text-xs text-muted-foreground">{a.deal} · {a.date}</p>
                </div>
                <div className="flex items-center gap-2">
                  {a.outcome && <Badge className={`text-xs border-0 ${a.outcome === "positive" ? "bg-emerald-500/15 text-emerald-400" : a.outcome === "negative" ? "bg-red-500/15 text-red-400" : "bg-muted text-muted-foreground"}`}>{a.outcome}</Badge>}
                  {a.completed ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => toast.success("Actividad marcada como completada")}>Completar</Button>
                  )}
                </div>
              </div>
            );
          })}
          <Button variant="outline" className="gap-1.5 w-full" onClick={() => toast.info("Nueva actividad")}><Plus className="w-4 h-4" />Nueva Actividad</Button>
        </div>
      )}

      {/* ─── Forecast tab ─── */}
      {tab === "forecast" && (
        <div className="space-y-4">
          <div className="bg-card border border-border/40 rounded-xl p-5">
            <h3 className="font-semibold flex items-center gap-2 mb-4"><Target className="w-4 h-4 text-primary" />Forecast por Etapa</h3>
            <div className="space-y-3">
              {STAGES.map(stage => {
                const deals = MOCK_DEALS.filter(d => d.stage === stage.id);
                const total = deals.reduce((a, d) => a + d.value, 0);
                const weighted = deals.reduce((a, d) => a + d.value * d.probability / 100, 0);
                return (
                  <div key={stage.id} className="flex items-center gap-4 p-3 bg-muted/20 rounded-lg">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: stage.color }} />
                    <div className="flex-1">
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="font-medium">{stage.name}</span>
                        <div className="flex items-center gap-4 text-xs">
                          <span className="text-muted-foreground">{deals.length} deals · ${(total / 1000000).toFixed(2)}M</span>
                          <span className="font-semibold text-primary">weighted: ${(weighted / 1000).toFixed(0)}K</span>
                        </div>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full">
                        <div className="h-1.5 rounded-full" style={{ width: `${stage.win_probability}%`, background: stage.color }} />
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{stage.win_probability}% win probability</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-4 border-t border-border/40 flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total weighted forecast</span>
              <span className="text-2xl font-bold text-primary">${(weightedPipeline / 1000000).toFixed(2)}M</span>
            </div>
          </div>
        </div>
      )}

      {/* ─── New Deal dialog ─── */}
      {showNewDeal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="px-6 py-4 border-b border-border/40 flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2"><Plus className="w-4 h-4 text-primary" />Nuevo Deal</h3>
              <button onClick={() => setShowNewDeal(false)} className="text-muted-foreground hover:text-foreground text-xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Título del deal</label>
                <Input value={newDeal.title} onChange={e => setNewDeal(p => ({ ...p, title: e.target.value }))} placeholder="Ej: Contrato anual distribución zona norte" className="h-9" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Valor (ARS)</label>
                  <Input type="number" value={newDeal.value} onChange={e => setNewDeal(p => ({ ...p, value: e.target.value }))} className="h-9" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Probabilidad %</label>
                  <Input type="number" value={newDeal.probability} onChange={e => setNewDeal(p => ({ ...p, probability: e.target.value }))} className="h-9" min={0} max={100} />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Etapa</label>
                <select value={newDeal.stage} onChange={e => setNewDeal(p => ({ ...p, stage: e.target.value }))}
                  className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm">
                  {STAGES.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border/40 flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setShowNewDeal(false)}>Cancelar</Button>
              <Button onClick={() => { if (!newDeal.title) return; toast.success(`Deal "${newDeal.title}" creado`); setShowNewDeal(false); setNewDeal({ title: "", value: "", stage: "s1", probability: "20" }); }} disabled={!newDeal.title} className="gradient-gold text-primary-foreground">
                Crear Deal
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
