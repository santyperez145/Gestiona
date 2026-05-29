import { useState, useEffect, useCallback, useMemo } from "react";
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
import { Landmark, Plus, TrendingDown, DollarSign, CalendarCheck, AlertTriangle, CheckCircle, Loader2 } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";

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
  equipment:   { label: "Equipamiento",   color: "bg-blue-500/15 text-blue-400" },
  furniture:   { label: "Mobiliario",     color: "bg-yellow-500/15 text-yellow-400" },
  vehicle:     { label: "Vehículo",       color: "bg-purple-500/15 text-purple-400" },
  building:    { label: "Edificio",       color: "bg-orange-500/15 text-orange-400" },
  land:        { label: "Terreno",        color: "bg-emerald-500/15 text-emerald-400" },
  computer:    { label: "Informática",    color: "bg-indigo-500/15 text-indigo-400" },
  software:    { label: "Software",       color: "bg-pink-500/15 text-pink-400" },
  other:       { label: "Otro",           color: "bg-muted/40 text-muted-foreground" },
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active:             { label: "Activo",           color: "bg-emerald-500/15 text-emerald-400" },
  disposed:           { label: "Dado de baja",     color: "bg-red-500/15 text-red-400" },
  fully_depreciated:  { label: "Totalmente dep.",  color: "bg-muted/40 text-muted-foreground" },
  written_off:        { label: "Cancelado",        color: "bg-orange-500/15 text-orange-400" },
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
  usePageTitle("Activos Fijos");
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

  const kpis = useMemo(() => [
    { label: "Activos activos", value: activeCount, icon: Landmark, color: "primary" as const },
    { label: "Costo total", value: fmt(totalCost), icon: DollarSign, color: "blue" as const },
    { label: "Amort. acumulada", value: fmt(totalDepreciated), icon: TrendingDown, color: "warning" as const },
    { label: "Garantías por vencer", value: warrantyExpiringSoon, icon: AlertTriangle, color: "destructive" as const },
  ], [activeCount, totalCost, totalDepreciated, warrantyExpiringSoon]);

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-7 h-7 animate-spin text-primary" />
    </div>
  );

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Landmark}
        title="Activos Fijos"
        description="Patrimonio, depreciación y amortización"
        actions={
        <Dialog open={assetOpen} onOpenChange={setAssetOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => setAssetForm({ ...EMPTY_ASSET })}>
              <Plus className="w-4 h-4 mr-2" /> Nuevo activo
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Nuevo activo fijo</DialogTitle></DialogHeader>
            <div className="space-y-3 pb-12">
              <div className="space-y-1 pb-12">
                <Label>Nombre *</Label>
                <Input value={assetForm.name} onChange={e => setAssetForm(f => ({ ...f, name: e.target.value }))} placeholder="Computadora Dell, Escritorio..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 pb-12">
                  <Label>Categoría</Label>
                  <Select value={assetForm.category} onValueChange={v => setAssetForm(f => ({ ...f, category: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(CATEGORY_CONFIG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 pb-12">
                  <Label>Método depreciación</Label>
                  <Select value={assetForm.depreciation_method} onValueChange={v => setAssetForm(f => ({ ...f, depreciation_method: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="straight_line">Línea recta</SelectItem>
                      <SelectItem value="declining_balance">Saldo decreciente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 pb-12">
                  <Label>Costo de adquisición</Label>
                  <Input type="number" min={0} value={assetForm.purchase_cost} onChange={e => setAssetForm(f => ({ ...f, purchase_cost: Number(e.target.value) }))} />
                </div>
                <div className="space-y-1 pb-12">
                  <Label>Valor residual</Label>
                  <Input type="number" min={0} value={assetForm.salvage_value} onChange={e => setAssetForm(f => ({ ...f, salvage_value: Number(e.target.value) }))} />
                </div>
                <div className="space-y-1 pb-12">
                  <Label>Vida útil (años)</Label>
                  <Input type="number" min={1} value={assetForm.useful_life_years} onChange={e => setAssetForm(f => ({ ...f, useful_life_years: Number(e.target.value) }))} />
                </div>
                <div className="space-y-1 pb-12">
                  <Label>Fecha adquisición</Label>
                  <Input type="date" value={assetForm.purchase_date} onChange={e => setAssetForm(f => ({ ...f, purchase_date: e.target.value }))} />
                </div>
              </div>
              {assetForm.purchase_cost > 0 && assetForm.useful_life_years > 0 && (
                <div className="bg-primary/5 rounded p-2 text-sm text-primary">
                  Amort. anual (SL): {fmt((assetForm.purchase_cost - assetForm.salvage_value) / assetForm.useful_life_years)}
                  {" · "}Mensual: {fmt((assetForm.purchase_cost - assetForm.salvage_value) / assetForm.useful_life_years / 12)}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1 pb-12">
                  <Label>Ubicación</Label>
                  <Input value={assetForm.location} onChange={e => setAssetForm(f => ({ ...f, location: e.target.value }))} placeholder="Oficina, Depósito..." />
                </div>
                <div className="space-y-1 pb-12">
                  <Label>Responsable</Label>
                  <Input value={assetForm.assigned_to} onChange={e => setAssetForm(f => ({ ...f, assigned_to: e.target.value }))} />
                </div>
                <div className="space-y-1 pb-12">
                  <Label>Proveedor</Label>
                  <Input value={assetForm.supplier_name} onChange={e => setAssetForm(f => ({ ...f, supplier_name: e.target.value }))} />
                </div>
                <div className="space-y-1 pb-12">
                  <Label>Venc. garantía</Label>
                  <Input type="date" value={assetForm.warranty_expiry} onChange={e => setAssetForm(f => ({ ...f, warranty_expiry: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1 pb-12">
                <Label>Descripción / Notas</Label>
                <Textarea value={assetForm.notes} onChange={e => setAssetForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
              </div>
              <Button className="w-full" onClick={saveAsset} disabled={savingAsset}>
                {savingAsset ? "Guardando..." : "Crear activo fijo"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(k => (
          <KPICard key={k.label} label={k.label} value={k.value} icon={k.icon} color={k.color} />
        ))}
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
        <div className="text-center py-16 text-muted-foreground">
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
                      <p className="text-xs font-mono text-muted-foreground">{asset.asset_number}</p>
                      <CardTitle className="text-base">{asset.name}</CardTitle>
                    </div>
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <Badge className={`text-xs ${cc.color}`}>{cc.label}</Badge>
                      <Badge className={`text-xs ${sc.color}`}>{sc.label}</Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 pb-12">
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div className="bg-muted/20 rounded p-2">
                      <p className="text-xs text-muted-foreground">Costo</p>
                      <p className="text-sm font-semibold">{fmt(asset.purchase_cost)}</p>
                    </div>
                    <div className="bg-primary/5 rounded p-2">
                      <p className="text-xs text-muted-foreground">Valor libro</p>
                      <p className="text-sm font-semibold text-primary">{fmt(bookValue)}</p>
                    </div>
                  </div>

                  {/* Depreciation bar */}
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Amortización</span>
                      <span>{deprPct.toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-muted/40 rounded-full h-1.5">
                      <div className="bg-orange-500 h-1.5 rounded-full" style={{ width: `${Math.min(deprPct, 100)}%` }} />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
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
                          <div className="space-y-3 pb-12">
                            <p className="text-sm text-muted-foreground"><strong>{asset.name}</strong></p>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1 pb-12">
                                <Label>Año</Label>
                                <Input type="number" value={deprYear} onChange={e => setDeprYear(Number(e.target.value))} />
                              </div>
                              <div className="space-y-1 pb-12">
                                <Label>Mes</Label>
                                <Select value={String(deprMonth)} onValueChange={v => setDeprMonth(Number(v))}>
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {MONTHS.map((m, i) => <SelectItem key={i+1} value={String(i+1)}>{m}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                            <div className="bg-primary/5 rounded p-3 text-sm space-y-1">
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
                          <p className="text-xs text-muted-foreground font-medium mb-1">Historial</p>
                          {assetEntries.slice(-6).map(e => (
                            <div key={e.id} className="flex justify-between text-xs text-muted-foreground py-0.5">
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
