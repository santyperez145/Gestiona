/**
 * CommercePricingAnalysis — Análisis de precios para el dashboard de Commerce
 *
 * Diseño moderno con análisis de precios y estrategias
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, TrendingUp, TrendingDown, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

interface PricingMetric {
  product: string;
  currentPrice: number;
  competitorPrice?: number;
  suggestedPrice?: number;
  margin: number;
  status: "competitive" | "overpriced" | "underpriced" | "optimal";
}

interface CommercePricingAnalysisProps {
  metrics: PricingMetric[];
  title?: string;
}

const statusColors = {
  competitive: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30",
  overpriced: "text-red-600 bg-red-500/10 border-red-500/30",
  underpriced: "text-yellow-600 bg-yellow-500/10 border-yellow-500/30",
  optimal: "text-green-600 bg-green-500/10 border-green-500/30",
};

export default function CommercePricingAnalysis({
  metrics,
  title = "Análisis de Precios",
}: CommercePricingAnalysisProps) {
  const avgMargin = metrics.reduce((sum, m) => sum + m.margin, 0) / metrics.length;

  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Margen promedio</p>
            <p className="text-lg font-bold">{avgMargin.toFixed(1)}%</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {metrics.map((metric, index) => {
            const statusClass = statusColors[metric.status];

            return (
              <div key={index} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <DollarSign className={`h-4 w-4 ${statusClass.split(' ')[0]}`} />
                    <p className="font-medium text-sm">{metric.product}</p>
                  </div>
                  <Badge variant="secondary" className={`text-xs ${statusClass.split(' ')[0]}`}>
                    {metric.status === "competitive" ? "Competitivo" : metric.status === "overpriced" ? "Sobre precio" : metric.status === "underpriced" ? "Bajo precio" : "Óptimo"}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      ${metric.currentPrice.toLocaleString()} {metric.competitorPrice && `vs $${metric.competitorPrice.toLocaleString()}`}
                    </span>
                    {metric.suggestedPrice && (
                      <span className="font-semibold text-primary">
                        Sugerido: ${metric.suggestedPrice.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Margen: {metric.margin.toFixed(1)}%</span>
                    <Progress value={metric.margin} className="h-2" />
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
