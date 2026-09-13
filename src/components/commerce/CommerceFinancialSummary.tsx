/* Rediseño CommerceFinancialSummary: tokens coherentes, sin IDs, jerarquía KPI */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, DollarSign, Wallet, Target } from "lucide-react";
import { cn } from "@/lib/utils";

interface FinancialMetric {
  label: string;
  value: string;
  change?: number;
  trend?: "up" | "down" | "neutral";
  icon?: React.ComponentType<{ className?: string }>;
}

interface CommerceFinancialSummaryProps {
  metrics: FinancialMetric[];
  title?: string;
}

export default function CommerceFinancialSummary({
  metrics,
  title = "Resumen financiero",
}: CommerceFinancialSummaryProps) {
  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {metrics.map((metric, index) => {
            const TrendIcon = metric.trend === "up" ? TrendingUp : metric.trend === "down" ? TrendingDown : Target;
            const trendColor = metric.trend === "up" ? "text-emerald-600" : metric.trend === "down" ? "text-red-600" : "text-muted-foreground";
            return (
              <div
                key={`${metric.label}-${index}`}
                className="p-3 rounded-xl bg-muted/20 border border-border/40 hover:border-border transition-colors"
                aria-label={`${metric.label}: ${metric.value}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {metric.icon && <metric.icon className="h-4 w-4 text-muted-foreground shrink-0" />}
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider truncate">
                      {metric.label}
                    </p>
                  </div>
                  {metric.change !== undefined && (
                    <div className={cn("flex items-center gap-0.5 text-[11px] font-semibold shrink-0", trendColor)} aria-label={`${metric.change > 0 ? "+" : ""}${metric.change}%`}>
                      <TrendIcon className="h-3 w-3" />
                      {metric.change > 0 ? "+" : ""}{metric.change}%
                    </div>
                  )}
                </div>
                <p className="text-xl font-bold font-display tabular-nums">{metric.value}</p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
