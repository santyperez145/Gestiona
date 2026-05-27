import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Landmark, Plus, TrendingDown, DollarSign, CalendarCheck, AlertTriangle, CheckCircle } from "lucide-react";

interface FixedAsset {
  id: string;
  asset_number: string;
  name: string;
  category: string;
  description: string | null;
  location: string | null;
  assigned_to: string | null;
  purchase_date: string;
  purchase_cost: number;
  salvage_value: number;
  useful_life_years: number;
  depreciation_method: string;
  annual_rate_pct: number | null;
  status: string;
  disposed_at: string | null;
  disposal_value: number | null;
  supplier_name: string | null;
  warranty_expiry: string | null;
  notes: string | null;
  created_at: string;
}

interface DeprEntry {
  id: string;
  asset_id: string;
  period_year: number;
  period_month: number;
  depreciation: number;
  book_value_end: number;
  accumulated: number;
}

const CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
  equipment:   { label: "Equipamiento",   color: "bg-blue-100 text-blue-800" },
  furniture:   { label: "Mobiliario",     color: "bg-yellow-100 text-yellow-800" },
  vehicle:     { label: "Vehículo",       color: "bg-purple-100 text-purple-800" },
  building:    { label: "Edificio",       color: "bg-orange-100 text-orange-800" },
  land:        { label: "Terreno",        color: "bg-green-100 text-green-800" },
  computer:    { label: "Informática",    color: "bg-indigo-100 text-indigo-800" },
  software:    { label: "Software",       color: "bg-pink-100 text-pink-800" },
  other:       { label: "Otro",           color: "bg-gray-100 text-gray-700" },
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active:             { label: "Activo",           color: "bg-green-100 text-green-800" },
  disposed:           { label: "Dado de baja",     color: "bg-red-100 text-red-800" },
  fully_depreciated:  { label: "Totalmente dep.",  color: "bg-gray-100 text-gray-700" },
  written_off:        { label: "Cancelado",        color: "bg-orange-100 text-orange-800" },
};

const MONTHS = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

const EMPTY_ASSET = {
  name: "", category: "equipment", description: "", location: "",
  assigned_to: "", purchase_date: new Date().toISOString().split("T")[0],
  purchase_cost: 0, salvage_value: 0, useful_life_years: 5,
  depreciation_method: "straight_line", annual_rate_pct: 20,
  supplier_name: "", invoice_number: "", warranty_expiry: "", notes: ""
};

