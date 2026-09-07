/**
 * CommerceGrowthAnalysis — Análisis de crecimiento para el dashboard de Commerce
 *
 * Diseño moderno con análisis de crecimiento y proyecciones
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, BarChart3, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

interface GrowthData {
  period: string;
  current: number;
  previous: number;
  projected?: number;
}

interface CommerceGrowthAnalysisProps {
  data: GrowthData[];
  title?: string;
  height?: number;
}

export default function CommerceGrowthAnalysis({
  data,
  title = "Análisis de Crecimiento",
  height = 300,
}: CommerceGrowthAnalysisProps) {
  const latestData = data[data.length - 1];
  const growthRate = latestData && latestData.previous > 0
    ? ((latestData.current - latestData.previous) / latestData.previous) * 100
    : 0;

  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Crecimiento</p>
            <div className="flex items-center gap-1">
              {growthRate >= 0 ? (
                <TrendingUp className="h-4 w-4 text-emerald-600" />
              ) : (
                <TrendingDown className="h-4 w-4 text-red-600" />
              )}
              <p className={`text-lg font-bold ${growthRate >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                {growthRate > 0 ? "+" : ""}
                {growthRate.toFixed(1)}%
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
                if (name === "current") return [`$${value.toLocaleString()}`, "Actual"];
                if (name === "previous") return [`$${value.toLocaleString()}`, "Anterior"];
                if (name === "projected") return [`$${value.toLocaleString()}`, "Proyectado"];
                return [value, name];
              }}
            />
            <Line
              type="monotone"
              dataKey="current"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={{ r: 4, fill: "hsl(var(--primary))" }}
              name="Actual"
            />
            <Line
              type="monotone"
              dataKey="previous"
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={2}
              strokeDasharray="5 5"
              dot={{ r: 4, fill: "hsl(var(--muted-foreground))" }}
              name="Anterior"
            />
            {data.some(d => d.projected !== undefined) && (
              <Line
                type="monotone"
                dataKey="projected"
                stroke="hsl(142, 76%, 36%)"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={{ r: 4, fill: "hsl(142, 76%, 36%)" }}
                name="Proyectado"
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
