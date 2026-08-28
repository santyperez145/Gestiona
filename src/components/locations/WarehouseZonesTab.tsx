/**
 * WarehouseZonesTab — ported from the former MultiWarehousePage (/multi-deposito).
 * Rendered as the "Depósitos y Zonas" tab inside LocationsPage (/sucursales).
 *
 * Warehouse → Zone → Bin tree with stock-per-bin assignment.
 */
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
import { toast } from "sonner";
import { Warehouse, Plus, Star, Package, ChevronRight, ChevronDown, MapPin, Loader2 } from "lucide-react";
import KPICard from "@/components/shared/KPICard";

import { plural } from "@/lib/plural";
interface WarehouseData {
  id: string;
  name: string;
  code?: string | null;
  address: string | null;
  /** `locations` no tiene encargado ni código: eran columnas que sólo existían
   *  en la tabla duplicada. Quedan opcionales para no romper el formulario. */
  manager?: string | null;
  is_main: boolean;
  active: boolean;
}

interface Zone {
  id: string;
  location_id: string;
  name: string;
  zone_type: string;
  active: boolean;
}

interface Bin {
  id: string;
  zone_id: string;
  location_id: string;
  code: string;
  description: string | null;
  capacity: number | null;
  active: boolean;
}

interface BinStock {
  id: string;
  bin_id: string;
  product_id: string;
  quantity: number;
  products?: { name: string; sku: string | null } | null;
}

const ZONE_TYPE_CFG: Record<string, { label: string; color: string }> = {
  general:    { label: "General",    color: "bg-muted/40 text-muted-foreground" },
  cold:       { label: "Frío",       color: "bg-blue-500/15 text-blue-400" },
  bulk:       { label: "Granel",     color: "bg-yellow-500/15 text-yellow-400" },
  hazardous:  { label: "Peligroso",  color: "bg-red-500/15 text-red-400" },
  quarantine: { label: "Cuarentena", color: "bg-orange-500/15 text-orange-400" },
  dispatch:   { label: "Despacho",   color: "bg-purple-500/15 text-purple-400" },
  receiving:  { label: "Recepción",  color: "bg-emerald-500/15 text-emerald-400" },
};

const EMPTY_WH = { name: "", code: "", address: "", manager: "", phone: "", is_default: false };
const EMPTY_ZONE = { warehouse_id: "", name: "", zone_type: "general" };  // `warehouse_id` es el id de la sucursal elegida en el form
const EMPTY_BIN = { zone_id: "", code: "", description: "", capacity: 0 };

