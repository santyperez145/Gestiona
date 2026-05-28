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
  Shield, Plus, Edit2, Trash2, RefreshCw, Search,
  CheckCircle2, Clock, Wrench, AlertTriangle, DollarSign,
  ChevronDown, ChevronUp, Package, Loader2,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";

interface WarrantyClaim {
  id: string;
  claim_number: string;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  product_name: string;
  serial_number: string | null;
  purchase_date: string | null;
  warranty_end: string | null;
  issue_type: string;
  description: string;
  status: string;
  priority: string;
  assigned_to: string | null;
  estimated_ready: string | null;
  resolution: string | null;
  cost_parts: number;
  cost_labor: number;
  cost_customer: number;
  covered_by_warranty: boolean;
  created_at: string;
}

interface WEvent {
  id: string;
  claim_id: string;
  status: string;
  note: string;
  created_at: string;
}

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  open:           { label: "Abierto",          cls: "bg-blue-500/15 text-blue-400" },
  in_diagnosis:   { label: "En diagnóstico",   cls: "bg-yellow-500/15 text-yellow-500" },
  in_repair:      { label: "En reparación",    cls: "bg-purple-500/15 text-purple-400" },
  waiting_parts:  { label: "Esperando partes", cls: "bg-orange-500/15 text-orange-400" },
  ready:          { label: "Listo para retirar", cls: "bg-emerald-500/15 text-emerald-400" },
  delivered:      { label: "Entregado",        cls: "bg-emerald-500/15 text-emerald-400" },
  rejected:       { label: "Rechazado",        cls: "bg-destructive/15 text-destructive" },
  cancelled:      { label: "Cancelado",        cls: "bg-muted text-muted-foreground" },
};

const ISSUE_LABELS: Record<string, string> = {
  defect: "Defecto de fábrica", damage: "Daño físico",
  missing_part: "Pieza faltante", not_working: "No funciona", other: "Otro",
};

const STATUS_FLOW = ["open","in_diagnosis","in_repair","waiting_parts","ready","delivered"];

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtCurrency(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
}

const blankClaim = () => ({
  customer_name: "", customer_email: "", customer_phone: "",
  product_name: "", serial_number: "", purchase_date: "", warranty_end: "",
  issue_type: "defect", description: "", status: "open", priority: "normal",
  assigned_to: "", estimated_ready: "", resolution: "",
  cost_parts: 0, cost_labor: 0, cost_customer: 0, covered_by_warranty: true,
});

