/**
 * CommercePricingTrends — Análisis de tendencias de precios para el dashboard de Commerce
 *
 * Diseño moderno con análisis de tendencias de precios
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, TrendingUp, TrendingDown, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface PricingTrend {
  period: string;
  current: number;
  suggested?: number;
  competitor?: number;
}

interface CommercePricingTrendsProps {
  data: PricingTrend[];
  title?: string;
  height?: number;
}

export default function CommercePricingTrends({
  data,
  title = "Análisis de Tendencias de Precios",
  height = 300,
}: CommercePricingTrendsProps) {
  const latestData = data[data.length - 1];
  const priceChange = latestData && latestData.competitor
    ? ((latestData.current - latestData.competitor) / latestData.competitor) * 100
    : 0;

  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Cambio de precio</p>
            <div className="flex items-center gap-1">
              {priceChange >= 0 ? (
                <TrendingUp className="h-4 w-4 text-emerald-600" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-600" />
              )}
              <p className={`text-lg font-bold ${priceChange >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {priceChange > 0 ? "+" : ""}
                {priceChange.toFixed(1)}%
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
              tickFormatter={(value) => `$${value.toLocaleString()}`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value: number, name: string) => {
                if (name === "current") return [`$${value.toLocaleString()}`, "Precio actual"];
                if (name === "suggested") return [`$${value.toLocaleString()}`, "Precio sugerido"];
                if (name === "competitor") return [`$${value.toLocaleString()}`, "Precio competidor"];
                return [value, name];
              }}
            />
            <Line
              type="monotone"
              dataKey="current"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={{ r: 4, fill: "hsl(var(--primary))" }}
              name="Precio actual"
            />
            {data.some(d => d.suggested !== undefined) && (
              <Line
                type="monotone"
                dataKey="suggested"
                stroke="hsl(142, 76%, 36%)"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={{ r: 4, fill: "hsl(142, 76%, 36%)" }}
                name="Precio sugerido"
              />
            )}
            {data.some(d => d.competitor !== undefined) && (
              <Line
                type="monotone"
                dataKey="competitor"
                stroke="hsl(38, 92%, 50%)"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={{ r: 4, fill: "hsl(38, 92%, 50%)" }}
                name="Precio competidor"
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
