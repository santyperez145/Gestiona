/* Rediseño de CommerceSalesChart: paleta de tokens, sin UUID, leyenda coherente */
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart, Legend } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";

interface SalesDataPoint {
  date: string;
  sales: number;
  orders: number;
}

interface CommerceSalesChartProps {
  data: SalesDataPoint[];
  title?: string;
  height?: number;
}

export default function CommerceSalesChart({
  data,
  title = "Ventas — últimos 30 días",
  height = 300,
}: CommerceSalesChartProps) {
  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <AreaChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
            <defs>
              <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.25} />
                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickMargin={6}
            />
            <YAxis
              stroke="hsl(var(--muted-foreground))"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value: number) => `$${(value / 1000).toFixed(0)}k`}
              width={48}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
                boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
              }}
              formatter={(value: number) => [`$${value.toLocaleString("es-AR")}`, "Ventas"]}
              labelFormatter={(label: string) => label}
            />
            <Legend
              iconType="circle"
              wrapperStyle={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}
            />
            <Area
              type="monotone"
              dataKey="sales"
              name="Ventas"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              fill="url(#colorSales)"
              fillOpacity={1}
              dot={{ fill: "hsl(var(--primary))", strokeWidth: 0, r: 3 }}
              activeDot={{ r: 5, stroke: "hsl(var(--primary))", strokeWidth: 2, fill: "hsl(var(--background))" }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
