import { useState, useEffect } from "react";
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
  Building2, Plus, Pencil, Trash2, CheckCircle2, AlertTriangle, Clock,
  DollarSign, Package, ChevronDown, ChevronRight,
} from "lucide-react";

interface RentalAsset {
  id: string;
  name: string;
  description: string | null;
  category: string;
  serial_number: string | null;
  condition: string;
  daily_rate: number;
  hourly_rate: number | null;
  weekly_rate: number | null;
  monthly_rate: number | null;
  deposit_amount: number;
  status: string;
  location: string | null;
  notes: string | null;
}

interface RentalContract {
  id: string;
  contract_number: string;
  asset_id: string;
  customer_name: string;
  customer_phone: string | null;
  customer_dni: string | null;
  start_date: string;
  end_date: string;
  returned_at: string | null;
  rate_type: string;
  rate_amount: number;
  total_amount: number;
  deposit_paid: number;
  deposit_returned: number | null;
  status: string;
  notes: string | null;
  created_at: string;
}

const ASSET_STATUS: Record<string, { label: string; color: string }> = {
  available:   { label: "Disponible",  color: "bg-emerald-500/15 text-emerald-400" },
  rented:      { label: "Alquilado",   color: "bg-blue-500/15 text-blue-400" },
  maintenance: { label: "Mantención",  color: "bg-yellow-500/15 text-yellow-400" },
  retired:     { label: "Dado de baja",color: "bg-muted/50 text-muted-foreground" },
};

const CONTRACT_STATUS: Record<string, { label: string; color: string }> = {
  pending:   { label: "Pendiente",  color: "bg-yellow-500/15 text-yellow-400" },
  active:    { label: "Activo",     color: "bg-emerald-500/15 text-emerald-400" },
  returned:  { label: "Devuelto",   color: "bg-muted/50 text-muted-foreground" },
  overdue:   { label: "Vencido",    color: "bg-destructive/15 text-destructive" },
  cancelled: { label: "Cancelado",  color: "bg-muted/40 text-muted-foreground" },
};

const RATE_TYPES = [
  { value: "hourly", label: "Por hora" },
  { value: "daily", label: "Por día" },
  { value: "weekly", label: "Por semana" },
  { value: "monthly", label: "Por mes" },
];

const CONDITION_LABELS: Record<string, string> = {
  excellent: "Excelente", good: "Bueno", fair: "Regular", poor: "Malo",
};

const CATEGORIES = ["equipo", "vehiculo", "herramienta", "espacio", "tecnologia", "mobiliario", "audiovisual", "otro"];

function fmt(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0 }).format(n);
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}

const EMPTY_ASSET = {
  name: "", description: "", category: "equipo", serial_number: "",
  condition: "excellent", daily_rate: "", hourly_rate: "", weekly_rate: "",
  monthly_rate: "", deposit_amount: "0", status: "available", location: "", notes: "",
};

