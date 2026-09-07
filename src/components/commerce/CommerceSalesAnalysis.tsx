/**
 * CommerceSalesAnalysis — Análisis de ventas para el dashboard de Commerce
 *
 * Diseño moderno con análisis de ventas y tendencias
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, ShoppingCart, DollarSign } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface SalesData {
  period: string;
  sales: number;
  revenue: number;
  orders: number;
  change?: number;
}

interface CommerceSalesAnalysisProps {
  data: SalesData[];
  title?: string;
  height?: number;
}

export default function CommerceSalesAnalysis({
  data,
  title = "Análisis de Ventas",
  height = 300,
}: CommerceSalesAnalysisProps) {
  const totalSales = data.reduce((sum, d) => sum + d.sales, 0);
  const totalRevenue = data.reduce((sum, d) => sum + d.revenue, 0);
  const totalOrders = data.reduce((sum, d) => sum + d.orders, 0);

  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-lg font-bold">{totalOrders} pedidos</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart data={data}>
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
                if (name === "orders") return [value, "Pedidos"];
                return [value, name];
              }}
            />
            <Bar dataKey="sales" radius={[8, 8, 0, 0]}>
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={`hsl(var(--primary))`} fillOpacity={0.8} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
