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
  Calendar, MapPin, Users, Ticket, Plus, Edit2, Trash2, QrCode,
  CheckCircle2, XCircle, Clock, TrendingUp, Download, RefreshCw,
  Search, ChevronDown, ChevronUp, Tag, DollarSign,
} from "lucide-react";

// ── types ─────────────────────────────────────────────────────────────────────
interface Event {
  id: string;
  name: string;
  description: string | null;
  event_date: string;
  end_date: string | null;
  location: string | null;
  venue_name: string | null;
  capacity: number;
  tickets_sold: number;
  status: "draft" | "published" | "cancelled" | "completed";
  cover_image_url: string | null;
  tags: string[];
  created_at: string;
}

interface TicketType {
  id: string;
  event_id: string;
  name: string;
  description: string | null;
  price: number;
  quantity: number;
  sold: number;
  max_per_order: number;
  sale_start: string | null;
  sale_end: string | null;
  color: string;
}

interface Attendee {
  id: string;
  event_id: string;
  ticket_type_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  ticket_code: string;
  quantity: number;
  amount_paid: number;
  status: "reserved" | "confirmed" | "checked_in" | "cancelled" | "no_show";
  checked_in_at: string | null;
  notes: string | null;
  created_at: string;
  ticket_types?: { name: string; color: string };
}

// ── helpers ───────────────────────────────────────────────────────────────────
const STATUS_BADGE: Record<string, string> = {
  draft:      "bg-muted text-muted-foreground",
  published:  "bg-blue-500/15 text-blue-400 border-blue-500/30",
  cancelled:  "bg-destructive/15 text-destructive border-destructive/30",
  completed:  "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
};
const STATUS_LABEL: Record<string, string> = {
  draft: "Borrador", published: "Publicado", cancelled: "Cancelado", completed: "Completado",
};
const ATTENDEE_STATUS: Record<string, { label: string; cls: string }> = {
  reserved:   { label: "Reservado",    cls: "bg-muted text-muted-foreground" },
  confirmed:  { label: "Confirmado",   cls: "bg-blue-500/15 text-blue-400" },
  checked_in: { label: "Ingresó",      cls: "bg-emerald-500/15 text-emerald-400" },
  cancelled:  { label: "Cancelado",    cls: "bg-destructive/15 text-destructive" },
  no_show:    { label: "No se presentó", cls: "bg-yellow-500/15 text-yellow-500" },
};

