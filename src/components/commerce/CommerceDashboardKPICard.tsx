/**
 * CommerceDashboardKPICard — KPI card tecnológico para el dashboard de Commerce
 *
 * Diseño moderno con gradientes, glassmorphism y animaciones
 */
import { LucideIcon, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface CommerceDashboardKPICardProps {
  title: string;
  value: string | number;
  change?: number;
  trend?: "up" | "down" | "neutral";
  icon?: LucideIcon;
  description?: string;
  highlight?: boolean;
  live?: boolean;
}

export default function CommerceDashboardKPICard({
  title,
  value,
  change,
  trend = "neutral",
  icon: Icon,
  description,
  highlight = false,
  live = false,
}: CommerceDashboardKPICardProps) {
  const TrendIcon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendColor = trend === "up" ? "text-emerald-400" : trend === "down" ? "text-red-400" : "text-muted-foreground";

  return (
    <Card
      className={cn(
        "relative overflow-hidden transition-all duration-300 hover:shadow-lg border-0",
        highlight
          ? "bg-gradient-to-br from-blue-600 via-primary to-cyan-500 text-white shadow-xl"
          : "bg-card border-border/50"
      )}
    >
      {/* Glassmorphism background */}
      {highlight && (
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent" />
      )}

      <CardContent className="relative p-5">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            {Icon && (
              <div
                className={cn(
                  "p-2 rounded-lg",
                  highlight
                    ? "bg-white/10 backdrop-blur-sm"
                    : "bg-primary/10"
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4",
                    highlight ? "text-white" : "text-primary"
                  )}
                />
              </div>
            )}
            <div>
              <p
                className={cn(
                  "text-xs font-medium uppercase tracking-wider",
                  highlight ? "text-white/70" : "text-muted-foreground"
                )}
              >
                {title}
              </p>
              {live && (
                <div className="flex items-center gap-1 mt-1">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                  </span>
                  <span
                    className={cn(
                      "text-[10px]",
                      highlight ? "text-white/60" : "text-muted-foreground"
                    )}
                  >
                    Live
                  </span>
                </div>
              )}
            </div>
          </div>
          {change !== undefined && (
            <div
              className={cn(
                "flex items-center gap-1 text-xs font-medium",
                trendColor,
                highlight && "text-white"
              )}
            >
              <TrendIcon className="h-3 w-3" />
              {change > 0 ? "+" : ""}
              {change}%
            </div>
          )}
        </div>

        <div className="space-y-1">
          <p
            className={cn(
              "text-2xl font-bold font-display",
              highlight ? "text-white" : "text-foreground"
            )}
          >
            {value}
          </p>
          {description && (
            <p
              className={cn(
                "text-xs",
                highlight ? "text-white/60" : "text-muted-foreground"
              )}
            >
              {description}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
