/**
 * CommerceMarketTrendAnalysis — Análisis de tendencias de mercado para el dashboard de Commerce
 *
 * Diseño moderno con análisis de tendencias de mercado
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Globe, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface MarketTrend {
  category: string;
  trend: "up" | "down" | "stable";
  percentage: number;
  description?: string;
  impact?: "high" | "medium" | "low";
}

interface CommerceMarketTrendAnalysisProps {
  trends: MarketTrend[];
  title?: string;
}

const impactColors = {
  high: "bg-red-500/10 text-red-600",
  medium: "bg-yellow-500/10 text-yellow-600",
  low: "bg-emerald-500/10 text-emerald-600",
};

export default function CommerceMarketTrendAnalysis({
  trends,
  title = "Análisis de Tendencias de Mercado",
}: CommerceMarketTrendAnalysisProps) {
  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Globe className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {trends.map((trend, index) => {
            const trendIcon = trend.trend === "up" ? ArrowUpRight : trend.trend === "down" ? ArrowDownRight : TrendingUp;
            const trendColor = trend.trend === "up" ? "text-emerald-600" : trend.trend === "down" ? "text-red-600" : "text-muted-foreground";
            const trendBg = trend.trend === "up" ? "bg-emerald-500/10" : trend.trend === "down" ? "bg-red-500/10" : "bg-muted";
            const impactClass = trend.impact ? impactColors[trend.impact] : "";

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
                <div className="flex items-center gap-2">
                  {trend.impact && (
                    <Badge className={`text-xs ${impactClass}`}>
                      {trend.impact === "high" ? "Alto" : trend.impact === "medium" ? "Medio" : "Bajo"} impacto
                    </Badge>
                  )}
                  <div className={cn("p-2 rounded-lg", trendBg)}>
                    <trendIcon className={cn("h-4 w-4", trendColor)} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
