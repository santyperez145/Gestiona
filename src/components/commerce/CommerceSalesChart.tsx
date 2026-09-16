import { useId, useMemo } from "react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart, Legend } from "recharts";
import { chartColors, chartTooltipStyle } from "@/lib/chartTheme";
import ChartWrapper from "@/components/analytics/ChartWrapper";
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
  const gradientId = useId().replace(/:/g, '');

  // Guard against empty data: show empty state instead of broken chart
  const safeData = useMemo(() => data ?? [], [data]);

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
        {safeData.length === 0 ? (
          <div className="h-36 flex items-center justify-center text-muted-foreground text-sm">
            Sin datos de ventas aún
          </div>
        ) : (
          <ChartWrapper>
            <ResponsiveContainer width="100%" height={height}>
              <AreaChart data={safeData} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={chartColors.sales} stopOpacity={0.18} />
                    <stop offset="95%" stopColor={chartColors.sales} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" stroke={chartColors.text} fontSize={11} tickLine={false} axisLine={false} tickMargin={6} />
                <YAxis stroke={chartColors.text} fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} width={48} />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(value: number) => [`$${value.toLocaleString("es-AR")}`, "Ventas"]}
                  labelFormatter={(label: string) => label}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: chartColors.text }} />
                <Area type="monotone" dataKey="sales" name="Ventas" stroke={chartColors.sales} strokeWidth={2} fill={`url(#${gradientId})`} fillOpacity={1} dot={{ fill: chartColors.sales, strokeWidth: 0, r: 3 }} activeDot={{ r: 5, stroke: chartColors.sales, strokeWidth: 2, fill: "hsl(var(--card))" }} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartWrapper>
        )}
      </CardContent>
    </Card>
  );
}
