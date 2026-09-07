/**
 * CommerceCustomerPerformance — Rendimiento de clientes para el dashboard de Commerce
 *
 * Diseño moderno con análisis de rendimiento de clientes
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, TrendingUp, ShoppingCart, Heart, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

interface CustomerPerformance {
  segment: string;
  size: number;
  revenue: number;
  avgOrderValue: number;
  frequency: string;
  retention: number;
  status: "excellent" | "good" | "warning" | "critical";
}

interface CommerceCustomerPerformanceProps {
  segments: CustomerPerformance[];
  title?: string;
}

const statusColors = {
  excellent: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30",
  good: "text-green-600 bg-green-500/10 border-green-500/30",
  warning: "text-yellow-600 bg-yellow-500/10 border-yellow-500/30",
  critical: "text-red-600 bg-red-500/10 border-red-500/30",
};

export default function CommerceCustomerPerformance({
  segments,
  title = "Rendimiento de Clientes",
}: CommerceCustomerPerformanceProps) {
  const totalRevenue = segments.reduce((sum, s) => sum + s.revenue, 0);
  const totalCustomers = segments.reduce((sum, s) => sum + s.size, 0);

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
          {segments.map((segment, index) => {
            const statusClass = statusColors[segment.status];
            const revenueShare = totalRevenue > 0 ? (segment.revenue / totalRevenue) * 100 : 0;

            return (
              <div key={index} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-lg ${statusClass.split(' ')[0]}`}>
                      <Users className={`h-4 w-4 ${statusClass.split(' ')[0]}`} />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{segment.segment}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="secondary" className={`text-xs ${statusClass.split(' ')[0]}`}>
                          {segment.status === "excellent" ? "Excelente" : segment.status === "good" ? "Bueno" : segment.status === "warning" ? "Advertencia" : "Crítico"}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {segment.frequency}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">${segment.revenue.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{segment.size} clientes</p>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {revenueShare.toFixed(1)}% del total
                    </span>
                    <span className="text-muted-foreground">
                      Retención: {segment.retention}%
                    </span>
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
