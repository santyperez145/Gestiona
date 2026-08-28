// Vista «Reposición» del workspace de Planificación de inventario.
//
// ⚠️ Era una página propia (/restock) hasta la consolidación 2026-08-27.
// El contenido es idéntico — PageHeader y acciones incluidas — porque este
// paso mueve superficies, no reescribe cálculos: unificar los tres motores
// en una autoridad server-side es INV-001, y va aparte a propósito.
import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { formatARS } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import KPICard from "@/components/shared/KPICard";
import { Slider } from "@/components/ui/slider";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  RefreshCw, ShoppingCart, TrendingUp, AlertTriangle,
  CheckCircle2, Clock, PackageOpen, Loader2, Download,
  ChevronDown, ChevronUp,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";

import { plural } from "@/lib/plural";
// ─── Types ───────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  name: string;
  category: string;
  stock: number;
  cost_usd: number;
  supplier_id: string | null;
}

interface SaleRow {
  product_id: string;
  quantity: number;
  date: string;
}

interface Supplier {
  id: string;
  name: string;
}

interface RestockItem {
  product: Product;
  soldLast30: number;
  soldLast7: number;
  dailyVelocity: number;
  daysUntilStockout: number;
  suggestedQty: number;
  estimatedCostUSD: number;
  supplierId: string | null;
  supplierName: string;
  override: number | null; // manual override for qty
  eoq: number;             // Economic Order Quantity
  rop: number;             // Reorder Point
  safetyStock: number;     // Safety Stock buffer
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function urgencyColor(days: number) {
  if (days <= 3) return "text-red-400 bg-red-950/40 border-red-800";
  if (days <= 7) return "text-orange-400 bg-orange-950/40 border-orange-800";
  if (days <= 14) return "text-yellow-400 bg-yellow-950/40 border-yellow-800";
  return "text-emerald-400 bg-emerald-950/40 border-emerald-800";
}

function urgencyLabel(days: number) {
  if (days <= 3) return "Crítico";
  if (days <= 7) return "Urgente";
  if (days <= 14) return "Pronto";
  return "Planificado";
}

function suggestQty(dailyVelocity: number, currentStock: number, targetDays = 30): number {
  if (dailyVelocity <= 0) return 0;
  const needed = Math.ceil(dailyVelocity * targetDays);
  return Math.max(needed - currentStock, 1);
}

// ⚠️ Acá vivían calcEOQ, calcSafetyStock y calcROP: la segunda implementación
// de las mismas fórmulas que ya calculaba `run_abc_analysis` en el servidor,
// con peores datos (Z aproximado 1.5, lead time fijo 7). Se fueron con
// INV-001: la autoridad es el motor, y esta vista sólo muestra.

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ReposicionView() {
  const { user } = useAuth();
  const { activeOrg } = useOrg();

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<RestockItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [targetDays, setTargetDays] = useState(30);
  const [thresholdDays, setThresholdDays] = useState(14);
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderSupplier, setOrderSupplier] = useState<string>("__all__");
  const [savingOrder, setSavingOrder] = useState(false);
  const [sortKey, setSortKey] = useState<"daysUntilStockout" | "soldLast30" | "dailyVelocity">("daysUntilStockout");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  // ── Load data ──────────────────────────────────────────────────────────────

