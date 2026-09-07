/**
 * CommerceEfficiencyAnalysis — Análisis de eficiencia para el dashboard de Commerce
 *
 * Diseño moderno con análisis de eficiencia operativa
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Zap, Clock, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

interface EfficiencyMetric {
  label: string;
  current: number;
  target?: number;
  unit: string;
  status: "excellent" | "good" | "warning" | "critical";
  description?: string;
}

interface CommerceEfficiencyAnalysisProps {
  metrics: EfficiencyMetric[];
  title?: string;
}

const statusColors = {
  excellent: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30",
  good: "text-green-600 bg-green-500/10 border-green-500/30",
  warning: "text-yellow-600 bg-yellow-500/10 border-yellow-500/30",
  critical: "text-red-600 bg-red-500/10 border-red-500/30",
};

const statusIcons = {
  excellent: Target,
  good: TrendingUp,
  warning: Clock,
  critical: AlertTriangle,
};

export default function CommerceEfficiencyAnalysis({
  metrics,
  title = "Análisis de Eficiencia",
}: CommerceEfficiencyAnalysisProps) {
  const avgEfficiency = metrics.reduce((sum, m) => sum + m.current, 0) / metrics.length;

  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Eficiencia promedio</p>
            <p className="text-lg font-bold">{avgEfficiency.toFixed(0)}%</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {metrics.map((metric, index) => {
            const statusClass = statusColors[metric.status];
            const StatusIcon = statusIcons[metric.status];
            const progress = metric.target ? (metric.current / metric.target) * 100 : metric.current;

            return (
              <div key={index} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusIcon className={`h-4 w-4 ${statusClass.split(' ')[0]}`} />
                    <p className="font-medium text-sm">{metric.label}</p>
                  </div>
                  <Badge variant="secondary" className={`text-xs ${statusClass.split(' ')[0]}`}>
                    {metric.status === "excellent" ? "Excelente" : metric.status === "good" ? "Bueno" : metric.status === "warning" ? "Advertencia" : "Crítico"}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {metric.current} / {metric.target || "∞"} {metric.unit} {metric.description || ""}
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
