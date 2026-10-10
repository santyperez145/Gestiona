/**
 * Encabezado y tarjeta KPI de las páginas por área (Commerce, Business,
 * Finance). Antes había tres copias idénticas que sólo cambiaban el color.
 */
import { LucideIcon, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type Area = "commerce" | "business" | "finance";

const ICONO: Record<Area, string> = {
  commerce: "bg-primary/10 text-primary",
  business: "bg-warning/10 text-warning",
  finance: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
};

const BORDE: Record<Area, string> = {
  commerce: "hover:border-primary/30",
  business: "hover:border-orange-500/30",
  finance: "hover:border-teal-500/30",
};

export interface AreaPageHeaderProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  badge?: string;
}

export function AreaPageHeader({ area, icon: Icon, title, description, actions, badge }: AreaPageHeaderProps & { area: Area }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-start gap-4">
        <div className={cn("p-3 rounded-lg", ICONO[area])}>
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold font-display">{title}</h1>
            {badge && <Badge variant="secondary" className="text-xs">{badge}</Badge>}
          </div>
          {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export interface AreaKPICardProps {
  title: string;
  value: string | number;
  change?: number;
  trend?: "up" | "down" | "neutral";
  icon?: LucideIcon;
  action?: { label: string; onClick: () => void };
  description?: string;
}

export function AreaKPICard({ area, title, value, change, trend = "neutral", icon: Icon, action, description }: AreaKPICardProps & { area: Area }) {
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendColor = trend === "up" ? "text-emerald-600" : trend === "down" ? "text-red-600" : "text-muted-foreground";

  return (
    <Card className={cn("transition-colors", BORDE[area])}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
            <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
          </div>
          {change !== undefined && (
            <div className={cn("flex items-center gap-1 text-xs font-medium", trendColor)}>
              <TrendIcon className="h-3 w-3" />
              {change > 0 ? "+" : ""}{change}%
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between">
          <div>
            <p className="text-2xl font-bold font-display">{value}</p>
            {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
          </div>
          {action && <Button size="sm" variant="ghost" className="h-8" onClick={action.onClick}>{action.label}</Button>}
        </div>
      </CardContent>
    </Card>
  );
}
