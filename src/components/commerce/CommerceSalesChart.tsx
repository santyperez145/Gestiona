/* Rediseño de CommerceSalesChart: paleta de tokens, sin UUID, leyenda coherente */
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart, Legend } from "recharts";
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
        <ChartWrapper>
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
              <defs>
                <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                stroke="#c4b8a8"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickMargin={6}
              />
              <YAxis
                stroke="#c4b8a8"
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value: number) => `$${(value / 1000).toFixed(0)}k`}
                width={48}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#0b0b18",
                  border: "1px solid #1a1a2e",
                  borderRadius: 8,
                  fontSize: 12,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                }}
                formatter={(value: number) => [`$${value.toLocaleString("es-AR")}`, "Ventas"]}
                labelFormatter={(label: string) => label}
              />
              <Legend
                iconType="circle"
                wrapperStyle={{ fontSize: 12, color: "#c4b8a8" }}
              />
              <Area
                type="monotone"
                dataKey="sales"
                name="Ventas"
                stroke="#f59e0b"
                strokeWidth={2}
                fill="url(#colorSales)"
                fillOpacity={1}
                dot={{ fill: "#f59e0b", strokeWidth: 0, r: 3 }}
                activeDot={{ r: 5, stroke: "#f59e0b", strokeWidth: 2, fill: "#0b0b18" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartWrapper>
      </CardContent>
    </Card>
  );
}
