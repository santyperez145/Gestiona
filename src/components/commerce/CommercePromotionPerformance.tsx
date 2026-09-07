/**
 * CommercePromotionPerformance — Análisis de rendimiento de promociones para el dashboard de Commerce
 *
 * Diseño moderno con análisis de rendimiento de promociones
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tag, TrendingUp, ShoppingCart, DollarSign, Percent } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

interface PromotionPerformance {
  name: string;
  type: "discount" | "bundle" | "bogo" | "free-shipping";
  usage: number;
  revenue: number;
  conversion: number;
  status: "excellent" | "good" | "warning" | "critical";
  period?: string;
}

interface CommercePromotionPerformanceProps {
  promotions: PromotionPerformance[];
  title?: string;
}

const typeIcons = {
  discount: Tag,
  bundle: ShoppingCart,
  bogo: Tag,
  "free-shipping": TrendingUp,
};

const statusColors = {
  excellent: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30",
  good: "text-green-600 bg-green-500/10 border-green-500/30",
  warning: "text-yellow-600 bg-yellow-500/10 border-yellow-500/30",
  critical: "text-red-600 bg-red-500/10 border-red-500/30",
};

export default function CommercePromotionPerformance({
  promotions,
  title = "Análisis de Rendimiento de Promociones",
}: CommercePromotionPerformanceProps) {
  const totalRevenue = promotions.reduce((sum, p) => sum + p.revenue, 0);
  const avgConversion = promotions.reduce((sum, p) => sum + p.conversion, 0) / promotions.length;

  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Tag className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Conversión promedio</p>
            <p className="text-lg font-bold">{avgConversion.toFixed(1)}%</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {promotions.map((promotion, index) => {
            const Icon = typeIcons[promotion.type];
            const statusClass = statusColors[promotion.status];

            return (
              <div key={index} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`p-2 rounded-lg ${statusClass.split(' ')[0]}`}>
                      <Icon className={`h-4 w-4 ${statusClass.split(' ')[0]}`} />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{promotion.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="secondary" className={`text-xs ${statusClass.split(' ')[0]}`}>
                          {promotion.status === "excellent" ? "Excelente" : promotion.status === "good" ? "Bueno" : promotion.status === "warning" ? "Advertencia" : "Crítico"}
                        </Badge>
                        {promotion.period && (
                          <Badge variant="outline" className="text-xs">
                            {promotion.period}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">${promotion.revenue.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">{promotion.usage} usos</p>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      Conversión: {promotion.conversion}%
                    </span>
                    <span className="font-semibold">${promotion.revenue.toLocaleString()}</span>
                  </div>
                  <Progress value={promotion.conversion} className="h-2" />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
