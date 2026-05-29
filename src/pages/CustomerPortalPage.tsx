import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import {
  Globe, Plus, MessageSquare, Settings, CheckCircle, Clock,
  AlertCircle, ChevronDown, ChevronRight, Send, User, Loader2, Star
} from "lucide-react";

interface PortalConfig {
  id?: string;
  enabled: boolean;
  allow_orders: boolean;
  allow_invoices: boolean;
  allow_tickets: boolean;
  allow_loyalty: boolean;
  welcome_message: string | null;
  accent_color: string;
}

interface Ticket {
  id: string;
  ticket_number: string;
  subject: string;
  description: string;
  priority: string;
  status: string;
  category: string;
  assigned_to: string | null;
  resolved_at: string | null;
  satisfaction: number | null;
  created_at: string;
  updated_at: string;
  customers?: { name: string; email: string | null } | null;
  portal_ticket_messages?: TicketMessage[];
}

interface TicketMessage {
  id: string;
  sender_type: string;
  sender_name: string;
  message: string;
  is_internal: boolean;
  created_at: string;
}

interface Customer {
  id: string;
  name: string;
  email: string | null;
}

const PRIORITY_CFG: Record<string, { label: string; color: string }> = {
  low:    { label: "Baja",    color: "bg-muted/50 text-muted-foreground" },
  normal: { label: "Normal",  color: "bg-blue-500/15 text-blue-400" },
  high:   { label: "Alta",    color: "bg-orange-500/15 text-orange-400" },
  urgent: { label: "Urgente", color: "bg-red-500/15 text-red-400" },
};

const STATUS_CFG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  open:        { label: "Abierto",     color: "bg-blue-500/15 text-blue-400",    icon: <AlertCircle className="w-3 h-3" /> },
  in_progress: { label: "En progreso", color: "bg-purple-500/15 text-purple-400", icon: <Clock className="w-3 h-3" /> },
  waiting:     { label: "Esperando",   color: "bg-yellow-500/15 text-yellow-400", icon: <Clock className="w-3 h-3" /> },
  resolved:    { label: "Resuelto",    color: "bg-emerald-500/15 text-emerald-400", icon: <CheckCircle className="w-3 h-3" /> },
  closed:      { label: "Cerrado",     color: "bg-muted/50 text-muted-foreground", icon: <CheckCircle className="w-3 h-3" /> },
};

const CATEGORY_LABELS: Record<string, string> = {
  general: "General", billing: "Facturación", technical: "Técnico",
  shipping: "Envíos", returns: "Devoluciones", other: "Otro"
};

const EMPTY_TICKET = {
  customer_id: "", subject: "", description: "",
  priority: "normal", category: "general"
};

const DEFAULT_CONFIG: PortalConfig = {
  enabled: true, allow_orders: true, allow_invoices: true,
  allow_tickets: true, allow_loyalty: true,
  welcome_message: "Bienvenido al portal de clientes. Aquí podés gestionar tus pedidos, facturas y soporte.",
  accent_color: "#6366f1"
};

