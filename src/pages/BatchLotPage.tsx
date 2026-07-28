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
import { Layers, Plus, AlertTriangle, Package, Pencil, ChevronDown, ChevronRight, Trash2, RefreshCw, Loader2, Clock, XCircle, DollarSign } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";

interface Product { id: string; name: string; sku: string | null; }

interface ProductBatch {
  id: string;
  product_id: string;
  lot_number: string;
  expiry_date: string | null;
  manufacture_date: string | null;
  quantity: number;
  reserved_qty: number;
  unit_cost: number | null;
  status: string;
  notes: string | null;
  created_at: string;
}

interface BatchMovement {
  id: string;
  batch_id: string;
  movement_type: string;
  quantity: number;
  notes: string | null;
  created_at: string;
}

const STATUS_BADGE: Record<string, string> = {
  active:     "bg-emerald-500/15 text-emerald-400",
  quarantine: "bg-yellow-500/15 text-yellow-400",
  expired:    "bg-destructive/15 text-destructive",
  depleted:   "bg-muted/50 text-muted-foreground",
};

const MVT_LABELS: Record<string, string> = {
  in: "Entrada", out: "Salida", adjustment: "Ajuste", transfer: "Transferencia", return: "Devolución",
};

function daysToExpiry(d: string | null) {
  if (!d) return null;
  const diff = Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
  return diff;
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}

