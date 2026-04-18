import { useMemo, useState } from "react";
import { Banknote, ChevronDown, TrendingUp, TrendingDown, Activity } from "lucide-react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { projectCashFlow, type CashFlowWindow } from "@/lib/cashFlow";
import { formatARS } from "@/lib/supabaseStore";

const tooltipStyle = { background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, color: 'hsl(var(--foreground))' };

export default function CashFlowProjector({
  sales, debts, expenses, purchases, settings,
}: { sales: any[]; debts: any[]; expenses: any[]; purchases: any[]; settings: any }) {
  const [activeWindow, setActiveWindow] = useState(30);
  const [showDetail, setShowDetail] = useState(false);

  const initialCash = Number(settings?.initial_cash_ars || 0);
  const warningThreshold = Number(settings?.cash_flow_warning_threshold_ars || 0);

  const windows: CashFlowWindow[] = useMemo(() => {
    return [30, 60, 90].map(d => projectCashFlow({
      initialCash, windowDays: d, sales, debts, expenses, purchases, settings,
    }));
  }, [initialCash, sales, debts, expenses, purchases, settings]);

  const active = windows.find(w => w.days === activeWindow)!;
  const minBalance = Math.min(...active.daily.map(d => d.balance));
  const status = minBalance < warningThreshold ? 'destructive' : minBalance < initialCash * 0.5 ? 'warning' : 'success';
  const statusLabel = status === 'destructive' ? 'Déficit proyectado' : status === 'warning' ? 'Saldo ajustado' : 'Saldo saludable';

  return (
    <div className="bg-card border border-border rounded-xl p-4 md:p-5 shadow-card mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-display font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Banknote className="w-4 h-4 text-primary" /> Proyector de Flujo de Caja
          </h2>
          <p className="text-[11px] text-muted-foreground/70 mt-0.5">
            Caja inicial: {formatARS(initialCash)} · Configurable en Ajustes
          </p>
        </div>
        <div className="flex items-center gap-2">
          {[30, 60, 90].map(d => (
            <button
              key={d}
              onClick={() => setActiveWindow(d)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeWindow === d ? 'bg-primary text-primary-foreground shadow-gold' : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >{d}d</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4">
        {windows.map(w => (
          <button
            key={w.days}
            onClick={() => setActiveWindow(w.days)}
            className={`text-left p-3 rounded-lg border transition-all ${
              activeWindow === w.days ? 'border-primary/50 bg-primary/5' : 'border-border bg-muted/30'
            }`}
          >
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{w.days} días</p>
            <p className={`text-base sm:text-lg font-bold font-display ${w.endingBalance >= initialCash ? 'text-success' : w.endingBalance >= 0 ? 'text-warning' : 'text-destructive'}`}>
              {formatARS(w.endingBalance)}
            </p>
            <p className="text-[10px] text-muted-foreground">Neto: {w.net >= 0 ? '+' : ''}{formatARS(w.net)}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-4 text-center">
        <div className="bg-success/5 rounded-lg p-2.5">
          <p className="text-[10px] uppercase text-muted-foreground flex items-center justify-center gap-1"><TrendingUp className="w-3 h-3 text-success" /> Entradas</p>
          <p className="text-sm font-bold text-success">{formatARS(active.inflows)}</p>
        </div>
        <div className="bg-destructive/5 rounded-lg p-2.5">
          <p className="text-[10px] uppercase text-muted-foreground flex items-center justify-center gap-1"><TrendingDown className="w-3 h-3 text-destructive" /> Salidas</p>
          <p className="text-sm font-bold text-destructive">{formatARS(Math.abs(active.outflows))}</p>
        </div>
        <div className={`${status === 'destructive' ? 'bg-destructive/10' : status === 'warning' ? 'bg-warning/10' : 'bg-success/10'} rounded-lg p-2.5`}>
          <p className="text-[10px] uppercase text-muted-foreground flex items-center justify-center gap-1"><Activity className="w-3 h-3" /> Estado</p>
          <p className={`text-xs font-bold ${status === 'destructive' ? 'text-destructive' : status === 'warning' ? 'text-warning' : 'text-success'}`}>
            {statusLabel}
          </p>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={active.daily}>
          <defs>
            <linearGradient id="cashGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9 }} axisLine={false} interval={Math.floor(active.daily.length / 6)} />
          <YAxis tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }} axisLine={false} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => formatARS(v)} />
          <ReferenceLine y={warningThreshold} stroke="hsl(var(--destructive))" strokeDasharray="4 4" />
          <Area type="monotone" dataKey="balance" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#cashGradient)" />
        </AreaChart>
      </ResponsiveContainer>

      <button
        onClick={() => setShowDetail(s => !s)}
        className="w-full mt-3 flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors py-2"
      >
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showDetail ? 'rotate-180' : ''}`} />
        {showDetail ? 'Ocultar' : 'Ver'} movimientos esperados ({active.movements.length})
      </button>

      {showDetail && (
        <div className="mt-2 max-h-64 overflow-y-auto border-t border-border pt-2 space-y-1">
          {active.movements.slice(0, 50).map((m, i) => (
            <div key={i} className="flex items-center justify-between text-xs py-1 px-2 hover:bg-muted/30 rounded">
              <span className="text-muted-foreground shrink-0 mr-2">{m.date}</span>
              <span className="flex-1 truncate text-[11px]">{m.label}</span>
              <span className={`shrink-0 font-semibold ${m.amount >= 0 ? 'text-success' : 'text-destructive'}`}>
                {m.amount >= 0 ? '+' : ''}{formatARS(m.amount)}
              </span>
            </div>
          ))}
          {active.movements.length > 50 && (
            <p className="text-center text-xs text-muted-foreground py-1">+{active.movements.length - 50} movimientos más</p>
          )}
        </div>
      )}
    </div>
  );
}
