/**
 * CommerceCustomerInsights — Insights de clientes para el dashboard de Commerce
 *
 * Diseño moderno con análisis de clientes y comportamiento
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, TrendingUp, ShoppingCart, Heart, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface CustomerInsight {
  label: string;
  value: string;
  change?: number;
  trend?: "up" | "down" | "neutral";
  icon?: any;
  description?: string;
}

interface CommerceCustomerInsightsProps {
  insights: CustomerInsight[];
  title?: string;
}

export default function CommerceCustomerInsights({
  insights,
  title = "Insights de Clientes",
}: CommerceCustomerInsightsProps) {
  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {insights.map((insight, index) => {
            const TrendIcon = insight.trend === "up" ? TrendingUp : insight.trend === "down" ? TrendingUp : TrendingUp;
            const trendColor = insight.trend === "up" ? "text-emerald-600" : insight.trend === "down" ? "text-red-600" : "text-muted-foreground";
            const Icon = insight.icon || Users;

            return (
              <div key={index} className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-sm">{insight.label}</p>
                    {insight.description && (
                      <p className="text-xs text-muted-foreground">{insight.description}</p>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{insight.value}</p>
                  {insight.change !== undefined && (
                    <div className="flex items-center gap-1 text-xs font-medium">
                      <TrendIcon className={`h-3 w-3 ${trendColor}`} />
                      <span className={trendColor}>
                        {insight.change > 0 ? "+" : ""}
                        {insight.change}%
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