function ClaimForm({ open, onClose, editing, orgId, onSaved }: {
  open: boolean; onClose: () => void; editing: WarrantyClaim | null;
  orgId: string; onSaved: () => void;
}) {
  const [f, setF] = useState(blankClaim());
  const [saving, setSaving] = useState(false);
  const upd = (k: string, v: unknown) => setF(p => ({ ...p, [k]: v }));

  useEffect(() => {
    if (editing) {
      setF({
        customer_name: editing.customer_name, customer_email: editing.customer_email || "",
        customer_phone: editing.customer_phone || "", product_name: editing.product_name,
        serial_number: editing.serial_number || "", purchase_date: editing.purchase_date || "",
        warranty_end: editing.warranty_end || "", issue_type: editing.issue_type,
        description: editing.description, status: editing.status, priority: editing.priority,
        assigned_to: editing.assigned_to || "", estimated_ready: editing.estimated_ready || "",
        resolution: editing.resolution || "", cost_parts: editing.cost_parts,
        cost_labor: editing.cost_labor, cost_customer: editing.cost_customer,
        covered_by_warranty: editing.covered_by_warranty,
      });
    } else { setF(blankClaim()); }
  }, [editing, open]);

  async function save() {
    if (!f.customer_name.trim() || !f.product_name.trim() || !f.description.trim()) {
      toast.error("Cliente, producto y descripción son requeridos"); return;
    }
    setSaving(true);
    const payload = {
      org_id: orgId, customer_name: f.customer_name.trim(), customer_email: f.customer_email || null,
      customer_phone: f.customer_phone || null, product_name: f.product_name.trim(),
      serial_number: f.serial_number || null, purchase_date: f.purchase_date || null,
      warranty_end: f.warranty_end || null, issue_type: f.issue_type,
      description: f.description, status: f.status, priority: f.priority,
      assigned_to: f.assigned_to || null, estimated_ready: f.estimated_ready || null,
      resolution: f.resolution || null, cost_parts: Number(f.cost_parts),
      cost_labor: Number(f.cost_labor), cost_customer: Number(f.cost_customer),
      covered_by_warranty: f.covered_by_warranty,
      claim_number: editing?.claim_number || "",
    };
    if (editing) {
      const { error } = await supabase.from("warranty_claims").update(payload).eq("id", editing.id);
      if (error) { toast.error(error.message); setSaving(false); return; }
    } else {
      const { data: num } = await supabase.rpc("generate_claim_number", { p_org_id: orgId });
      const { error } = await supabase.from("warranty_claims")
        .insert({ ...payload, claim_number: num || `WCL-${Date.now()}` });
      if (error) { toast.error(error.message); setSaving(false); return; }
    }
    setSaving(false);
    toast.success("Reclamo guardado");
    onSaved(); onClose();
  }

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{editing ? "Editar reclamo" : "Nuevo reclamo de garantía"}</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2 max-h-[75vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Cliente *</Label>
              <Input value={f.customer_name} onChange={e => upd("customer_name", e.target.value)} />
            </div>
            <div><Label>Teléfono</Label>
              <Input value={f.customer_phone} onChange={e => upd("customer_phone", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Producto *</Label>
              <Input value={f.product_name} onChange={e => upd("product_name", e.target.value)} />
            </div>
            <div><Label>N° de serie</Label>
              <Input value={f.serial_number} onChange={e => upd("serial_number", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Fecha de compra</Label>
              <Input type="date" value={f.purchase_date} onChange={e => upd("purchase_date", e.target.value)} />
            </div>
            <div><Label>Garantía hasta</Label>
              <Input type="date" value={f.warranty_end} onChange={e => upd("warranty_end", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Tipo de problema</Label>
              <Select value={f.issue_type} onValueChange={v => upd("issue_type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(ISSUE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
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
          </div>
          <div><Label>Descripción del problema *</Label>
            <Textarea value={f.description} onChange={e => upd("description", e.target.value)} rows={3} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Asignado a</Label>
              <Input value={f.assigned_to} onChange={e => upd("assigned_to", e.target.value)} placeholder="Técnico Juan..." />
            </div>
            <div><Label>Fecha estimada de entrega</Label>
              <Input type="date" value={f.estimated_ready} onChange={e => upd("estimated_ready", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Costo partes</Label>
              <Input type="number" min="0" value={f.cost_parts} onChange={e => upd("cost_parts", e.target.value)} />
            </div>
            <div><Label>Costo mano obra</Label>
              <Input type="number" min="0" value={f.cost_labor} onChange={e => upd("cost_labor", e.target.value)} />
            </div>
            <div><Label>Cobrar al cliente</Label>
              <Input type="number" min="0" value={f.cost_customer} onChange={e => upd("cost_customer", e.target.value)} />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Select value={f.status} onValueChange={v => upd("status", v)}>
              <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="covered" checked={f.covered_by_warranty as boolean}
                onChange={e => upd("covered_by_warranty", e.target.checked)} className="w-4 h-4" />
              <label htmlFor="covered" className="text-sm whitespace-nowrap">Cubierto por garantía</label>
            </div>
          </div>
          <div><Label>Resolución / notas técnicas</Label>
            <Textarea value={f.resolution} onChange={e => upd("resolution", e.target.value)} rows={2} />
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

export default function WarrantyClaimsPage() {
  usePageTitle("Garantías & Reparaciones");
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";
  const [claims, setClaims] = useState<WarrantyClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WarrantyClaim | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [events, setEvents] = useState<Record<string, WEvent[]>>({});
  const [newNote, setNewNote] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  async function loadData() {
    if (!orgId) return;
    setLoading(true);
    const { data } = await supabase.from("warranty_claims").select("*")
      .eq("org_id", orgId).order("created_at", { ascending: false });
    setClaims(data || []);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [orgId]);

  async function toggleExpand(id: string) {
    if (expanded.has(id)) {
      setExpanded(p => { const n = new Set(p); n.delete(id); return n; });
    } else {
      setExpanded(p => new Set([...p, id]));
      if (!events[id]) {
        const { data } = await supabase.from("warranty_events").select("*").eq("claim_id", id).order("created_at");
        setEvents(p => ({ ...p, [id]: data || [] }));
      }
    }
  }

  async function addNote(claimId: string, status: string) {
    const note = newNote[claimId]?.trim();
    if (!note) return;
    await supabase.from("warranty_events").insert({ claim_id: claimId, status, note });
    setNewNote(p => ({ ...p, [claimId]: "" }));
    const { data } = await supabase.from("warranty_events").select("*").eq("claim_id", claimId).order("created_at");
    setEvents(p => ({ ...p, [claimId]: data || [] }));
  }

  async function advanceStatus(claim: WarrantyClaim) {
    const idx = STATUS_FLOW.indexOf(claim.status);
    if (idx < 0 || idx >= STATUS_FLOW.length - 1) return;
    const next = STATUS_FLOW[idx + 1];
    await supabase.from("warranty_claims").update({ status: next }).eq("id", claim.id);
    await supabase.from("warranty_events").insert({
      claim_id: claim.id, status: next, note: `Estado cambiado a: ${STATUS_CFG[next]?.label}`,
    });
    toast.success(`Estado: ${STATUS_CFG[next]?.label}`);
    loadData();
    if (events[claim.id]) {
      const { data } = await supabase.from("warranty_events").select("*").eq("claim_id", claim.id).order("created_at");
      setEvents(p => ({ ...p, [claim.id]: data || [] }));
    }
  }

  const filtered = useMemo(() => claims.filter(c => {
    const matchSearch = c.customer_name.toLowerCase().includes(search.toLowerCase()) ||
      c.claim_number.toLowerCase().includes(search.toLowerCase()) ||
      c.product_name.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || c.status === filterStatus;
    return matchSearch && matchStatus;
  }), [claims, search, filterStatus]);

  const openCount = claims.filter(c => !["delivered","rejected","cancelled"].includes(c.status)).length;
  const totalCost = claims.reduce((s, c) => s + c.cost_parts + c.cost_labor, 0);
  const coveredCount = claims.filter(c => c.covered_by_warranty).length;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Shield}
        title="Garantías & Reparaciones"
        description="Gestioná reclamos de garantía, reparaciones y seguimiento técnico."
        actions={
          <Button onClick={() => { setEditing(null); setFormOpen(true); }}>
            <Plus className="w-4 h-4 mr-1" /> Nuevo reclamo
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="Reclamos abiertos" value={openCount} icon={Shield} color="primary" />
        <KPICard label="En reparación" value={claims.filter(c => c.status === "in_repair").length} icon={Wrench} color="warning" />
        <KPICard label="Cubiertos por garantía" value={coveredCount} icon={CheckCircle2} color="success" />
        <KPICard label="Costo total reparaciones" value={fmtCurrency(totalCost)} icon={DollarSign} color="blue" />
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar por cliente, producto, número..."
            value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(STATUS_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={loadData}><RefreshCw className="w-4 h-4" /></Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(claim => {
            const cfg = STATUS_CFG[claim.status];
            const isOpen = expanded.has(claim.id);
            const claimEvents = events[claim.id] || [];
            const totalCostClaim = claim.cost_parts + claim.cost_labor;
            const idx = STATUS_FLOW.indexOf(claim.status);

            return (
              <div key={claim.id} className="rounded-xl border border-border/50 bg-card overflow-hidden">
                <div className="flex items-center gap-3 p-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{claim.claim_number}</code>
                      <span className="font-semibold">{claim.customer_name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg?.cls}`}>{cfg?.label}</span>
                      {claim.covered_by_warranty && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">Garantía</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Package className="w-3 h-3" />{claim.product_name}</span>
                      <span>{ISSUE_LABELS[claim.issue_type]}</span>
                      {totalCostClaim > 0 && <span>{fmtCurrency(totalCostClaim)}</span>}
                      <span>{fmtDate(claim.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {idx >= 0 && idx < STATUS_FLOW.length - 1 && (
                      <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => advanceStatus(claim)}>
                        → {STATUS_CFG[STATUS_FLOW[idx + 1]]?.label}
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditing(claim); setFormOpen(true); }}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => toggleExpand(claim.id)}>
                      {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
                {isOpen && (
                  <div className="border-t border-border/50 px-4 pb-4 pt-3 space-y-3">
                    <p className="text-sm">{claim.description}</p>
                    {claim.resolution && (
                      <p className="text-xs text-muted-foreground italic bg-muted/50 rounded p-2">{claim.resolution}</p>
                    )}
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-2">Historial</p>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {claimEvents.map(ev => (
                          <div key={ev.id} className="flex gap-2 text-xs">
                            <div className="w-2 h-2 rounded-full bg-primary/50 mt-1 shrink-0" />
                            <div>
                              <span className="text-muted-foreground">{fmtDate(ev.created_at)} — </span>
                              {ev.note}
                            </div>
                          </div>
                        ))}
                        {claimEvents.length === 0 && <p className="text-xs text-muted-foreground">Sin historial</p>}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Input placeholder="Agregar nota..." className="text-xs"
                        value={newNote[claim.id] || ""}
                        onChange={e => setNewNote(p => ({ ...p, [claim.id]: e.target.value }))}
                        onKeyDown={e => e.key === "Enter" && addNote(claim.id, claim.status)} />
                      <Button size="sm" onClick={() => addNote(claim.id, claim.status)}>+</Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">Sin reclamos.</div>
          )}
        </div>
      )}

      <ClaimForm open={formOpen} onClose={() => setFormOpen(false)}
        editing={editing} orgId={orgId} onSaved={loadData} />
    </div>
  );
}