function fmtDate(d: string) {
  return new Date(d).toLocaleString("es-AR", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}
function fmtCurrency(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
}

// ── blank forms ───────────────────────────────────────────────────────────────
const blankEvent = () => ({
  name: "", description: "", event_date: "", end_date: "",
  location: "", venue_name: "", capacity: 100, status: "draft" as const,
  cover_image_url: "", tags: "",
});
const blankTT = () => ({
  name: "", description: "", price: 0, quantity: 50,
  max_per_order: 5, sale_start: "", sale_end: "", color: "#6366f1",
});
const blankAttendee = () => ({
  name: "", email: "", phone: "", quantity: 1,
  amount_paid: 0, status: "confirmed" as const, notes: "",
  ticket_type_id: "",
});

// ── EventForm dialog ──────────────────────────────────────────────────────────
function EventForm({ open, onClose, editing, orgId, onSaved }: {
  open: boolean; onClose: () => void; editing: Event | null;
  orgId: string; onSaved: () => void;
}) {
  const [f, setF] = useState(blankEvent());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) {
      setF({
        name: editing.name,
        description: editing.description || "",
        event_date: editing.event_date ? editing.event_date.substring(0, 16) : "",
        end_date: editing.end_date ? editing.end_date.substring(0, 16) : "",
        location: editing.location || "",
        venue_name: editing.venue_name || "",
        capacity: editing.capacity,
        status: editing.status,
        cover_image_url: editing.cover_image_url || "",
        tags: editing.tags?.join(", ") || "",
      });
    } else {
      setF(blankEvent());
    }
  }, [editing, open]);

  const upd = (k: string, v: unknown) => setF(p => ({ ...p, [k]: v }));

  async function save() {
    if (!f.name.trim() || !f.event_date) {
      toast.error("Nombre y fecha son requeridos"); return;
    }
    setSaving(true);
    const payload = {
      org_id: orgId,
      name: f.name.trim(),
      description: f.description || null,
      event_date: f.event_date,
      end_date: f.end_date || null,
      location: f.location || null,
      venue_name: f.venue_name || null,
      capacity: Number(f.capacity),
      status: f.status,
      cover_image_url: f.cover_image_url || null,
      tags: f.tags ? f.tags.split(",").map(t => t.trim()).filter(Boolean) : [],
    };
    const { error } = editing
      ? await supabase.from("events").update(payload).eq("id", editing.id)
      : await supabase.from("events").insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(editing ? "Evento actualizado" : "Evento creado");
    onSaved(); onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{editing ? "Editar evento" : "Nuevo evento"}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2 max-h-[70vh] overflow-y-auto pr-1">
          <div><Label>Nombre *</Label>
            <Input value={f.name} onChange={e => upd("name", e.target.value)} placeholder="Lanzamiento de colección..." />
          </div>
          <div><Label>Descripción</Label>
            <Textarea value={f.description} onChange={e => upd("description", e.target.value)} rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Fecha inicio *</Label>
              <Input type="datetime-local" value={f.event_date} onChange={e => upd("event_date", e.target.value)} />
            </div>
            <div><Label>Fecha fin</Label>
              <Input type="datetime-local" value={f.end_date} onChange={e => upd("end_date", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Lugar / Dirección</Label>
              <Input value={f.location} onChange={e => upd("location", e.target.value)} placeholder="Av. Corrientes 1234..." />
            </div>
            <div><Label>Nombre del venue</Label>
              <Input value={f.venue_name} onChange={e => upd("venue_name", e.target.value)} placeholder="Teatro Gran Rex..." />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Capacidad total</Label>
              <Input type="number" min="1" value={f.capacity} onChange={e => upd("capacity", e.target.value)} />
            </div>
            <div><Label>Estado</Label>
              <Select value={f.status} onValueChange={v => upd("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Borrador</SelectItem>
                  <SelectItem value="published">Publicado</SelectItem>
                  <SelectItem value="cancelled">Cancelado</SelectItem>
                  <SelectItem value="completed">Completado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Tags (separados por coma)</Label>
            <Input value={f.tags} onChange={e => upd("tags", e.target.value)} placeholder="música, arte, taller..." />
          </div>
          <div><Label>URL de imagen de portada</Label>
            <Input value={f.cover_image_url} onChange={e => upd("cover_image_url", e.target.value)} placeholder="https://..." />
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

// ── TicketTypeForm dialog ─────────────────────────────────────────────────────
function TicketTypeForm({ open, onClose, editing, eventId, orgId, onSaved }: {
  open: boolean; onClose: () => void; editing: TicketType | null;
  eventId: string; orgId: string; onSaved: () => void;
}) {
  const [f, setF] = useState(blankTT());
  const [saving, setSaving] = useState(false);
  const upd = (k: string, v: unknown) => setF(p => ({ ...p, [k]: v }));

  useEffect(() => {
    if (editing) {
      setF({
        name: editing.name,
        description: editing.description || "",
        price: editing.price,
        quantity: editing.quantity,
        max_per_order: editing.max_per_order,
        sale_start: editing.sale_start ? editing.sale_start.substring(0, 16) : "",
        sale_end: editing.sale_end ? editing.sale_end.substring(0, 16) : "",
        color: editing.color,
      });
    } else { setF(blankTT()); }
  }, [editing, open]);

  async function save() {
    if (!f.name.trim()) { toast.error("Nombre requerido"); return; }
    setSaving(true);
    const payload = {
      event_id: eventId, org_id: orgId,
      name: f.name.trim(), description: f.description || null,
      price: Number(f.price), quantity: Number(f.quantity),
      max_per_order: Number(f.max_per_order),
      sale_start: f.sale_start || null, sale_end: f.sale_end || null,
      color: f.color,
    };
    const { error } = editing
      ? await supabase.from("ticket_types").update(payload).eq("id", editing.id)
      : await supabase.from("ticket_types").insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Tipo de entrada guardado");
    onSaved(); onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{editing ? "Editar tipo de entrada" : "Nuevo tipo de entrada"}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div><Label>Nombre *</Label>
            <Input value={f.name} onChange={e => upd("name", e.target.value)} placeholder="VIP, General, Early Bird..." />
          </div>
          <div><Label>Descripción</Label>
            <Input value={f.description} onChange={e => upd("description", e.target.value)} placeholder="Incluye acceso prioritario..." />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Precio (ARS)</Label>
              <Input type="number" min="0" value={f.price} onChange={e => upd("price", e.target.value)} />
            </div>
            <div><Label>Cantidad</Label>
              <Input type="number" min="1" value={f.quantity} onChange={e => upd("quantity", e.target.value)} />
            </div>
            <div><Label>Máx x orden</Label>
              <Input type="number" min="1" value={f.max_per_order} onChange={e => upd("max_per_order", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Venta desde</Label>
              <Input type="datetime-local" value={f.sale_start} onChange={e => upd("sale_start", e.target.value)} />
            </div>
            <div><Label>Venta hasta</Label>
              <Input type="datetime-local" value={f.sale_end} onChange={e => upd("sale_end", e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1"><Label>Color</Label>
              <Input type="color" value={f.color} onChange={e => upd("color", e.target.value)} className="h-10 p-1 cursor-pointer" />
            </div>
            <div className="pt-5">
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-white" style={{ backgroundColor: f.color }}>
                <Ticket className="w-4 h-4" /> {f.name || "Preview"}
              </div>
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

// ── AttendeeForm dialog ───────────────────────────────────────────────────────
function AttendeeForm({ open, onClose, editing, eventId, orgId, ticketTypes, onSaved }: {
  open: boolean; onClose: () => void; editing: Attendee | null;
  eventId: string; orgId: string; ticketTypes: TicketType[]; onSaved: () => void;
}) {
  const [f, setF] = useState(blankAttendee());
  const [saving, setSaving] = useState(false);
  const upd = (k: string, v: unknown) => setF(p => ({ ...p, [k]: v }));

  useEffect(() => {
    if (editing) {
      setF({
        name: editing.name,
        email: editing.email || "",
        phone: editing.phone || "",
        quantity: editing.quantity,
        amount_paid: editing.amount_paid,
        status: editing.status,
        notes: editing.notes || "",
        ticket_type_id: editing.ticket_type_id,
      });
    } else {
      const fa = blankAttendee();
      fa.ticket_type_id = ticketTypes[0]?.id || "";
      setF(fa);
    }
  }, [editing, open, ticketTypes]);

  async function save() {
    if (!f.name.trim() || !f.ticket_type_id) { toast.error("Nombre y tipo de entrada requeridos"); return; }
    setSaving(true);
    const payload = {
      event_id: eventId, org_id: orgId,
      ticket_type_id: f.ticket_type_id,
      name: f.name.trim(), email: f.email || null, phone: f.phone || null,
      quantity: Number(f.quantity), amount_paid: Number(f.amount_paid),
      status: f.status, notes: f.notes || null,
    };
    const { error } = editing
      ? await supabase.from("event_attendees").update(payload).eq("id", editing.id)
      : await supabase.from("event_attendees").insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Asistente guardado");
    onSaved(); onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{editing ? "Editar asistente" : "Registrar asistente"}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div><Label>Nombre *</Label>
            <Input value={f.name} onChange={e => upd("name", e.target.value)} placeholder="Juan García..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Email</Label>
              <Input type="email" value={f.email} onChange={e => upd("email", e.target.value)} />
            </div>
            <div><Label>Teléfono</Label>
              <Input value={f.phone} onChange={e => upd("phone", e.target.value)} />
            </div>
          </div>
          <div><Label>Tipo de entrada *</Label>
            <Select value={f.ticket_type_id} onValueChange={v => upd("ticket_type_id", v)}>
              <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
              <SelectContent>
                {ticketTypes.map(tt => (
                  <SelectItem key={tt.id} value={tt.id}>
                    {tt.name} — {fmtCurrency(tt.price)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Cantidad</Label>
              <Input type="number" min="1" value={f.quantity} onChange={e => upd("quantity", e.target.value)} />
            </div>
            <div><Label>Monto pagado</Label>
              <Input type="number" min="0" value={f.amount_paid} onChange={e => upd("amount_paid", e.target.value)} />
            </div>
            <div><Label>Estado</Label>
              <Select value={f.status} onValueChange={v => upd("status", v as Attendee["status"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ATTENDEE_STATUS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Notas</Label>
            <Textarea value={f.notes} onChange={e => upd("notes", e.target.value)} rows={2} />
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

// ── QR Ticket modal ───────────────────────────────────────────────────────────
function QRTicketModal({ attendee, event, onClose }: {
  attendee: Attendee; event: Event; onClose: () => void;
}) {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(attendee.ticket_code)}&size=200x200&bgcolor=ffffff&color=000000&qzone=2`;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-sm text-center">
        <DialogHeader>
          <DialogTitle>Ticket QR — {attendee.name}</DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <div className="bg-white rounded-2xl p-4 inline-block mx-auto shadow-lg">
            <img src={qrUrl} alt="QR Ticket" className="w-48 h-48 mx-auto" />
          </div>
          <div className="space-y-1">
            <p className="font-mono text-xl font-bold tracking-widest text-primary">{attendee.ticket_code}</p>
            <p className="text-sm text-muted-foreground">{event.name}</p>
            <p className="text-xs text-muted-foreground">{fmtDate(event.event_date)}</p>
            {attendee.ticket_types && (
              <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium text-white"
                style={{ backgroundColor: attendee.ticket_types.color }}>
                {attendee.ticket_types.name}
              </span>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => {
            const a = document.createElement("a");
            a.href = qrUrl; a.download = `ticket-${attendee.ticket_code}.png`; a.click();
          }}>
            <Download className="w-4 h-4 mr-1" /> Descargar QR
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Event detail panel ────────────────────────────────────────────────────────
function EventDetail({ event, orgId, onBack, onEventUpdated }: {
  event: Event; orgId: string; onBack: () => void; onEventUpdated: () => void;
}) {
  const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [tab, setTab] = useState("overview");
  const [ttFormOpen, setTtFormOpen] = useState(false);
  const [editingTT, setEditingTT] = useState<TicketType | null>(null);
  const [attFormOpen, setAttFormOpen] = useState(false);
  const [editingAtt, setEditingAtt] = useState<Attendee | null>(null);
  const [qrAtt, setQrAtt] = useState<Attendee | null>(null);
  const [search, setSearch] = useState("");
  const [checkingIn, setCheckingIn] = useState<string | null>(null);

  async function loadTicketTypes() {
    const { data } = await supabase.from("ticket_types").select("*").eq("event_id", event.id).order("price");
    setTicketTypes(data || []);
  }
  async function loadAttendees() {
    const { data } = await supabase.from("event_attendees").select("*, ticket_types(name, color)")
      .eq("event_id", event.id).order("created_at", { ascending: false });
    setAttendees((data || []) as Attendee[]);
  }

  useEffect(() => { loadTicketTypes(); loadAttendees(); }, [event.id]);

  async function checkIn(att: Attendee) {
    setCheckingIn(att.id);
    const { error } = await supabase.from("event_attendees").update({
      status: "checked_in", checked_in_at: new Date().toISOString(),
    }).eq("id", att.id);
    setCheckingIn(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`${att.name} registrado como ingresado`);
    loadAttendees();
  }

  async function deleteTT(id: string) {
    if (!confirm("¿Eliminar tipo de entrada?")) return;
    const { error } = await supabase.from("ticket_types").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Eliminado");
    loadTicketTypes();
  }

  const filtered = attendees.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.ticket_code.toLowerCase().includes(search.toLowerCase()) ||
    (a.email || "").toLowerCase().includes(search.toLowerCase())
  );

  const revenue = attendees.filter(a => a.status !== "cancelled").reduce((s, a) => s + a.amount_paid, 0);
  const checkedIn = attendees.filter(a => a.status === "checked_in").length;
  const confirmed = attendees.filter(a => a.status !== "cancelled").length;
  const occupancy = event.capacity > 0 ? Math.round((event.tickets_sold / event.capacity) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0">← Volver</Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold">{event.name}</h2>
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${STATUS_BADGE[event.status]}`}>
              {STATUS_LABEL[event.status]}
            </span>
          </div>
          <div className="flex flex-wrap gap-4 mt-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{fmtDate(event.event_date)}</span>
            {event.venue_name && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{event.venue_name}</span>}
            <span className="flex items-center gap-1"><Users className="w-3.5 h-3.5" />{event.tickets_sold}/{event.capacity} vendidos</span>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Ingresos", value: fmtCurrency(revenue), icon: DollarSign, color: "text-emerald-400" },
          { label: "Asistentes confirmados", value: confirmed, icon: Users, color: "text-blue-400" },
          { label: "Check-ins", value: `${checkedIn}/${confirmed}`, icon: CheckCircle2, color: "text-primary" },
          { label: "Ocupación", value: `${occupancy}%`, icon: TrendingUp, color: "text-yellow-400" },
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

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Resumen</TabsTrigger>
          <TabsTrigger value="tickets">Tipos de entrada ({ticketTypes.length})</TabsTrigger>
          <TabsTrigger value="attendees">Asistentes ({attendees.length})</TabsTrigger>
        </TabsList>

        {/* Ticket Types */}
        <TabsContent value="tickets" className="space-y-3 pt-2">
          <div className="flex justify-between items-center">
            <p className="text-sm text-muted-foreground">Configurá los tipos de entrada con precios y cantidades.</p>
            <Button size="sm" onClick={() => { setEditingTT(null); setTtFormOpen(true); }}>
              <Plus className="w-4 h-4 mr-1" /> Nuevo tipo
            </Button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {ticketTypes.map(tt => {
              const pct = tt.quantity > 0 ? Math.round((tt.sold / tt.quantity) * 100) : 0;
              return (
                <div key={tt.id} className="rounded-xl border border-border/50 bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: tt.color }} />
                      <div>
                        <p className="font-semibold">{tt.name}</p>
                        {tt.description && <p className="text-xs text-muted-foreground">{tt.description}</p>}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingTT(tt); setTtFormOpen(true); }}>
                        <Edit2 className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteTT(tt.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="font-bold text-primary">{fmtCurrency(tt.price)}</span>
                    <span className="text-muted-foreground">{tt.sold}/{tt.quantity} vendidos</span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: tt.color }} />
                  </div>
                </div>
              );
            })}
            {ticketTypes.length === 0 && (
              <div className="col-span-2 text-center py-8 text-muted-foreground text-sm">
                No hay tipos de entrada. Creá uno para empezar a vender.
              </div>
            )}
          </div>
        </TabsContent>

        {/* Attendees */}
        <TabsContent value="attendees" className="space-y-3 pt-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Buscar por nombre, código o email..."
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <Button size="sm" onClick={() => { setEditingAtt(null); setAttFormOpen(true); }} disabled={ticketTypes.length === 0}>
              <Plus className="w-4 h-4 mr-1" /> Registrar
            </Button>
          </div>

          <div className="rounded-xl border border-border/50 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-border/50">
                <tr className="text-muted-foreground text-xs">
                  <th className="text-left px-3 py-2">Asistente</th>
                  <th className="text-left px-3 py-2 hidden md:table-cell">Código</th>
                  <th className="text-left px-3 py-2 hidden lg:table-cell">Tipo</th>
                  <th className="text-left px-3 py-2">Estado</th>
                  <th className="text-right px-3 py-2">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(att => (
                  <tr key={att.id} className="border-b border-border/30 hover:bg-muted/20">
                    <td className="px-3 py-2">
                      <p className="font-medium">{att.name}</p>
                      {att.email && <p className="text-xs text-muted-foreground">{att.email}</p>}
                    </td>
                    <td className="px-3 py-2 hidden md:table-cell">
                      <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{att.ticket_code}</span>
                    </td>
                    <td className="px-3 py-2 hidden lg:table-cell">
                      {att.ticket_types && (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium text-white"
                          style={{ backgroundColor: att.ticket_types.color }}>
                          <Ticket className="w-3 h-3" />{att.ticket_types.name}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ATTENDEE_STATUS[att.status]?.cls}`}>
                        {ATTENDEE_STATUS[att.status]?.label}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="Ver QR" onClick={() => setQrAtt(att)}>
                          <QrCode className="w-3.5 h-3.5" />
                        </Button>
                        {att.status === "confirmed" && (
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-emerald-400"
                            title="Marcar ingresado" disabled={checkingIn === att.id}
                            onClick={() => checkIn(att)}>
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" className="h-7 w-7"
                          onClick={() => { setEditingAtt(att); setAttFormOpen(true); }}>
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={5} className="text-center py-8 text-muted-foreground text-sm">Sin asistentes</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Overview */}
        <TabsContent value="overview" className="space-y-4 pt-2">
          <div className="grid md:grid-cols-2 gap-4">
            {/* Event details */}
            <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
              <h3 className="font-semibold">Detalles del evento</h3>
              {event.description && <p className="text-sm text-muted-foreground">{event.description}</p>}
              {event.location && (
                <div className="flex items-start gap-2 text-sm">
                  <MapPin className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
                  <div>
                    {event.venue_name && <p className="font-medium">{event.venue_name}</p>}
                    <p className="text-muted-foreground">{event.location}</p>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span>{fmtDate(event.event_date)}</span>
                {event.end_date && <><span className="text-muted-foreground">→</span><span>{fmtDate(event.end_date)}</span></>}
              </div>
              {event.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {event.tags.map(t => (
                    <span key={t} className="flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full">
                      <Tag className="w-3 h-3" />{t}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Revenue by ticket type */}
            <div className="rounded-xl border border-border/50 bg-card p-4">
              <h3 className="font-semibold mb-3">Ventas por tipo</h3>
              {ticketTypes.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin tipos de entrada configurados.</p>
              ) : (
                <div className="space-y-2">
                  {ticketTypes.map(tt => {
                    const ttRevenue = attendees
                      .filter(a => a.ticket_type_id === tt.id && a.status !== "cancelled")
                      .reduce((s, a) => s + a.amount_paid, 0);
                    return (
                      <div key={tt.id} className="flex items-center gap-2 text-sm">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tt.color }} />
                        <span className="flex-1 truncate">{tt.name}</span>
                        <span className="font-mono text-xs">{tt.sold}/{tt.quantity}</span>
                        <span className="font-semibold text-primary">{fmtCurrency(ttRevenue)}</span>
                      </div>
                    );
                  })}
                  <div className="border-t border-border/50 pt-2 flex justify-between font-bold text-sm">
                    <span>Total</span>
                    <span className="text-emerald-400">{fmtCurrency(revenue)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <TicketTypeForm
        open={ttFormOpen} onClose={() => setTtFormOpen(false)}
        editing={editingTT} eventId={event.id} orgId={orgId}
        onSaved={() => { loadTicketTypes(); onEventUpdated(); }}
      />
      <AttendeeForm
        open={attFormOpen} onClose={() => setAttFormOpen(false)}
        editing={editingAtt} eventId={event.id} orgId={orgId}
        ticketTypes={ticketTypes} onSaved={loadAttendees}
      />
      {qrAtt && <QRTicketModal attendee={qrAtt} event={event} onClose={() => setQrAtt(null)} />}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function EventTicketingPage() {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventFormOpen, setEventFormOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Event | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  async function loadEvents() {
    if (!orgId) return;
    setLoading(true);
    const { data } = await supabase.from("events").select("*").eq("org_id", orgId).order("event_date", { ascending: false });
    setEvents(data || []);
    setLoading(false);
  }

  useEffect(() => { loadEvents(); }, [orgId]);

  async function deleteEvent(id: string) {
    if (!confirm("¿Eliminar este evento y todos sus asistentes?")) return;
    const { error } = await supabase.from("events").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Evento eliminado");
    loadEvents();
  }

  const filtered = useMemo(() => events.filter(e => {
    const matchSearch = e.name.toLowerCase().includes(search.toLowerCase()) ||
      (e.venue_name || "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || e.status === filterStatus;
    return matchSearch && matchStatus;
  }), [events, search, filterStatus]);

  const totalRevenue = events.reduce((s, e) => s + e.tickets_sold, 0);

  // If viewing event detail
  if (selectedEvent) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Ticket className="w-6 h-6 text-primary" /> Eventos & Tickets
          </h1>
        </div>
        <EventDetail
          event={selectedEvent} orgId={orgId} onBack={() => setSelectedEvent(null)}
          onEventUpdated={() => {
            loadEvents();
            // refresh selected event
            supabase.from("events").select("*").eq("id", selectedEvent.id).single()
              .then(({ data }) => { if (data) setSelectedEvent(data as Event); });
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Ticket className="w-6 h-6 text-primary" /> Eventos & Tickets
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Gestioná eventos, tipos de entrada, asistentes y check-in con QR.
          </p>
        </div>
        <Button onClick={() => { setEditingEvent(null); setEventFormOpen(true); }}>
          <Plus className="w-4 h-4 mr-1" /> Nuevo evento
        </Button>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Eventos totales", value: events.length, icon: Calendar },
          { label: "Publicados", value: events.filter(e => e.status === "published").length, icon: CheckCircle2 },
          { label: "Tickets vendidos", value: totalRevenue, icon: Ticket },
          { label: "Próximos (7 días)", value: events.filter(e => {
            const d = new Date(e.event_date);
            const now = new Date();
            const week = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
            return d >= now && d <= week;
          }).length, icon: Clock },
        ].map(k => (
          <div key={k.label} className="rounded-xl border border-border/50 bg-card p-4">
            <div className="flex items-center gap-2 mb-1">
              <k.icon className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">{k.label}</span>
            </div>
            <p className="text-2xl font-bold">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar eventos..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="draft">Borrador</SelectItem>
            <SelectItem value="published">Publicado</SelectItem>
            <SelectItem value="completed">Completado</SelectItem>
            <SelectItem value="cancelled">Cancelado</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={loadEvents}><RefreshCw className="w-4 h-4" /></Button>
      </div>

      {/* Events grid */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Cargando eventos...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          {events.length === 0 ? "Creá tu primer evento para empezar a vender tickets." : "Sin resultados."}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(evt => {
            const occupancy = evt.capacity > 0 ? Math.round((evt.tickets_sold / evt.capacity) * 100) : 0;
            const isPast = new Date(evt.event_date) < new Date();
            return (
              <div key={evt.id} className="rounded-2xl border border-border/50 bg-card overflow-hidden hover:border-primary/30 transition-all group">
                {evt.cover_image_url && (
                  <div className="h-32 overflow-hidden">
                    <img src={evt.cover_image_url} alt={evt.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  </div>
                )}
                <div className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold truncate">{evt.name}</h3>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${STATUS_BADGE[evt.status]}`}>
                          {STATUS_LABEL[evt.status]}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                        <Calendar className="w-3 h-3" />{fmtDate(evt.event_date)}
                        {isPast && <span className="ml-1 text-yellow-500">(pasado)</span>}
                      </div>
                    </div>
                  </div>
                  {evt.venue_name && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="w-3 h-3" />{evt.venue_name}
                    </div>
                  )}
                  {evt.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {evt.tags.map(t => (
                        <span key={t} className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full">{t}</span>
                      ))}
                    </div>
                  )}
                  {/* Occupancy bar */}
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>{evt.tickets_sold} vendidos</span>
                      <span>{occupancy}% de {evt.capacity}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${occupancy}%` }} />
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" className="flex-1" onClick={() => setSelectedEvent(evt)}>
                      <Users className="w-3.5 h-3.5 mr-1" /> Ver evento
                    </Button>
                    <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => { setEditingEvent(evt); setEventFormOpen(true); }}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" variant="outline" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => deleteEvent(evt.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <EventForm
        open={eventFormOpen} onClose={() => setEventFormOpen(false)}
        editing={editingEvent} orgId={orgId} onSaved={loadEvents}
      />
    </div>
  );
}
