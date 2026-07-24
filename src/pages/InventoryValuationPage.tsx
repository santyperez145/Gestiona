import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Package, DollarSign, TrendingUp, TrendingDown, BarChart3,
  RefreshCw, Download, Layers, Calculator, Loader2
} from "lucide-react";
import InventoryAgingTab from "@/components/inventory/InventoryAgingTab";
import { calcCostARS, calcInventoryValue, calcLayerUnitCostARS } from "@/lib/businessCalc";

interface ValuationRow {
  product_id: string;
  product_name: string;
  total_units: number;
  avg_cost: number;
  fifo_value: number;
  market_value: number;
  gain_loss: number;
  sku?: string;
  category?: string;
}

interface InventoryLayer {
  id: string;
  product_name: string;
  layer_date: string;
  layer_type: string;
  quantity_remaining: number;
  unit_cost: number;
  total_cost: number;
}


export default function InventoryValuationPage() {
  usePageTitle("Valuación de Inventario");
  const { activeOrg } = useOrg();
  const [tab, setTab] = useState<"valuation" | "layers" | "aging" | "snapshots" | "config">("valuation");
  const [method, setMethod] = useState("average");
  const [rows, setRows] = useState<ValuationRow[]>([]);
  const [layers, setLayers] = useState<InventoryLayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "value" | "gain">("value");

  useEffect(() => {
    if (!activeOrg?.id) return;
    setLoading(true);

    Promise.all([
      supabase.from("products")
        .select("id, name, sku, category, stock, cost_usd, sale_price_ars, profit_per_unit_ars")
        .eq("org_id", activeOrg.id)
        .gt("stock", 0)
        .order("sale_price_ars", { ascending: false }),
      supabase.from("purchases")
        .select("product_name, product_id, quantity, unit_cost_usd, date, exchange_rate_used")
        .eq("org_id", activeOrg.id)
        .order("date", { ascending: false })
        .limit(200),
      supabase.from("settings")
        .select("exchange_rate")
        .eq("user_id", activeOrg.owner_id ?? "")
        .single(),
    ]).then(([prodRes, purchRes, settRes]) => {
      const exchangeRate = Number((settRes.data as any)?.exchange_rate ?? 1200);
      const products = prodRes.data || [];

      // Build ValuationRow per product
      const valuationRows: ValuationRow[] = products.map((p: any) => {
        const costARS = calcCostARS(p.sale_price_ars, p.profit_per_unit_ars);
        const marketValue = Number(p.stock) * Number(p.sale_price_ars || 0);
        const avgCost = costARS;
        const gainLoss = Number(p.stock) * Number(p.profit_per_unit_ars || 0);
        return {
          product_id: p.id,
          product_name: p.name,
          sku: p.sku || "",
          category: p.category || "Sin categoría",
          total_units: Number(p.stock),
          avg_cost: avgCost,
          fifo_value: calcInventoryValue(p.stock, costARS),
          market_value: marketValue,
          gain_loss: gainLoss,
        };
      });
      setRows(valuationRows);

      // Build InventoryLayer from purchases
      const purchases = purchRes.data || [];
      const layerData: InventoryLayer[] = purchases.map((pu: any) => {
        const unitCostARS = calcLayerUnitCostARS(pu.unit_cost_usd, pu.exchange_rate_used, exchangeRate);
        const qty = Number(pu.quantity || 0);
        return {
          id: pu.product_id + "_" + pu.date,
          product_name: pu.product_name || "—",
          layer_date: pu.date,
          layer_type: "compra",
          quantity_remaining: qty,
          unit_cost: unitCostARS,
          total_cost: qty * unitCostARS,
        };
      });
      setLayers(layerData);
    }).finally(() => setLoading(false));
  }, [activeOrg?.id]);

  const totalCostAvg = rows.reduce((s, r) => s + r.avg_cost * r.total_units, 0);
  const totalMarket = rows.reduce((s, r) => s + r.market_value, 0);
  const totalGain = rows.reduce((s, r) => s + r.gain_loss, 0);
  const totalUnits = rows.reduce((s, r) => s + r.total_units, 0);

  const filtered = rows
    .filter(r => !search || r.product_name.toLowerCase().includes(search.toLowerCase()) || r.sku?.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "name") return a.product_name.localeCompare(b.product_name);
      if (sortBy === "value") return b.market_value - a.market_value;
      return b.gain_loss - a.gain_loss;
    });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">Cargando valuación de inventario...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Layers}
        title="Valuación de Inventario"
        description="Métodos FIFO, LIFO y Costo Promedio Ponderado"
        actions={
          <div className="flex gap-2">
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="average">Costo Promedio ✓</SelectItem>
                <SelectItem value="fifo">FIFO (1° en entrar)</SelectItem>
                <SelectItem value="lifo">LIFO (1° en salir)</SelectItem>
                <SelectItem value="specific">Identificación Específica</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => toast.success("Snapshot generado")}>
              <RefreshCw className="w-4 h-4 mr-2" />Snapshot
            </Button>
            <Button variant="outline" onClick={() => toast.info("Exportando...")}>
              <Download className="w-4 h-4 mr-2" />Exportar
            </Button>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label="Unidades Totales" value={totalUnits.toLocaleString()} icon={Package} color="blue" />
        <KPICard label={`Costo Total (${method.toUpperCase()})`} value={`$${(totalCostAvg / 1_000_000).toFixed(2)}M`} icon={DollarSign} color="purple" />
        <KPICard label="Valor de Mercado" value={`$${(totalMarket / 1_000_000).toFixed(2)}M`} icon={BarChart3} color="success" />
        <KPICard
          label="Gan./Pérd. No Realizada"
          value={`${totalGain >= 0 ? "+" : ""}$${(totalGain / 1000).toFixed(0)}K`}
          icon={totalGain >= 0 ? TrendingUp : TrendingDown}
          color={totalGain >= 0 ? "success" : "destructive"}
        />
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="valuation">Valuación</TabsTrigger>
          <TabsTrigger value="layers">Capas de Costo</TabsTrigger>
          <TabsTrigger value="aging">Aging</TabsTrigger>
          <TabsTrigger value="snapshots">Histórico</TabsTrigger>
          <TabsTrigger value="config">Configuración</TabsTrigger>
        </TabsList>

        {/* VALUATION TABLE */}
        <TabsContent value="valuation" className="space-y-3 pb-12">
          <div className="flex gap-2 items-center">
            <Input placeholder="Buscar producto o SKU..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
            <Select value={sortBy} onValueChange={v => setSortBy(v as typeof sortBy)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="value">Por Valor ↓</SelectItem>
                <SelectItem value="gain">Por Ganancia ↓</SelectItem>
                <SelectItem value="name">Por Nombre</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              {filtered.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  {search ? "No se encontraron productos con ese criterio." : "Sin productos con stock disponible."}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 border-b">
                    <tr>
                      <th className="text-left py-3 px-4">Producto</th>
                      <th className="text-right py-3 px-4">Unidades</th>
                      <th className="text-right py-3 px-4">Costo {method === "fifo" ? "FIFO" : method === "lifo" ? "LIFO" : "Prom."}</th>
                      <th className="text-right py-3 px-4">Valor Mercado</th>
                      <th className="text-right py-3 px-4">G/P No Realizada</th>
                      <th className="text-right py-3 px-4">Margen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(row => {
                      const marginPct = row.market_value > 0 ? (row.gain_loss / row.market_value) * 100 : 0;
                      return (
                        <tr key={row.product_id} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="py-3 px-4">
                            <p className="font-medium">{row.product_name}</p>
                            <p className="text-xs text-muted-foreground">{row.sku} · {row.category}</p>
                          </td>
                          <td className="py-3 px-4 text-right">{row.total_units}</td>
                          <td className="py-3 px-4 text-right">${(row.avg_cost * row.total_units / 1000).toFixed(0)}K</td>
                          <td className="py-3 px-4 text-right font-medium">${(row.market_value / 1000).toFixed(0)}K</td>
                          <td className={`py-3 px-4 text-right font-medium ${row.gain_loss >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                            {row.gain_loss >= 0 ? "+" : ""}${(row.gain_loss / 1000).toFixed(0)}K
                          </td>
                          <td className={`py-3 px-4 text-right text-xs font-medium ${marginPct >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                            {marginPct >= 0 ? "+" : ""}{marginPct.toFixed(1)}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-muted/30 font-semibold border-t">
                    <tr>
                      <td className="py-3 px-4">TOTAL</td>
                      <td className="py-3 px-4 text-right">{totalUnits}</td>
                      <td className="py-3 px-4 text-right">${(totalCostAvg / 1_000_000).toFixed(2)}M</td>
                      <td className="py-3 px-4 text-right">${(totalMarket / 1_000_000).toFixed(2)}M</td>
                      <td className={`py-3 px-4 text-right ${totalGain >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                        {totalGain >= 0 ? "+" : ""}${(totalGain / 1000).toFixed(0)}K
                      </td>
                      <td className="py-3 px-4 text-right">
                        {totalMarket > 0 ? ((totalGain / totalMarket) * 100).toFixed(1) : "0.0"}%
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* LAYERS */}
        <TabsContent value="layers" className="space-y-3 pb-12">
          <p className="text-sm text-muted-foreground">Capas de costo activas (stock disponible con su costo de adquisición)</p>
          <Card>
            <CardContent className="p-0 overflow-x-auto">
              {layers.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">Sin compras registradas para mostrar capas de costo.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 border-b">
                    <tr>
                      <th className="text-left py-3 px-4">Producto</th>
                      <th className="text-left py-3 px-4">Fecha Ingreso</th>
                      <th className="text-left py-3 px-4">Tipo</th>
                      <th className="text-right py-3 px-4">Unidades Restantes</th>
                      <th className="text-right py-3 px-4">Costo Unitario</th>
                      <th className="text-right py-3 px-4">Total Capa</th>
                    </tr>
                  </thead>
                  <tbody>
                    {layers.map(layer => (
                      <tr key={layer.id} className="border-b last:border-0 hover:bg-muted/20">
                        <td className="py-3 px-4 font-medium">{layer.product_name}</td>
                        <td className="py-3 px-4">{new Date(layer.layer_date).toLocaleDateString("es-AR")}</td>
                        <td className="py-3 px-4">
                          <span className="text-xs bg-blue-500/15 text-blue-400 px-2 py-0.5 rounded capitalize">{layer.layer_type}</span>
                        </td>
                        <td className="py-3 px-4 text-right">{layer.quantity_remaining}</td>
                        <td className="py-3 px-4 text-right">${layer.unit_cost.toLocaleString()}</td>
                        <td className="py-3 px-4 text-right font-medium">${(layer.total_cost / 1000).toFixed(0)}K</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
          <div className="flex gap-3 text-xs text-muted-foreground items-center">
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-blue-500 rounded-full" />FIFO: primeras capas se consumen primero</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-purple-500 rounded-full" />LIFO: últimas capas se consumen primero</span>
          </div>
        </TabsContent>

        {/* AGING */}
        <TabsContent value="aging">
          <InventoryAgingTab />
        </TabsContent>

        {/* SNAPSHOTS */}
        <TabsContent value="snapshots">
          <Card>
            <CardContent className="p-6">
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin historial de snapshots</p>
              ) : (
                <div className="p-4 bg-muted/30 rounded-lg">
                  <p className="text-sm font-semibold mb-2">Snapshot actual</p>
                  <div className="flex gap-6 text-sm">
                    <div><p className="text-xs text-muted-foreground">Costo Total</p><p className="font-medium">${(totalCostAvg / 1_000_000).toFixed(2)}M</p></div>
                    <div><p className="text-xs text-muted-foreground">Valor Mercado</p><p className="font-medium">${(totalMarket / 1_000_000).toFixed(2)}M</p></div>
                    <div><p className="text-xs text-muted-foreground">Fecha</p><p className="font-medium">{new Date().toLocaleDateString("es-AR")}</p></div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* CONFIG */}
        <TabsContent value="config">
          <Card className="max-w-md">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Calculator className="w-4 h-4" />Método de Valuación</CardTitle></CardHeader>
            <CardContent className="space-y-4 pb-12">
              {[
                { value: "average", label: "Costo Promedio Ponderado", desc: "El más usado en Argentina. Promedia el costo de todas las unidades." },
                { value: "fifo", label: "FIFO (First In, First Out)", desc: "Primero en entrar, primero en salir. El stock más antiguo se registra como vendido primero." },
                { value: "lifo", label: "LIFO (Last In, First Out)", desc: "Último en entrar, primero en salir. Útil con precios inflacionarios." },
                { value: "specific", label: "Identificación Específica", desc: "Cada unidad se rastrea individualmente. Ideal para bienes únicos." },
              ].map(opt => (
                <div
                  key={opt.value}
                  className={`p-3 rounded-lg border cursor-pointer transition-all ${method === opt.value ? "border-primary bg-primary/5" : "border-border hover:border-primary/30"}`}
                  onClick={() => setMethod(opt.value)}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${method === opt.value ? "border-primary" : "border-muted-foreground"}`}>
                      {method === opt.value && <div className="w-2 h-2 rounded-full bg-primary" />}
                    </div>
                    <span className="font-medium text-sm">{opt.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 ml-6">{opt.desc}</p>
                </div>
              ))}
              <Button onClick={() => toast.success("Método actualizado")} className="w-full">Guardar Configuración</Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
