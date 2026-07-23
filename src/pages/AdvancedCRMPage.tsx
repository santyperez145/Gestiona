import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { usePageTitle } from "@/hooks/usePageTitle";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import {
  Kanban, DollarSign, Users, Phone, Mail,
  Calendar, AlertTriangle, CheckCircle2, Edit3, Plus,
  Search, Activity,
} from "lucide-react";
import PipelineKanbanTab from "@/components/crm/PipelineKanbanTab";
import { Button } from "@/components/ui/button";

// Stage → win-probability map for the header pipeline KPIs (mirrors PipelineKanbanTab's `deals` stages)
const DEAL_STAGE_PROBABILITY: Record<string, number> = {
  lead: 10, contactado: 25, propuesta: 50, negociacion: 75, cerrado: 100, perdido: 0,
};

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
  usePageTitle("CRM Avanzado");
  const { orgId } = useOrganization();
  const [tab, setTab] = useState<"kanban" | "contacts" | "activities">("kanban");
  const [search, setSearch] = useState("");
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [pipelineStats, setPipelineStats] = useState({ pipelineValue: 0, weightedValue: 0, staleCount: 0 });

  useEffect(() => {
    if (!orgId) return;
    Promise.all([
      supabase.from("crm_contacts").select("*").eq("org_id", orgId).order("lead_score", { ascending: false }).limit(50),
      supabase.from("crm_activities").select("*").eq("org_id", orgId).order("created_at", { ascending: false }).limit(20),
    ]).then(([contactsRes, activitiesRes]) => {
      if (contactsRes.data) setContacts(contactsRes.data as CrmContact[]);
      if (activitiesRes.data) setActivities(activitiesRes.data as CrmActivity[]);
    });
  }, [orgId]);

  // ── Header pipeline KPIs — sourced from the real `deals` table used by the Kanban tab ──
  useEffect(() => {
    if (!orgId) return;
    supabase.from("deals").select("value_ars, stage, updated_at").eq("org_id", orgId).then(({ data }) => {
      const rows = data || [];
      const open = rows.filter((r: any) => r.stage !== "perdido");
      const pipelineValue = open.reduce((s: number, r: any) => s + (r.value_ars || 0), 0);
      const weightedValue = open.reduce((s: number, r: any) => s + (r.value_ars || 0) * (DEAL_STAGE_PROBABILITY[r.stage] ?? 0) / 100, 0);
      const staleCount = rows.filter((r: any) => {
        if (r.stage === "cerrado" || r.stage === "perdido") return false;
        return (Date.now() - new Date(r.updated_at).getTime()) / 86400000 >= 14;
      }).length;
      setPipelineStats({ pipelineValue, weightedValue, staleCount });
    });
  }, [orgId]);

  const TABS = [
    { id: "kanban",     label: "Pipeline Kanban" },
    { id: "contacts",   label: "Contactos" },
    { id: "activities", label: "Actividades" },
  ] as const;

  // ── Grouped activities ──────────────────────────────────────────────────────
  const activityGroups: Record<string, CrmActivity[]> = {};
  const GROUP_ORDER = ["Hoy", "Ayer", "Esta semana", "Anteriores"];
  activities.forEach(a => {
    const g = getActivityGroup(a.scheduled_at ?? a.created_at);
    if (!activityGroups[g]) activityGroups[g] = [];
    activityGroups[g].push(a);
  });

  return (
    <div className="space-y-6 pb-12">
      {/* ── Page Header ──────────────────────────────────────────────────────── */}
      <PageHeader
        icon={Kanban}
        title="CRM Avanzado"
        description="Pipeline de deals, contactos y actividades"
      />

      {/* ── KPI Cards ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          label="Pipeline Total"
          value={`$${(pipelineStats.pipelineValue / 1000).toFixed(0)}K`}
          sub="valor bruto abierto"
          icon={DollarSign}
          color="primary"
        />
        <KPICard
          label="Valor Ponderado"
          value={`$${(pipelineStats.weightedValue / 1000).toFixed(0)}K`}
          sub="ajustado por probabilidad"
          icon={DollarSign}
          color="warning"
        />
        <KPICard
          label="Deals en riesgo"
          value={pipelineStats.staleCount}
          sub="sin actividad +14 días"
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
      {tab === "kanban" && <PipelineKanbanTab />}

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

    </div>
  );
}
