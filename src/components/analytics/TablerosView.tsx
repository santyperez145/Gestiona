// Vista «Tableros» del workspace de Analytics.
//
// ⚠️ Era una página propia (/kpi-dashboard) hasta la consolidación 2026-08-27.
// Cinco páginas competían por ser el centro analítico; ahora son vistas de
// /analytics y sólo la activa carga (lazy). El contenido es idéntico: este
// paso mueve superficies, no unifica métricas — el KPI Registry (ANA-001) va
// aparte a propósito.
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  BarChart3, TrendingUp, TrendingDown, Target, Bell, Plus, Pencil, Trash2,
  LayoutDashboard, Star, Settings2, Eye, EyeOff, GripVertical, AlertCircle,
  CheckCircle2, Activity, DollarSign, ShoppingCart, Users, Package, Loader2
} from "lucide-react";
import KPICard from "@/components/shared/KPICard";
import { toast } from "sonner";
import PageHeader from "@/components/shared/PageHeader";
import DateRangeFilter, { useDateRangeFilter } from "@/components/shared/DateRangeFilter";
import { orgViewKey, usePersistedState } from "@/hooks/usePersistedState";
// Note: StoreFilter is intentionally not wired here — sales have no location_id
// in the schema yet (see Dashboard.tsx for the one real store-filter
// integration, which scopes stock via `location_stock`).

/* ─────────────────────────── types ─────────────────────────── */
type WidgetType = "number" | "trend" | "bar_chart" | "pie_chart" | "table" | "gauge" | "sparkline" | "comparison";
type DataSource = string;
type TimeRange = string;

interface Dashboard {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  created_at: string;
}

interface Widget {
  id: string;
  dashboard_id: string;
  title: string;
  widget_type: WidgetType;
  data_source: DataSource;
  time_range: TimeRange;
  display_config: Record<string, unknown>;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  is_visible: boolean;
}

interface Goal {
  id: string;
  name: string;
  metric: string;
  target_value: number;
  current_value: number;
  unit: string;
  period_start: string;
  period_end: string;
  status: "active" | "achieved" | "missed" | "paused";
  color: string;
  notes: string | null;
}

interface Alert {
  id: string;
  name: string;
  condition: "above" | "below" | "equals" | "change_pct";
  threshold: number;
  notification_type: "in_app" | "email" | "both";
  is_active: boolean;
  last_triggered: string | null;
  widget_id: string | null;
}

/* ─────────────────────────── configs ─────────────────────────── */
const WIDGET_TYPES: { value: WidgetType; label: string; icon: React.ReactNode }[] = [
  { value: "number",     label: "Número",        icon: <Activity className="w-4 h-4" /> },
  { value: "trend",      label: "Tendencia",      icon: <TrendingUp className="w-4 h-4" /> },
  { value: "bar_chart",  label: "Barras",         icon: <BarChart3 className="w-4 h-4" /> },
  { value: "gauge",      label: "Gauge",          icon: <Target className="w-4 h-4" /> },
  { value: "sparkline",  label: "Sparkline",      icon: <Activity className="w-4 h-4" /> },
  { value: "comparison", label: "Comparación",    icon: <BarChart3 className="w-4 h-4" /> },
];

const DATA_SOURCES: { value: string; label: string; icon: React.ReactNode; category: string }[] = [
  { value: "sales_total",        label: "Total ventas",          icon: <DollarSign className="w-4 h-4" />, category: "Ventas" },
  { value: "sales_count",        label: "Nro. ventas",           icon: <ShoppingCart className="w-4 h-4" />, category: "Ventas" },
  { value: "avg_ticket",         label: "Ticket promedio",       icon: <DollarSign className="w-4 h-4" />, category: "Ventas" },
  { value: "top_products",       label: "Top productos",         icon: <Star className="w-4 h-4" />, category: "Ventas" },
  { value: "inventory_value",    label: "Valor inventario",      icon: <Package className="w-4 h-4" />, category: "Inventario" },
  { value: "low_stock_count",    label: "Bajo stock",            icon: <AlertCircle className="w-4 h-4" />, category: "Inventario" },
  { value: "accounts_receivable",label: "Cuentas a cobrar",      icon: <TrendingUp className="w-4 h-4" />, category: "Finanzas" },
  { value: "accounts_payable",   label: "Cuentas a pagar",       icon: <TrendingDown className="w-4 h-4" />, category: "Finanzas" },
  { value: "cash_balance",       label: "Balance de caja",       icon: <DollarSign className="w-4 h-4" />, category: "Finanzas" },
  { value: "gross_margin",       label: "Margen bruto",          icon: <BarChart3 className="w-4 h-4" />, category: "Finanzas" },
  { value: "new_customers",      label: "Nuevos clientes",       icon: <Users className="w-4 h-4" />, category: "Clientes" },
  { value: "active_customers",   label: "Clientes activos",      icon: <Users className="w-4 h-4" />, category: "Clientes" },
  { value: "open_quotes",        label: "Cotizaciones abiertas", icon: <ShoppingCart className="w-4 h-4" />, category: "Ventas" },
  { value: "open_tasks",         label: "Tareas abiertas",       icon: <Activity className="w-4 h-4" />, category: "General" },
  { value: "overdue_tasks",      label: "Tareas vencidas",       icon: <AlertCircle className="w-4 h-4" />, category: "General" },
];

