import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { useUserRole } from "@/lib/useUserRole";
import { toast } from "sonner";
import {
  Wrench, Plus, X, Save, ChevronDown, ChevronUp, Search, RefreshCw,
  Clock, CheckCircle, AlertTriangle, User, MapPin, Phone, Calendar,
  Package, DollarSign, FileText, Star, Trash2, Edit2, Filter,
  PlayCircle, PauseCircle, XCircle, ClipboardList, Zap, Loader2,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

// ── Types ─────────────────────────────────────────────────────────────────────
type SOStatus = 'pending' | 'assigned' | 'in_progress' | 'on_hold' | 'completed' | 'cancelled';
type SOPriority = 'low' | 'medium' | 'high' | 'urgent';
type SOServiceType = 'repair' | 'installation' | 'maintenance' | 'inspection' | 'consultation' | 'other';

interface ServiceOrder {
  id: string;
  order_number: string;
  title: string;
  description: string | null;
  status: SOStatus;
  priority: SOPriority;
  service_type: SOServiceType;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  assigned_name: string | null;
  scheduled_at: string | null;
  completed_at: string | null;
  estimated_hours: number | null;
  actual_hours: number | null;
  labor_cost: number;
  parts_cost: number;
  total_cost: number;
  notes: string | null;
  internal_notes: string | null;
  rating: number | null;
  created_at: string;
  updated_at: string;
}

interface SOItem {
  id: string;
  item_type: 'part' | 'labor' | 'material' | 'other';
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
}

// ── Config ────────────────────────────────────────────────────────────────────
const STATUS_CFG: Record<SOStatus, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  pending:     { label: 'Pendiente',    color: 'text-slate-400',   bg: 'bg-slate-500/10 border-slate-500/20',   icon: Clock },
  assigned:    { label: 'Asignada',     color: 'text-blue-400',    bg: 'bg-blue-500/10 border-blue-500/20',     icon: User },
  in_progress: { label: 'En progreso',  color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/20',   icon: PlayCircle },
  on_hold:     { label: 'En pausa',     color: 'text-orange-400',  bg: 'bg-orange-500/10 border-orange-500/20', icon: PauseCircle },
  completed:   { label: 'Completada',   color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20',icon: CheckCircle },
  cancelled:   { label: 'Cancelada',    color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/20',       icon: XCircle },
};

const PRIORITY_CFG: Record<SOPriority, { label: string; color: string }> = {
  low:    { label: 'Baja',    color: 'text-slate-400' },
  medium: { label: 'Media',   color: 'text-blue-400' },
  high:   { label: 'Alta',    color: 'text-amber-400' },
  urgent: { label: 'Urgente', color: 'text-red-400' },
};

const SERVICE_TYPES: Record<SOServiceType, string> = {
  repair:       'Reparación',
  installation: 'Instalación',
  maintenance:  'Mantenimiento',
  inspection:   'Inspección',
  consultation: 'Consultoría',
  other:        'Otro',
};

// ── Empty form ────────────────────────────────────────────────────────────────
const emptyForm = () => ({
  title: '', description: '', status: 'pending' as SOStatus,
  priority: 'medium' as SOPriority, service_type: 'repair' as SOServiceType,
  customer_name: '', customer_phone: '', customer_address: '',
  assigned_name: '', scheduled_at: '', estimated_hours: '',
  notes: '', internal_notes: '',
});

// ── Component ─────────────────────────────────────────────────────────────────
export default function ServiceOrdersPage() {
  usePageTitle("Órdenes de Servicio");
  const { activeOrg } = useOrg();
  const { isAdmin } = useUserRole();
  const [orders, setOrders] = useState<ServiceOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | SOStatus>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [orderItems, setOrderItems] = useState<Record<string, SOItem[]>>({});
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ServiceOrder | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  // Item form
  const [newItem, setNewItem] = useState({ item_type: 'part' as SOItem['item_type'], description: '', quantity: '1', unit_price: '' });
  const [addingItemFor, setAddingItemFor] = useState<string | null>(null);

  const load = async () => {
    if (!activeOrg?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("service_orders")
        .select("*")
        .eq("org_id", activeOrg.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setOrders(data ?? []);
    } catch (e: any) {
      toast.error("Error cargando órdenes: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadItems = async (orderId: string) => {
    if (orderItems[orderId]) return;
    const { data } = await supabase
      .from("service_order_items")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at");
    if (data) setOrderItems(prev => ({ ...prev, [orderId]: data }));
  };

  useEffect(() => { load(); }, [activeOrg?.id]);

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setShowForm(true); };
  const openEdit = (o: ServiceOrder) => {
    setEditing(o);
    setForm({
      title: o.title, description: o.description ?? '',
      status: o.status, priority: o.priority, service_type: o.service_type,
      customer_name: o.customer_name ?? '', customer_phone: o.customer_phone ?? '',
      customer_address: o.customer_address ?? '', assigned_name: o.assigned_name ?? '',
      scheduled_at: o.scheduled_at ? o.scheduled_at.slice(0, 16) : '',
      estimated_hours: o.estimated_hours?.toString() ?? '',
      notes: o.notes ?? '', internal_notes: o.internal_notes ?? '',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { toast.error("El título es obligatorio"); return; }
    if (!activeOrg?.id) return;
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        status: form.status,
        priority: form.priority,
        service_type: form.service_type,
        customer_name: form.customer_name.trim() || null,
        customer_phone: form.customer_phone.trim() || null,
        customer_address: form.customer_address.trim() || null,
        assigned_name: form.assigned_name.trim() || null,
        scheduled_at: form.scheduled_at ? new Date(form.scheduled_at).toISOString() : null,
        estimated_hours: form.estimated_hours ? parseFloat(form.estimated_hours) : null,
        notes: form.notes.trim() || null,
        internal_notes: form.internal_notes.trim() || null,
        ...(form.status === 'completed' && !editing?.completed_at ? { completed_at: new Date().toISOString() } : {}),
      };

      if (editing) {
        const { error } = await supabase.from("service_orders").update(payload).eq("id", editing.id);
        if (error) throw error;
        toast.success("Orden actualizada");
      } else {
        const number = `OT-${format(new Date(), 'yyyyMMdd')}-${String(orders.length + 1).padStart(4, '0')}`;
        const { error } = await supabase.from("service_orders").insert({
          ...payload, org_id: activeOrg.id, order_number: number,
        });
        if (error) throw error;
        toast.success("Orden creada");
      }
      setShowForm(false);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const addItem = async (orderId: string) => {
    if (!newItem.description.trim()) { toast.error("La descripción es obligatoria"); return; }
    if (!activeOrg?.id) return;
    const { error } = await supabase.from("service_order_items").insert({
      order_id: orderId,
      org_id: activeOrg.id,
      item_type: newItem.item_type,
      description: newItem.description.trim(),
      quantity: parseFloat(newItem.quantity) || 1,
      unit_price: parseFloat(newItem.unit_price) || 0,
    });
    if (error) { toast.error(error.message); return; }
    setNewItem({ item_type: 'part', description: '', quantity: '1', unit_price: '' });
    setAddingItemFor(null);
    setOrderItems(prev => { const copy = { ...prev }; delete copy[orderId]; return copy; });
    loadItems(orderId);
    load(); // refresh costs
    toast.success("Ítem agregado");
  };

  const deleteItem = async (item: SOItem, orderId: string) => {
    await supabase.from("service_order_items").delete().eq("id", item.id);
    setOrderItems(prev => ({
      ...prev,
      [orderId]: (prev[orderId] ?? []).filter(i => i.id !== item.id),
    }));
    load();
  };

  const quickStatus = async (o: ServiceOrder, status: SOStatus) => {
    const { error } = await supabase.from("service_orders").update({
      status,
      ...(status === 'in_progress' && !o.started_at ? { started_at: new Date().toISOString() } : {}),
      ...(status === 'completed' ? { completed_at: new Date().toISOString() } : {}),
    }).eq("id", o.id);
    if (error) { toast.error(error.message); return; }
    load();
    toast.success(`Estado → ${STATUS_CFG[status].label}`);
  };

  const filtered = useMemo(() => {
    return orders.filter(o => {
      const matchSearch = !search || o.title.toLowerCase().includes(search.toLowerCase())
        || o.order_number.toLowerCase().includes(search.toLowerCase())
        || (o.customer_name ?? '').toLowerCase().includes(search.toLowerCase());
      const matchStatus = filterStatus === 'all' || o.status === filterStatus;
      return matchSearch && matchStatus;
    });
  }, [orders, search, filterStatus]);

  // KPIs
  const kpis = useMemo(() => {
    const open = orders.filter(o => !['completed', 'cancelled'].includes(o.status)).length;
    const urgent = orders.filter(o => o.priority === 'urgent' && !['completed', 'cancelled'].includes(o.status)).length;
    const done = orders.filter(o => o.status === 'completed').length;
    const revenue = orders.filter(o => o.status === 'completed').reduce((s, o) => s + (o.total_cost || 0), 0);
    const avgRating = (() => {
      const rated = orders.filter(o => o.rating);
      return rated.length ? (rated.reduce((s, o) => s + (o.rating ?? 0), 0) / rated.length).toFixed(1) : '-';
    })();
    return { open, urgent, done, revenue, avgRating };
  }, [orders]);

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Wrench}
        title="Órdenes de Servicio"
        description="Field Service Management · Gestión de trabajo técnico"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            {isAdmin && (
              <Button className="gradient-gold text-primary-foreground gap-2" onClick={openCreate}>
                <Plus className="w-4 h-4" /> Nueva orden
              </Button>
            )}
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <KPICard label="Abiertas" value={kpis.open} icon={ClipboardList} color="warning" />
        <KPICard label="Urgentes" value={kpis.urgent} icon={AlertTriangle} color="destructive" />
        <KPICard label="Completadas" value={kpis.done} icon={CheckCircle} color="success" />
        <KPICard label="Facturado" value={`$${kpis.revenue.toLocaleString("es-AR")}`} icon={DollarSign} color="primary" />
        <KPICard label="Rating promedio" value={kpis.avgRating !== '-' ? `${kpis.avgRating}` : '—'} icon={Star} color="warning" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground/50" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar orden, cliente..." className="pl-8 bg-muted" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {(['all', ...Object.keys(STATUS_CFG)] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                filterStatus === s
                  ? 'bg-primary/15 text-primary border-primary/30'
                  : 'border-border text-muted-foreground hover:bg-muted/50'
              }`}
            >
              {s === 'all' ? 'Todas' : STATUS_CFG[s as SOStatus].label}
            </button>
          ))}
        </div>
      </div>

      {/* Form */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="font-display font-bold">{editing ? 'Editar orden' : 'Nueva orden de servicio'}</h2>
              <button onClick={() => setShowForm(false)}><X className="w-4 h-4 text-muted-foreground" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Título *</label>
                <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="bg-muted" placeholder="Ej: Reparación de pantalla iPhone 13" autoFocus />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Tipo</label>
                  <Select value={form.service_type} onValueChange={v => setForm(f => ({ ...f, service_type: v as SOServiceType }))}>
                    <SelectTrigger className="bg-muted"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(SERVICE_TYPES).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Prioridad</label>
                  <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v as SOPriority }))}>
                    <SelectTrigger className="bg-muted"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(PRIORITY_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Estado</label>
                  <Select value={form.status} onValueChange={v => setForm(f => ({ ...f, status: v as SOStatus }))}>
                    <SelectTrigger className="bg-muted"><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(STATUS_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Descripción</label>
                <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="bg-muted resize-none" rows={2} placeholder="Descripción del problema o trabajo a realizar" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><User className="w-3 h-3" />Cliente</label>
                  <Input value={form.customer_name} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))} className="bg-muted" placeholder="Nombre del cliente" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Phone className="w-3 h-3" />Teléfono</label>
                  <Input value={form.customer_phone} onChange={e => setForm(f => ({ ...f, customer_phone: e.target.value }))} className="bg-muted" placeholder="+54 9 11..." />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><MapPin className="w-3 h-3" />Dirección del servicio</label>
                <Input value={form.customer_address} onChange={e => setForm(f => ({ ...f, customer_address: e.target.value }))} className="bg-muted" placeholder="Dirección donde realizar el trabajo" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><User className="w-3 h-3" />Técnico asignado</label>
                  <Input value={form.assigned_name} onChange={e => setForm(f => ({ ...f, assigned_name: e.target.value }))} className="bg-muted" placeholder="Nombre del técnico" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Clock className="w-3 h-3" />Hs estimadas</label>
                  <Input type="number" value={form.estimated_hours} onChange={e => setForm(f => ({ ...f, estimated_hours: e.target.value }))} className="bg-muted" placeholder="2.5" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Calendar className="w-3 h-3" />Fecha programada</label>
                <Input type="datetime-local" value={form.scheduled_at} onChange={e => setForm(f => ({ ...f, scheduled_at: e.target.value }))} className="bg-muted" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Notas para el cliente</label>
                <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="bg-muted resize-none" rows={2} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Notas internas</label>
                <Textarea value={form.internal_notes} onChange={e => setForm(f => ({ ...f, internal_notes: e.target.value }))} className="bg-muted resize-none" rows={2} />
              </div>
            </div>
            <div className="flex gap-2 px-5 pb-5">
              <Button variant="outline" className="flex-1" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button className="flex-1 gradient-gold text-primary-foreground gap-1.5" onClick={handleSave} disabled={saving}>
                {saving ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                {editing ? 'Guardar' : 'Crear orden'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Order list */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <ClipboardList className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No hay órdenes de servicio.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(order => {
            const sc = STATUS_CFG[order.status];
            const pc = PRIORITY_CFG[order.priority];
            const isExpanded = expandedId === order.id;
            const StatusIcon = sc.icon;
            return (
              <div key={order.id} className="bg-card border border-border rounded-xl overflow-hidden">
                <button
                  className="w-full text-left p-4 flex items-start gap-3"
                  onClick={() => {
                    const next = isExpanded ? null : order.id;
                    setExpandedId(next);
                    if (next) loadItems(next);
                  }}
                >
                  {/* Status icon */}
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${sc.bg}`}>
                    <StatusIcon className={`w-4 h-4 ${sc.color}`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-xs font-mono text-muted-foreground/60">{order.order_number}</span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${sc.bg} ${sc.color}`}>{sc.label}</span>
                      <span className={`text-[10px] font-semibold ${pc.color}`}>● {pc.label}</span>
                      <span className="text-[10px] text-muted-foreground">{SERVICE_TYPES[order.service_type]}</span>
                    </div>
                    <p className="font-semibold text-sm">{order.title}</p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      {order.customer_name && <span className="flex items-center gap-1"><User className="w-3 h-3" />{order.customer_name}</span>}
                      {order.assigned_name && <span>👷 {order.assigned_name}</span>}
                      {order.scheduled_at && (
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {format(new Date(order.scheduled_at), "d MMM HH:mm", { locale: es })}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    {order.total_cost > 0 && (
                      <p className="font-bold text-sm">${order.total_cost.toLocaleString("es-AR")}</p>
                    )}
                    {order.rating && (
                      <p className="text-xs text-amber-400">{'⭐'.repeat(order.rating)}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {formatDistanceToNow(new Date(order.updated_at), { locale: es, addSuffix: true })}
                    </p>
                  </div>

                  {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground/40 shrink-0 mt-1" />
                             : <ChevronDown className="w-4 h-4 text-muted-foreground/40 shrink-0 mt-1" />}
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-border bg-muted/20 p-4 space-y-4">
                    {/* Quick actions */}
                    <div className="flex gap-2 flex-wrap">
                      {order.status !== 'in_progress' && order.status !== 'completed' && order.status !== 'cancelled' && (
                        <Button size="sm" variant="outline" onClick={() => quickStatus(order, 'in_progress')} className="gap-1.5 text-xs">
                          <PlayCircle className="w-3.5 h-3.5 text-amber-400" /> Iniciar
                        </Button>
                      )}
                      {order.status !== 'completed' && order.status !== 'cancelled' && (
                        <Button size="sm" variant="outline" onClick={() => quickStatus(order, 'completed')} className="gap-1.5 text-xs">
                          <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> Completar
                        </Button>
                      )}
                      {order.status !== 'on_hold' && order.status !== 'completed' && order.status !== 'cancelled' && (
                        <Button size="sm" variant="outline" onClick={() => quickStatus(order, 'on_hold')} className="gap-1.5 text-xs">
                          <PauseCircle className="w-3.5 h-3.5 text-orange-400" /> Pausar
                        </Button>
                      )}
                      {isAdmin && (
                        <Button size="sm" variant="outline" onClick={() => openEdit(order)} className="gap-1.5 text-xs ml-auto">
                          <Edit2 className="w-3.5 h-3.5" /> Editar
                        </Button>
                      )}
                    </div>

                    {/* Notes */}
                    {(order.description || order.notes) && (
                      <div className="text-sm text-muted-foreground space-y-1">
                        {order.description && <p><strong className="text-foreground">Descripción:</strong> {order.description}</p>}
                        {order.notes && <p><strong className="text-foreground">Notas:</strong> {order.notes}</p>}
                      </div>
                    )}

                    {/* Items */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                          Materiales y mano de obra
                        </p>
                        <Button size="sm" variant="outline" onClick={() => setAddingItemFor(addingItemFor === order.id ? null : order.id)} className="text-xs gap-1">
                          <Plus className="w-3 h-3" /> Agregar ítem
                        </Button>
                      </div>

                      {addingItemFor === order.id && (
                        <div className="grid grid-cols-12 gap-2 mb-3 p-3 bg-card rounded-lg border border-border">
                          <div className="col-span-3">
                            <Select value={newItem.item_type} onValueChange={v => setNewItem(i => ({ ...i, item_type: v as SOItem['item_type'] }))}>
                              <SelectTrigger className="bg-muted text-xs h-8"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="part">Repuesto</SelectItem>
                                <SelectItem value="labor">Mano de obra</SelectItem>
                                <SelectItem value="material">Material</SelectItem>
                                <SelectItem value="other">Otro</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="col-span-4">
                            <Input value={newItem.description} onChange={e => setNewItem(i => ({ ...i, description: e.target.value }))} placeholder="Descripción" className="bg-muted h-8 text-xs" />
                          </div>
                          <div className="col-span-2">
                            <Input type="number" value={newItem.quantity} onChange={e => setNewItem(i => ({ ...i, quantity: e.target.value }))} placeholder="Cant." className="bg-muted h-8 text-xs" />
                          </div>
                          <div className="col-span-2">
                            <Input type="number" value={newItem.unit_price} onChange={e => setNewItem(i => ({ ...i, unit_price: e.target.value }))} placeholder="Precio" className="bg-muted h-8 text-xs" />
                          </div>
                          <div className="col-span-1">
                            <Button size="sm" className="h-8 w-full gradient-gold text-primary-foreground" onClick={() => addItem(order.id)}>
                              <Plus className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      )}

                      {(orderItems[order.id] ?? []).length === 0 ? (
                        <p className="text-xs text-muted-foreground/50 italic">Sin ítems registrados</p>
                      ) : (
                        <div className="space-y-1.5">
                          {(orderItems[order.id] ?? []).map(item => (
                            <div key={item.id} className="flex items-center gap-3 text-xs bg-card rounded-lg px-3 py-2">
                              <span className="text-muted-foreground w-16 shrink-0 capitalize">{item.item_type}</span>
                              <span className="flex-1">{item.description}</span>
                              <span className="text-muted-foreground">x{item.quantity}</span>
                              <span className="font-semibold">${item.total_price.toLocaleString("es-AR")}</span>
                              {isAdmin && (
                                <button onClick={() => deleteItem(item, order.id)} className="text-destructive/50 hover:text-destructive">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          ))}
                          <div className="flex justify-between text-sm font-bold pt-1 border-t border-border px-1">
                            <span>Total</span>
                            <span>${order.total_cost.toLocaleString("es-AR")}</span>
                          </div>
                        </div>
                      )}
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
