import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import {
  Kanban, Plus, TrendingUp, DollarSign, Users, Phone, Mail,
  Calendar, AlertTriangle, CheckCircle2, Clock, Star, Edit3,
  Search, Filter, ChevronRight, Activity, Target, Zap, BarChart2,
} from "lucide-react";

// Pipeline stages
const STAGES = [
  { id: "s1", name: "Prospecto",   color: "#6366f1", win_probability: 10 },
  { id: "s2", name: "Calificado",  color: "#8b5cf6", win_probability: 25 },
  { id: "s3", name: "Propuesta",   color: "#f59e0b", win_probability: 50 },
  { id: "s4", name: "Negociación", color: "#10b981", win_probability: 75 },
];

interface CrmDeal {
  id: string;
  stage_id: string;
  title: string;
  value: number;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  probability: number;
  is_rotting: boolean;
  source: string | null;
  updated_at: string;
  expected_close: string | null;
  weighted_value: number | null;
}

interface CrmContact {
  id: string;
  first_name: string;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  role: string | null;
  lead_score: number;
  lifecycle_stage: string;
}

interface CrmActivity {
  id: string;
  activity_type: string;
  subject: string;
  outcome: string | null;
  scheduled_at: string | null;
  is_completed: boolean;
  deal_id: string | null;
  created_at: string;
}

const SOURCE_COLORS: Record<string, string> = {
  inbound:   "bg-emerald-500/15 text-emerald-400",
  outbound:  "bg-blue-500/15 text-blue-400",
  referral:  "bg-purple-500/15 text-purple-400",
  web:       "bg-yellow-500/15 text-yellow-400",
  cold_call: "bg-red-500/15 text-red-400",
};

const ACT_ICONS: Record<string, any> = {
  call:    Phone,
  email:   Mail,
  meeting: Calendar,
  task:    CheckCircle2,
  note:    Edit3,
};

const LIFECYCLE_COLORS: Record<string, string> = {
  lead:       "bg-blue-500/15 text-blue-400",
  prospect:   "bg-violet-500/15 text-violet-400",
  customer:   "bg-emerald-500/15 text-emerald-400",
  churned:    "bg-red-500/15 text-red-400",
};

