import { useEffect, useState, useMemo, useRef } from "react";
import { useExchangeRates } from "@/hooks/useExchangeRates";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useNotifications } from "@/hooks/useNotifications";
import { useAnimatedCounter } from "@/hooks/useAnimatedCounter";
import { useSalesForecaster } from "@/hooks/useSalesForecaster";
import { useRealtimeKPIs } from "@/hooks/useRealtimeKPIs";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { safeChannel } from "@/lib/realtimeChannel";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { getProductsDB, getSalesDB, getPurchasesDB, getDebtsDB, getSettingsDB, getExpensesDB, formatARS, formatUSD, getCategoryLabel, seedProductsForUser, calculateTaxes, getExpenseCategoryLabel, buildExpenseCategories, saveSettingsDB } from "@/lib/supabaseStore";
import { Package, TrendingUp, TrendingDown, AlertCircle, DollarSign, BarChart3, Users, ShoppingBag, AlertTriangle, Bell, Filter, Banknote, Target, SlidersHorizontal, Wallet, Crown, ArrowUp, ArrowDown, Zap, Cake, MessageCircle, Share2, Clock, MessageSquare, CheckCircle2 } from "lucide-react";
import { DashboardSkeleton } from "@/components/shared/PageSkeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid,
  LineChart, Line, Legend, AreaChart, Area,
} from "recharts";
import { Link, useNavigate } from "react-router-dom";
import CashFlowProjector from "@/components/dashboard/CashFlowProjector";
import HealthScore from "@/components/dashboard/HealthScore";
import ConsistencyAlerts from "@/components/dashboard/ConsistencyAlerts";
import AIPrediction from "@/components/dashboard/AIPrediction";
import AIProactiveWidget from "@/components/dashboard/AIProactiveWidget";
import DailyBriefingModal from "@/components/shared/DailyBriefingModal";
import StockHeatmapWidget from "@/components/shared/StockHeatmapWidget";
import { toast } from "sonner";

const CHART_COLORS = ['hsl(40, 70%, 50%)', 'hsl(150, 60%, 40%)', 'hsl(35, 90%, 55%)', 'hsl(0, 70%, 50%)', 'hsl(200, 60%, 50%)', 'hsl(280, 60%, 50%)'];