export default function WarehouseZonesTab() {
  const { orgId } = useOrganization();

  const [warehouses, setWarehouses] = useState<WarehouseData[]>([]);
  const [zones, setZones]           = useState<Zone[]>([]);
  const [bins, setBins]             = useState<Bin[]>([]);
  const [binStock, setBinStock]     = useState<BinStock[]>([]);
  const [loading, setLoading]       = useState(true);
  const [expandedWh, setExpandedWh] = useState<string | null>(null);
  const [expandedZone, setExpandedZone] = useState<string | null>(null);
  const [expandedBin, setExpandedBin]   = useState<string | null>(null);

  const [whOpen, setWhOpen]   = useState(false);
  const [whForm, setWhForm]   = useState({ ...EMPTY_WH });
  const [savingWh, setSavingWh] = useState(false);

  const [zoneOpen, setZoneOpen] = useState(false);
  const [zoneForm, setZoneForm] = useState({ ...EMPTY_ZONE });
  const [savingZone, setSavingZone] = useState(false);

  const [binOpen, setBinOpen] = useState(false);
  const [binForm, setBinForm] = useState({ ...EMPTY_BIN });
  const [savingBin, setSavingBin] = useState(false);

  const [stockOpen, setStockOpen] = useState(false);
  const [stockBinId, setStockBinId] = useState("");
  const [stockProducts, setStockProducts] = useState<{ id: string; name: string }[]>([]);
  const [stockProductId, setStockProductId] = useState("");
  const [stockQty, setStockQty] = useState(0);
  const [savingStock, setSavingStock] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [whRes, zRes, bRes, bsRes, prRes] = await Promise.allSettled([
      // `locations`, no `warehouses`: eran el mismo concepto modelado dos
      // veces, y el stock vive colgado de `locations`. Con `warehouses` las
      // posiciones nunca podían cerrar contra `location_stock`.
      supabase.from("locations").select("*").eq("org_id", orgId).eq("active", true).order("name"),
      supabase.from("warehouse_zones").select("*").eq("org_id", orgId).eq("active", true).order("name"),
      supabase.from("warehouse_bins").select("*").eq("org_id", orgId).eq("active", true).order("code"),
      supabase.from("bin_stock").select("*, products(name, sku)").eq("org_id", orgId).order("quantity", { ascending: false }),
      supabase.from("products").select("id, name").eq("org_id", orgId).order("name"),
    ]);
    if (whRes.status === "fulfilled" && whRes.value.data) setWarehouses(whRes.value.data as WarehouseData[]);
    if (zRes.status === "fulfilled" && zRes.value.data) setZones(zRes.value.data as Zone[]);
    if (bRes.status === "fulfilled" && bRes.value.data) setBins(bRes.value.data as Bin[]);
    if (bsRes.status === "fulfilled" && bsRes.value.data) setBinStock(bsRes.value.data as BinStock[]);
    if (prRes.status === "fulfilled" && prRes.value.data) setStockProducts(prRes.value.data as { id: string; name: string }[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  async function saveWarehouse() {
    if (!orgId || !whForm.name.trim()) return toast.error("Ingresá el nombre del depósito");
    setSavingWh(true);
    const { error } = await supabase.from("locations").insert({
      org_id: orgId, name: whForm.name.trim(),
      address: whForm.address || null,
      phone: whForm.phone || null, is_main: whForm.is_default, active: true,
    });
    setSavingWh(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Depósito creado");
    setWhOpen(false); setWhForm({ ...EMPTY_WH }); load();
  }

  async function saveZone() {
    if (!orgId || !zoneForm.warehouse_id) return toast.error("Seleccioná un depósito");
    if (!zoneForm.name.trim()) return toast.error("Ingresá el nombre de la zona");
    setSavingZone(true);
    const { error } = await supabase.from("warehouse_zones").insert({
      org_id: orgId, location_id: zoneForm.warehouse_id,
      name: zoneForm.name.trim(), zone_type: zoneForm.zone_type,
    });
    setSavingZone(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Zona creada");
    setZoneOpen(false); setZoneForm({ ...EMPTY_ZONE }); load();
  }

  async function saveBin() {
    if (!orgId || !binForm.zone_id) return toast.error("Seleccioná una zona");
    if (!binForm.code.trim()) return toast.error("Ingresá el código de la posición");
    setSavingBin(true);
    const zone = zones.find(z => z.id === binForm.zone_id);
    const { error } = await supabase.from("warehouse_bins").insert({
      org_id: orgId, zone_id: binForm.zone_id,
      location_id: zone?.location_id ?? null,
      code: binForm.code.trim().toUpperCase(),
      description: binForm.description || null,
      capacity: Number(binForm.capacity) || null,
    });
    setSavingBin(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Posición creada");
    setBinOpen(false); setBinForm({ ...EMPTY_BIN }); load();
  }

  async function saveStock() {
    if (!orgId || !stockBinId || !stockProductId) return toast.error("Seleccioná bin y producto");
    setSavingStock(true);
    // Por RPC, no con un upsert directo: `asignar_a_ubicacion` valida que las
    // posiciones de la sucursal no sumen más de lo que la sucursal tiene. El
    // upsert que estaba acá dejaba ubicar 500 unidades de un producto del que
    // hay 10 — el mismo agujero por el que una transferencia entre sucursales
    // llegó a inventar 40.
    const { data, error } = await supabase.rpc("asignar_a_ubicacion", {
      p_bin_id: stockBinId,
      p_product_id: stockProductId,
      p_cantidad: Number(stockQty),
    });
    setSavingStock(false);
    if (error) { toast.error(error.message); return; }
    const r = data as { ubicado?: number; sin_ubicar?: number } | null;
    toast.success(
      r && Number(r.sin_ubicar) > 0
        ? `Ubicado. Quedan ${plural(Number(r.sin_ubicar), "unidad", "unidades")} sin ubicar en la sucursal`
        : "Ubicado. No queda nada sin ubicar",
    );
    setStockOpen(false); setStockProductId(""); setStockQty(0); load();
  }

  async function setDefault(id: string) {
    const { error } = await supabase.from("warehouses").update({ is_default: true }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Depósito predeterminado actualizado");
    load();
  }

  const kpis = useMemo(() => ({
    totalWarehouses: warehouses.length,
    totalZones: zones.length,
    totalBins: bins.length,
    totalProducts: [...new Set(binStock.map(bs => bs.product_id))].length,
  }), [warehouses, zones, bins, binStock]);

  if (loading) return <div className="flex items-center justify-center h-64"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-muted-foreground">Depósitos, zonas, posiciones y stock por ubicación</p>
        <div className="flex gap-2">
          <Dialog open={binOpen} onOpenChange={setBinOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" onClick={() => setBinForm({ ...EMPTY_BIN })}>
                <Plus className="w-4 h-4 mr-1" /> Posición
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>Nueva posición (bin)</DialogTitle></DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1">
                  <Label>Zona *</Label>
                  <Select value={binForm.zone_id} onValueChange={v => setBinForm(f => ({ ...f, zone_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Seleccionar zona" /></SelectTrigger>
                    <SelectContent>
                      {zones.map(z => {
                        const wh = warehouses.find(w => w.id === z.location_id);
                        return <SelectItem key={z.id} value={z.id}>{wh?.name} / {z.name}</SelectItem>;
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Código *</Label>
                    <Input value={binForm.code} onChange={e => setBinForm(f => ({ ...f, code: e.target.value }))} placeholder="A-01-01" />
                  </div>
                  <div className="space-y-1">
                    <Label>Capacidad (u)</Label>
                    <Input type="number" min={0} value={binForm.capacity} onChange={e => setBinForm(f => ({ ...f, capacity: Number(e.target.value) }))} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Descripción</Label>
                  <Input value={binForm.description} onChange={e => setBinForm(f => ({ ...f, description: e.target.value }))} />
                </div>
                <Button className="w-full" onClick={saveBin} disabled={savingBin}>
                  {savingBin ? "Guardando..." : "Crear posición"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={zoneOpen} onOpenChange={setZoneOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" onClick={() => setZoneForm({ ...EMPTY_ZONE })}>
                <Plus className="w-4 h-4 mr-1" /> Zona
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader><DialogTitle>Nueva zona</DialogTitle></DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1">
                  <Label>Depósito *</Label>
                  <Select value={zoneForm.warehouse_id} onValueChange={v => setZoneForm(f => ({ ...f, warehouse_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Seleccionar depósito" /></SelectTrigger>
                    <SelectContent>
                      {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Nombre *</Label>
                  <Input value={zoneForm.name} onChange={e => setZoneForm(f => ({ ...f, name: e.target.value }))} placeholder="Zona A, Zona Frío..." />
                </div>
                <div className="space-y-1">
                  <Label>Tipo</Label>
                  <Select value={zoneForm.zone_type} onValueChange={v => setZoneForm(f => ({ ...f, zone_type: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(ZONE_TYPE_CFG).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button className="w-full" onClick={saveZone} disabled={savingZone}>
                  {savingZone ? "Guardando..." : "Crear zona"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={whOpen} onOpenChange={setWhOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={() => setWhForm({ ...EMPTY_WH })}>
                <Plus className="w-4 h-4 mr-2" /> Depósito
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>Nuevo depósito</DialogTitle></DialogHeader>
              <div className="space-y-3 py-2">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Nombre *</Label>
                    <Input value={whForm.name} onChange={e => setWhForm(f => ({ ...f, name: e.target.value }))} placeholder="Depósito Central" />
                  </div>
                  <div className="space-y-1">
                    <Label>Código</Label>
                    <Input value={whForm.code} onChange={e => setWhForm(f => ({ ...f, code: e.target.value }))} placeholder="DEP-01" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Dirección</Label>
                  <Input value={whForm.address} onChange={e => setWhForm(f => ({ ...f, address: e.target.value }))} placeholder="Calle, número..." />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label>Responsable</Label>
                    <Input value={whForm.manager} onChange={e => setWhForm(f => ({ ...f, manager: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Teléfono</Label>
                    <Input value={whForm.phone} onChange={e => setWhForm(f => ({ ...f, phone: e.target.value }))} />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={whForm.is_default} onChange={e => setWhForm(f => ({ ...f, is_default: e.target.checked }))} className="rounded" />
                  Depósito predeterminado
                </label>
                <Button className="w-full" onClick={saveWarehouse} disabled={savingWh}>
                  {savingWh ? "Guardando..." : "Crear depósito"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Depósitos" value={kpis.totalWarehouses} icon={Warehouse} color="primary" />
        <KPICard label="Zonas" value={kpis.totalZones} icon={MapPin} color="purple" />
        <KPICard label="Posiciones" value={kpis.totalBins} icon={Package} color="blue" />
        <KPICard label="Productos ubicados" value={kpis.totalProducts} icon={Package} color="success" sub="Productos con stock asignado" />
      </div>

      {/* Tree view */}
      {warehouses.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Warehouse className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>No hay depósitos configurados</p>
        </div>
      ) : (
        <div className="space-y-3">
          {warehouses.map(wh => {
            const whZones = zones.filter(z => z.location_id === wh.id);
            const whBins = bins.filter(b => b.location_id === wh.id);
            const whStockTotal = binStock.filter(bs => whBins.some(b => b.id === bs.bin_id)).reduce((s, bs) => s + Number(bs.quantity), 0);
            const isWhExpanded = expandedWh === wh.id;

            return (
              <Card key={wh.id} className="overflow-hidden">
                <CardContent className="p-0">
                  {/* Warehouse header */}
                  <div className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/40" onClick={() => setExpandedWh(isWhExpanded ? null : wh.id)}>
                    {isWhExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                    <Warehouse className="w-5 h-5 text-blue-500" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">{wh.name}</span>
                        {wh.code && <span className="text-xs text-muted-foreground font-mono">({wh.code})</span>}
                        {wh.is_main && <Badge className="text-xs bg-yellow-500/20 text-yellow-500"><Star className="w-2.5 h-2.5 inline mr-0.5" />Predeterminado</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {whZones.length} zonas · {whBins.length} posiciones · {whStockTotal.toLocaleString("es-AR")} u. en stock
                        {wh.address && ` · ${wh.address}`}
                      </p>
                    </div>
                    {!wh.is_main && (
                      <Button size="sm" variant="ghost" className="h-6 text-xs shrink-0" onClick={e => { e.stopPropagation(); setDefault(wh.id); }}>
                        Predeterminado
                      </Button>
                    )}
                  </div>

                  {/* Zones */}
                  {isWhExpanded && (
                    <div className="border-t">
                      {whZones.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">Sin zonas — creá una zona primero</p>
                      ) : whZones.map(zone => {
                        const zoneBins = bins.filter(b => b.zone_id === zone.id);
                        const zoneStock = binStock.filter(bs => zoneBins.some(b => b.id === bs.bin_id)).reduce((s, bs) => s + Number(bs.quantity), 0);
                        const isZoneExp = expandedZone === zone.id;
                        const ztc = ZONE_TYPE_CFG[zone.zone_type] ?? ZONE_TYPE_CFG.general;

                        return (
                          <div key={zone.id} className="border-t">
                            <div className="flex items-center gap-3 px-8 py-3 cursor-pointer hover:bg-muted/40" onClick={() => setExpandedZone(isZoneExp ? null : zone.id)}>
                              {isZoneExp ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />}
                              <MapPin className="w-4 h-4 text-purple-500" />
                              <span className="font-medium text-foreground text-sm">{zone.name}</span>
                              <Badge className={`text-xs ${ztc.color}`}>{ztc.label}</Badge>
                              <span className="text-xs text-muted-foreground ml-auto">{zoneBins.length} posiciones · {zoneStock.toLocaleString("es-AR")} u.</span>
                            </div>

                            {/* Bins */}
                            {isZoneExp && (
                              <div className="border-t bg-muted/20">
                                {zoneBins.length === 0 ? (
                                  <p className="text-xs text-muted-foreground text-center py-3">Sin posiciones</p>
                                ) : (
                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 p-4">
                                    {zoneBins.map(bin => {
                                      const binProducts = binStock.filter(bs => bs.bin_id === bin.id);
                                      const isBinExp = expandedBin === bin.id;
                                      const totalQty = binProducts.reduce((s, bs) => s + Number(bs.quantity), 0);

                                      return (
                                        <div key={bin.id} className="bg-card border rounded-lg p-3">
                                          <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpandedBin(isBinExp ? null : bin.id)}>
                                            <div className="flex items-center gap-2">
                                              <Package className="w-3.5 h-3.5 text-muted-foreground" />
                                              <span className="font-mono text-sm font-semibold text-foreground">{bin.code}</span>
                                              {totalQty > 0 && <Badge variant="outline" className="text-xs px-1 py-0">{totalQty.toLocaleString("es-AR")}</Badge>}
                                            </div>
                                            <div className="flex items-center gap-1">
                                              <button className="text-blue-500 hover:text-blue-400" onClick={e => { e.stopPropagation(); setStockBinId(bin.id); setStockOpen(true); }}>
                                                <Plus className="w-3.5 h-3.5" />
                                              </button>
                                              {isBinExp ? <ChevronDown className="w-3 h-3 text-muted-foreground" /> : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                                            </div>
                                          </div>
                                          {isBinExp && binProducts.length > 0 && (
                                            <div className="mt-2 pt-2 border-t space-y-1">
                                              {binProducts.map(bs => (
                                                <div key={bs.id} className="flex justify-between text-xs text-muted-foreground">
                                                  <span className="truncate">{bs.products?.name ?? "—"}</span>
                                                  <span className="font-semibold ml-2 text-foreground">{Number(bs.quantity).toLocaleString("es-AR")}</span>
                                                </div>
                                              ))}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Stock assignment dialog */}
      <Dialog open={stockOpen} onOpenChange={setStockOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Asignar stock a posición</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">Posición: <strong className="text-foreground">{bins.find(b => b.id === stockBinId)?.code ?? "—"}</strong></p>
            <div className="space-y-1">
              <Label>Producto *</Label>
              <Select value={stockProductId} onValueChange={setStockProductId}>
                <SelectTrigger><SelectValue placeholder="Buscar producto" /></SelectTrigger>
                <SelectContent>
                  {stockProducts.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Cantidad</Label>
              <Input type="number" min={0} value={stockQty} onChange={e => setStockQty(Number(e.target.value))} />
            </div>
            <Button className="w-full" onClick={saveStock} disabled={savingStock}>
              {savingStock ? "Guardando..." : "Actualizar stock"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
