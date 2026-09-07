/**
 * CommerceQuickStats — Estadísticas rápidas para el dashboard de Commerce
 *
 * Diseño moderno con estadísticas rápidas del negocio
 */
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, ShoppingCart, Users, Package } from "lucide-react";

interface QuickStat {
  label: string;
  value: string;
  change?: number;
  icon?: any;
  color?: "primary" | "success" | "warning" | "destructive";
}

interface CommerceQuickStatsProps {
  stats: QuickStat[];
}

export default function CommerceQuickStats({ stats }: CommerceQuickStatsProps) {
  const colorClasses = {
    primary: "bg-primary/10 text-primary border-primary/30",
    success: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
    warning: "bg-amber-500/10 text-amber-600 border-amber-500/30",
    destructive: "bg-destructive/10 text-destructive border-destructive/30",
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {stats.map((stat, index) => {
        const Icon = stat.icon || TrendingUp;
        const colorClass = colorClasses[stat.color || "primary"];

        return (
          <Card
            key={index}
            className={`border ${colorClass} transition-all hover:shadow-md`}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-xs font-medium uppercase tracking-wider opacity-80">
                    {stat.label}
                  </p>
                  <p className="text-2xl font-bold font-display mt-1">{stat.value}</p>
                  {stat.change !== undefined && (
                    <p className="text-xs font-medium mt-1 opacity-80">
                      {stat.change > 0 ? "+" : ""}
                      {stat.change}%
                    </p>
                  )}
                </div>
                <Icon className="h-5 w-5 opacity-60 shrink-0" />
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