const TIME_RANGES: { value: string; label: string }[] = [
  { value: "today",           label: "Hoy" },
  { value: "yesterday",       label: "Ayer" },
  { value: "last_7_days",     label: "Últimos 7 días" },
  { value: "last_30_days",    label: "Últimos 30 días" },
  { value: "current_month",   label: "Mes actual" },
  { value: "last_month",      label: "Mes anterior" },
  { value: "current_quarter", label: "Trimestre actual" },
  { value: "current_year",    label: "Año actual" },
];

const GOAL_STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  active:   { label: "Activa",    color: "bg-blue-500/15 text-blue-400",     icon: <Activity className="w-3 h-3" /> },
  achieved: { label: "Lograda",   color: "bg-emerald-500/15 text-emerald-400", icon: <CheckCircle2 className="w-3 h-3" /> },
  missed:   { label: "No lograda",color: "bg-red-500/15 text-red-400",        icon: <AlertCircle className="w-3 h-3" /> },
  paused:   { label: "Pausada",   color: "bg-muted/40 text-muted-foreground",  icon: <EyeOff className="w-3 h-3" /> },
};

/* ─────────────────────────── KPI format config ─────────────────────────── */
const KPI_FORMAT_CONFIG: Record<string, { prefix?: string; suffix?: string }> = {
  sales_total:         { prefix: "$" },
  avg_ticket:          { prefix: "$" },
  inventory_value:     { prefix: "$" },
  accounts_receivable: { prefix: "$" },
  accounts_payable:    { prefix: "$" },
  cash_balance:        { prefix: "$" },
  gross_margin:        { suffix: "%" },
};

function formatValue(source: string, value: number) {
  const cfg = KPI_FORMAT_CONFIG[source] ?? {};
  const prefix = cfg.prefix ?? "";
  const suffix = cfg.suffix ?? "";
  const formatted = source === "gross_margin"
    ? value.toFixed(1)
    : value >= 1000
    ? value.toLocaleString("es-AR")
    : value.toString();
  return `${prefix}${formatted}${suffix}`;
}