export default function BatchLotPage() {
  usePageTitle("Lotes & Vencimientos");
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";

  const [products, setProducts] = useState<Product[]>([]);
  const [batches, setBatches] = useState<ProductBatch[]>([]);
  const [movements, setMovements] = useState<BatchMovement[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterProduct, setFilterProduct] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null);

  const [batchOpen, setBatchOpen] = useState(false);
  const [mvtOpen, setMvtOpen] = useState(false);
  const [selectedBatch, setSelectedBatch] = useState<ProductBatch | null>(null);

  const [batchForm, setBatchForm] = useState({
    product_id: "", lot_number: "", expiry_date: "", manufacture_date: "",
    quantity: "", unit_cost: "", status: "active", notes: "",
  });
  const [mvtForm, setMvtForm] = useState({
    movement_type: "in", quantity: "", notes: "",
  });

  async function loadData() {
    if (!orgId) return;
    setLoading(true);
    const [prodsRes, batchRes, mvtRes] = await Promise.all([
      supabase.from("products").select("id, name, sku").eq("org_id", orgId).order("name").limit(200),
      supabase.from("product_batches").select("*").eq("org_id", orgId).order("created_at", { ascending: false }),
      supabase.from("batch_movements").select("*").eq("org_id", orgId).order("created_at", { ascending: false }).limit(200),
    ]);
    setProducts((prodsRes.data || []) as Product[]);
    setBatches((batchRes.data || []) as ProductBatch[]);
    setMovements((mvtRes.data || []) as BatchMovement[]);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [orgId]);

  async function expireBatches() {
    const { data } = await supabase.rpc("expire_batches", { p_org_id: orgId });
    toast.success(`${data ?? 0} lotes marcados como vencidos`);
    loadData();
  }

  async function saveBatch() {
    if (!batchForm.product_id || !batchForm.lot_number.trim() || !batchForm.quantity) {
      toast.error("Producto, N° de lote y cantidad son requeridos"); return;
    }
    const payload = {
      org_id: orgId, product_id: batchForm.product_id,
      lot_number: batchForm.lot_number.trim(),
      expiry_date: batchForm.expiry_date || null,
      manufacture_date: batchForm.manufacture_date || null,
      quantity: Number(batchForm.quantity),
      unit_cost: batchForm.unit_cost ? Number(batchForm.unit_cost) : null,
      status: batchForm.status, notes: batchForm.notes || null,
    };
    const { error } = await supabase.from("product_batches").insert(payload);
    if (error) { toast.error(error.message); return; }

    // Also record a batch_movement "in"
    const { data: newBatch } = await supabase.from("product_batches")
      .select("id").eq("org_id", orgId).eq("lot_number", batchForm.lot_number.trim()).single();
    if (newBatch) {
      await supabase.from("batch_movements").insert({
        org_id: orgId, batch_id: newBatch.id,
        movement_type: "in", quantity: Number(batchForm.quantity), notes: "Ingreso inicial",
      });
    }

    toast.success("Lote creado");
    setBatchOpen(false);
    setBatchForm({ product_id: "", lot_number: "", expiry_date: "", manufacture_date: "", quantity: "", unit_cost: "", status: "active", notes: "" });
    loadData();
  }

  async function saveMvt() {
    if (!selectedBatch || !mvtForm.quantity) { toast.error("Cantidad requerida"); return; }
    const { error } = await supabase.from("batch_movements").insert({
      org_id: orgId, batch_id: selectedBatch.id,
      movement_type: mvtForm.movement_type,
      quantity: Number(mvtForm.quantity),
      notes: mvtForm.notes || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Movimiento registrado");
    setMvtOpen(false); setSelectedBatch(null);
    setMvtForm({ movement_type: "in", quantity: "", notes: "" });
    loadData();
  }

  async function quarantine(id: string) {
    await supabase.from("product_batches").update({ status: "quarantine" }).eq("id", id);
    toast.success("Lote en cuarentena");
    loadData();
  }

  const filteredBatches = batches.filter(b => {
    if (filterProduct !== "all" && b.product_id !== filterProduct) return false;
    if (filterStatus !== "all" && b.status !== filterStatus) return false;
    return true;
  });

  const kpis = useMemo(() => {
    const activeLots = batches.filter(b => b.status === "active").length;
    const expiringCnt = batches.filter(b => {
      const d = daysToExpiry(b.expiry_date);
      return b.status === "active" && d !== null && d <= 30 && d >= 0;
    }).length;
    const expiredCnt = batches.filter(b => b.status === "expired").length;
    const totalVal = batches.filter(b => b.status === "active").reduce((s, b) => s + (b.quantity * (b.unit_cost || 0)), 0);
    return { activeLots, expiringCnt, expiredCnt, totalVal };
  }, [batches]);

  const expiringCount = kpis.expiringCnt;
  const expiredCount = kpis.expiredCnt;
  const totalValue = kpis.totalVal;

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Layers}
        title="Lotes & Vencimientos"
        description="Trazabilidad completa por lote: fechas de vencimiento, movimientos y cuarentenas."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={expireBatches}>
              <RefreshCw className="w-4 h-4 mr-1" /> Verificar vencidos
            </Button>
            <Button onClick={() => setBatchOpen(true)}>
              <Plus className="w-4 h-4 mr-1" /> Nuevo lote
            </Button>
          </div>
        }
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="Lotes activos" value={kpis.activeLots} icon={Layers} color="primary" />
        <KPICard label="Por vencer (30 días)" value={kpis.expiringCnt} icon={Clock} color={kpis.expiringCnt > 0 ? "warning" : "success"} />
        <KPICard label="Vencidos" value={kpis.expiredCnt} icon={XCircle} color={kpis.expiredCnt > 0 ? "destructive" : "success"} />
        <KPICard
          label="Valor en stock"
          icon={DollarSign}
          value={new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0 }).format(kpis.totalVal)}
          color="blue"
        />
      </div>

      {/* Alert banners */}
      {expiringCount > 0 && (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/8 p-3 flex items-center gap-3 text-yellow-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span><strong>{expiringCount} lote(s)</strong> vencen en los próximos 30 días. Revisalos pronto.</span>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Select value={filterProduct} onValueChange={setFilterProduct}>
          <SelectTrigger className="w-52"><SelectValue placeholder="Todos los productos" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los productos</SelectItem>
            {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Todos los estados" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="active">Activo</SelectItem>
            <SelectItem value="quarantine">Cuarentena</SelectItem>
            <SelectItem value="expired">Vencido</SelectItem>
            <SelectItem value="depleted">Agotado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Batch list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
        </div>
      ) : filteredBatches.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Sin lotes registrados.</p>
        </div>
      ) : (
        <div className="space-y-2 pb-12">
          {filteredBatches.map(batch => {
            const prod = products.find(p => p.id === batch.product_id);
            const days = daysToExpiry(batch.expiry_date);
            const batchMvts = movements.filter(m => m.batch_id === batch.id);
            const isExpanded = expandedBatch === batch.id;
            return (
              <div key={batch.id} className="rounded-xl border border-border/50 bg-card overflow-hidden">
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/20"
                  onClick={() => setExpandedBatch(isExpanded ? null : batch.id)}
                >
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{batch.lot_number}</span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_BADGE[batch.status]}`}>
                        {batch.status.charAt(0).toUpperCase() + batch.status.slice(1)}
                      </span>
                      {days !== null && days <= 30 && batch.status === "active" && (
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${days <= 0 ? "bg-destructive/15 text-destructive" : "bg-yellow-500/15 text-yellow-400"}`}>
                          {days <= 0 ? "VENCIDO" : `Vence en ${days}d`}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{prod?.name || "Producto desvinculado"}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-semibold text-sm">{batch.quantity} u.</p>
                    <p className="text-xs text-muted-foreground">Vto: {fmtDate(batch.expiry_date)}</p>
                  </div>
                  <div className="flex gap-1 shrink-0 ml-1" onClick={e => e.stopPropagation()}>
                    <Button size="sm" variant="outline" className="h-7 text-xs"
                      onClick={() => { setSelectedBatch(batch); setMvtOpen(true); }}>
                      Movimiento
                    </Button>
                    {batch.status === "active" && (
                      <Button size="sm" variant="outline" className="h-7 text-xs text-yellow-400 border-yellow-500/30"
                        onClick={() => quarantine(batch.id)}>
                        Cuarentena
                      </Button>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-border/30 px-4 py-3 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div><span className="text-muted-foreground">Cantidad disponible</span><p className="font-semibold mt-0.5">{batch.quantity - batch.reserved_qty} u.</p></div>
                      <div><span className="text-muted-foreground">Reservado</span><p className="font-semibold mt-0.5">{batch.reserved_qty} u.</p></div>
                      <div><span className="text-muted-foreground">Costo unitario</span><p className="font-semibold mt-0.5">{batch.unit_cost ? `$${batch.unit_cost}` : "—"}</p></div>
                      <div><span className="text-muted-foreground">Fabricación</span><p className="font-semibold mt-0.5">{fmtDate(batch.manufacture_date)}</p></div>
                    </div>
                    {batch.notes && <p className="text-xs text-muted-foreground italic">{batch.notes}</p>}
                    {batchMvts.length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1.5">Historial de movimientos</p>
                        <div className="space-y-1 pb-12">
                          {batchMvts.slice(0, 8).map(m => (
                            <div key={m.id} className="flex items-center gap-3 text-xs">
                              <span className={`font-medium ${m.movement_type === "in" || m.movement_type === "return" ? "text-emerald-400" : "text-destructive"}`}>
                                {m.movement_type === "in" || m.movement_type === "return" ? "+" : "-"}{m.quantity}
                              </span>
                              <span className="text-muted-foreground">{MVT_LABELS[m.movement_type]}</span>
                              {m.notes && <span className="text-muted-foreground/60">· {m.notes}</span>}
                              <span className="ml-auto text-muted-foreground/50">
                                {new Date(m.created_at).toLocaleDateString("es-AR")}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* New batch dialog */}
      <Dialog open={batchOpen} onOpenChange={setBatchOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nuevo lote</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Producto *</Label>
              <Select value={batchForm.product_id} onValueChange={v => setBatchForm(p => ({ ...p, product_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Seleccioná producto..." /></SelectTrigger>
                <SelectContent>
                  {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>N° de lote *</Label>
                <Input value={batchForm.lot_number} onChange={e => setBatchForm(p => ({ ...p, lot_number: e.target.value }))} placeholder="LOT-2026-001" />
              </div>
              <div><Label>Estado</Label>
                <Select value={batchForm.status} onValueChange={v => setBatchForm(p => ({ ...p, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Activo</SelectItem>
                    <SelectItem value="quarantine">Cuarentena</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Fecha de vencimiento</Label>
                <Input type="date" value={batchForm.expiry_date} onChange={e => setBatchForm(p => ({ ...p, expiry_date: e.target.value }))} />
              </div>
              <div><Label>Fecha de fabricación</Label>
                <Input type="date" value={batchForm.manufacture_date} onChange={e => setBatchForm(p => ({ ...p, manufacture_date: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Cantidad *</Label>
                <Input type="number" min="0" step="0.001" value={batchForm.quantity}
                  onChange={e => setBatchForm(p => ({ ...p, quantity: e.target.value }))} />
              </div>
              <div><Label>Costo unitario</Label>
                <Input type="number" min="0" step="0.01" value={batchForm.unit_cost}
                  onChange={e => setBatchForm(p => ({ ...p, unit_cost: e.target.value }))} placeholder="$0.00" />
              </div>
            </div>
            <div><Label>Notas</Label>
              <Input value={batchForm.notes} onChange={e => setBatchForm(p => ({ ...p, notes: e.target.value }))} placeholder="Proveedor, observaciones..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBatchOpen(false)}>Cancelar</Button>
            <Button onClick={saveBatch}>Crear lote</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Movement dialog */}
      <Dialog open={mvtOpen} onOpenChange={v => { setMvtOpen(v); if (!v) setSelectedBatch(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Movimiento — Lote {selectedBatch?.lot_number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Tipo</Label>
                <Select value={mvtForm.movement_type} onValueChange={v => setMvtForm(p => ({ ...p, movement_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(MVT_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Cantidad *</Label>
                <Input type="number" min="0.001" step="0.001" value={mvtForm.quantity}
                  onChange={e => setMvtForm(p => ({ ...p, quantity: e.target.value }))} autoFocus />
              </div>
            </div>
            <div><Label>Notas</Label>
              <Input value={mvtForm.notes} onChange={e => setMvtForm(p => ({ ...p, notes: e.target.value }))} placeholder="Motivo, referencia..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMvtOpen(false)}>Cancelar</Button>
            <Button onClick={saveMvt}>Registrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
