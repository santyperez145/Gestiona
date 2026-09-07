/**
 * CommerceSalesPersonPerformance — Análisis de rendimiento de vendedores para el dashboard de Commerce
 *
 * Diseño moderno con análisis de rendimiento de vendedores
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, TrendingUp, ShoppingCart, DollarSign, Target, TrendingDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

interface SalesPersonPerformance {
  name: string;
  sales: number;
  revenue: number;
  orders: number;
  target?: number;
  achievement?: number;
  status: "excellent" | "good" | "warning" | "critical";
  trend?: number;
}

interface CommerceSalesPersonPerformanceProps {
  salesPeople: SalesPersonPerformance[];
  title?: string;
}

const statusColors = {
  excellent: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30",
  good: "text-green-600 bg-green-500/10 border-green-500/30",
  warning: "text-yellow-600 bg-yellow-500/10 border-yellow-500/30",
  critical: "text-red-600 bg-red-500/10 border-red-500/30",
};

export default function CommerceSalesPersonPerformance({
  salesPeople,
  title = "Análisis de Rendimiento de Vendedores",
}: CommerceSalesPersonPerformanceProps) {
  const totalRevenue = salesPeople.reduce((sum, s) => sum + s.revenue, 0);
  const totalOrders = salesPeople.reduce((sum, s) => sum + s.orders, 0);

  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total ingresos</p>
            <p className="text-lg font-bold">${totalRevenue.toLocaleString()}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {salesPeople.map((person, index) => {
            const statusClass = statusColors[person.status];
            const revenueShare = totalRevenue > 0 ? (person.revenue / totalRevenue) * 100 : 0;
            const targetProgress = person.target ? (person.sales / person.target) * 100 : 0;

            return (
              <div key={index} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-lg ${statusClass.split(' ')[0]}`}>
                      <Users className={`h-4 w-4 ${statusClass.split(' ')[0]}`} />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{person.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="secondary" className={`text-xs ${statusClass.split(' ')[0]}`}>
                          {person.status === "excellent" ? "Excelente" : person.status === "good" ? "Bueno" : person.status === "warning" ? "Advertencia" : "Crítico"}
                        </Badge>
                        {person.trend !== undefined && (
                          <div className="flex items-center gap-1 text-xs">
                            {person.trend > 0 ? (
                              <TrendingUp className="h-3 w-3 text-emerald-600" />
                            ) : (
                              <TrendingDown className="h-3 w-3 text-red-600" />
                            )}
                            <span className={person.trend > 0 ? "text-emerald-600" : "text-red-600"}>
                              {person.trend > 0 ? "+" : ""}
                              {person.trend}%
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">${person.revenue.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{person.orders} pedidos</p>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {revenueShare.toFixed(1)}% del total
                    </span>
                    {person.target && (
                      <span className="text-muted-foreground">
                        Objetivo: {targetProgress.toFixed(0)}%
                      </span>
                    )}
                  </div>
                  <Progress value={revenueShare} className="h-2" />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
