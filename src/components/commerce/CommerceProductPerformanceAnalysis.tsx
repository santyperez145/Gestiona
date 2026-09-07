/**
 * CommerceProductPerformanceAnalysis — Análisis de rendimiento de productos para el dashboard de Commerce
 *
 * Diseño moderno con análisis de rendimiento de productos
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, TrendingUp, TrendingDown, DollarSign, ShoppingCart } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface ProductPerformance {
  id: string;
  name: string;
  sales: number;
  revenue: number;
  margin?: number;
  trend?: number;
  status: "hot" | "warm" | "cold";
}

interface CommerceProductPerformanceAnalysisProps {
  products: ProductPerformance[];
  title?: string;
  height?: number;
}

const statusColors = {
  hot: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30",
  warm: "text-yellow-600 bg-yellow-500/10 border-yellow-500/30",
  cold: "text-red-600 bg-red-500/10 border-red-500/30",
};

export default function CommerceProductPerformanceAnalysis({
  products,
  title = "Análisis de Rendimiento de Productos",
  height = 300,
}: CommerceProductPerformanceAnalysisProps) {
  const totalRevenue = products.reduce((sum, p) => sum + p.revenue, 0);
  const avgMargin = products.reduce((sum, p) => sum + (p.margin || 0), 0) / products.length;

  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total ingresos</p>
            <p className="text-lg font-bold">${totalRevenue.toLocaleString()}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Chart */}
          <ResponsiveContainer width="100%" height={height}>
            <BarChart data={products}>
              <XAxis
                dataKey="name"
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(value: number, name: string) => {
                  if (name === "revenue") return [`$${value.toLocaleString()}`, "Ingresos"];
                  if (name === "sales") return [value, "Ventas"];
                  return [value, name];
                }}
              />
              <Bar dataKey="revenue" radius={[8, 8, 0, 0]}>
                {products.map((product, index) => (
                  <Cell key={`cell-${index}`} fill={`hsl(var(--primary))`} fillOpacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {/* Product metrics */}
          {products.map((product, index) => {
            const statusClass = statusColors[product.status];
            const revenueShare = totalRevenue > 0 ? (product.revenue / totalRevenue) * 100 : 0;

            return (
              <div key={product.id} className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Package className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{product.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="secondary" className={`text-xs ${statusClass.split(' ')[0]}`}>
                          {product.status === "hot" ? "Caliente" : product.status === "warm" ? "Tibio" : "Frío"}
                        </Badge>
                        {product.trend !== undefined && (
                          <div className="flex items-center gap-1 text-xs">
                            {product.trend > 0 ? (
                              <TrendingUp className="h-3 w-3 text-emerald-600" />
                            ) : (
                              <TrendingDown className="h-3 w-3 text-red-600" />
                            )}
                            <span className={product.trend > 0 ? "text-emerald-600" : "text-red-600"}>
                              {product.trend > 0 ? "+" : ""}
                              {product.trend}%
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">${product.revenue.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{product.sales} ventas</p>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {revenueShare.toFixed(1)}% del total
                    </span>
                    {product.margin && (
                      <span className="text-muted-foreground">
                        Margen: {product.margin.toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <Progress value={revenueShare} className="h-2" />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
