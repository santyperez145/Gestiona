/**
 * CommerceSalesPerformance — Rendimiento de ventas para el dashboard de Commerce
 *
 * Diseño moderno con análisis de rendimiento de ventas
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, ShoppingCart, DollarSign, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface SalesPerformance {
  period: string;
  sales: number;
  target?: number;
  achievement?: number;
}

interface CommerceSalesPerformanceProps {
  data: SalesPerformance[];
  title?: string;
  height?: number;
}

export default function CommerceSalesPerformance({
  data,
  title = "Rendimiento de Ventas",
  height = 300,
}: CommerceSalesPerformanceProps) {
  const latestData = data[data.length - 1];
  const totalSales = data.reduce((sum, d) => sum + d.sales, 0);
  const avgAchievement = data.reduce((sum, d) => sum + (d.achievement || 0), 0) / data.length;

  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total ventas</p>
            <p className="text-lg font-bold">{totalSales.toLocaleString()}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Chart */}
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis
                dataKey="period"
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
                  if (name === "sales") return [`$${value.toLocaleString()}`, "Ventas"];
                  if (name === "target") return [`$${value.toLocaleString()}`, "Objetivo"];
                  return [value, name];
                }}
              />
              <Line
                type="monotone"
                dataKey="sales"
                stroke="hsl(var(--primary))"
                strokeWidth={2}
                dot={{ r: 4, fill: "hsl(var(--primary))" }}
                name="Ventas"
              />
              {data.some(d => d.target !== undefined) && (
                <Line
                  type="monotone"
                  dataKey="target"
                  stroke="hsl(142, 76%, 36%)"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={{ r: 4, fill: "hsl(142, 76%, 36%)" }}
                  name="Objetivo"
                />
              )}
            </LineChart>
          </ResponsiveContainer>

          {/* Achievement metrics */}
          {data.map((item, index) => (
            <div key={index} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" />
                  <p className="font-medium text-sm">{item.period}</p>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {item.achievement ? `${item.achievement}%` : "—"}
                </Badge>
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">
                    ${item.sales.toLocaleString()} {item.target && `/ $${item.target.toLocaleString()}`}
                  </span>
                  <span className="font-semibold">{item.achievement ? `${item.achievement}%` : "—"}</span>
                </div>
                <Progress value={item.achievement || 0} className="h-2" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
