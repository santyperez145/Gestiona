import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  ShoppingBag, Plus, CheckCircle, XCircle, Clock,
  ChevronDown, ChevronRight, DollarSign, AlertCircle, Loader2
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";

interface PurchaseRequest {
  id: string;
  request_number: string;
  title: string;
  requested_by: string;
  department: string | null;
  priority: string;
  status: string;
  total_estimated: number;
  approved_by: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  notes: string | null;
  needed_by: string | null;
  created_at: string;
  purchase_request_items?: RequestItem[];
}

interface RequestItem {
  id: string;
  product_name: string;
  description: string | null;
  quantity: number;
  unit: string;
  estimated_price: number;
  total_estimated: number;
  preferred_supplier: string | null;
}

const STATUS_CFG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  draft:      { label: "Borrador",    color: "bg-gray-100 text-gray-700",    icon: <Clock className="w-3 h-3" /> },
  submitted:  { label: "Enviada",     color: "bg-blue-100 text-blue-800",    icon: <Clock className="w-3 h-3" /> },
  approved:   { label: "Aprobada",    color: "bg-green-100 text-green-800",  icon: <CheckCircle className="w-3 h-3" /> },
  rejected:   { label: "Rechazada",   color: "bg-red-100 text-red-800",      icon: <XCircle className="w-3 h-3" /> },
  ordered:    { label: "Pedida",      color: "bg-indigo-100 text-indigo-800",icon: <CheckCircle className="w-3 h-3" /> },
  received:   { label: "Recibida",    color: "bg-emerald-100 text-emerald-800",icon: <CheckCircle className="w-3 h-3" /> },
  cancelled:  { label: "Cancelada",   color: "bg-orange-100 text-orange-800",icon: <XCircle className="w-3 h-3" /> },
};

const PRIORITY_CFG: Record<string, { label: string; color: string }> = {
  low:    { label: "Baja",    color: "bg-gray-100 text-gray-600" },
  normal: { label: "Normal",  color: "bg-blue-100 text-blue-700" },
  high:   { label: "Alta",    color: "bg-orange-100 text-orange-700" },
  urgent: { label: "Urgente", color: "bg-red-100 text-red-700" },
};

const EMPTY_REQUEST = {
  title: "", requested_by: "", department: "",
  priority: "normal", needed_by: "", notes: ""
};

