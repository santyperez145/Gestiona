import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import KPICard from "@/components/shared/KPICard";
import {
  RotateCcw, Plus, CheckCircle2, XCircle, Clock, Package,
  Pencil, Trash2, RefreshCcw, DollarSign, AlertCircle, Search, Loader2, Truck
} from "lucide-react";
import { toast } from "sonner";
import { orgViewKey, usePersistedState } from "@/hooks/usePersistedState";

/* ─────────────────────────── types ─────────────────────────── */
interface ReturnReason { id: string; name: string; requires_photo: boolean; is_active: boolean; }
interface ReturnRequest {
  id: string; rma_number: string; customer_name: string; customer_email: string | null;
  ecommerce_order_id: string | null;
  product_name: string; quantity: number; condition: string; resolution: string | null;
  refund_amount: number | null; refund_method: string | null; status: string;
  reason_text: string | null; created_at: string; resolved_at: string | null;
  tipo: string; return_shipping_payer: string; return_shipping_amount: number | null;
  return_shipping_method: string | null;
  return_reasons: { name: string } | null;
  customers: { name: string } | null;
}
interface OurProduct { id: string; name: string; }
interface RefundStatus { return_request_id: string; status: string; failure_reason: string | null; }

/* ─────────────────────────── configs ─────────────────────────── */
const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending:    { label: "Pendiente",    color: "bg-yellow-500/15 text-yellow-400", icon: <Clock className="w-3 h-3" /> },
  approved:   { label: "Aprobado",     color: "bg-blue-500/15 text-blue-400",    icon: <CheckCircle2 className="w-3 h-3" /> },
  rejected:   { label: "Rechazado",    color: "bg-red-500/15 text-red-400",      icon: <XCircle className="w-3 h-3" /> },
  processing: { label: "En proceso",   color: "bg-purple-500/15 text-purple-400", icon: <RefreshCcw className="w-3 h-3" /> },
  resolved:   { label: "Resuelto",     color: "bg-green-500/15 text-green-400",  icon: <CheckCircle2 className="w-3 h-3" /> },
  closed:     { label: "Cerrado",      color: "bg-muted/50 text-muted-foreground", icon: <XCircle className="w-3 h-3" /> },
};
const RESOLUTION_LABELS: Record<string, string> = {
  refund: "Reembolso", exchange: "Cambio de producto", store_credit: "Crédito en tienda",
  repair: "Reparación", rejection: "Rechazo",
};
const CONDITION_LABELS: Record<string, string> = {
  new: "Nuevo", good: "Bueno", damaged: "Dañado", defective: "Defectuoso", unknown: "Desconocido",
};
const REFUND_METHOD_LABELS: Record<string, string> = {
  original_payment: "Medio original", cash: "Efectivo", bank_transfer: "Transferencia",
  store_credit: "Crédito", gift_card: "Gift Card",
};
const RETURN_SHIPPING_METHOD_LABELS: Record<string, string> = {
  prepaid_label: "Etiqueta prepaga", reimbursement: "Reintegro", pickup: "Retiro coordinado",
};

const TABS = ["Solicitudes", "Razones", "Estadísticas"] as const;
type Tab = typeof TABS[number];

