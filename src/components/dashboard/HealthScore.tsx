import { useMemo } from "react";
import { Heart, Info } from "lucide-react";
import { computeHealthScore } from "@/lib/cashFlow";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export default function HealthScore({
  sales, expenses, debts, products, settings,
}: { sales: any[]; expenses: any[]; debts: any[]; products: any[]; settings: any }) {
  const score = useMemo(() => computeHealthScore({
    sales, expenses, debts, products,
    initialCash: Number(settings?.initial_cash_ars || 0),
    marginAlertPercent: Number(settings?.margin_alert_percent || 30),
  }), [sales, expenses, debts, products, settings]);

  const total = score.total;
  const ringColor = total >= 75 ? 'hsl(var(--success))' : total >= 50 ? 'hsl(var(--warning))' : 'hsl(var(--destructive))';
  const label = total >= 75 ? 'Excelente' : total >= 50 ? 'Aceptable' : total >= 30 ? 'Riesgo' : 'Crítico';
  const dashOffset = 283 - (283 * total) / 100;

  return (
    <div className="bg-card border border-border rounded-xl p-4 md:p-5 shadow-card">
      <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-3 flex items-center gap-1.5">
        <Heart className="w-4 h-4 text-primary" /> Salud Financiera
      </h3>
      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="45" stroke="hsl(var(--muted))" strokeWidth="8" fill="none" />
            <circle
              cx="50" cy="50" r="45" stroke={ringColor} strokeWidth="8" fill="none"
              strokeDasharray="283" strokeDashoffset={dashOffset} strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 1s ease-out' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-display font-bold" style={{ color: ringColor }}>{total}</span>
            <span className="text-[9px] uppercase text-muted-foreground">{label}</span>
          </div>
        </div>
        <div className="flex-1 space-y-1.5">
          {score.components.map(c => (
            <TooltipProvider key={c.label} delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2 cursor-help">
                    <span className="text-[10px] text-muted-foreground w-20 shrink-0">{c.label}</span>
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${c.value}%`, background: c.value >= 75 ? 'hsl(var(--success))' : c.value >= 50 ? 'hsl(var(--warning))' : 'hsl(var(--destructive))' }}
                      />
                    </div>
                    <span className="text-[10px] font-semibold w-10 text-right">{c.raw}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="left" className="text-xs"><p>{c.hint} (peso {c.weight}%)</p></TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ))}
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground/60 mt-3 flex items-center gap-1"><Info className="w-3 h-3" /> Calculado con margen, liquidez, rotación, crecimiento y cobranza.</p>
    </div>
  );
}
