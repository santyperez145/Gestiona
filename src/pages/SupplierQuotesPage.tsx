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
  FileText, Plus, Edit2, Trash2, RefreshCw, Search, Send,
  CheckCircle2, XCircle, Clock, Package, DollarSign,
  ChevronDown, ChevronUp, Copy, BarChart3,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface RFQ {
  id: string;
  rfq_number: string;
  supplier_name: string;
  supplier_email: string | null;
  title: string;
  description: string | null;
  due_date: string | null;
  status: string;
  currency: string;
  delivery_days: number | null;
  payment_terms: string | null;
  shipping_terms: string | null;
  notes: string | null;
  created_at: string;
}

interface RFQItem {
  id: string;
  rfq_id: string;
  description: string;
  quantity: number;
  unit: string;
  quoted_price: number | null;
  min_order_qty: number | null;
  lead_time_days: number | null;
  notes: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  draft:     { label: "Borrador",    cls: "bg-muted text-muted-foreground" },
  sent:      { label: "Enviado",     cls: "bg-blue-500/15 text-blue-400" },
  responded: { label: "Respondido",  cls: "bg-yellow-500/15 text-yellow-500" },
  accepted:  { label: "Aceptado",    cls: "bg-emerald-500/15 text-emerald-400" },
  rejected:  { label: "Rechazado",   cls: "bg-destructive/15 text-destructive" },
  expired:   { label: "Expirado",    cls: "bg-muted text-muted-foreground opacity-60" },
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtCurrency(n: number, currency = "ARS") {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
}

// ── RFQ Form ──────────────────────────────────────────────────────────────────
const blankRFQ = () => ({
  supplier_name: "", supplier_email: "",
  title: "", description: "", due_date: "",
  currency: "ARS", delivery_days: "", payment_terms: "",
  shipping_terms: "", notes: "", status: "draft",
});
const blankItem = () => ({ description: "", quantity: 1, unit: "unidad", quoted_price: "", min_order_qty: "", lead_time_days: "", notes: "" });

function RFQForm({ open, onClose, editing, orgId, onSaved }: {
  open: boolean; onClose: () => void; editing: RFQ | null;
  orgId: string; onSaved: () => void;
}) {
  const [f, setF] = useState(blankRFQ());
  const [items, setItems] = useState([blankItem()]);
  const [saving, setSaving] = useState(false);
  const upd = (k: string, v: unknown) => setF(p => ({ ...p, [k]: v }));
  const updItem = (i: number, k: string, v: unknown) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it));

  useEffect(() => {
    if (editing) {
      setF({
        supplier_name: editing.supplier_name, supplier_email: editing.supplier_email || "",
        title: editing.title, description: editing.description || "",
        due_date: editing.due_date || "", currency: editing.currency,
        delivery_days: editing.delivery_days !== null ? String(editing.delivery_days) : "",
        payment_terms: editing.payment_terms || "", shipping_terms: editing.shipping_terms || "",
        notes: editing.notes || "", status: editing.status,
      });
      // Load items
      supabase.from("rfq_items").select("*").eq("rfq_id", editing.id).then(({ data }) => {
        if (data && data.length > 0) {
          setItems(data.map(it => ({
            description: it.description, quantity: it.quantity,
            unit: it.unit, quoted_price: it.quoted_price !== null ? String(it.quoted_price) : "",
            min_order_qty: it.min_order_qty !== null ? String(it.min_order_qty) : "",
            lead_time_days: it.lead_time_days !== null ? String(it.lead_time_days) : "",
            notes: it.notes || "",
          })));
        }
      });
    } else {
      setF(blankRFQ()); setItems([blankItem()]);
    }
  }, [editing, open]);

  async function save() {
    if (!f.supplier_name.trim() || !f.title.trim()) {
      toast.error("Proveedor y título son requeridos"); return;
    }
    setSaving(true);
    const payload = {
      org_id: orgId, supplier_name: f.supplier_name.trim(),
      supplier_email: f.supplier_email || null, title: f.title.trim(),
      description: f.description || null, due_date: f.due_date || null,
      currency: f.currency, delivery_days: f.delivery_days ? Number(f.delivery_days) : null,
      payment_terms: f.payment_terms || null, shipping_terms: f.shipping_terms || null,
      notes: f.notes || null, status: f.status,
      rfq_number: editing?.rfq_number || "",
    };
    let rfqId = editing?.id;
    if (editing) {
      await supabase.from("rfq_requests").update(payload).eq("id", editing.id);
    } else {
      // Generate RFQ number
      const { data: numData } = await supabase.rpc("generate_rfq_number", { p_org_id: orgId });
      const { data: newRFQ, error } = await supabase.from("rfq_requests")
        .insert({ ...payload, rfq_number: numData || `RFQ-${Date.now()}` }).select().single();
      if (error) { toast.error(error.message); setSaving(false); return; }
      rfqId = newRFQ.id;
    }
    // Upsert items
    if (rfqId) {
      await supabase.from("rfq_items").delete().eq("rfq_id", rfqId);
      const validItems = items.filter(it => it.description.trim());
      if (validItems.length > 0) {
        await supabase.from("rfq_items").insert(validItems.map(it => ({
          rfq_id: rfqId,
          description: it.description.trim(), quantity: Number(it.quantity), unit: it.unit,
          quoted_price: it.quoted_price ? Number(it.quoted_price) : null,
          min_order_qty: it.min_order_qty ? Number(it.min_order_qty) : null,
          lead_time_days: it.lead_time_days ? Number(it.lead_time_days) : null,
          notes: it.notes || null,
        })));
      }
    }
    setSaving(false);
    toast.success("RFQ guardado");
    onSaved(); onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{editing ? "Editar RFQ" : "Nueva solicitud de cotización"}</DialogTitle></DialogHeader>
        <div className="space-y-4 py-2 max-h-[75vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Proveedor *</Label>
              <Input value={f.supplier_name} onChange={e => upd("supplier_name", e.target.value)} />
            </div>
            <div><Label>Email proveedor</Label>
              <Input type="email" value={f.supplier_email} onChange={e => upd("supplier_email", e.target.value)} />
            </div>
          </div>
          <div><Label>Título del pedido *</Label>
            <Input value={f.title} onChange={e => upd("title", e.target.value)} placeholder="Compra Q2 2026 — Fragancias importadas..." />
          </div>
          <div><Label>Descripción</Label>
            <Textarea value={f.description as string} onChange={e => upd("description", e.target.value)} rows={2} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Fecha límite</Label>
              <Input type="date" value={f.due_date} onChange={e => upd("due_date", e.target.value)} />
            </div>
            <div><Label>Moneda</Label>
              <Select value={f.currency} onValueChange={v => upd("currency", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ARS">ARS</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                </SelectContent>
              </Select>
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

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Ítems a cotizar</Label>
              <Button size="sm" variant="outline" onClick={() => setItems(p => [...p, blankItem()])}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Ítem
              </Button>
            </div>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-start bg-muted/20 rounded-lg p-2">
                  <div className="col-span-4">
                    <Input placeholder="Descripción *" value={it.description} onChange={e => updItem(i, "description", e.target.value)} className="text-xs h-8" />
                  </div>
                  <div className="col-span-2">
                    <Input placeholder="Cantidad" type="number" min="0" value={it.quantity} onChange={e => updItem(i, "quantity", e.target.value)} className="text-xs h-8" />
                  </div>
                  <div className="col-span-2">
                    <Input placeholder="Unidad" value={it.unit} onChange={e => updItem(i, "unit", e.target.value)} className="text-xs h-8" />
                  </div>
                  <div className="col-span-2">
                    <Input placeholder="Precio cot." type="number" min="0" value={it.quoted_price as string} onChange={e => updItem(i, "quoted_price", e.target.value)} className="text-xs h-8" />
                  </div>
                  <div className="col-span-1">
                    <Input placeholder="Días" type="number" min="0" value={it.lead_time_days as string} onChange={e => updItem(i, "lead_time_days", e.target.value)} className="text-xs h-8" />
                  </div>
                  <div className="col-span-1 flex justify-center">
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => setItems(p => p.filter((_, idx) => idx !== i))}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div><Label>Notas adicionales</Label>
            <Textarea value={f.notes} onChange={e => upd("notes", e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Guardando..." : "Guardar RFQ"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SupplierQuotesPage() {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";
  const [rfqs, setRFQs] = useState<RFQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RFQ | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [rfqItems, setRFQItems] = useState<Record<string, RFQItem[]>>({});
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  async function loadData() {
    if (!orgId) return;
    setLoading(true);
    const { data } = await supabase.from("rfq_requests").select("*")
      .eq("org_id", orgId).order("created_at", { ascending: false });
    setRFQs(data || []);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [orgId]);

  async function toggleExpand(rfq: RFQ) {
    const id = rfq.id;
    if (expanded.has(id)) {
      setExpanded(p => { const n = new Set(p); n.delete(id); return n; });
    } else {
      setExpanded(p => new Set([...p, id]));
      if (!rfqItems[id]) {
        const { data } = await supabase.from("rfq_items").select("*").eq("rfq_id", id);
        setRFQItems(p => ({ ...p, [id]: data || [] }));
      }
    }
  }

  async function updateStatus(id: string, status: string) {
    await supabase.from("rfq_requests").update({ status }).eq("id", id);
    toast.success("Estado actualizado");
    loadData();
  }

  async function deleteRFQ(id: string) {
    if (!confirm("¿Eliminar este RFQ?")) return;
    await supabase.from("rfq_requests").delete().eq("id", id);
    toast.success("RFQ eliminado");
    loadData();
  }

  const filtered = useMemo(() => rfqs.filter(r => {
    const matchSearch = r.supplier_name.toLowerCase().includes(search.toLowerCase()) ||
      r.title.toLowerCase().includes(search.toLowerCase()) || r.rfq_number.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || r.status === filterStatus;
    return matchSearch && matchStatus;
  }), [rfqs, search, filterStatus]);

  const sentCount = rfqs.filter(r => r.status === "sent").length;
  const respondedCount = rfqs.filter(r => r.status === "responded").length;
  const acceptedCount = rfqs.filter(r => r.status === "accepted").length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="w-6 h-6 text-primary" /> Cotizaciones de Proveedores
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Enviá RFQs, comparé precios y aceptá la mejor oferta.
          </p>
        </div>
        <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
          <Plus className="w-4 h-4 mr-1" /> Nueva RFQ
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total RFQs", value: rfqs.length, icon: FileText, color: "text-primary" },
          { label: "Enviadas", value: sentCount, icon: Send, color: "text-blue-400" },
          { label: "Con respuesta", value: respondedCount, icon: Clock, color: "text-yellow-400" },
          { label: "Aceptadas", value: acceptedCount, icon: CheckCircle2, color: "text-emerald-400" },
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

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar por proveedor, título, número..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {Object.entries(STATUS_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={loadData}><RefreshCw className="w-4 h-4" /></Button>
      </div>

      {/* RFQ list */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Cargando...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Sin RFQs. Creá una para solicitar cotizaciones.</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(rfq => {
            const isOpen = expanded.has(rfq.id);
            const cfg = STATUS_CFG[rfq.status];
            const items = rfqItems[rfq.id] || [];
            return (
              <div key={rfq.id} className="rounded-xl border border-border/50 bg-card overflow-hidden">
                <div className="flex items-center gap-3 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{rfq.rfq_number}</code>
                      <h3 className="font-semibold truncate">{rfq.title}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg?.cls}`}>{cfg?.label}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                      <span>{rfq.supplier_name}</span>
                      <span>{rfq.currency}</span>
                      {rfq.due_date && <span>Vence: {fmtDate(rfq.due_date)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {rfq.status === "draft" && (
                      <Button size="sm" variant="outline" className="text-xs h-7"
                        onClick={() => updateStatus(rfq.id, "sent")}>
                        <Send className="w-3 h-3 mr-1" /> Marcar enviado
                      </Button>
                    )}
                    {rfq.status === "responded" && (
                      <Button size="sm" className="text-xs h-7"
                        onClick={() => updateStatus(rfq.id, "accepted")}>
                        <CheckCircle2 className="w-3 h-3 mr-1" /> Aceptar
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(rfq); setFormOpen(true); }}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteRFQ(rfq.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => toggleExpand(rfq)}>
                      {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
                {isOpen && (
                  <div className="border-t border-border/50 px-4 pb-4 pt-3">
                    {rfq.description && <p className="text-sm text-muted-foreground mb-3">{rfq.description}</p>}
                    {items.length > 0 ? (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-muted-foreground border-b border-border/30">
                            <th className="text-left py-1">Descripción</th>
                            <th className="text-right py-1">Cant.</th>
                            <th className="text-left py-1 px-2">Unidad</th>
                            <th className="text-right py-1">Precio cot.</th>
                            <th className="text-right py-1">Días</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map(it => (
                            <tr key={it.id} className="border-b border-border/20">
                              <td className="py-1.5">{it.description}</td>
                              <td className="text-right py-1.5">{it.quantity}</td>
                              <td className="py-1.5 px-2 text-muted-foreground">{it.unit}</td>
                              <td className="text-right py-1.5 font-mono">
                                {it.quoted_price !== null ? fmtCurrency(it.quoted_price, rfq.currency) : "—"}
                              </td>
                              <td className="text-right py-1.5 text-muted-foreground">
                                {it.lead_time_days !== null ? `${it.lead_time_days}d` : "—"}
                              </td>
                            </tr>
                          ))}
                          {items.some(it => it.quoted_price !== null) && (
                            <tr className="font-bold">
                              <td colSpan={3} className="pt-2">Total cotizado</td>
                              <td className="text-right pt-2 text-primary">
                                {fmtCurrency(items.reduce((s, it) => s + (it.quoted_price || 0) * it.quantity, 0), rfq.currency)}
                              </td>
                              <td />
                            </tr>
                          )}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-sm text-muted-foreground">Sin ítems cargados.</p>
                    )}
                    {rfq.notes && <p className="text-xs text-muted-foreground mt-2 italic">{rfq.notes}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <RFQForm open={formOpen} onClose={() => setFormOpen(false)}
        editing={editing} orgId={orgId} onSaved={loadData} />
    </div>
  );
}
