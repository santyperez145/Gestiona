import { useState, useEffect, useCallback } from "react";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useClipboard } from "@/hooks/useClipboard";
import { formatDistanceToNow, differenceInHours, differenceInMinutes } from "date-fns";
import { es } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Headphones, Plus, Search, ChevronDown, ChevronUp, Send, Clock, CheckCircle2,
  AlertTriangle, Loader2, MessageSquare, X, User, Tag, ArrowRight, Filter,
  Zap, ShieldAlert, LifeBuoy, Inbox, CheckCheck, Eye, Edit2, Flame,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type TicketStatus = "open" | "in_progress" | "waiting_customer" | "resolved" | "closed";
type TicketPriority = "low" | "medium" | "high" | "urgent";
type TicketCategory = "technical" | "billing" | "general" | "returns" | "shipping" | "other";

interface Ticket {
  id: string;
  ticket_number: string;
  title: string;
  description: string | null;
  status: TicketStatus;
  priority: TicketPriority;
  category: TicketCategory;
  customer_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  resolved_at: string | null;
  first_response_at: string | null;
  sla_breach: boolean;
  sla_due_at: string | null;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
}

interface TicketMessage {
  id: string;
  ticket_id: string;
  author_name: string;
  author_type: "agent" | "customer" | "system";
  body: string;
  is_internal: boolean;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<TicketStatus, { label: string; color: string; icon: typeof Inbox }> = {
  open:             { label: "Abierto",          color: "bg-blue-500/10 text-blue-400 border-blue-500/20",    icon: Inbox },
  in_progress:      { label: "En progreso",       color: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20", icon: Zap },
  waiting_customer: { label: "Esperando cliente", color: "bg-purple-500/10 text-purple-400 border-purple-500/20", icon: Clock },
  resolved:         { label: "Resuelto",          color: "bg-green-500/10 text-green-400 border-green-500/20",  icon: CheckCircle2 },
  closed:           { label: "Cerrado",           color: "bg-muted/50 text-muted-foreground border-border",    icon: CheckCheck },
};

const PRIORITY_CONFIG: Record<TicketPriority, { label: string; color: string; dot: string }> = {
  low:    { label: "Baja",    color: "text-muted-foreground", dot: "bg-muted-foreground" },
  medium: { label: "Media",   color: "text-blue-400",         dot: "bg-blue-400" },
  high:   { label: "Alta",    color: "text-orange-400",       dot: "bg-orange-400" },
  urgent: { label: "Urgente", color: "text-red-400",          dot: "bg-red-400" },
};

const CATEGORY_LABELS: Record<TicketCategory, string> = {
  technical: "Técnico",
  billing:   "Facturación",
  general:   "General",
  returns:   "Devoluciones",
  shipping:  "Envíos",
  other:     "Otro",
};

// SLA hours by priority
const SLA_HOURS: Record<TicketPriority, number> = {
  urgent: 4,
  high:   8,
  medium: 24,
  low:    72,
};

const EMPTY_FORM = {
  title: "",
  description: "",
  priority: "medium" as TicketPriority,
  category: "general" as TicketCategory,
  customer_name: "",
  customer_email: "",
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function slaLabel(ticket: Ticket): { text: string; urgent: boolean } | null {
  if (!ticket.sla_due_at) return null;
  const now = new Date();
  const due = new Date(ticket.sla_due_at);
  if (ticket.status === "resolved" || ticket.status === "closed") return null;
  const hrs = differenceInHours(due, now);
  const mins = differenceInMinutes(due, now);
  if (mins <= 0) return { text: `SLA vencido hace ${formatDistanceToNow(due, { locale: es })}`, urgent: true };
  if (hrs < 2) return { text: `SLA en ${mins}m`, urgent: true };
  if (hrs < 8) return { text: `SLA en ${hrs}h`, urgent: false };
  return null;
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
export default function SupportPage() {
  usePageTitle("Soporte");

  const { activeOrg, activeRole } = useOrg();
  const { user } = useAuth();
  const { copy } = useClipboard();

  const [tickets, setTickets]       = useState<Ticket[]>([]);
  const [loading, setLoading]       = useState(true);
  const [expanded, setExpanded]     = useState<string | null>(null);
  const [messages, setMessages]     = useState<Record<string, TicketMessage[]>>({});
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [reply, setReply]           = useState("");
  const [replyInternal, setReplyInternal] = useState(false);
  const [sending, setSending]       = useState(false);
  const [showForm, setShowForm]     = useState(false);
  const [form, setForm]             = useState({ ...EMPTY_FORM });
  const [saving, setSaving]         = useState(false);
  const [search, setSearch]         = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");

  const canManage = activeRole === "owner" || activeRole === "admin";

  // ── Load tickets ──────────────────────────────────────────
  const loadTickets = useCallback(async () => {
    if (!activeOrg?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("support_tickets")
        .select("*")
        .eq("org_id", activeOrg.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      setTickets((data || []) as Ticket[]);
    } catch (e: any) {
      toast.error("Error cargando tickets: " + (e.message || ""));
    } finally {
      setLoading(false);
    }
  }, [activeOrg?.id]);

  useEffect(() => { loadTickets(); }, [loadTickets]);

  // ── Load messages for expanded ticket ─────────────────────
  useEffect(() => {
    if (!expanded) return;
    if (messages[expanded]) return; // already loaded
    setLoadingMsgs(true);
    supabase
      .from("support_ticket_messages")
      .select("*")
      .eq("ticket_id", expanded)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (!error) setMessages(prev => ({ ...prev, [expanded]: (data || []) as TicketMessage[] }));
        setLoadingMsgs(false);
      });
  }, [expanded]);

  // ── Realtime subscription ──────────────────────────────────
  useEffect(() => {
    if (!activeOrg?.id) return;
    const ch = supabase.channel(`support:${activeOrg.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "support_tickets", filter: `org_id=eq.${activeOrg.id}` },
        () => loadTickets())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "support_ticket_messages" },
        (payload) => {
          const msg = payload.new as TicketMessage;
          setMessages(prev => ({
            ...prev,
            [msg.ticket_id]: [...(prev[msg.ticket_id] || []), msg],
          }));
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeOrg?.id, loadTickets]);

  // ── Create ticket ──────────────────────────────────────────
  const handleCreate = async () => {
    if (!form.title.trim() || !activeOrg?.id) return;
    setSaving(true);
    try {
      // Generate ticket number: SP-YYYYMMDD-XXXX
      const d = new Date();
      const prefix = `SP-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
      const rand = Math.floor(1000 + Math.random() * 9000);
      const ticket_number = `${prefix}-${rand}`;
      const sla_due_at = new Date(Date.now() + SLA_HOURS[form.priority] * 3_600_000).toISOString();

      const { error } = await supabase.from("support_tickets").insert({
        org_id: activeOrg.id,
        ticket_number,
        title: form.title.trim(),
        description: form.description.trim() || null,
        status: "open",
        priority: form.priority,
        category: form.category,
        customer_name: form.customer_name.trim() || null,
        customer_email: form.customer_email.trim() || null,
        sla_due_at,
      });
      if (error) throw error;
      toast.success(`Ticket ${ticket_number} creado`);
      setForm({ ...EMPTY_FORM });
      setShowForm(false);
      loadTickets();
    } catch (e: any) {
      toast.error("Error: " + (e.message || ""));
    } finally {
      setSaving(false);
    }
  };

  // ── Update ticket status / priority ───────────────────────
  const updateTicket = async (id: string, patch: Partial<Ticket>) => {
    try {
      const extra: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (patch.status === "resolved") extra.resolved_at = new Date().toISOString();
      const { error } = await supabase.from("support_tickets").update({ ...patch, ...extra }).eq("id", id);
      if (error) throw error;
      setTickets(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
    } catch (e: any) {
      toast.error("Error: " + (e.message || ""));
    }
  };

  // ── Send reply ─────────────────────────────────────────────
  const handleSendReply = async () => {
    if (!reply.trim() || !expanded) return;
    setSending(true);
    try {
      const { error } = await supabase.from("support_ticket_messages").insert({
        ticket_id: expanded,
        org_id: activeOrg?.id,
        author_name: user?.email?.split("@")[0] || "Agente",
        author_type: "agent",
        body: reply.trim(),
        is_internal: replyInternal,
      });
      if (error) throw error;
      // Mark first_response_at if not set
      const ticket = tickets.find(t => t.id === expanded);
      if (ticket && !ticket.first_response_at && !replyInternal) {
        await updateTicket(expanded, { first_response_at: new Date().toISOString() } as any);
      }
      setReply("");
      toast.success(replyInternal ? "Nota interna guardada" : "Respuesta enviada");
    } catch (e: any) {
      toast.error("Error: " + (e.message || ""));
    } finally {
      setSending(false);
    }
  };

  // ── Stats ──────────────────────────────────────────────────
  const stats = {
    open: tickets.filter(t => t.status === "open").length,
    in_progress: tickets.filter(t => t.status === "in_progress").length,
    sla_breach: tickets.filter(t => t.sla_breach || (t.sla_due_at && new Date(t.sla_due_at) < new Date() && t.status !== "resolved" && t.status !== "closed")).length,
    resolved_today: tickets.filter(t => t.resolved_at && t.resolved_at.startsWith(new Date().toISOString().slice(0, 10))).length,
    avg_resolution_hrs: (() => {
      const resolved = tickets.filter(t => t.resolved_at && t.created_at);
      if (!resolved.length) return 0;
      const total = resolved.reduce((acc, t) => acc + differenceInHours(new Date(t.resolved_at!), new Date(t.created_at)), 0);
      return Math.round(total / resolved.length);
    })(),
  };

  // ── Filtered list ──────────────────────────────────────────
  const q = search.toLowerCase();
  const filtered = tickets.filter(t => {
    if (filterStatus !== "all" && t.status !== filterStatus) return false;
    if (filterPriority !== "all" && t.priority !== filterPriority) return false;
    if (q && !t.title.toLowerCase().includes(q) && !(t.customer_name || "").toLowerCase().includes(q) && !t.ticket_number.toLowerCase().includes(q)) return false;
    return true;
  });

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        icon={Headphones}
        title="Soporte al Cliente"
        description="Tickets, SLA y resolución de casos"
        badge={stats.sla_breach > 0 ? { label: `${stats.sla_breach} SLA vencido${stats.sla_breach > 1 ? "s" : ""}`, variant: "destructive" } : undefined}
        actions={
          canManage ? (
            <Button onClick={() => setShowForm(!showForm)} className="gradient-gold text-primary-foreground">
              <Plus className="w-4 h-4 mr-2" />Nuevo ticket
            </Button>
          ) : undefined
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPICard label="Abiertos" value={stats.open} icon={Inbox} color="blue" />
        <KPICard label="En progreso" value={stats.in_progress} icon={Zap} color="warning" />
        <KPICard label="SLA vencidos" value={stats.sla_breach} icon={ShieldAlert} color="destructive" />
        <KPICard label="Resueltos hoy" value={stats.resolved_today} icon={CheckCircle2} color="success" />
        <KPICard label="Resolución media" value={`${stats.avg_resolution_hrs}h`} icon={Clock} />
      </div>

      {/* Create form */}
      {showForm && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <LifeBuoy className="w-4 h-4 text-primary" />Nuevo Ticket de Soporte
            </h3>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setShowForm(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <Label className="text-xs text-muted-foreground mb-1 block">Título *</Label>
              <Input placeholder="Ej: No puedo acceder a mi cuenta..." value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} />
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs text-muted-foreground mb-1 block">Descripción</Label>
              <textarea
                className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder="Describí el problema con detalle..."
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Prioridad</Label>
              <Select value={form.priority} onValueChange={v => setForm(p => ({ ...p, priority: v as TicketPriority }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(PRIORITY_CONFIG) as TicketPriority[]).map(k => (
                    <SelectItem key={k} value={k}>{PRIORITY_CONFIG[k].label} (SLA {SLA_HOURS[k]}h)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Categoría</Label>
              <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v as TicketCategory }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CATEGORY_LABELS) as TicketCategory[]).map(k => (
                    <SelectItem key={k} value={k}>{CATEGORY_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Nombre del cliente</Label>
              <Input placeholder="Juan Pérez" value={form.customer_name} onChange={e => setForm(p => ({ ...p, customer_name: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">Email del cliente</Label>
              <Input type="email" placeholder="juan@email.com" value={form.customer_email} onChange={e => setForm(p => ({ ...p, customer_email: e.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={saving || !form.title.trim()}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
              Crear ticket
            </Button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input className="pl-9 h-8 text-sm" placeholder="Buscar ticket..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-8 text-xs w-auto min-w-[130px]">
            <Filter className="w-3 h-3 mr-1.5" /><SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {(Object.keys(STATUS_CONFIG) as TicketStatus[]).map(k => (
              <SelectItem key={k} value={k}>{STATUS_CONFIG[k].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterPriority} onValueChange={setFilterPriority}>
          <SelectTrigger className="h-8 text-xs w-auto min-w-[130px]">
            <SelectValue placeholder="Prioridad" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las prioridades</SelectItem>
            {(Object.keys(PRIORITY_CONFIG) as TicketPriority[]).map(k => (
              <SelectItem key={k} value={k}>{PRIORITY_CONFIG[k].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} ticket{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Ticket list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <LifeBuoy className="w-8 h-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{tickets.length === 0 ? "No hay tickets de soporte" : "Sin resultados"}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(ticket => {
            const sc = STATUS_CONFIG[ticket.status];
            const pc = PRIORITY_CONFIG[ticket.priority];
            const StatusIcon = sc.icon;
            const isOpen = expanded === ticket.id;
            const sla = slaLabel(ticket);
            const ticketMsgs = messages[ticket.id] || [];

            return (
              <div key={ticket.id} className="rounded-xl border border-border bg-card overflow-hidden">
                {/* Row */}
                <div className="flex items-start gap-3 p-4">
                  {/* Priority dot */}
                  <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${pc.dot}`} title={pc.label} />

                  {/* Main info */}
                  <button className="flex-1 text-left min-w-0" onClick={() => setExpanded(isOpen ? null : ticket.id)}>
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <span className="font-mono text-xs text-muted-foreground">{ticket.ticket_number}</span>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] text-[10px] font-medium border ${sc.color}`}>
                        <StatusIcon className="w-3 h-3" />{sc.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground/60 border border-border rounded px-1.5 py-0.5">
                        {CATEGORY_LABELS[ticket.category]}
                      </span>
                      {sla && (
                        <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${sla.urgent ? "text-red-400" : "text-yellow-400"}`}>
                          <Flame className="w-3 h-3" />{sla.text}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium leading-tight">{ticket.title}</p>
                    {ticket.customer_name && (
                      <p className="text-xs text-muted-foreground/70 mt-0.5 flex items-center gap-1">
                        <User className="w-3 h-3" />{ticket.customer_name}
                        {ticket.customer_email && <span className="text-muted-foreground/40">— {ticket.customer_email}</span>}
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground/40 mt-0.5">
                      {formatDistanceToNow(new Date(ticket.created_at), { addSuffix: true, locale: es })}
                      {ticket.assigned_name && <span className="ml-2">· Asignado a {ticket.assigned_name}</span>}
                    </p>
                  </button>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {canManage && ticket.status === "open" && (
                      <Button size="sm" variant="outline" className="h-7 text-xs"
                        onClick={() => updateTicket(ticket.id, { status: "in_progress" })}
                      >
                        <ArrowRight className="w-3 h-3 mr-1" />Tomar
                      </Button>
                    )}
                    {canManage && ticket.status === "in_progress" && (
                      <Button size="sm" variant="outline" className="h-7 text-xs border-green-500/30 text-green-400 hover:bg-green-500/10"
                        onClick={() => updateTicket(ticket.id, { status: "resolved" })}
                      >
                        <CheckCircle2 className="w-3 h-3 mr-1" />Resolver
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7"
                      onClick={() => setExpanded(isOpen ? null : ticket.id)}
                    >
                      {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                {/* Expanded: thread + reply */}
                {isOpen && (
                  <div className="border-t border-border bg-muted/10 px-4 py-4 space-y-4">
                    {/* Description */}
                    {ticket.description && (
                      <div className="p-3 rounded-lg bg-muted/30 border border-border">
                        <p className="text-xs font-medium text-muted-foreground mb-1">Descripción original</p>
                        <p className="text-sm whitespace-pre-wrap">{ticket.description}</p>
                      </div>
                    )}

                    {/* Status & priority controls */}
                    {canManage && (
                      <div className="flex flex-wrap gap-2 items-center">
                        <span className="text-xs text-muted-foreground">Estado:</span>
                        <Select value={ticket.status} onValueChange={v => updateTicket(ticket.id, { status: v as TicketStatus })}>
                          <SelectTrigger className="h-7 text-xs w-auto min-w-[140px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(Object.keys(STATUS_CONFIG) as TicketStatus[]).map(k => (
                              <SelectItem key={k} value={k}>{STATUS_CONFIG[k].label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <span className="text-xs text-muted-foreground ml-2">Prioridad:</span>
                        <Select value={ticket.priority} onValueChange={v => updateTicket(ticket.id, { priority: v as TicketPriority })}>
                          <SelectTrigger className="h-7 text-xs w-auto min-w-[120px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(Object.keys(PRIORITY_CONFIG) as TicketPriority[]).map(k => (
                              <SelectItem key={k} value={k}>{PRIORITY_CONFIG[k].label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <button
                          className="text-xs text-muted-foreground hover:text-foreground ml-auto flex items-center gap-1"
                          onClick={() => copy(ticket.ticket_number, ticket.ticket_number)}
                        >
                          <Tag className="w-3 h-3" />{ticket.ticket_number}
                        </button>
                      </div>
                    )}

                    {/* Message thread */}
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                        <MessageSquare className="w-3 h-3" />Thread ({ticketMsgs.length})
                      </p>
                      {loadingMsgs ? (
                        <div className="flex justify-center py-4">
                          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                        </div>
                      ) : ticketMsgs.length === 0 ? (
                        <p className="text-xs text-muted-foreground/60 italic">Sin respuestas aún.</p>
                      ) : (
                        ticketMsgs.map(msg => (
                          <div
                            key={msg.id}
                            className={`p-3 rounded-lg border text-sm ${
                              msg.is_internal
                                ? "bg-yellow-500/5 border-yellow-500/20"
                                : msg.author_type === "agent"
                                ? "bg-primary/5 border-primary/20"
                                : "bg-muted/30 border-border"
                            }`}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-medium">
                                {msg.author_name}
                                {msg.is_internal && <span className="ml-1.5 text-[10px] text-yellow-400">(nota interna)</span>}
                              </span>
                              <span className="text-[10px] text-muted-foreground/60">
                                {formatDistanceToNow(new Date(msg.created_at), { addSuffix: true, locale: es })}
                              </span>
                            </div>
                            <p className="whitespace-pre-wrap text-sm leading-relaxed">{msg.body}</p>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Reply box */}
                    {canManage && ticket.status !== "closed" && (
                      <div className="space-y-2">
                        <textarea
                          className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                          placeholder={replyInternal ? "Nota interna (no visible al cliente)..." : "Responder al cliente..."}
                          value={reply}
                          onChange={e => setReply(e.target.value)}
                          onKeyDown={e => { if (e.ctrlKey && e.key === "Enter") handleSendReply(); }}
                        />
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                            <input
                              type="checkbox"
                              className="rounded"
                              checked={replyInternal}
                              onChange={e => setReplyInternal(e.target.checked)}
                            />
                            Nota interna
                          </label>
                          <span className="text-[10px] text-muted-foreground/40">Ctrl+Enter para enviar</span>
                          <Button
                            size="sm"
                            className="ml-auto"
                            onClick={handleSendReply}
                            disabled={sending || !reply.trim()}
                          >
                            {sending
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                              : <Send className="w-3.5 h-3.5 mr-1.5" />
                            }
                            {replyInternal ? "Guardar nota" : "Responder"}
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* SLA / resolution info */}
                    <div className="flex flex-wrap gap-4 text-[11px] text-muted-foreground/60 border-t border-border pt-3">
                      <span>Creado: {new Date(ticket.created_at).toLocaleString("es-AR")}</span>
                      {ticket.first_response_at && <span>1ra respuesta: {new Date(ticket.first_response_at).toLocaleString("es-AR")}</span>}
                      {ticket.resolved_at && <span>Resuelto: {new Date(ticket.resolved_at).toLocaleString("es-AR")}</span>}
                      {ticket.sla_due_at && <span className={ticket.sla_breach ? "text-red-400" : ""}>SLA: {new Date(ticket.sla_due_at).toLocaleString("es-AR")}</span>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
