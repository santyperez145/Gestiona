import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Package, DollarSign, TrendingUp, TrendingDown, BarChart3,
  RefreshCw, Download, AlertTriangle, Layers, Calculator
} from "lucide-react";

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
  const { orgId } = useOrganization();
  const [tab, setTab] = useState<"valuation" | "layers" | "snapshots" | "config">("valuation");
  const [method, setMethod] = useState("average");
  const [rows] = useState<ValuationRow[]>(MOCK_VALUATION);
  const [layers] = useState<InventoryLayer[]>(MOCK_LAYERS);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "value" | "gain">("value");

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

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Layers className="w-6 h-6 text-primary" /> Valuación de Inventario</h1>
          <p className="text-muted-foreground text-sm mt-1">Métodos FIFO, LIFO y Costo Promedio Ponderado</p>
        </div>
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
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex gap-3 items-center">
            <Package className="w-8 h-8 text-blue-500" />
            <div><p className="text-xs text-muted-foreground">Unidades Totales</p><p className="text-2xl font-bold">{totalUnits.toLocaleString()}</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex gap-3 items-center">
            <DollarSign className="w-8 h-8 text-purple-500" />
            <div><p className="text-xs text-muted-foreground">Costo Total ({method.toUpperCase()})</p><p className="text-xl font-bold">${(totalCostAvg / 1_000_000).toFixed(2)}M</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex gap-3 items-center">
            <BarChart3 className="w-8 h-8 text-green-500" />
            <div><p className="text-xs text-muted-foreground">Valor de Mercado</p><p className="text-xl font-bold">${(totalMarket / 1_000_000).toFixed(2)}M</p></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex gap-3 items-center">
            {totalGain >= 0
              ? <TrendingUp className="w-8 h-8 text-emerald-500" />
              : <TrendingDown className="w-8 h-8 text-red-500" />}
            <div>
              <p className="text-xs text-muted-foreground">Ganancia/Pérdida No Realizada</p>
              <p className={`text-xl font-bold ${totalGain >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {totalGain >= 0 ? "+" : ""}${(totalGain / 1000).toFixed(0)}K
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={v => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="valuation">Valuación</TabsTrigger>
          <TabsTrigger value="layers">Capas de Costo</TabsTrigger>
          <TabsTrigger value="snapshots">Histórico</TabsTrigger>
          <TabsTrigger value="config">Configuración</TabsTrigger>
        </TabsList>

        {/* VALUATION TABLE */}
        <TabsContent value="valuation" className="space-y-3">
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
                    <td className="py-3 px-4 text-right">{((totalGain / totalMarket) * 100).toFixed(1)}%</td>
                  </tr>
                </tfoot>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* LAYERS */}
        <TabsContent value="layers" className="space-y-3">
          <p className="text-sm text-muted-foreground">Capas de costo activas (stock disponible con su costo de adquisición)</p>
          <Card>
            <CardContent className="p-0 overflow-x-auto">
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
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded capitalize">{layer.layer_type}</span>
                      </td>
                      <td className="py-3 px-4 text-right">{layer.quantity_remaining}</td>
                      <td className="py-3 px-4 text-right">${layer.unit_cost.toLocaleString()}</td>
                      <td className="py-3 px-4 text-right font-medium">${(layer.total_cost / 1000).toFixed(0)}K</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
          <div className="flex gap-3 text-xs text-muted-foreground items-center">
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-blue-500 rounded-full" />FIFO: primeras capas se consumen primero</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-purple-500 rounded-full" />LIFO: últimas capas se consumen primero</span>
          </div>
        </TabsContent>

        {/* SNAPSHOTS */}
        <TabsContent value="snapshots">
          <Card>
            <CardContent className="p-6">
              {[
                { date: "2026-05-01", avg: 7_916_000, fifo: 7_950_000, market: 8_454_000 },
                { date: "2026-04-01", avg: 7_200_000, fifo: 7_250_000, market: 7_800_000 },
                { date: "2026-03-01", avg: 6_100_000, fifo: 6_150_000, market: 6_400_000 },
              ].map((snap, i) => (
                <div key={i} className="flex items-center gap-4 py-3 border-b last:border-0">
                  <span className="font-medium w-28">{new Date(snap.date).toLocaleDateString("es-AR", { month: "long", year: "numeric" })}</span>
                  <div className="flex gap-6 flex-1 text-sm">
                    <div><p className="text-xs text-muted-foreground">Costo Prom.</p><p className="font-medium">${(snap.avg / 1_000_000).toFixed(2)}M</p></div>
                    <div><p className="text-xs text-muted-foreground">FIFO</p><p className="font-medium">${(snap.fifo / 1_000_000).toFixed(2)}M</p></div>
                    <div><p className="text-xs text-muted-foreground">Mercado</p><p className="font-medium">${(snap.market / 1_000_000).toFixed(2)}M</p></div>
                    <div><p className="text-xs text-muted-foreground">G/P</p><p className={`font-medium ${snap.market > snap.avg ? "text-emerald-600" : "text-red-600"}`}>{snap.market > snap.avg ? "+" : ""}${((snap.market - snap.avg) / 1000).toFixed(0)}K</p></div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => toast.info("Descargando snapshot...")}>Ver</Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* CONFIG */}
        <TabsContent value="config">
          <Card className="max-w-md">
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Calculator className="w-4 h-4" />Método de Valuación</CardTitle></CardHeader>
            <CardContent className="space-y-4">
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
