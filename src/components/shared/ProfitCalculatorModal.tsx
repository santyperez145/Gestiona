/**
 * ProfitCalculatorModal — Interactive profit & price simulator.
 *
 * Given a product's cost (USD) and exchange rate, lets the user drag
 * sliders for markup % and customs % to see live:
 *   - Sale price (ARS)
 *   - Profit per unit (ARS)
 *   - Gross margin %
 *   - ROI (return on investment)
 *   - Break-even units to recover investment
 *
 * Can be opened standalone or pre-filled from a product.
 */
import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calculator, TrendingUp, DollarSign, Percent, RefreshCw } from "lucide-react";
import { formatARS } from "@/lib/supabaseStore";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Pre-fill with existing product data */
  product?: {
    name?: string;
    cost_usd?: number;
    sale_price_ars?: number;
    customs_percent?: number;
  };
  exchangeRate?: number;
}

function fmt(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
}

export default function ProfitCalculatorModal({ open, onClose, product, exchangeRate = 1700 }: Props) {
  const [costUSD, setCostUSD] = useState(product?.cost_usd?.toString() ?? "");
  const [markupPct, setMarkupPct] = useState(100);
  const [customsPct, setCustomsPct] = useState(product?.customs_percent ?? 15);
  const [stock, setStock] = useState(10);
  const [xRate, setXRate] = useState(exchangeRate);

  const cost = parseFloat(costUSD) || 0;

  const calc = useMemo(() => {
    if (cost <= 0) return null;
    const costARS = cost * (1 + customsPct / 100) * xRate;
    const salePrice = Math.round(costARS * (1 + markupPct / 100));
    const profit = salePrice - costARS;
    const margin = salePrice > 0 ? (profit / salePrice) * 100 : 0;
    const roi = costARS > 0 ? (profit / costARS) * 100 : 0;
    const breakEven = profit > 0 ? Math.ceil((cost * xRate * stock) / profit) : 0;
    const totalInvest = costARS * stock;
    const totalRevenue = salePrice * stock;
    const totalProfit = profit * stock;
    return { costARS, salePrice, profit, margin, roi, breakEven, totalInvest, totalRevenue, totalProfit };
  }, [cost, markupPct, customsPct, xRate, stock]);

  // Chart: sensitivity of margin vs markup
  const chartData = useMemo(() => {
    if (cost <= 0) return [];
    return Array.from({ length: 21 }, (_, i) => {
      const mk = i * 10; // 0 to 200
      const costARS = cost * (1 + customsPct / 100) * xRate;
      const sp = costARS * (1 + mk / 100);
      const m = sp > 0 ? ((sp - costARS) / sp) * 100 : 0;
      return { markup: `${mk}%`, margin: parseFloat(m.toFixed(1)), price: Math.round(sp) };
    });
  }, [cost, customsPct, xRate]);

  const marginColor = calc
    ? calc.margin >= 50 ? "text-green-400" : calc.margin >= 30 ? "text-yellow-400" : "text-red-400"
    : "";

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="bg-[hsl(228_24%_7%)] border-border/60 max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <Calculator className="w-5 h-5 text-primary" />
            Calculadora de rentabilidad
            {product?.name && <span className="text-sm font-normal text-muted-foreground">— {product.name}</span>}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Inputs */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Costo USD</label>
              <div className="relative">
                <DollarSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={costUSD}
                  onChange={e => setCostUSD(e.target.value)}
                  className="pl-7 bg-muted border-border"
                  placeholder="0.00"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Tipo de cambio</label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                <Input
                  type="number"
                  min="1"
                  value={xRate}
                  onChange={e => setXRate(Number(e.target.value))}
                  className="pl-7 bg-muted border-border"
                />
              </div>
            </div>
          </div>

          {/* Sliders */}
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-muted-foreground">Aduanas / impuestos</label>
                <Badge variant="outline" className="text-xs font-mono">{customsPct}%</Badge>
              </div>
              <Slider
                value={[customsPct]}
                min={0}
                max={60}
                step={1}
                onValueChange={([v]) => setCustomsPct(v)}
                className="accent-primary"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-muted-foreground">Markup sobre costo importado</label>
                <Badge
                  variant="outline"
                  className={`text-xs font-mono ${markupPct >= 100 ? "border-green-500/40 text-green-400" : markupPct >= 50 ? "border-yellow-500/40 text-yellow-400" : "border-red-500/40 text-red-400"}`}
                >
                  {markupPct}%
                </Badge>
              </div>
              <Slider
                value={[markupPct]}
                min={0}
                max={400}
                step={5}
                onValueChange={([v]) => setMarkupPct(v)}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-muted-foreground">Unidades en stock</label>
                <Badge variant="outline" className="text-xs font-mono">{stock} uds</Badge>
              </div>
              <Slider
                value={[stock]}
                min={1}
                max={200}
                step={1}
                onValueChange={([v]) => setStock(v)}
              />
            </div>
          </div>

          {/* Results */}
          {calc && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: "Precio venta", value: fmt(calc.salePrice), icon: DollarSign, highlight: false },
                { label: "Ganancia/ud", value: fmt(calc.profit), icon: TrendingUp, highlight: calc.profit > 0 },
                { label: "Margen", value: `${calc.margin.toFixed(1)}%`, icon: Percent, highlight: calc.margin >= 30 },
                { label: "ROI", value: `${calc.roi.toFixed(0)}%`, icon: TrendingUp, highlight: calc.roi >= 80 },
              ].map(item => (
                <div key={item.label} className={`p-3 rounded-xl border ${item.highlight ? "border-primary/30 bg-primary/5" : "border-border/40 bg-muted/20"}`}>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{item.label}</p>
                  <p className={`text-lg font-bold mt-0.5 font-mono ${item.highlight ? "text-primary" : ""}`}>{item.value}</p>
                </div>
              ))}
            </div>
          )}

          {calc && (
            <div className="p-3 rounded-xl bg-muted/20 border border-border/40 grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-[10px] text-muted-foreground">Inversión total</p>
                <p className="text-sm font-semibold font-mono">{fmt(calc.totalInvest)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Revenue total</p>
                <p className="text-sm font-semibold font-mono text-green-400">{fmt(calc.totalRevenue)}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground">Ganancia total</p>
                <p className={`text-sm font-semibold font-mono ${calc.totalProfit > 0 ? "text-green-400" : "text-red-400"}`}>{fmt(calc.totalProfit)}</p>
              </div>
            </div>
          )}

          {/* Sensitivity chart */}
          {chartData.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                <TrendingUp className="w-3 h-3" /> Margen según markup (sensibilidad)
              </p>
              <div className="h-28">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 2, right: 4, left: -30, bottom: 0 }}>
                    <defs>
                      <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(38 82% 52%)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(38 82% 52%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="markup" tick={{ fontSize: 9 }} interval={3} />
                    <YAxis tick={{ fontSize: 9 }} unit="%" />
                    <Tooltip
                      contentStyle={{ background: "hsl(228 24% 7%)", border: "1px solid hsl(var(--border)/0.6)", borderRadius: 8, fontSize: 11 }}
                      formatter={(v: number) => [`${v}%`, "Margen"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="margin"
                      stroke="hsl(38 82% 52%)"
                      strokeWidth={2}
                      fill="url(#profitGrad)"
                      dot={false}
                      isAnimationActive={false}
                    />
                    {/* Highlight current markup */}
                    <Area
                      type="monotone"
                      dataKey="margin"
                      stroke="transparent"
                      fill="transparent"
                      dot={(props: any) => {
                        const idx = chartData.findIndex(d => d.markup === `${markupPct}%`);
                        if (props.index !== idx) return <></>;
                        return <circle key={props.key} cx={props.cx} cy={props.cy} r={5} fill="hsl(38 82% 52%)" stroke="white" strokeWidth={2} />;
                      }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {calc && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/30 border border-border/40 text-xs text-muted-foreground">
              <Calculator className="w-3.5 h-3.5 shrink-0 text-primary" />
              Con {stock} unidades a {fmt(calc.salePrice)}, recuperás la inversión vendiendo {calc.breakEven} ud{calc.breakEven !== 1 ? "s" : ""}.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
