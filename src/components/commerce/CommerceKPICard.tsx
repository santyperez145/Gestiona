/**
 * CommerceKPICard — KPI card estandarizado para Commerce
 *
 * Uso en todas las páginas de Commerce para consistencia visual
 */
import { LucideIcon, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface CommerceKPICardProps {
  title: string;
  value: string | number;
  change?: number;
  trend?: "up" | "down" | "neutral";
  icon?: LucideIcon;
  action?: {
    label: string;
    onClick: () => void;
  };
  description?: string;
}

export default function CommerceKPICard({
  title,
  value,
  change,
  trend = "neutral",
  icon: Icon,
  action,
  description,
}: CommerceKPICardProps) {
  const trendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendColor = trend === "up" ? "text-emerald-600" : trend === "down" ? "text-red-600" : "text-muted-foreground";

  return (
    <Card className="hover:border-primary/30 transition-colors">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
            <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
          </div>
          {change !== undefined && (
            <div className={cn("flex items-center gap-1 text-xs font-medium", trendColor)}>
              <trendIcon className="h-3 w-3" />
              {change > 0 ? "+" : ""}{change}%
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-2xl font-bold font-display">{value}</p>
            {description && (
              <p className="text-xs text-muted-foreground mt-1">{description}</p>
            )}
          </div>
          {action && (
            <Button size="sm" variant="ghost" className="h-8" onClick={action.onClick}>
              {action.label}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
