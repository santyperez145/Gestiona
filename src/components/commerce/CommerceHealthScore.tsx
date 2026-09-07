/**
 * CommerceHealthScore — Salud del negocio para el dashboard de Commerce
 *
 * Diseño moderno con indicador de salud del negocio
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Heart, TrendingUp, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface HealthMetric {
  label: string;
  score: number; // 0-100
  status: "excellent" | "good" | "warning" | "critical";
  description?: string;
}

interface CommerceHealthScoreProps {
  metrics: HealthMetric[];
  title?: string;
}

const statusColors = {
  excellent: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30",
  good: "text-green-600 bg-green-500/10 border-green-500/30",
  warning: "text-yellow-600 bg-yellow-500/10 border-yellow-500/30",
  critical: "text-red-600 bg-red-500/10 border-red-500/30",
};

const statusIcons = {
  excellent: CheckCircle2,
  good: TrendingUp,
  warning: AlertTriangle,
  critical: AlertTriangle,
};

export default function CommerceHealthScore({
  metrics,
  title = "Salud del Negocio",
}: CommerceHealthScoreProps) {
  const overallScore = metrics.reduce((sum, m) => sum + m.score, 0) / metrics.length;
  const overallStatus = overallScore >= 80 ? "excellent" : overallScore >= 60 ? "good" : overallScore >= 40 ? "warning" : "critical";
  const StatusIcon = statusIcons[overallStatus];

  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Heart className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Score</p>
            <p className="text-2xl font-bold font-display">{overallScore.toFixed(0)}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Overall status */}
          <div className={cn("p-3 rounded-lg border", statusColors[overallStatus])}>
            <div className="flex items-center gap-2">
              <StatusIcon className="h-5 w-5" />
              <div>
                <p className="font-semibold text-sm">
                  {overallStatus === "excellent" ? "Excelente" : overallStatus === "good" ? "Bueno" : overallStatus === "warning" ? "Advertencia" : "Crítico"}
                </p>
                <p className="text-xs opacity-80">El negocio está en buen estado</p>
              </div>
            </div>
          </div>

          {/* Metrics */}
          <div className="space-y-3">
            {metrics.map((metric, index) => {
              const MetricIcon = statusIcons[metric.status];
              return (
                <div key={index} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MetricIcon className={cn("h-4 w-4", statusColors[metric.status].split(' ')[0])} />
                      <p className="font-medium text-sm">{metric.label}</p>
                    </div>
                    <p className="font-semibold text-sm">{metric.score}/100</p>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        metric.status === "excellent" ? "bg-emerald-600" : metric.status === "good" ? "bg-green-600" : metric.status === "warning" ? "bg-yellow-600" : "bg-red-600"
                      )}
                      style={{ width: `${metric.score}%` }}
                    />
                  </div>
                  {metric.description && (
                    <p className="text-xs text-muted-foreground">{metric.description}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
