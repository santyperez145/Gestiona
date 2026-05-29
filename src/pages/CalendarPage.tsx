/**
 * CalendarPage — /calendario
 *
 * Unified business calendar showing tasks, deal close dates,
 * CRM follow-ups, debt due dates, and recurring expenses.
 * CSS-only calendar grid — no external library required.
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import { useOrg } from "@/lib/orgContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import {
  Calendar, ChevronLeft, ChevronRight, CheckSquare,
  TrendingUp, Users, AlertCircle, DollarSign, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { useNavigate } from "react-router-dom";

// ─── Types ────────────────────────────────────────────────────────────────────

type EventType = "task" | "deal" | "followup" | "debt" | "expense";

interface CalEvent {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  type: EventType;
  priority?: string;
  amount?: number;
  link: string;
}

const EVENT_CONFIG: Record<EventType, { color: string; bg: string; dot: string; icon: typeof Calendar; label: string }> = {
  task:     { color: "text-purple-400",  bg: "bg-purple-500/15",   dot: "bg-purple-400",   icon: CheckSquare, label: "Tarea" },
  deal:     { color: "text-yellow-400",  bg: "bg-yellow-500/15",   dot: "bg-yellow-400",   icon: TrendingUp,  label: "Deal" },
  followup: { color: "text-blue-400",    bg: "bg-blue-500/15",     dot: "bg-blue-400",     icon: Users,       label: "Follow-up" },
  debt:     { color: "text-red-400",     bg: "bg-red-500/15",      dot: "bg-red-400",      icon: AlertCircle, label: "Cobro" },
  expense:  { color: "text-orange-400",  bg: "bg-orange-500/15",   dot: "bg-orange-400",   icon: DollarSign,  label: "Gasto" },
};

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const MONTHS_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
                   "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  usePageTitle("Calendario de Negocios");
  const { activeOrg } = useOrg();
  const navigate = useNavigate();

  const [currentMonth, setCurrentMonth] = useState(new Date(_getToday().getFullYear(), _getToday().getMonth(), 1));
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string | null>(isoDate(_getToday()));

  function _getToday(): Date { return new Date(); }

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);

    // Load 3 months of data: prev + current + next
    const rangeStart = addMonths(currentMonth, -1);
    const rangeEnd   = addMonths(currentMonth, 2);

    const [tasksRes, dealsRes, followupsRes, debtsRes, expensesRes] = await Promise.all([
      supabase
        .from("tasks")
        .select("id, title, due_date, priority, status")
        .eq("org_id", activeOrg.id)
        .not("status", "eq", "completed")
        .not("due_date", "is", null)
        .gte("due_date", isoDate(rangeStart))
        .lte("due_date", isoDate(rangeEnd)),
      supabase
        .from("deals")
        .select("id, title, expected_close, stage, value_ars")
        .eq("org_id", activeOrg.id)
        .not("expected_close", "is", null)
        .not("stage", "in", '("cerrado","perdido")')
        .gte("expected_close", isoDate(rangeStart))
        .lte("expected_close", isoDate(rangeEnd)),
      supabase
        .from("crm_followups")
        .select("id, customer_name, follow_up_date, notes, status")
        .eq("org_id", activeOrg.id)
        .neq("status", "done")
        .gte("follow_up_date", isoDate(rangeStart))
        .lte("follow_up_date", isoDate(rangeEnd)),
      supabase
        .from("customer_debts")
        .select("id, customer_name, amount_ars, due_date, paid")
        .eq("org_id", activeOrg.id)
        .eq("paid", false)
        .not("due_date", "is", null)
        .gte("due_date", isoDate(rangeStart))
        .lte("due_date", isoDate(rangeEnd)),
      supabase
        .from("expenses")
        .select("id, description, amount_ars, date, category, recurring")
        .eq("org_id", activeOrg.id)
        .eq("recurring", true)
        .gte("date", isoDate(rangeStart))
        .lte("date", isoDate(rangeEnd)),
    ]);

    const allEvents: CalEvent[] = [];

    (tasksRes.data || []).forEach((t: any) => {
      if (!t.due_date) return;
      allEvents.push({
        id: `task-${t.id}`,
        date: t.due_date.slice(0, 10),
        title: t.title,
        type: "task",
        priority: t.priority,
        link: "/tareas",
      });
    });

    (dealsRes.data || []).forEach((d: any) => {
      if (!d.expected_close) return;
      allEvents.push({
        id: `deal-${d.id}`,
        date: d.expected_close.slice(0, 10),
        title: d.title,
        type: "deal",
        amount: d.value_ars,
        link: "/pipeline",
      });
    });

    (followupsRes.data || []).forEach((f: any) => {
      if (!f.follow_up_date) return;
      allEvents.push({
        id: `fu-${f.id}`,
        date: f.follow_up_date.slice(0, 10),
        title: `Follow-up: ${f.customer_name}`,
        type: "followup",
        link: "/seguimiento",
      });
    });

    (debtsRes.data || []).forEach((d: any) => {
      if (!d.due_date || d.paid) return;
      allEvents.push({
        id: `debt-${d.id}`,
        date: d.due_date.slice(0, 10),
        title: `Cobrar a ${d.customer_name}`,
        type: "debt",
        amount: d.amount_ars,
        link: "/deudas",
      });
    });

    (expensesRes.data || []).forEach((e: any) => {
      if (!e.date) return;
      allEvents.push({
        id: `exp-${e.id}`,
        date: e.date.slice(0, 10),
        title: e.description || e.category || "Gasto recurrente",
        type: "expense",
        amount: e.amount_ars,
        link: "/gastos",
      });
    });

    setEvents(allEvents);
    setLoading(false);
  }, [activeOrg, currentMonth]);

  useEffect(() => { load(); }, [load]);

  // Build calendar grid
  const calendarDays = useMemo(() => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    // Monday = 0 in our grid (ISO week start)
    let startDow = firstDay.getDay(); // 0=Sun, 1=Mon...
    startDow = startDow === 0 ? 6 : startDow - 1; // convert to Mon=0

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days: { date: string; dayNum: number; inMonth: boolean }[] = [];

    // Pad start
    for (let i = startDow - 1; i >= 0; i--) {
      const d = new Date(year, month, -i);
      days.push({ date: isoDate(d), dayNum: d.getDate(), inMonth: false });
    }
    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month, d);
      days.push({ date: isoDate(dateObj), dayNum: d, inMonth: true });
    }
    // Pad end to complete 6 weeks (42 cells)
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(year, month + 1, i);
      days.push({ date: isoDate(d), dayNum: i, inMonth: false });
    }
    return days;
  }, [currentMonth]);

  // Map date → events
  const eventsByDate = useMemo(() => {
    const map: Record<string, CalEvent[]> = {};
    events.forEach(e => {
      if (!map[e.date]) map[e.date] = [];
      map[e.date].push(e);
    });
    return map;
  }, [events]);

  const selectedEvents = selectedDate ? (eventsByDate[selectedDate] || []) : [];
  const today = isoDate(new Date());

  const totalThisMonth = useMemo(() => {
    const monthStr = isoDate(currentMonth).slice(0, 7);
    return events.filter(e => e.date.startsWith(monthStr));
  }, [events, currentMonth]);

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Calendar}
        title="Calendario de Negocios"
        description="Vista unificada de tareas, deals, follow-ups y cobros"
        actions={
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="w-3.5 h-3.5" /></Button>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard label="Eventos este mes" value={totalThisMonth.length} icon={Calendar} color="primary" sub={`en ${MONTHS_ES[currentMonth.getMonth()]}`} />
        <KPICard label="Tareas" value={totalThisMonth.filter(e => e.type === "task").length} icon={CheckSquare} color="purple" sub="pendientes" />
        <KPICard label="Cobros" value={totalThisMonth.filter(e => e.type === "debt").length} icon={AlertCircle} color={totalThisMonth.filter(e => e.type === "debt").length > 0 ? "destructive" : "success"} sub="deudas por cobrar" />
        <KPICard label="Deals & Follow-ups" value={totalThisMonth.filter(e => e.type === "deal" || e.type === "followup").length} icon={TrendingUp} color="warning" sub="en seguimiento" />
      </div>

      {/* Legend */}
      <div className="flex gap-3 flex-wrap">
        {(Object.entries(EVENT_CONFIG) as [EventType, typeof EVENT_CONFIG[EventType]][]).map(([type, cfg]) => {
          const count = totalThisMonth.filter(e => e.type === type).length;
          if (count === 0) return null;
          return (
            <div key={type} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
              {cfg.label} ({count})
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Calendar */}
        <div className="lg:col-span-2">
          <div className="bg-card border border-border/60 rounded-2xl overflow-hidden">
            {/* Month nav */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
              <Button variant="ghost" size="sm" onClick={() => setCurrentMonth(m => addMonths(m, -1))}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <h2 className="text-sm font-semibold">
                {MONTHS_ES[currentMonth.getMonth()]} {currentMonth.getFullYear()}
              </h2>
              <Button variant="ghost" size="sm" onClick={() => setCurrentMonth(m => addMonths(m, 1))}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>

            {/* Weekday headers */}
            <div className="grid grid-cols-7 border-b border-border/30">
              {WEEKDAYS.map(d => (
                <div key={d} className="text-center text-[10px] font-semibold text-muted-foreground py-2">
                  {d}
                </div>
              ))}
            </div>

            {/* Days grid */}
            {loading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground text-sm gap-2">
                <RefreshCw className="w-4 h-4 animate-spin" /> Cargando…
              </div>
            ) : (
              <div className="grid grid-cols-7">
                {calendarDays.map((day, idx) => {
                  const dayEvents = eventsByDate[day.date] || [];
                  const isToday = day.date === today;
                  const isSelected = day.date === selectedDate;
                  const hasEvents = dayEvents.length > 0;
                  const maxDots = 3;
                  const typesInDay = [...new Set(dayEvents.map(e => e.type))].slice(0, maxDots);

                  return (
                    <button
                      key={idx}
                      onClick={() => setSelectedDate(day.date === selectedDate ? null : day.date)}
                      className={`
                        min-h-[64px] p-1.5 border-b border-r border-border/20 text-left flex flex-col
                        transition-colors hover:bg-muted/20
                        ${!day.inMonth ? "opacity-30" : ""}
                        ${isSelected ? "bg-primary/10 ring-1 ring-inset ring-primary/30" : ""}
                      `}
                    >
                      {/* Day number */}
                      <span className={`
                        text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full mb-1
                        ${isToday ? "bg-primary text-primary-foreground" : "text-muted-foreground"}
                      `}>
                        {day.dayNum}
                      </span>

                      {/* Event dots */}
                      <div className="flex gap-0.5 flex-wrap">
                        {typesInDay.map(type => (
                          <span key={type} className={`w-1.5 h-1.5 rounded-full ${EVENT_CONFIG[type].dot}`} />
                        ))}
                        {dayEvents.length > maxDots && (
                          <span className="text-[8px] text-muted-foreground">+{dayEvents.length - maxDots}</span>
                        )}
                      </div>

                      {/* Event titles (small) */}
                      <div className="hidden sm:block space-y-0.5 mt-0.5">
                        {dayEvents.slice(0, 2).map(ev => {
                          const cfg = EVENT_CONFIG[ev.type];
                          return (
                            <div
                              key={ev.id}
                              className={`text-[9px] px-1 py-0.5 rounded ${cfg.bg} ${cfg.color} truncate leading-tight`}
                            >
                              {ev.title}
                            </div>
                          );
                        })}
                        {dayEvents.length > 2 && (
                          <div className="text-[9px] text-muted-foreground pl-1">+{dayEvents.length - 2} más</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Day detail panel */}
        <div className="space-y-3 pb-12">
          <div className="bg-card border border-border/60 rounded-2xl p-4">
            {selectedDate ? (
              <>
                <h3 className="text-sm font-semibold mb-3">
                  {new Date(selectedDate + "T12:00:00").toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}
                </h3>
                {selectedEvents.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">Sin eventos este día</p>
                ) : (
                  <div className="space-y-2 pb-12">
                    {selectedEvents.map(ev => {
                      const cfg = EVENT_CONFIG[ev.type];
                      const Icon = cfg.icon;
                      return (
                        <button
                          key={ev.id}
                          onClick={() => { /* navigate(ev.link) */ }}
                          className={`w-full flex items-start gap-2.5 p-2.5 rounded-xl ${cfg.bg} text-left hover:opacity-80 transition-opacity`}
                        >
                          <Icon className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${cfg.color}`} />
                          <div className="min-w-0 flex-1">
                            <p className={`text-xs font-medium truncate ${cfg.color}`}>{ev.title}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-muted-foreground">{cfg.label}</span>
                              {ev.amount && ev.amount > 0 && (
                                <span className="text-[10px] text-emerald-400 font-semibold">{formatARS(ev.amount)}</span>
                              )}
                              {ev.priority && (
                                <span className={`text-[9px] font-semibold ${
                                  ev.priority === "urgent" ? "text-red-400" :
                                  ev.priority === "high" ? "text-orange-400" : "text-muted-foreground"
                                }`}>{ev.priority}</span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-8">
                <Calendar className="w-8 h-8 mx-auto mb-2 text-muted-foreground/20" />
                <p className="text-xs text-muted-foreground">Seleccioná un día para ver los eventos</p>
              </div>
            )}
          </div>

          {/* Upcoming events */}
          <div className="bg-card border border-border/60 rounded-2xl p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-primary" /> Próximos 7 días
            </h3>
            {(() => {
              const upcoming: CalEvent[] = [];
              for (let i = 0; i <= 7; i++) {
                const d = new Date();
                d.setDate(d.getDate() + i);
                const ds = isoDate(d);
                (eventsByDate[ds] || []).forEach(e => upcoming.push(e));
              }
              if (upcoming.length === 0) {
                return <p className="text-xs text-muted-foreground text-center py-4">Sin eventos próximos</p>;
              }
              return (
                <div className="space-y-2 pb-12">
                  {upcoming.slice(0, 8).map(ev => {
                    const cfg = EVENT_CONFIG[ev.type];
                    const Icon = cfg.icon;
                    const daysFromNow = Math.floor((new Date(ev.date + "T12:00:00").getTime() - Date.now()) / 86400000);
                    return (
                      <div key={ev.id} className="flex items-start gap-2 py-1.5 border-b border-border/20 last:border-0">
                        <Icon className={`w-3 h-3 shrink-0 mt-0.5 ${cfg.color}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs truncate">{ev.title}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {daysFromNow === 0 ? "Hoy" : daysFromNow === 1 ? "Mañana" : `En ${daysFromNow}d`}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
