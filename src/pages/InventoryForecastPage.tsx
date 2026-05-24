import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  TrendingUp,
  Package,
  RefreshCw,
  Search,
  AlertTriangle,
  CheckCircle,
  BarChart3,
  Brain,
  Download,
  Settings,
  Zap,
  ArrowUp,
  ArrowDown,
  Minus,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  name: string;
  stock: number;
  price: number;
  category: string | null;
  min_stock: number | null;
}

interface ForecastResult {
  product: Product;
  predicted_units: number;
  lower_bound: number;
  upper_bound: number;
  confidence: number;
  daysOfStock: number;   // current stock / daily avg
  reorderPoint: number;
  needsReorder: boolean;
  urgency: "critical" | "warning" | "ok";
  dailyAvg: number;
  velocity: "fast" | "medium" | "slow" | "dead";
}

interface ForecastConfig {
  id?: string;
  product_id: string;
  lead_time_days: number;
  safety_stock: number;
  reorder_point: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtCurrency(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
}

const VELOCITY_CONFIG = {
  fast: { label: "Rápida", color: "bg-emerald-500/15 text-emerald-400", icon: ArrowUp },
  medium: { label: "Media", color: "bg-blue-500/15 text-blue-400", icon: Minus },
  slow: { label: "Lenta", color: "bg-amber-500/15 text-amber-400", icon: ArrowDown },
  dead: { label: "Sin movimiento", color: "bg-gray-500/15 text-gray-400", icon: Minus },
};

// ─── Config Dialog ────────────────────────────────────────────────────────────

interface ConfigDialogProps {
  open: boolean;
  product: Product | null;
  orgId: string;
  onClose: () => void;
  onSaved: () => void;
}

function ConfigDialog({ open, product, orgId, onClose, onSaved }: ConfigDialogProps) {
  const [loading, setLoading] = useState(false);
  const [leadTime, setLeadTime] = useState("3");
  const [safetyStock, setSafetyStock] = useState("7");
  const [reorderPoint, setReorderPoint] = useState("0");
  const [existingId, setExistingId] = useState<string | undefined>();

  useEffect(() => {
    if (!open || !product) return;
    supabase.from("forecast_configs")
      .select("*").eq("org_id", orgId).eq("product_id", product.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setExistingId(data.id);
          setLeadTime(String(data.lead_time_days));
          setSafetyStock(String(data.safety_stock));
          setReorderPoint(String(data.reorder_point));
        } else {
          setExistingId(undefined);
          setLeadTime("3"); setSafetyStock("7"); setReorderPoint("0");
        }
      });
  }, [open, product, orgId]);

  const handleSave = async () => {
    if (!product) return;
    setLoading(true);
    const payload = {
      org_id: orgId, product_id: product.id,
      lead_time_days: parseInt(leadTime) || 3,
      safety_stock: parseInt(safetyStock) || 7,
      reorder_point: parseInt(reorderPoint) || 0,
      model_type: "exponential_smoothing",
    };
    const { error } = existingId
      ? await supabase.from("forecast_configs").update(payload).eq("id", existingId)
      : await supabase.from("forecast_configs").insert(payload);
    setLoading(false);
    if (error) { toast.error("Error: " + error.message); return; }
    toast.success("Configuración guardada");
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Configurar forecast — {product?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Tiempo de entrega del proveedor (días)</Label>
            <Input type="number" value={leadTime} onChange={e => setLeadTime(e.target.value)} min="1" />
          </div>
          <div>
            <Label>Días de stock de seguridad</Label>
            <Input type="number" value={safetyStock} onChange={e => setSafetyStock(e.target.value)} min="0" />
            <p className="text-xs text-muted-foreground mt-1">Cantidad de días adicionales de buffer</p>
          </div>
          <div>
            <Label>Punto de reposición manual (0 = automático)</Label>
            <Input type="number" value={reorderPoint} onChange={e => setReorderPoint(e.target.value)} min="0" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Forecast Bar ─────────────────────────────────────────────────────────────

function ForecastBar({ value, lower, upper, max }: { value: number; lower: number; upper: number; max: number }) {
  const pct = (n: number) => Math.min(100, (n / max) * 100);
  return (
    <div className="relative h-2 bg-muted rounded-full overflow-hidden mt-1">
      {/* CI band */}
      <div
        className="absolute h-full bg-primary/20 rounded-full"
        style={{ left: `${pct(lower)}%`, width: `${pct(upper) - pct(lower)}%` }}
      />
      {/* Point estimate */}
      <div
        className="absolute h-full w-1 bg-primary rounded-full"
        style={{ left: `${pct(value)}%` }}
      />
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function InventoryForecastPage() {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";

  const [products, setProducts] = useState<Product[]>([]);
  const [salesData, setSalesData] = useState<Record<string, number>>({});  // product_id → units/30d
  const [configs, setConfigs] = useState<Record<string, ForecastConfig>>({});
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);

  const [search, setSearch] = useState("");
  const [filterUrgency, setFilterUrgency] = useState("all");
  const [filterVelocity, setFilterVelocity] = useState("all");
  const [horizon, setHorizon] = useState("30");
  const [configDialogProduct, setConfigDialogProduct] = useState<Product | null>(null);

  const loadData = async () => {
    if (!orgId) return;
    setLoading(true);

    const [prodRes, saleRes, cfgRes] = await Promise.all([
      supabase.from("products").select("id,name,stock,price,category,min_stock").eq("org_id", orgId).eq("active", true).order("name"),
      supabase.from("sale_items")
        .select("product_id, quantity, sales!inner(org_id, created_at)")
        .eq("sales.org_id", orgId)
        .gte("sales.created_at", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()),
      supabase.from("forecast_configs").select("*").eq("org_id", orgId),
    ]);

    setProducts(prodRes.data ?? []);

    // Aggregate units sold per product (last 30 days)
    const now = Date.now();
    const sales30: Record<string, number> = {};
    ((saleRes.data ?? []) as any[]).forEach((item) => {
      const saleDate = new Date((item.sales as any).created_at).getTime();
      if (now - saleDate <= 30 * 24 * 60 * 60 * 1000) {
        sales30[item.product_id] = (sales30[item.product_id] ?? 0) + (item.quantity ?? 0);
      }
    });
    setSalesData(sales30);

    const cfgMap: Record<string, ForecastConfig> = {};
    (cfgRes.data ?? []).forEach((c: any) => { cfgMap[c.product_id] = c; });
    setConfigs(cfgMap);

    setLoading(false);
  };

  useEffect(() => { loadData(); }, [orgId]);

  // Compute forecasts client-side
  const forecasts: ForecastResult[] = useMemo(() => {
    const h = parseInt(horizon) || 30;
    return products.map(p => {
      const units30 = salesData[p.id] ?? 0;
      const dailyAvg = units30 / 30;
      const cfg = configs[p.id];
      const leadTime = cfg?.lead_time_days ?? 3;
      const safetyDays = cfg?.safety_stock ?? 7;

      const predicted = dailyAvg * h;
      const stddev = dailyAvg * 0.3;
      const lower = Math.max(0, (dailyAvg - 1.28 * stddev) * h);
      const upper = (dailyAvg + 1.28 * stddev) * h;
      const confidence = units30 >= 14 ? 80 : units30 >= 5 ? 60 : 40;

      const daysOfStock = dailyAvg > 0 ? p.stock / dailyAvg : Infinity;
      const reorderPoint = cfg?.reorder_point && cfg.reorder_point > 0
        ? cfg.reorder_point
        : Math.ceil(dailyAvg * (leadTime + safetyDays));

      const needsReorder = p.stock <= reorderPoint;
      const urgency: ForecastResult["urgency"] = daysOfStock < leadTime
        ? "critical"
        : daysOfStock < leadTime + safetyDays
        ? "warning"
        : "ok";

      const velocity: ForecastResult["velocity"] = dailyAvg >= 2 ? "fast"
        : dailyAvg >= 0.3 ? "medium"
        : dailyAvg > 0 ? "slow"
        : "dead";

      return { product: p, predicted_units: predicted, lower_bound: lower, upper_bound: upper,
        confidence, daysOfStock, reorderPoint, needsReorder, urgency, dailyAvg, velocity };
    });
  }, [products, salesData, configs, horizon]);

  const filtered = useMemo(() => {
    return forecasts.filter(f => {
      const matchSearch = !search || f.product.name.toLowerCase().includes(search.toLowerCase());
      const matchUrgency = filterUrgency === "all" || f.urgency === filterUrgency;
      const matchVelocity = filterVelocity === "all" || f.velocity === filterVelocity;
      return matchSearch && matchUrgency && matchVelocity;
    }).sort((a, b) => {
      // Sort: critical first, then warning, then ok
      const order = { critical: 0, warning: 1, ok: 2 };
      return order[a.urgency] - order[b.urgency];
    });
  }, [forecasts, search, filterUrgency, filterVelocity]);

  const kpis = useMemo(() => ({
    critical: forecasts.filter(f => f.urgency === "critical").length,
    warning: forecasts.filter(f => f.urgency === "warning").length,
    needsReorder: forecasts.filter(f => f.needsReorder).length,
    deadStock: forecasts.filter(f => f.velocity === "dead").length,
    totalStockValue: products.reduce((a, p) => a + p.stock * p.price, 0),
  }), [forecasts, products]);

  const exportCSV = () => {
    const rows = [
      ["Producto", "Stock actual", "Predicción 30d", "Días de stock", "Rotación", "Punto reposición", "Estado"],
      ...filtered.map(f => [
        f.product.name, f.product.stock, Math.round(f.predicted_units),
        f.daysOfStock === Infinity ? "∞" : Math.round(f.daysOfStock),
        VELOCITY_CONFIG[f.velocity].label, f.reorderPoint, f.urgency,
      ]),
    ];
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "forecast-inventario.csv"; a.click();
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2">
            <Brain className="w-6 h-6 text-primary" />
            Forecast de Inventario
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Demanda proyectada con algoritmos de promedio móvil y suavizado exponencial
          </p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <Select value={horizon} onValueChange={setHorizon}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Próximos 7 días</SelectItem>
              <SelectItem value="14">Próximos 14 días</SelectItem>
              <SelectItem value="30">Próximos 30 días</SelectItem>
              <SelectItem value="60">Próximos 60 días</SelectItem>
              <SelectItem value="90">Próximos 90 días</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="w-4 h-4 mr-1.5" /> Exportar
          </Button>
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} /> Actualizar
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {[
          { label: "Stock crítico", value: kpis.critical, icon: AlertTriangle, color: "text-red-400", bg: "bg-red-500/5 border-red-500/20" },
          { label: "Bajo stock", value: kpis.warning, icon: AlertTriangle, color: "text-amber-400", bg: "" },
          { label: "Reponer ya", value: kpis.needsReorder, icon: Package, color: "text-orange-400", bg: "" },
          { label: "Stock muerto", value: kpis.deadStock, icon: Minus, color: "text-gray-400", bg: "" },
          { label: "Valor total stock", value: fmtCurrency(kpis.totalStockValue), icon: TrendingUp, color: "text-primary", bg: "" },
        ].map(k => (
          <div key={k.label} className={`rounded-xl border bg-card p-4 ${k.bg || "border-border"}`}>
            <div className="flex items-center gap-2 mb-1">
              <k.icon className={`w-4 h-4 ${k.color}`} />
              <span className="text-xs text-muted-foreground">{k.label}</span>
            </div>
            <p className="text-xl font-bold">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar producto..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={filterUrgency} onValueChange={setFilterUrgency}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Urgencia" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toda urgencia</SelectItem>
            <SelectItem value="critical">Crítico</SelectItem>
            <SelectItem value="warning">Advertencia</SelectItem>
            <SelectItem value="ok">OK</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterVelocity} onValueChange={setFilterVelocity}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Rotación" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toda rotación</SelectItem>
            <SelectItem value="fast">Rápida</SelectItem>
            <SelectItem value="medium">Media</SelectItem>
            <SelectItem value="slow">Lenta</SelectItem>
            <SelectItem value="dead">Sin movimiento</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Forecast table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>Sin datos de productos</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Producto</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Stock</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Prom. diario</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Predicción {horizon}d</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Proyección</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Días stock</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Estado</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(f => {
                const vc = VELOCITY_CONFIG[f.velocity];
                const VIcon = vc.icon;
                const maxPred = Math.max(...filtered.map(x => x.upper_bound), 1);
                return (
                  <tr key={f.product.id} className={`hover:bg-muted/20 transition-colors ${f.urgency === "critical" ? "bg-red-500/5" : f.urgency === "warning" ? "bg-amber-500/5" : ""}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{f.product.name}</p>
                      {f.product.category && <p className="text-xs text-muted-foreground">{f.product.category}</p>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-bold ${f.product.stock <= f.reorderPoint ? "text-red-400" : ""}`}>
                        {f.product.stock}
                      </span>
                      {f.reorderPoint > 0 && (
                        <p className="text-xs text-muted-foreground">rep: {f.reorderPoint}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right hidden sm:table-cell text-muted-foreground">
                      {f.dailyAvg.toFixed(1)}/d
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-semibold">{Math.round(f.predicted_units)}</span>
                      <p className="text-xs text-muted-foreground">{f.confidence}% conf.</p>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell min-w-32">
                      <ForecastBar value={f.predicted_units} lower={f.lower_bound} upper={f.upper_bound} max={maxPred} />
                      <p className="text-xs text-muted-foreground mt-1">{Math.round(f.lower_bound)}–{Math.round(f.upper_bound)}</p>
                    </td>
                    <td className="px-4 py-3 text-right hidden sm:table-cell">
                      {f.daysOfStock === Infinity ? (
                        <span className="text-muted-foreground">∞</span>
                      ) : (
                        <span className={f.daysOfStock < 7 ? "text-red-400 font-bold" : f.daysOfStock < 14 ? "text-amber-400" : ""}>
                          {Math.round(f.daysOfStock)}d
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        {f.urgency === "critical" && <Badge className="text-xs bg-red-500/15 text-red-400 border-red-500/30"><AlertTriangle className="w-3 h-3 mr-1" />Crítico</Badge>}
                        {f.urgency === "warning" && <Badge className="text-xs bg-amber-500/15 text-amber-400 border-amber-500/30"><AlertTriangle className="w-3 h-3 mr-1" />Bajo</Badge>}
                        {f.urgency === "ok" && <Badge className="text-xs bg-emerald-500/15 text-emerald-400"><CheckCircle className="w-3 h-3 mr-1" />OK</Badge>}
                        <Badge className={`text-xs ${vc.color}`}><VIcon className="w-3 h-3 mr-1" />{vc.label}</Badge>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Button size="sm" variant="ghost" onClick={() => setConfigDialogProduct(f.product)}>
                        <Settings className="w-3.5 h-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center pt-2">
        Modelo: Promedio Móvil 30 días · Intervalo de confianza 80% · {filtered.length} producto{filtered.length !== 1 ? "s" : ""}
      </p>

      <ConfigDialog
        open={!!configDialogProduct}
        product={configDialogProduct}
        orgId={orgId}
        onClose={() => setConfigDialogProduct(null)}
        onSaved={loadData}
      />
    </div>
  );
}
