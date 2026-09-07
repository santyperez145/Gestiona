/**
 * CommerceMarketAnalysis — Análisis de mercado para el dashboard de Commerce
 *
 * Diseño moderno con análisis de mercado y posicionamiento
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Globe, TrendingUp, Users, ShoppingBag, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

interface MarketMetric {
  label: string;
  value: number;
  total?: number;
  trend?: "up" | "down" | "neutral";
  description?: string;
}

interface CommerceMarketAnalysisProps {
  metrics: MarketMetric[];
  title?: string;
}

export default function CommerceMarketAnalysis({
  metrics,
  title = "Análisis de Mercado",
}: CommerceMarketAnalysisProps) {
  const totalValue = metrics.reduce((sum, m) => sum + m.value, 0);

  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-lg font-bold">{totalValue.toLocaleString()}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {metrics.map((metric, index) => {
            const trendIcon = metric.trend === "up" ? TrendingUp : metric.trend === "down" ? TrendingUp : TrendingUp;
            const trendColor = metric.trend === "up" ? "text-emerald-600" : metric.trend === "down" ? "text-red-600" : "text-muted-foreground";
            const percentage = metric.total ? (metric.value / metric.total) * 100 : 0;

            return (
              <div key={index} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Target className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{metric.label}</p>
                      {metric.description && (
                        <p className="text-xs text-muted-foreground">{metric.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{metric.value.toLocaleString()}</p>
                    {metric.total && (
                      <Badge variant="secondary" className="text-xs mt-1">
                        {percentage.toFixed(1)}%
                      </Badge>
                    )}
                  </div>
                </div>
                {metric.total && (
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