export default function FixedAssetsPage() {
  const { orgId } = useOrganization();

  const [assets, setAssets]           = useState<FixedAsset[]>([]);
  const [entries, setEntries]         = useState<DeprEntry[]>([]);
  const [loading, setLoading]         = useState(true);
  const [selectedAsset, setSelectedAsset] = useState<FixedAsset | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter]     = useState("active");

  const [assetOpen, setAssetOpen]     = useState(false);
  const [assetForm, setAssetForm]     = useState({ ...EMPTY_ASSET });
  const [savingAsset, setSavingAsset] = useState(false);

  const [deprOpen, setDeprOpen]   = useState(false);
  const [deprYear, setDeprYear]   = useState(new Date().getFullYear());
  const [deprMonth, setDeprMonth] = useState(new Date().getMonth() + 1);
  const [savingDepr, setSavingDepr] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [aRes, dRes] = await Promise.allSettled([
      supabase.from("fixed_assets").select("*").eq("org_id", orgId).eq("active", true).order("asset_number"),
      supabase.from("asset_depreciation_entries").select("*").eq("org_id", orgId).order("period_year").order("period_month"),
    ]);
    if (aRes.status === "fulfilled" && aRes.value.data) setAssets(aRes.value.data as FixedAsset[]);
    if (dRes.status === "fulfilled" && dRes.value.data) setEntries(dRes.value.data as DeprEntry[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  async function saveAsset() {
    if (!orgId || !assetForm.name.trim()) return toast.error("Ingresá el nombre del activo");
    setSavingAsset(true);
    const { error } = await supabase.from("fixed_assets").insert({
      org_id: orgId,
      name: assetForm.name.trim(),
      category: assetForm.category,
      description: assetForm.description || null,
      location: assetForm.location || null,
      assigned_to: assetForm.assigned_to || null,
      purchase_date: assetForm.purchase_date,
      purchase_cost: Number(assetForm.purchase_cost),
      salvage_value: Number(assetForm.salvage_value),
      useful_life_years: Number(assetForm.useful_life_years),
      depreciation_method: assetForm.depreciation_method,
      annual_rate_pct: assetForm.depreciation_method === "declining_balance" ? Number(assetForm.annual_rate_pct) : null,
      supplier_name: assetForm.supplier_name || null,
      warranty_expiry: assetForm.warranty_expiry || null,
      notes: assetForm.notes || null,
    });
    setSavingAsset(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Activo fijo creado");
    setAssetOpen(false);
    setAssetForm({ ...EMPTY_ASSET });
    load();
  }

  async function recordDepreciation() {
    if (!selectedAsset || !orgId) return;
    setSavingDepr(true);

    // Calculate SL depreciation for this period
    const annualDepr = (selectedAsset.purchase_cost - selectedAsset.salvage_value) / selectedAsset.useful_life_years;
    const monthlyDepr = annualDepr / 12;

    // Get current accumulated
    const assetEntries = entries.filter(e => e.asset_id === selectedAsset.id);
    const prevAccumulated = assetEntries.length > 0
      ? assetEntries[assetEntries.length - 1].accumulated
      : 0;
    const newAccumulated = prevAccumulated + monthlyDepr;
    const bookValueEnd = selectedAsset.purchase_cost - newAccumulated;

    const { error } = await supabase.from("asset_depreciation_entries").upsert({
      org_id: orgId,
      asset_id: selectedAsset.id,
      period_year: deprYear,
      period_month: deprMonth,
      depreciation: monthlyDepr,
      book_value_end: Math.max(0, bookValueEnd),
      accumulated: Math.min(newAccumulated, selectedAsset.purchase_cost - selectedAsset.salvage_value),
    }, { onConflict: "asset_id,period_year,period_month" });

    setSavingDepr(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Amortización registrada");
    setDeprOpen(false);
    load();
  }

  const fmt = (n: number) => `$${Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2 })}`;

  const filteredAssets = assets.filter(a => {
    if (categoryFilter !== "all" && a.category !== categoryFilter) return false;
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    return true;
  });

  const totalCost = assets.reduce((s, a) => s + Number(a.purchase_cost), 0);
  const totalDepreciated = entries.reduce((s, e) => s + Number(e.depreciation), 0);
  const activeCount = assets.filter(a => a.status === "active").length;
  const warrantyExpiringSoon = assets.filter(a => {
    if (!a.warranty_expiry) return false;
    const days = (new Date(a.warranty_expiry).getTime() - Date.now()) / 86400000;
    return days <= 30 && days >= 0;
  }).length;

  const getAssetEntries = (assetId: string) => entries.filter(e => e.asset_id === assetId);
  const getBookValue = (asset: FixedAsset) => {
    const assetEntries = getAssetEntries(asset.id);
    if (assetEntries.length === 0) return asset.purchase_cost;
    return assetEntries[assetEntries.length - 1].book_value_end;
  };
  const getAccumulated = (asset: FixedAsset) => {
    const assetEntries = getAssetEntries(asset.id);
    if (assetEntries.length === 0) return 0;
    return assetEntries[assetEntries.length - 1].accumulated;
  };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Landmark className="w-8 h-8 text-indigo-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Activos Fijos</h1>
            <p className="text-sm text-gray-500">Patrimonio, depreciación y amortización</p>
          </div>
        </div>
        <Dialog open={assetOpen} onOpenChange={setAssetOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => setAssetForm({ ...EMPTY_ASSET })}>
              <Plus className="w-4 h-4 mr-2" /> Nuevo activo
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Nuevo activo fijo</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>Nombre *</Label>
                <Input value={assetForm.name} onChange={e => setAssetForm(f => ({ ...f, name: e.target.value }))} placeholder="Computadora Dell, Escritorio..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Categoría</Label>
                  <Select value={assetForm.category} onValueChange={v => setAssetForm(f => ({ ...f, category: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(CATEGORY_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Método depreciación</Label>
                  <Select value={assetForm.depreciation_method} onValueChange={v => setAssetForm(f => ({ ...f, depreciation_method: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="straight_line">Línea recta</SelectItem>
                      <SelectItem value="declining_balance">Saldo decreciente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Costo de adquisición</Label>
                  <Input type="number" min={0} value={assetForm.purchase_cost} onChange={e => setAssetForm(f => ({ ...f, purchase_cost: Number(e.target.value) }))} />
                </div>
                <div className="space-y-1">
                  <Label>Valor residual</Label>
                  <Input type="number" min={0} value={assetForm.salvage_value} onChange={e => setAssetForm(f => ({ ...f, salvage_value: Number(e.target.value) }))} />
                </div>
                <div className="space-y-1">
                  <Label>Vida útil (años)</Label>
                  <Input type="number" min={1} value={assetForm.useful_life_years} onChange={e => setAssetForm(f => ({ ...f, useful_life_years: Number(e.target.value) }))} />
                </div>
                <div className="space-y-1">
                  <Label>Fecha adquisición</Label>
                  <Input type="date" value={assetForm.purchase_date} onChange={e => setAssetForm(f => ({ ...f, purchase_date: e.target.value }))} />
                </div>
              </div>
              {assetForm.purchase_cost > 0 && assetForm.useful_life_years > 0 && (
                <div className="bg-indigo-50 rounded p-2 text-sm text-indigo-800">
                  Amort. anual (SL): {fmt((assetForm.purchase_cost - assetForm.salvage_value) / assetForm.useful_life_years)}
                  {" · "}Mensual: {fmt((assetForm.purchase_cost - assetForm.salvage_value) / assetForm.useful_life_years / 12)}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Ubicación</Label>
                  <Input value={assetForm.location} onChange={e => setAssetForm(f => ({ ...f, location: e.target.value }))} placeholder="Oficina, Depósito..." />
                </div>
                <div className="space-y-1">
                  <Label>Responsable</Label>
                  <Input value={assetForm.assigned_to} onChange={e => setAssetForm(f => ({ ...f, assigned_to: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Proveedor</Label>
                  <Input value={assetForm.supplier_name} onChange={e => setAssetForm(f => ({ ...f, supplier_name: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>Venc. garantía</Label>
                  <Input type="date" value={assetForm.warranty_expiry} onChange={e => setAssetForm(f => ({ ...f, warranty_expiry: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Descripción / Notas</Label>
                <Textarea value={assetForm.notes} onChange={e => setAssetForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
              </div>
              <Button className="w-full" onClick={saveAsset} disabled={savingAsset}>
                {savingAsset ? "Guardando..." : "Crear activo fijo"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card><CardContent className="pt-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Activos activos</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{activeCount}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="flex items-center gap-2 mb-1"><DollarSign className="w-4 h-4 text-blue-500" /><p className="text-xs text-gray-500 uppercase tracking-wide">Costo total</p></div>
          <p className="text-3xl font-bold text-blue-600">{fmt(totalCost)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="flex items-center gap-2 mb-1"><TrendingDown className="w-4 h-4 text-orange-500" /><p className="text-xs text-gray-500 uppercase tracking-wide">Amort. acumulada</p></div>
          <p className="text-3xl font-bold text-orange-600">{fmt(totalDepreciated)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <div className="flex items-center gap-2 mb-1"><AlertTriangle className="w-4 h-4 text-yellow-500" /><p className="text-xs text-gray-500 uppercase tracking-wide">Garantías por vencer</p></div>
          <p className="text-3xl font-bold text-yellow-600">{warrantyExpiringSoon}</p>
        </CardContent></Card>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="h-8 w-36"><SelectValue placeholder="Categoría" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            {Object.entries(CATEGORY_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-36"><SelectValue placeholder="Estado" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Asset cards */}
      {filteredAssets.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Landmark className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No hay activos fijos registrados</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAssets.map(asset => {
            const cc = CATEGORY_CONFIG[asset.category] ?? CATEGORY_CONFIG.other;
            const sc = STATUS_CONFIG[asset.status] ?? STATUS_CONFIG.active;
            const bookValue = getBookValue(asset);
            const accumulated = getAccumulated(asset);
            const deprPct = asset.purchase_cost > 0 ? (accumulated / (asset.purchase_cost - asset.salvage_value)) * 100 : 0;
            const assetEntries = getAssetEntries(asset.id);
            const warrantyExpiringSoonAsset = asset.warranty_expiry && (() => {
              const days = (new Date(asset.warranty_expiry!).getTime() - Date.now()) / 86400000;
              return days <= 30 && days >= 0;
            })();

            return (
              <Card key={asset.id} className={`cursor-pointer transition-shadow hover:shadow-md ${selectedAsset?.id === asset.id ? "ring-2 ring-blue-500" : ""}`}
                onClick={() => setSelectedAsset(selectedAsset?.id === asset.id ? null : asset)}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <p className="text-xs font-mono text-gray-400">{asset.asset_number}</p>
                      <CardTitle className="text-base">{asset.name}</CardTitle>
                    </div>
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <Badge className={`text-xs ${cc.color}`}>{cc.label}</Badge>
                      <Badge className={`text-xs ${sc.color}`}>{sc.label}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="bg-gray-50 rounded p-2">
                      <p className="text-xs text-gray-500">Costo</p>
                      <p className="text-sm font-semibold">{fmt(asset.purchase_cost)}</p>
                    </div>
                    <div className="bg-indigo-50 rounded p-2">
                      <p className="text-xs text-gray-500">Valor libro</p>
                      <p className="text-sm font-semibold text-indigo-700">{fmt(bookValue)}</p>
                    </div>
                  </div>

                  {/* Depreciation bar */}
                  <div>
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Amortización</span>
                      <span>{deprPct.toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5">
                      <div className="bg-orange-500 h-1.5 rounded-full" style={{ width: `${Math.min(deprPct, 100)}%` }} />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1 text-xs text-gray-500">
                    <span>Vida útil: {asset.useful_life_years} años</span>
                    {asset.location && <span>· {asset.location}</span>}
                    {assetEntries.length > 0 && <span>· {assetEntries.length} períodos</span>}
                  </div>

                  {warrantyExpiringSoonAsset && (
                    <p className="text-xs text-orange-600 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Garantía vence pronto
                    </p>
                  )}

                  {/* Depreciation action */}
                  {selectedAsset?.id === asset.id && (
                    <div className="pt-2 border-t" onClick={e => e.stopPropagation()}>
                      <Dialog open={deprOpen} onOpenChange={setDeprOpen}>
                        <DialogTrigger asChild>
                          <Button size="sm" variant="outline" className="w-full h-7 text-xs">
                            <TrendingDown className="w-3 h-3 mr-1" /> Registrar amortización
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-sm">
                          <DialogHeader><DialogTitle>Registrar amortización mensual</DialogTitle></DialogHeader>
                          <div className="space-y-3">
                            <p className="text-sm text-gray-600"><strong>{asset.name}</strong></p>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <Label>Año</Label>
                                <Input type="number" value={deprYear} onChange={e => setDeprYear(Number(e.target.value))} />
                              </div>
                              <div className="space-y-1">
                                <Label>Mes</Label>
                                <Select value={String(deprMonth)} onValueChange={v => setDeprMonth(Number(v))}>
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {MONTHS.map((m, i) => <SelectItem key={i+1} value={String(i+1)}>{m}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                            <div className="bg-indigo-50 rounded p-3 text-sm space-y-1">
                              <p>Amort. mensual (SL): <strong>{fmt((asset.purchase_cost - asset.salvage_value) / asset.useful_life_years / 12)}</strong></p>
                              <p>Acumulada actual: {fmt(accumulated)}</p>
                              <p>Valor libro actual: {fmt(bookValue)}</p>
                            </div>
                            <Button className="w-full" onClick={recordDepreciation} disabled={savingDepr}>
                              {savingDepr ? "Guardando..." : "Registrar"}
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>

                      {/* History */}
                      {assetEntries.length > 0 && (
                        <div className="mt-2 max-h-32 overflow-y-auto">
                          <p className="text-xs text-gray-500 font-medium mb-1">Historial</p>
                          {assetEntries.slice(-6).map(e => (
                            <div key={e.id} className="flex justify-between text-xs text-gray-500 py-0.5">
                              <span>{MONTHS[e.period_month - 1]} {e.period_year}</span>
                              <span className="text-orange-600">-{fmt(e.depreciation)}</span>
                              <span>VL: {fmt(e.book_value_end)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
