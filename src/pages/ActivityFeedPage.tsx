import { useState, useEffect, useCallback } from "react";
import { useOrg } from "@/lib/orgContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { supabase } from "@/integrations/supabase/client";
import { safeChannel } from "@/lib/realtimeChannel";
import { formatARS } from "@/lib/supabaseStore";
import {
  ShoppingCart, Users, TrendingUp, AlertTriangle, CheckSquare,
  Mail, MessageCircle, Activity, RefreshCw, Filter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import PageHeader from "@/components/shared/PageHeader";

// ─── Types ────────────────────────────────────────────────────────────────────

type EventType = "sale" | "customer" | "deal" | "task" | "alert" | "automation";

interface FeedEvent {
  id: string;
  type: EventType;
  title: string;
  description: string;
  amount?: number | null;
  customer?: string | null;
  ts: string; // ISO string
  meta?: Record<string, unknown>;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const EVENT_CONFIG: Record<EventType, { icon: typeof Activity; color: string; bg: string; label: string }> = {
  sale:       { icon: ShoppingCart,  color: "text-emerald-400", bg: "bg-emerald-500/10", label: "Venta" },
  customer:   { icon: Users,          color: "text-blue-400",    bg: "bg-blue-500/10",    label: "Cliente" },
  deal:       { icon: TrendingUp,     color: "text-yellow-400",  bg: "bg-yellow-500/10",  label: "Deal" },
  task:       { icon: CheckSquare,    color: "text-purple-400",  bg: "bg-purple-500/10",  label: "Tarea" },
  alert:      { icon: AlertTriangle,  color: "text-orange-400",  bg: "bg-orange-500/10",  label: "Alerta" },
  automation: { icon: RefreshCw,      color: "text-primary",     bg: "bg-primary/10",     label: "Automatización" },
};

const FILTER_OPTIONS: { value: EventType | "all"; label: string }[] = [
  { value: "all",         label: "Todo" },
  { value: "sale",        label: "Ventas" },
  { value: "customer",    label: "Clientes" },
  { value: "deal",        label: "Deals" },
  { value: "task",        label: "Tareas" },
  { value: "alert",       label: "Alertas" },
  { value: "automation",  label: "Automations" },
];

// ─── Time helpers ─────────────────────────────────────────────────────────────

function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Ahora mismo";
  if (mins < 60) return `hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `hace ${days}d`;
}

function groupByDate(events: FeedEvent[]): { label: string; events: FeedEvent[] }[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const groups = new Map<string, FeedEvent[]>();
  events.forEach(e => {
    const d = new Date(e.ts);
    d.setHours(0, 0, 0, 0);
    let label: string;
    if (d.getTime() === today.getTime()) label = "Hoy";
    else if (d.getTime() === yesterday.getTime()) label = "Ayer";
    else label = d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });

    const arr = groups.get(label) ?? [];
    arr.push(e);
    groups.set(label, arr);
  });
  return Array.from(groups.entries()).map(([label, evs]) => ({ label, events: evs }));
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ActivityFeedPage() {
  usePageTitle("Feed de Actividad");
  const { activeOrg } = useOrg();

  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<EventType | "all">("all");
  const [newCount, setNewCount] = useState(0);

  const loadEvents = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const since = new Date();
    since.setDate(since.getDate() - 30); // last 30 days

    const [salesRes, customersRes, dealsRes, tasksRes] = await Promise.all([
      supabase
        .from("sales")
        .select("id, product_name, customer_name, total_ars, created_at, seller_name")
        .eq("org_id", activeOrg.id)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("customers")
        .select("id, name, created_at, company, email")
        .eq("org_id", activeOrg.id)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("deals")
        .select("id, title, customer_name, value_ars, stage, created_at, updated_at")
        .eq("org_id", activeOrg.id)
        .gte("updated_at", since.toISOString())
        .order("updated_at", { ascending: false })
        .limit(50),
      supabase
        .from("tasks")
        .select("id, title, status, priority, created_at, updated_at")
        .eq("org_id", activeOrg.id)
        .gte("updated_at", since.toISOString())
        .eq("status", "completed")
        .order("updated_at", { ascending: false })
        .limit(30),
    ]);

    const feed: FeedEvent[] = [];

    // Sales
    (salesRes.data || []).forEach((s: any) => {
      feed.push({
        id: `sale-${s.id}`,
        type: "sale",
        title: `Venta — ${s.product_name}`,
        description: s.customer_name
          ? `Cliente: ${s.customer_name}${s.seller_name ? ` · Vendedor: ${s.seller_name}` : ""}`
          : s.seller_name ? `Vendedor: ${s.seller_name}` : "Venta en POS",
        amount: s.total_ars,
        customer: s.customer_name,
        ts: s.created_at,
      });
    });

    // New customers
    (customersRes.data || []).forEach((c: any) => {
      feed.push({
        id: `customer-${c.id}`,
        type: "customer",
        title: `Nuevo cliente — ${c.name}`,
        description: [c.company, c.email].filter(Boolean).join(" · ") || "Registrado en el sistema",
        customer: c.name,
        ts: c.created_at,
      });
    });

    // Deal activity
    (dealsRes.data || []).forEach((d: any) => {
      const stageLabels: Record<string, string> = {
        lead: "Lead", contactado: "Contactado", propuesta: "Propuesta",
        negociacion: "Negociación", cerrado: "Cerrado ✓", perdido: "Perdido ✗",
      };
      feed.push({
        id: `deal-${d.id}-${d.updated_at}`,
        type: "deal",
        title: d.stage === "cerrado" ? `🏆 Deal cerrado — ${d.title}` : `Deal actualizado — ${d.title}`,
        description: `${d.customer_name || "Sin cliente"} · Etapa: ${stageLabels[d.stage] ?? d.stage}${d.value_ars > 0 ? ` · ${formatARS(d.value_ars)}` : ""}`,
        amount: d.value_ars > 0 ? d.value_ars : null,
        customer: d.customer_name,
        ts: d.updated_at,
      });
    });

    // Completed tasks
    (tasksRes.data || []).forEach((t: any) => {
      const priorityEmoji = t.priority === "urgent" ? "🔴" : t.priority === "high" ? "🟠" : "🟢";
      feed.push({
        id: `task-${t.id}`,
        type: "task",
        title: `Tarea completada — ${t.title}`,
        description: `${priorityEmoji} Prioridad: ${t.priority}`,
        ts: t.updated_at,
      });
    });

    // Sort all events by timestamp descending
    feed.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

    setEvents(feed);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  // Realtime: listen for new sales
  useEffect(() => {
    if (!activeOrg) return;
    const ch = safeChannel("activity-feed-rt", activeOrg.id)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "sales",
        filter: `org_id=eq.${activeOrg.id}`,
      }, payload => {
        const s = payload.new as any;
        const newEvent: FeedEvent = {
          id: `sale-${s.id}`,
          type: "sale",
          title: `Venta — ${s.product_name}`,
          description: s.customer_name ? `Cliente: ${s.customer_name}` : "Venta en POS",
          amount: s.total_ars,
          customer: s.customer_name,
          ts: s.created_at,
        };
        setEvents(prev => [newEvent, ...prev].slice(0, 200));
        setNewCount(n => n + 1);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeOrg]);

  const filtered = filter === "all" ? events : events.filter(e => e.type === filter);
  const grouped = groupByDate(filtered);

  const totalByType = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.type] = (acc[e.type] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-4 pb-12">
      <PageHeader
        icon={Activity}
        title="Feed de Actividad"
        description="Eventos en tiempo real del negocio — últimos 30 días"
        badge={newCount > 0 ? { label: `${newCount} nuevos`, variant: "default" } : undefined}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => { loadEvents(); setNewCount(0); }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Actualizar
          </Button>
        }
      />

      {/* Summary strip */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {(Object.entries(EVENT_CONFIG) as [EventType, typeof EVENT_CONFIG[EventType]][]).map(([type, cfg]) => {
          const Icon = cfg.icon;
          const count = totalByType[type] || 0;
          return (
            <button
              key={type}
              onClick={() => setFilter(filter === type ? "all" : type)}
              className={`flex flex-col items-center gap-1 p-3 rounded-xl border transition-all ${
                filter === type
                  ? "border-primary/60 bg-primary/10"
                  : "border-border/60 bg-card hover:border-primary/30"
              }`}
            >
              <div className={`w-8 h-8 rounded-lg ${cfg.bg} flex items-center justify-center`}>
                <Icon className={`w-4 h-4 ${cfg.color}`} />
              </div>
              <p className="text-lg font-bold font-display">{count}</p>
              <p className="text-[10px] text-muted-foreground">{cfg.label}</p>
            </button>
          );
        })}
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 flex-wrap">
        {FILTER_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value as EventType | "all")}
            className={`px-3 py-1 text-xs rounded-full border transition-all ${
              filter === opt.value
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
            }`}
          >
            {opt.label}
            {opt.value !== "all" && totalByType[opt.value as EventType] > 0 && (
              <span className="ml-1.5 opacity-60">({totalByType[opt.value as EventType]})</span>
            )}
          </button>
        ))}
      </div>

      {/* Feed */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" /> Cargando actividad…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Activity className="w-10 h-10 mx-auto mb-3 text-muted-foreground/20" />
          <p className="text-muted-foreground">Sin actividad reciente</p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(group => (
            <div key={group.label}>
              {/* Date group header */}
              <div className="flex items-center gap-3 mb-3">
                <div className="h-px flex-1 bg-border/50" />
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2">
                  {group.label}
                </span>
                <div className="h-px flex-1 bg-border/50" />
              </div>

              {/* Events */}
              <div className="space-y-2">
                {group.events.map(event => {
                  const cfg = EVENT_CONFIG[event.type];
                  const Icon = cfg.icon;
                  return (
                    <div
                      key={event.id}
                      className="flex items-start gap-3 p-3.5 bg-card border border-border/60 rounded-xl hover:border-border transition-colors"
                    >
                      {/* Icon */}
                      <div className={`w-9 h-9 rounded-xl ${cfg.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                        <Icon className={`w-4 h-4 ${cfg.color}`} />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium leading-snug truncate">{event.title}</p>
                          <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
                            {timeAgo(event.ts)}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{event.description}</p>
                        {event.amount != null && event.amount > 0 && (
                          <p className={`text-sm font-semibold mt-1 ${event.type === "sale" || event.type === "deal" ? "text-emerald-400" : ""}`}>
                            {formatARS(event.amount)}
                          </p>
                        )}
                      </div>

                      {/* Type badge */}
                      <Badge
                        variant="outline"
                        className={`text-[9px] shrink-0 hidden sm:flex ${cfg.color} border-current/30`}
                      >
                        {cfg.label}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
