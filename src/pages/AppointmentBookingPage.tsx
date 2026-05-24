import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Calendar, Clock, Users, Plus, Edit2, Trash2, CheckCircle2,
  XCircle, RefreshCw, Search, Scissors, Star, DollarSign,
  ChevronLeft, ChevronRight, UserCheck,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Service {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  price: number;
  color: string;
  buffer_minutes: number;
  max_attendees: number;
  active: boolean;
}

interface Appointment {
  id: string;
  service_id: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  staff_name: string | null;
  start_at: string;
  end_at: string;
  status: "pending" | "confirmed" | "cancelled" | "completed" | "no_show";
  price: number;
  deposit_paid: number;
  notes: string | null;
  internal_notes: string | null;
  services?: { name: string; color: string; duration_minutes: number };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  pending:   { label: "Pendiente",    cls: "bg-yellow-500/15 text-yellow-500 border-yellow-500/30" },
  confirmed: { label: "Confirmado",   cls: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
  completed: { label: "Completado",   cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  cancelled: { label: "Cancelado",    cls: "bg-destructive/15 text-destructive border-destructive/30" },
  no_show:   { label: "No se presentó", cls: "bg-muted text-muted-foreground" },
};

const DAYS_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}
function fmtDate(ts: string) {
  return new Date(ts).toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "short" });
}
function fmtCurrency(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
}
function addMinutes(date: Date, min: number) {
  return new Date(date.getTime() + min * 60000);
}

// ── Service Form ──────────────────────────────────────────────────────────────
const blankSvc = () => ({
  name: "", description: "", duration_minutes: 60, price: 0,
  color: "#6366f1", buffer_minutes: 0, max_attendees: 1, active: true,
});