// ─── DealCard ────────────────────────────────────────────────────────────────
function DealCard({ deal, stage }: { deal: CrmDeal; stage: any }) {
  return (
    <div
      className={`bg-card border rounded-xl p-3 text-xs space-y-2 cursor-pointer hover:border-primary/40 transition-all ${
        deal.is_rotting ? "border-orange-500/40 bg-orange-500/5" : "border-border/40"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-sm leading-tight line-clamp-2">{deal.title}</p>
        {deal.is_rotting && (
          <AlertTriangle className="w-3.5 h-3.5 text-orange-400 shrink-0 mt-0.5" />
        )}
      </div>
      <p className="text-muted-foreground truncate">{deal.contact_name ?? "—"}</p>
      <div className="flex items-center justify-between">
        <span className="font-bold text-sm">${((deal.value ?? 0) / 1000).toFixed(0)}K</span>
        <Badge
          className={`text-[9px] ${
            SOURCE_COLORS[deal.source ?? ""] || "bg-muted text-muted-foreground"
          } border-0`}
        >
          {deal.source ?? "—"}
        </Badge>
      </div>
      <div className="flex items-center justify-between text-muted-foreground">
        <span>{deal.probability}% prob.</span>
        <span>
          {deal.updated_at
            ? new Date(deal.updated_at).toLocaleDateString("es-AR")
            : "—"}
        </span>
      </div>
      <div className="h-1 bg-muted rounded-full">
        <div
          className="h-1 rounded-full"
          style={{ width: `${deal.probability}%`, background: stage.color }}
        />
      </div>
    </div>
  );
}

// ─── Activity date grouping ───────────────────────────────────────────────────
function getActivityGroup(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);
  const itemDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (itemDay.getTime() === today.getTime()) return "Hoy";
  if (itemDay.getTime() === yesterday.getTime()) return "Ayer";
  if (itemDay >= weekAgo) return "Esta semana";
  return "Anteriores";
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function AdvancedCRMPage() {
  const { orgId } = useOrganization();
  const [tab, setTab] = useState<"kanban" | "contacts" | "activities" | "forecast">("kanban");
  const [showNewDeal, setShowNewDeal] = useState(false);
  const [search, setSearch] = useState("");
  const [newDeal, setNewDeal] = useState({ title: "", value: "", stage: "s1", probability: "20" });
  const [deals, setDeals] = useState<CrmDeal[]>([]);
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    supabase.rpc("seed_crm_pipeline", { p_org_id: orgId }).catch(() => {});
    setLoading(true);
    Promise.all([
      supabase.from("crm_deals").select("*").eq("org_id", orgId).order("updated_at", { ascending: false }),
      supabase.from("crm_contacts").select("*").eq("org_id", orgId).order("lead_score", { ascending: false }).limit(50),
      supabase.from("crm_activities").select("*").eq("org_id", orgId).order("created_at", { ascending: false }).limit(20),
    ]).then(([dealsRes, contactsRes, activitiesRes]) => {
      if (dealsRes.data) setDeals(dealsRes.data as CrmDeal[]);
      if (contactsRes.data) setContacts(contactsRes.data as CrmContact[]);
      if (activitiesRes.data) setActivities(activitiesRes.data as CrmActivity[]);
    }).finally(() => setLoading(false));
  }, [orgId]);

  const totalPipeline    = deals.reduce((a, d) => a + (d.value ?? 0), 0);
  const weightedPipeline = deals.reduce((a, d) => a + (d.value ?? 0) * (d.probability ?? 0) / 100, 0);
  const rottingCount     = deals.filter(d => d.is_rotting).length;

  const TABS = [
    { id: "kanban",     label: "Pipeline Kanban" },
    { id: "contacts",   label: "Contactos" },
    { id: "activities", label: "Actividades" },
    { id: "forecast",   label: "Forecast" },
  ] as const;

  // ── Grouped activities ──────────────────────────────────────────────────────
  const activityGroups: Record<string, CrmActivity[]> = {};
  const GROUP_ORDER = ["Hoy", "Ayer", "Esta semana", "Anteriores"];
  activities.forEach(a => {
    const g = getActivityGroup(a.scheduled_at ?? a.created_at);
    if (!activityGroups[g]) activityGroups[g] = [];
    activityGroups[g].push(a);
  });

  // ── Forecast max for bar scaling ────────────────────────────────────────────
  const forecastMax = Math.max(
    ...STAGES.map(s =>
      deals.filter(d => d.stage_id === s.id).reduce((a, d) => a + (d.value ?? 0), 0)
    ),
    1,
  );

  return (
    <div className="space-y-6 pb-12">
      {/* ── Page Header ──────────────────────────────────────────────────────── */}
      <PageHeader
        icon={Kanban}
        title="CRM Avanzado"
        description="Pipeline de deals, contactos y forecast de revenue"
        actions={
          <Button
            size="sm"
            onClick={() => setShowNewDeal(true)}
            className="gap-1.5 gradient-gold text-primary-foreground"
          >
            <Plus className="w-3.5 h-3.5" />
            Nuevo Deal
          </Button>
        }
      />

      {/* ── KPI Cards ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Pipeline Total"
          value={`$${(totalPipeline / 1000).toFixed(0)}K`}
          sub={`${deals.length} deals abiertos`}
          icon={DollarSign}
          color="primary"
        />
        <KPICard
          label="Valor Ponderado"
          value={`$${(weightedPipeline / 1000).toFixed(0)}K`}
          sub="ajustado por probabilidad"
          icon={TrendingUp}
          color="warning"
        />
        <KPICard
          label="Deals en riesgo"
          value={rottingCount}
          sub="sin actividad reciente"
          icon={AlertTriangle}
          color="destructive"
        />
        <KPICard
          label="Contactos"
          value={contacts.length}
          sub="en base de datos"
          icon={Users}
          color="blue"
        />
      </div>

      {/* ── Tab Bar ──────────────────────────────────────────────────────────── */}
      <div className="flex gap-1 bg-muted/30 rounded-xl p-1 w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === t.id
                ? "bg-card border border-border/60 text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Kanban tab ───────────────────────────────────────────────────────── */}
      {tab === "kanban" && (
        <div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 overflow-x-auto">
            {STAGES.map(stage => {
              const stageDeals = deals.filter(d => d.stage_id === stage.id);
              const stageTotal = stageDeals.reduce((a, d) => a + (d.value ?? 0), 0);
              return (
                <div
                  key={stage.id}
                  className="bg-muted/20 border border-border/30 rounded-xl p-3 min-w-[240px]"
                >
                  {/* Column header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ background: stage.color }}
                      />
                      <span className="text-sm font-semibold">{stage.name}</span>
                      <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                        {stageDeals.length}
                      </span>
                    </div>
                    <span className="text-xs font-semibold" style={{ color: stage.color }}>
                      ${(stageTotal / 1000).toFixed(0)}K
                    </span>
                  </div>
                  {/* Win probability indicator */}
                  <div className="mb-3 flex items-center gap-2">
                    <div className="flex-1 h-1 bg-muted rounded-full">
                      <div
                        className="h-1 rounded-full opacity-70"
                        style={{ width: `${stage.win_probability}%`, background: stage.color }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{stage.win_probability}% prob</span>
                  </div>
                  <div className="space-y-2">
                    {stageDeals.map(deal => (
                      <DealCard key={deal.id} deal={deal} stage={stage} />
                    ))}
                    <button
                      onClick={() => {
                        setNewDeal(p => ({ ...p, stage: stage.id }));
                        setShowNewDeal(true);
                      }}
                      className="w-full py-2 border-2 border-dashed border-border/30 rounded-xl text-xs text-muted-foreground hover:border-primary/40 hover:text-primary transition-all flex items-center justify-center gap-1"
                    >
                      <Plus className="w-3 h-3" />Agregar deal
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Contacts tab ─────────────────────────────────────────────────────── */}
      {tab === "contacts" && (
        <div className="space-y-4">
          {/* Search */}
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre o empresa..."
              className="pl-9 h-9 text-sm"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {/* Contact cards grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {contacts
              .filter(c => {
                const fullName = `${c.first_name} ${c.last_name ?? ""}`.trim();
                return (
                  !search ||
                  fullName.toLowerCase().includes(search.toLowerCase()) ||
                  (c.company ?? "").toLowerCase().includes(search.toLowerCase())
                );
              })
              .map(c => {
                const fullName = `${c.first_name} ${c.last_name ?? ""}`.trim();
                return (
                  <div
                    key={c.id}
                    className="bg-card border border-border/40 rounded-xl p-4 space-y-3 hover:border-primary/30 transition-all cursor-pointer"
                  >
                    {/* Name + avatar */}
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-sm font-bold text-primary shrink-0">
                        {c.first_name[0]}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm truncate">{fullName}</p>
                        <p className="text-xs text-muted-foreground truncate">{c.company ?? "—"}</p>
                      </div>
                    </div>

                    {/* Role + lifecycle */}
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-xs text-muted-foreground">{c.role ?? "—"}</span>
                      <Badge
                        className={`text-[10px] border-0 ${
                          LIFECYCLE_COLORS[c.lifecycle_stage] || "bg-muted text-muted-foreground"
                        }`}
                      >
                        {c.lifecycle_stage}
                      </Badge>
                    </div>

                    {/* Lead score bar */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>Lead Score</span>
                        <span className="font-semibold">{c.lead_score}</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full">
                        <div
                          className={`h-1.5 rounded-full ${
                            c.lead_score >= 80
                              ? "bg-emerald-400"
                              : c.lead_score >= 60
                              ? "bg-yellow-400"
                              : "bg-red-400"
                          }`}
                          style={{ width: `${c.lead_score}%` }}
                        />
                      </div>
                    </div>

                    {/* Contact info */}
                    <div className="flex items-center gap-3 pt-1 border-t border-border/30">
                      {c.email && (
                        <a
                          href={`mailto:${c.email}`}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors min-w-0"
                          title={c.email}
                          onClick={e => e.stopPropagation()}
                        >
                          <Mail className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{c.email}</span>
                        </a>
                      )}
                      {c.phone && (
                        <a
                          href={`tel:${c.phone}`}
                          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                          title={c.phone}
                          onClick={e => e.stopPropagation()}
                        >
                          <Phone className="w-3.5 h-3.5" />
                          <span>{c.phone}</span>
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* ── Activities tab ───────────────────────────────────────────────────── */}
      {tab === "activities" && (
        <div className="space-y-6">
          {GROUP_ORDER.filter(g => activityGroups[g]?.length).map(group => (
            <div key={group} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {group}
                </span>
                <div className="flex-1 h-px bg-border/40" />
                <span className="text-xs text-muted-foreground">
                  {activityGroups[group].length}
                </span>
              </div>
              {activityGroups[group].map(a => {
                const Icon = ACT_ICONS[a.activity_type] || Activity;
                const ts = a.scheduled_at ?? a.created_at;
                return (
                  <div
                    key={a.id}
                    className={`bg-card border border-border/40 rounded-xl p-4 flex items-start gap-4 ${
                      a.is_completed ? "opacity-60" : ""
                    }`}
                  >
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                        a.is_completed ? "bg-emerald-500/10" : "bg-primary/10"
                      }`}
                    >
                      <Icon
                        className={`w-4 h-4 ${a.is_completed ? "text-emerald-400" : "text-primary"}`}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{a.subject}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge className="text-[9px] bg-muted border-0 capitalize">
                          {a.activity_type}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(ts).toLocaleString("es-AR", {
                            day: "2-digit", month: "short",
                            hour: "2-digit", minute: "2-digit",
                          })}
                        </span>
                      </div>
                      {a.outcome && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Resultado: <span className="text-foreground">{a.outcome}</span>
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {a.outcome && (
                        <Badge
                          className={`text-xs border-0 ${
                            a.outcome === "positive"
                              ? "bg-emerald-500/15 text-emerald-400"
                              : a.outcome === "negative"
                              ? "bg-red-500/15 text-red-400"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {a.outcome}
                        </Badge>
                      )}
                      {a.is_completed ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => toast.success("Actividad marcada como completada")}
                        >
                          Completar
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          <Button
            variant="outline"
            className="gap-1.5 w-full"
            onClick={() => toast.info("Nueva actividad")}
          >
            <Plus className="w-4 h-4" />Nueva Actividad
          </Button>
        </div>
      )}

      {/* ── Forecast tab ─────────────────────────────────────────────────────── */}
      {tab === "forecast" && (
        <div className="space-y-4">
          {/* Summary card */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-card border border-border/40 rounded-xl p-5">
              <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">
                Revenue proyectado
              </p>
              <p className="text-3xl font-bold text-primary">
                ${(weightedPipeline / 1000).toFixed(0)}K
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                pipeline ponderado × probabilidad
              </p>
            </div>
            <div className="bg-card border border-border/40 rounded-xl p-5">
              <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">
                Pipeline bruto
              </p>
              <p className="text-3xl font-bold">
                ${(totalPipeline / 1000).toFixed(0)}K
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {deals.length} deals activos en pipeline
              </p>
            </div>
          </div>

          {/* Weighted by stage — bar chart */}
          <div className="bg-card border border-border/40 rounded-xl p-5">
            <h3 className="font-semibold flex items-center gap-2 mb-5">
              <BarChart2 className="w-4 h-4 text-primary" />
              Weighted Pipeline por Etapa
            </h3>
            <div className="space-y-4">
              {STAGES.map(stage => {
                const stageDeals = deals.filter(d => d.stage_id === stage.id);
                const total    = stageDeals.reduce((a, d) => a + (d.value ?? 0), 0);
                const weighted = stageDeals.reduce(
                  (a, d) => a + (d.value ?? 0) * (d.probability ?? 0) / 100,
                  0,
                );
                const barPct = total > 0 ? Math.round((total / forecastMax) * 100) : 0;
                return (
                  <div key={stage.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ background: stage.color }}
                        />
                        <span className="font-medium">{stage.name}</span>
                        <span className="text-xs text-muted-foreground">
                          ({stageDeals.length} deals)
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-xs">
                        <span className="text-muted-foreground">${(total / 1000).toFixed(0)}K bruto</span>
                        <span className="font-semibold" style={{ color: stage.color }}>
                          ${(weighted / 1000).toFixed(0)}K pond.
                        </span>
                      </div>
                    </div>
                    {/* Bar */}
                    <div className="h-3 bg-muted/50 rounded-full overflow-hidden">
                      <div
                        className="h-3 rounded-full transition-all duration-500"
                        style={{
                          width: `${barPct}%`,
                          background: `linear-gradient(90deg, ${stage.color}cc, ${stage.color}80)`,
                        }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>{stage.win_probability}% win probability histórica</span>
                      <span>{barPct}% del pipeline máximo</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer totals */}
            <div className="mt-5 pt-4 border-t border-border/40 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Total weighted forecast</p>
                <p className="text-2xl font-bold text-primary">
                  ${(weightedPipeline / 1000).toFixed(0)}K
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Pipeline bruto total</p>
                <p className="text-2xl font-bold">${(totalPipeline / 1000).toFixed(0)}K</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── New Deal dialog ──────────────────────────────────────────────────── */}
      {showNewDeal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border/60 rounded-2xl w-full max-w-md shadow-2xl">
            <div className="px-6 py-4 border-b border-border/40 flex items-center justify-between">
              <h3 className="font-semibold flex items-center gap-2">
                <Plus className="w-4 h-4 text-primary" />Nuevo Deal
              </h3>
              <button
                onClick={() => setShowNewDeal(false)}
                className="text-muted-foreground hover:text-foreground text-xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">
                  Título del deal
                </label>
                <Input
                  value={newDeal.title}
                  onChange={e => setNewDeal(p => ({ ...p, title: e.target.value }))}
                  placeholder="Ej: Contrato anual distribución zona norte"
                  className="h-9"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">
                    Valor (ARS)
                  </label>
                  <Input
                    type="number"
                    value={newDeal.value}
                    onChange={e => setNewDeal(p => ({ ...p, value: e.target.value }))}
                    className="h-9"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">
                    Probabilidad %
                  </label>
                  <Input
                    type="number"
                    value={newDeal.probability}
                    onChange={e => setNewDeal(p => ({ ...p, probability: e.target.value }))}
                    className="h-9"
                    min={0}
                    max={100}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Etapa</label>
                <select
                  value={newDeal.stage}
                  onChange={e => setNewDeal(p => ({ ...p, stage: e.target.value }))}
                  className="w-full h-9 rounded-lg border border-input bg-background px-3 text-sm"
                >
                  {STAGES.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-border/40 flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setShowNewDeal(false)}>
                Cancelar
              </Button>
              <Button
                onClick={() => {
                  if (!newDeal.title) return;
                  toast.success(`Deal "${newDeal.title}" creado`);
                  setShowNewDeal(false);
                  setNewDeal({ title: "", value: "", stage: "s1", probability: "20" });
                }}
                disabled={!newDeal.title}
                className="gradient-gold text-primary-foreground"
              >
                Crear Deal
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
