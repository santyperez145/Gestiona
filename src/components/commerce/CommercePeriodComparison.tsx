/**
 * CommercePeriodComparison — Comparación de períodos para el dashboard de Commerce
 *
 * Diseño moderno con comparación de ventas entre períodos
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Calendar, Target } from "lucide-react";
import { cn } from "@/lib/utils";

interface PeriodData {
  label: string;
  current: number;
  previous: number;
  change: number;
}

interface CommercePeriodComparisonProps {
  periods: PeriodData[];
  title?: string;
}

export default function CommercePeriodComparison({
  periods,
  title = "Comparación de Períodos",
}: CommercePeriodComparisonProps) {
  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {periods.map((period, index) => {
            const trend = period.change > 0 ? "up" : period.change < 0 ? "down" : "neutral";
            const trendColor = trend === "up" ? "text-emerald-600" : trend === "down" ? "text-red-600" : "text-muted-foreground";
            const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Target;

            return (
              <div key={index} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm">{period.label}</p>
                    {period.change !== 0 && (
                      <div className={cn("flex items-center gap-1 text-xs font-medium", trendColor)}>
                        <TrendIcon className="h-3 w-3" />
                        {period.change > 0 ? "+" : ""}
                        {period.change}%
                      </div>
                    )}
                  </div>
                  <p className="font-semibold">${period.current.toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>vs ${period.previous.toLocaleString()} anterior</span>
                </div>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      trend === "up" ? "bg-emerald-600" : trend === "down" ? "bg-red-600" : "bg-muted"
                    )}
                    style={{
                      width: `${Math.min(100, Math.abs(period.change) + 20)}%`,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
