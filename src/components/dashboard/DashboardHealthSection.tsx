import { AlertTriangle, CheckCircle2, CircleAlert } from "lucide-react";
import { formatARS } from "@/lib/supabaseStore";

interface DashboardHealthSectionProps {
  liveTodaySales: { total: number; count: number } | null;
  avgDailySalesARS: number;
  monthSalesARS: number;
  monthGrossProfit: number;
  outOfStock: number;
  agingCount30: number;
  rawDebts: Array<{ status?: string | null; due_date?: string | null }>;
}

type HealthLevel = "healthy" | "attention" | "critical";

const LEVEL_STYLES: Record<HealthLevel, { label: string; panel: string; dot: string; text: string }> = {
  healthy: {
    label: "Operacion saludable",
    panel: "border-emerald-500/25 bg-emerald-500/5",
    dot: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  attention: {
    label: "Revisar alertas",
    panel: "border-amber-500/30 bg-amber-500/5",
    dot: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-300",
  },
  critical: {
    label: "Requiere atencion",
    panel: "border-destructive/30 bg-destructive/5",
    dot: "bg-destructive",
    text: "text-destructive",
  },
};

function scoreLevel(score: number): HealthLevel {
  return score === 2 ? "healthy" : score === 1 ? "attention" : "critical";
}

export default function DashboardHealthSection({
  liveTodaySales,
  avgDailySalesARS,
  monthSalesARS,
  monthGrossProfit,
  outOfStock,
  agingCount30,
  rawDebts,
}: DashboardHealthSectionProps) {
  const today = new Date().toISOString().slice(0, 10);
  const overdueDebts = rawDebts.filter(debt => debt.status !== "paid" && debt.due_date && debt.due_date < today).length;
  const todaySales = liveTodaySales?.total ?? 0;
  const salesPct = avgDailySalesARS > 0 ? (todaySales / avgDailySalesARS) * 100 : todaySales > 0 ? 100 : 0;
  const margin = monthSalesARS > 0 ? (monthGrossProfit / monthSalesARS) * 100 : 0;

  const signals = [
    { label: "Ventas hoy", value: `${formatARS(todaySales)} · ${salesPct.toFixed(0)}% del promedio`, score: salesPct >= 80 ? 2 : salesPct >= 40 ? 1 : 0 },
    { label: "Stock critico", value: outOfStock === 0 ? "Sin productos agotados" : `${outOfStock} sin stock`, score: outOfStock === 0 ? 2 : outOfStock <= 3 ? 1 : 0 },
    { label: "Deudas vencidas", value: overdueDebts === 0 ? "Sin vencimientos" : `${overdueDebts} vencidas`, score: overdueDebts === 0 ? 2 : overdueDebts <= 2 ? 1 : 0 },
    { label: "Margen del mes", value: `${margin.toFixed(1)}%`, score: margin >= 25 ? 2 : margin >= 10 ? 1 : 0 },
    { label: "Stock sin rotacion", value: agingCount30 === 0 ? "Todo con movimiento" : `${agingCount30} productos en 30 dias`, score: agingCount30 === 0 ? 2 : agingCount30 <= 5 ? 1 : 0 },
  ];
  const overall = scoreLevel(Math.min(...signals.map(signal => signal.score)));
  const style = LEVEL_STYLES[overall];
  const OverallIcon = overall === "healthy" ? CheckCircle2 : overall === "attention" ? CircleAlert : AlertTriangle;

  return (
    <section className={`mb-5 rounded-lg border p-4 ${style.panel}`} aria-labelledby="dashboard-health-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${style.dot}`} />
          <h2 id="dashboard-health-title" className="text-sm font-semibold">Salud operativa</h2>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${style.text}`}>
          <OverallIcon className="h-3.5 w-3.5" /> {style.label}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {signals.map(signal => {
          const signalStyle = LEVEL_STYLES[scoreLevel(signal.score)];
          return (
            <div key={signal.label} className="rounded-md border border-border/70 bg-background/75 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">{signal.label}</p>
              <p className={`mt-1 text-xs font-medium ${signalStyle.text}`}>{signal.value}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