/* ─────────────────────────── widget card ─────────────────────────── */
function WidgetCard({ widget, liveValues, onEdit, onDelete, onToggleVisibility }: {
  widget: Widget;
  liveValues: Record<string, { value: number; trend?: number }>;
  onEdit: () => void;
  onDelete: () => void;
  onToggleVisibility: () => void;
}) {
  const live = liveValues[widget.data_source] ?? { value: 0 };
  const dsLabel = DATA_SOURCES.find(d => d.value === widget.data_source)?.label ?? widget.data_source;
  const hasTrend = live.trend !== undefined;
  const trendPositive = (live.trend ?? 0) >= 0;

  const gaugePercent = widget.widget_type === "gauge"
    ? Math.min(100, Math.max(0, (live.value / (live.value * 1.5 || 1)) * 100))
    : 0;

  return (
    <div className={`bg-card border border-border/50 rounded-xl shadow-sm p-4 flex flex-col gap-2 group relative transition-opacity ${!widget.is_visible ? "opacity-50" : ""}`}>
      {/* header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">{dsLabel}</p>
          <p className="font-semibold text-foreground text-sm mt-0.5">{widget.title}</p>
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onToggleVisibility} className="p-1 rounded hover:bg-muted/40 text-muted-foreground/70">
            {widget.is_visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          </button>
          <button onClick={onEdit} className="p-1 rounded hover:bg-muted/40 text-muted-foreground/70">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete} className="p-1 rounded hover:bg-red-50 text-red-400">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* value */}
      {widget.widget_type === "gauge" ? (
        <div className="flex flex-col items-center py-2">
          <div className="relative w-24 h-12 overflow-hidden">
            <div className="absolute inset-0 rounded-t-full border-4 border-gray-200" />
            <div
              className="absolute inset-0 rounded-t-full border-4 border-blue-500 transition-all"
              style={{ clipPath: `polygon(0 100%, ${gaugePercent}% 100%, ${gaugePercent}% 0%, 0 0%)` }}
            />
          </div>
          <p className="text-2xl font-bold text-foreground mt-1">{formatValue(widget.data_source, live.value)}</p>
        </div>
      ) : widget.widget_type === "bar_chart" ? (
        <div className="flex items-end gap-1 h-12 mt-1">
          {[65, 80, 72, 90, 85, 100, 78].map((h, i) => (
            <div key={i} className="flex-1 bg-primary/20 rounded-t" style={{ height: `${h}%` }} />
          ))}
        </div>
      ) : widget.widget_type === "sparkline" ? (
        <svg viewBox="0 0 80 30" className="w-full h-10 mt-1">
          <polyline
            points="0,25 13,18 26,22 39,10 52,14 65,8 80,5"
            fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          />
        </svg>
      ) : (
        <p className="text-2xl font-bold text-foreground">{formatValue(widget.data_source, live.value)}</p>
      )}

      {/* trend */}
      {hasTrend && widget.widget_type !== "bar_chart" && widget.widget_type !== "gauge" && (
        <div className={`flex items-center gap-1 text-xs font-medium ${trendPositive ? "text-green-600" : "text-red-500"}`}>
          {trendPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
          {Math.abs(live.trend!)}% vs mes anterior
        </div>
      )}

      {/* time range badge */}
      <div className="mt-auto">
        <span className="text-xs text-muted-foreground/70">
          {TIME_RANGES.find(t => t.value === widget.time_range)?.label ?? widget.time_range}
        </span>
      </div>
    </div>
  );
}

/* ─────────────────────────── main page ─────────────────────────── */
const TABS = ["Dashboards", "Widgets", "Metas", "Alertas"] as const;
type Tab = typeof TABS[number];

export default function TablerosView() {
  const { orgId } = useOrganization();
  // usePageTitle via PageHeader icon
  const [activeTab, setActiveTab] = usePersistedState<Tab>(
    orgViewKey("kpi-dashboard.tab", orgId),
    "Dashboards",
  );
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [activeDashId, setActiveDashId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveValues, setLiveValues] = useState<Record<string, { value: number; trend?: number }>>({});
  const { from: dateFrom, to: dateTo } = useDateRangeFilter();

  /* dialogs */
  const [showDashDialog, setShowDashDialog] = useState(false);
  const [showWidgetDialog, setShowWidgetDialog] = useState(false);
  const [showGoalDialog, setShowGoalDialog] = useState(false);
  const [showAlertDialog, setShowAlertDialog] = useState(false);
  const [editingDash, setEditingDash] = useState<Dashboard | null>(null);
  const [editingWidget, setEditingWidget] = useState<Widget | null>(null);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [editingAlert, setEditingAlert] = useState<Alert | null>(null);

  /* forms */
  const [dashForm, setDashForm] = useState({ name: "", description: "", is_default: false });
  const [widgetForm, setWidgetForm] = useState({
    title: "", widget_type: "number" as WidgetType, data_source: "sales_total",
    time_range: "current_month", width: 1, height: 1,
  });
  const [goalForm, setGoalForm] = useState({
    name: "", metric: "", target_value: "", current_value: "0", unit: "",
    period_start: "", period_end: "", status: "active", color: "#3b82f6", notes: "",
  });
  const [alertForm, setAlertForm] = useState({
    name: "", condition: "above", threshold: "", notification_type: "in_app",
  });

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [dr, wr, gr, ar] = await Promise.allSettled([
      supabase.from("kpi_dashboards").select("*").eq("org_id", orgId).order("is_default", { ascending: false }).order("name"),
      supabase.from("kpi_widgets").select("*").eq("org_id", orgId).order("position_y").order("position_x"),
      supabase.from("kpi_goals").select("*").eq("org_id", orgId).order("period_end", { ascending: false }),
      supabase.from("kpi_alerts").select("*").eq("org_id", orgId).order("created_at", { ascending: false }),
    ]);
    if (dr.status === "fulfilled" && dr.value.data) {
      setDashboards(dr.value.data as Dashboard[]);
      if (!activeDashId && dr.value.data.length > 0)
        setActiveDashId(dr.value.data.find(d => d.is_default)?.id ?? dr.value.data[0].id);
    }
    if (wr.status === "fulfilled" && wr.value.data) setWidgets(wr.value.data as Widget[]);
    if (gr.status === "fulfilled" && gr.value.data) setGoals(gr.value.data as Goal[]);
    if (ar.status === "fulfilled" && ar.value.data) setAlerts(ar.value.data as Alert[]);
    // Load latest BI snapshot for live KPI values
    const snapRes = await supabase
      .from("bi_snapshots")
      .select("revenue_day, orders_day, avg_order_value, new_customers, total_stock_value, low_stock_count")
      .eq("org_id", orgId)
      .order("snapshot_date", { ascending: false })
      .limit(2);
    let values: Record<string, { value: number; trend?: number }> = {};
    if (snapRes.data && snapRes.data.length > 0) {
      const today = snapRes.data[0];
      const yesterday = snapRes.data[1];
      const calcTrend = (a: number, b: number) => b > 0 ? Math.round(((a - b) / b) * 100) : 0;
      values = {
        sales_total:     { value: Number(today.revenue_day ?? 0), trend: yesterday ? calcTrend(Number(today.revenue_day), Number(yesterday.revenue_day)) : undefined },
        sales_count:     { value: today.orders_day ?? 0, trend: yesterday ? calcTrend(today.orders_day, yesterday.orders_day) : undefined },
        avg_ticket:      { value: Number(today.avg_order_value ?? 0) },
        inventory_value: { value: Number(today.total_stock_value ?? 0) },
        low_stock_count: { value: today.low_stock_count ?? 0 },
        new_customers:   { value: today.new_customers ?? 0, trend: yesterday ? calcTrend(today.new_customers, yesterday.new_customers) : undefined },
      };
    }

    // Shared date-range filter (URL-persisted) — when active, override the
    // sales-related live values with a real aggregate over the selected range
    // instead of the single-day bi_snapshots comparison.
    if (dateFrom) {
      let salesQ = supabase.from("sales").select("total_ars").eq("org_id", orgId).gte("date", dateFrom.toISOString().slice(0, 10));
      if (dateTo) salesQ = salesQ.lte("date", dateTo.toISOString().slice(0, 10));
      const { data: rangeSales } = await salesQ;
      if (rangeSales) {
        const total = rangeSales.reduce((s, r: any) => s + Number(r.total_ars || 0), 0);
        values = {
          ...values,
          sales_total: { value: total },
          sales_count: { value: rangeSales.length },
          avg_ticket: { value: rangeSales.length > 0 ? total / rangeSales.length : 0 },
        };
      }
    }
    setLiveValues(values);
    setLoading(false);
  }, [orgId, activeDashId, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);

  /* ── Dashboard CRUD ── */
  function openNewDash() {
    setEditingDash(null);
    setDashForm({ name: "", description: "", is_default: false });
    setShowDashDialog(true);
  }
  function openEditDash(d: Dashboard) {
    setEditingDash(d);
    setDashForm({ name: d.name, description: d.description ?? "", is_default: d.is_default });
    setShowDashDialog(true);
  }
  async function saveDash() {
    if (!orgId || !dashForm.name.trim()) return;
    const payload = { org_id: orgId, name: dashForm.name.trim(), description: dashForm.description || null, is_default: dashForm.is_default };
    if (editingDash) {
      const { error } = await supabase.from("kpi_dashboards").update(payload).eq("id", editingDash.id);
      if (error) { toast.error(error.message); return; }
    } else {
      const { data, error } = await supabase.from("kpi_dashboards").insert(payload).select().single();
      if (error) { toast.error(error.message); return; }
      setActiveDashId(data.id);
    }
    toast.success("Dashboard guardado");
    setShowDashDialog(false);
    load();
  }
  async function deleteDash(d: Dashboard) {
    await supabase.from("kpi_dashboards").delete().eq("id", d.id);
    toast.success("Dashboard eliminado");
    if (activeDashId === d.id) setActiveDashId(null);
    load();
  }

  /* ── Widget CRUD ── */
  function openNewWidget() {
    if (!activeDashId) { toast.error("Seleccioná un dashboard primero"); return; }
    setEditingWidget(null);
    setWidgetForm({ title: "", widget_type: "number", data_source: "sales_total", time_range: "current_month", width: 1, height: 1 });
    setShowWidgetDialog(true);
  }
  function openEditWidget(w: Widget) {
    setEditingWidget(w);
    setWidgetForm({ title: w.title, widget_type: w.widget_type, data_source: w.data_source, time_range: w.time_range, width: w.width, height: w.height });
    setShowWidgetDialog(true);
  }
  async function saveWidget() {
    if (!orgId || !activeDashId || !widgetForm.title.trim()) return;
    const payload = {
      org_id: orgId, dashboard_id: activeDashId,
      title: widgetForm.title.trim(), widget_type: widgetForm.widget_type,
      data_source: widgetForm.data_source, time_range: widgetForm.time_range,
      width: widgetForm.width, height: widgetForm.height,
    };
    if (editingWidget) {
      const { error } = await supabase.from("kpi_widgets").update(payload).eq("id", editingWidget.id);
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await supabase.from("kpi_widgets").insert(payload);
      if (error) { toast.error(error.message); return; }
    }
    toast.success("Widget guardado");
    setShowWidgetDialog(false);
    load();
  }
  async function deleteWidget(id: string) {
    await supabase.from("kpi_widgets").delete().eq("id", id);
    toast.success("Widget eliminado");
    load();
  }
  async function toggleWidgetVisibility(w: Widget) {
    await supabase.from("kpi_widgets").update({ is_visible: !w.is_visible }).eq("id", w.id);
    load();
  }

  /* ── Goal CRUD ── */
  function openNewGoal() {
    setEditingGoal(null);
    const today = new Date().toISOString().slice(0, 10);
    const endOfMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10);
    setGoalForm({ name: "", metric: "", target_value: "", current_value: "0", unit: "$", period_start: today, period_end: endOfMonth, status: "active", color: "#3b82f6", notes: "" });
    setShowGoalDialog(true);
  }
  function openEditGoal(g: Goal) {
    setEditingGoal(g);
    setGoalForm({ name: g.name, metric: g.metric, target_value: String(g.target_value), current_value: String(g.current_value), unit: g.unit, period_start: g.period_start, period_end: g.period_end, status: g.status, color: g.color, notes: g.notes ?? "" });
    setShowGoalDialog(true);
  }
  async function saveGoal() {
    if (!orgId || !goalForm.name.trim()) return;
    const payload = {
      org_id: orgId, name: goalForm.name.trim(), metric: goalForm.metric.trim(),
      target_value: parseFloat(goalForm.target_value) || 0,
      current_value: parseFloat(goalForm.current_value) || 0,
      unit: goalForm.unit, period_start: goalForm.period_start, period_end: goalForm.period_end,
      status: goalForm.status, color: goalForm.color, notes: goalForm.notes || null,
    };
    if (editingGoal) {
      const { error } = await supabase.from("kpi_goals").update(payload).eq("id", editingGoal.id);
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await supabase.from("kpi_goals").insert(payload);
      if (error) { toast.error(error.message); return; }
    }
    toast.success("Meta guardada");
    setShowGoalDialog(false);
    load();
  }

  /* ── Alert CRUD ── */
  function openNewAlert() {
    setEditingAlert(null);
    setAlertForm({ name: "", condition: "above", threshold: "", notification_type: "in_app" });
    setShowAlertDialog(true);
  }
  async function saveAlert() {
    if (!orgId || !alertForm.name.trim()) return;
    const payload = {
      org_id: orgId, name: alertForm.name.trim(),
      condition: alertForm.condition, threshold: parseFloat(alertForm.threshold) || 0,
      notification_type: alertForm.notification_type,
    };
    const { error } = await supabase.from("kpi_alerts").insert(payload);
    if (error) { toast.error(error.message); return; }
    toast.success("Alerta creada");
    setShowAlertDialog(false);
    load();
  }
  async function toggleAlert(a: Alert) {
    await supabase.from("kpi_alerts").update({ is_active: !a.is_active }).eq("id", a.id);
    load();
  }

  const dashWidgets = widgets.filter(w => w.dashboard_id === activeDashId);

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={LayoutDashboard}
        title="KPI Dashboard"
        description="Métricas clave, metas y alertas en tiempo real"
        actions={
          <div className="flex flex-wrap gap-2 flex-wrap">
            <DateRangeFilter label="Todo el período" />
            <Button variant="outline" size="sm" onClick={openNewDash}><Plus className="w-4 h-4 mr-1" /> Dashboard</Button>
            {activeTab === "Widgets" && <Button size="sm" onClick={openNewWidget}><Plus className="w-4 h-4 mr-1" /> Widget</Button>}
            {activeTab === "Metas" && <Button size="sm" onClick={openNewGoal}><Plus className="w-4 h-4 mr-1" /> Meta</Button>}
            {activeTab === "Alertas" && <Button size="sm" onClick={openNewAlert}><Plus className="w-4 h-4 mr-1" /> Alerta</Button>}
          </div>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard label="Dashboards" value={dashboards.length} icon={LayoutDashboard} color="primary" sub={`${dashWidgets.length} widgets activos`} />
        <KPICard label="Widgets" value={widgets.length} icon={BarChart3} color="blue" sub="en todos los dashboards" />
        <KPICard label="Metas" value={goals.length} icon={Target} color={goals.filter(g => g.status === "achieved").length > 0 ? "success" : "warning"} sub={`${goals.filter(g => g.status === "achieved").length} alcanzadas`} />
        <KPICard label="Alertas activas" value={alerts.filter(a => a.is_active).length} icon={Bell} color={alerts.filter(a => a.is_active).length > 0 ? "warning" : "success"} sub={`${alerts.length} en total`} />
      </div>

      {/* tabs */}
      <div className="flex gap-1 bg-muted/30 rounded-lg p-1 w-fit border border-border/40">
        {TABS.map(t => (
          <button key={t} onClick={() => setActiveTab(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === t ? "bg-card border border-border/60 text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {/* ── Dashboards tab ── */}
          {activeTab === "Dashboards" && (
            <div className="space-y-4 pb-12">
              {/* dashboard selector */}
              <div className="flex gap-2 flex-wrap">
                {dashboards.map(d => (
                  <button key={d.id} onClick={() => setActiveDashId(d.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-all ${activeDashId === d.id ? "bg-blue-600 text-white border-blue-600" : "bg-card text-foreground/80 hover:border-blue-400"}`}>
                    {d.is_default && <Star className="w-3.5 h-3.5" />}
                    {d.name}
                    <span onClick={(e) => { e.stopPropagation(); openEditDash(d); }}
                      className="ml-1 opacity-60 hover:opacity-100"><Settings2 className="w-3.5 h-3.5" /></span>
                    <span onClick={(e) => { e.stopPropagation(); deleteDash(d); }}
                      className="opacity-60 hover:opacity-100 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></span>
                  </button>
                ))}
                {dashboards.length === 0 && (
                  <p className="text-muted-foreground text-sm">No hay dashboards. Creá uno para empezar.</p>
                )}
              </div>

              {/* widget grid */}
              {activeDashId && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-4">
                  {dashWidgets.map(w => (
                    <WidgetCard key={w.id} widget={w} liveValues={liveValues}
                      onEdit={() => openEditWidget(w)}
                      onDelete={() => deleteWidget(w.id)}
                      onToggleVisibility={() => toggleWidgetVisibility(w)}
                    />
                  ))}
                  <button onClick={openNewWidget}
                    className="border-2 border-dashed border-gray-200 rounded-xl p-6 flex flex-col items-center justify-center gap-2 text-muted-foreground/70 hover:border-blue-300 hover:text-blue-500 transition-colors min-h-[140px]">
                    <Plus className="w-6 h-6" />
                    <span className="text-sm font-medium">Agregar widget</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── Widgets tab ── */}
          {activeTab === "Widgets" && (
            <div className="bg-card rounded-xl border border-border/50 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/20 text-muted-foreground">
                  <tr>
                    {["Título", "Tipo", "Fuente de datos", "Período", "Dashboard", "Visible", ""].map(h => (
                      <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {widgets.map(w => {
                    const dash = dashboards.find(d => d.id === w.dashboard_id);
                    const ds = DATA_SOURCES.find(d => d.value === w.data_source);
                    const wt = WIDGET_TYPES.find(t => t.value === w.widget_type);
                    return (
                      <tr key={w.id} className="hover:bg-muted/20">
                        <td className="px-4 py-3 font-medium text-foreground">{w.title}</td>
                        <td className="px-4 py-3 text-muted-foreground flex items-center gap-1">{wt?.icon}{wt?.label ?? w.widget_type}</td>
                        <td className="px-4 py-3 text-muted-foreground">{ds?.label ?? w.data_source}</td>
                        <td className="px-4 py-3 text-muted-foreground">{TIME_RANGES.find(t => t.value === w.time_range)?.label}</td>
                        <td className="px-4 py-3"><span className="text-xs bg-muted/40 px-2 py-0.5 rounded">{dash?.name ?? "—"}</span></td>
                        <td className="px-4 py-3">
                          <Switch checked={w.is_visible} onCheckedChange={() => toggleWidgetVisibility(w)} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2">
                            <Button variant="ghost" size="sm" onClick={() => openEditWidget(w)}><Pencil className="w-4 h-4" /></Button>
                            <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300" onClick={() => deleteWidget(w.id)}><Trash2 className="w-4 h-4" /></Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {widgets.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-12 text-muted-foreground/70">No hay widgets configurados</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Metas tab ── */}
          {activeTab === "Metas" && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {goals.map(g => {
                const pct = g.target_value > 0 ? Math.min(100, (g.current_value / g.target_value) * 100) : 0;
                const st = GOAL_STATUS_CONFIG[g.status];
                return (
                  <div key={g.id} className="bg-card rounded-xl border border-border/50 p-4 space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold text-foreground">{g.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{g.metric} · {g.unit}</p>
                      </div>
                      <Badge className={`${st.color} flex items-center gap-1 text-xs`}>{st.icon}{st.label}</Badge>
                    </div>
                    <div className="space-y-1 pb-12">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Progreso</span>
                        <span className="font-medium">{g.current_value.toLocaleString("es-AR")} / {g.target_value.toLocaleString("es-AR")} {g.unit}</span>
                      </div>
                      <div className="h-2 bg-muted/40 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: g.color }} />
                      </div>
                      <p className="text-right text-xs text-muted-foreground">{pct.toFixed(1)}%</p>
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground/70">
                      <span>{g.period_start} → {g.period_end}</span>
                      <button onClick={() => openEditGoal(g)} className="hover:text-blue-500"><Pencil className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                );
              })}
              {goals.length === 0 && (
                <div className="col-span-3 text-center py-16 text-muted-foreground/70">
                  <Target className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">Sin metas definidas</p>
                  <p className="text-sm mt-1">Creá tu primera meta para trackear el progreso</p>
                </div>
              )}
            </div>
          )}

          {/* ── Alertas tab ── */}
          {activeTab === "Alertas" && (
            <div className="bg-card rounded-xl border border-border/50 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/20 text-muted-foreground">
                  <tr>
                    {["Nombre", "Condición", "Umbral", "Notificación", "Activa", "Último disparo", ""].map(h => (
                      <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {alerts.map(a => (
                    <tr key={a.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3 font-medium text-foreground">{a.name}</td>
                      <td className="px-4 py-3 capitalize text-muted-foreground">{a.condition.replace("_", " ")}</td>
                      <td className="px-4 py-3 font-mono text-foreground/80">{a.threshold.toLocaleString("es-AR")}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-xs">{a.notification_type}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Switch checked={a.is_active} onCheckedChange={() => toggleAlert(a)} />
                      </td>
                      <td className="px-4 py-3 text-muted-foreground/70 text-xs">
                        {a.last_triggered ? new Date(a.last_triggered).toLocaleDateString("es-AR") : "Nunca"}
                      </td>
                      <td className="px-4 py-3">
                        <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300"
                          onClick={() => supabase.from("kpi_alerts").delete().eq("id", a.id).then(load)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {alerts.length === 0 && (
                    <tr><td colSpan={7} className="text-center py-12 text-muted-foreground/70">Sin alertas configuradas</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── Dashboard Dialog ── */}
      <Dialog open={showDashDialog} onOpenChange={setShowDashDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingDash ? "Editar Dashboard" : "Nuevo Dashboard"}</DialogTitle></DialogHeader>
          <div className="space-y-4 pb-12">
            <div><Label>Nombre *</Label><Input value={dashForm.name} onChange={e => setDashForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div><Label>Descripción</Label><Input value={dashForm.description} onChange={e => setDashForm(p => ({ ...p, description: e.target.value }))} /></div>
            <div className="flex items-center gap-3">
              <Switch checked={dashForm.is_default} onCheckedChange={v => setDashForm(p => ({ ...p, is_default: v }))} />
              <Label>Dashboard predeterminado</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDashDialog(false)}>Cancelar</Button>
            <Button onClick={saveDash}>{editingDash ? "Guardar" : "Crear"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Widget Dialog ── */}
      <Dialog open={showWidgetDialog} onOpenChange={setShowWidgetDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingWidget ? "Editar Widget" : "Nuevo Widget"}</DialogTitle></DialogHeader>
          <div className="space-y-4 pb-12">
            <div><Label>Título *</Label><Input value={widgetForm.title} onChange={e => setWidgetForm(p => ({ ...p, title: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tipo de widget</Label>
                <Select value={widgetForm.widget_type} onValueChange={v => setWidgetForm(p => ({ ...p, widget_type: v as WidgetType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{WIDGET_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Período</Label>
                <Select value={widgetForm.time_range} onValueChange={v => setWidgetForm(p => ({ ...p, time_range: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{TIME_RANGES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Fuente de datos</Label>
              <Select value={widgetForm.data_source} onValueChange={v => setWidgetForm(p => ({ ...p, data_source: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from(new Set(DATA_SOURCES.map(d => d.category))).map(cat => (
                    <div key={cat}>
                      <p className="text-xs font-semibold text-muted-foreground/70 px-2 py-1 uppercase">{cat}</p>
                      {DATA_SOURCES.filter(d => d.category === cat).map(d => (
                        <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                      ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Ancho (columnas)</Label>
                <Select value={String(widgetForm.width)} onValueChange={v => setWidgetForm(p => ({ ...p, width: Number(v) }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{[1,2,3,4].map(n => <SelectItem key={n} value={String(n)}>{n} col</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Alto (filas)</Label>
                <Select value={String(widgetForm.height)} onValueChange={v => setWidgetForm(p => ({ ...p, height: Number(v) }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{[1,2,3,4].map(n => <SelectItem key={n} value={String(n)}>{n} fila{n>1?"s":""}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWidgetDialog(false)}>Cancelar</Button>
            <Button onClick={saveWidget}>{editingWidget ? "Guardar" : "Agregar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Goal Dialog ── */}
      <Dialog open={showGoalDialog} onOpenChange={setShowGoalDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingGoal ? "Editar Meta" : "Nueva Meta"}</DialogTitle></DialogHeader>
          <div className="space-y-3 pb-12">
            <div><Label>Nombre *</Label><Input value={goalForm.name} onChange={e => setGoalForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Métrica</Label><Input value={goalForm.metric} onChange={e => setGoalForm(p => ({ ...p, metric: e.target.value }))} placeholder="ej. Ventas mensuales" /></div>
              <div><Label>Unidad</Label><Input value={goalForm.unit} onChange={e => setGoalForm(p => ({ ...p, unit: e.target.value }))} placeholder="$, %, unidades" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Valor objetivo *</Label><Input type="number" value={goalForm.target_value} onChange={e => setGoalForm(p => ({ ...p, target_value: e.target.value }))} /></div>
              <div><Label>Valor actual</Label><Input type="number" value={goalForm.current_value} onChange={e => setGoalForm(p => ({ ...p, current_value: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Inicio</Label><Input type="date" value={goalForm.period_start} onChange={e => setGoalForm(p => ({ ...p, period_start: e.target.value }))} /></div>
              <div><Label>Fin</Label><Input type="date" value={goalForm.period_end} onChange={e => setGoalForm(p => ({ ...p, period_end: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Estado</Label>
                <Select value={goalForm.status} onValueChange={v => setGoalForm(p => ({ ...p, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(GOAL_STATUS_CONFIG).map(([k,v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Color</Label>
                <input type="color" value={goalForm.color} onChange={e => setGoalForm(p => ({ ...p, color: e.target.value }))}
                  className="h-10 w-full rounded border cursor-pointer" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGoalDialog(false)}>Cancelar</Button>
            <Button onClick={saveGoal}>{editingGoal ? "Guardar" : "Crear"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Alert Dialog ── */}
      <Dialog open={showAlertDialog} onOpenChange={setShowAlertDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nueva Alerta KPI</DialogTitle></DialogHeader>
          <div className="space-y-4 pb-12">
            <div><Label>Nombre *</Label><Input value={alertForm.name} onChange={e => setAlertForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Condición</Label>
                <Select value={alertForm.condition} onValueChange={v => setAlertForm(p => ({ ...p, condition: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="above">Mayor que</SelectItem>
                    <SelectItem value="below">Menor que</SelectItem>
                    <SelectItem value="equals">Igual a</SelectItem>
                    <SelectItem value="change_pct">Cambio %</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Umbral</Label><Input type="number" value={alertForm.threshold} onChange={e => setAlertForm(p => ({ ...p, threshold: e.target.value }))} /></div>
            </div>
            <div>
              <Label>Tipo de notificación</Label>
              <Select value={alertForm.notification_type} onValueChange={v => setAlertForm(p => ({ ...p, notification_type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="in_app">En la app</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="both">Ambas</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAlertDialog(false)}>Cancelar</Button>
            <Button onClick={saveAlert}><Bell className="w-4 h-4 mr-1" /> Crear Alerta</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
