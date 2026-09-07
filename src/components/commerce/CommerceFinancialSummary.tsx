/**
 * CommerceFinancialSummary — Resumen financiero para el dashboard de Commerce
 *
 * Diseño moderno con métricas financieras clave
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, DollarSign, Wallet, Target } from "lucide-react";
import { cn } from "@/lib/utils";

interface FinancialMetric {
  label: string;
  value: string;
  change?: number;
  trend?: "up" | "down" | "neutral";
  icon?: any;
}

interface CommerceFinancialSummaryProps {
  metrics: FinancialMetric[];
  title?: string;
}

export default function CommerceFinancialSummary({
  metrics,
  title = "Resumen Financiero",
}: CommerceFinancialSummaryProps) {
  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          {metrics.map((metric, index) => {
            const TrendIcon = metric.trend === "up" ? TrendingUp : metric.trend === "down" ? TrendingDown : Target;
            const trendColor = metric.trend === "up" ? "text-emerald-600" : metric.trend === "down" ? "text-red-600" : "text-muted-foreground";

            return (
              <div
                key={index}
                className="p-3 rounded-lg bg-muted/30 border border-border/50 hover:border-border transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {metric.icon && <metric.icon className="h-4 w-4 text-muted-foreground" />}
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {metric.label}
                    </p>
                  </div>
                  {metric.change !== undefined && (
                    <div className={cn("flex items-center gap-1 text-xs font-medium", trendColor)}>
                      <TrendIcon className="h-3 w-3" />
                      {metric.change > 0 ? "+" : ""}
                      {metric.change}%
                    </div>
                  )}
                </div>
                <p className="text-xl font-bold font-display">{metric.value}</p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