function SellerGoalsWidget({ sellers, orgId }: { sellers: [string, number][]; orgId: string }) {
  const goalsKey = `gestiona.seller_goals.${orgId}`;
  const [sellerGoals, setSellerGoals] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(goalsKey) || '{}'); } catch { return {}; }
  });
  const [editingSeller, setEditingSeller] = useState<string | null>(null);
  const [goalInput, setGoalInput] = useState("");

  const saveGoal = (name: string) => {
    const v = Number(goalInput);
    if (v > 0) {
      const next = { ...sellerGoals, [name]: v };
      localStorage.setItem(goalsKey, JSON.stringify(next));
      setSellerGoals(next);
    }
    setEditingSeller(null);
  };

  return (
    <div className="mb-5 bg-card border border-border rounded-xl p-4 shadow-card">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
          <Users className="w-4 h-4 text-primary" />Objetivos por vendedor — esta semana
        </h3>
        <span className="text-[10px] text-muted-foreground bg-muted/30 px-2 py-0.5 rounded-full">
          {sellers.length} vendedores
        </span>
      </div>
      <div className="space-y-3 pb-12">
        {sellers.map(([name, total]) => {
          const goal = sellerGoals[name] || 0;
          const pct = goal > 0 ? Math.min(100, Math.round(total / goal * 100)) : 0;
          const barColor = pct >= 100 ? "bg-emerald-500" : pct >= 60 ? "bg-primary" : pct >= 30 ? "bg-yellow-500" : "bg-destructive/60";
          return (
            <div key={name}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium">{name}</span>
                  {pct >= 100 && <span className="text-[10px] text-emerald-400 font-bold">🎉 Meta</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold">{formatARS(total)}</span>
                  {editingSeller === name ? (
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        className="w-24 h-5 text-[10px] bg-background border border-border rounded px-1"
                        type="number"
                        placeholder="Meta semanal…"
                        value={goalInput}
                        onChange={e => setGoalInput(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") saveGoal(name); if (e.key === "Escape") setEditingSeller(null); }}
                      />
                      <button className="text-[10px] text-emerald-400 font-bold px-1" onClick={() => saveGoal(name)}>✓</button>
                      <button className="text-[10px] text-muted-foreground px-1" onClick={() => setEditingSeller(null)}>✕</button>
                    </div>
                  ) : (
                    <button
                      className="text-[10px] text-muted-foreground hover:text-primary transition-colors"
                      onClick={() => { setEditingSeller(name); setGoalInput(goal > 0 ? String(goal) : ""); }}
                    >
                      {goal > 0 ? `/ ${formatARS(goal)} ✏` : "Fijar →"}
                    </button>
                  )}
                </div>
              </div>
              <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                  style={{ width: `${goal > 0 ? pct : 100}%`, opacity: goal > 0 ? 1 : 0.15 }}
                />
              </div>
              {goal > 0 && pct < 100 && (
                <p className="text-[9px] text-muted-foreground mt-0.5">{pct}% · falta {formatARS(goal - total)}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EndOfDayWidget({ sales, debts, orgId }: { sales: any[]; debts: any[]; orgId: string }) {
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const todaySales = sales.filter((s: any) => String(s.date).slice(0, 10) === today);

  if (todaySales.length === 0) return null;

  const totalRevenue = todaySales.reduce((s: number, v: any) => s + Number(v.total_ars || 0), 0);
  const totalProfit = todaySales.reduce((s: number, v: any) => s + Number(v.profit_ars || 0), 0);
  const totalUnits = todaySales.reduce((s: number, v: any) => s + Number(v.quantity || 1), 0);

  // Animated revenue counter — smoothly animates as sales update in real-time
  const animatedRevenue = useAnimatedCounter(totalRevenue, {
    duration: 800,
    easing: "easeOut",
    format: v => `$${Math.round(v).toLocaleString("es-AR")}`,
  }) as string;

  // By seller
  const bySeller: Record<string, { rev: number; count: number }> = {};
  todaySales.forEach((s: any) => {
    const k = s.seller_name || 'Sin asignar';
    if (!bySeller[k]) bySeller[k] = { rev: 0, count: 0 };
    bySeller[k].rev += Number(s.total_ars || 0);
    bySeller[k].count += 1;
  });

  // Top products
  const byProduct: Record<string, { qty: number; rev: number }> = {};
  todaySales.forEach((s: any) => {
    const k = s.product_name || 'Sin nombre';
    if (!byProduct[k]) byProduct[k] = { qty: 0, rev: 0 };
    byProduct[k].qty += Number(s.quantity || 1);
    byProduct[k].rev += Number(s.total_ars || 0);
  });
  const topProducts = Object.entries(byProduct).sort((a, b) => b[1].qty - a[1].qty).slice(0, 5);

  // Payment methods
  const byMethod: Record<string, number> = {};
  todaySales.forEach((s: any) => { const m = s.payment_method || 'otro'; byMethod[m] = (byMethod[m] || 0) + Number(s.total_ars || 0); });

  // New debts today
  const newDebts = debts.filter((d: any) => String(d.date || d.created_at).slice(0, 10) === today && d.status !== 'paid');
  const newDebtTotal = newDebts.reduce((s: number, d: any) => s + Number(d.remaining_ars || d.amount_ars || 0), 0);

  // Paid sales vs fiado
  const fiadoTotal = todaySales.filter((s: any) => !s.paid || s.payment_method === 'fiado').reduce((s: number, v: any) => s + Number(v.total_ars || 0), 0);
  const paidTotal = totalRevenue - fiadoTotal;

  const hour = new Date().getHours();
  const isEvening = hour >= 17;

  return (
    <div className={`mb-5 bg-card border rounded-xl shadow-card ${isEvening ? 'border-primary/30' : 'border-border'}`}>
      <button
        className="w-full flex items-center justify-between p-4 text-left"
        onClick={() => setOpen(v => !v)}
      >
        <div className="flex items-center gap-2">
          <Clock className={`w-4 h-4 ${isEvening ? 'text-primary' : 'text-muted-foreground'}`} />
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Resumen del día · {new Date().toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: 'long' })}
          </span>
          {isEvening && <span className="text-[9px] bg-primary/15 text-primary rounded-full px-2 py-0.5 font-bold">Cierre</span>}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold font-display text-emerald-400 tabular-nums">{animatedRevenue}</span>
          <span className="text-muted-foreground text-xs">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-border px-4 pb-4 space-y-4">
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3">
            {[
              { l: 'Facturado', v: formatARS(totalRevenue), color: 'text-emerald-400' },
              { l: 'Ganancia', v: formatARS(totalProfit), color: totalProfit > 0 ? 'text-emerald-400' : 'text-muted-foreground' },
              { l: 'Unidades vendidas', v: totalUnits, color: 'text-foreground' },
              { l: 'Fiado del día', v: formatARS(fiadoTotal), color: fiadoTotal > 0 ? 'text-destructive' : 'text-muted-foreground' },
            ].map(k => (
              <div key={k.l} className="bg-muted/30 rounded-lg p-3">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1">{k.l}</p>
                <p className={`text-sm font-bold font-display ${k.color}`}>{k.v}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Top productos */}
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Top productos hoy</p>
              <div className="space-y-1.5">
                {topProducts.map(([name, data], i) => (
                  <div key={name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[10px] font-bold text-muted-foreground w-4 shrink-0">#{i + 1}</span>
                      <span className="truncate font-medium">{name}</span>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <span className="text-muted-foreground">{data.qty} u · </span>
                      <span className="font-mono font-semibold text-emerald-400">{formatARS(data.rev)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Por vendedor / método de pago */}
            <div className="space-y-3 pb-12">
              {Object.keys(bySeller).length > 1 && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Por vendedor</p>
                  <div className="space-y-1.5">
                    {Object.entries(bySeller).sort((a, b) => b[1].rev - a[1].rev).map(([name, data]) => (
                      <div key={name} className="flex items-center justify-between text-xs">
                        <span className="truncate font-medium">{name}</span>
                        <span className="font-mono font-semibold ml-2 shrink-0">{data.count} v · {formatARS(data.rev)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Métodos de cobro</p>
                <div className="space-y-1 pb-12">
                  {Object.entries(byMethod).sort((a, b) => b[1] - a[1]).map(([method, amount]) => (
                    <div key={method} className="flex items-center justify-between text-xs">
                      <span className="capitalize text-muted-foreground">{method}</span>
                      <span className="font-mono font-semibold">{formatARS(amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Deudas nuevas */}
          {newDebts.length > 0 && (
            <div className="bg-destructive/8 border border-destructive/20 rounded-lg px-3 py-2.5">
              <p className="text-xs font-medium text-destructive flex items-center gap-1.5 mb-1">
                <AlertCircle className="w-3 h-3" />{newDebts.length} deuda{newDebts.length !== 1 ? 's' : ''} nueva{newDebts.length !== 1 ? 's' : ''} hoy — {formatARS(newDebtTotal)} pendiente
              </p>
              <div className="space-y-0.5">
                {newDebts.slice(0, 3).map((d: any) => (
                  <p key={d.id} className="text-[10px] text-muted-foreground">• {d.customer_name || 'Sin nombre'} — {formatARS(Number(d.remaining_ars || d.amount_ars))}</p>
                ))}
              </div>
            </div>
          )}

          {/* Summary line */}
          <div className="text-[10px] text-muted-foreground flex items-center justify-between pt-1 border-t border-border/40">
            <span>Cobrado efectivo + transf.: {formatARS(paidTotal)}</span>
            <a href="/sales" className="text-primary hover:underline">Ver todas las ventas →</a>
          </div>
        </div>
      )}
    </div>
  );
}

function GaugeChart({ value, max, label, color }: { value: number; max: number; label: string; color: string }) {
  const pct = Math.min(Math.max(value / (max || 1), 0), 1);
  const angle = pct * 180;
  const rad = (angle * Math.PI) / 180;
  const x = 50 + 40 * Math.cos(Math.PI - rad);
  const y = 50 - 40 * Math.sin(Math.PI - rad);
  const largeArc = angle > 90 ? 1 : 0;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 100 60" className="w-full max-w-[160px]">
        <path d="M 10 50 A 40 40 0 0 1 90 50" fill="none" stroke="hsl(220, 15%, 18%)" strokeWidth="8" strokeLinecap="round" />
        {pct > 0 && (
          <path d={`M 10 50 A 40 40 0 ${largeArc} 1 ${x} ${y}`} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" />
        )}
        <text x="50" y="45" textAnchor="middle" className="text-[10px] font-bold" fill="currentColor">{value.toFixed(1)}%</text>
      </svg>
      <span className="text-[10px] text-muted-foreground mt-1">{label}</span>
    </div>
  );
}

function FinancialSection({ stats }: { stats: any }) {
  const [simRate, setSimRate] = useState<number[]>([stats.currentRate || 1695]);
  const currentRate = stats.currentRate || 1695;
  const rateChange = simRate[0] - currentRate;
  const ratePct = currentRate > 0 ? ((rateChange / currentRate) * 100).toFixed(1) : '0';
  const simProducts = (stats.products || []).filter((p: any) => Number(p.sale_price_ars) > 0).map((p: any) => {
    const costARS = Number(p.total_cost_usd) * simRate[0];
    const profit = Number(p.sale_price_ars) - costARS;
    const margin = (profit / Number(p.sale_price_ars)) * 100;
    return { name: p.name, profit, margin };
  });
  const avgSimMargin = simProducts.length > 0 ? simProducts.reduce((s: number, p: any) => s + p.margin, 0) / simProducts.length : 0;
  const losers = simProducts.filter((p: any) => p.profit < 0).length;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6 md:mb-8">
      <div className="bg-card border border-border rounded-xl p-4 md:p-5 shadow-card">
        <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-3 flex items-center gap-1.5"><Banknote className="w-4 h-4 text-emerald-400" />Flujo de Caja Proyectado</h3>
        <div className="space-y-2.5">
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Ventas/mes (proy.)</span><span className="text-emerald-400 font-bold">{formatARS(stats.projectedMonthlySalesARS)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Compras/mes (prom.)</span><span className="text-yellow-400 font-bold">-{formatARS(stats.avgMonthlyPurchasesARS)}</span></div>
          <div className="flex justify-between text-sm border-t border-border pt-2"><span className="font-medium">Flujo neto</span><span className={`font-bold ${stats.projectedCashFlowARS >= 0 ? 'text-emerald-400' : 'text-destructive'}`}>{formatARS(stats.projectedCashFlowARS)}</span></div>
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Ganancia/mes (proy.)</span><span className="text-emerald-400">{formatARS(stats.projectedMonthlyProfitARS)}</span></div>
        </div>
      </div>
      <div className="bg-card border border-border rounded-xl p-4 md:p-5 shadow-card">
        <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-3 flex items-center gap-1.5"><Target className="w-4 h-4 text-primary" />Punto de Equilibrio</h3>
        <div className="text-center py-3"><p className="text-3xl font-black font-display text-primary">{stats.breakEvenUnits}</p><p className="text-xs text-muted-foreground mt-1">unidades/mes para cubrir gastos</p></div>
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between"><span className="text-muted-foreground">Gastos fijos est.</span><span>{formatARS(stats.avgMonthlyPurchasesARS)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Margen prom./unidad</span><span className="text-emerald-400">{formatARS(stats.avgMarginPerUnit)}</span></div>
        </div>
      </div>
      <div className="bg-card border border-border rounded-xl p-4 md:p-5 shadow-card">
        <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-3 flex items-center gap-1.5"><SlidersHorizontal className="w-4 h-4 text-yellow-400" />Simulador Tipo de Cambio</h3>
        <div className="space-y-3 pb-12">
          <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">TC Simulado:</span><span className="font-bold">${simRate[0].toLocaleString('es-AR')}</span></div>
          <Slider value={simRate} onValueChange={setSimRate} min={Math.round(currentRate * 0.7)} max={Math.round(currentRate * 1.5)} step={10} className="w-full" />
          <div className="flex justify-between text-[10px] text-muted-foreground"><span>-30%</span><span className={`font-bold ${rateChange > 0 ? 'text-destructive' : rateChange < 0 ? 'text-emerald-400' : ''}`}>{rateChange > 0 ? '+' : ''}{ratePct}%</span><span>+50%</span></div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between"><span className="text-muted-foreground">Margen prom.</span><span className={avgSimMargin > 20 ? 'text-emerald-400 font-bold' : 'text-destructive font-bold'}>{avgSimMargin.toFixed(1)}%</span></div>
            {losers > 0 && <p className="text-destructive text-[10px] font-medium flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{losers} productos a pérdida con este TC</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  usePageTitle("Dashboard");
  const navigate = useNavigate();
  const { user } = useAuth();
  const { permission, notify } = useNotifications();
  const { online, offlineSince, connection } = useNetworkStatus();
  const [rawData, setRawData] = useState<{ products: any[]; sales: any[]; purchases: any[]; debts: any[]; settings: any; expenses: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterCat, setFilterCat] = useState('all');
  const [reloadKey, setReloadKey] = useState(0);
  const [liveTodaySales, setLiveTodaySales] = useState<{ total: number; count: number } | null>(null);
  const [noSalesAlertDismissed, setNoSalesAlertDismissed] = useState<boolean>(() => sessionStorage.getItem('gestiona.no_sales_dismissed') === new Date().toISOString().slice(0, 10));
  const [birthdayCustomers, setBirthdayCustomers] = useState<{ name: string; phone?: string; birthday: string; daysUntil: number }[]>([]);
  const [urgentTasks, setUrgentTasks] = useState<{ id: string; title: string; priority: string; due_date: string | null }[]>([]);
  const [todayTasks, setTodayTasks] = useState<{ id: string; title: string; priority: string; due_date: string | null }[]>([]);
  const [pipelineStats, setPipelineStats] = useState<{ total: number; won: number; lost: number; active: number; wonValue: number; totalValue: number } | null>(null);
  const [atRiskCustomers, setAtRiskCustomers] = useState<{ name: string; daysSince: number; totalSpent: number }[]>([]);
  const [monthlyTarget, setMonthlyTarget] = useState<number>(() => {
    const key = `gestiona.dashboard.monthly_target.${new Date().getFullYear()}.${new Date().getMonth()}`;
    return Number(localStorage.getItem(key) || 0);
  });
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetInput, setTargetInput] = useState("");
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [dolarRates, setDolarRates] = useState<{ blue: number; oficial: number; mep: number } | null>(null);
  const [openCashSession, setOpenCashSession] = useState<{ id: string; opened_at: string } | null>(null);
  const [noSalesDismissed, setNoSalesDismissed] = useState(() =>
    !!sessionStorage.getItem(`gestiona.no_sales_alert.${new Date().toISOString().slice(0, 10)}`)
  );
  const [lastWeekSameDaySales, setLastWeekSameDaySales] = useState<number>(0);
  const { activeOrg: orgForWeekly } = useOrg();
  const weeklyTargetKey = `gestiona.dashboard.weekly_target.${orgForWeekly?.id || 'default'}`;
  const [weeklyTarget, setWeeklyTarget] = useState<number>(() => Number(localStorage.getItem(`gestiona.dashboard.weekly_target.${typeof localStorage !== 'undefined' ? (localStorage.getItem('gestiona.activeOrgId') || 'default') : 'default'}`) || 0));
  const [editingWeeklyTarget, setEditingWeeklyTarget] = useState(false);
  const [weeklyTargetInput, setWeeklyTargetInput] = useState("");

  // Monthly AI summary (cached in localStorage, refreshed once per month)
  const monthlySummaryKey = `gestiona.monthly_summary.${orgForWeekly?.id || 'default'}.${new Date().getFullYear()}.${new Date().getMonth()}`;
  const [monthlySummary, setMonthlySummary] = useState<string>(() => localStorage.getItem(monthlySummaryKey) || '');
  const [monthlySummaryDismissed, setMonthlySummaryDismissed] = useState<boolean>(() => localStorage.getItem(monthlySummaryKey + '.dismissed') === '1');
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [briefingOpen, setBriefingOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      await seedProductsForUser(user.id);
      const [products, sales, purchases, debts, settings, expenses] = await Promise.all([
        getProductsDB(user.id), getSalesDB(user.id), getPurchasesDB(user.id), getDebtsDB(user.id), getSettingsDB(user.id), getExpensesDB(user.id),
      ]);
      setRawData({ products, sales, purchases, debts, settings, expenses });
      setLoading(false);
    })();
  }, [user, reloadKey]);

  // Live dollar rates — shared hook with 15-min sessionStorage cache
  const { rates: liveExchangeRates, refresh: refreshRates } = useExchangeRates(true);
  useEffect(() => {
    if (liveExchangeRates) {
      setDolarRates({ blue: liveExchangeRates.blue, oficial: liveExchangeRates.oficial, mep: liveExchangeRates.mep });
    }
  }, [liveExchangeRates]);

  // Birthday reminders: customers with birthday in next 7 days
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from('customers').select('name, phone, birthday').not('birthday', 'is', null);
      if (!data?.length) return;
      const today = new Date();
      const upcoming: { name: string; phone?: string; birthday: string; daysUntil: number }[] = [];
      for (const c of data) {
        if (!c.birthday) continue;
        const [, mm, dd] = c.birthday.split('-').map(Number);
        const next = new Date(today.getFullYear(), mm - 1, dd);
        if (next < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
          next.setFullYear(today.getFullYear() + 1);
        }
        const diff = Math.round((next.getTime() - today.getTime()) / 86400000);
        if (diff <= 7) upcoming.push({ name: c.name, phone: c.phone, birthday: c.birthday, daysUntil: diff });
      }
      upcoming.sort((a, b) => a.daysUntil - b.daysUntil);
      setBirthdayCustomers(upcoming);
    })();
  }, [user]);

  // Urgent/overdue tasks widget + tasks due today
  const { activeOrg: orgForTasks, activeOrg } = useOrg();
  useEffect(() => {
    if (!orgForTasks) return;
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [urgentRes, todayRes] = await Promise.all([
        supabase
          .from("tasks")
          .select("id, title, priority, due_date")
          .eq("org_id", orgForTasks.id)
          .in("status", ["pending", "in_progress"])
          .in("priority", ["urgent", "high"])
          .order("priority")
          .order("due_date", { nullsFirst: false })
          .limit(5),
        supabase
          .from("tasks")
          .select("id, title, priority, due_date")
          .eq("org_id", orgForTasks.id)
          .in("status", ["pending", "in_progress"])
          .eq("due_date", today)
          .order("priority")
          .limit(8),
      ]);
      setUrgentTasks(urgentRes.data || []);
      // Today's tasks: exclude those already shown in urgent widget
      const urgentIds = new Set((urgentRes.data || []).map((t: any) => t.id));
      setTodayTasks((todayRes.data || []).filter((t: any) => !urgentIds.has(t.id)));
    })();
  }, [orgForTasks]);

  // At-risk customers: bought before but not in 60+ days
  useEffect(() => {
    if (!rawData?.sales?.length) return;
    const now = Date.now();
    const lastPurchase: Record<string, { ts: number; total: number }> = {};
    rawData.sales.forEach((s: any) => {
      if (!s.customer_name) return;
      const ts = new Date(s.date).getTime();
      const prev = lastPurchase[s.customer_name];
      if (!prev || ts > prev.ts) {
        lastPurchase[s.customer_name] = { ts, total: (prev?.total || 0) + Number(s.total_ars) };
      } else {
        lastPurchase[s.customer_name].total += Number(s.total_ars);
      }
    });
    const atRisk = Object.entries(lastPurchase)
      .map(([name, { ts, total }]) => ({ name, daysSince: Math.floor((now - ts) / 86400000), totalSpent: total }))
      .filter(c => c.daysSince >= 60 && c.daysSince < 180)
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, 5);
    setAtRiskCustomers(atRisk);
  }, [rawData]);

  // Upcoming debts: due in next 7 days
  const upcomingDebts = useMemo(() => {
    if (!rawData?.debts) return [];
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const in7 = new Date(now); in7.setDate(now.getDate() + 7);
    return rawData.debts
      .filter((d: any) => d.status === "pending" && d.due_date)
      .map((d: any) => ({ ...d, dueTs: new Date(d.due_date).getTime() }))
      .filter((d: any) => d.dueTs >= now.getTime() && d.dueTs <= in7.getTime())
      .sort((a: any, b: any) => a.dueTs - b.dueTs)
      .slice(0, 5);
  }, [rawData]);

  // Pipeline conversion stats
  useEffect(() => {
    if (!orgForTasks) return;
    (async () => {
      const { data } = await supabase.from("deals").select("stage, value_ars").eq("org_id", orgForTasks.id);
      if (!data?.length) return;
      const won = data.filter(d => d.stage === "cerrado");
      const lost = data.filter(d => d.stage === "perdido");
      const active = data.filter(d => d.stage !== "cerrado" && d.stage !== "perdido");
      setPipelineStats({
        total: data.length,
        won: won.length,
        lost: lost.length,
        active: active.length,
        wonValue: won.reduce((s, d) => s + (d.value_ars || 0), 0),
        totalValue: data.reduce((s, d) => s + (d.value_ars || 0), 0),
      });
    })();
  }, [orgForTasks]);

  // Realtime: subscribe to today's sales updates
  useEffect(() => {
    if (!user) return;
    const today = new Date().toISOString().slice(0, 10);

    // subscribe
    const channel = safeChannel('dashboard-sales-realtime', user.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sales' }, (payload) => {
        const row = payload.new as { date?: string; total_ars?: number };
        const rowDate = row.date ? String(row.date).slice(0, 10) : '';
        if (rowDate !== today) return;
        setLiveTodaySales(prev => {
          const base = prev ?? { total: 0, count: 0 };
          return { total: base.total + Number(row.total_ars || 0), count: base.count + 1 };
        });
      })
      .subscribe();

    channelRef.current = channel;
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  // Check for open cash session
  useEffect(() => {
    if (!orgForTasks) return;
    supabase.from('cash_sessions').select('id, opened_at').eq('org_id', orgForTasks.id).eq('status', 'open').maybeSingle()
      .then(({ data }) => setOpenCashSession(data || null));
  }, [orgForTasks]);

  const [showTodayDetail, setShowTodayDetail] = useState(false);

  // Seed liveTodaySales + last-week same-day comparison from initial data load
  useEffect(() => {
    if (!rawData) return;
    const today = new Date().toISOString().slice(0, 10);
    const lastWeekDay = new Date(); lastWeekDay.setDate(lastWeekDay.getDate() - 7);
    const lastWeekStr = lastWeekDay.toISOString().slice(0, 10);
    const todaySales = rawData.sales.filter((s: any) => String(s.date).slice(0, 10) === today);
    const lwSales = rawData.sales.filter((s: any) => String(s.date).slice(0, 10) === lastWeekStr);
    setLiveTodaySales({
      total: todaySales.reduce((sum: number, s: any) => sum + Number(s.total_ars), 0),
      count: todaySales.length,
    });
    setLastWeekSameDaySales(lwSales.reduce((sum: number, s: any) => sum + Number(s.total_ars), 0));
  }, [rawData]);

  const todayDetail = useMemo(() => {
    if (!rawData?.sales) return null;
    const today = new Date().toISOString().slice(0, 10);
    const todaySales = rawData.sales.filter((s: any) => String(s.date).slice(0, 10) === today);
    if (!todaySales.length) return null;
    const avgTicket = todaySales.reduce((s: number, sale: any) => s + Number(sale.total_ars), 0) / todaySales.length;
    const methodCount: Record<string, number> = {};
    todaySales.forEach((s: any) => { const m = s.payment_method || "otro"; methodCount[m] = (methodCount[m] || 0) + 1; });
    const dominantMethod = Object.entries(methodCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    const productCount: Record<string, number> = {};
    todaySales.forEach((s: any) => { const n = s.product_name || "Sin nombre"; productCount[n] = (productCount[n] || 0) + (s.quantity || 1); });
    const topProduct = Object.entries(productCount).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    return { avgTicket, dominantMethod, topProduct, count: todaySales.length };
  }, [rawData]);

  // Weekly comparison: this week Mon–today vs same period last week
  const weeklyComparison = useMemo(() => {
    if (!rawData?.sales) return null;
    const today = new Date();
    const dayOfWeek = today.getDay() === 0 ? 6 : today.getDay() - 1; // Mon=0 … Sun=6
    const thisMonday = new Date(today); thisMonday.setDate(today.getDate() - dayOfWeek); thisMonday.setHours(0, 0, 0, 0);
    const lastMonday = new Date(thisMonday); lastMonday.setDate(thisMonday.getDate() - 7);
    const lastSameDay = new Date(lastMonday); lastSameDay.setDate(lastMonday.getDate() + dayOfWeek);

    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const thisMon = fmt(thisMonday);
    const lastMon = fmt(lastMonday);
    const lastSame = fmt(lastSameDay);

    const thisSales = rawData.sales.filter((s: any) => s.date >= thisMon && s.date <= fmt(today));
    const lastSales = rawData.sales.filter((s: any) => s.date >= lastMon && s.date <= lastSame);

    const thisTotal = thisSales.reduce((s: number, r: any) => s + Number(r.total_ars), 0);
    const lastTotal = lastSales.reduce((s: number, r: any) => s + Number(r.total_ars), 0);
    const thisUnits = thisSales.reduce((s: number, r: any) => s + Number(r.quantity || 1), 0);
    const lastUnits = lastSales.reduce((s: number, r: any) => s + Number(r.quantity || 1), 0);

    const diff = lastTotal > 0 ? ((thisTotal - lastTotal) / lastTotal) * 100 : 0;
    const unitDiff = lastUnits > 0 ? ((thisUnits - lastUnits) / lastUnits) * 100 : 0;

    // Top product this week
    const prodMap: Record<string, number> = {};
    thisSales.forEach((s: any) => { const n = s.product_name || "—"; prodMap[n] = (prodMap[n] || 0) + Number(s.total_ars || 0); });
    const topProd = Object.entries(prodMap).sort(([, a], [, b]) => b - a)[0]?.[0] || null;

    return { thisTotal, lastTotal, thisUnits, lastUnits, diff, unitDiff, topProd, dayOfWeek };
  }, [rawData]);

  // Dynamic categories derived from actual products — no hardcoding per business type
  const categories = useMemo(() => {
    if (!rawData?.products.length) return [{ value: 'all', label: 'Todas las categorías' }];
    const seen = new Set<string>();
    const cats: { value: string; label: string }[] = [{ value: 'all', label: 'Todas las categorías' }];
    rawData.products.forEach((p: any) => {
      if (p.category && !seen.has(p.category)) {
        seen.add(p.category);
        cats.push({ value: p.category, label: getCategoryLabel(p.category) });
      }
    });
    return cats;
  }, [rawData]);

  const stats = useMemo(() => {
    if (!rawData) return null;
    const { products: allProducts, sales: allSales, purchases: allPurchases, debts, settings, expenses } = rawData;

    // Filter by category: get product IDs in category, then filter sales/purchases
    const products = filterCat === 'all' ? allProducts : allProducts.filter(p => p.category === filterCat);
    const productIds = new Set(products.map(p => p.id));
    const sales = filterCat === 'all' ? allSales : allSales.filter(s => productIds.has(s.product_id));
    const purchases = filterCat === 'all' ? allPurchases : allPurchases.filter(p => productIds.has(p.product_id));

    const pendingDebts = debts.filter((d: any) => d.status !== 'paid');
    const totalSalesARS = sales.reduce((s: number, v: any) => s + Number(v.total_ars), 0);
    const grossProfitARS = sales.reduce((s: number, v: any) => s + Number(v.profit_ars), 0);
    const grossProfitUSD = sales.reduce((s: number, v: any) => s + Number(v.profit_usd), 0);
    const totalPurchasesUSD = purchases.reduce((s: number, c: any) => s + Number(c.total_usd), 0);
    const totalPurchasesARS = purchases.reduce((s: number, c: any) => s + Number(c.total_ars), 0);

    const taxes = calculateTaxes(grossProfitARS, settings);

    // Products by sales
    const productSales: Record<string, any> = {};
    sales.forEach((s: any) => {
      if (!productSales[s.product_id]) productSales[s.product_id] = { qty: 0, revenue: 0, name: s.product_name, profit: 0 };
      productSales[s.product_id].qty += s.quantity;
      productSales[s.product_id].revenue += Number(s.total_ars);
      productSales[s.product_id].profit += Number(s.profit_ars);
    });
    const topProducts = Object.values(productSales).sort((a: any, b: any) => b.revenue - a.revenue).slice(0, 5);

    // Monthly data
    const monthMap: Record<string, any> = {};
    sales.forEach((s: any) => {
      const d = new Date(s.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthMap[key]) monthMap[key] = { total: 0, profit: 0, count: 0, costARS: 0, expenses: 0 };
      monthMap[key].total += Number(s.total_ars);
      monthMap[key].profit += Number(s.profit_ars);
      monthMap[key].count += s.quantity;
      monthMap[key].costARS += Number(s.cost_per_unit_usd) * Number(settings.exchange_rate) * s.quantity;
    });
    // Add expenses to monthly map
    expenses.forEach((e: any) => {
      const d = new Date(e.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthMap[key]) monthMap[key] = { total: 0, profit: 0, count: 0, costARS: 0, expenses: 0 };
      monthMap[key].expenses += Number(e.amount_ars);
    });
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const salesByMonth = Object.entries(monthMap).sort(([a], [b]) => a.localeCompare(b)).slice(-6).map(([m, data]: any) => {
      const [y, mo] = m.split('-');
      return {
        month: `${monthNames[parseInt(mo) - 1]} ${y.slice(2)}`,
        total: data.total, profit: data.profit, count: data.count,
        margin: data.total > 0 ? (data.profit / data.total * 100) : 0,
        expenses: data.expenses || 0,
        netProfit: (data.profit || 0) - (data.expenses || 0),
      };
    });

    // Category breakdown (use all products for pie chart, not filtered)
    const catMap: Record<string, { revenue: number; profit: number; count: number }> = {};
    allSales.forEach((s: any) => {
      const prod = allProducts.find((p: any) => p.id === s.product_id);
      const cat = prod ? getCategoryLabel(prod.category) : 'Otro';
      if (!catMap[cat]) catMap[cat] = { revenue: 0, profit: 0, count: 0 };
      catMap[cat].revenue += Number(s.total_ars);
      catMap[cat].profit += Number(s.profit_ars);
      catMap[cat].count += s.quantity;
    });

    // Daily sales for the last 30 days
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const dailyMap: Record<string, { total: number; profit: number }> = {};
    sales.forEach((s: any) => {
      const d = new Date(s.date);
      if (d >= thirtyDaysAgo) {
        const key = d.toISOString().slice(0, 10);
        if (!dailyMap[key]) dailyMap[key] = { total: 0, profit: 0 };
        dailyMap[key].total += Number(s.total_ars);
        dailyMap[key].profit += Number(s.profit_ars);
      }
    });
    const dailySales = Object.entries(dailyMap).sort(([a], [b]) => a.localeCompare(b)).map(([date, data]) => ({
      date: new Date(date).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }),
      ...data,
    }));

    const customers = new Set(sales.filter((s: any) => s.customer_name).map((s: any) => s.customer_name));
    const inventoryValueUSD = products.reduce((s: number, p: any) => s + (Number(p.total_cost_usd) * p.stock), 0);
    const totalStock = products.reduce((s: number, p: any) => s + p.stock, 0);
    const profitMargin = totalSalesARS > 0 ? (grossProfitARS / totalSalesARS) * 100 : 0;
    const roi = totalPurchasesUSD > 0 ? (grossProfitUSD / totalPurchasesUSD) * 100 : 0;

    const paidSalesARS = sales.filter((s: any) => s.paid).reduce((s: number, v: any) => s + Number(v.total_ars), 0);
    const unpaidSalesARS = sales.filter((s: any) => !s.paid).reduce((s: number, v: any) => s + Number(v.total_ars), 0);

    const lowStockThreshold = Number(settings.low_stock_threshold ?? 3);
    const marginAlertPct = Number(settings.margin_alert_percent ?? 30);
    const expenseRatioAlertPct = Number(settings.expense_ratio_alert_percent ?? 40);
    const lowStockProducts = products.filter((p: any) => p.stock > 0 && p.stock <= lowStockThreshold);
    const outOfStockProducts = products.filter((p: any) => p.stock <= 0);

    // Margin rankings
    const productsWithMargin = products.filter((p: any) => Number(p.sale_price_ars) > 0).map((p: any) => ({
      name: p.name,
      margin: (Number(p.profit_per_unit_ars) / Number(p.sale_price_ars)) * 100,
      profitARS: Number(p.profit_per_unit_ars),
      salePrice: Number(p.sale_price_ars),
      costUSD: Number(p.total_cost_usd),
    }));
    const topMarginProducts = [...productsWithMargin].sort((a, b) => b.margin - a.margin).slice(0, 5);
    const lowMarginProducts = [...productsWithMargin].filter(p => p.margin > 0 && p.margin < marginAlertPct).sort((a, b) => a.margin - b.margin).slice(0, 5);
    const minPriceForMargin = (costUSD: number, targetMargin: number) => {
      const costARS = costUSD * Number(settings.exchange_rate);
      return costARS / (1 - targetMargin / 100);
    };

    // Sales velocity over last 60 days for restock suggestions
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000);
    const recentSales60 = allSales.filter((s: any) => new Date(s.date) >= sixtyDaysAgo);
    const velocity60: Record<string, number> = {};
    recentSales60.forEach((s: any) => { velocity60[s.product_id] = (velocity60[s.product_id] || 0) + Number(s.quantity); });

    const restockSuggestions = Object.entries(productSales)
      .map(([id, data]: any) => {
        const prod = products.find((p: any) => p.id === id);
        if (!prod) return null;
        const unitsPerDay = (velocity60[id] || 0) / 60;
        const daysOfStock = unitsPerDay > 0 ? Math.floor(prod.stock / unitsPerDay) : Infinity;
        const suggestedOrder = Math.max(0, Math.round(unitsPerDay * 30 * 1.5) - prod.stock);
        return { name: prod.name, stock: prod.stock, soldQty: data.qty, revenue: data.revenue, unitsPerDay, daysOfStock, suggestedOrder };
      })
      .filter((r: any) => r && r.stock <= lowStockThreshold)
      .sort((a: any, b: any) => b.soldQty - a.soldQty)
      .slice(0, 5);

    // Financial projections
    const daysWithSales = new Set(sales.map((s: any) => new Date(s.date).toISOString().slice(0, 10))).size;
    const avgDailySalesARS = daysWithSales > 0 ? totalSalesARS / Math.max(daysWithSales, 1) : 0;
    const avgDailyProfitARS = daysWithSales > 0 ? grossProfitARS / Math.max(daysWithSales, 1) : 0;
    const projectedMonthlySalesARS = avgDailySalesARS * 30;
    const projectedMonthlyProfitARS = avgDailyProfitARS * 30;
    const avgMonthlyPurchasesARS = totalPurchasesARS > 0 ? totalPurchasesARS / Math.max(Object.keys(monthMap).length, 1) : 0;
    const projectedCashFlowARS = projectedMonthlySalesARS - avgMonthlyPurchasesARS;
    
    // Break-even
    const avgMarginPerUnit = sales.length > 0 ? grossProfitARS / sales.reduce((s: number, v: any) => s + v.quantity, 0) : 0;
    const fixedCostsEstimate = avgMonthlyPurchasesARS;
    const breakEvenUnits = avgMarginPerUnit > 0 ? Math.ceil(fixedCostsEstimate / avgMarginPerUnit) : 0;

    // Exchange rate impact data
    const currentRate = Number(settings.exchange_rate);
    const totalCostUSDInInventory = products.reduce((s: number, p: any) => s + Number(p.total_cost_usd), 0);

    // ===== EXPENSES (current month) =====
    const nowD = new Date();
    const curY = nowD.getFullYear(); const curM = nowD.getMonth();
    const monthExpenses = (expenses || []).filter((e: any) => {
      const d = new Date(e.date); return d.getFullYear() === curY && d.getMonth() === curM;
    });
    const totalMonthExpenses = monthExpenses.reduce((s: number, e: any) => s + Number(e.amount_ars), 0);
    const expenseCats = buildExpenseCategories(settings);
    const expensesByCat: Record<string, number> = {};
    monthExpenses.forEach((e: any) => { expensesByCat[e.category] = (expensesByCat[e.category] || 0) + Number(e.amount_ars); });
    const expensesChartData = Object.entries(expensesByCat).map(([cat, value]) => ({
      name: getExpenseCategoryLabel(cat, settings), value,
      color: expenseCats.find(c => c.value === cat)?.color || 'hsl(220,10%,55%)',
    }));

    // Net profit: gross - expenses - taxes (if enabled)
    // ===== This week sales =====
    const weekNow = new Date();
    const weekStart = new Date(weekNow); weekStart.setDate(weekNow.getDate() - weekNow.getDay()); weekStart.setHours(0, 0, 0, 0);
    const weekSalesARS = sales.filter((s: any) => new Date(s.date) >= weekStart).reduce((a: number, s: any) => a + Number(s.total_ars), 0);

    const monthSales = sales.filter((s: any) => { const d = new Date(s.date); return d.getFullYear() === curY && d.getMonth() === curM; });
    const monthGrossProfit = monthSales.reduce((s: number, v: any) => s + Number(v.profit_ars), 0);
    const monthSalesARS = monthSales.reduce((s: number, v: any) => s + Number(v.total_ars), 0);
    const monthTaxes = settings.tax_enabled ? calculateTaxes(monthGrossProfit, settings).totalTax : 0;
    const netMonthProfitARS = monthGrossProfit - totalMonthExpenses - monthTaxes;

    // ===== Month-over-month growth =====
    const prevDate = new Date(curY, curM - 1, 1);
    const prevY = prevDate.getFullYear(); const prevM = prevDate.getMonth();
    const prevSales = sales.filter((s: any) => { const d = new Date(s.date); return d.getFullYear() === prevY && d.getMonth() === prevM; });
    const prevSalesARS = prevSales.reduce((s: number, v: any) => s + Number(v.total_ars), 0);
    const prevProfit = prevSales.reduce((s: number, v: any) => s + Number(v.profit_ars), 0);
    const salesGrowth = prevSalesARS > 0 ? ((monthSalesARS - prevSalesARS) / prevSalesARS) * 100 : (monthSalesARS > 0 ? 100 : 0);
    const profitGrowth = prevProfit > 0 ? ((monthGrossProfit - prevProfit) / prevProfit) * 100 : (monthGrossProfit > 0 ? 100 : 0);
    // Prev month expenses
    const prevMonthExpenses = (expenses || []).filter((e: any) => {
      const d = new Date(e.date); return d.getFullYear() === prevY && d.getMonth() === prevM;
    });
    const prevTotalMonthExpenses = prevMonthExpenses.reduce((s: number, e: any) => s + Number(e.amount_ars), 0);

    // YoY: same month last year
    const yoyY = curY - 1;
    const yoySales = sales.filter((s: any) => { const d = new Date(s.date); return d.getFullYear() === yoyY && d.getMonth() === curM; });
    const yoySalesARS = yoySales.reduce((s: number, v: any) => s + Number(v.total_ars), 0);
    const yoyGrowth = yoySalesARS > 0 ? ((monthSalesARS - yoySalesARS) / yoySalesARS) * 100 : 0;

    // ===== Top products this month vs prev month =====
    const monthProdMap: Record<string, { name: string; qty: number; revenue: number }> = {};
    monthSales.forEach((s: any) => {
      const k = s.product_name || "?";
      if (!monthProdMap[k]) monthProdMap[k] = { name: k, qty: 0, revenue: 0 };
      monthProdMap[k].qty += Number(s.quantity);
      monthProdMap[k].revenue += Number(s.total_ars);
    });
    const prevMonthProdMap: Record<string, number> = {};
    prevSales.forEach((s: any) => {
      const k = s.product_name || "?";
      prevMonthProdMap[k] = (prevMonthProdMap[k] || 0) + Number(s.total_ars);
    });
    const topMonthProducts = Object.values(monthProdMap)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5)
      .map(p => ({ ...p, prevRevenue: prevMonthProdMap[p.name] || 0 }));

    // ===== Top customers (this month) =====
    const custMap: Record<string, { total: number; count: number }> = {};
    monthSales.forEach((s: any) => {
      const name = s.customer_name || 'Sin nombre';
      if (!custMap[name]) custMap[name] = { total: 0, count: 0 };
      custMap[name].total += Number(s.total_ars); custMap[name].count++;
    });
    const topCustomers = Object.entries(custMap).sort((a, b) => b[1].total - a[1].total).slice(0, 5)
      .map(([name, d]) => ({ name, ...d }));

    // ===== Sales by channel (source) this month =====
    const channelMap: Record<string, number> = {};
    monthSales.forEach((s: any) => {
      const src = s.source || "manual";
      channelMap[src] = (channelMap[src] || 0) + Number(s.total_ars);
    });
    const salesByChannel = Object.entries(channelMap)
      .sort(([, a], [, b]) => b - a)
      .map(([source, total]) => ({ source, total }));

    // ===== Aging inventory (stock > 0, no sale in last 30 days) =====
    const thirtyDaysAgoStr = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const soldLast30 = new Set(
      allSales.filter((s: any) => String(s.date).slice(0, 10) >= thirtyDaysAgoStr).map((s: any) => s.product_id)
    );
    const agingCount30 = products.filter((p: any) => p.stock > 0 && !soldLast30.has(p.id)).length;

    const dueDebtsWeek = debts.filter((d: any) => d.status !== 'paid' && d.due_date && new Date(d.due_date) > new Date() && new Date(d.due_date) < new Date(Date.now() + 7 * 86400000)).length;
    const expensesRatio = monthSalesARS > 0 ? (totalMonthExpenses / monthSalesARS) * 100 : 0;
    const lowMarginCount = products.filter((p: any) => Number(p.sale_price_ars) > 0 && (Number(p.profit_per_unit_ars) / Number(p.sale_price_ars)) * 100 < marginAlertPct).length;
    const smartAlerts: { type: 'destructive' | 'warning' | 'success'; icon: any; msg: string; link?: string }[] = [];
    if (outOfStockProducts.length > 0) smartAlerts.push({ type: 'destructive', icon: AlertTriangle, msg: `${outOfStockProducts.length} productos sin stock`, link: '/productos' });
    if (lowMarginCount > 0) smartAlerts.push({ type: 'warning', icon: TrendingDown, msg: `${lowMarginCount} productos con margen < ${marginAlertPct}%`, link: '/productos' });
    if (dueDebtsWeek > 0) smartAlerts.push({ type: 'warning', icon: AlertCircle, msg: `${dueDebtsWeek} deudas vencen esta semana`, link: '/deudas' });
    if (expensesRatio > expenseRatioAlertPct && monthSalesARS > 0) smartAlerts.push({ type: 'destructive', icon: Wallet, msg: `Gastos representan ${expensesRatio.toFixed(0)}% de tus ventas (límite ${expenseRatioAlertPct}%)`, link: '/gastos' });

    // ===== Anomaly detection =====
    const anomalies: { severity: 'high' | 'medium'; msg: string; link?: string }[] = [];

    // 1. Product with margin significantly below its historical average (last 60d vs prior 60d)
    const sixtyAgo = new Date(Date.now() - 60 * 86400000);
    const onetwentyAgo = new Date(Date.now() - 120 * 86400000);
    const recent60Sales = allSales.filter((s: any) => new Date(s.date) >= sixtyAgo);
    const prior60Sales = allSales.filter((s: any) => { const d = new Date(s.date); return d >= onetwentyAgo && d < sixtyAgo; });
    const productMarginRecent: Record<string, { rev: number; profit: number }> = {};
    const productMarginPrior: Record<string, { rev: number; profit: number }> = {};
    recent60Sales.forEach((s: any) => {
      if (!productMarginRecent[s.product_name]) productMarginRecent[s.product_name] = { rev: 0, profit: 0 };
      productMarginRecent[s.product_name].rev += Number(s.total_ars);
      productMarginRecent[s.product_name].profit += Number(s.profit_ars);
    });
    prior60Sales.forEach((s: any) => {
      if (!productMarginPrior[s.product_name]) productMarginPrior[s.product_name] = { rev: 0, profit: 0 };
      productMarginPrior[s.product_name].rev += Number(s.total_ars);
      productMarginPrior[s.product_name].profit += Number(s.profit_ars);
    });
    Object.entries(productMarginRecent).forEach(([name, r]) => {
      const p = productMarginPrior[name];
      if (!p || p.rev < 1000 || r.rev < 1000) return;
      const recentMarginPct = r.rev > 0 ? (r.profit / r.rev) * 100 : 0;
      const priorMarginPct = p.rev > 0 ? (p.profit / p.rev) * 100 : 0;
      if (priorMarginPct > 5 && recentMarginPct < priorMarginPct * 0.7) {
        anomalies.push({ severity: 'high', msg: `Caída de margen en "${name}": ${priorMarginPct.toFixed(0)}% → ${recentMarginPct.toFixed(0)}%`, link: '/reportes' });
      }
    });

    // 2. A top-10 product that had strong sales but dropped off in the last 14 days
    const fourteenAgo = new Date(Date.now() - 14 * 86400000);
    const last14Sales = allSales.filter((s: any) => new Date(s.date) >= fourteenAgo);
    const last14Set = new Set(last14Sales.map((s: any) => s.product_name));
    const top10Names = Object.entries(productSales).sort((a: any, b: any) => b[1].qty - a[1].qty).slice(0, 10).map(([, d]: any) => d.name);
    top10Names.forEach(name => {
      if (!last14Set.has(name)) {
        anomalies.push({ severity: 'medium', msg: `Sin ventas en 14 días: "${name}" (estuvo entre los más vendidos)`, link: '/ventas' });
      }
    });

    // ===== Best day of the week =====
    const weekdayTotals: Record<number, { total: number; count: number }> = {};
    allSales.forEach((s: any) => {
      const dow = new Date(s.date).getDay(); // 0=Sun
      if (!weekdayTotals[dow]) weekdayTotals[dow] = { total: 0, count: 0 };
      weekdayTotals[dow].total += Number(s.total_ars);
      weekdayTotals[dow].count++;
    });
    const dowNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const bestWeekdayData = [1, 2, 3, 4, 5, 6, 0].map(i => ({
      day: dowNames[i],
      dow: i,
      total: weekdayTotals[i]?.total || 0,
      count: weekdayTotals[i]?.count || 0,
      avg: weekdayTotals[i]?.count > 0 ? weekdayTotals[i].total / weekdayTotals[i].count : 0,
    }));
    const bestWeekday = bestWeekdayData.reduce((best, cur) => cur.avg > best.avg ? cur : best, bestWeekdayData[0]);

    // Best hour of day from created_at
    const hourTotals: Record<number, { total: number; count: number }> = {};
    allSales.forEach((s: any) => {
      if (!s.created_at) return;
      const h = new Date(s.created_at).getHours();
      if (!hourTotals[h]) hourTotals[h] = { total: 0, count: 0 };
      hourTotals[h].total += Number(s.total_ars);
      hourTotals[h].count++;
    });
    const hourData = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: `${String(h).padStart(2, '0')}:00`,
      total: hourTotals[h]?.total || 0,
      count: hourTotals[h]?.count || 0,
    })).filter(h => h.count > 0);
    const bestHour = hourData.length > 0 ? [...hourData].sort((a, b) => b.count - a.count)[0] : null;

    // Weekly cash flow (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    const weekIncome = sales.filter((s: any) => new Date(s.date) >= sevenDaysAgo).reduce((a: number, s: any) => a + Number(s.total_ars), 0);
    const weekExpensesAmt = expenses.filter((e: any) => new Date(e.date) >= sevenDaysAgo).reduce((a: number, e: any) => a + Number(e.amount_ars), 0);
    const weekPurchasesAmt = allPurchases.filter((p: any) => new Date(p.date) >= sevenDaysAgo).reduce((a: number, p: any) => a + Number(p.total_ars || 0), 0);
    const weekNetCashFlow = weekIncome - weekExpensesAmt - weekPurchasesAmt;

    return {
      totalProducts: products.length, totalStock, totalSalesARS, totalSalesCount: sales.length,
      totalPurchasesUSD, totalPurchasesARS,
      totalDebtsARS: pendingDebts.reduce((s: number, d: any) => s + Number(d.remaining_ars), 0),
      pendingDebts: pendingDebts.length,
      lowStock: lowStockProducts.length,
      outOfStock: outOfStockProducts.length,
      lowStockProducts, outOfStockProducts, restockSuggestions,
      grossProfitARS, grossProfitUSD,
      netProfitARS: taxes.netProfit,
      taxEnabled: settings.tax_enabled,
      taxes,
      profitMargin, roi,
      avgSaleARS: sales.length > 0 ? totalSalesARS / sales.length : 0,
      topProducts, salesByMonth, dailySales,
      salesByCategory: Object.entries(catMap).map(([name, data]) => ({ name, value: data.revenue, profit: data.profit, count: data.count })),
      uniqueCustomers: customers.size, inventoryValueUSD,
      recentSales: sales.slice(0, 5),
      paidSalesARS, unpaidSalesARS,
      topMarginProducts, lowMarginProducts, minPriceForMargin,
      // Financial
      projectedMonthlySalesARS, projectedMonthlyProfitARS, projectedCashFlowARS,
      avgMonthlyPurchasesARS, breakEvenUnits, avgMarginPerUnit,
      currentRate, totalCostUSDInInventory, products: allProducts,
      // New
      monthSalesARS, weekSalesARS, monthGrossProfit, totalMonthExpenses, netMonthProfitARS, expensesChartData, prevTotalMonthExpenses,
      yoySalesARS, yoyGrowth,
      salesGrowth, profitGrowth, topCustomers, smartAlerts, salesByChannel, topMonthProducts,
      lowStockThreshold, marginAlertPct,
      anomalies: anomalies.slice(0, 5),
      bestWeekdayData, bestWeekday,
      avgDailySalesARS,
      agingCount30,
      hourData, bestHour,
      weekIncome, weekExpensesAmt, weekPurchasesAmt, weekNetCashFlow,
      // raw passthrough
      rawSales: sales, rawDebts: debts, rawExpenses: expenses, rawPurchases: allPurchases, rawSettings: settings,
    };
  }, [rawData, filterCat]);

  // Browser notification for critical stock alert (once per session per threshold breach)
  useEffect(() => {
    if (!stats || permission !== "granted") return;
    const key = `gestiona.notified_stock.${new Date().toISOString().slice(0, 10)}`;
    if (sessionStorage.getItem(key)) return;
    const outCount = stats.outOfStockProducts?.length ?? 0;
    const lowCount = stats.lowStockProducts?.length ?? 0;
    if (outCount > 0 || lowCount > 0) {
      notify(
        outCount > 0 ? `⚠️ ${outCount} producto${outCount > 1 ? "s" : ""} sin stock` : `📦 ${lowCount} producto${lowCount > 1 ? "s" : ""} con stock bajo`,
        {
          body: outCount > 0
            ? `${stats.outOfStockProducts.slice(0, 3).map((p: any) => p.name).join(", ")}${outCount > 3 ? ` y ${outCount - 3} más` : ""}`
            : `${stats.lowStockProducts.slice(0, 3).map((p: any) => p.name).join(", ")}${lowCount > 3 ? ` y ${lowCount - 3} más` : ""}`,
          tag: "stock-alert",
          autoClose: 8000,
        }
      );
      sessionStorage.setItem(key, "1");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, permission]);

  const shareDailyResume = () => {
    const today = new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
    const revenue = formatARS(liveTodaySales?.total ?? 0);
    const count = liveTodaySales?.count ?? 0;
    const margin = stats.grossProfitARS > 0 && stats.totalSalesARS > 0
      ? ` · Margen ${((stats.grossProfitARS / stats.totalSalesARS) * 100).toFixed(1)}%`
      : "";
    const text = `📊 Resumen ${today}\n💰 Ventas: ${revenue} (${count} venta${count !== 1 ? "s" : ""}${margin})\n\nVía Gestiona`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  };

  // ── Sales Forecaster (OLS daily regression, 30-day horizon) ──────────────
  const forecastSaleEntries = useMemo(() =>
    (rawData?.sales ?? []).map((s: any) => ({ date: String(s.date).slice(0, 10), amount: Number(s.total_ars || 0) }))
      .filter((e: { date: string; amount: number }) => e.date && e.amount > 0),
  [rawData]);
  const { forecast: forecastPoints, trend: forecastTrend, r2: forecastR2 } = useSalesForecaster(forecastSaleEntries, { horizon: 30 });
  const forecast30dTotal = useMemo(() => forecastPoints.reduce((s, p) => s + p.value, 0), [forecastPoints]);

  // ── Supabase Realtime KPIs (live sale/stock/debt events) ──────────────────
  const { lastSale, saleEventCount } = useRealtimeKPIs(activeOrg?.id);

  // ── CRM Follow-ups due today / overdue ────────────────────────────────────
  const [pendingFollowUps, setPendingFollowUps] = useState<Array<{
    id: string; customer_name: string; type: string; summary: string; follow_up_date: string;
  }>>([]);
  const [markingFollowUp, setMarkingFollowUp] = useState<string | null>(null);
  const loadFollowUps = async () => {
    if (!activeOrg?.id) return;
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await supabase
      .from("customer_communications")
      .select("id,customer_name,type,summary,follow_up_date")
      .eq("org_id", activeOrg.id)
      .lte("follow_up_date", today)
      .or("outcome.is.null,outcome.eq.pending")
      .order("follow_up_date", { ascending: true })
      .limit(8);
    setPendingFollowUps((data || []) as any);
  };
  useEffect(() => { loadFollowUps(); }, [activeOrg?.id]);

  const markFollowUpDone = async (id: string) => {
    setMarkingFollowUp(id);
    await supabase.from("customer_communications").update({ outcome: "completed" }).eq("id", id);
    setPendingFollowUps(prev => prev.filter(f => f.id !== id));
    setMarkingFollowUp(null);
    toast.success("Seguimiento marcado como completado");
  };

  if (loading || !stats) return <DashboardSkeleton />;

  const kpiCards = [
    { label: "Hoy (en vivo)", value: formatARS(liveTodaySales?.total ?? 0), sub: (() => { const today = liveTodaySales?.total ?? 0; const lw = lastWeekSameDaySales; if (!lw) return `${liveTodaySales?.count ?? 0} ventas`; const pct = ((today - lw) / lw) * 100; return `${liveTodaySales?.count ?? 0} ventas · vs lun. pasado ${pct >= 0 ? '▲' : '▼'}${Math.abs(pct).toFixed(0)}%`; })(), icon: Zap, color: "text-emerald-400", live: true },
    { label: "Ganancia Bruta", value: formatARS(stats.grossProfitARS), sub: `${formatUSD(stats.grossProfitUSD)}`, icon: TrendingUp, color: stats.grossProfitARS >= 0 ? "text-emerald-400" : "text-destructive" },
    { label: "Ganancia Neta (mes)", value: formatARS(stats.netMonthProfitARS), sub: `Bruta - gastos${stats.taxEnabled ? ' - imp.' : ''}`, icon: Zap, color: stats.netMonthProfitARS >= 0 ? "text-emerald-400" : "text-destructive" },
    { label: "Gastos del Mes", value: formatARS(stats.totalMonthExpenses), sub: `${stats.expensesChartData.length} categorías`, icon: Wallet, color: "text-yellow-400" },
    { label: "Facturación", value: formatARS(stats.totalSalesARS), sub: `${stats.totalSalesCount} ventas`, icon: DollarSign, color: "text-primary" },
    { label: "Inversión", value: formatUSD(stats.totalPurchasesUSD), sub: formatARS(stats.totalPurchasesARS), icon: TrendingDown, color: "text-yellow-400" },
    { label: "Deudas", value: formatARS(stats.totalDebtsARS), sub: `${stats.pendingDebts} activas`, icon: AlertCircle, color: "text-destructive" },
    { label: "Inventario", value: `${stats.totalStock} uds`, sub: formatUSD(stats.inventoryValueUSD), icon: Package, color: "text-primary" },
    { label: "Ticket Prom.", value: formatARS(stats.avgSaleARS), sub: "Por venta", icon: ShoppingBag, color: "text-accent" },
    { label: "Stock Bajo", value: `${stats.lowStock} / ${stats.outOfStock}`, sub: "Bajo / Agotado", icon: BarChart3, color: stats.lowStock > 0 ? "text-destructive" : "text-emerald-400" },
    { label: "Clientes", value: stats.uniqueCustomers, sub: "Únicos", icon: Users, color: "text-primary" },
    {
      label: "Forecast 30d (OLS)",
      value: formatARS(forecast30dTotal),
      sub: `Tendencia: ${forecastTrend === "up" ? "↑ alza" : forecastTrend === "down" ? "↓ baja" : "→ estable"} · R²=${forecastR2.toFixed(2)}`,
      icon: Target,
      color: forecastTrend === "up" ? "text-emerald-400" : forecastTrend === "down" ? "text-destructive" : "text-muted-foreground",
    },
  ];

  const tooltipStyle = { background: 'hsl(220, 18%, 12%)', border: '1px solid hsl(220, 15%, 18%)', borderRadius: 8, color: 'hsl(40, 20%, 92%)' };

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Buenos días';
    if (h < 18) return 'Buenas tardes';
    return 'Buenas noches';
  })();

  const generateMonthlySummary = () => {
    if (!stats) return;
    const now = new Date();
    const monthName = now.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
    const margin = stats.monthSalesARS > 0 ? ((stats.monthGrossProfit / stats.monthSalesARS) * 100).toFixed(1) : '0';
    const top3 = stats.topMonthProducts.slice(0, 3).map((p: any) => p.name).join(', ') || 'Sin datos';
    const growth = stats.salesGrowth > 0 ? `+${stats.salesGrowth.toFixed(1)}%` : `${stats.salesGrowth.toFixed(1)}%`;
    const summary = `📊 Resumen de ${monthName}: Facturé ${formatARS(stats.monthSalesARS)} (${growth} vs mes anterior), ganancia bruta ${formatARS(stats.monthGrossProfit)} (${margin}% margen). Top productos: ${top3}. Gastos: ${formatARS(stats.totalMonthExpenses)}. Resultado neto estimado: ${formatARS(stats.netMonthProfitARS)}.`;
    setMonthlySummary(summary);
    localStorage.setItem(monthlySummaryKey, summary);
    setMonthlySummaryDismissed(false);
    localStorage.removeItem(monthlySummaryKey + '.dismissed');
    setGeneratingSummary(false);
  };

  return (
    <div className="space-y-5 pb-12">
      {/* Offline/slow network banner */}
      {!online && (
        <div className="flex items-center gap-2.5 px-4 py-2.5 mb-4 rounded-xl border border-orange-500/30 bg-orange-500/8 text-sm text-orange-300">
          <span className="inline-block w-2 h-2 rounded-full bg-orange-400 animate-pulse shrink-0" />
          <span className="flex-1">
            Sin conexión{offlineSince ? ` desde las ${offlineSince.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}` : ""} — Los datos pueden estar desactualizados.
          </span>
        </div>
      )}
      {online && connection?.effectiveType && ["slow-2g", "2g"].includes(connection.effectiveType) && (
        <div className="flex items-center gap-2 px-4 py-2 mb-4 rounded-xl border border-yellow-500/20 bg-yellow-500/5 text-xs text-yellow-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          Conexión lenta ({connection.effectiveType.toUpperCase()}) — algunos datos pueden tardar en cargar.
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-2 gap-2">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold">{greeting} 👋</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {filterCat === 'all' ? 'Resumen general de tu negocio' : `Filtrado: ${categories.find(c => c.value === filterCat)?.label}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filterCat} onValueChange={setFilterCat}>
            <SelectTrigger className="bg-card border-border/50 w-full sm:w-[200px] h-9 text-sm rounded-lg">
              <Filter className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categories.map(c => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button onClick={shareDailyResume} title="Compartir resumen del día por WhatsApp" className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground hover:text-emerald-400 transition-colors">
            <Share2 className="w-3.5 h-3.5" />Compartir
          </button>
          <span className="text-[11px] text-muted-foreground/60 hidden sm:block">{new Date().toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
        </div>
      </div>

      {/* Open Cash Session Banner */}
      {openCashSession && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2.5 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
          <Banknote className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-sm font-medium text-emerald-400">Caja abierta</span>
          <span className="text-xs text-muted-foreground">
            desde {new Date(openCashSession.opened_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <Link to="/caja" className="ml-auto text-xs text-primary hover:underline font-medium">Ver caja →</Link>
        </div>
      )}

      {/* Sin ventas hoy — alert after 14hs */}
      {new Date().getHours() >= 14 && (liveTodaySales?.count ?? 0) === 0 && !noSalesDismissed && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2.5 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
          <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0" />
          <span className="text-sm font-medium text-yellow-400">Sin ventas hoy</span>
          <span className="text-xs text-muted-foreground hidden sm:block">Son las {new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })} y no hay ventas registradas.</span>
          <div className="ml-auto flex items-center gap-2">
            <Link to="/ventas" className="text-xs text-primary hover:underline font-medium">Registrar →</Link>
            <button
              onClick={() => {
                sessionStorage.setItem(`gestiona.no_sales_alert.${new Date().toISOString().slice(0, 10)}`, '1');
                setNoSalesDismissed(true);
              }}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors px-1"
            >✕</button>
          </div>
        </div>
      )}

      {/* USD Rates Banner */}
      {dolarRates && (dolarRates.blue > 0 || dolarRates.oficial > 0) && (
        <div className="flex flex-wrap items-center gap-3 mb-4 px-4 py-2.5 bg-card border border-border rounded-xl">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider shrink-0">Dólar hoy</span>
          {dolarRates.oficial > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">Oficial</span>
              <span className="text-sm font-bold font-mono">${dolarRates.oficial.toLocaleString('es-AR')}</span>
            </div>
          )}
          {dolarRates.blue > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">Blue</span>
              <span className="text-sm font-bold font-mono text-primary">${dolarRates.blue.toLocaleString('es-AR')}</span>
            </div>
          )}
          {dolarRates.mep > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">MEP</span>
              <span className="text-sm font-bold font-mono text-blue-400">${dolarRates.mep.toLocaleString('es-AR')}</span>
            </div>
          )}
          {liveExchangeRates?.ccl > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">CCL</span>
              <span className="text-sm font-bold font-mono text-amber-400">${liveExchangeRates.ccl.toLocaleString('es-AR')}</span>
            </div>
          )}
          {rawData?.settings?.exchange_rate && dolarRates.blue > 0 && (
            <div className="ml-auto flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-muted-foreground">Tu TC:</span>
              <span className={`text-sm font-bold font-mono ${Math.abs(Number(rawData.settings.exchange_rate) - dolarRates.blue) / dolarRates.blue > 0.05 ? 'text-destructive' : 'text-emerald-400'}`}>
                ${Number(rawData.settings.exchange_rate).toLocaleString('es-AR')}
              </span>
              {Math.abs(Number(rawData.settings.exchange_rate) - dolarRates.blue) / dolarRates.blue > 0.05 && user && (
                <button
                  onClick={async () => {
                    await saveSettingsDB(user.id, { exchange_rate: dolarRates.blue });
                    toast.success(`TC actualizado a $${dolarRates.blue.toLocaleString('es-AR')} (blue)`);
                    // Refresh rawData to reflect change
                    setReloadKey(k => k + 1);
                  }}
                  className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary hover:bg-primary/25 transition-colors font-semibold border border-primary/30"
                  title="Sincronizar mi tipo de cambio al dólar blue actual"
                >
                  ↑ Sincronizar al blue
                </button>
              )}
              <button onClick={refreshRates} title="Actualizar cotizaciones" className="text-muted-foreground hover:text-primary transition-colors ml-1">
                <ArrowUp className="w-3 h-3 rotate-45" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-2 mb-4 mt-3">
        {[
          { label: "Nueva Venta", icon: DollarSign, path: "/ventas", color: "text-primary" },
          { label: "POS", icon: ShoppingBag, path: "/caja", color: "text-emerald-400" },
          { label: "Nuevo Cliente", icon: Users, path: "/clientes", color: "text-blue-400" },
          { label: "Inventario", icon: Package, path: "/productos", color: "text-yellow-400" },
          { label: "Gastos", icon: Wallet, path: "/gastos", color: "text-destructive" },
          { label: "Reportes", icon: BarChart3, path: "/reportes", color: "text-purple-400" },
        ].map(a => (
          <Link key={a.path} to={a.path}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors text-xs text-muted-foreground hover:text-foreground">
            <a.icon className={`w-3.5 h-3.5 ${a.color}`} />
            {a.label}
          </Link>
        ))}
        <button
          onClick={() => setBriefingOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/30 hover:bg-primary/20 transition-colors text-xs text-primary font-medium"
          title="Ver briefing matutino del negocio"
        >
          ✨ Briefing
        </button>
        <button
          onClick={() => {
            sessionStorage.setItem("gestiona.ai_prefill", "Dame un insight del día: qué vendí hoy, qué productos destacaron y qué debería priorizar ahora");
            navigate("/chat-ia");
          }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/30 hover:bg-primary/20 transition-colors text-xs text-primary font-medium"
        >
          <Zap className="w-3.5 h-3.5" />
          💡 Insight del día
        </button>
        <button
          onClick={() => { setGeneratingSummary(true); setTimeout(generateMonthlySummary, 100); }}
          disabled={generatingSummary}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors text-xs text-muted-foreground font-medium disabled:opacity-50"
        >
          <BarChart3 className="w-3.5 h-3.5" />
          📅 Resumen del mes
        </button>
      </div>

      {/* Monthly summary card */}
      {monthlySummary && !monthlySummaryDismissed && (
        <div className="mb-4 bg-card border border-primary/20 rounded-xl p-3 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-semibold text-primary uppercase tracking-wide mb-1">Resumen mensual</p>
            <p className="text-xs text-foreground leading-relaxed">{monthlySummary}</p>
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            <button onClick={() => { sessionStorage.setItem("gestiona.ai_prefill", `Analizá este resumen y dame 3 recomendaciones concretas: ${monthlySummary}`); navigate("/chat-ia"); }}
              className="text-[10px] text-primary hover:underline whitespace-nowrap">Analizar con IA</button>
            <button onClick={() => { setMonthlySummaryDismissed(true); localStorage.setItem(monthlySummaryKey + '.dismissed', '1'); }}
              className="text-[10px] text-muted-foreground hover:text-foreground">Cerrar</button>
          </div>
        </div>
      )}

      {/* Weekly comparison widget */}
      {weeklyComparison && weeklyComparison.thisTotal > 0 && (
        <div className="mb-4 bg-card border border-border rounded-xl p-4 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
              <BarChart3 className="w-4 h-4" />Comparativa semanal automática
            </h3>
            <span className="text-[10px] text-muted-foreground">Esta semana vs semana anterior</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-0.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Ventas esta semana</p>
              <p className="text-lg font-bold text-foreground">{formatARS(weeklyComparison.thisTotal)}</p>
              <p className={`text-xs font-semibold flex items-center gap-0.5 ${weeklyComparison.diff >= 0 ? 'text-emerald-400' : 'text-destructive'}`}>
                {weeklyComparison.diff >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                {Math.abs(weeklyComparison.diff).toFixed(1)}%
              </p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Semana anterior</p>
              <p className="text-lg font-bold text-muted-foreground">{formatARS(weeklyComparison.lastTotal)}</p>
              <p className="text-xs text-muted-foreground">referencia</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Unidades vendidas</p>
              <p className="text-lg font-bold">{weeklyComparison.thisUnits}</p>
              <p className={`text-xs font-semibold flex items-center gap-0.5 ${weeklyComparison.unitDiff >= 0 ? 'text-emerald-400' : 'text-destructive'}`}>
                {weeklyComparison.unitDiff >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                {Math.abs(weeklyComparison.unitDiff).toFixed(1)}% vs semana ant.
              </p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Top producto</p>
              <p className="text-sm font-semibold truncate">{weeklyComparison.topProd || "—"}</p>
              <button
                onClick={() => { sessionStorage.setItem("gestiona.ai_prefill", `Comparativa semanal: esta semana ${formatARS(weeklyComparison.thisTotal)} (${weeklyComparison.thisUnits} uds), semana anterior ${formatARS(weeklyComparison.lastTotal)} (${weeklyComparison.lastUnits} uds). Variación ${weeklyComparison.diff.toFixed(1)}%. Dame 2 acciones concretas.`); navigate("/chat-ia"); }}
                className="text-[10px] text-primary hover:underline"
              >Analizar con IA →</button>
            </div>
          </div>
          {/* Mini progress bar */}
          {weeklyComparison.lastTotal > 0 && (
            <div className="mt-3">
              <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${weeklyComparison.diff >= 0 ? 'bg-emerald-500' : 'bg-destructive'}`}
                  style={{ width: `${Math.min(100, (weeklyComparison.thisTotal / weeklyComparison.lastTotal) * 100)}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 text-right">
                {weeklyComparison.diff >= 0 ? `▲ +${formatARS(weeklyComparison.thisTotal - weeklyComparison.lastTotal)} respecto a la semana pasada` : `▼ ${formatARS(weeklyComparison.lastTotal - weeklyComparison.thisTotal)} menos que la semana pasada`}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Temperatura del negocio — semáforo */}
      {(() => {
        const today = new Date().toISOString().slice(0, 10);
        const overdueCount = (stats.rawDebts || []).filter((d: any) => d.status !== 'paid' && d.due_date && d.due_date < today).length;
        const todaySales = liveTodaySales?.total ?? 0;
        const avgDaily = stats.avgDailySalesARS;
        const salesPct = avgDaily > 0 ? (todaySales / avgDaily) * 100 : (todaySales > 0 ? 100 : 0);
        const monthMargin = stats.monthSalesARS > 0 ? (stats.monthGrossProfit / stats.monthSalesARS) * 100 : 0;
        const criticalStock = stats.outOfStock;
        const agingCount = stats.agingCount30 || 0;

        // Evaluate each signal: 2=green, 1=yellow, 0=red
        const sigSales = salesPct >= 80 ? 2 : salesPct >= 40 ? 1 : 0;
        const sigStock = criticalStock === 0 ? 2 : criticalStock <= 3 ? 1 : 0;
        const sigDebt = overdueCount === 0 ? 2 : overdueCount <= 2 ? 1 : 0;
        const sigMargin = monthMargin >= 25 ? 2 : monthMargin >= 10 ? 1 : 0;
        const sigAging = agingCount === 0 ? 2 : agingCount <= 5 ? 1 : 0;
        const worstScore = Math.min(sigSales, sigStock, sigDebt, sigMargin, sigAging);
        const overallColor = worstScore === 2 ? 'green' : worstScore === 1 ? 'yellow' : 'red';

        const colorCls = {
          green: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', dot: 'bg-emerald-500', label: 'text-emerald-400', text: '🟢 Todo en orden' },
          yellow: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', dot: 'bg-yellow-400', label: 'text-yellow-400', text: '🟡 Algunas alertas' },
          red: { bg: 'bg-destructive/10', border: 'border-destructive/30', dot: 'bg-destructive', label: 'text-destructive', text: '🔴 Requiere atención' },
        }[overallColor];

        const sigLabel = (score: number, labels: [string, string, string]) => (
          <span className={`text-[10px] font-medium ${score === 2 ? 'text-emerald-400' : score === 1 ? 'text-yellow-400' : 'text-destructive'}`}>
            {score === 2 ? '●' : score === 1 ? '●' : '●'} {labels[2 - score]}
          </span>
        );

        return (
          <div className={`mb-4 ${colorCls.bg} border ${colorCls.border} rounded-xl p-4 shadow-card`}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full ${colorCls.dot} animate-pulse`} />
                Temperatura del negocio
              </h3>
              <span className={`text-xs font-bold ${colorCls.label}`}>{colorCls.text}</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <div className="bg-card/60 rounded-lg px-3 py-2 space-y-0.5">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Ventas hoy</p>
                {sigLabel(sigSales, [
                  `${formatARS(todaySales)} (${salesPct.toFixed(0)}% del prom.)`,
                  `${formatARS(todaySales)} (${salesPct.toFixed(0)}% del prom.)`,
                  `${formatARS(todaySales)} (${salesPct.toFixed(0)}% del prom.)`,
                ])}
              </div>
              <div className="bg-card/60 rounded-lg px-3 py-2 space-y-0.5">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Stock crítico</p>
                {sigLabel(sigStock, [
                  `${criticalStock} productos sin stock`,
                  `${criticalStock} sin stock`,
                  'Sin agotados ✓',
                ])}
              </div>
              <div className="bg-card/60 rounded-lg px-3 py-2 space-y-0.5">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Deudas vencidas</p>
                {sigLabel(sigDebt, [
                  `${overdueCount} deudas vencidas`,
                  `${overdueCount} deuda${overdueCount !== 1 ? 's' : ''} vencida${overdueCount !== 1 ? 's' : ''}`,
                  'Sin vencidas ✓',
                ])}
              </div>
              <div className="bg-card/60 rounded-lg px-3 py-2 space-y-0.5">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Margen del mes</p>
                {sigLabel(sigMargin, [
                  `${monthMargin.toFixed(1)}% (bajo)`,
                  `${monthMargin.toFixed(1)}% (aceptable)`,
                  `${monthMargin.toFixed(1)}% ✓`,
                ])}
              </div>
              <div className="bg-card/60 rounded-lg px-3 py-2 space-y-0.5 col-span-2 sm:col-span-1">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Prod. sin movim. 30d</p>
                {sigLabel(sigAging, [
                  `${agingCount} sin ventas (30d)`,
                  `${agingCount} sin ventas (30d)`,
                  'Todos rotando ✓',
                ])}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Today detail panel */}
      {showTodayDetail && todayDetail && (
        <div className="mb-5 bg-card border border-emerald-500/30 rounded-xl p-4 shadow-card animate-in slide-in-from-top-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-emerald-400" />Detalle de hoy
            </h3>
            <button onClick={() => setShowTodayDetail(false)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-muted/40 rounded-lg p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Ventas</p>
              <p className="text-xl font-bold font-display text-emerald-400 mt-0.5">{todayDetail.count}</p>
            </div>
            <div className="bg-muted/40 rounded-lg p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Ticket promedio</p>
              <p className="text-xl font-bold font-display mt-0.5">{formatARS(todayDetail.avgTicket)}</p>
            </div>
            <div className="bg-muted/40 rounded-lg p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Método dominante</p>
              <p className="text-sm font-bold font-display mt-0.5 capitalize">{todayDetail.dominantMethod || "—"}</p>
            </div>
            <div className="bg-muted/40 rounded-lg p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Top producto</p>
              <p className="text-sm font-semibold mt-0.5 truncate" title={todayDetail.topProduct}>{todayDetail.topProduct || "—"}</p>
            </div>
          </div>
        </div>
      )}

      {/* Consistency Alerts (auto-repair) */}
      {user && <ConsistencyAlerts
        sales={stats.rawSales} debts={stats.rawDebts} products={stats.products} settings={stats.rawSettings}
        userId={user.id}
        onRepair={() => setReloadKey(k => k + 1)}
      />}

      {/* AI Proactive Suggestions */}
      {orgForTasks && <AIProactiveWidget
        orgId={orgForTasks.id}
        stats={{
          products: stats.products,
          rawSales: stats.rawSales,
          rawExpenses: stats.rawExpenses,
          totalSalesARS: stats.totalSalesARS,
          grossProfitARS: stats.grossProfitARS,
          pendingDebts: stats.pendingDebts,
          totalDebtsARS: stats.totalDebtsARS,
        }}
      />}

      {/* At-risk customers widget */}
      {atRiskCustomers.length > 0 && (
        <div className="mb-5 mt-4 bg-card border border-yellow-500/20 rounded-xl p-4 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-yellow-400" />Clientes en riesgo de perderse
            </h3>
            <Link to="/customers" className="text-xs text-primary hover:underline">Ver CRM →</Link>
          </div>
          <div className="space-y-2 pb-12">
            {atRiskCustomers.map(c => (
              <div key={c.name} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 rounded-full bg-yellow-500/15 flex items-center justify-center shrink-0">
                    <Users className="w-3 h-3 text-yellow-400" />
                  </div>
                  <span className="text-sm font-medium truncate">{c.name}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-muted-foreground">{c.daysSince}d sin comprar</span>
                  <span className="text-xs font-semibold text-yellow-400">{formatARS(c.totalSpent)}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">Clientes que compraron hace 60–180 días. Contactalos para reactivarlos.</p>
        </div>
      )}

      {/* Upcoming debts widget */}
      {upcomingDebts.length > 0 && (
        <div className="mb-5 mt-4 bg-card border border-blue-500/20 rounded-xl p-4 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
              <DollarSign className="w-4 h-4 text-blue-400" />Cobros de esta semana
            </h3>
            <Link to="/debts" className="text-xs text-primary hover:underline">Ver deudas →</Link>
          </div>
          <div className="space-y-1.5">
            {upcomingDebts.map((d: any) => {
              const daysLeft = Math.round((d.dueTs - Date.now()) / 86400000);
              return (
                <div key={d.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${daysLeft === 0 ? "bg-red-500/15" : "bg-blue-500/15"}`}>
                      <Banknote className={`w-3 h-3 ${daysLeft === 0 ? "text-red-400" : "text-blue-400"}`} />
                    </div>
                    <span className="text-sm font-medium truncate">{d.customer_name || "Cliente"}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-xs ${daysLeft === 0 ? "text-red-400 font-semibold" : "text-muted-foreground"}`}>
                      {daysLeft === 0 ? "Hoy" : `En ${daysLeft}d`}
                    </span>
                    <span className="text-xs font-semibold text-blue-400">{formatARS(Number(d.remaining_ars))}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Gastos del mes widget */}
      {stats.totalMonthExpenses > 0 && (
        <div className="mb-5 mt-4 bg-card border border-yellow-500/20 rounded-xl p-4 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
              <Wallet className="w-4 h-4 text-yellow-400" />Gastos del mes
            </h3>
            <Link to="/expenses" className="text-xs text-primary hover:underline">Ver gastos →</Link>
          </div>
          <div className="flex items-center gap-3 mb-3">
            <div>
              <p className="text-xl font-bold text-yellow-400">{formatARS(stats.totalMonthExpenses)}</p>
              {stats.prevTotalMonthExpenses > 0 && (() => {
                const delta = stats.totalMonthExpenses - stats.prevTotalMonthExpenses;
                const pct = (delta / stats.prevTotalMonthExpenses) * 100;
                return (
                  <p className={`text-[10px] font-medium ${delta > 0 ? 'text-destructive' : 'text-emerald-400'}`}>
                    {delta > 0 ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}% vs mes anterior
                  </p>
                );
              })()}
            </div>
          </div>
          {stats.expensesChartData.length > 0 && (
            <div className="space-y-1.5">
              {[...stats.expensesChartData].sort((a: any, b: any) => b.value - a.value).slice(0, 3).map((cat: any) => {
                const pct = stats.totalMonthExpenses > 0 ? (cat.value / stats.totalMonthExpenses) * 100 : 0;
                return (
                  <div key={cat.name} className="flex items-center gap-2 text-xs">
                    <span className="w-24 shrink-0 text-muted-foreground truncate">{cat.name}</span>
                    <div className="flex-1 bg-muted rounded-full h-1.5">
                      <div className="h-1.5 rounded-full bg-yellow-500/70" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-14 text-right font-medium shrink-0">{formatARS(cat.value)}</span>
                  </div>
                );
              })}
              {stats.expensesChartData.length > 3 && (
                <p className="text-[10px] text-muted-foreground mt-1">+{stats.expensesChartData.length - 3} categorías más</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Weekly cash flow widget */}
      {(stats.weekIncome > 0 || stats.weekExpensesAmt > 0 || stats.weekPurchasesAmt > 0) && (
        <div className="mb-5 bg-card border border-border rounded-xl p-4 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-primary" />Flujo de caja (últimos 7 días)
            </h3>
            <span className={`text-xs font-bold ${stats.weekNetCashFlow >= 0 ? "text-emerald-400" : "text-destructive"}`}>
              {stats.weekNetCashFlow >= 0 ? "+" : ""}{formatARS(stats.weekNetCashFlow)}
            </span>
          </div>
          <div className="space-y-2 pb-12">
            {[
              { label: "Ingresos (ventas)", value: stats.weekIncome, color: "bg-emerald-500/60" },
              { label: "Gastos operativos", value: -stats.weekExpensesAmt, color: "bg-destructive/60" },
              { label: "Compras / proveedores", value: -stats.weekPurchasesAmt, color: "bg-yellow-500/60" },
            ].map(row => {
              const max = Math.max(stats.weekIncome, stats.weekExpensesAmt + stats.weekPurchasesAmt, 1);
              const pct = (Math.abs(row.value) / max) * 100;
              return (
                <div key={row.label} className="flex items-center gap-2 text-xs">
                  <span className="w-36 shrink-0 text-muted-foreground">{row.label}</span>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${row.color}`} style={{ width: `${Math.max(2, pct)}%` }} />
                  </div>
                  <span className={`w-28 text-right font-mono font-medium shrink-0 ${row.value >= 0 ? "text-emerald-400" : "text-destructive"}`}>
                    {row.value >= 0 ? "+" : ""}{formatARS(Math.abs(row.value))}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Birthday Reminders */}
      {birthdayCustomers.length > 0 && (
        <div className="mb-5 mt-4 bg-card border border-primary/20 rounded-xl p-4 shadow-card">
          <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Cake className="w-4 h-4 text-primary" />Cumpleaños próximos
          </h3>
          <div className="flex flex-wrap gap-2">
            {birthdayCustomers.map((c) => (
              <div key={c.name} className="flex items-center gap-2 bg-primary/5 border border-primary/15 rounded-lg px-3 py-2">
                <span className="text-lg">{c.daysUntil === 0 ? '🎂' : '🎁'}</span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-tight truncate max-w-[140px]">{c.name}</p>
                  <p className="text-[10px] text-muted-foreground">{c.daysUntil === 0 ? '¡Hoy!' : `En ${c.daysUntil} día${c.daysUntil !== 1 ? 's' : ''}`}</p>
                </div>
                {c.phone && (
                  <a
                    href={`https://wa.me/${c.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`¡Feliz cumpleaños ${c.name}! 🎉 Desde el equipo te deseamos un excelente día.`)}`}
                    target="_blank" rel="noopener noreferrer"
                    className="ml-1 p-1.5 rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition-colors"
                    title="Saludar por WhatsApp"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tasks Due Today Widget */}
      {todayTasks.length > 0 && (
        <div className="mb-5 bg-card border border-blue-500/20 rounded-xl p-4 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
              <Bell className="w-4 h-4 text-blue-400" />Pendientes de hoy · {todayTasks.length}
            </h3>
            <Link to="/tareas" className="text-[10px] text-primary hover:underline">Ver todas →</Link>
          </div>
          <div className="space-y-1.5">
            {todayTasks.map(task => (
              <div key={task.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/5 border border-blue-500/10 text-sm">
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  task.priority === 'urgent' ? 'bg-destructive' :
                  task.priority === 'high' ? 'bg-orange-400' :
                  task.priority === 'medium' ? 'bg-yellow-400' : 'bg-muted-foreground'
                }`} />
                <span className="flex-1 truncate text-xs font-medium">{task.title}</span>
                <span className="text-[10px] shrink-0 text-blue-400 font-medium capitalize">{task.priority}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Urgent Tasks Widget */}
      {urgentTasks.length > 0 && (
        <div className="mb-5 bg-card border border-orange-500/20 rounded-xl p-4 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-orange-400" />Tareas urgentes / altas
            </h3>
            <Link to="/tareas" className="text-[10px] text-primary hover:underline">Ver todas →</Link>
          </div>
          <div className="space-y-1.5">
            {urgentTasks.map(task => {
              const today = new Date().toISOString().slice(0, 10);
              const isOverdue = task.due_date && task.due_date < today;
              return (
                <div key={task.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${isOverdue ? "bg-destructive/10 border border-destructive/20" : "bg-muted/30"}`}>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${task.priority === "urgent" ? "bg-destructive" : "bg-orange-400"}`} />
                  <span className="flex-1 truncate text-xs font-medium">{task.title}</span>
                  {task.due_date && (
                    <span className={`text-[10px] shrink-0 ${isOverdue ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                      {isOverdue ? "⚠️ " : ""}{new Date(task.due_date + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Overdue Debts Widget */}
      {(() => {
        const today = new Date().toISOString().slice(0, 10);
        const overdueDebts = (stats.rawDebts || [])
          .filter((d: any) => d.status !== 'paid' && d.due_date && d.due_date < today)
          .sort((a: any, b: any) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime());
        if (!overdueDebts.length) return null;
        const totalOverdue = overdueDebts.reduce((s: number, d: any) => s + Number(d.remaining_ars || 0), 0);
        return (
          <div className="mb-5 bg-card border border-destructive/25 rounded-xl p-4 shadow-card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[11px] text-destructive font-semibold uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" />
                {overdueDebts.length} deuda{overdueDebts.length !== 1 ? 's' : ''} vencida{overdueDebts.length !== 1 ? 's' : ''} · {formatARS(totalOverdue)}
              </h3>
              <Link to="/deudas" className="text-[10px] text-primary hover:underline">Gestionar →</Link>
            </div>
            <div className="space-y-1.5">
              {overdueDebts.slice(0, 4).map((d: any) => {
                const daysOverdue = Math.floor((new Date().getTime() - new Date(d.due_date).getTime()) / 86400000);
                return (
                  <div key={d.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-destructive/5 border border-destructive/10">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full bg-destructive shrink-0" />
                      <span className="text-xs font-medium truncate">{d.customer_name || 'Sin nombre'}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs text-destructive font-bold">{formatARS(Number(d.remaining_ars))}</span>
                      <span className="text-[10px] text-muted-foreground">{daysOverdue}d atrás</span>
                      {d.customer_phone && (
                        <a
                          href={`https://wa.me/${d.customer_phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola ${d.customer_name}, te recordamos que tenés una deuda pendiente de ${formatARS(Number(d.remaining_ars))}. ¿Podemos coordinar el pago?`)}`}
                          target="_blank" rel="noopener noreferrer"
                          className="p-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition-colors"
                          title="Recordatorio por WhatsApp"
                        ><MessageCircle className="w-3 h-3" /></a>
                      )}
                    </div>
                  </div>
                );
              })}
              {overdueDebts.length > 4 && (
                <p className="text-[10px] text-muted-foreground text-center pt-1">+{overdueDebts.length - 4} más en <Link to="/deudas" className="text-primary hover:underline">Deudas</Link></p>
              )}
            </div>
          </div>
        );
      })()}

      {/* Smart Alerts Banner */}
      {stats.smartAlerts && stats.smartAlerts.length > 0 && (
        <div className="mb-5 space-y-2">
          {stats.smartAlerts.map((a: any, i: number) => {
            const Icon = a.icon;
            return (
              <div key={i} className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border text-sm ${
                a.type === 'destructive'
                  ? 'bg-destructive/10 border-destructive/20 text-destructive'
                  : 'bg-orange-500/10 border-orange-500/20 text-orange-400'
              }`}>
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1">{a.msg}</span>
                {a.link && (
                  <Link to={a.link} className="text-xs underline underline-offset-2 opacity-70 hover:opacity-100 shrink-0">Ver →</Link>
                )}
              </div>
            );
          })}
          <div className="flex justify-end">
            <Link to="/alertas" className="text-xs text-primary hover:underline flex items-center gap-1">
              <Bell className="w-3 h-3" /> Configurar alertas →
            </Link>
          </div>
        </div>
      )}

      {/* Sin ventas hoy — banner after 14h with zero recorded sales */}
      {!noSalesAlertDismissed && liveTodaySales !== null && liveTodaySales.count === 0 && new Date().getHours() >= 14 && (
        <div className="mb-5 flex items-center gap-3 px-4 py-2.5 rounded-xl border bg-orange-500/10 border-orange-500/30 text-orange-400 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span className="flex-1">Son las {new Date().getHours()}h y no registraste ventas hoy — ¿todo bien?</span>
          <Link to="/pos" className="text-xs underline underline-offset-2 opacity-70 hover:opacity-100 shrink-0">Registrar →</Link>
          <button
            onClick={() => { setNoSalesAlertDismissed(true); sessionStorage.setItem('gestiona.no_sales_dismissed', new Date().toISOString().slice(0, 10)); }}
            className="text-orange-400/60 hover:text-orange-400 transition-colors ml-1 text-lg leading-none"
            title="Cerrar"
          >×</button>
        </div>
      )}

      {/* Anomaly Detection Panel */}
      {stats.anomalies && stats.anomalies.length > 0 && (
        <div className="mb-5 bg-card border border-orange-500/20 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-orange-400" />
            <span className="text-[11px] font-semibold text-orange-400 uppercase tracking-wider">Anomalías detectadas</span>
          </div>
          <div className="divide-y divide-border">
            {stats.anomalies.map((a: any, i: number) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.severity === 'high' ? 'bg-destructive' : 'bg-orange-400'}`} />
                <span className="flex-1 text-foreground/80">{a.msg}</span>
                {a.link && <Link to={a.link} className="text-xs text-primary hover:underline shrink-0">Ver →</Link>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Monthly Revenue Target */}
      {(() => {
        const target = monthlyTarget;
        const current = stats.monthSalesARS;
        const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
        const remaining = target > 0 ? Math.max(0, target - current) : 0;
        const monthName = new Date().toLocaleString('es-AR', { month: 'long' });
        return (
          <div className="mb-5 bg-card border border-border rounded-xl p-4 shadow-card">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
                <Target className="w-4 h-4 text-primary" />Objetivo del mes — {monthName}
              </h3>
              <button
                onClick={() => { setEditingTarget(true); setTargetInput(target > 0 ? String(target) : ""); }}
                className="text-[10px] text-primary hover:underline"
              >
                {target > 0 ? "Cambiar meta" : "Fijar meta →"}
              </button>
            </div>
            {editingTarget ? (
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="number"
                  value={targetInput}
                  onChange={e => setTargetInput(e.target.value)}
                  placeholder="Ej: 500000"
                  className="flex-1 h-8 px-3 rounded-lg border border-border bg-muted text-sm"
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      const v = Number(targetInput);
                      if (v > 0) {
                        const key = `gestiona.dashboard.monthly_target.${new Date().getFullYear()}.${new Date().getMonth()}`;
                        localStorage.setItem(key, String(v));
                        setMonthlyTarget(v);
                      }
                      setEditingTarget(false);
                    }
                    if (e.key === "Escape") setEditingTarget(false);
                  }}
                />
                <button
                  className="px-3 h-8 rounded-lg bg-primary text-primary-foreground text-xs font-semibold"
                  onClick={() => {
                    const v = Number(targetInput);
                    if (v > 0) {
                      const key = `gestiona.dashboard.monthly_target.${new Date().getFullYear()}.${new Date().getMonth()}`;
                      localStorage.setItem(key, String(v));
                      setMonthlyTarget(v);
                    }
                    setEditingTarget(false);
                  }}
                >Guardar</button>
                <button onClick={() => setEditingTarget(false)} className="text-muted-foreground text-xs">✕</button>
              </div>
            ) : target > 0 ? (
              <>
                <div className="flex items-end justify-between mb-1.5">
                  <span className="text-2xl font-black font-display text-primary">{pct.toFixed(0)}%</span>
                  <span className="text-xs text-muted-foreground">{formatARS(current)} / {formatARS(target)}</span>
                </div>
                <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${pct >= 100 ? "bg-yellow-400" : pct >= 75 ? "bg-green-400" : pct >= 50 ? "bg-blue-400" : "bg-primary"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {/* Daily evolution vs linear goal chart */}
                {(() => {
                  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
                  const todayDay = new Date().getDate();
                  const dailyGoalStep = target / daysInMonth;
                  // Build cumulative daily data for this month
                  const curY2 = new Date().getFullYear(); const curM2 = new Date().getMonth();
                  const daySalesMap: Record<number, number> = {};
                  (stats.rawSales || []).forEach((s: any) => {
                    const d = new Date(s.date);
                    if (d.getFullYear() === curY2 && d.getMonth() === curM2) {
                      const day = d.getDate();
                      daySalesMap[day] = (daySalesMap[day] || 0) + Number(s.total_ars || 0);
                    }
                  });
                  let cumulative = 0;
                  const chartData = Array.from({ length: todayDay }, (_, i) => {
                    const day = i + 1;
                    cumulative += daySalesMap[day] || 0;
                    return { day, actual: Math.round(cumulative), goal: Math.round(dailyGoalStep * day) };
                  });
                  if (chartData.length < 2) return null;
                  const maxVal = Math.max(...chartData.map(d => Math.max(d.actual, d.goal)));
                  return (
                    <div className="mt-3 h-16">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="gradGoal" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="hsl(220,10%,50%)" stopOpacity={0.15} />
                              <stop offset="95%" stopColor="hsl(220,10%,50%)" stopOpacity={0} />
                            </linearGradient>
                            <linearGradient id="gradActual" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="hsl(40,70%,50%)" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="hsl(40,70%,50%)" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <Tooltip
                            contentStyle={{ background: 'hsl(220,15%,12%)', border: '1px solid hsl(220,15%,20%)', borderRadius: 6, fontSize: 10 }}
                            formatter={(v: number, name: string) => [formatARS(v), name === 'actual' ? 'Acumulado real' : 'Meta lineal']}
                            labelFormatter={(l: number) => `Día ${l}`}
                          />
                          <Area type="monotone" dataKey="goal" stroke="hsl(220,10%,50%)" fill="url(#gradGoal)" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
                          <Area type="monotone" dataKey="actual" stroke="hsl(40,70%,50%)" fill="url(#gradActual)" strokeWidth={2} dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  );
                })()}
                {(() => {
                  const daysLeft = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate() - new Date().getDate();
                  const atRisk = pct < 60 && daysLeft <= 7 && target > 0;
                  const dailyNeeded = daysLeft > 0 ? remaining / daysLeft : 0;
                  return (
                    <>
                      <p className="text-[10px] text-muted-foreground mt-1.5">
                        {pct >= 100
                          ? "🎉 ¡Meta alcanzada!"
                          : `Faltan ${formatARS(remaining)} · ${daysLeft} días restantes`}
                      </p>
                      {atRisk && (
                        <div className="mt-2 flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                          <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                          <div>
                            <p className="text-[11px] font-semibold text-red-400">Meta en riesgo</p>
                            <p className="text-[10px] text-muted-foreground">Para alcanzarla necesitás vender {formatARS(dailyNeeded)}/día los próximos {daysLeft} días.</p>
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
              </>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">Fijá tu objetivo mensual de ventas para ver el progreso aquí.</p>
            )}
            {/* YoY comparison */}
            {stats.yoySalesARS > 0 && (
              <div className="mt-2 pt-2 border-t border-border/50 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>Mismo mes {new Date().getFullYear() - 1}: {formatARS(stats.yoySalesARS)}</span>
                <span className={`font-semibold ${stats.yoyGrowth >= 0 ? 'text-emerald-400' : 'text-destructive'}`}>
                  {stats.yoyGrowth >= 0 ? '▲' : '▼'} {Math.abs(stats.yoyGrowth).toFixed(1)}% interanual
                </span>
              </div>
            )}
          </div>
        );
      })()}

      {/* Weekly Sales Goal */}
      {(() => {
        const weekCurrent = stats.weekSalesARS;
        const weekPct = weeklyTarget > 0 ? Math.min(100, (weekCurrent / weeklyTarget) * 100) : 0;
        const weekRemaining = weeklyTarget > 0 ? Math.max(0, weeklyTarget - weekCurrent) : 0;
        const dayOfWeek = new Date().toLocaleString('es-AR', { weekday: 'long' });
        return (
          <div className="mb-5 bg-card border border-border rounded-xl p-4 shadow-card">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
                <Target className="w-4 h-4 text-emerald-400" />Meta semanal — {dayOfWeek}
              </h3>
              <button
                onClick={() => { setEditingWeeklyTarget(true); setWeeklyTargetInput(weeklyTarget > 0 ? String(weeklyTarget) : ""); }}
                className="text-[10px] text-primary hover:underline"
              >
                {weeklyTarget > 0 ? "Cambiar meta" : "Fijar meta →"}
              </button>
            </div>
            {editingWeeklyTarget ? (
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="number"
                  value={weeklyTargetInput}
                  onChange={e => setWeeklyTargetInput(e.target.value)}
                  placeholder="Ej: 150000"
                  className="flex-1 h-8 px-3 rounded-lg border border-border bg-muted text-sm"
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      const v = Number(weeklyTargetInput);
                      if (v > 0) { localStorage.setItem(weeklyTargetKey, String(v)); setWeeklyTarget(v); }
                      setEditingWeeklyTarget(false);
                    }
                    if (e.key === "Escape") setEditingWeeklyTarget(false);
                  }}
                />
                <button
                  className="px-3 h-8 rounded-lg bg-primary text-primary-foreground text-xs font-semibold"
                  onClick={() => {
                    const v = Number(weeklyTargetInput);
                    if (v > 0) { localStorage.setItem(weeklyTargetKey, String(v)); setWeeklyTarget(v); }
                    setEditingWeeklyTarget(false);
                  }}
                >Guardar</button>
                <button onClick={() => setEditingWeeklyTarget(false)} className="text-muted-foreground text-xs">✕</button>
              </div>
            ) : weeklyTarget > 0 ? (
              <>
                <div className="flex items-end justify-between mb-1.5">
                  <span className="text-2xl font-black font-display text-emerald-400">{weekPct.toFixed(0)}%</span>
                  <span className="text-xs text-muted-foreground">{formatARS(weekCurrent)} / {formatARS(weeklyTarget)}</span>
                </div>
                <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${weekPct >= 100 ? "bg-yellow-400" : weekPct >= 75 ? "bg-green-400" : weekPct >= 50 ? "bg-blue-400" : "bg-emerald-500"}`}
                    style={{ width: `${weekPct}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  {weekPct >= 100
                    ? "🎉 ¡Meta semanal cumplida!"
                    : `Faltan ${formatARS(weekRemaining)} para cerrar la semana bien`}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground mt-1">Fijá tu objetivo semanal de ventas para hacer seguimiento diario.</p>
            )}
          </div>
        );
      })()}

      {/* Objetivos por vendedor */}
      {(() => {
        const now = new Date();
        const startOfWeek = new Date(now);
        const dow = now.getDay();
        startOfWeek.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
        startOfWeek.setHours(0, 0, 0, 0);
        const sellerWeekMap: Record<string, number> = {};
        (stats.rawSales || []).forEach((s: any) => {
          if (!s.seller_name) return;
          const d = new Date(s.date + "T12:00:00");
          if (d < startOfWeek) return;
          sellerWeekMap[s.seller_name] = (sellerWeekMap[s.seller_name] || 0) + Number(s.total_ars || 0);
        });
        const sellers = Object.entries(sellerWeekMap).sort((a, b) => b[1] - a[1]);
        if (sellers.length < 2) return null;
        return (
          <SellerGoalsWidget
            sellers={sellers}
            orgId={orgForTasks?.id || "default"}
          />
        );
      })()}

      {/* Top cliente de la semana */}
      {stats.rawSales && (() => {
        const now = new Date();
        const dow = now.getDay();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
        startOfWeek.setHours(0, 0, 0, 0);
        const customerMap: Record<string, { total: number; count: number; profit: number }> = {};
        (stats.rawSales as any[]).forEach((s: any) => {
          if (!s.customer_name) return;
          const d = new Date(s.date + "T12:00:00");
          if (d < startOfWeek) return;
          const k = s.customer_name.trim();
          if (!customerMap[k]) customerMap[k] = { total: 0, count: 0, profit: 0 };
          customerMap[k].total += Number(s.total_ars || 0);
          customerMap[k].count++;
          customerMap[k].profit += Number(s.profit_ars || 0);
        });
        const topClients = Object.entries(customerMap).sort((a, b) => b[1].total - a[1].total).slice(0, 5);
        if (topClients.length === 0) return null;
        const maxTotal = topClients[0][1].total;
        return (
          <div className="mb-5 bg-card border border-border rounded-xl p-4 shadow-card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
                <Users className="w-4 h-4 text-primary" />Top clientes esta semana
              </h3>
              <span className="text-[10px] text-primary font-semibold bg-primary/10 px-2 py-0.5 rounded-full">
                🏆 {topClients[0][0]}
              </span>
            </div>
            <div className="space-y-2 pb-12">
              {topClients.map(([name, data], idx) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground w-4 shrink-0">{idx + 1}</span>
                  <span className="text-xs font-medium flex-1 truncate">{name}</span>
                  <div className="flex-1 hidden sm:block">
                    <div className="bg-muted rounded-full h-1.5">
                      <div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.round((data.total / maxTotal) * 100)}%` }} />
                    </div>
                  </div>
                  <span className="text-xs font-bold text-primary shrink-0">{formatARS(data.total)}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{data.count}v</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Productos por vencer */}
      {(stats.products || []).length > 0 && (() => {
        const today = new Date();
        const in30 = new Date(today); in30.setDate(today.getDate() + 30);
        const expiring = (stats.products as any[])
          .filter(p => p.expiry_date && p.stock > 0)
          .map(p => ({ ...p, exp: new Date(p.expiry_date + "T12:00:00") }))
          .filter(p => p.exp <= in30)
          .sort((a, b) => a.exp.getTime() - b.exp.getTime());
        if (expiring.length === 0) return null;
        const expired = expiring.filter(p => p.exp < today);
        return (
          <div className="mb-5 bg-card border border-orange-500/30 rounded-xl p-4 shadow-card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
                <Package className="w-4 h-4 text-orange-400" />
                Productos por vencer
              </h3>
              {expired.length > 0 && (
                <span className="text-[10px] font-semibold bg-destructive/20 text-destructive px-2 py-0.5 rounded-full">
                  {expired.length} vencido{expired.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              {expiring.slice(0, 5).map((p: any) => {
                const daysLeft = Math.ceil((p.exp.getTime() - today.getTime()) / 86400000);
                const isExpired = daysLeft < 0;
                const isUrgent = daysLeft <= 7;
                return (
                  <div key={p.id} className="flex items-center gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isExpired ? 'bg-destructive' : isUrgent ? 'bg-orange-400' : 'bg-yellow-400'}`} />
                    <span className="text-xs flex-1 truncate">{p.name}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{p.stock} uds</span>
                    <span className={`text-[10px] font-semibold shrink-0 px-1.5 py-0.5 rounded ${isExpired ? 'bg-destructive/20 text-destructive' : isUrgent ? 'bg-orange-500/20 text-orange-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                      {isExpired ? `Vencido` : `${daysLeft}d`}
                    </span>
                  </div>
                );
              })}
              {expiring.length > 5 && (
                <p className="text-[10px] text-muted-foreground text-center pt-1">+{expiring.length - 5} más</p>
              )}
            </div>
          </div>
        );
      })()}

      {/* End of day widget */}
      {stats.rawSales && (
        <EndOfDayWidget
          sales={stats.rawSales}
          debts={stats.rawDebts || []}
          orgId={orgForTasks?.id || "default"}
        />
      )}

      {/* Best day of the week widget */}
      {stats.bestWeekdayData.some(d => d.count > 0) && (() => {
        const maxAvg = Math.max(...stats.bestWeekdayData.map(d => d.avg));
        return (
          <div className="mb-5 bg-card border border-border rounded-xl p-4 shadow-card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
                <BarChart3 className="w-4 h-4 text-primary" />Mejor día de la semana
              </h3>
              <span className="text-[10px] text-primary font-semibold bg-primary/10 px-2 py-0.5 rounded-full">
                🏆 {stats.bestWeekday.day} · {formatARS(stats.bestWeekday.avg)} promedio
              </span>
            </div>
            <div className="flex items-end gap-1.5 h-16">
              {stats.bestWeekdayData.map(d => {
                const heightPct = maxAvg > 0 ? (d.avg / maxAvg) * 100 : 0;
                const isBest = d.dow === stats.bestWeekday.dow;
                return (
                  <div key={d.day} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className={`w-full rounded-t-md transition-all duration-500 ${isBest ? 'bg-primary' : 'bg-muted-foreground/20'}`}
                      style={{ height: `${Math.max(4, heightPct)}%` }}
                      title={`${d.day}: ${formatARS(d.avg)} prom · ${d.count} ventas`}
                    />
                    <span className={`text-[9px] font-medium ${isBest ? 'text-primary' : 'text-muted-foreground/60'}`}>{d.day}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">Basado en {stats.rawSales.length} ventas históricas · promedio de facturación por día</p>
          </div>
        );
      })()}

      {/* Best hour of day widget */}
      {stats.bestHour && stats.hourData.length >= 3 && (
        <div className="mb-5 bg-card border border-border rounded-xl p-4 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-primary" />Mejor horario de ventas
            </h3>
            <span className="text-[10px] text-primary font-semibold bg-primary/10 px-2 py-0.5 rounded-full">
              🕐 {stats.bestHour.label} · {stats.bestHour.count} ventas
            </span>
          </div>
          <div className="flex items-end gap-0.5 h-12 overflow-x-auto">
            {stats.hourData.map(h => {
              const maxCount = Math.max(...stats.hourData.map(x => x.count));
              const pct = maxCount > 0 ? (h.count / maxCount) * 100 : 0;
              const isBest = h.hour === stats.bestHour!.hour;
              return (
                <div key={h.hour} className="flex flex-col items-center gap-0.5 flex-1 min-w-[16px]" title={`${h.label}: ${h.count} ventas`}>
                  <div className={`w-full rounded-sm ${isBest ? 'bg-primary' : 'bg-muted-foreground/20'}`} style={{ height: `${Math.max(4, pct)}%` }} />
                  {(h.hour % 4 === 0) && <span className="text-[8px] text-muted-foreground">{h.hour}</span>}
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">Basado en hora de registro (created_at) de todas las ventas</p>
        </div>
      )}

      {/* Last 8 hours sales mini chart */}
      {rawData && (() => {
        const now = new Date();
        const hours = Array.from({ length: 8 }, (_, i) => {
          const h = new Date(now);
          h.setHours(now.getHours() - (7 - i), 0, 0, 0);
          return { hour: h.getHours(), label: `${String(h.getHours()).padStart(2, '0')}h`, revenue: 0, count: 0 };
        });
        rawData.sales.forEach((s: any) => {
          const d = new Date(s.created_at || s.date);
          if (d >= new Date(now.getTime() - 8 * 3600000)) {
            const h = d.getHours();
            const slot = hours.find(x => x.hour === h);
            if (slot) { slot.revenue += Number(s.total_ars || 0); slot.count += 1; }
          }
        });
        const totalLast8 = hours.reduce((s, h) => s + h.revenue, 0);
        if (totalLast8 === 0) return null;
        const maxRev = Math.max(...hours.map(h => h.revenue), 1);
        return (
          <div className="mb-5 bg-card border border-border rounded-xl p-4 shadow-card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-primary" />Ventas — últimas 8 horas
              </h3>
              <span className="text-[10px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                {formatARS(totalLast8)} total
              </span>
            </div>
            <div className="flex items-end gap-1 h-16">
              {hours.map(h => {
                const pct = h.revenue > 0 ? Math.max(8, (h.revenue / maxRev) * 100) : 4;
                const isCurrent = h.hour === now.getHours();
                return (
                  <div key={h.hour} className="flex-1 flex flex-col items-center gap-0.5 group" title={`${h.label}: ${formatARS(h.revenue)} (${h.count} venta${h.count !== 1 ? 's' : ''})`}>
                    <div className={`w-full rounded-sm transition-all ${isCurrent ? 'bg-primary' : h.revenue > 0 ? 'bg-primary/40' : 'bg-muted/30'}`} style={{ height: `${pct}%` }} />
                    <span className="text-[9px] text-muted-foreground">{h.label}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">Hora actual resaltada · basado en hora de registro</p>
          </div>
        );
      })()}

      {/* 7-day forecast widget */}
      {stats.bestWeekdayData.some(d => d.count > 0) && (() => {
        const today = new Date();
        const nextDays = Array.from({ length: 7 }, (_, i) => {
          const d = new Date(today);
          d.setDate(today.getDate() + i + 1);
          const dow = d.getDay();
          const dayData = stats.bestWeekdayData.find(x => x.dow === dow);
          return {
            label: d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric' }),
            day: d.toLocaleDateString('es-AR', { weekday: 'short' }),
            date: d.getDate(),
            dow,
            forecast: dayData?.avg ?? 0,
            isTop: dow === stats.bestWeekday.dow,
          };
        });
        const maxForecast = Math.max(...nextDays.map(d => d.forecast));
        const totalForecast = nextDays.reduce((a, d) => a + d.forecast, 0);
        return (
          <div className="mb-5 bg-card border border-border rounded-xl p-4 shadow-card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-emerald-400" />Forecast próximos 7 días
              </h3>
              <span className="text-[10px] text-emerald-400 font-semibold bg-emerald-500/10 px-2 py-0.5 rounded-full">
                ≈ {formatARS(totalForecast)} estimado
              </span>
            </div>
            <div className="flex items-end gap-1.5 h-20">
              {nextDays.map(d => {
                const heightPct = maxForecast > 0 ? (d.forecast / maxForecast) * 100 : 0;
                return (
                  <div key={d.label} className="flex-1 flex flex-col items-center gap-1">
                    <span className="text-[9px] text-muted-foreground">{formatARS(d.forecast).replace('$', '').trim()}</span>
                    <div
                      className={`w-full rounded-t-md transition-all duration-500 ${d.isTop ? 'bg-emerald-500' : 'bg-primary/30'}`}
                      style={{ height: `${Math.max(8, heightPct * 0.65)}%` }}
                      title={`${d.label}: ~${formatARS(d.forecast)}`}
                    />
                    <div className="text-center">
                      <span className={`text-[9px] font-medium ${d.isTop ? 'text-emerald-400' : 'text-muted-foreground/60'}`}>{d.day}</span>
                      <br />
                      <span className="text-[9px] text-muted-foreground/40">{d.date}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">Estimación basada en promedio histórico por día de la semana · no considera estacionalidad ni feriados</p>
          </div>
        );
      })()}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4 mb-4 mt-5">
        {kpiCards.map((c, i) => (
          <div key={c.label} className={`group bg-card border rounded-xl p-3.5 md:p-4 shadow-card hover:border-primary/25 hover:glow-gold transition-all duration-300 ${'live' in c && c.live ? 'border-emerald-500/40 ring-1 ring-success/20 cursor-pointer' : 'border-border'}`}
            style={{ animationDelay: `${i * 50}ms` }}
            onClick={() => { if ('live' in c && c.live) setShowTodayDetail(v => !v); }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] md:text-[11px] text-muted-foreground font-medium uppercase tracking-wider">{c.label}</span>
                {'live' in c && c.live && (
                  <span className="flex items-center gap-1 text-[9px] font-bold text-emerald-400 bg-emerald-500/10 rounded-full px-1.5 py-0.5 leading-none">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    LIVE
                  </span>
                )}
              </div>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                c.color === 'text-emerald-400' ? 'bg-emerald-500/10' :
                c.color === 'text-destructive' ? 'bg-destructive/10' :
                c.color === 'text-yellow-400' ? 'bg-yellow-500/10' :
                c.color === 'text-accent' ? 'bg-accent/10' : 'bg-primary/10'
              } group-hover:scale-110 transition-transform duration-200`}>
                <c.icon className={`w-4 h-4 ${c.color}`} />
              </div>
            </div>
            <p className="text-lg md:text-xl font-bold font-display tracking-tight">{c.value}</p>
            <p className="text-[10px] md:text-[11px] text-muted-foreground/60 mt-0.5 truncate">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* Realtime last sale banner */}
      {lastSale && saleEventCount > 0 && (
        <div key={saleEventCount} className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/5 mb-4 animate-fade-in">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-ping shrink-0" />
          <div className="flex-1 min-w-0 text-xs">
            <span className="font-semibold text-emerald-400">Nueva venta en tiempo real · </span>
            <span className="text-muted-foreground">{lastSale.product} · {lastSale.customer} · </span>
            <span className="font-mono font-bold">{formatARS(lastSale.amount)}</span>
          </div>
          <span className="text-[10px] text-muted-foreground shrink-0">#{saleEventCount} evento{saleEventCount > 1 ? "s" : ""}</span>
        </div>
      )}

      {/* CRM Follow-ups widget */}
      {pendingFollowUps.length > 0 && (
        <div className="bg-card border border-amber-500/20 rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5 text-amber-400" />Seguimientos CRM pendientes
              <span className="px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[9px] font-bold">
                {pendingFollowUps.length}
              </span>
            </h3>
            <Link to="/clientes" className="text-[10px] text-primary hover:underline">Ver CRM →</Link>
          </div>
          <div className="space-y-1.5">
            {pendingFollowUps.map(f => {
              const today = new Date().toISOString().slice(0, 10);
              const isOverdue = f.follow_up_date < today;
              const isToday = f.follow_up_date === today;
              const isMarking = markingFollowUp === f.id;
              return (
                <div key={f.id} className="flex items-center gap-2.5 bg-muted/30 rounded-lg px-3 py-2 group">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                    isOverdue ? "bg-red-500/15 text-red-400" : isToday ? "bg-amber-500/15 text-amber-400" : "bg-muted text-muted-foreground"
                  }`}>
                    {isOverdue ? "⏰" : isToday ? "🎯" : "📅"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold">{f.customer_name}</span>
                      <span className={`text-[9px] ${isOverdue ? "text-red-400" : isToday ? "text-amber-400" : "text-muted-foreground"}`}>
                        {isOverdue ? `Vencido hace ${Math.round((Date.now() - new Date(f.follow_up_date + "T12:00").getTime()) / 86400000)}d` : isToday ? "Hoy" : new Date(f.follow_up_date + "T12:00").toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate">{f.summary}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {f.customer_name && (
                      <a
                        href={`https://wa.me/?text=${encodeURIComponent(`Hola ${f.customer_name}, te escribo para hacer seguimiento. `)}`}
                        target="_blank" rel="noopener noreferrer"
                        title="WhatsApp"
                        className="p-1.5 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <MessageSquare className="w-3 h-3" />
                      </a>
                    )}
                    <button
                      onClick={() => markFollowUpDone(f.id)}
                      disabled={isMarking}
                      title="Marcar como completado"
                      className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
                    >
                      {isMarking ? (
                        <div className="w-3 h-3 border border-emerald-400 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground mt-2 border-t border-border/30 pt-2">
            Pasá el mouse sobre un ítem para ver opciones rápidas · <Link to="/clientes" className="text-primary hover:underline">Gestionar todos los seguimientos →</Link>
          </p>
        </div>
      )}

      {/* ROI & Margin Gauges */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-card border border-border rounded-xl p-5 shadow-card flex items-center justify-center">
          <GaugeChart value={stats.profitMargin} max={100} label="Margen Bruto" color="hsl(152, 58%, 42%)" />
        </div>
        <div className="bg-card border border-border rounded-xl p-5 shadow-card flex items-center justify-center">
          <GaugeChart value={stats.roi} max={200} label="ROI" color="hsl(40, 72%, 52%)" />
        </div>
        <div className="bg-card border border-border rounded-xl p-5 shadow-card">
          <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-4">Cobranza</h3>
          <div className="space-y-3 pb-12">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Cobrado</span>
              <span className="text-emerald-400 font-semibold">{formatARS(stats.paidSalesARS)}</span>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${stats.totalSalesARS > 0 ? (stats.paidSalesARS / stats.totalSalesARS * 100) : 0}%` }} />
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Por cobrar</span>
              <span className="text-destructive font-semibold">{formatARS(stats.unpaidSalesARS)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Monthly Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6 md:mb-8">
        <div className="lg:col-span-2 bg-card border border-border rounded-lg p-4 md:p-5 shadow-card">
          <h2 className="text-sm font-display font-semibold mb-4 text-muted-foreground uppercase tracking-wider">Ventas y Ganancia por Mes</h2>
          {stats.salesByMonth.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={stats.salesByMonth}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 15%, 18%)" />
                <XAxis dataKey="month" tick={{ fill: 'hsl(220, 10%, 55%)', fontSize: 11 }} axisLine={false} />
                <YAxis tick={{ fill: 'hsl(220, 10%, 55%)', fontSize: 11 }} axisLine={false} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => [formatARS(v), name === 'total' ? 'Ventas' : 'Ganancia']} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="total" fill="hsl(40, 70%, 50%)" radius={[4, 4, 0, 0]} name="Ventas" />
                <Bar dataKey="profit" fill="hsl(150, 60%, 40%)" radius={[4, 4, 0, 0]} name="Ganancia" />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">Sin datos de ventas aún</div>}
        </div>

        <div className="bg-card border border-border rounded-lg p-4 md:p-5 shadow-card">
          <h2 className="text-sm font-display font-semibold mb-4 text-muted-foreground uppercase tracking-wider">Ventas por Categoría</h2>
          {stats.salesByCategory.length > 0 ? (
            <div>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie data={stats.salesByCategory} cx="50%" cy="50%" innerRadius={35} outerRadius={60} dataKey="value" stroke="none">
                    {stats.salesByCategory.map((_: any, i: number) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatARS(v), 'Total']} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1.5 mt-2">
                {stats.salesByCategory.map((cat: any, i: number) => (
                  <div key={cat.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                      <span className="text-muted-foreground">{cat.name}</span>
                    </div>
                    <span className="font-medium">{cat.count}u · {formatARS(cat.profit)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">Sin datos</div>}
        </div>
      </div>

      {/* Daily Trend + Margin Evolution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6 md:mb-8">
        <div className="bg-card border border-border rounded-lg p-4 md:p-5 shadow-card">
          <h2 className="text-sm font-display font-semibold mb-4 text-muted-foreground uppercase tracking-wider">Tendencia Diaria (30 días)</h2>
          {stats.dailySales.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={stats.dailySales}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 15%, 18%)" />
                <XAxis dataKey="date" tick={{ fill: 'hsl(220, 10%, 55%)', fontSize: 9 }} axisLine={false} />
                <YAxis tick={{ fill: 'hsl(220, 10%, 55%)', fontSize: 10 }} axisLine={false} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatARS(v)]} />
                <Area type="monotone" dataKey="total" stroke="hsl(40, 70%, 50%)" fill="hsl(40, 70%, 50%)" fillOpacity={0.15} name="Ventas" />
                <Area type="monotone" dataKey="profit" stroke="hsl(150, 60%, 40%)" fill="hsl(150, 60%, 40%)" fillOpacity={0.15} name="Ganancia" />
              </AreaChart>
            </ResponsiveContainer>
          ) : <div className="h-[180px] flex items-center justify-center text-muted-foreground text-sm">Sin datos recientes</div>}
        </div>

        <div className="bg-card border border-border rounded-lg p-4 md:p-5 shadow-card">
          <h2 className="text-sm font-display font-semibold mb-4 text-muted-foreground uppercase tracking-wider">Margen por Mes (%)</h2>
          {stats.salesByMonth.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={stats.salesByMonth}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 15%, 18%)" />
                <XAxis dataKey="month" tick={{ fill: 'hsl(220, 10%, 55%)', fontSize: 11 }} axisLine={false} />
                <YAxis tick={{ fill: 'hsl(220, 10%, 55%)', fontSize: 11 }} axisLine={false} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [`${v.toFixed(1)}%`, 'Margen']} />
                <Line type="monotone" dataKey="margin" stroke="hsl(200, 60%, 50%)" strokeWidth={2} dot={{ r: 4, fill: 'hsl(200, 60%, 50%)' }} name="Margen" />
              </LineChart>
            </ResponsiveContainer>
          ) : <div className="h-[180px] flex items-center justify-center text-muted-foreground text-sm">Sin datos</div>}
        </div>
      </div>

      {/* Pipeline Conversion Widget */}
      {pipelineStats && pipelineStats.total > 0 && (
        <div className="bg-card border border-border rounded-lg p-4 md:p-5 shadow-card mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-display font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />Pipeline de Ventas
            </h2>
            <Link to="/pipeline" className="text-xs text-primary hover:underline">Ver pipeline →</Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="text-center">
              <p className="text-2xl font-black font-display text-foreground">{pipelineStats.total}</p>
              <p className="text-xs text-muted-foreground">Total deals</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-black font-display text-emerald-400">{pipelineStats.won}</p>
              <p className="text-xs text-muted-foreground">Cerrados</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-black font-display text-primary">{pipelineStats.active}</p>
              <p className="text-xs text-muted-foreground">Activos</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-black font-display text-yellow-400">
                {pipelineStats.total > 0 ? ((pipelineStats.won / pipelineStats.total) * 100).toFixed(0) : 0}%
              </p>
              <p className="text-xs text-muted-foreground">Win rate</p>
            </div>
          </div>
          {/* Funnel bar */}
          <div className="space-y-1.5">
            {pipelineStats.total > 0 && (
              <div className="flex rounded-full overflow-hidden h-3">
                {pipelineStats.won > 0 && (
                  <div
                    className="bg-emerald-500 transition-all"
                    style={{ width: `${(pipelineStats.won / pipelineStats.total) * 100}%` }}
                    title={`Cerrados: ${pipelineStats.won}`}
                  />
                )}
                {pipelineStats.active > 0 && (
                  <div
                    className="bg-primary/60 transition-all"
                    style={{ width: `${(pipelineStats.active / pipelineStats.total) * 100}%` }}
                    title={`Activos: ${pipelineStats.active}`}
                  />
                )}
                {pipelineStats.lost > 0 && (
                  <div
                    className="bg-destructive/40 transition-all"
                    style={{ width: `${(pipelineStats.lost / pipelineStats.total) * 100}%` }}
                    title={`Perdidos: ${pipelineStats.lost}`}
                  />
                )}
              </div>
            )}
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />Cerrados</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary/60 inline-block" />Activos</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-destructive/40 inline-block" />Perdidos</span>
              {pipelineStats.wonValue > 0 && (
                <span className="ml-auto font-medium text-emerald-400">{formatARS(pipelineStats.wonValue)} ganados</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* P&L by Month */}
      {stats.salesByMonth.length > 0 && stats.salesByMonth.some((m: any) => m.expenses > 0) && (
        <div className="bg-card border border-border rounded-lg p-4 md:p-5 shadow-card mb-6">
          <h2 className="text-sm font-display font-semibold mb-4 text-muted-foreground uppercase tracking-wider">Resultado Neto por Mes (Ganancia − Gastos)</h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={stats.salesByMonth}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 15%, 18%)" />
              <XAxis dataKey="month" tick={{ fill: 'hsl(220, 10%, 55%)', fontSize: 11 }} axisLine={false} />
              <YAxis tick={{ fill: 'hsl(220, 10%, 55%)', fontSize: 10 }} axisLine={false} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number, name: string) => [formatARS(v), name === 'profit' ? 'Ganancia bruta' : name === 'expenses' ? 'Gastos' : 'Neto']} />
              <Legend formatter={(v: string) => v === 'profit' ? 'Ganancia bruta' : v === 'expenses' ? 'Gastos' : 'Resultado neto'} />
              <Bar dataKey="profit" fill="hsl(150, 60%, 40%)" radius={[3, 3, 0, 0]} name="profit" />
              <Bar dataKey="expenses" fill="hsl(0, 65%, 45%)" radius={[3, 3, 0, 0]} name="expenses" />
              <Bar dataKey="netProfit" fill="hsl(40, 70%, 50%)" radius={[3, 3, 0, 0]} name="netProfit" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Top 5 Products This Month */}
      {stats.topMonthProducts?.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4 mb-6 shadow-card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />Top productos este mes
            </h2>
            <Link to="/ventas" className="text-[10px] text-primary hover:underline">Ver ventas →</Link>
          </div>
          <div className="space-y-2 pb-12">
            {stats.topMonthProducts.map((p: any, i: number) => {
              const maxRev = stats.topMonthProducts[0]?.revenue || 1;
              const pct = (p.revenue / maxRev) * 100;
              const trend = p.prevRevenue > 0 ? ((p.revenue - p.prevRevenue) / p.prevRevenue) * 100 : null;
              return (
                <div key={p.name}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] font-bold text-muted-foreground/60 w-4 shrink-0">{i + 1}</span>
                      <span className="truncate font-medium">{p.name}</span>
                      <span className="text-muted-foreground shrink-0">×{p.qty}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-semibold font-mono">{formatARS(p.revenue)}</span>
                      {trend !== null && (
                        <span className={`text-[10px] font-medium ${trend >= 0 ? 'text-emerald-400' : 'text-destructive'}`}>
                          {trend >= 0 ? '▲' : '▼'}{Math.abs(trend).toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary/60 rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Margin Rankings */}
      {(stats.topMarginProducts?.length > 0 || stats.lowMarginProducts?.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6 md:mb-8">
          {stats.topMarginProducts?.length > 0 && (
            <div className="bg-card border border-border rounded-lg p-4 md:p-5 shadow-card">
              <h2 className="text-sm font-display font-semibold mb-3 text-emerald-400 uppercase tracking-wider flex items-center gap-2">
                <TrendingUp className="w-4 h-4" /> Top 5 Margen Más Alto
              </h2>
              <div className="space-y-2.5">
                {stats.topMarginProducts.map((p: any, i: number) => (
                  <div key={p.name} className="flex items-center justify-between text-sm">
                    <span className="truncate mr-2 text-muted-foreground">{i + 1}. {p.name}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-emerald-400 font-bold">{p.margin.toFixed(1)}%</span>
                      <span className="text-xs text-muted-foreground">{formatARS(p.profitARS)}/u</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {stats.lowMarginProducts?.length > 0 && (
            <div className="bg-card border border-yellow-500/30 rounded-lg p-4 md:p-5 shadow-card">
              <h2 className="text-sm font-display font-semibold mb-3 text-yellow-400 uppercase tracking-wider flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Margen Bajo (&lt;{stats.marginAlertPct}%) — Subir precio
              </h2>
              <div className="space-y-2.5">
                {stats.lowMarginProducts.map((p: any, i: number) => {
                  const suggestedPrice = stats.minPriceForMargin(p.costUSD, stats.marginAlertPct);
                  return (
                    <div key={p.name} className="flex items-center justify-between text-sm">
                      <span className="truncate mr-2 text-muted-foreground">{i + 1}. {p.name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-yellow-400 font-bold">{p.margin.toFixed(1)}%</span>
                        <span className="text-[10px] text-muted-foreground">Mín: {formatARS(suggestedPrice)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stock Alerts */}
      {(stats.lowStockProducts?.length > 0 || stats.outOfStockProducts?.length > 0) && (
        <div className="bg-card border border-destructive/30 rounded-lg p-4 md:p-5 shadow-card mb-6 md:mb-8">
          <h2 className="text-sm font-display font-semibold mb-3 text-destructive uppercase tracking-wider flex items-center gap-2">
            <Bell className="w-4 h-4" /> Alertas de Stock
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {stats.outOfStockProducts?.length > 0 && (
              <div className="bg-destructive/10 rounded-lg p-3">
                <p className="text-xs font-semibold text-destructive mb-2 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Sin Stock ({stats.outOfStockProducts.length})</p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {stats.outOfStockProducts.slice(0, 8).map((p: any) => (
                    <p key={p.id} className="text-xs text-muted-foreground truncate">• {p.name}</p>
                  ))}
                  {stats.outOfStockProducts.length > 8 && <p className="text-xs text-muted-foreground">+{stats.outOfStockProducts.length - 8} más</p>}
                </div>
              </div>
            )}
            {stats.lowStockProducts?.length > 0 && (
              <div className="bg-yellow-500/10 rounded-lg p-3">
                <p className="text-xs font-semibold text-yellow-400 mb-2 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Stock Bajo ≤{stats.lowStockThreshold} ({stats.lowStockProducts.length})</p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {stats.lowStockProducts.map((p: any) => (
                    <p key={p.id} className="text-xs text-muted-foreground truncate">• {p.name} — <span className="text-yellow-400 font-medium">{p.stock}u</span></p>
                  ))}
                </div>
              </div>
            )}
          </div>
          {stats.restockSuggestions?.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-xs font-semibold text-primary mb-2">🔄 Restock urgente — más vendidos con stock crítico</p>
              <div className="space-y-1.5">
                {stats.restockSuggestions.map((r: any) => (
                  <div key={r.name} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="font-medium truncate max-w-[160px]" title={r.name}>{r.name}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`px-1.5 py-0.5 rounded font-mono ${r.stock <= 0 ? "bg-red-500/20 text-red-400" : "bg-yellow-500/20 text-yellow-400"}`}>
                        {r.stock}u
                      </span>
                      {r.daysOfStock !== Infinity && (
                        <span className="text-muted-foreground">{r.daysOfStock}d</span>
                      )}
                      {r.suggestedOrder > 0 && (
                        <span className="text-emerald-400 font-semibold">→ pedir {r.suggestedOrder}u</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Stock Heatmap */}
      {stats.products?.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4 md:p-5 shadow-card mb-6 md:mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-display font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Package className="w-4 h-4" />Mapa de inventario
            </h2>
            <Link to="/productos" className="text-xs text-primary hover:underline">Ver productos →</Link>
          </div>
          <StockHeatmapWidget products={stats.products} maxTiles={80} />
        </div>
      )}

      {/* Próximas compras sugeridas */}
      {stats.restockSuggestions?.length > 0 && (
        <div className="bg-card border border-primary/20 rounded-xl p-4 md:p-5 shadow-card mb-6 md:mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-display font-semibold text-primary uppercase tracking-wider flex items-center gap-2">
              <Package className="w-4 h-4" />Próximas compras sugeridas
            </h2>
            <Link to="/compras" className="text-xs text-primary hover:underline">Ver compras →</Link>
          </div>
          <div className="space-y-2 pb-12">
            {stats.restockSuggestions.map((r: any) => {
              const urgency = r.daysOfStock !== Infinity && r.daysOfStock <= 5 ? 'destructive' : r.daysOfStock <= 14 ? 'warning' : 'success';
              const barPct = r.daysOfStock !== Infinity ? Math.min((r.daysOfStock / 30) * 100, 100) : 100;
              return (
                <div key={r.name} className="bg-muted/30 rounded-lg p-3">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <p className="text-sm font-medium truncate max-w-[55%]" title={r.name}>{r.name}</p>
                    <div className="flex items-center gap-2 text-xs shrink-0">
                      <span className={`px-1.5 py-0.5 rounded font-mono font-semibold ${r.stock <= 0 ? 'bg-destructive/20 text-destructive' : urgency === 'warning' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-primary/20 text-primary'}`}>
                        {r.stock}u stock
                      </span>
                      {r.suggestedOrder > 0 && (
                        <span className="text-emerald-400 font-semibold">→ pedir {r.suggestedOrder}u</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${urgency === 'destructive' ? 'bg-destructive' : urgency === 'warning' ? 'bg-yellow-500' : 'bg-primary'}`}
                        style={{ width: `${barPct}%` }} />
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {r.daysOfStock !== Infinity ? `${r.daysOfStock}d de stock` : 'Sin velocidad'}
                      {r.unitsPerDay > 0 && ` · ${r.unitsPerDay.toFixed(1)}u/día`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          <button
            onClick={() => {
              const list = stats.restockSuggestions.map((r: any) => `${r.name} (${r.stock}u, ${r.daysOfStock !== Infinity ? r.daysOfStock + 'd restantes' : 'sin datos'}, sugerir ${r.suggestedOrder}u)`).join('\n');
              sessionStorage.setItem("gestiona.ai_prefill", `Tengo estos productos con stock crítico:\n${list}\n\n¿Qué priorizo comprar primero y por qué?`);
              navigate("/chat-ia");
            }}
            className="mt-3 text-xs text-primary hover:underline flex items-center gap-1"
          >
            <Zap className="w-3.5 h-3.5" />Consultar prioridad con IA
          </button>
        </div>
      )}

      {/* Financial Tools */}
      <FinancialSection stats={stats} />

      {/* Cash Flow + Health + AI */}
      <CashFlowProjector
        sales={stats.rawSales} debts={stats.rawDebts} expenses={stats.rawExpenses}
        purchases={stats.rawPurchases} settings={stats.rawSettings}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6 md:mb-8">
        <HealthScore
          sales={stats.rawSales} expenses={stats.rawExpenses} debts={stats.rawDebts}
          products={stats.products} settings={stats.rawSettings}
        />
        <AIPrediction sales={stats.rawSales} />
      </div>

      {/* MoM Growth + Top Customers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6 md:mb-8">
        <div className="bg-card border border-border rounded-lg p-4 md:p-5 shadow-card">
          <h2 className="text-sm font-display font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Crecimiento Mes a Mes</h2>
          <div className="space-y-3 pb-12">
            <div>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-muted-foreground">Ventas</span>
                <span className={`font-bold flex items-center gap-1 ${stats.salesGrowth >= 0 ? 'text-emerald-400' : 'text-destructive'}`}>
                  {stats.salesGrowth >= 0 ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
                  {Math.abs(stats.salesGrowth).toFixed(1)}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{formatARS(stats.monthSalesARS)} este mes</p>
            </div>
            <div>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-muted-foreground">Ganancia</span>
                <span className={`font-bold flex items-center gap-1 ${stats.profitGrowth >= 0 ? 'text-emerald-400' : 'text-destructive'}`}>
                  {stats.profitGrowth >= 0 ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
                  {Math.abs(stats.profitGrowth).toFixed(1)}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{formatARS(stats.monthGrossProfit)} bruta</p>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 bg-card border border-border rounded-lg p-4 md:p-5 shadow-card">
          <h2 className="text-sm font-display font-semibold mb-3 text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Crown className="w-4 h-4 text-primary" />Top 5 Clientes del Mes
          </h2>
          {stats.topCustomers.length > 0 ? (
            <div className="space-y-2 pb-12">
              {stats.topCustomers.map((c: any, i: number) => (
                <div key={c.name} className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs shrink-0">
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{i + 1}. {c.name}</p>
                    <p className="text-[10px] text-muted-foreground">{c.count} compras</p>
                  </div>
                  <span className="text-sm font-bold text-primary shrink-0">{formatARS(c.total)}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-muted-foreground text-sm py-4 text-center">Sin ventas este mes</p>}

          {/* Canal de ventas — only show if there are 2+ distinct sources */}
          {(stats.salesByChannel || []).length > 1 && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2.5">Canal de ventas este mes</p>
              <div className="space-y-1.5">
                {(stats.salesByChannel as { source: string; total: number }[]).map(({ source, total }) => {
                  const label: Record<string, string> = { manual: "Registro manual", pos: "POS", tiendanube: "Tiendanube", api: "API" };
                  const pct = stats.monthSalesARS > 0 ? (total / stats.monthSalesARS) * 100 : 0;
                  return (
                    <div key={source}>
                      <div className="flex justify-between text-xs mb-0.5">
                        <span className="text-muted-foreground capitalize">{label[source] || source}</span>
                        <span className="font-medium">{pct.toFixed(0)}%</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-primary/60" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Top Products + Recent Sales */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-lg p-4 md:p-5 shadow-card">
          <h2 className="text-sm font-display font-semibold mb-4 text-muted-foreground uppercase tracking-wider">Productos Más Vendidos</h2>
          {stats.topProducts.length > 0 ? (
            <div className="space-y-3 pb-12">
              {stats.topProducts.map((p: any, i: number) => {
                const maxRev = stats.topProducts[0]?.revenue || 1;
                return (
                  <div key={p.name}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium truncate mr-2">{i + 1}. {p.name}</span>
                      <span className="text-muted-foreground shrink-0 text-xs">{p.qty}u · <span className="text-emerald-400">{formatARS(p.profit)}</span></span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full gradient-gold" style={{ width: `${(p.revenue / maxRev) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : <p className="text-muted-foreground text-sm py-8 text-center">Sin ventas registradas</p>}
        </div>

        <div className="bg-card border border-border rounded-lg overflow-hidden shadow-card">
          <h2 className="text-sm font-display font-semibold p-4 md:p-5 pb-3 text-muted-foreground uppercase tracking-wider">Últimas Ventas</h2>
          {stats.recentSales.length > 0 ? (
            <>
              <div className="hidden md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left p-3 font-medium">Producto</th>
                      <th className="text-left p-3 font-medium">Cliente</th>
                      <th className="text-right p-3 font-medium">Total</th>
                      <th className="text-right p-3 font-medium">Ganancia</th>
                      <th className="text-center p-3 font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentSales.map((s: any) => (
                      <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="p-3 truncate max-w-[150px]">{s.product_name}</td>
                        <td className="p-3">{s.customer_name || '—'}</td>
                        <td className="p-3 text-right font-medium">{formatARS(Number(s.total_ars))}</td>
                        <td className="p-3 text-right">
                          <span className={Number(s.profit_ars) > 0 ? 'text-emerald-400' : 'text-destructive'}>{formatARS(Number(s.profit_ars))}</span>
                        </td>
                        <td className="p-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.paid ? 'bg-emerald-500/20 text-emerald-400' : 'bg-destructive/20 text-destructive'}`}>
                            {s.paid ? 'Pagado' : 'Debe'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="md:hidden divide-y divide-border">
                {stats.recentSales.map((s: any) => (
                  <div key={s.id} className="p-3 flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{s.product_name}</p>
                      <p className="text-xs text-muted-foreground">{s.customer_name || 'Sin cliente'}</p>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <p className="text-sm font-medium">{formatARS(Number(s.total_ars))}</p>
                      <span className={`text-xs ${s.paid ? 'text-emerald-400' : 'text-destructive'}`}>{s.paid ? 'Pagado' : 'Debe'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : <p className="p-5 text-muted-foreground text-sm">No hay ventas registradas aún.</p>}
        </div>
      </div>

      {/* Daily Briefing Modal */}
      {briefingOpen && user && stats && (
        <DailyBriefingModal
          open={briefingOpen}
          onClose={() => setBriefingOpen(false)}
          userId={user.id}
          briefingData={(() => {
            const today = new Date().toISOString().slice(0, 10);
            const yday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
            const ydaySales = (stats.rawSales || []).filter((s: any) => String(s.date).slice(0, 10) === yday);
            const topProductsMap: Record<string, number> = {};
            ydaySales.forEach((s: any) => { if (s.product_name) topProductsMap[s.product_name] = (topProductsMap[s.product_name] || 0) + Number(s.quantity || 1); });
            const topProduct = Object.entries(topProductsMap).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
            const lowStockCount = (stats.products || []).filter((p: any) => p.stock <= (p.low_stock_threshold ?? 3)).length;
            const unpaidDebts = (stats.rawDebts || []).filter((d: any) => d.status !== 'paid');
            return {
              salesCount: ydaySales.length,
              totalSalesARS: ydaySales.reduce((s: number, v: any) => s + Number(v.total_ars || 0), 0),
              topProduct,
              lowStockCount,
              pendingDebtsARS: unpaidDebts.reduce((s: number, d: any) => s + Number(d.remaining_ars || 0), 0),
              pendingDebtsCount: unpaidDebts.length,
              businessName: stats.rawSettings?.business_name || "tu negocio",
              date: today,
            };
          })()}
        />
      )}
    </div>
  );
}