function ServiceForm({ open, onClose, editing, orgId, onSaved }: {
  open: boolean; onClose: () => void; editing: Service | null;
  orgId: string; onSaved: () => void;
}) {
  const [f, setF] = useState(blankSvc());
  const [saving, setSaving] = useState(false);
  const upd = (k: string, v: unknown) => setF(p => ({ ...p, [k]: v }));

  useEffect(() => {
    setF(editing ? {
      name: editing.name, description: editing.description || "",
      duration_minutes: editing.duration_minutes, price: editing.price,
      color: editing.color, buffer_minutes: editing.buffer_minutes,
      max_attendees: editing.max_attendees, active: editing.active,
    } : blankSvc());
  }, [editing, open]);

  async function save() {
    if (!f.name.trim()) { toast.error("Nombre requerido"); return; }
    setSaving(true);
    const payload = {
      org_id: orgId, name: f.name.trim(), description: f.description || null,
      duration_minutes: Number(f.duration_minutes), price: Number(f.price),
      color: f.color, buffer_minutes: Number(f.buffer_minutes),
      max_attendees: Number(f.max_attendees), active: f.active,
    };
    const { error } = editing
      ? await supabase.from("services").update(payload).eq("id", editing.id)
      : await supabase.from("services").insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Servicio guardado");
    onSaved(); onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{editing ? "Editar servicio" : "Nuevo servicio"}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div><Label>Nombre *</Label>
            <Input value={f.name} onChange={e => upd("name", e.target.value)} placeholder="Corte de cabello, Consulta, Clase..." />
          </div>
          <div><Label>Descripción</Label>
            <Textarea value={f.description as string} onChange={e => upd("description", e.target.value)} rows={2} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Duración (min)</Label>
              <Input type="number" min="5" step="5" value={f.duration_minutes} onChange={e => upd("duration_minutes", e.target.value)} />
            </div>
            <div><Label>Buffer (min)</Label>
              <Input type="number" min="0" step="5" value={f.buffer_minutes} onChange={e => upd("buffer_minutes", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Precio (ARS)</Label>
              <Input type="number" min="0" value={f.price} onChange={e => upd("price", e.target.value)} />
            </div>
            <div><Label>Máx. asistentes</Label>
              <Input type="number" min="1" value={f.max_attendees} onChange={e => upd("max_attendees", e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex-1"><Label>Color</Label>
              <Input type="color" value={f.color} onChange={e => upd("color", e.target.value)} className="h-10 p-1 cursor-pointer" />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input type="checkbox" id="active" checked={f.active} onChange={e => upd("active", e.target.checked)} className="w-4 h-4" />
              <label htmlFor="active" className="text-sm">Activo</label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Appointment Form ──────────────────────────────────────────────────────────
const blankApt = (services: Service[]) => ({
  service_id: services[0]?.id || "",
  customer_name: "", customer_email: "", customer_phone: "",
  staff_name: "", date: new Date().toISOString().substring(0, 10),
  time: "09:00", status: "confirmed" as const,
  price: services[0]?.price || 0, deposit_paid: 0, notes: "", internal_notes: "",
});

function AppointmentForm({ open, onClose, editing, orgId, services, onSaved }: {
  open: boolean; onClose: () => void; editing: Appointment | null;
  orgId: string; services: Service[]; onSaved: () => void;
}) {
  const [f, setF] = useState(blankApt(services));
  const [saving, setSaving] = useState(false);
  const upd = (k: string, v: unknown) => setF(p => ({ ...p, [k]: v }));

  useEffect(() => {
    if (editing) {
      const start = new Date(editing.start_at);
      setF({
        service_id: editing.service_id,
        customer_name: editing.customer_name,
        customer_email: editing.customer_email || "",
        customer_phone: editing.customer_phone || "",
        staff_name: editing.staff_name || "",
        date: start.toISOString().substring(0, 10),
        time: `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`,
        status: editing.status,
        price: editing.price,
        deposit_paid: editing.deposit_paid,
        notes: editing.notes || "",
        internal_notes: editing.internal_notes || "",
      });
    } else {
      setF(blankApt(services));
    }
  }, [editing, open, services]);

  // Auto-fill price when service changes
  useEffect(() => {
    if (!editing) {
      const svc = services.find(s => s.id === f.service_id);
      if (svc) upd("price", svc.price);
    }
  }, [f.service_id]);

  async function save() {
    if (!f.customer_name.trim() || !f.service_id || !f.date || !f.time) {
      toast.error("Nombre, servicio y fecha/hora son requeridos"); return;
    }
    const svc = services.find(s => s.id === f.service_id);
    const startAt = new Date(`${f.date}T${f.time}:00`);
    const endAt = addMinutes(startAt, (svc?.duration_minutes || 60) + (svc?.buffer_minutes || 0));
    setSaving(true);
    const payload = {
      org_id: orgId, service_id: f.service_id,
      customer_name: f.customer_name.trim(),
      customer_email: f.customer_email || null,
      customer_phone: f.customer_phone || null,
      staff_name: f.staff_name || null,
      start_at: startAt.toISOString(), end_at: endAt.toISOString(),
      status: f.status, price: Number(f.price), deposit_paid: Number(f.deposit_paid),
      notes: f.notes || null, internal_notes: f.internal_notes || null,
    };
    const { error } = editing
      ? await supabase.from("appointments").update(payload).eq("id", editing.id)
      : await supabase.from("appointments").insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Turno guardado");
    onSaved(); onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{editing ? "Editar turno" : "Nuevo turno"}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2 max-h-[75vh] overflow-y-auto pr-1">
          <div><Label>Servicio *</Label>
            <Select value={f.service_id} onValueChange={v => upd("service_id", v)}>
              <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
              <SelectContent>
                {services.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: s.color }} />
                      {s.name} — {s.duration_minutes}min — {fmtCurrency(s.price)}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Nombre del cliente *</Label>
            <Input value={f.customer_name} onChange={e => upd("customer_name", e.target.value)} placeholder="María González..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Email</Label>
              <Input type="email" value={f.customer_email} onChange={e => upd("customer_email", e.target.value)} />
            </div>
            <div><Label>Teléfono</Label>
              <Input value={f.customer_phone} onChange={e => upd("customer_phone", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Fecha *</Label>
              <Input type="date" value={f.date} onChange={e => upd("date", e.target.value)} />
            </div>
            <div><Label>Hora *</Label>
              <Input type="time" value={f.time} onChange={e => upd("time", e.target.value)} />
            </div>
            <div><Label>Staff</Label>
              <Input value={f.staff_name} onChange={e => upd("staff_name", e.target.value)} placeholder="Ana..." />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Precio</Label>
              <Input type="number" min="0" value={f.price} onChange={e => upd("price", e.target.value)} />
            </div>
            <div><Label>Seña</Label>
              <Input type="number" min="0" value={f.deposit_paid} onChange={e => upd("deposit_paid", e.target.value)} />
            </div>
            <div><Label>Estado</Label>
              <Select value={f.status} onValueChange={v => upd("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_CFG).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Notas del cliente</Label>
            <Textarea value={f.notes} onChange={e => upd("notes", e.target.value)} rows={2} />
          </div>
          <div><Label>Notas internas</Label>
            <Textarea value={f.internal_notes} onChange={e => upd("internal_notes", e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar turno"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Week Calendar View ────────────────────────────────────────────────────────
function WeekView({ appointments, services, weekStart, onAptClick }: {
  appointments: Appointment[]; services: Service[];
  weekStart: Date; onAptClick: (a: Appointment) => void;
}) {
  const HOURS = Array.from({ length: 15 }, (_, i) => i + 7); // 7am - 9pm
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  function getAptStyle(apt: Appointment, dayDate: Date) {
    const start = new Date(apt.start_at);
    const end = new Date(apt.end_at);
    if (start.toDateString() !== dayDate.toDateString()) return null;
    const startMin = start.getHours() * 60 + start.getMinutes();
    const endMin = end.getHours() * 60 + end.getMinutes();
    const top = ((startMin - 7 * 60) / 60) * 48;
    const height = ((endMin - startMin) / 60) * 48;
    const svc = services.find(s => s.id === apt.service_id);
    return { top, height: Math.max(height, 20), color: svc?.color || "#6366f1" };
  }

  return (
    <div className="rounded-xl border border-border/50 overflow-hidden">
      {/* Day headers */}
      <div className="grid border-b border-border/50" style={{ gridTemplateColumns: "48px repeat(7, 1fr)" }}>
        <div className="border-r border-border/30 bg-muted/30" />
        {days.map((d, i) => {
          const isToday = d.toDateString() === new Date().toDateString();
          return (
            <div key={i} className={`text-center py-2 border-r border-border/30 last:border-r-0 text-xs font-medium ${isToday ? "bg-primary/8 text-primary" : "bg-muted/20 text-muted-foreground"}`}>
              <div>{DAYS_ES[d.getDay()]}</div>
              <div className={`text-base font-bold mt-0.5 ${isToday ? "text-primary" : ""}`}>{d.getDate()}</div>
            </div>
          );
        })}
      </div>
      {/* Time grid */}
      <div className="relative overflow-y-auto" style={{ maxHeight: "480px" }}>
        <div className="grid" style={{ gridTemplateColumns: "48px repeat(7, 1fr)" }}>
          {/* Hour labels */}
          <div className="relative">
            {HOURS.map(h => (
              <div key={h} className="h-12 border-b border-border/20 flex items-start justify-end pr-2 pt-0.5">
                <span className="text-[10px] text-muted-foreground/60">{h}:00</span>
              </div>
            ))}
          </div>
          {/* Day columns */}
          {days.map((day, di) => (
            <div key={di} className="relative border-r border-border/30 last:border-r-0">
              {HOURS.map(h => (
                <div key={h} className="h-12 border-b border-border/20" />
              ))}
              {/* Appointments */}
              {appointments.map(apt => {
                const s = getAptStyle(apt, day);
                if (!s) return null;
                return (
                  <button
                    key={apt.id}
                    onClick={() => onAptClick(apt)}
                    className="absolute left-0.5 right-0.5 rounded-[4px] text-left px-1 py-0.5 overflow-hidden text-white text-[10px] font-medium hover:opacity-90 transition-opacity z-10"
                    style={{ top: s.top, height: s.height, backgroundColor: s.color }}
                  >
                    <p className="truncate">{apt.customer_name}</p>
                    {s.height > 28 && <p className="truncate opacity-80">{fmtTime(apt.start_at)}</p>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function AppointmentBookingPage() {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";
  const [tab, setTab] = useState("calendar");
  const [services, setServices] = useState<Service[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [svcFormOpen, setSvcFormOpen] = useState(false);
  const [editingSvc, setEditingSvc] = useState<Service | null>(null);
  const [aptFormOpen, setAptFormOpen] = useState(false);
  const [editingApt, setEditingApt] = useState<Appointment | null>(null);
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  async function loadData() {
    if (!orgId) return;
    setLoading(true);
    const [svcs, apts] = await Promise.all([
      supabase.from("services").select("*").eq("org_id", orgId).order("name"),
      supabase.from("appointments").select("*, services(name, color, duration_minutes)")
        .eq("org_id", orgId).order("start_at", { ascending: false }).limit(200),
    ]);
    setServices(svcs.data || []);
    setAppointments((apts.data || []) as Appointment[]);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [orgId]);

  async function updateStatus(id: string, status: Appointment["status"]) {
    const { error } = await supabase.from("appointments").update({ status }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Estado actualizado");
    loadData();
  }

  async function deleteApt(id: string) {
    if (!confirm("¿Eliminar este turno?")) return;
    await supabase.from("appointments").delete().eq("id", id);
    toast.success("Turno eliminado");
    loadData();
  }

  const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const weekApts = appointments.filter(a => {
    const d = new Date(a.start_at);
    return d >= weekStart && d < weekEnd;
  });

  const filteredList = useMemo(() => appointments.filter(a => {
    const matchSearch = a.customer_name.toLowerCase().includes(search.toLowerCase()) ||
      (a.customer_email || "").toLowerCase().includes(search.toLowerCase()) ||
      (a.customer_phone || "").includes(search);
    const matchStatus = filterStatus === "all" || a.status === filterStatus;
    return matchSearch && matchStatus;
  }), [appointments, search, filterStatus]);

  const todayApts = appointments.filter(a => new Date(a.start_at).toDateString() === new Date().toDateString());
  const pendingCount = appointments.filter(a => a.status === "pending").length;
  const monthRevenue = appointments.filter(a => {
    const d = new Date(a.start_at);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() && a.status === "completed";
  }).reduce((s, a) => s + a.price, 0);

  const activeServices = services.filter(s => s.active);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Calendar className="w-6 h-6 text-primary" /> Turnos & Reservas
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Agenda de servicios, turnos de clientes y seguimiento de pagos.
          </p>
        </div>
        <Button onClick={() => { setEditingApt(null); setAptFormOpen(true); }} disabled={activeServices.length === 0}>
          <Plus className="w-4 h-4 mr-1" /> Nuevo turno
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Turnos hoy", value: todayApts.length, icon: Calendar, color: "text-primary" },
          { label: "Pendientes de confirmar", value: pendingCount, icon: Clock, color: "text-yellow-400" },
          { label: "Servicios activos", value: activeServices.length, icon: Scissors, color: "text-blue-400" },
          { label: "Facturado este mes", value: fmtCurrency(monthRevenue), icon: DollarSign, color: "text-emerald-400" },
        ].map(k => (
          <div key={k.label} className="rounded-xl border border-border/50 bg-card p-4">
            <div className="flex items-center gap-2 mb-1">
              <k.icon className={`w-4 h-4 ${k.color}`} />
              <span className="text-xs text-muted-foreground">{k.label}</span>
            </div>
            <p className="text-xl font-bold">{k.value}</p>
          </div>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="calendar">Semana</TabsTrigger>
          <TabsTrigger value="list">Lista</TabsTrigger>
          <TabsTrigger value="services">Servicios</TabsTrigger>
        </TabsList>

        {/* Calendar */}
        <TabsContent value="calendar" className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" onClick={() => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; })}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm font-medium">
                {weekStart.toLocaleDateString("es-AR", { day: "numeric", month: "short" })} —{" "}
                {new Date(weekStart.getTime() + 6 * 86400000).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" })}
              </span>
              <Button variant="outline" size="icon" onClick={() => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; })}>
                <ChevronRight className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => {
                const d = new Date();
                d.setDate(d.getDate() - d.getDay());
                d.setHours(0, 0, 0, 0);
                setWeekStart(d);
              }}>Hoy</Button>
            </div>
            <span className="text-sm text-muted-foreground">{weekApts.length} turnos esta semana</span>
          </div>
          {loading ? (
            <div className="text-center py-12 text-muted-foreground">Cargando...</div>
          ) : (
            <WeekView
              appointments={weekApts} services={services} weekStart={weekStart}
              onAptClick={(apt) => { setEditingApt(apt); setAptFormOpen(true); }}
            />
          )}
        </TabsContent>

        {/* List */}
        <TabsContent value="list" className="space-y-3 pt-2">
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Buscar clientes..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                {Object.entries(STATUS_CFG).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={loadData}><RefreshCw className="w-4 h-4" /></Button>
          </div>

          <div className="rounded-xl border border-border/50 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-border/50 bg-muted/20">
                <tr className="text-muted-foreground text-xs">
                  <th className="text-left px-3 py-2.5">Cliente</th>
                  <th className="text-left px-3 py-2.5 hidden md:table-cell">Servicio</th>
                  <th className="text-left px-3 py-2.5">Fecha / Hora</th>
                  <th className="text-left px-3 py-2.5">Estado</th>
                  <th className="text-right px-3 py-2.5">Precio</th>
                  <th className="text-right px-3 py-2.5">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredList.slice(0, 80).map(apt => (
                  <tr key={apt.id} className="border-b border-border/30 hover:bg-muted/20">
                    <td className="px-3 py-2">
                      <p className="font-medium">{apt.customer_name}</p>
                      {apt.customer_phone && <p className="text-xs text-muted-foreground">{apt.customer_phone}</p>}
                    </td>
                    <td className="px-3 py-2 hidden md:table-cell">
                      {apt.services && (
                        <span className="inline-flex items-center gap-1 text-xs">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: apt.services.color }} />
                          {apt.services.name}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <p className="text-xs">{fmtDate(apt.start_at)}</p>
                      <p className="text-xs text-muted-foreground">{fmtTime(apt.start_at)} — {fmtTime(apt.end_at)}</p>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_CFG[apt.status]?.cls}`}>
                        {STATUS_CFG[apt.status]?.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-sm">{fmtCurrency(apt.price)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        {apt.status === "pending" && (
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-blue-400" title="Confirmar"
                            onClick={() => updateStatus(apt.id, "confirmed")}>
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {apt.status === "confirmed" && (
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-400" title="Completar"
                            onClick={() => updateStatus(apt.id, "completed")}>
                            <UserCheck className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" className="h-7 w-7"
                          onClick={() => { setEditingApt(apt); setAptFormOpen(true); }}>
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive"
                          onClick={() => deleteApt(apt.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredList.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-8 text-muted-foreground text-sm">Sin turnos</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Services */}
        <TabsContent value="services" className="space-y-3 pt-2">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">Configurá los servicios que ofrecés con duración y precios.</p>
            <Button size="sm" onClick={() => { setEditingSvc(null); setSvcFormOpen(true); }}>
              <Plus className="w-4 h-4 mr-1" /> Nuevo servicio
            </Button>
          </div>
          {services.length === 0 && !loading ? (
            <div className="text-center py-12 text-muted-foreground text-sm">Sin servicios configurados.</div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {services.map(svc => (
                <div key={svc.id} className={`rounded-xl border p-4 transition-all ${svc.active ? "border-border/50 bg-card" : "border-border/20 bg-muted/20 opacity-60"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: svc.color }} />
                      <div>
                        <p className="font-semibold">{svc.name}</p>
                        {svc.description && <p className="text-xs text-muted-foreground">{svc.description}</p>}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingSvc(svc); setSvcFormOpen(true); }}>
                        <Edit2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="bg-muted/50 rounded-lg p-2">
                      <p className="font-bold">{svc.duration_minutes}m</p>
                      <p className="text-muted-foreground">Duración</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-2">
                      <p className="font-bold text-primary">{fmtCurrency(svc.price)}</p>
                      <p className="text-muted-foreground">Precio</p>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-2">
                      <p className="font-bold">{svc.max_attendees}</p>
                      <p className="text-muted-foreground">Máx.</p>
                    </div>
                  </div>
                  {svc.buffer_minutes > 0 && (
                    <p className="text-xs text-muted-foreground mt-2">+{svc.buffer_minutes}min buffer</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <ServiceForm
        open={svcFormOpen} onClose={() => setSvcFormOpen(false)}
        editing={editingSvc} orgId={orgId} onSaved={loadData}
      />
      <AppointmentForm
        open={aptFormOpen} onClose={() => setAptFormOpen(false)}
        editing={editingApt} orgId={orgId} services={activeServices} onSaved={loadData}
      />
    </div>
  );
}
