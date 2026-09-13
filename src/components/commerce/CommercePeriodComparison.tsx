/* Rediseño CommercePeriodComparison: tokens coherentes, sin IDs, leyenda clara */
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
  title = "Comparación de períodos",
}: CommercePeriodComparisonProps) {
  return (
    <Card className="border-border/50 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Calendar className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {periods.map((period, index) => {
            const trend = period.change > 0 ? "up" : period.change < 0 ? "down" : "neutral";
            const trendColor = trend === "up" ? "text-emerald-600" : trend === "down" ? "text-red-600" : "text-muted-foreground";
            const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Target;
            return (
              <div key={index} className="space-y-2 p-3 rounded-lg bg-muted/20 border border-border/40">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm truncate">{period.label}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold tabular-nums text-primary">${period.current.toLocaleString("es-AR")}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>vs {period.previous.toLocaleString("es-AR")}</span>
                </div>
                <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                  <div className={cn(
                    "h-full rounded-full transition-all",
                    trend === "up" ? "bg-emerald-600/70" : trend === "down" ? "bg-red-600/70" : "bg-muted/40"
                  )}
                  style={{
                    width: `${Math.min(100, Math.abs(period.change) + 25)}%`,
                  }}
                /></div>
                <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{trend === "up" ? "↑" : trend === "down" ? "↓" : "→"} {Math.abs(period.change)}%</span>
                  <TrendIcon className="w-3 h-3 inline" />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}