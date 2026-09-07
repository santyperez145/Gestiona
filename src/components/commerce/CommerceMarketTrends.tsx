/**
 * CommerceMarketTrends — Tendencias de mercado para el dashboard de Commerce
 *
 * Diseño moderno con análisis de tendencias de mercado
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, BarChart3, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface MarketTrend {
  category: string;
  trend: "up" | "down" | "stable";
  percentage: number;
  description?: string;
}

interface CommerceMarketTrendsProps {
  trends: MarketTrend[];
  title?: string;
}

export default function CommerceMarketTrends({
  trends,
  title = "Tendencias de Mercado",
}: CommerceMarketTrendsProps) {
  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {trends.map((trend, index) => {
            const trendIcon = trend.trend === "up" ? ArrowUpRight : trend.trend === "down" ? ArrowDownRight : TrendingUp;
            const trendColor = trend.trend === "up" ? "text-emerald-600" : trend.trend === "down" ? "text-red-600" : "text-muted-foreground";
            const trendBg = trend.trend === "up" ? "bg-emerald-500/10" : trend.trend === "down" ? "bg-red-500/10" : "bg-muted";

            return (
              <div key={index} className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm">{trend.category}</p>
                    <div className={cn("flex items-center gap-1 text-xs font-medium", trendColor)}>
                      <trendIcon className="h-3 w-3" />
                      {trend.percentage > 0 ? "+" : ""}
                      {trend.percentage}%
                    </div>
                  </div>
                  {trend.description && (
                    <p className="text-xs text-muted-foreground mt-1">{trend.description}</p>
                  )}
                </div>
                <div className={cn("p-2 rounded-lg", trendBg)}>
                  <trendIcon className={cn("h-4 w-4", trendColor)} />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
