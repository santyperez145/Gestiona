/**
 * CommerceCustomerBehavior — Comportamiento de clientes para el dashboard de Commerce
 *
 * Diseño moderno con análisis de comportamiento de clientes
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, TrendingUp, ShoppingCart, Heart, Repeat } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

interface CustomerBehavior {
  segment: string;
  size: number;
  percentage: number;
  avgOrderValue: number;
  frequency: string;
  loyalty: "high" | "medium" | "low";
}

interface CommerceCustomerBehaviorProps {
  segments: CustomerBehavior[];
  title?: string;
}

const loyaltyColors = {
  high: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30",
  medium: "text-yellow-600 bg-yellow-500/10 border-yellow-500/30",
  low: "text-red-600 bg-red-500/10 border-red-500/30",
};

export default function CommerceCustomerBehavior({
  segments,
  title = "Comportamiento de Clientes",
}: CommerceCustomerBehaviorProps) {
  const totalCustomers = segments.reduce((sum, s) => sum + s.size, 0);
  const avgOrderValue = segments.reduce((sum, s) => sum + s.avgOrderValue * s.size, 0) / totalCustomers;

  return (
    <Card className="border-border/50 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            {title}
          </CardTitle>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total clientes</p>
            <p className="text-lg font-bold">{totalCustomers}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {segments.map((segment, index) => {
            const loyaltyClass = loyaltyColors[segment.loyalty];

            return (
              <div key={index} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Users className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{segment.segment}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="secondary" className={`text-xs ${loyaltyClass.split(' ')[0]}`}>
                          {segment.loyalty === "high" ? "Alta" : segment.loyalty === "medium" ? "Media" : "Baja"} lealtad
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {segment.frequency}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{segment.size} clientes</p>
                    <p className="text-xs text-muted-foreground">${segment.avgOrderValue.toLocaleString()} promedio</p>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      {segment.percentage}% del total
                    </span>
                    <span className="font-semibold">{segment.size} clientes</span>
                  </div>
                  <Progress value={segment.percentage} className="h-2" />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