export default function ReturnsPortalTab() {
  const { orgId } = useOrganization();
  const [activeTab, setActiveTab] = usePersistedState<Tab>(
    orgViewKey("returns.tab", orgId),
    "Solicitudes",
  );
  const [returns, setReturns] = useState<ReturnRequest[]>([]);
  const [refunds, setRefunds] = useState<Record<string, RefundStatus>>({});
  const [reasons, setReasons] = useState<ReturnReason[]>([]);
  const [products, setProducts] = useState<OurProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  /* dialogs */
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showApproveDialog, setShowApproveDialog] = useState<ReturnRequest | null>(null);
  const [showRejectDialog, setShowRejectDialog] = useState<ReturnRequest | null>(null);
  const [showReasonDialog, setShowReasonDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [executingRefundId, setExecutingRefundId] = useState<string | null>(null);

  /* forms */
  const blankForm = { customer_name: "", customer_email: "", product_name: "", product_id: "", quantity: "1", reason_id: "", reason_text: "", condition: "unknown", notes: "" };
  const [form, setForm] = useState(blankForm);
  const [approveForm, setApproveForm] = useState({ resolution: "refund", resolution_notes: "", refund_amount: "", refund_method: "original_payment", return_shipping_amount: "", return_shipping_method: "prepaid_label" });
  const [reasonForm, setReasonForm] = useState({ name: "", requires_photo: false });

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [rr, reaR, pr, fr] = await Promise.allSettled([
      supabase.from("return_requests").select("*, return_reasons(name), customers(name)").eq("org_id", orgId).order("created_at", { ascending: false }),
      supabase.from("return_reasons").select("*").eq("org_id", orgId).order("sort_order"),
      supabase.from("products").select("id,name").eq("org_id", orgId).order("name"),
      supabase.from("payment_refunds").select("return_request_id,status,failure_reason").eq("org_id", orgId),
    ]);
    if (rr.status === "fulfilled" && rr.value.data) setReturns(rr.value.data as ReturnRequest[]);
    if (reaR.status === "fulfilled" && reaR.value.data) setReasons(reaR.value.data as ReturnReason[]);
    if (pr.status === "fulfilled" && pr.value.data) setProducts(pr.value.data as OurProduct[]);
    if (fr.status === "fulfilled" && fr.value.data) {
      setRefunds(Object.fromEntries((fr.value.data as RefundStatus[]).map(refund => [refund.return_request_id, refund])));
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  async function seedReasons() {
    if (!orgId) return;
    await supabase.rpc("seed_return_reasons", { p_org_id: orgId });
    toast.success("Razones cargadas");
    load();
  }

  async function createReturn() {
    if (!orgId || !form.customer_name.trim() || !form.product_name.trim()) return;
    const { error } = await supabase.from("return_requests").insert({
      org_id: orgId, rma_number: "", customer_name: form.customer_name,
      customer_email: form.customer_email || null,
      product_name: form.product_name, product_id: form.product_id || null,
      quantity: parseInt(form.quantity) || 1, reason_id: form.reason_id || null,
      reason_text: form.reason_text || null, condition: form.condition, notes: form.notes || null, status: "pending",
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Solicitud creada");
    setShowNewDialog(false);
    load();
  }

  async function approveReturn() {
    if (!showApproveDialog) return;
    const { error } = await supabase.from("return_requests").update({
      status: "approved", resolution: approveForm.resolution,
      resolution_notes: approveForm.resolution_notes || null,
      refund_amount: approveForm.refund_amount ? parseFloat(approveForm.refund_amount) : null,
      refund_method: approveForm.refund_method,
      ...(showApproveDialog.tipo === "arrepentimiento" ? {
        return_shipping_payer: "seller",
        return_shipping_amount: approveForm.return_shipping_amount ? parseFloat(approveForm.return_shipping_amount) : null,
        return_shipping_method: approveForm.return_shipping_method,
      } : {}),
      approved_at: new Date().toISOString(),
    }).eq("id", showApproveDialog.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Solicitud aprobada");
    setShowApproveDialog(null);
    load();
  }

  async function rejectReturn() {
    if (!showRejectDialog || !rejectReason.trim()) { toast.error("Ingresá el motivo"); return; }
    await supabase.from("return_requests").update({ status: "rejected", rejected_reason: rejectReason }).eq("id", showRejectDialog.id);
    toast.success("Solicitud rechazada");
    setShowRejectDialog(null);
    setRejectReason("");
    load();
  }

  async function resolveReturn(id: string) {
    await supabase.from("return_requests").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", id);
    toast.success("Marcado como resuelto");
    load();
  }

  async function executeRefund(request: ReturnRequest) {
    if (!orgId || executingRefundId) return;
    setExecutingRefundId(request.id);
    const { data, error } = await supabase.functions.invoke("refund-store-payment", {
      body: { orgId, returnRequestId: request.id },
    });
    setExecutingRefundId(null);

    if (error) {
      toast.error(error.message || "No se pudo ejecutar el reintegro");
      load();
      return;
    }
    if (data?.status === "processing") {
      toast.info("El reintegro quedó en verificación y conserva la misma clave de idempotencia");
    } else {
      toast.success("Reintegro confirmado en MercadoPago");
    }
    load();
  }

  const filtered = returns.filter(r => {
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    if (search && !r.rma_number.toLowerCase().includes(search.toLowerCase()) && !r.customer_name.toLowerCase().includes(search.toLowerCase()) && !r.product_name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const pendingCount = returns.filter(r => r.status === "pending").length;
  const resolvedCount = returns.filter(r => r.status === "resolved").length;
  const totalRefunds = returns.filter(r => r.resolution === "refund" && r.refund_amount).reduce((s, r) => s + (r.refund_amount ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><RotateCcw className="w-4 h-4 text-primary" />Portal de Devoluciones RMA</h2>
          <p className="text-xs text-muted-foreground">Solicitudes de devolución, cambio y reembolso</p>
        </div>
        <Button size="sm" onClick={() => { setForm(blankForm); setShowNewDialog(true); }}>
          <Plus className="w-4 h-4 mr-1" /> Nueva Solicitud
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Total solicitudes" value={returns.length} icon={Package} color="primary" />
        <KPICard label="Pendientes" value={pendingCount} icon={Clock} color="warning" />
        <KPICard label="Resueltas" value={resolvedCount} icon={CheckCircle2} color="success" />
        <KPICard label="Total reembolsado" value={`$${totalRefunds.toLocaleString("es-AR")}`} icon={DollarSign} color="destructive" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/30 rounded-lg p-1 w-fit border border-border/40">
        {TABS.map(t => <button key={t} onClick={() => setActiveTab(t)} className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === t ? "bg-card border border-border/60 text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{t}</button>)}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
        </div>
      ) : (
        <>
          {activeTab === "Solicitudes" && (
            <div className="space-y-4">
              <div className="flex gap-3 flex-wrap">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/50" />
                  <Input placeholder="Buscar RMA, cliente, producto…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 w-64" />
                </div>
                {(["all", ...Object.keys(STATUS_CONFIG)] as const).map(s => (
                  <button key={s} onClick={() => setFilterStatus(s)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${filterStatus === s ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted/50"}`}>
                    {s === "all" ? "Todos" : STATUS_CONFIG[s]?.label}
                  </button>
                ))}
              </div>

              <div className="bg-card rounded-xl border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/20 text-muted-foreground">
                    <tr>{["RMA", "Cliente", "Producto", "Cant.", "Razón", "Resolución", "Reembolso", "Vuelta", "Estado", ""].map(h => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y">
                    {filtered.map(r => {
                      const st = STATUS_CONFIG[r.status] ?? STATUS_CONFIG.pending;
                      const refund = refunds[r.id];
                      const needsProviderRefund = r.status === "approved"
                        && r.resolution === "refund"
                        && r.refund_method === "original_payment"
                        && !!r.ecommerce_order_id;
                      const refundBusy = executingRefundId === r.id || refund?.status === "processing";
                      return (
                        <tr key={r.id} className="hover:bg-muted/20">
                          <td className="px-4 py-3 font-mono text-xs text-primary">{r.rma_number}</td>
                          <td className="px-4 py-3 font-medium text-foreground">{r.customer_name}<br/><span className="text-xs text-muted-foreground">{r.customer_email}</span></td>
                          <td className="px-4 py-3 text-muted-foreground">{r.product_name}</td>
                          <td className="px-4 py-3 text-muted-foreground">{r.quantity}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground">{(r.return_reasons as ReturnRequest["return_reasons"])?.name ?? r.reason_text ?? "—"}</td>
                          <td className="px-4 py-3 text-xs">{r.resolution ? RESOLUTION_LABELS[r.resolution] : "—"}</td>
                          <td className="px-4 py-3 text-xs">{r.refund_amount ? `$${r.refund_amount.toLocaleString("es-AR")}` : "—"}</td>
                          <td className="px-4 py-3 text-xs">
                            {r.tipo === "arrepentimiento" && r.return_shipping_payer === "seller" ? (
                              <span className="inline-flex items-center gap-1 text-emerald-600"><Truck className="w-3 h-3" /> Comercio{r.return_shipping_amount != null ? ` · $${r.return_shipping_amount.toLocaleString("es-AR")}` : ""}</span>
                            ) : "—"}
                          </td>
                          <td className="px-4 py-3"><Badge className={`${st.color} flex items-center gap-1 text-xs`}>{st.icon}{st.label}</Badge></td>
                          <td className="px-4 py-3">
                            <div className="flex gap-1">
                              {r.status === "pending" && (
                                <>
                                  <Button size="sm" variant="outline" className="text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 text-xs" onClick={() => { setShowApproveDialog(r); setApproveForm({ resolution: "refund", resolution_notes: "", refund_amount: "", refund_method: "original_payment", return_shipping_amount: r.return_shipping_amount?.toString() ?? "", return_shipping_method: r.return_shipping_method ?? "prepaid_label" }); }}>Aprobar</Button>
                                  <Button size="sm" variant="outline" className="text-red-400 border-red-400/30 hover:bg-red-400/10 text-xs" onClick={() => { setShowRejectDialog(r); setRejectReason(""); }}>Rechazar</Button>
                                </>
                              )}
                              {needsProviderRefund && refund?.status !== "refunded" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-xs text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10"
                                  disabled={refundBusy}
                                  onClick={() => executeRefund(r)}
                                >
                                  {refundBusy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <DollarSign className="w-3 h-3 mr-1" />}
                                  {refundBusy ? "Procesando" : refund?.status === "failed" ? "Reintentar" : "Ejecutar reintegro"}
                                </Button>
                              )}
                              {r.status === "approved" && !needsProviderRefund && <Button size="sm" variant="outline" className="text-xs" onClick={() => resolveReturn(r.id)}>Resolver</Button>}
                            </div>
                            {refund?.status === "refunded" && <span className="mt-1 block text-[11px] text-emerald-500">Reintegrado por MercadoPago</span>}
                            {refund?.status === "failed" && <span className="mt-1 block max-w-44 text-[11px] text-destructive" title={refund.failure_reason ?? undefined}>Falló: {refund.failure_reason || "revisar conexión"}</span>}
                          </td>
                        </tr>
                      );
                    })}
                    {filtered.length === 0 && <tr><td colSpan={10} className="text-center py-12 text-muted-foreground">Sin solicitudes</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "Razones" && (
            <div className="space-y-4">
              {reasons.length === 0 && <Button variant="outline" size="sm" onClick={seedReasons}><RefreshCcw className="w-4 h-4 mr-1" /> Cargar razones predeterminadas</Button>}
              <Button size="sm" onClick={() => { setReasonForm({ name: "", requires_photo: false }); setShowReasonDialog(true); }}><Plus className="w-4 h-4 mr-1" /> Nueva razón</Button>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {reasons.map(r => (
                  <div key={r.id} className={`bg-card rounded-xl border p-4 flex items-center justify-between ${!r.is_active ? "opacity-50" : ""}`}>
                    <div>
                      <p className="font-medium text-foreground">{r.name}</p>
                      {r.requires_photo && <p className="text-xs text-orange-400 mt-0.5">Requiere foto</p>}
                    </div>
                    <button onClick={() => supabase.from("return_reasons").delete().eq("id", r.id).then(load)} className="text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === "Estadísticas" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-card rounded-xl border p-5 space-y-3">
                <h3 className="font-semibold text-foreground">Por estado</h3>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => {
                  const count = returns.filter(r => r.status === k).length;
                  const pct = returns.length > 0 ? (count / returns.length) * 100 : 0;
                  return (
                    <div key={k} className="space-y-1">
                      <div className="flex justify-between text-sm"><span className="flex items-center gap-1">{v.icon}<span>{v.label}</span></span><span className="font-medium">{count}</span></div>
                      <div className="h-1.5 bg-muted/40 rounded-full"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div>
                    </div>
                  );
                })}
              </div>
              <div className="bg-card rounded-xl border p-5 space-y-3">
                <h3 className="font-semibold text-foreground">Por resolución</h3>
                {Object.entries(RESOLUTION_LABELS).map(([k, label]) => {
                  const count = returns.filter(r => r.resolution === k).length;
                  if (count === 0) return null;
                  return (
                    <div key={k} className="flex justify-between text-sm py-1 border-b last:border-0">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-semibold">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* New Request Dialog */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Nueva Solicitud de Devolución</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Cliente *</Label><Input value={form.customer_name} onChange={e => setForm(p => ({ ...p, customer_name: e.target.value }))} /></div>
              <div><Label>Email</Label><Input value={form.customer_email} onChange={e => setForm(p => ({ ...p, customer_email: e.target.value }))} /></div>
            </div>
            <div>
              <Label>Producto</Label>
              <Select value={form.product_id} onValueChange={v => setForm(p => ({ ...p, product_id: v, product_name: products.find(pr => pr.id === v)?.name ?? p.product_name }))}>
                <SelectTrigger><SelectValue placeholder="Seleccionar producto…" /></SelectTrigger>
                <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Nombre del producto *</Label><Input value={form.product_name} onChange={e => setForm(p => ({ ...p, product_name: e.target.value }))} /></div>
              <div><Label>Cantidad</Label><Input type="number" min="1" value={form.quantity} onChange={e => setForm(p => ({ ...p, quantity: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Razón</Label>
                <Select value={form.reason_id} onValueChange={v => setForm(p => ({ ...p, reason_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar…" /></SelectTrigger>
                  <SelectContent>{reasons.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Condición del producto</Label>
                <Select value={form.condition} onValueChange={v => setForm(p => ({ ...p, condition: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(CONDITION_LABELS).map(([k,v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Descripción del problema</Label><textarea rows={2} value={form.reason_text} onChange={e => setForm(p => ({ ...p, reason_text: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm resize-none" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewDialog(false)}>Cancelar</Button>
            <Button onClick={createReturn}>Crear</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve Dialog */}
      <Dialog open={!!showApproveDialog} onOpenChange={() => setShowApproveDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Aprobar Solicitud — {showApproveDialog?.rma_number}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Resolución</Label>
              <Select value={approveForm.resolution} onValueChange={v => setApproveForm(p => ({ ...p, resolution: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(RESOLUTION_LABELS).map(([k,v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {approveForm.resolution === "refund" && (
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Monto a reembolsar ($)</Label><Input type="number" value={approveForm.refund_amount} onChange={e => setApproveForm(p => ({ ...p, refund_amount: e.target.value }))} /></div>
                <div>
                  <Label>Método</Label>
                  <Select value={approveForm.refund_method} onValueChange={v => setApproveForm(p => ({ ...p, refund_method: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(REFUND_METHOD_LABELS).map(([k,v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
            )}
            {showApproveDialog?.tipo === "arrepentimiento" && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-3">
                <p className="text-sm flex items-center gap-2 text-emerald-700"><Truck className="w-4 h-4" /> El envío de vuelta lo paga el comercio.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Costo coordinado ($)</Label><Input type="number" min="0" value={approveForm.return_shipping_amount} onChange={e => setApproveForm(p => ({ ...p, return_shipping_amount: e.target.value }))} /></div>
                  <div><Label>Cómo se resuelve</Label><Select value={approveForm.return_shipping_method} onValueChange={v => setApproveForm(p => ({ ...p, return_shipping_method: v }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(RETURN_SHIPPING_METHOD_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
                </div>
              </div>
            )}
            <div><Label>Notas de resolución</Label><Input value={approveForm.resolution_notes} onChange={e => setApproveForm(p => ({ ...p, resolution_notes: e.target.value }))} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowApproveDialog(null)}>Cancelar</Button>
            <Button onClick={approveReturn}><CheckCircle2 className="w-4 h-4 mr-1" /> Aprobar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Dialog */}
      <Dialog open={!!showRejectDialog} onOpenChange={() => setShowRejectDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rechazar solicitud</DialogTitle></DialogHeader>
          <div><Label>Motivo de rechazo *</Label><textarea rows={3} value={rejectReason} onChange={e => setRejectReason(e.target.value)} className="w-full border rounded px-3 py-2 text-sm resize-none mt-1" /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRejectDialog(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={rejectReturn}><XCircle className="w-4 h-4 mr-1" /> Rechazar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Reason Dialog */}
      <Dialog open={showReasonDialog} onOpenChange={setShowReasonDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nueva razón de devolución</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Nombre *</Label><Input value={reasonForm.name} onChange={e => setReasonForm(p => ({ ...p, name: e.target.value }))} /></div>
            <div className="flex items-center gap-3">
              <input type="checkbox" checked={reasonForm.requires_photo} onChange={e => setReasonForm(p => ({ ...p, requires_photo: e.target.checked }))} className="rounded" />
              <Label>Requiere foto/evidencia</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReasonDialog(false)}>Cancelar</Button>
            <Button onClick={async () => {
              if (!orgId || !reasonForm.name.trim()) return;
              await supabase.from("return_reasons").insert({ org_id: orgId, name: reasonForm.name, requires_photo: reasonForm.requires_photo, sort_order: reasons.length });
              toast.success("Razón guardada"); setShowReasonDialog(false); load();
            }}>Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
