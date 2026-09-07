/**
 * CommerceOrdersChart — Gráfico de pedidos tecnológico para el dashboard de Commerce
 *
 * Diseño moderno con barras, gradientes y animaciones
 */
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShoppingCart } from "lucide-react";

interface OrderDataPoint {
  date: string;
  orders: number;
  revenue: number;
}

interface CommerceOrdersChartProps {
  data: OrderDataPoint[];
  title?: string;
  height?: number;
}

const COLORS = [
  "hsl(var(--primary))",
  "hsl(142, 76%, 36%)",
  "hsl(38, 92%, 50%)",
  "hsl(0, 72%, 51%)",
  "hsl(262, 83%, 58%)",
];

export default function CommerceOrdersChart({
  data,
  title = "Pedidos - Últimos 30 días",
  height = 300,
}: CommerceOrdersChartProps) {
  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data}>
            <defs>
              {COLORS.map((color, index) => (
                <linearGradient key={index} id={`colorBar${index}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.8} />
                  <stop offset="95%" stopColor={color} stopOpacity={0.2} />
                </linearGradient>
              ))}
            </defs>
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
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "hsl(var(--popover))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value: number, name: string) => {
                if (name === "orders") return [value, "Pedidos"];
                if (name === "revenue") return [`$${value.toLocaleString()}`, "Ingresos"];
                return [value, name];
              }}
            />
            <Bar dataKey="orders" radius={[8, 8, 0, 0]}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={`url(#colorBar${index % COLORS.length})`} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
