import type { LucideIcon } from "lucide-react";
import CommerceDashboardKPICard from "@/components/commerce/CommerceDashboardKPICard";

type DashboardKPI = {
  label: string;
  value: string | number;
  sub?: string;
  icon?: LucideIcon;
  tone?: string;
  live?: boolean;
};

interface DashboardKPIsSectionProps {
  kpiCards: DashboardKPI[];
  liveTodaySales: { total: number; count: number } | null;
  lastWeekSameDaySales: number;
}

export default function DashboardKPIsSection({
  kpiCards,
  liveTodaySales,
  lastWeekSameDaySales,
}: DashboardKPIsSectionProps) {
  const todaySales = liveTodaySales?.total ?? 0;
  const comparison = lastWeekSameDaySales > 0
    ? Number((((todaySales - lastWeekSameDaySales) / lastWeekSameDaySales) * 100).toFixed(1))
    : undefined;

  return (
    <section id="dashboard-overview" aria-labelledby="dashboard-kpis-title" className="mb-6">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase text-primary">Pulso comercial</p>
          <h2 id="dashboard-kpis-title" className="text-base font-semibold">Indicadores para decidir ahora</h2>
        </div>
        <p className="hidden text-xs text-muted-foreground sm:block">Datos de la organizacion activa</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {kpiCards.slice(0, 4).map((card, index) => {
          const change = index === 0 ? comparison : undefined;
          const trend = change === undefined
            ? card.tone === "red" ? "down" : "neutral"
            : change > 0 ? "up" : change < 0 ? "down" : "neutral";

          return (
            <CommerceDashboardKPICard
              key={card.label}
              title={card.label}
              value={card.value}
              description={card.sub}
              icon={card.icon}
              live={card.live}
              change={change}
              trend={trend}
            />
          );
        })}
      </div>
    </section>
  );
}