export default function RentalPage() {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";

  const [assets, setAssets] = useState<RentalAsset[]>([]);
  const [contracts, setContracts] = useState<RentalContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("assets");

  const [assetOpen, setAssetOpen] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<RentalAsset | null>(null);
  const [expandedContract, setExpandedContract] = useState<string | null>(null);

  const [assetForm, setAssetForm] = useState(EMPTY_ASSET);
  const [contractForm, setContractForm] = useState({
    asset_id: "", customer_name: "", customer_phone: "", customer_dni: "",
    start_date: new Date().toISOString().substring(0, 10),
    end_date: new Date(Date.now() + 86400000).toISOString().substring(0, 10),
    rate_type: "daily", rate_amount: "", deposit_paid: "0", notes: "",
  });

  async function loadData() {
    if (!orgId) return;
    setLoading(true);
    const [assetsRes, contractsRes] = await Promise.all([
      supabase.from("rental_assets").select("*").eq("org_id", orgId).order("name"),
      supabase.from("rental_contracts").select("*").eq("org_id", orgId).order("created_at", { ascending: false }),
    ]);
    setAssets((assetsRes.data || []) as RentalAsset[]);
    setContracts((contractsRes.data || []) as RentalContract[]);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [orgId]);

  async function saveAsset() {
    if (!assetForm.name.trim() || !assetForm.daily_rate) {
      toast.error("Nombre y tarifa diaria son requeridos"); return;
    }
    const payload = {
      org_id: orgId, name: assetForm.name.trim(),
      description: assetForm.description || null, category: assetForm.category,
      serial_number: assetForm.serial_number || null, condition: assetForm.condition,
      daily_rate: Number(assetForm.daily_rate),
      hourly_rate: assetForm.hourly_rate ? Number(assetForm.hourly_rate) : null,
      weekly_rate: assetForm.weekly_rate ? Number(assetForm.weekly_rate) : null,
      monthly_rate: assetForm.monthly_rate ? Number(assetForm.monthly_rate) : null,
      deposit_amount: Number(assetForm.deposit_amount),
      status: assetForm.status,
      location: assetForm.location || null, notes: assetForm.notes || null,
    };
    if (editingAsset) {
      const { error } = await supabase.from("rental_assets").update(payload).eq("id", editingAsset.id);
      if (error) { toast.error(error.message); return; }
      toast.success("Activo actualizado");
    } else {
      const { error } = await supabase.from("rental_assets").insert(payload);
      if (error) { toast.error(error.message); return; }
      toast.success("Activo creado");
    }
    setAssetOpen(false); setEditingAsset(null); setAssetForm(EMPTY_ASSET);
    loadData();
  }

  async function saveContract() {
    const { asset_id, customer_name, start_date, end_date, rate_type, rate_amount } = contractForm;
    if (!asset_id || !customer_name.trim() || !rate_amount) {
      toast.error("Activo, cliente y tarifa son requeridos"); return;
    }
    const days = Math.max(1, Math.ceil((new Date(end_date).getTime() - new Date(start_date).getTime()) / 86400000));
    const rateN = Number(rate_amount);
    const units = rate_type === "hourly" ? days * 8 : rate_type === "daily" ? days : rate_type === "weekly" ? Math.ceil(days / 7) : Math.ceil(days / 30);
    const total = rateN * units;

    const { error } = await supabase.from("rental_contracts").insert({
      org_id: orgId, asset_id, customer_name: customer_name.trim(),
      customer_phone: contractForm.customer_phone || null,
      customer_dni: contractForm.customer_dni || null,
      start_date: new Date(start_date).toISOString(),
      end_date: new Date(end_date).toISOString(),
      rate_type, rate_amount: rateN, total_amount: total,
      deposit_paid: Number(contractForm.deposit_paid),
      status: "active", notes: contractForm.notes || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success(`Contrato creado · Total: ${fmt(total)}`);
    setContractOpen(false);
    setContractForm({ asset_id: "", customer_name: "", customer_phone: "", customer_dni: "", start_date: new Date().toISOString().substring(0,10), end_date: new Date(Date.now()+86400000).toISOString().substring(0,10), rate_type: "daily", rate_amount: "", deposit_paid: "0", notes: "" });
    loadData();
  }

  async function returnAsset(contractId: string) {
    if (!confirm("¿Confirmar devolución del activo?")) return;
    const { error } = await supabase.from("rental_contracts").update({ status: "returned" }).eq("id", contractId);
    if (error) { toast.error(error.message); return; }
    toast.success("Devolución registrada");
    loadData();
  }

  async function deleteAsset(id: string) {
    const hasActive = contracts.some(c => c.asset_id === id && c.status === "active");
    if (hasActive) { toast.error("El activo tiene contratos activos"); return; }
    if (!confirm("¿Eliminar activo?")) return;
    await supabase.from("rental_assets").delete().eq("id", id);
    toast.success("Activo eliminado");
    loadData();
  }

  function openEditAsset(asset: RentalAsset) {
    setEditingAsset(asset);
    setAssetForm({
      name: asset.name, description: asset.description || "",
      category: asset.category, serial_number: asset.serial_number || "",
      condition: asset.condition, daily_rate: String(asset.daily_rate),
      hourly_rate: asset.hourly_rate ? String(asset.hourly_rate) : "",
      weekly_rate: asset.weekly_rate ? String(asset.weekly_rate) : "",
      monthly_rate: asset.monthly_rate ? String(asset.monthly_rate) : "",
      deposit_amount: String(asset.deposit_amount),
      status: asset.status, location: asset.location || "", notes: asset.notes || "",
    });
    setAssetOpen(true);
  }

  const availableCount = assets.filter(a => a.status === "available").length;
  const rentedCount = assets.filter(a => a.status === "rented").length;
  const overdueContracts = contracts.filter(c => c.status === "active" && new Date(c.end_date) < new Date());
  const monthlyRevenue = contracts
    .filter(c => c.status !== "cancelled" && new Date(c.created_at) >= new Date(Date.now() - 30 * 86400000))
    .reduce((s, c) => s + c.total_amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="w-6 h-6 text-primary" /> Gestión de Alquileres
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Alquilá activos, equipos o espacios con contratos, depósitos y seguimiento.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setEditingAsset(null); setAssetForm(EMPTY_ASSET); setAssetOpen(true); }}>
            <Plus className="w-4 h-4 mr-1" /> Activo
          </Button>
          <Button onClick={() => setContractOpen(true)} disabled={assets.filter(a => a.status === "available").length === 0}>
            <Plus className="w-4 h-4 mr-1" /> Contrato
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Disponibles", value: availableCount, color: availableCount > 0 ? "text-emerald-400" : "" },
          { label: "Alquilados", value: rentedCount, color: "" },
          { label: "Contratos vencidos", value: overdueContracts.length, color: overdueContracts.length > 0 ? "text-destructive" : "" },
          { label: "Ingresos (30 días)", value: fmt(monthlyRevenue), color: "" },
        ].map(k => (
          <div key={k.label} className="rounded-xl border border-border/50 bg-card p-4">
            <p className="text-xs text-muted-foreground mb-1">{k.label}</p>
            <p className={`text-2xl font-bold ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {overdueContracts.length > 0 && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/8 p-3 flex items-center gap-3 text-destructive text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span><strong>{overdueContracts.length} contrato(s)</strong> venció su fecha de devolución. Contactá a los clientes.</span>
        </div>
      )}

      {loading ? <div className="text-center py-12 text-muted-foreground">Cargando...</div> : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="assets">Activos ({assets.length})</TabsTrigger>
            <TabsTrigger value="contracts">Contratos ({contracts.length})</TabsTrigger>
          </TabsList>

          {/* Assets tab */}
          <TabsContent value="assets" className="pt-3">
            {assets.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Sin activos. Agregá equipos, espacios o herramientas para alquilar.</p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {assets.map(asset => {
                  const st = ASSET_STATUS[asset.status];
                  return (
                    <div key={asset.id} className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-sm">{asset.name}</p>
                          <p className="text-xs text-muted-foreground capitalize">{asset.category}{asset.serial_number ? ` · ${asset.serial_number}` : ""}</p>
                        </div>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${st.color}`}>{st.label}</span>
                      </div>
                      <div className="text-sm space-y-0.5">
                        <p className="font-semibold text-primary">{fmt(asset.daily_rate)} <span className="text-xs font-normal text-muted-foreground">/día</span></p>
                        {asset.weekly_rate && <p className="text-xs text-muted-foreground">{fmt(asset.weekly_rate)}/sem · {asset.monthly_rate ? `${fmt(asset.monthly_rate)}/mes` : ""}</p>}
                        {asset.deposit_amount > 0 && <p className="text-xs text-muted-foreground">Depósito: {fmt(asset.deposit_amount)}</p>}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{CONDITION_LABELS[asset.condition]}</span>
                        {asset.location && <span>· {asset.location}</span>}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => openEditAsset(asset)} className="text-muted-foreground hover:text-primary">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => deleteAsset(asset.id)} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* Contracts tab */}
          <TabsContent value="contracts" className="pt-3 space-y-2">
            {contracts.length === 0 ? (
              <p className="text-center py-10 text-muted-foreground text-sm">Sin contratos.</p>
            ) : contracts.map(contract => {
              const asset = assets.find(a => a.id === contract.asset_id);
              const cs = CONTRACT_STATUS[contract.status];
              const isExpanded = expandedContract === contract.id;
              const isOverdue = contract.status === "active" && new Date(contract.end_date) < new Date();

              return (
                <div key={contract.id} className="rounded-xl border border-border/50 bg-card overflow-hidden">
                  <div className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/20"
                    onClick={() => setExpandedContract(isExpanded ? null : contract.id)}>
                    {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{contract.contract_number}</span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cs.color}`}>{cs.label}</span>
                        {isOverdue && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-destructive/15 text-destructive">VENCIDO</span>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {contract.customer_name} · {asset?.name || "Activo"}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-semibold text-sm">{fmt(contract.total_amount)}</p>
                      <p className="text-xs text-muted-foreground">{fmtDate(contract.start_date)} → {fmtDate(contract.end_date)}</p>
                    </div>
                    {contract.status === "active" && (
                      <Button size="sm" variant="outline" className="h-7 text-xs shrink-0 ml-1"
                        onClick={e => { e.stopPropagation(); returnAsset(contract.id); }}>
                        <CheckCircle2 className="w-3 h-3 mr-1" /> Devuelto
                      </Button>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="border-t border-border/30 px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div><span className="text-muted-foreground">Tarifa</span><p className="font-semibold mt-0.5">{fmt(contract.rate_amount)} / {RATE_TYPES.find(r => r.value === contract.rate_type)?.label}</p></div>
                      <div><span className="text-muted-foreground">Depósito</span><p className="font-semibold mt-0.5">{fmt(contract.deposit_paid)}</p></div>
                      <div><span className="text-muted-foreground">DNI / ID</span><p className="font-semibold mt-0.5">{contract.customer_dni || "—"}</p></div>
                      <div><span className="text-muted-foreground">Teléfono</span><p className="font-semibold mt-0.5">{contract.customer_phone || "—"}</p></div>
                      {contract.notes && <div className="col-span-4"><span className="text-muted-foreground">Notas:</span><p>{contract.notes}</p></div>}
                    </div>
                  )}
                </div>
              );
            })}
          </TabsContent>
        </Tabs>
      )}

      {/* Asset dialog */}
      <Dialog open={assetOpen} onOpenChange={v => { setAssetOpen(v); if (!v) setEditingAsset(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingAsset ? "Editar activo" : "Nuevo activo"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Nombre *</Label>
                <Input value={assetForm.name} onChange={e => setAssetForm(p => ({ ...p, name: e.target.value }))} placeholder="Taladro DeWalt 20V..." />
              </div>
              <div><Label>Categoría</Label>
                <Select value={assetForm.category} onValueChange={v => setAssetForm(p => ({ ...p, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c}>{c.replace("_", " ")}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>N° de serie</Label>
                <Input value={assetForm.serial_number} onChange={e => setAssetForm(p => ({ ...p, serial_number: e.target.value }))} />
              </div>
              <div><Label>Estado</Label>
                <Select value={assetForm.status} onValueChange={v => setAssetForm(p => ({ ...p, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(ASSET_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Condición</Label>
              <Select value={assetForm.condition} onValueChange={v => setAssetForm(p => ({ ...p, condition: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(CONDITION_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Tarifa diaria *</Label>
                <Input type="number" min="0" value={assetForm.daily_rate} onChange={e => setAssetForm(p => ({ ...p, daily_rate: e.target.value }))} placeholder="$0/día" />
              </div>
              <div><Label>Tarifa por hora</Label>
                <Input type="number" min="0" value={assetForm.hourly_rate} onChange={e => setAssetForm(p => ({ ...p, hourly_rate: e.target.value }))} placeholder="Opcional" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Tarifa semanal</Label>
                <Input type="number" min="0" value={assetForm.weekly_rate} onChange={e => setAssetForm(p => ({ ...p, weekly_rate: e.target.value }))} placeholder="Opcional" />
              </div>
              <div><Label>Tarifa mensual</Label>
                <Input type="number" min="0" value={assetForm.monthly_rate} onChange={e => setAssetForm(p => ({ ...p, monthly_rate: e.target.value }))} placeholder="Opcional" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Depósito</Label>
                <Input type="number" min="0" value={assetForm.deposit_amount} onChange={e => setAssetForm(p => ({ ...p, deposit_amount: e.target.value }))} placeholder="$0" />
              </div>
              <div><Label>Ubicación</Label>
                <Input value={assetForm.location} onChange={e => setAssetForm(p => ({ ...p, location: e.target.value }))} placeholder="Depósito A..." />
              </div>
            </div>
            <div><Label>Descripción / notas</Label>
              <Textarea value={assetForm.notes} onChange={e => setAssetForm(p => ({ ...p, notes: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAssetOpen(false); setEditingAsset(null); }}>Cancelar</Button>
            <Button onClick={saveAsset}>{editingAsset ? "Guardar" : "Crear activo"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Contract dialog */}
      <Dialog open={contractOpen} onOpenChange={setContractOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nuevo contrato de alquiler</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Activo *</Label>
              <Select value={contractForm.asset_id} onValueChange={v => {
                const asset = assets.find(a => a.id === v);
                setContractForm(p => ({ ...p, asset_id: v, rate_amount: String(asset?.daily_rate || ""), deposit_paid: String(asset?.deposit_amount || "0") }));
              }}>
                <SelectTrigger><SelectValue placeholder="Seleccioná activo..." /></SelectTrigger>
                <SelectContent>
                  {assets.filter(a => a.status === "available").map(a => (
                    <SelectItem key={a.id} value={a.id}>{a.name} — {fmt(a.daily_rate)}/día</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Nombre del cliente *</Label>
                <Input value={contractForm.customer_name} onChange={e => setContractForm(p => ({ ...p, customer_name: e.target.value }))} placeholder="Juan Pérez..." />
              </div>
              <div><Label>Teléfono</Label>
                <Input value={contractForm.customer_phone} onChange={e => setContractForm(p => ({ ...p, customer_phone: e.target.value }))} placeholder="+54 11..." />
              </div>
            </div>
            <div><Label>DNI / CUIT</Label>
              <Input value={contractForm.customer_dni} onChange={e => setContractForm(p => ({ ...p, customer_dni: e.target.value }))} placeholder="20-12345678-9" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Inicio</Label>
                <Input type="date" value={contractForm.start_date} onChange={e => setContractForm(p => ({ ...p, start_date: e.target.value }))} />
              </div>
              <div><Label>Fin</Label>
                <Input type="date" value={contractForm.end_date} onChange={e => setContractForm(p => ({ ...p, end_date: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Tipo de tarifa</Label>
                <Select value={contractForm.rate_type} onValueChange={v => setContractForm(p => ({ ...p, rate_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{RATE_TYPES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Monto tarifa *</Label>
                <Input type="number" min="0" value={contractForm.rate_amount}
                  onChange={e => setContractForm(p => ({ ...p, rate_amount: e.target.value }))} placeholder="$0" />
              </div>
            </div>
            <div><Label>Depósito cobrado</Label>
              <Input type="number" min="0" value={contractForm.deposit_paid}
                onChange={e => setContractForm(p => ({ ...p, deposit_paid: e.target.value }))} />
            </div>
            <div><Label>Notas</Label>
              <Textarea value={contractForm.notes} onChange={e => setContractForm(p => ({ ...p, notes: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setContractOpen(false)}>Cancelar</Button>
            <Button onClick={saveContract}>Crear contrato</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
