/**
 * CommerceProfitabilityAnalysis — Análisis de rentabilidad para el dashboard de Commerce
 *
 * Diseño moderno con análisis de rentabilidad y margen
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, DollarSign, Percent, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

interface ProfitabilityMetric {
  label: string;
  value: number;
  target?: number;
  status: "excellent" | "good" | "warning" | "critical";
  description?: string;
}

interface CommerceProfitabilityAnalysisProps {
  metrics: ProfitabilityMetric[];
  title?: string;
}

const statusColors = {
  excellent: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30",
  good: "text-green-600 bg-green-500/10 border-green-500/30",
  warning: "text-yellow-600 bg-yellow-500/10 border-yellow-500/30",
  critical: "text-red-600 bg-red-500/10 border-red-500/30",
};

export default function CommerceProfitabilityAnalysis({
  metrics,
  title = "Análisis de Rentabilidad",
}: CommerceProfitabilityAnalysisProps) {
  const avgMargin = metrics.reduce((sum, m) => sum + m.value, 0) / metrics.length;

  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Percent className="h-4 w-4 text-primary" />
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
            const progress = metric.target ? (metric.value / metric.target) * 100 : metric.value;

            return (
              <div key={index} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Target className={`h-4 w-4 ${statusClass.split(' ')[0]}`} />
                    <p className="font-medium text-sm">{metric.label}</p>
                  </div>
                  <Badge variant="secondary" className={`text-xs ${statusClass.split(' ')[0]}`}>
                    {metric.status === "excellent" ? "Excelente" : metric.status === "good" ? "Bueno" : metric.status === "warning" ? "Advertencia" : "Crítico"}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {metric.value.toFixed(1)}% {metric.target ? `/ ${metric.target}%` : ""} {metric.description || ""}
                    </span>
                    <span className="font-semibold">{progress.toFixed(0)}%</span>
                  </div>
                  <Progress value={progress} className="h-2" />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
