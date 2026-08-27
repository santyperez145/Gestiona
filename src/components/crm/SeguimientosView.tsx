// Vista «Seguimientos» del workspace de Clientes / CRM.
//
// ⚠️ Era la página FollowUpPage (/seguimiento) (ruta propia en el manifest). La consolidación
// de 2026-08-27 la convirtió en vista de /clientes: una tarea empresarial → un
// workspace → una URL canónica. La ruta vieja redirige con ?vista=. El
// contenido es el mismo; sólo se demolió el PageHeader propio a una toolbar
// compacta, porque el header de la página ahora es el de Clientes.
/**
 * FollowUpPage — /seguimiento
 *
 * The seller's "morning view": all the items that need attention today.
 * - Deals stale for X days without activity update
 * - Tasks overdue or due today
 * - Customers who haven't purchased in a long time (from CRM follow-ups)
 * - Quick-action buttons: log activity, open deal, open task
 */
import { useState, useEffect, useMemo, useCallback } from "react";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import { safeChannel } from "@/lib/realtimeChannel";
import {
  Bell, CheckSquare, Clock, TrendingUp, AlertTriangle, Users,
  RefreshCw, Phone, MessageCircle, Mail, ChevronRight, Flame,
  ArrowRight, Calendar, XCircle, CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import KPICard from "@/components/shared/KPICard";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StaleDeal {
  id: string;
  title: string;
  customer_name: string;
  value_ars: number;
  stage: string;
  daysSinceUpdate: number;
  expected_close: string | null;
  isOverdue: boolean;
}

interface OverdueTask {
  id: string;
  title: string;
  priority: "urgent" | "high" | "medium" | "low";
  due_date: string | null;
  daysOverdue: number;
  status: string;
}

interface StaleCustomer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  last_contact: string | null;
  daysSinceContact: number;
  reason: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STAGE_LABELS: Record<string, string> = {
  lead: "Lead", contactado: "Contactado", propuesta: "Propuesta",
  negociacion: "Negociación", cerrado: "Cerrado ✓", perdido: "Perdido ✗",
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string; emoji: string }> = {
  urgent: { label: "Urgente", color: "text-red-400",    emoji: "🔴" },
  high:   { label: "Alta",    color: "text-orange-400", emoji: "🟠" },
  medium: { label: "Media",   color: "text-yellow-400", emoji: "🟡" },
  low:    { label: "Baja",    color: "text-blue-400",   emoji: "🔵" },
};

function timeAgo(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d === 0) return "Hoy";
  if (d === 1) return "Ayer";
  return `Hace ${d}d`;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SeguimientosView() {
  const { activeOrg } = useOrg();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [staleDeals, setStaleDeals] = useState<StaleDeal[]>([]);
  const [overdueTasks, setOverdueTasks] = useState<OverdueTask[]>([]);
  const [staleCustomers, setStaleCustomers] = useState<StaleCustomer[]>([]);
  const [loading, setLoading] = useState(true);
  const [staleThreshold, setStaleThreshold] = useState<number>(7); // days without update

  // Note dialog for logging follow-up
  const [noteDialog, setNoteDialog] = useState<{ dealId: string; dealTitle: string } | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const today = new Date();
    const staleThresholdDate = new Date(today);
    staleThresholdDate.setDate(staleThresholdDate.getDate() - staleThreshold);

    const [dealsRes, tasksRes, crmRes] = await Promise.all([
      // Open deals not updated in X days (excluding closed/lost)
      supabase
        .from("deals")
        .select("id, title, customer_name, value_ars, stage, updated_at, expected_close")
        .eq("org_id", activeOrg.id)
        .not("stage", "in", '("cerrado","perdido")')
        .lte("updated_at", staleThresholdDate.toISOString())
        .order("updated_at", { ascending: true })
        .limit(50),

      // Tasks: overdue (due_date < today) or due today, not completed
      supabase
        .from("tasks")
        .select("id, title, priority, due_date, status")
        .eq("org_id", activeOrg.id)
        .lte("due_date", today.toISOString().slice(0, 10))
        .not("status", "eq", "completed")
        .order("due_date", { ascending: true })
        .limit(50),

      // CRM follow-ups: customers where next_follow_up is overdue
      supabase
        .from("crm_followups")
        .select("id, customer_name, customer_email, customer_phone, follow_up_date, notes, status")
        .eq("org_id", activeOrg.id)
        .neq("status", "done")
        .lte("follow_up_date", today.toISOString().slice(0, 10))
        .order("follow_up_date", { ascending: true })
        .limit(30),
    ]);

    // Process stale deals
    const sd: StaleDeal[] = (dealsRes.data || []).map((d: any) => {
      const days = Math.floor((Date.now() - new Date(d.updated_at).getTime()) / 86400000);
      const isOverdue = d.expected_close && new Date(d.expected_close) < today;
      return { ...d, daysSinceUpdate: days, isOverdue: !!isOverdue };
    });
    setStaleDeals(sd);

    // Process overdue tasks
    const ot: OverdueTask[] = (tasksRes.data || []).map((t: any) => {
      const daysOverdue = t.due_date
        ? Math.floor((Date.now() - new Date(t.due_date).getTime()) / 86400000)
        : 0;
      return { ...t, daysOverdue: Math.max(0, daysOverdue) };
    });
    setOverdueTasks(ot);

    // Process CRM follow-ups
    const sc: StaleCustomer[] = (crmRes.data || []).map((c: any) => {
      const days = c.follow_up_date
        ? Math.floor((Date.now() - new Date(c.follow_up_date).getTime()) / 86400000)
        : 0;
      return {
        id: c.id,
        name: c.customer_name,
        email: c.customer_email,
        phone: c.customer_phone,
        last_contact: c.follow_up_date,
        daysSinceContact: Math.max(0, days),
        reason: c.notes,
      };
    });
    setStaleCustomers(sc);
    setLoading(false);
  }, [activeOrg, staleThreshold]);

  useEffect(() => { load(); }, [load]);

  const totalAttention = staleDeals.length + overdueTasks.length + staleCustomers.length;
  const urgentCount = overdueTasks.filter(t => t.priority === "urgent").length +
    staleDeals.filter(d => d.isOverdue).length;

  // Log follow-up note on a deal
  const saveNote = async () => {
    if (!noteDialog || !noteText.trim() || !user || !activeOrg) return;
    setNoteSaving(true);
    const { error } = await supabase.from("deal_activities").insert({
      org_id: activeOrg.id,
      deal_id: noteDialog.dealId,
      user_id: user.id,
      type: "note",
      content: noteText.trim(),
    });
    if (error) {
      toast.error("Error al guardar nota");
    } else {
      // Also update deal.updated_at so it's no longer stale
      await supabase.from("deals")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", noteDialog.dealId);
      toast.success("Seguimiento registrado");
      setNoteDialog(null);
      setNoteText("");
      load();
    }
    setNoteSaving(false);
  };

  // Mark CRM follow-up as done
  const markFollowUpDone = async (id: string) => {
    await supabase.from("crm_followups").update({ status: "done" }).eq("id", id);
    setStaleCustomers(prev => prev.filter(c => c.id !== id));
    toast.success("Follow-up marcado como completado");
  };

  // Mark task as completed
  const completeTask = async (id: string) => {
    await supabase.from("tasks")
      .update({ status: "completed", updated_at: new Date().toISOString() })
      .eq("id", id);
    setOverdueTasks(prev => prev.filter(t => t.id !== id));
    toast.success("Tarea completada");
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Toolbar de la vista: el header de la página es el de Clientes. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Bell className="w-4 h-4" /> Centro de Seguimiento
            {urgentCount > 0 && (
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-red-500/15 text-red-400">
                {urgentCount} urgente{urgentCount > 1 ? "s" : ""}
              </span>
            )}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Deals sin actividad, tareas vencidas y clientes pendientes de contacto</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-muted-foreground">Deals estancados:</span>
          <Select value={String(staleThreshold)} onValueChange={v => setStaleThreshold(Number(v))}>
            <SelectTrigger className="w-28 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">3 días</SelectItem>
              <SelectItem value="5">5 días</SelectItem>
              <SelectItem value="7">7 días</SelectItem>
              <SelectItem value="14">14 días</SelectItem>
              <SelectItem value="30">30 días</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="gap-1" onClick={load}>
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          label="Requieren atención"
          value={totalAttention}
          icon={Bell}
          color={urgentCount > 0 ? "destructive" : "success"}
          sub={urgentCount > 0 ? `${urgentCount} urgentes` : "Sin urgentes"}
        />
        <KPICard
          label="Deals estancados"
          value={staleDeals.length}
          icon={TrendingUp}
          color={staleDeals.length > 0 ? "warning" : "success"}
          sub={`Sin actividad +${staleThreshold}d`}
        />
        <KPICard
          label="Tareas vencidas"
          value={overdueTasks.length}
          icon={CheckSquare}
          color={overdueTasks.length > 0 ? "destructive" : "success"}
          sub="con fecha pasada"
        />
        <KPICard
          label="Seguimientos CRM"
          value={staleCustomers.length}
          icon={Users}
          color={staleCustomers.length > 0 ? "warning" : "success"}
          sub="clientes sin contacto"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground text-sm gap-2">
          <RefreshCw className="w-4 h-4 animate-spin" /> Cargando…
        </div>
      ) : totalAttention === 0 ? (
        <div className="text-center py-20">
          <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-emerald-400/40" />
          <p className="text-lg font-semibold text-muted-foreground">¡Todo al día! 🎉</p>
          <p className="text-sm text-muted-foreground mt-1">No hay items pendientes de seguimiento</p>
        </div>
      ) : (
        <div className="space-y-6 pb-12">

          {/* ── Overdue Tasks ──────────────────────────────────────────── */}
          {overdueTasks.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <CheckSquare className="w-4 h-4 text-red-400" />
                <h2 className="text-sm font-semibold">Tareas vencidas</h2>
                <Badge variant="outline" className="text-[10px] text-red-400 border-red-400/30">{overdueTasks.length}</Badge>
              </div>
              <div className="space-y-2 pb-12">
                {overdueTasks.map(task => {
                  const pCfg = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium;
                  return (
                    <div key={task.id} className="flex items-center gap-3 p-3.5 bg-card border border-border/60 rounded-xl hover:border-border transition-colors group">
                      <span className="text-base shrink-0">{pCfg.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{task.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {task.due_date
                            ? task.daysOverdue === 0 ? "Vence hoy" : `Venció hace ${task.daysOverdue}d`
                            : "Sin fecha"}
                          <span className={`ml-2 ${pCfg.color}`}>{pCfg.label}</span>
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs gap-1 opacity-0 group-hover:opacity-100 transition-opacity text-emerald-400 hover:text-emerald-300"
                        onClick={() => completeTask(task.id)}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Completar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => navigate("/tareas")}
                      >
                        Ver <ArrowRight className="w-3 h-3" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── Stale Deals ────────────────────────────────────────────── */}
          {staleDeals.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp className="w-4 h-4 text-orange-400" />
                <h2 className="text-sm font-semibold">Deals sin actividad</h2>
                <Badge variant="outline" className="text-[10px] text-orange-400 border-orange-400/30">{staleDeals.length}</Badge>
                <span className="text-xs text-muted-foreground">(+{staleThreshold} días sin actualizar)</span>
              </div>
              <div className="space-y-2 pb-12">
                {staleDeals.map(deal => (
                  <div
                    key={deal.id}
                    className="flex items-start gap-3 p-3.5 bg-card border border-border/60 rounded-xl hover:border-border transition-colors group"
                  >
                    {/* Urgency indicator */}
                    <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                      deal.isOverdue ? "bg-red-400" :
                      deal.daysSinceUpdate >= 14 ? "bg-orange-400" : "bg-yellow-400"
                    }`} />

                    {/* Deal info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium leading-snug truncate">{deal.title}</p>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {deal.daysSinceUpdate}d sin act.
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {deal.customer_name && (
                          <span className="text-xs text-muted-foreground">{deal.customer_name}</span>
                        )}
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="text-xs text-muted-foreground">{STAGE_LABELS[deal.stage] ?? deal.stage}</span>
                        {deal.value_ars > 0 && (
                          <>
                            <span className="text-xs text-muted-foreground">·</span>
                            <span className="text-xs font-semibold text-emerald-400">{formatARS(deal.value_ars)}</span>
                          </>
                        )}
                        {deal.isOverdue && (
                          <Badge variant="outline" className="text-[9px] text-red-400 border-red-400/30 ml-1">
                            Fecha vencida
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        title="Registrar seguimiento"
                        onClick={() => {
                          setNoteDialog({ dealId: deal.id, dealTitle: deal.title });
                          setNoteText("");
                        }}
                      >
                        <StickyNote className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs gap-1"
                        onClick={() => navigate("/clientes?vista=pipeline")}
                      >
                        Ver <ArrowRight className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── CRM Follow-ups ─────────────────────────────────────────── */}
          {staleCustomers.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Users className="w-4 h-4 text-blue-400" />
                <h2 className="text-sm font-semibold">Follow-ups pendientes</h2>
                <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-400/30">{staleCustomers.length}</Badge>
              </div>
              <div className="space-y-2 pb-12">
                {staleCustomers.map(c => (
                  <div key={c.id} className="flex items-start gap-3 p-3.5 bg-card border border-border/60 rounded-xl hover:border-border transition-colors group">
                    {/* Avatar */}
                    <div className="w-8 h-8 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0 mt-0.5">
                      <span className="text-xs font-bold text-blue-400">{c.name.charAt(0).toUpperCase()}</span>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{c.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {c.daysSinceContact === 0 ? "Vence hoy" : `Venció hace ${c.daysSinceContact}d`}
                        {c.reason && <span className="ml-1.5 opacity-70">— {c.reason}</span>}
                      </p>
                    </div>

                    {/* Contact actions */}
                    <div className="flex gap-1 shrink-0">
                      {c.phone && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          title="WhatsApp"
                          onClick={() => window.open(`https://wa.me/${c.phone?.replace(/\D/g, "")}`, "_blank")}
                        >
                          <MessageCircle className="w-3.5 h-3.5 text-green-400" />
                        </Button>
                      )}
                      {c.email && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2"
                          title="Email"
                          onClick={() => window.open(`mailto:${c.email}`, "_blank")}
                        >
                          <Mail className="w-3.5 h-3.5 text-blue-400" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs gap-1 text-emerald-400 hover:text-emerald-300 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => markFollowUpDone(c.id)}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Hecho
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

        </div>
      )}

      {/* ─── Note Dialog ─────────────────────────────────────────────── */}
      <Dialog open={!!noteDialog} onOpenChange={v => { if (!v) setNoteDialog(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Registrar seguimiento</DialogTitle>
          </DialogHeader>
          {noteDialog && (
            <div className="space-y-3 pb-12">
              <p className="text-xs text-muted-foreground truncate">{noteDialog.dealTitle}</p>
              <Textarea
                placeholder="Ej: Llamé al cliente, está evaluando la propuesta. Seguimiento en 3 días…"
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                rows={4}
                className="text-sm resize-none"
              />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setNoteDialog(null)}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  className="flex-1 gradient-gold text-primary-foreground"
                  disabled={!noteText.trim() || noteSaving}
                  onClick={saveNote}
                >
                  {noteSaving ? "Guardando…" : "Guardar nota"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Inline component for StickyNote icon (not in lucide imports above)
function StickyNote({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/>
      <path d="M15 3v6h6"/>
    </svg>
  );
}
