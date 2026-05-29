import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { useUserRole } from "@/lib/useUserRole";
import { toast } from "sonner";
import {
  ArrowRightLeft, Plus, X, Save, Search, Trash2, Edit2,
  CheckCircle, Clock, Truck, XCircle, RefreshCw, Package,
  ChevronDown, ChevronUp, MapPin, FileText, AlertTriangle, Loader2
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

// ── Types ─────────────────────────────────────────────────────────────────────
type TransferStatus = 'draft' | 'pending' | 'in_transit' | 'completed' | 'cancelled';

interface Transfer {
  id: string;
  transfer_number: string;
  status: TransferStatus;
  from_location: string;
  to_location: string;
  reason: string | null;
  notes: string | null;
  approved_by: string | null;
  sent_at: string | null;
  received_at: string | null;
  created_by: string | null;
  created_at: string;
  items?: TransferItem[];
}

interface TransferItem {
  id: string;
  product_id: string;
  product_name: string;
  quantity_sent: number;
  quantity_received: number;
  unit_cost: number;
  notes: string | null;
}

interface Product {
  id: string;
  name: string;
  stock: number;
  sale_price_ars: number;
}

// ── Config ─────────────────────────────────────────────────────────────────────
const STATUS_CFG: Record<TransferStatus, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  draft:      { label: 'Borrador',     color: 'text-slate-400',   bg: 'bg-slate-500/10 border-slate-500/20',   icon: FileText },
  pending:    { label: 'Pendiente',    color: 'text-amber-400',   bg: 'bg-amber-500/10 border-amber-500/20',   icon: Clock },
  in_transit: { label: 'En tránsito',  color: 'text-blue-400',    bg: 'bg-blue-500/10 border-blue-500/20',     icon: Truck },
  completed:  { label: 'Completada',   color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20',icon: CheckCircle },
  cancelled:  { label: 'Cancelada',    color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/20',        icon: XCircle },
};

const TRANSFER_REASONS = [
  'Reposición de stock', 'Pedido de sucursal', 'Balance de inventario',
  'Producto dañado en origen', 'Devolución a depósito central', 'Evento especial', 'Otro',
];

const emptyForm = () => ({
  from_location: '', to_location: '', reason: '', notes: '', created_by: '',
});

// ── Component ─────────────────────────────────────────────────────────────────
export default function InventoryTransfersPage() {
  usePageTitle("Transferencias de Inventario");
  const { activeOrg } = useOrg();
  const { isAdmin } = useUserRole();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | TransferStatus>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  // Item adding
  const [pendingTransferId, setPendingTransferId] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [itemQty, setItemQty] = useState('1');
  const [itemNotes, setItemNotes] = useState('');

  const load = async () => {
    if (!activeOrg?.id) return;
    setLoading(true);
    try {
      const [transfersRes, productsRes, locationsRes] = await Promise.all([
        supabase.from("inventory_transfers").select(`
          *, inventory_transfer_items(*)
        `).eq("org_id", activeOrg.id).order("created_at", { ascending: false }),
        supabase.from("products").select("id, name, stock, sale_price_ars").eq("org_id", activeOrg.id).order("name"),
        supabase.from("locations").select("name").eq("org_id", activeOrg.id).order("name"),
      ]);
      if (transfersRes.data) {
        setTransfers(transfersRes.data.map((t: any) => ({
          ...t,
          items: t.inventory_transfer_items ?? [],
        })));
      }
      if (productsRes.data) setProducts(productsRes.data);
      if (locationsRes.data) setLocations(locationsRes.data.map((l: any) => l.name));
    } catch (e: any) {
      toast.error("Error: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeOrg?.id]);

  const handleCreate = async () => {
    if (!form.from_location.trim() || !form.to_location.trim()) {
      toast.error("Origen y destino son obligatorios"); return;
    }
    if (form.from_location === form.to_location) {
      toast.error("Origen y destino no pueden ser iguales"); return;
    }
    if (!activeOrg?.id) return;
    setSaving(true);
    try {
      const number = `TRF-${format(new Date(), 'yyyyMMdd')}-${String(transfers.length + 1).padStart(4, '0')}`;
      const { data, error } = await supabase.from("inventory_transfers").insert({
        org_id: activeOrg.id,
        transfer_number: number,
        from_location: form.from_location.trim(),
        to_location: form.to_location.trim(),
        reason: form.reason || null,
        notes: form.notes.trim() || null,
        created_by: form.created_by.trim() || null,
      }).select().single();
      if (error) throw error;
      toast.success("Transferencia creada");
      setShowForm(false);
      setForm(emptyForm());
      setPendingTransferId(data.id);
      setExpandedId(data.id);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const addItem = async (transferId: string) => {
    if (!selectedProduct) { toast.error("Seleccioná un producto"); return; }
    const qty = parseInt(itemQty) || 1;
    if (qty > selectedProduct.stock) {
      toast.error(`Stock insuficiente. Disponible: ${selectedProduct.stock}`);
      return;
    }
    if (!activeOrg?.id) return;
    const { error } = await supabase.from("inventory_transfer_items").insert({
      transfer_id: transferId,
      org_id: activeOrg.id,
      product_id: selectedProduct.id,
      product_name: selectedProduct.name,
      quantity_sent: qty,
      quantity_received: 0,
      unit_cost: selectedProduct.sale_price_ars,
      notes: itemNotes.trim() || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`${selectedProduct.name} × ${qty} agregado`);
    setSelectedProduct(null); setProductSearch(''); setItemQty('1'); setItemNotes('');
    load();
  };

  const advanceStatus = async (t: Transfer) => {
    const next: Record<TransferStatus, TransferStatus | null> = {
      draft: 'pending', pending: 'in_transit', in_transit: 'completed', completed: null, cancelled: null,
    };
    const nextStatus = next[t.status];
    if (!nextStatus) return;
    const updates: any = { status: nextStatus };
    if (nextStatus === 'in_transit') updates.sent_at = new Date().toISOString();
    if (nextStatus === 'completed') updates.received_at = new Date().toISOString();
    await supabase.from("inventory_transfers").update(updates).eq("id", t.id);
    load();
    toast.success(`Estado → ${STATUS_CFG[nextStatus].label}`);
  };

  const cancelTransfer = async (id: string) => {
    if (!confirm("¿Cancelar esta transferencia?")) return;
    await supabase.from("inventory_transfers").update({ status: 'cancelled' }).eq("id", id);
    load();
    toast.success("Transferencia cancelada");
  };

  const filteredProducts = useMemo(() =>
    products.filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase())).slice(0, 8),
    [products, productSearch]
  );

  const filtered = useMemo(() => {
    return transfers.filter(t => {
      const matchSearch = !search
        || t.transfer_number.toLowerCase().includes(search.toLowerCase())
        || t.from_location.toLowerCase().includes(search.toLowerCase())
        || t.to_location.toLowerCase().includes(search.toLowerCase());
      const matchStatus = filterStatus === 'all' || t.status === filterStatus;
      return matchSearch && matchStatus;
    });
  }, [transfers, search, filterStatus]);

  // KPIs
  const kpis = useMemo(() => {
    const open = transfers.filter(t => !['completed', 'cancelled'].includes(t.status)).length;
    const inTransit = transfers.filter(t => t.status === 'in_transit').length;
    const done = transfers.filter(t => t.status === 'completed').length;
    const totalItems = transfers.filter(t => t.status === 'completed')
      .reduce((s, t) => s + (t.items?.reduce((si, i) => si + i.quantity_sent, 0) ?? 0), 0);
    return { open, inTransit, done, totalItems };
  }, [transfers]);

  const nextStatusLabel: Record<TransferStatus, string | null> = {
    draft: 'Enviar a aprobación',
    pending: 'Marcar en tránsito',
    in_transit: 'Confirmar recepción',
    completed: null,
    cancelled: null,
  };

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={ArrowRightLeft}
        title="Transferencias de Inventario"
        description="Mover stock entre sucursales y depósitos · trazabilidad completa"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            {isAdmin && (
              <Button className="gradient-gold text-primary-foreground gap-2" onClick={() => setShowForm(true)}>
                <Plus className="w-4 h-4" /> Nueva transferencia
              </Button>
            )}
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPICard label="Abiertas" value={kpis.open} icon={Clock} color="warning" sub="En proceso" />
        <KPICard label="En tránsito" value={kpis.inTransit} icon={Truck} color="blue" sub="En camino" />
        <KPICard label="Completadas" value={kpis.done} icon={CheckCircle} color="success" sub="Finalizadas" />
        <KPICard label="Unidades movidas" value={kpis.totalItems} icon={Package} color="primary" sub="En transferencias completadas" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground/50" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por número, sucursal..." className="pl-8 bg-muted" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {(['all', ...Object.keys(STATUS_CFG)] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                filterStatus === s ? 'bg-primary/15 text-primary border-primary/30' : 'border-border text-muted-foreground hover:bg-muted/50'
              }`}
            >
              {s === 'all' ? 'Todas' : STATUS_CFG[s as TransferStatus].label}
            </button>
          ))}
        </div>
      </div>

      {/* Create form dialog */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-card border border-border/60 rounded-xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="font-display font-bold">Nueva transferencia</h2>
              <button onClick={() => setShowForm(false)}><X className="w-4 h-4 text-muted-foreground" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><MapPin className="w-3 h-3" />Origen *</label>
                {locations.length > 0 ? (
                  <Select value={form.from_location} onValueChange={v => setForm(f => ({ ...f, from_location: v }))}>
                    <SelectTrigger className="bg-muted"><SelectValue placeholder="Seleccioná sucursal de origen" /></SelectTrigger>
                    <SelectContent>{locations.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                ) : (
                  <Input value={form.from_location} onChange={e => setForm(f => ({ ...f, from_location: e.target.value }))} className="bg-muted" placeholder="Ej: Depósito Central, Sucursal Norte..." autoFocus />
                )}
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><MapPin className="w-3 h-3" />Destino *</label>
                {locations.length > 0 ? (
                  <Select value={form.to_location} onValueChange={v => setForm(f => ({ ...f, to_location: v }))}>
                    <SelectTrigger className="bg-muted"><SelectValue placeholder="Seleccioná sucursal de destino" /></SelectTrigger>
                    <SelectContent>{locations.map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                ) : (
                  <Input value={form.to_location} onChange={e => setForm(f => ({ ...f, to_location: e.target.value }))} className="bg-muted" placeholder="Ej: Sucursal Sur, Punto de Venta 2..." />
                )}
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Motivo</label>
                <Select value={form.reason} onValueChange={v => setForm(f => ({ ...f, reason: v }))}>
                  <SelectTrigger className="bg-muted"><SelectValue placeholder="Seleccioná motivo..." /></SelectTrigger>
                  <SelectContent>{TRANSFER_REASONS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Notas</label>
                <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="bg-muted resize-none" rows={2} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Creado por</label>
                <Input value={form.created_by} onChange={e => setForm(f => ({ ...f, created_by: e.target.value }))} className="bg-muted" placeholder="Nombre del responsable" />
              </div>
            </div>
            <div className="flex gap-2 px-5 pb-5">
              <Button variant="outline" className="flex-1" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button className="flex-1 gradient-gold text-primary-foreground gap-1.5" onClick={handleCreate} disabled={saving}>
                {saving ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                Crear y agregar productos
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No hay transferencias registradas.</p>
        </div>
      ) : (
        <div className="space-y-2 pb-12">
          {filtered.map(transfer => {
            const sc = STATUS_CFG[transfer.status];
            const StatusIcon = sc.icon;
            const isExpanded = expandedId === transfer.id;
            const nextLabel = nextStatusLabel[transfer.status];
            const totalItems = (transfer.items ?? []).reduce((s, i) => s + i.quantity_sent, 0);

            return (
              <div key={transfer.id} className="bg-card border border-border rounded-xl overflow-hidden">
                <button
                  className="w-full text-left p-4 flex items-start gap-3"
                  onClick={() => setExpandedId(isExpanded ? null : transfer.id)}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${sc.bg}`}>
                    <StatusIcon className={`w-4 h-4 ${sc.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-mono text-muted-foreground/60">{transfer.transfer_number}</span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${sc.bg} ${sc.color}`}>{sc.label}</span>
                    </div>
                    <p className="font-semibold text-sm flex items-center gap-2">
                      <span className="text-muted-foreground">{transfer.from_location}</span>
                      <ArrowRightLeft className="w-3.5 h-3.5 text-teal-400 shrink-0" />
                      <span>{transfer.to_location}</span>
                    </p>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      <span>{totalItems} unidades · {(transfer.items ?? []).length} productos</span>
                      {transfer.reason && <span>{transfer.reason}</span>}
                      {transfer.created_by && <span>por {transfer.created_by}</span>}
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground shrink-0">
                    {formatDistanceToNow(new Date(transfer.created_at), { locale: es, addSuffix: true })}
                  </div>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground/40 shrink-0 mt-1" />
                             : <ChevronDown className="w-4 h-4 text-muted-foreground/40 shrink-0 mt-1" />}
                </button>

                {isExpanded && (
                  <div className="border-t border-border bg-muted/20 p-4 space-y-4">
                    {/* Actions */}
                    <div className="flex gap-2 flex-wrap">
                      {nextLabel && (
                        <Button size="sm" className="gradient-gold text-primary-foreground text-xs gap-1.5" onClick={() => advanceStatus(transfer)}>
                          <CheckCircle className="w-3.5 h-3.5" /> {nextLabel}
                        </Button>
                      )}
                      {!['completed', 'cancelled'].includes(transfer.status) && (
                        <Button size="sm" variant="outline" onClick={() => cancelTransfer(transfer.id)} className="gap-1.5 text-xs text-destructive/70 hover:text-destructive">
                          <XCircle className="w-3.5 h-3.5" /> Cancelar
                        </Button>
                      )}
                    </div>

                    {/* Dates */}
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      {transfer.sent_at && (
                        <div><p className="text-muted-foreground">Enviado</p>
                          <p className="font-medium">{format(new Date(transfer.sent_at), "d MMM yyyy HH:mm", { locale: es })}</p></div>
                      )}
                      {transfer.received_at && (
                        <div><p className="text-muted-foreground">Recibido</p>
                          <p className="font-medium">{format(new Date(transfer.received_at), "d MMM yyyy HH:mm", { locale: es })}</p></div>
                      )}
                    </div>

                    {/* Items */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Productos</p>
                        {!['completed', 'cancelled'].includes(transfer.status) && isAdmin && (
                          <Button size="sm" variant="outline" onClick={() => {
                            setPendingTransferId(pendingTransferId === transfer.id ? null : transfer.id);
                          }} className="text-xs gap-1">
                            <Plus className="w-3 h-3" /> Agregar
                          </Button>
                        )}
                      </div>

                      {/* Add product form */}
                      {pendingTransferId === transfer.id && (
                        <div className="mb-3 p-3 bg-card rounded-lg border border-border space-y-2">
                          <div className="relative">
                            <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground/50" />
                            <Input
                              value={productSearch}
                              onChange={e => { setProductSearch(e.target.value); setSelectedProduct(null); }}
                              placeholder="Buscar producto..."
                              className="pl-8 bg-muted text-xs h-8"
                            />
                          </div>
                          {productSearch && !selectedProduct && (
                            <div className="bg-card border border-border rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                              {filteredProducts.map(p => (
                                <button
                                  key={p.id}
                                  onClick={() => { setSelectedProduct(p); setProductSearch(p.name); }}
                                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 text-left"
                                >
                                  <span className="flex-1 text-xs">{p.name}</span>
                                  <span className={`text-xs ${p.stock <= 0 ? 'text-red-400' : 'text-muted-foreground'}`}>
                                    Stock: {p.stock}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}
                          {selectedProduct && (
                            <div className="space-y-2 pb-12">
                              <p className="text-xs text-emerald-400">✓ {selectedProduct.name} (Stock: {selectedProduct.stock})</p>
                              {selectedProduct.stock <= 0 && (
                                <p className="text-xs text-red-400 flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3" /> Sin stock disponible
                                </p>
                              )}
                              <div className="flex gap-2">
                                <Input
                                  type="number" min="1" max={selectedProduct.stock}
                                  value={itemQty}
                                  onChange={e => setItemQty(e.target.value)}
                                  placeholder="Cantidad"
                                  className="flex-1 bg-muted text-xs h-8"
                                />
                                <Input
                                  value={itemNotes}
                                  onChange={e => setItemNotes(e.target.value)}
                                  placeholder="Notas (opcional)"
                                  className="flex-1 bg-muted text-xs h-8"
                                />
                                <Button size="sm" className="h-8 gradient-gold text-primary-foreground text-xs" onClick={() => addItem(transfer.id)}>
                                  Agregar
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {(transfer.items ?? []).length === 0 ? (
                        <p className="text-xs text-muted-foreground/50 italic">Sin productos. Agregá ítems a transferir.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {(transfer.items ?? []).map(item => (
                            <div key={item.id} className="flex items-center gap-3 bg-card rounded-lg px-3 py-2 text-sm">
                              <Package className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                              <span className="flex-1">{item.product_name}</span>
                              <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                                <span>Enviado: <strong className="text-foreground">{item.quantity_sent}</strong></span>
                                {item.quantity_received > 0 && (
                                  <span className="text-emerald-400">Recibido: {item.quantity_received}</span>
                                )}
                              </div>
                            </div>
                          ))}
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
