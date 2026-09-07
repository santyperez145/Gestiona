/**
 * CommercePerformanceMetrics — Métricas de rendimiento para el dashboard de Commerce
 *
 * Diseño moderno con KPIs de rendimiento del negocio
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Target, Zap, ShoppingCart, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface PerformanceMetric {
  label: string;
  value: string;
  change?: number;
  trend?: "up" | "down" | "neutral";
  icon?: any;
  description?: string;
}

interface CommercePerformanceMetricsProps {
  metrics: PerformanceMetric[];
  title?: string;
}

export default function CommercePerformanceMetrics({
  metrics,
  title = "Métricas de Rendimiento",
}: CommercePerformanceMetricsProps) {
  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {metrics.map((metric, index) => {
            const trendIcon = metric.trend === "up" ? TrendingUp : metric.trend === "down" ? TrendingDown : Target;
            const trendColor = metric.trend === "up" ? "text-emerald-600" : metric.trend === "down" ? "text-red-600" : "text-muted-foreground";
            const Icon = metric.icon || Target;

            return (
              <div
                key={index}
                className="p-4 rounded-lg bg-gradient-to-br from-muted/50 to-muted/30 border border-border/50 hover:border-border transition-all hover:shadow-md"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {metric.label}
                    </p>
                  </div>
                  {metric.change !== undefined && (
                    <div className={cn("flex items-center gap-1 text-xs font-medium", trendColor)}>
                      <trendIcon className="h-3 w-3" />
                      {metric.change > 0 ? "+" : ""}
                      {metric.change}%
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  <p className="text-2xl font-bold font-display">{metric.value}</p>
                  {metric.description && (
                    <p className="text-xs text-muted-foreground">{metric.description}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