export default function PurchaseRequestsPage() {
  usePageTitle("Solicitudes de Compra");
  const { orgId } = useOrganization();

  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading]   = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedReq, setExpandedReq]   = useState<string | null>(null);

  const [reqOpen, setReqOpen]   = useState(false);
  const [reqForm, setReqForm]   = useState({ ...EMPTY_REQUEST });
  const [reqItems, setReqItems] = useState<{ product_name: string; description: string; quantity: number; unit: string; estimated_price: number; preferred_supplier: string }[]>([]);
  const [savingReq, setSavingReq] = useState(false);

  const [rejectOpen, setRejectOpen]   = useState(false);
  const [rejectId, setRejectId]       = useState("");
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [rRes, pRes] = await Promise.allSettled([
      supabase.from("purchase_requests").select("*, purchase_request_items(*)").eq("org_id", orgId).order("created_at", { ascending: false }),
      supabase.from("products").select("id, name").eq("org_id", orgId).order("name"),
    ]);
    if (rRes.status === "fulfilled" && rRes.value.data) setRequests(rRes.value.data as PurchaseRequest[]);
    if (pRes.status === "fulfilled" && pRes.value.data) setProducts(pRes.value.data as { id: string; name: string }[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  function addItem() {
    setReqItems(prev => [...prev, { product_name: "", description: "", quantity: 1, unit: "un", estimated_price: 0, preferred_supplier: "" }]);
  }

  function updateItem(idx: number, field: string, value: string | number) {
    setReqItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  }

  async function saveRequest() {
    if (!orgId || !reqForm.title.trim()) return toast.error("Ingresá el título de la solicitud");
    if (!reqForm.requested_by.trim()) return toast.error("Ingresá el solicitante");
    if (reqItems.length === 0) return toast.error("Agregá al menos un ítem");
    setSavingReq(true);

    const { data: reqData, error: reqErr } = await supabase.from("purchase_requests").insert({
      org_id: orgId,
      request_number: "temp",
      title: reqForm.title.trim(),
      requested_by: reqForm.requested_by.trim(),
      department: reqForm.department || null,
      priority: reqForm.priority,
      needed_by: reqForm.needed_by || null,
      notes: reqForm.notes || null,
      status: "submitted",
    }).select("id").single();

    if (reqErr || !reqData) { setSavingReq(false); toast.error(reqErr?.message ?? "Error"); return; }

    const items = reqItems.map(it => ({
      request_id: reqData.id,
      product_name: it.product_name || "Producto",
      description: it.description || null,
      quantity: Number(it.quantity),
      unit: it.unit,
      estimated_price: Number(it.estimated_price),
      preferred_supplier: it.preferred_supplier || null,
    }));

    const { error: itemsErr } = await supabase.from("purchase_request_items").insert(items);
    setSavingReq(false);
    if (itemsErr) { toast.error(itemsErr.message); return; }

    toast.success("Solicitud de compra enviada");
    setReqOpen(false);
    setReqForm({ ...EMPTY_REQUEST });
    setReqItems([]);
    load();
  }

  async function updateStatus(id: string, status: string, extra: Record<string, string | null> = {}) {
    const { error } = await supabase.from("purchase_requests").update({ status, ...extra }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Estado actualizado");
    load();
  }

  async function rejectRequest() {
    if (!rejectReason.trim()) return toast.error("Ingresá el motivo del rechazo");
    await updateStatus(rejectId, "rejected", { rejected_reason: rejectReason });
    setRejectOpen(false);
    setRejectReason("");
  }

  const fmt = (n: number) => `$${Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2 })}`;

  const filteredRequests = statusFilter === "all" ? requests : requests.filter(r => r.status === statusFilter);

  const kpis = useMemo(() => ({
    total: requests.length,
    pending: requests.filter(r => r.status === "submitted").length,
    approved: requests.filter(r => ["approved","ordered"].includes(r.status)).length,
    totalValue: requests.filter(r => r.status === "approved").reduce((s, r) => s + Number(r.total_estimated), 0),
  }), [requests]);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ShoppingBag}
        title="Solicitudes de Compra"
        description="Pedidos internos con flujo de aprobación"
        actions={
          <Dialog open={reqOpen} onOpenChange={setReqOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => { setReqForm({ ...EMPTY_REQUEST }); setReqItems([]); }}>
                <Plus className="w-4 h-4 mr-2" /> Nueva solicitud
              </Button>
            </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Nueva solicitud de compra</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1">
                <Label>Título *</Label>
                <Input value={reqForm.title} onChange={e => setReqForm(f => ({ ...f, title: e.target.value }))} placeholder="Reposición materiales de oficina..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Solicitante *</Label>
                  <Input value={reqForm.requested_by} onChange={e => setReqForm(f => ({ ...f, requested_by: e.target.value }))} placeholder="Nombre del empleado" />
                </div>
                <div className="space-y-1">
                  <Label>Departamento</Label>
                  <Input value={reqForm.department} onChange={e => setReqForm(f => ({ ...f, department: e.target.value }))} placeholder="Administración, Ventas..." />
                </div>
                <div className="space-y-1">
                  <Label>Prioridad</Label>
                  <Select value={reqForm.priority} onValueChange={v => setReqForm(f => ({ ...f, priority: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(PRIORITY_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Necesario para</Label>
                  <Input type="date" value={reqForm.needed_by} onChange={e => setReqForm(f => ({ ...f, needed_by: e.target.value }))} />
                </div>
              </div>

              {/* Items */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Ítems solicitados</Label>
                  <Button size="sm" variant="outline" onClick={addItem}><Plus className="w-3 h-3 mr-1" /> Agregar ítem</Button>
                </div>
                {reqItems.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Sin ítems aún</p>}
                {reqItems.map((it, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-end bg-muted/20 p-2 rounded">
                    <div className="col-span-4 space-y-1">
                      <Label className="text-xs">Producto</Label>
                      <Input className="h-8 text-sm" value={it.product_name} onChange={e => updateItem(idx, "product_name", e.target.value)} placeholder="Nombre" />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs">Cantidad</Label>
                      <Input className="h-8 text-sm" type="number" min={0} value={it.quantity} onChange={e => updateItem(idx, "quantity", e.target.value)} />
                    </div>
                    <div className="col-span-1 space-y-1">
                      <Label className="text-xs">Unidad</Label>
                      <Input className="h-8 text-sm" value={it.unit} onChange={e => updateItem(idx, "unit", e.target.value)} />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs">Precio est.</Label>
                      <Input className="h-8 text-sm" type="number" min={0} value={it.estimated_price} onChange={e => updateItem(idx, "estimated_price", e.target.value)} />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs">Proveedor pref.</Label>
                      <Input className="h-8 text-sm" value={it.preferred_supplier} onChange={e => updateItem(idx, "preferred_supplier", e.target.value)} />
                    </div>
                    <div className="col-span-1">
                      <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-500" onClick={() => setReqItems(prev => prev.filter((_, i) => i !== idx))}>✕</Button>
                    </div>
                  </div>
                ))}
                {reqItems.length > 0 && (
                  <div className="text-right text-sm font-medium text-foreground">
                    Total estimado: {fmt(reqItems.reduce((s, it) => s + Number(it.quantity) * Number(it.estimated_price), 0))}
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <Label>Notas</Label>
                <Textarea value={reqForm.notes} onChange={e => setReqForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
              </div>
              <Button className="w-full" onClick={saveRequest} disabled={savingReq}>
                {savingReq ? "Enviando..." : "Enviar solicitud"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Total solicitudes" value={kpis.total} icon={ShoppingBag} color="primary" />
        <KPICard label="Pendientes" value={kpis.pending} icon={AlertCircle} color="warning" sub="Esperando aprobación" />
        <KPICard label="Aprobadas" value={kpis.approved} icon={CheckCircle} color="success" sub="Aprobadas y pedidas" />
        <KPICard label="Valor aprobado" value={fmt(kpis.totalValue)} icon={DollarSign} color="blue" sub="Total en solicitudes aprobadas" />
      </div>

      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2">
        {["all", ...Object.keys(STATUS_CFG)].map(st => (
          <button key={st} onClick={() => setStatusFilter(st)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${statusFilter === st ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:border-primary/50"}`}>
            {st === "all" ? `Todas (${requests.length})` : STATUS_CFG[st]?.label}
          </button>
        ))}
      </div>

      {/* Requests list */}
      {filteredRequests.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <ShoppingBag className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No hay solicitudes de compra</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredRequests.map(req => {
            const sc = STATUS_CFG[req.status] ?? STATUS_CFG.draft;
            const pc = PRIORITY_CFG[req.priority] ?? PRIORITY_CFG.normal;
            const isExp = expandedReq === req.id;
            const items = req.purchase_request_items ?? [];

            return (
              <Card key={req.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <button onClick={() => setExpandedReq(isExp ? null : req.id)} className="text-muted-foreground flex-shrink-0">
                        {isExp ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      </button>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs text-muted-foreground">{req.request_number}</span>
                          <span className="font-semibold text-foreground">{req.title}</span>
                          <Badge className={`text-xs ${pc.color}`}>{pc.label}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {req.requested_by}{req.department && ` · ${req.department}`} · {new Date(req.created_at).toLocaleDateString("es-AR")}
                          {req.needed_by && ` · Necesario: ${new Date(req.needed_by).toLocaleDateString("es-AR")}`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right">
                        <p className="font-semibold text-foreground">{fmt(req.total_estimated)}</p>
                        <Badge className={`text-xs flex items-center gap-1 ${sc.color}`}>{sc.icon} {sc.label}</Badge>
                      </div>
                      <div className="flex gap-1">
                        {req.status === "submitted" && (
                          <>
                            <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700" onClick={() => updateStatus(req.id, "approved", { approved_at: new Date().toISOString() })}>
                              Aprobar
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs text-red-600 border-red-300" onClick={() => { setRejectId(req.id); setRejectOpen(true); }}>
                              Rechazar
                            </Button>
                          </>
                        )}
                        {req.status === "approved" && (
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => updateStatus(req.id, "ordered")}>
                            Marcar pedida
                          </Button>
                        )}
                        {req.status === "ordered" && (
                          <Button size="sm" variant="outline" className="h-7 text-xs text-green-700 border-green-300" onClick={() => updateStatus(req.id, "received")}>
                            Recibida ✓
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>

                  {isExp && (
                    <div className="mt-4 pt-4 border-t space-y-2">
                      {items.map(item => (
                        <div key={item.id} className="flex justify-between text-sm bg-muted/20 px-3 py-1.5 rounded">
                          <div>
                            <span className="font-medium">{item.product_name}</span>
                            {item.description && <span className="text-muted-foreground text-xs ml-2">{item.description}</span>}
                            {item.preferred_supplier && <span className="text-xs text-blue-500 ml-2">[{item.preferred_supplier}]</span>}
                          </div>
                          <span className="text-muted-foreground">x{item.quantity} {item.unit} · {fmt(item.total_estimated)}</span>
                        </div>
                      ))}
                      {req.rejected_reason && (
                        <p className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">
                          Motivo rechazo: {req.rejected_reason}
                        </p>
                      )}
                      {req.notes && <p className="text-sm text-muted-foreground italic">{req.notes}</p>}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Rechazar solicitud</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Label>Motivo del rechazo *</Label>
            <Textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3} placeholder="Explicá el motivo..." className="bg-muted" />
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setRejectOpen(false)}>Cancelar</Button>
              <Button variant="destructive" className="flex-1" onClick={rejectRequest}>Rechazar</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