export default function CustomerPortalPage() {
  usePageTitle("Portal de Clientes");
  const { orgId } = useOrganization();

  const [config, setConfig]           = useState<PortalConfig>(DEFAULT_CONFIG);
  const [tickets, setTickets]         = useState<Ticket[]>([]);
  const [customers, setCustomers]     = useState<Customer[]>([]);
  const [loading, setLoading]         = useState(true);
  const [activeTab, setActiveTab]     = useState("tickets");
  const [savingConfig, setSavingConfig] = useState(false);
  const [expandedTicket, setExpandedTicket] = useState<string | null>(null);

  const [statusFilter, setStatusFilter]   = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  const [ticketOpen, setTicketOpen]   = useState(false);
  const [ticketForm, setTicketForm]   = useState({ ...EMPTY_TICKET });
  const [savingTicket, setSavingTicket] = useState(false);

  const [replyTicketId, setReplyTicketId] = useState<string | null>(null);
  const [replyMsg, setReplyMsg]           = useState("");
  const [isInternal, setIsInternal]       = useState(false);
  const [sendingReply, setSendingReply]   = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [cfgRes, tkRes, custRes] = await Promise.allSettled([
      supabase.from("portal_configs").select("*").eq("org_id", orgId).maybeSingle(),
      supabase.from("portal_tickets").select("*, customers(name, email), portal_ticket_messages(*)").eq("org_id", orgId).order("created_at", { ascending: false }),
      supabase.from("customers").select("id, name, email").eq("org_id", orgId).order("name"),
    ]);
    if (cfgRes.status === "fulfilled" && cfgRes.value.data) {
      const d = cfgRes.value.data as PortalConfig;
      setConfig({ ...DEFAULT_CONFIG, ...d, welcome_message: d.welcome_message ?? DEFAULT_CONFIG.welcome_message });
    }
    if (tkRes.status === "fulfilled" && tkRes.value.data) setTickets(tkRes.value.data as Ticket[]);
    if (custRes.status === "fulfilled" && custRes.value.data) setCustomers(custRes.value.data as Customer[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  async function savePortalConfig() {
    if (!orgId) return;
    setSavingConfig(true);
    const payload = {
      org_id: orgId,
      enabled: config.enabled,
      allow_orders: config.allow_orders,
      allow_invoices: config.allow_invoices,
      allow_tickets: config.allow_tickets,
      allow_loyalty: config.allow_loyalty,
      welcome_message: config.welcome_message,
      accent_color: config.accent_color,
    };
    const { error } = await supabase.from("portal_configs").upsert(payload, { onConflict: "org_id" });
    setSavingConfig(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Configuración del portal guardada");
    load();
  }

  async function createTicket() {
    if (!orgId || !ticketForm.customer_id) return toast.error("Seleccioná un cliente");
    if (!ticketForm.subject.trim()) return toast.error("Ingresá el asunto");
    if (!ticketForm.description.trim()) return toast.error("Describí el problema");
    setSavingTicket(true);
    const { error } = await supabase.from("portal_tickets").insert({
      org_id: orgId,
      ticket_number: "temp",
      customer_id: ticketForm.customer_id,
      subject: ticketForm.subject.trim(),
      description: ticketForm.description.trim(),
      priority: ticketForm.priority,
      category: ticketForm.category,
    });
    setSavingTicket(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Ticket creado");
    setTicketOpen(false);
    setTicketForm({ ...EMPTY_TICKET });
    load();
  }

  async function updateTicketStatus(id: string, status: string) {
    const extra: Record<string, string | null> = {};
    if (status === "resolved") extra.resolved_at = new Date().toISOString();
    if (status === "closed") extra.closed_at = new Date().toISOString();
    const { error } = await supabase.from("portal_tickets").update({ status, ...extra }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Estado actualizado");
    load();
  }

  async function sendReply(ticketId: string) {
    if (!replyMsg.trim()) return;
    setSendingReply(true);
    const { error } = await supabase.from("portal_ticket_messages").insert({
      ticket_id: ticketId,
      sender_type: "agent",
      sender_name: "Soporte",
      message: replyMsg.trim(),
      is_internal: isInternal,
    });
    setSendingReply(false);
    if (error) { toast.error(error.message); return; }
    setReplyMsg("");
    load();
  }

  const filteredTickets = tickets.filter(t => {
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
    if (categoryFilter !== "all" && t.category !== categoryFilter) return false;
    return true;
  });

  const kpis = {
    total: tickets.length,
    open: tickets.filter(t => t.status === "open").length,
    inProgress: tickets.filter(t => t.status === "in_progress").length,
    resolved: tickets.filter(t => t.status === "resolved").length,
    avgSatisfaction: tickets.filter(t => t.satisfaction).length > 0
      ? (tickets.reduce((s, t) => s + (t.satisfaction ?? 0), 0) / tickets.filter(t => t.satisfaction).length).toFixed(1)
      : "—",
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-7 h-7 animate-spin text-primary" />
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Globe}
        title="Portal de Clientes"
        description="Autoservicio, tickets de soporte y configuración del portal"
        actions={activeTab === "tickets" ? (
          <Dialog open={ticketOpen} onOpenChange={setTicketOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={() => setTicketForm({ ...EMPTY_TICKET })}>
                <Plus className="w-4 h-4 mr-2" /> Nuevo ticket
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>Crear ticket de soporte</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Cliente *</Label>
                  <Select value={ticketForm.customer_id} onValueChange={v => setTicketForm(f => ({ ...f, customer_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Buscar cliente" /></SelectTrigger>
                    <SelectContent>
                      {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name} {c.email && `(${c.email})`}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Asunto *</Label>
                  <Input value={ticketForm.subject} onChange={e => setTicketForm(f => ({ ...f, subject: e.target.value }))} placeholder="Resumen del problema..." />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Categoría</Label>
                    <Select value={ticketForm.category} onValueChange={v => setTicketForm(f => ({ ...f, category: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(CATEGORY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Prioridad</Label>
                    <Select value={ticketForm.priority} onValueChange={v => setTicketForm(f => ({ ...f, priority: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(PRIORITY_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Descripción *</Label>
                  <Textarea value={ticketForm.description} onChange={e => setTicketForm(f => ({ ...f, description: e.target.value }))} rows={4} placeholder="Descripción detallada del problema..." />
                </div>
                <Button className="w-full" onClick={createTicket} disabled={savingTicket}>
                  {savingTicket ? "Creando..." : "Crear ticket"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        ) : undefined}
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard label="Total tickets" value={kpis.total} icon={MessageSquare} color="primary" />
        <KPICard label="Abiertos" value={kpis.open} icon={AlertCircle} color="blue" />
        <KPICard label="En progreso" value={kpis.inProgress} icon={Clock} color="purple" />
        <KPICard label="Resueltos" value={kpis.resolved} icon={CheckCircle} color="success" />
        <KPICard label="Satisfacción ★" value={kpis.avgSatisfaction} icon={Star} color="warning" />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="tickets">Tickets ({tickets.length})</TabsTrigger>
          <TabsTrigger value="config">Configuración portal</TabsTrigger>
        </TabsList>

        {/* TICKETS */}
        <TabsContent value="tickets" className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-3">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-36"><SelectValue placeholder="Estado" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {Object.entries(STATUS_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="h-8 w-32"><SelectValue placeholder="Prioridad" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {Object.entries(PRIORITY_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-8 w-36"><SelectValue placeholder="Categoría" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {filteredTickets.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground/70">
              <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No hay tickets de soporte aún</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredTickets.map(ticket => {
                const sc = STATUS_CFG[ticket.status] ?? STATUS_CFG.open;
                const pc = PRIORITY_CFG[ticket.priority] ?? PRIORITY_CFG.normal;
                const isExpanded = expandedTicket === ticket.id;
                const msgs = ticket.portal_ticket_messages ?? [];

                return (
                  <Card key={ticket.id} className="overflow-hidden">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <button onClick={() => setExpandedTicket(isExpanded ? null : ticket.id)} className="text-muted-foreground/70 flex-shrink-0">
                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </button>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs text-muted-foreground/70">{ticket.ticket_number}</span>
                              <span className="font-medium text-foreground">{ticket.subject}</span>
                              <Badge className={`text-xs ${pc.color}`}>{pc.label}</Badge>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                              <User className="w-3 h-3" />
                              <span>{ticket.customers?.name ?? "—"}</span>
                              <span>·</span>
                              <span>{CATEGORY_LABELS[ticket.category]}</span>
                              <span>·</span>
                              <span>{new Date(ticket.created_at).toLocaleDateString("es-AR")}</span>
                              {msgs.length > 0 && <><span>·</span><span className="flex items-center gap-0.5"><MessageSquare className="w-3 h-3" /> {msgs.length}</span></>}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Badge className={`text-xs flex items-center gap-1 ${sc.color}`}>{sc.icon} {sc.label}</Badge>
                          {ticket.status === "open" && (
                            <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => updateTicketStatus(ticket.id, "in_progress")}>
                              Tomar
                            </Button>
                          )}
                          {ticket.status === "in_progress" && (
                            <Button size="sm" variant="outline" className="h-6 text-xs px-2 text-emerald-400 border-emerald-500/30" onClick={() => updateTicketStatus(ticket.id, "resolved")}>
                              Resolver
                            </Button>
                          )}
                          {ticket.status === "resolved" && (
                            <Button size="sm" variant="ghost" className="h-6 text-xs px-2 text-muted-foreground" onClick={() => updateTicketStatus(ticket.id, "closed")}>
                              Cerrar
                            </Button>
                          )}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="mt-4 pt-4 border-t space-y-3">
                          <p className="text-sm text-foreground/80">{ticket.description}</p>

                          {/* Messages */}
                          {msgs.length > 0 && (
                            <div className="space-y-2">
                              {msgs.filter(m => !m.is_internal).map(m => (
                                <div key={m.id} className={`flex gap-2 ${m.sender_type === "agent" ? "flex-row-reverse" : ""}`}>
                                  <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${m.sender_type === "agent" ? "bg-primary/10 text-foreground" : "bg-muted/40 text-foreground"}`}>
                                    <p className="text-xs font-semibold mb-0.5">{m.sender_name}</p>
                                    <p>{m.message}</p>
                                    <p className="text-xs text-muted-foreground/70 mt-0.5">{new Date(m.created_at).toLocaleString("es-AR")}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Reply box */}
                          {["open","in_progress","waiting"].includes(ticket.status) && (
                            <div className="space-y-2">
                              {replyTicketId !== ticket.id ? (
                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setReplyTicketId(ticket.id)}>
                                  <Send className="w-3 h-3 mr-1" /> Responder
                                </Button>
                              ) : (
                                <div className="space-y-2">
                                  <Textarea value={replyMsg} onChange={e => setReplyMsg(e.target.value)} rows={3} placeholder="Escribí tu respuesta..." className="text-sm" />
                                  <div className="flex items-center justify-between">
                                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                                      <Switch checked={isInternal} onCheckedChange={setIsInternal} />
                                      Nota interna (no visible al cliente)
                                    </label>
                                    <div className="flex gap-2">
                                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setReplyTicketId(null)}>Cancelar</Button>
                                      <Button size="sm" className="h-7 text-xs" onClick={() => sendReply(ticket.id)} disabled={sendingReply}>
                                        {sendingReply ? "Enviando..." : "Enviar"}
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* CONFIG */}
        <TabsContent value="config" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Settings className="w-4 h-4" /> Configuración del portal de clientes</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-muted/20 rounded-lg">
                <div>
                  <p className="font-medium text-foreground">Portal habilitado</p>
                  <p className="text-sm text-muted-foreground">Activar o desactivar el acceso al portal</p>
                </div>
                <Switch checked={config.enabled} onCheckedChange={v => setConfig(c => ({ ...c, enabled: v }))} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  { key: "allow_orders",   label: "Gestionar pedidos",     desc: "Clientes pueden ver y crear pedidos" },
                  { key: "allow_invoices", label: "Ver facturas",           desc: "Acceso al historial de facturas" },
                  { key: "allow_tickets",  label: "Tickets de soporte",     desc: "Abrir y seguir tickets de soporte" },
                  { key: "allow_loyalty",  label: "Programa de fidelidad",  desc: "Ver puntos y beneficios" },
                ].map(({ key, label, desc }) => (
                  <div key={key} className="flex items-center justify-between p-3 bg-muted/20 rounded-lg">
                    <div>
                      <p className="font-medium text-foreground text-sm">{label}</p>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </div>
                    <Switch
                      checked={config[key as keyof PortalConfig] as boolean}
                      onCheckedChange={v => setConfig(c => ({ ...c, [key]: v }))}
                    />
                  </div>
                ))}
              </div>

              <div className="space-y-1">
                <Label>Mensaje de bienvenida</Label>
                <Textarea
                  value={config.welcome_message ?? ""}
                  onChange={e => setConfig(c => ({ ...c, welcome_message: e.target.value }))}
                  rows={3}
                  placeholder="Bienvenido al portal de clientes..."
                />
              </div>

              <div className="space-y-1">
                <Label>Color de acento</Label>
                <div className="flex items-center gap-3">
                  <input type="color" value={config.accent_color} onChange={e => setConfig(c => ({ ...c, accent_color: e.target.value }))} className="h-9 w-16 rounded border border-gray-200 cursor-pointer" />
                  <Input value={config.accent_color} onChange={e => setConfig(c => ({ ...c, accent_color: e.target.value }))} className="font-mono w-32" />
                  <div className="w-8 h-8 rounded-full border" style={{ backgroundColor: config.accent_color }} />
                </div>
              </div>

              <Button onClick={savePortalConfig} disabled={savingConfig}>
                {savingConfig ? "Guardando..." : "Guardar configuración"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
