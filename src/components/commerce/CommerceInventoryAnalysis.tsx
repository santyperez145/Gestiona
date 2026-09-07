/**
 * CommerceInventoryAnalysis — Análisis de inventario para el dashboard de Commerce
 *
 * Diseño moderno con análisis de inventario y stock
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, TrendingUp, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

interface InventoryMetric {
  label: string;
  value: number;
  total?: number;
  status: "healthy" | "warning" | "critical" | "excellent";
  description?: string;
}

interface CommerceInventoryAnalysisProps {
  metrics: InventoryMetric[];
  title?: string;
}

const statusColors = {
  healthy: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30",
  warning: "text-yellow-600 bg-yellow-500/10 border-yellow-500/30",
  critical: "text-red-600 bg-red-500/10 border-red-500/30",
  excellent: "text-green-600 bg-green-500/10 border-green-500/30",
};

const statusIcons = {
  healthy: CheckCircle2,
  warning: AlertTriangle,
  critical: AlertTriangle,
  excellent: CheckCircle2,
};

export default function CommerceInventoryAnalysis({
  metrics,
  title = "Análisis de Inventario",
}: CommerceInventoryAnalysisProps) {
  const totalValue = metrics.reduce((sum, m) => sum + m.value, 0);
  const totalItems = metrics.reduce((sum, m) => sum + (m.total || 0), 0);

  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-lg font-bold">{totalItems} items</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {metrics.map((metric, index) => {
            const StatusIcon = statusIcons[metric.status];
            const statusClass = statusColors[metric.status];
            const percentage = metric.total ? (metric.value / metric.total) * 100 : 0;

            return (
              <div key={index} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <StatusIcon className={`h-4 w-4 ${statusClass.split(' ')[0]}`} />
                    <p className="font-medium text-sm">{metric.label}</p>
                  </div>
                  <Badge variant="secondary" className={`text-xs ${statusClass.split(' ')[0]}`}>
                    {metric.status === "healthy" ? "Saludable" : metric.status === "warning" ? "Advertencia" : metric.status === "critical" ? "Crítico" : "Excelente"}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {metric.value} / {metric.total || 0} {metric.description || "items"}
                    </span>
                    <span className="font-semibold">{percentage.toFixed(0)}%</span>
                  </div>
                  <Progress value={percentage} className="h-2" />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
