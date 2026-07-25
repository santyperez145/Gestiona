import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Truck, MapPin, Package, Plus, Edit2, Trash2, RefreshCw,
  Search, CheckCircle2, Clock, XCircle, AlertTriangle, Copy,
  Navigation, Phone, DollarSign, TrendingUp, Loader2,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Delivery {
  id: string;
  tracking_code: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  address_street: string;
  address_city: string;
  address_province: string | null;
  address_zip: string | null;
  address_notes: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  vehicle_plate: string | null;
  carrier: string;
  external_tracking: string | null;
  scheduled_for: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  status: string;
  priority: string;
  weight_kg: number | null;
  cod_amount: number;
  cod_collected: boolean;
  notes: string | null;
  created_at: string;
}

interface DeliveryEvent {
  id: string;
  delivery_id: string;
  status: string;
  description: string;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const STATUS_CFG: Record<string, { label: string; cls: string; icon: typeof Clock }> = {
  pending:           { label: "Pendiente",          cls: "bg-muted text-muted-foreground",         icon: Clock },
  assigned:          { label: "Asignado",           cls: "bg-blue-500/15 text-blue-400",           icon: Truck },
  picked_up:         { label: "Retirado",           cls: "bg-yellow-500/15 text-yellow-500",       icon: Package },
  in_transit:        { label: "En tránsito",        cls: "bg-purple-500/15 text-purple-400",       icon: Navigation },
  out_for_delivery:  { label: "En camino",          cls: "bg-primary/15 text-primary",             icon: Truck },
  delivered:         { label: "Entregado",          cls: "bg-emerald-500/15 text-emerald-400",     icon: CheckCircle2 },
  failed:            { label: "Falló",              cls: "bg-destructive/15 text-destructive",     icon: XCircle },
  returned:          { label: "Devuelto",           cls: "bg-orange-500/15 text-orange-400",       icon: XCircle },
};

const PRIORITY_CFG: Record<string, string> = {
  low: "text-muted-foreground", normal: "text-foreground",
  high: "text-yellow-500", urgent: "text-destructive font-bold",
};

const CARRIER_LABELS: Record<string, string> = {
  propio: "Envío propio", oca: "OCA", andreani: "Andreani",
  correo_arg: "Correo Argentino", mercado_envios: "Mercado Envíos", otro: "Otro",
};

function fmtDate(d: string) {
  return new Date(d).toLocaleString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
function fmtCurrency(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
}

const STATUS_FLOW = ["pending","assigned","picked_up","in_transit","out_for_delivery","delivered"];

// ── Delivery Form ─────────────────────────────────────────────────────────────
const blankDel = () => ({
  customer_name: "", customer_phone: "", customer_email: "",
  address_street: "", address_city: "", address_province: "Buenos Aires",
  address_zip: "", address_notes: "",
  driver_name: "", driver_phone: "", vehicle_plate: "",
  carrier: "propio", external_tracking: "",
  scheduled_for: "", priority: "normal",
  weight_kg: "", cod_amount: 0, notes: "",
  status: "pending",
});

function DeliveryForm({ open, onClose, editing, orgId, onSaved }: {
  open: boolean; onClose: () => void; editing: Delivery | null;
  orgId: string; onSaved: () => void;
}) {
  const [f, setF] = useState(blankDel());
  const [saving, setSaving] = useState(false);
  const upd = (k: string, v: unknown) => setF(p => ({ ...p, [k]: v }));

  useEffect(() => {
    if (editing) {
      setF({
        customer_name: editing.customer_name, customer_phone: editing.customer_phone || "",
        customer_email: editing.customer_email || "",
        address_street: editing.address_street, address_city: editing.address_city,
        address_province: editing.address_province || "Buenos Aires",
        address_zip: editing.address_zip || "", address_notes: editing.address_notes || "",
        driver_name: editing.driver_name || "", driver_phone: editing.driver_phone || "",
        vehicle_plate: editing.vehicle_plate || "",
        carrier: editing.carrier, external_tracking: editing.external_tracking || "",
        scheduled_for: editing.scheduled_for ? editing.scheduled_for.substring(0, 16) : "",
        priority: editing.priority, weight_kg: editing.weight_kg !== null ? String(editing.weight_kg) : "",
        cod_amount: editing.cod_amount, notes: editing.notes || "",
        status: editing.status,
      });
    } else { setF(blankDel()); }
  }, [editing, open]);

  async function save() {
    if (!f.customer_name.trim() || !f.address_street.trim() || !f.address_city.trim()) {
      toast.error("Nombre, calle y ciudad son requeridos"); return;
    }
    setSaving(true);
    const payload = {
      org_id: orgId, customer_name: f.customer_name.trim(),
      customer_phone: f.customer_phone || null, customer_email: f.customer_email || null,
      address_street: f.address_street, address_city: f.address_city,
      address_province: f.address_province || null, address_zip: f.address_zip || null,
      address_notes: f.address_notes || null,
      driver_name: f.driver_name || null, driver_phone: f.driver_phone || null,
      vehicle_plate: f.vehicle_plate || null, carrier: f.carrier,
      external_tracking: f.external_tracking || null,
      scheduled_for: f.scheduled_for || null, priority: f.priority,
      weight_kg: f.weight_kg ? Number(f.weight_kg) : null,
      cod_amount: Number(f.cod_amount), notes: f.notes || null,
      status: f.status, tracking_code: editing?.tracking_code || "",
    };
    const { error } = editing
      ? await supabase.from("deliveries").update(payload).eq("id", editing.id)
      : await supabase.from("deliveries").insert(payload);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(editing ? "Envío actualizado" : "Envío creado");
    onSaved(); onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{editing ? "Editar envío" : "Nuevo envío"}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2 max-h-[75vh] overflow-y-auto pr-1">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Destinatario</p>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Nombre *</Label>
              <Input value={f.customer_name} onChange={e => upd("customer_name", e.target.value)} />
            </div>
            <div><Label>Teléfono</Label>
              <Input value={f.customer_phone} onChange={e => upd("customer_phone", e.target.value)} />
            </div>
          </div>
          <div><Label>Dirección *</Label>
            <Input value={f.address_street} onChange={e => upd("address_street", e.target.value)} placeholder="Av. Corrientes 1234, Piso 3..." />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2"><Label>Ciudad *</Label>
              <Input value={f.address_city} onChange={e => upd("address_city", e.target.value)} />
            </div>
            <div><Label>CP</Label>
              <Input value={f.address_zip} onChange={e => upd("address_zip", e.target.value)} />
            </div>
          </div>
          <div><Label>Indicaciones de entrega</Label>
            <Input value={f.address_notes} onChange={e => upd("address_notes", e.target.value)} placeholder="Timbre 3B, hablar con portero..." />
          </div>

          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pt-1">Logística</p>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Transportista</Label>
              <Select value={f.carrier} onValueChange={v => upd("carrier", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CARRIER_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>N° seguimiento externo</Label>
              <Input value={f.external_tracking} onChange={e => upd("external_tracking", e.target.value)} placeholder="OCA-123456..." />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Repartidor</Label>
              <Input value={f.driver_name} onChange={e => upd("driver_name", e.target.value)} />
            </div>
            <div><Label>Tel. repartidor</Label>
              <Input value={f.driver_phone} onChange={e => upd("driver_phone", e.target.value)} />
            </div>
            <div><Label>Patente</Label>
              <Input value={f.vehicle_plate} onChange={e => upd("vehicle_plate", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Fecha programada</Label>
              <Input type="datetime-local" value={f.scheduled_for} onChange={e => upd("scheduled_for", e.target.value)} />
            </div>
            <div><Label>Prioridad</Label>
              <Select value={f.priority} onValueChange={v => upd("priority", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Baja</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="urgent">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Peso (kg)</Label>
              <Input type="number" min="0" step="0.1" value={f.weight_kg as string} onChange={e => upd("weight_kg", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>COD (cobrar al entregar)</Label>
              <Input type="number" min="0" value={f.cod_amount} onChange={e => upd("cod_amount", e.target.value)} />
            </div>
            <div><Label>Estado</Label>
              <Select value={f.status} onValueChange={v => upd("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
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

// ── Tracking Detail modal ─────────────────────────────────────────────────────
function TrackingModal({ delivery, onClose, onUpdate }: {
  delivery: Delivery; onClose: () => void; onUpdate: () => void;
}) {
  const [events, setEvents] = useState<DeliveryEvent[]>([]);
  const [newDesc, setNewDesc] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    supabase.from("delivery_events").select("*")
      .eq("delivery_id", delivery.id).order("created_at", { ascending: false })
      .then(({ data }) => setEvents(data || []));
  }, [delivery.id]);

  async function addEvent() {
    if (!newDesc.trim()) return;
    setAdding(true);
    await supabase.from("delivery_events").insert({
      delivery_id: delivery.id, status: delivery.status, description: newDesc.trim(),
    });
    setNewDesc(""); setAdding(false);
    const { data } = await supabase.from("delivery_events").select("*")
      .eq("delivery_id", delivery.id).order("created_at", { ascending: false });
    setEvents(data || []);
    onUpdate();
  }

  async function advanceStatus() {
    const idx = STATUS_FLOW.indexOf(delivery.status);
    if (idx === -1 || idx >= STATUS_FLOW.length - 1) return;
    const next = STATUS_FLOW[idx + 1];
    const update: Record<string, unknown> = { status: next };
    if (next === "picked_up") update.picked_up_at = new Date().toISOString();
    if (next === "delivered") update.delivered_at = new Date().toISOString();
    await supabase.from("deliveries").update(update).eq("id", delivery.id);
    await supabase.from("delivery_events").insert({
      delivery_id: delivery.id, status: next,
      description: `Estado actualizado a: ${STATUS_CFG[next]?.label}`,
    });
    toast.success(`Estado: ${STATUS_CFG[next]?.label}`);
    onUpdate(); onClose();
  }

  const cfg = STATUS_CFG[delivery.status];
  const idx = STATUS_FLOW.indexOf(delivery.status);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tracking: {delivery.tracking_code}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Status bar */}
          <div className="flex gap-1">
            {STATUS_FLOW.map((s, i) => (
              <div key={s} className={`h-1.5 flex-1 rounded-full transition-all ${i <= idx ? "bg-primary" : "bg-muted"}`} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${cfg?.cls}`}>{cfg?.label}</span>
            {delivery.priority !== "normal" && (
              <span className={`text-xs font-bold ${PRIORITY_CFG[delivery.priority]}`}>
                {delivery.priority === "urgent" ? "🚨 URGENTE" : delivery.priority === "high" ? "⚡ Alta prioridad" : ""}
              </span>
            )}
          </div>

          <div className="text-sm space-y-1">
            <p className="font-medium">{delivery.customer_name}</p>
            <p className="text-muted-foreground flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" />
              {delivery.address_street}, {delivery.address_city}
            </p>
            {delivery.driver_name && (
              <p className="text-muted-foreground flex items-center gap-1">
                <Truck className="w-3.5 h-3.5" />{delivery.driver_name}
                {delivery.vehicle_plate && ` (${delivery.vehicle_plate})`}
              </p>
            )}
            {delivery.cod_amount > 0 && (
              <p className="text-yellow-500 font-medium flex items-center gap-1">
                <DollarSign className="w-3.5 h-3.5" />COD: {fmtCurrency(delivery.cod_amount)}
                {delivery.cod_collected ? " ✓" : " (pendiente)"}
              </p>
            )}
          </div>

          {/* Advance button */}
          {idx < STATUS_FLOW.length - 1 && delivery.status !== "failed" && delivery.status !== "returned" && (
            <Button size="sm" onClick={advanceStatus} className="w-full">
              Avanzar → {STATUS_CFG[STATUS_FLOW[idx + 1]]?.label}
            </Button>
          )}

          {/* Timeline */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">Historial</p>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {events.map(ev => (
                <div key={ev.id} className="flex gap-2 text-xs">
                  <div className="w-2 h-2 rounded-full bg-primary/60 mt-1 shrink-0" />
                  <div>
                    <p className="text-muted-foreground">{fmtDate(ev.created_at)}</p>
                    <p>{ev.description}</p>
                  </div>
                </div>
              ))}
              {events.length === 0 && <p className="text-xs text-muted-foreground">Sin eventos registrados</p>}
            </div>
          </div>

          {/* Add event */}
          <div className="flex gap-2">
            <Input placeholder="Agregar nota de seguimiento..." value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addEvent()}
              className="text-xs" />
            <Button size="sm" onClick={addEvent} disabled={adding || !newDesc.trim()}>+</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function DeliveryTrackingPage() {
  usePageTitle("Seguimiento de Envíos");
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Delivery | null>(null);
  const [tracking, setTracking] = useState<Delivery | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterDriver, setFilterDriver] = useState("all");

  async function loadData() {
    if (!orgId) return;
    setLoading(true);
    const { data } = await supabase.from("deliveries").select("*")
      .eq("org_id", orgId).order("created_at", { ascending: false }).limit(300);
    setDeliveries(data || []);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [orgId]);

  async function deleteDelivery(id: string) {
    if (!confirm("¿Eliminar este envío?")) return;
    await supabase.from("deliveries").delete().eq("id", id);
    toast.success("Envío eliminado");
    loadData();
  }

  const drivers = useMemo(() => [...new Set(deliveries.map(d => d.driver_name).filter(Boolean))], [deliveries]);

  const filtered = useMemo(() => deliveries.filter(d => {
    const matchSearch = d.customer_name.toLowerCase().includes(search.toLowerCase()) ||
      d.tracking_code.toLowerCase().includes(search.toLowerCase()) ||
      d.address_city.toLowerCase().includes(search.toLowerCase()) ||
      (d.driver_name || "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || d.status === filterStatus;
    const matchDriver = filterDriver === "all" || d.driver_name === filterDriver;
    return matchSearch && matchStatus && matchDriver;
  }), [deliveries, search, filterStatus, filterDriver]);

  const pendingCOD = deliveries.filter(d => d.cod_amount > 0 && !d.cod_collected && d.status !== "failed" && d.status !== "returned")
    .reduce((s, d) => s + d.cod_amount, 0);
  const todayDelivered = deliveries.filter(d => d.status === "delivered" && d.delivered_at && new Date(d.delivered_at).toDateString() === new Date().toDateString()).length;
  const inTransit = deliveries.filter(d => ["in_transit","out_for_delivery","picked_up","assigned"].includes(d.status)).length;

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Truck}
        title="Seguimiento de Envíos"
        description="Gestioná entregas, repartidores, COD y tracking en tiempo real."
        actions={
          <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus className="w-4 h-4 mr-1" /> Nuevo envío
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="Total envíos" value={deliveries.length} icon={Package} color="primary" />
        <KPICard label="En tránsito" value={inTransit} icon={Truck} color="blue" />
        <KPICard label="Entregados hoy" value={todayDelivered} icon={CheckCircle2} color="success" />
        <KPICard label="COD pendiente" value={fmtCurrency(pendingCOD)} icon={DollarSign} color="warning" />
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar por cliente, código, ciudad..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(STATUS_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {drivers.length > 0 && (
          <Select value={filterDriver} onValueChange={setFilterDriver}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Repartidor" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {(drivers as string[]).map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Button variant="outline" size="icon" onClick={loadData}><RefreshCw className="w-4 h-4" /></Button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
        </div>
      ) : (
        <div className="rounded-xl border border-border/50 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border/50 bg-muted/20">
              <tr className="text-muted-foreground text-xs">
                <th className="text-left px-3 py-2.5">Código</th>
                <th className="text-left px-3 py-2.5">Destinatario</th>
                <th className="text-left px-3 py-2.5 hidden md:table-cell">Dirección</th>
                <th className="text-left px-3 py-2.5 hidden lg:table-cell">Repartidor</th>
                <th className="text-left px-3 py-2.5">Estado</th>
                <th className="text-right px-3 py-2.5">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(d => {
                const cfg = STATUS_CFG[d.status];
                return (
                  <tr key={d.id} className="border-b border-border/30 hover:bg-muted/20">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{d.tracking_code}</code>
                        <button onClick={() => navigator.clipboard.writeText(d.tracking_code).then(() => toast.success("Código copiado"))}
                          className="text-muted-foreground hover:text-foreground">
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                      <p className={`text-[10px] mt-0.5 ${PRIORITY_CFG[d.priority]}`}>
                        {d.priority !== "normal" ? d.priority.toUpperCase() : ""}
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      <p className="font-medium">{d.customer_name}</p>
                      {d.customer_phone && (
                        <a href={`tel:${d.customer_phone}`} className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1">
                          <Phone className="w-3 h-3" />{d.customer_phone}
                        </a>
                      )}
                    </td>
                    <td className="px-3 py-2 hidden md:table-cell">
                      <p className="text-xs">{d.address_street}</p>
                      <p className="text-xs text-muted-foreground">{d.address_city}</p>
                    </td>
                    <td className="px-3 py-2 hidden lg:table-cell">
                      <p className="text-xs">{d.driver_name || "—"}</p>
                      <p className="text-xs text-muted-foreground">{CARRIER_LABELS[d.carrier]}</p>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg?.cls}`}>{cfg?.label}</span>
                      {d.cod_amount > 0 && !d.cod_collected && (
                        <p className="text-[10px] text-yellow-500 mt-0.5">COD {fmtCurrency(d.cod_amount)}</p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="Tracking" onClick={() => setTracking(d)}>
                          <Navigation className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(d); setFormOpen(true); }}>
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteDelivery(d.id)}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="text-center py-8 text-muted-foreground text-sm">Sin envíos</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <DeliveryForm open={formOpen} onClose={() => setFormOpen(false)}
        editing={editing} orgId={orgId} onSaved={loadData} />
      {tracking && <TrackingModal delivery={tracking} onClose={() => setTracking(null)} onUpdate={loadData} />}
    </div>
  );
}