  const load = async () => {
    if (!user || !activeOrg) return;
    setLoading(true);
    try {
      const since7 = new Date();
      since7.setDate(since7.getDate() - 7);

      // ── El motor primero: run_abc_analysis es LA autoridad de velocidad,
      //    safety stock, punto de reposición y EOQ (INV-001). Hasta 2026-08-27
      //    esta vista calculaba los cuatro en el navegador con
      //    `SS = 1.5 × velocidad × √7` — Z aproximado a ojo y lead time FIJO en
      //    7 días, ignorando el `lead_time_days` del producto. El mismo
      //    producto tenía un colchón acá y otro en Análisis ABC.
      //
      //    El error no se traga: sin análisis no se muestran números viejos
      //    como si fueran de hoy.
      const motor = await supabase.rpc("run_abc_analysis", {
        p_org_id: activeOrg.id, p_period_days: 30,
      });
      if (motor.error) {
        console.error("no se pudo correr el análisis de inventario", motor.error.message);
        toast.error("No se pudo calcular la reposición");
        setLoading(false);
        return;
      }

      const hoy = new Date().toISOString().slice(0, 10);
      const [{ data: products }, abcRes, { data: sales7 }, { data: suppData }] = await Promise.all([
        supabase.from("products").select("id,name,category,stock,cost_usd,supplier_id").eq("org_id", activeOrg.id).order("name"),
        supabase.from("inventory_abc")
          .select("product_id,total_units,days_on_hand,safety_stock,reorder_point,eoq")
          .eq("org_id", activeOrg.id).eq("analysis_date", hoy).eq("period_days", 30),
        // Los últimos 7 días son una columna informativa, no un cálculo: se
        // leen crudos.
        supabase.from("sales").select("product_id,quantity").eq("org_id", activeOrg.id).gte("date", since7.toISOString()),
        supabase.from("suppliers").select("id,name").eq("org_id", activeOrg.id).order("name"),
      ]);
      if (abcRes.error) {
        console.error("no se pudo leer el análisis de inventario", abcRes.error.message);
        toast.error("No se pudo leer la reposición");
        setLoading(false);
        return;
      }

      const supplierList: Supplier[] = suppData || [];
      setSuppliers(supplierList);
      const supplierMap: Record<string, string> = {};
      supplierList.forEach(s => { supplierMap[s.id] = s.name; });

      // El agregado de 30 días viene del motor; el de 7, crudo para mostrar.
      const porProducto: Record<string, { units: number; days: number | null; ss: number | null; rop: number | null; eoq: number | null }> = {};
      (abcRes.data ?? []).forEach((r: any) => {
        porProducto[r.product_id] = {
          units: Number(r.total_units) || 0,
          days: r.days_on_hand === null ? null : Number(r.days_on_hand),
          ss: r.safety_stock === null ? null : Number(r.safety_stock),
          rop: r.reorder_point === null ? null : Number(r.reorder_point),
          eoq: r.eoq === null ? null : Number(r.eoq),
        };
      });
      const aggLast7: Record<string, number> = {};
      ((sales7 || []) as SaleRow[]).forEach(s => {
        if (!s.product_id) return;
        aggLast7[s.product_id] = (aggLast7[s.product_id] || 0) + s.quantity;
      });

      const restockItems: RestockItem[] = (products || [])
        .filter((p: Product) => {
          const sold30 = porProducto[p.id]?.units || 0;
          if (sold30 === 0 && p.stock > 50) return false; // skip dead stock with plenty
          return true;
        })
        .map((p: Product) => {
          const abc = porProducto[p.id];
          const sold30 = abc?.units || 0;
          const sold7 = aggLast7[p.id] || 0;
          const daily = sold30 / 30;
          // La cobertura la calcula el motor. 999 conserva el centinela viejo
          // de "alcanza para siempre" que el filtro y el orden ya esperan.
          const daysOut = abc?.days ?? (daily > 0 ? Math.floor(p.stock / daily) : 999);
          const qty = suggestQty(daily, p.stock, targetDays);
          // NULL del motor = "no calculable con honestidad" (sin lead time,
          // sin 3 meses de historia, sin costos). El render ya trata 0 como
          // ausencia, así que 0 lo muestra como "—" en vez de inventar.
          const eoq = abc?.eoq ?? 0;
          const rop = abc?.rop ?? 0;
          const ss  = abc?.ss ?? 0;
          return {
            product: p,
            soldLast30: sold30,
            soldLast7: sold7,
            dailyVelocity: daily,
            daysUntilStockout: daysOut,
            suggestedQty: qty,
            estimatedCostUSD: qty * (p.cost_usd || 0),
            supplierId: p.supplier_id,
            supplierName: p.supplier_id ? (supplierMap[p.supplier_id] || "Sin proveedor") : "Sin proveedor",
            override: null,
            eoq,
            rop,
            safetyStock: ss,
          };
        })
        .filter(i => i.daysUntilStockout <= thresholdDays || i.soldLast30 > 0);

      setItems(restockItems);
    } catch (e) {
      toast.error("Error al cargar datos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [user, activeOrg]);

  // ── Re-compute suggestions when targetDays changes ─────────────────────────

  useEffect(() => {
    setItems(prev => prev.map(i => {
      const qty = suggestQty(i.dailyVelocity, i.product.stock, targetDays);
      return {
        ...i,
        suggestedQty: qty,
        estimatedCostUSD: qty * (i.product.cost_usd || 0),
        override: null,
      };
    }));
    setOverrides({});
  }, [targetDays]);

  // ── Filtered + sorted list ─────────────────────────────────────────────────

  const filtered = useMemo(() => {
    return [...items]
      .filter(i => i.daysUntilStockout <= thresholdDays)
      .sort((a, b) => {
        const av = a[sortKey], bv = b[sortKey];
        return sortDir === "asc" ? av - bv : bv - av;
      });
  }, [items, thresholdDays, sortKey, sortDir]);

  const bySupplier = useMemo(() => {
    const map: Record<string, RestockItem[]> = {};
    filtered.forEach(i => {
      const k = i.supplierName;
      if (!map[k]) map[k] = [];
      map[k].push(i);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b, "es"));
  }, [filtered]);

  const totalCostUSD = useMemo(() => {
    return filtered.reduce((sum, i) => {
      const qty = overrides[i.product.id] ?? i.suggestedQty;
      return sum + qty * (i.product.cost_usd || 0);
    }, 0);
  }, [filtered, overrides]);

  // ── Order draft save ───────────────────────────────────────────────────────

  const itemsForOrder = useMemo(() => {
    return filtered.filter(i =>
      orderSupplier === "__all__" || i.supplierName === orderSupplier
    );
  }, [filtered, orderSupplier]);

  const handleSaveOrder = async () => {
    if (!user || !activeOrg) return;
    setSavingOrder(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const supplierLabel = orderSupplier === "__all__" ? "Múltiples proveedores" : orderSupplier;
      const suppId = orderSupplier !== "__all__" && suppliers.find(s => s.name === orderSupplier)?.id;

      for (const item of itemsForOrder) {
        const qty = overrides[item.product.id] ?? item.suggestedQty;
        if (qty <= 0) continue;
        await supabase.from("purchases").insert({
          org_id: activeOrg.id,
          user_id: user.id,
          product_id: item.product.id,
          product_name: item.product.name,
          quantity: qty,
          cost_usd: item.product.cost_usd || 0,
          total_cost_usd: qty * (item.product.cost_usd || 0),
          date: today,
          supplier_id: suppId || item.product.supplier_id || null,
          supplier_name: supplierLabel,
          is_scheduled: true,
          notes: "Generado por Auto-Restock",
        });
      }
      toast.success(`Borrador de compra creado (${plural(itemsForOrder.length, "producto")})`);
      setOrderOpen(false);
    } catch {
      toast.error("Error al guardar borrador");
    } finally {
      setSavingOrder(false);
    }
  };

  // ── CSV export ─────────────────────────────────────────────────────────────

  const exportCSV = () => {
    const header = "Producto,Proveedor,Stock actual,Vendidos 30d,Vel. diaria,Días restantes,Cantidad sugerida,Costo USD";
    const rows = filtered.map(i => {
      const qty = overrides[i.product.id] ?? i.suggestedQty;
      return [
        i.product.name,
        i.supplierName,
        i.product.stock,
        i.soldLast30,
        i.dailyVelocity.toFixed(2),
        i.daysUntilStockout === 999 ? "Sin ventas" : i.daysUntilStockout,
        qty,
        (qty * (i.product.cost_usd || 0)).toFixed(2),
      ].join(",");
    });
    const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "restock.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Sort toggle ────────────────────────────────────────────────────────────

  const toggleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };

  const SortIcon = ({ k }: { k: typeof sortKey }) =>
    sortKey === k ? (sortDir === "asc" ? <ChevronUp className="w-3 h-3 inline" /> : <ChevronDown className="w-3 h-3 inline" />) : null;

  // ─── KPI cards ──────────────────────────────────────────────────────────────

  const criticalCount = filtered.filter(i => i.daysUntilStockout <= 3).length;
  const urgentCount = filtered.filter(i => i.daysUntilStockout > 3 && i.daysUntilStockout <= 7).length;

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <PageHeader
        icon={PackageOpen}
        title="Auto-Restock Inteligente"
        description="Sugerencias de reposición basadas en velocidad de venta. Aprobá con un clic."
      />

      {/* Controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
        <div className="space-y-1 pb-12">
          <Label className="text-xs text-muted-foreground">
            Mostrar productos con &lt; <strong>{thresholdDays} días</strong> de stock
          </Label>
          <Slider
            min={3} max={60} step={1}
            value={[thresholdDays]}
            onValueChange={([v]) => setThresholdDays(v)}
            className="w-full"
          />
        </div>
        <div className="space-y-1 pb-12">
          <Label className="text-xs text-muted-foreground">
            Reponer para <strong>{targetDays} días</strong> de stock
          </Label>
          <Slider
            min={7} max={90} step={1}
            value={[targetDays]}
            onValueChange={([v]) => setTargetDays(v)}
            className="w-full"
          />
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={filtered.length === 0}>
            <Download className="w-4 h-4 mr-2" />
            CSV
          </Button>
          <Button size="sm" onClick={() => setOrderOpen(true)} disabled={filtered.length === 0}>
            <ShoppingCart className="w-4 h-4 mr-2" />
            Crear borrador
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      {!loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KPICard label="Críticos (≤3d)" value={criticalCount} icon={AlertTriangle} color="destructive" sub="quiebre inminente" />
          <KPICard label="Urgentes (4–7d)" value={urgentCount} icon={Clock} color="warning" sub="atención pronto" />
          <KPICard label="Total a reponer" value={filtered.length} icon={TrendingUp} color="primary" sub={`umbral: ${thresholdDays}d`} />
          <KPICard label="Inversión estimada" value={`$${totalCostUSD.toFixed(0)} USD`} icon={ShoppingCart} color="blue" sub="costo total sugerido" />
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" /> Analizando velocidad de ventas...
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
          <CheckCircle2 className="w-10 h-10 text-emerald-400" />
          <p className="font-medium text-foreground">Todo en orden</p>
          <p className="text-sm">No hay productos con menos de {thresholdDays} días de stock.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Producto</TableHead>
                <TableHead>Proveedor</TableHead>
                <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort("soldLast30")}>
                  Vendidos 30d <SortIcon k="soldLast30" />
                </TableHead>
                <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort("dailyVelocity")}>
                  Vel. diaria <SortIcon k="dailyVelocity" />
                </TableHead>
                <TableHead className="text-center cursor-pointer select-none" onClick={() => toggleSort("daysUntilStockout")}>
                  Días stock <SortIcon k="daysUntilStockout" />
                </TableHead>
                <TableHead className="text-right">Sugerido</TableHead>
                <TableHead className="text-right hidden lg:table-cell" title="Economic Order Quantity — cantidad óptima por pedido (Wilson)">EOQ</TableHead>
                <TableHead className="text-right hidden lg:table-cell" title="Reorder Point — stock al que debés pedir">ROP</TableHead>
                <TableHead className="text-right">Costo USD</TableHead>
                <TableHead className="text-center">Urgencia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(item => {
                const qty = overrides[item.product.id] ?? item.suggestedQty;
                const cost = qty * (item.product.cost_usd || 0);
                return (
                  <TableRow key={item.product.id} className="group">
                    <TableCell>
                      <div className="font-medium text-sm">{item.product.name}</div>
                      <div className="text-xs text-muted-foreground">Stock: {item.product.stock}</div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{item.supplierName}</TableCell>
                    <TableCell className="text-right text-sm">
                      {item.soldLast30}
                      {item.soldLast7 > 0 && (
                        <div className="text-xs text-muted-foreground">{item.soldLast7} esta semana</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm">{item.dailyVelocity.toFixed(1)}/d</TableCell>
                    <TableCell className="text-center">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${urgencyColor(item.daysUntilStockout)}`}>
                        {item.daysUntilStockout === 999 ? "Sin ventas" : `${item.daysUntilStockout}d`}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min={0}
                        value={qty}
                        onChange={e => {
                          const v = parseInt(e.target.value) || 0;
                          setOverrides(prev => ({ ...prev, [item.product.id]: v }));
                        }}
                        className="w-20 h-7 text-right text-sm ml-auto"
                      />
                    </TableCell>
                    <TableCell className="text-right text-xs hidden lg:table-cell" title={`EOQ: ${item.eoq}u (pedido óptimo)`}>
                      {item.eoq > 0 ? (
                        <span className="text-blue-400 font-mono">{item.eoq}u</span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right text-xs hidden lg:table-cell" title={`ROP: pedir cuando el stock llegue a ${item.rop}u · SS: ${item.safetyStock}u`}>
                      {item.rop > 0 ? (
                        <div>
                          <span className={`font-mono ${item.product.stock <= item.rop ? "text-orange-400 font-bold" : "text-muted-foreground"}`}>{item.rop}u</span>
                          <div className="text-[10px] text-muted-foreground">SS: {item.safetyStock}</div>
                        </div>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      ${cost.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${urgencyColor(item.daysUntilStockout)}`}>
                        {urgencyLabel(item.daysUntilStockout)}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* By supplier breakdown */}
      {!loading && bySupplier.length > 1 && (
        <div className="space-y-2 pb-12">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Por proveedor</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {bySupplier.map(([name, its]) => {
              const totalQty = its.reduce((s, i) => s + (overrides[i.product.id] ?? i.suggestedQty), 0);
              const totalUSD = its.reduce((s, i) => {
                const q = overrides[i.product.id] ?? i.suggestedQty;
                return s + q * (i.product.cost_usd || 0);
              }, 0);
              const hasCritical = its.some(i => i.daysUntilStockout <= 3);
              return (
                <Card key={name} className={`border ${hasCritical ? "border-red-800/50" : "border-border"} bg-card/60`}>
                  <CardHeader className="pb-2 pt-4 px-4">
                    <CardTitle className="text-sm font-semibold flex items-center justify-between">
                      {name}
                      {hasCritical && <AlertTriangle className="w-4 h-4 text-red-400" />}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-1">
                    <div className="text-xs text-muted-foreground">{its.length} productos · {totalQty} unidades</div>
                    <div className="font-semibold">${totalUSD.toFixed(2)} USD</div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      {its.slice(0, 4).map(i => (
                        <Badge key={i.product.id} variant="outline" className={`text-xs px-1.5 py-0 ${urgencyColor(i.daysUntilStockout)}`}>
                          {i.product.name.slice(0, 18)}
                        </Badge>
                      ))}
                      {its.length > 4 && <Badge variant="outline" className="text-xs px-1.5 py-0">+{its.length - 4} más</Badge>}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Order dialog */}
      <Dialog open={orderOpen} onOpenChange={setOrderOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Crear borrador de compra</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm">Filtrar por proveedor</Label>
              <Select value={orderSupplier} onValueChange={setOrderSupplier}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos los proveedores ({filtered.length} productos)</SelectItem>
                  {bySupplier.map(([name, its]) => (
                    <SelectItem key={name} value={name}>{name} ({its.length})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="rounded-lg border border-border p-3 space-y-1 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Productos</span><span>{itemsForOrder.length}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Unidades totales</span>
                <span>{itemsForOrder.reduce((s, i) => s + (overrides[i.product.id] ?? i.suggestedQty), 0)}</span>
              </div>
              <div className="flex justify-between font-semibold border-t border-border pt-1 mt-1">
                <span>Inversión estimada</span>
                <span>${itemsForOrder.reduce((s, i) => {
                  const q = overrides[i.product.id] ?? i.suggestedQty;
                  return s + q * (i.product.cost_usd || 0);
                }, 0).toFixed(2)} USD</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Se crean compras en estado <strong>programado</strong> (no afectan el stock hasta que sean marcadas como recibidas en Compras).
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOrderOpen(false)}>Cancelar</Button>
            <Button onClick={handleSaveOrder} disabled={savingOrder || itemsForOrder.length === 0}>
              {savingOrder ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShoppingCart className="w-4 h-4 mr-2" />}
              Crear borrador
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
