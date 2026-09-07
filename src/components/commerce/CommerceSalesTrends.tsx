/**
 * CommerceSalesTrends — Tendencias de ventas para el dashboard de Commerce
 *
 * Diseño moderno con análisis de tendencias de ventas
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, BarChart3, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface SalesTrend {
  period: string;
  sales: number;
  revenue: number;
  change?: number;
}

interface CommerceSalesTrendsProps {
  data: SalesTrend[];
  title?: string;
  height?: number;
}

export default function CommerceSalesTrends({
  data,
  title = "Tendencias de Ventas",
  height = 300,
}: CommerceSalesTrendsProps) {
  const latestData = data[data.length - 1];
  const trendDirection = latestData && latestData.change ? (latestData.change > 0 ? "up" : "down") : "neutral";

  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Tendencia</p>
            <div className="flex items-center gap-1">
              {trendDirection === "up" ? (
                <TrendingUp className="h-4 w-4 text-emerald-600" />
              ) : trendDirection === "down" ? (
                <TrendingDown className="h-4 w-4 text-red-600" />
              ) : (
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              )}
              <p className={`text-lg font-bold ${trendDirection === "up" ? "text-emerald-600" : trendDirection === "down" ? "text-red-600" : "text-muted-foreground"}`}>
                {latestData?.change ? `${latestData.change > 0 ? "+" : ""}${latestData.change.toFixed(1)}%` : "—"}
              </p>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
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
                if (name === "sales") return [value, "Ventas"];
                if (name === "revenue") return [`$${value.toLocaleString()}`, "Ingresos"];
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
            <Line
              type="monotone"
              dataKey="revenue"
              stroke="hsl(142, 76%, 36%)"
              strokeWidth={2}
              dot={{ r: 4, fill: "hsl(142, 76%, 36%)" }}
              name="Ingresos"
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
