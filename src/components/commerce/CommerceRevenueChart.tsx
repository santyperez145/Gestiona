/**
 * CommerceRevenueChart — Gráfico de ingresos para el dashboard de Commerce
 *
 * Diseño moderno con área chart y gradientes profesionales
 */
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign } from "lucide-react";

interface RevenueDataPoint {
  date: string;
  revenue: number;
  profit?: number;
}

interface CommerceRevenueChartProps {
  data: RevenueDataPoint[];
  title?: string;
  height?: number;
  showProfit?: boolean;
}

export default function CommerceRevenueChart({
  data,
  title = "Ingresos - Últimos 30 días",
  height = 300,
  showProfit = false,
}: CommerceRevenueChartProps) {
  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
              {showProfit && (
                <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0} />
                </linearGradient>
              )}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis
              dataKey="date"
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
                if (name === "profit") return [`$${value.toLocaleString()}`, "Ganancia"];
                return [value, name];
              }}
            />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorRevenue)"
            />
            {showProfit && (
              <Area
                type="monotone"
                dataKey="profit"
                stroke="hsl(142, 76%, 36%)"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorProfit)"
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
