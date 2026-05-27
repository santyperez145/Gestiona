import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { useBusinessConfig } from "@/lib/useBusinessConfig";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend, Cell,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, DollarSign, ShoppingCart, Wallet, ArrowDownRight, ArrowUpRight, Download } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Sale { total_ars: number; created_at: string; cost_of_goods_ars?: number }
interface Expense { amount_ars?: number; amount?: number; date: string; category?: string }
interface Purchase { total_ars: number; created_at: string }

// ── Helpers ───────────────────────────────────────────────────────────────────
const MONTHS_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
                   "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
const MONTHS_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function yyyymm(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }
function addMonth(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return yyyymm(d);
}

const fmt = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
const fmtK = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${Math.round(n)}`;
};

function pct(a: number, b: number) { return b === 0 ? 0 : Math.round((a / b) * 100); }
function changePct(curr: number, prev: number) { return prev === 0 ? null : ((curr - prev) / prev) * 100; }

interface MonthlyPL {
  ym: string;
  label: string;
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number;
  expenses: number;
  netProfit: number;
  netMargin: number;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PLDashboardPage() {
  const { activeOrg } = useOrg();
  const config = useBusinessConfig();
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [months, setMonths] = useState(12);
  const [selectedYm, setSelectedYm] = useState<string | null>(null);
  const [view, setView] = useState<"monthly" | "ytd">("monthly");

  useEffect(() => {
    if (!activeOrg) return;
    setLoading(true);
    const since = new Date();
    since.setMonth(since.getMonth() - 24);
    const sinceStr = since.toISOString();
    Promise.all([
      supabase.from("sales").select("total_ars, created_at, cost_of_goods_ars").eq("org_id", activeOrg.id).gte("created_at", sinceStr),
      supabase.from("expenses").select("amount_ars, amount, date, category").eq("org_id", activeOrg.id).gte("date", sinceStr.slice(0, 10)),
      supabase.from("purchases").select("total_ars, created_at").eq("org_id", activeOrg.id).gte("created_at", sinceStr),
    ]).then(([{ data: s }, { data: e }, { data: p }]) => {
      setSales((s as Sale[]) || []);
      setExpenses((e as Expense[]) || []);
      setPurchases((p as Purchase[]) || []);
      setLoading(false);
    });
  }, [activeOrg]);

  // ── Monthly P&L data ───────────────────────────────────────────────────────
  const monthlyPL = useMemo<MonthlyPL[]>(() => {
    const today = new Date();
    const result: MonthlyPL[] = [];

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const ym = yyyymm(d);
      const label = `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;

      const revenue = sales.filter(s => yyyymm(new Date(s.created_at)) === ym)
        .reduce((sum, s) => sum + (s.total_ars || 0), 0);

      // COGS: use cost_of_goods_ars if available, else purchases made in same month
      const cogsDirect = sales.filter(s => yyyymm(new Date(s.created_at)) === ym)
        .reduce((sum, s) => sum + (s.cost_of_goods_ars || 0), 0);
      const purchasesCogs = purchases.filter(p => yyyymm(new Date(p.created_at)) === ym)
        .reduce((sum, p) => sum + (p.total_ars || 0), 0);
      const cogs = cogsDirect > 0 ? cogsDirect : purchasesCogs;

      const grossProfit = revenue - cogs;
      const grossMargin = pct(grossProfit, revenue);

      const expensesTotal = expenses.filter(e => {
        const ed = new Date(e.date);
        return yyyymm(ed) === ym;
      }).reduce((sum, e) => sum + (e.amount_ars || e.amount || 0), 0);

      const netProfit = grossProfit - expensesTotal;
      const netMargin = pct(netProfit, revenue);

      result.push({ ym, label, revenue, cogs, grossProfit, grossMargin, expenses: expensesTotal, netProfit, netMargin });
    }
    return result;
  }, [sales, expenses, purchases, months]);

  // ── Current month detail ───────────────────────────────────────────────────
  const currentYm = selectedYm || yyyymm(new Date());
  const currentPL = monthlyPL.find(m => m.ym === currentYm) || null;
  const prevPL = monthlyPL.find(m => m.ym === addMonth(currentYm, -1)) || null;

  // ── YTD totals ─────────────────────────────────────────────────────────────
  const ytd = useMemo(() => {
    const year = new Date().getFullYear();
    const ytdMonths = monthlyPL.filter(m => m.ym.startsWith(String(year)));
    return {
      revenue: ytdMonths.reduce((s, m) => s + m.revenue, 0),
      cogs: ytdMonths.reduce((s, m) => s + m.cogs, 0),
      grossProfit: ytdMonths.reduce((s, m) => s + m.grossProfit, 0),
      expenses: ytdMonths.reduce((s, m) => s + m.expenses, 0),
      netProfit: ytdMonths.reduce((s, m) => s + m.netProfit, 0),
    };
  }, [monthlyPL]);

  // ── Expense breakdown by category ─────────────────────────────────────────
  const expenseByCategory = useMemo(() => {
    const catMap = new Map<string, number>();
    const ymFilter = view === "ytd" ? yyyymm(new Date()).slice(0, 4) : currentYm;
    expenses.filter(e => {
      const d = yyyymm(new Date(e.date));
      return view === "ytd" ? d.startsWith(ymFilter) : d === ymFilter;
    }).forEach(e => {
      const cat = e.category || "Sin categoría";
      catMap.set(cat, (catMap.get(cat) || 0) + (e.amount_ars || e.amount || 0));
    });
    return Array.from(catMap.entries())
      .map(([cat, total]) => ({ cat, total }))
      .sort((a, b) => b.total - a.total);
  }, [expenses, currentYm, view]);

  const exportCSV = () => {
    const rows = [
      ["Mes", "Ingresos", "COGS", "Ganancia Bruta", "Mg Bruta %", "Gastos", "Ganancia Neta", "Mg Neta %"],
      ...monthlyPL.map(m => [m.label, m.revenue, m.cogs, m.grossProfit, `${m.grossMargin}%`, m.expenses, m.netProfit, `${m.netMargin}%`]),
    ].map(r => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows], { type: "text/csv" }));
    a.download = "pyg.csv";
    a.click();
  };

  const DeltaChip = ({ curr, prev }: { curr: number; prev: number }) => {
    const d = changePct(curr, prev);
    if (d === null) return null;
    if (Math.abs(d) < 0.5) return <span className="flex items-center gap-0.5 text-xs text-muted-foreground"><Minus className="w-3 h-3" />0%</span>;
    if (d > 0) return <span className="flex items-center gap-0.5 text-xs text-emerald-400"><ArrowUpRight className="w-3 h-3" />+{d.toFixed(1)}%</span>;
    return <span className="flex items-center gap-0.5 text-xs text-red-400"><ArrowDownRight className="w-3 h-3" />{d.toFixed(1)}%</span>;
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold">Estado de Resultados (P&L)</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {config.businessName} · {view === "ytd" ? `Acumulado ${new Date().getFullYear()}` : `Últimos ${months} meses`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-border/60 overflow-hidden text-sm">
            <button onClick={() => setView("monthly")} className={`px-3 py-1.5 transition-colors ${view === "monthly" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-muted/40"}`}>Mensual</button>
            <button onClick={() => setView("ytd")} className={`px-3 py-1.5 transition-colors ${view === "ytd" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-muted/40"}`}>Anual (YTD)</button>
          </div>
          {view === "monthly" && (
            <select value={months} onChange={e => setMonths(Number(e.target.value))} className="px-2 py-1.5 rounded-lg bg-muted/40 border border-border/40 text-xs outline-none">
              <option value={6}>6 meses</option>
              <option value={12}>12 meses</option>
              <option value={24}>24 meses</option>
            </select>
          )}
          <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/60 text-xs hover:bg-muted/50 transition-colors">
            <Download className="w-3.5 h-3.5" />CSV
          </button>
        </div>
      </div>

      {/* YTD summary */}
      {view === "ytd" ? (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: "Ingresos totales", value: ytd.revenue, icon: <DollarSign className="w-4 h-4 text-primary" />, color: "border-primary/20" },
            { label: "COGS", value: ytd.cogs, icon: <ShoppingCart className="w-4 h-4 text-orange-400" />, color: "border-orange-500/20" },
            { label: "Ganancia bruta", value: ytd.grossProfit, icon: <TrendingUp className="w-4 h-4 text-blue-400" />, color: "border-blue-500/20" },
            { label: "Gastos operativos", value: ytd.expenses, icon: <Wallet className="w-4 h-4 text-red-400" />, color: "border-red-500/20" },
            { label: "Ganancia neta", value: ytd.netProfit, icon: ytd.netProfit >= 0 ? <TrendingUp className="w-4 h-4 text-emerald-400" /> : <TrendingDown className="w-4 h-4 text-red-400" />, color: ytd.netProfit >= 0 ? "border-emerald-500/20" : "border-red-500/20" },
          ].map(k => (
            <div key={k.label} className={`rounded-xl border ${k.color} bg-card p-4`}>
              <div className="flex items-center gap-1.5 mb-1">{k.icon}<span className="text-xs text-muted-foreground">{k.label}</span></div>
              <p className={`text-xl font-bold font-display ${k.value < 0 ? "text-red-400" : ""}`}>{fmtK(k.value)}</p>
              {k.label === "Ganancia bruta" && <p className="text-xs text-muted-foreground mt-0.5">{pct(ytd.grossProfit, ytd.revenue)}% margen</p>}
              {k.label === "Ganancia neta" && <p className="text-xs text-muted-foreground mt-0.5">{pct(ytd.netProfit, ytd.revenue)}% margen neto</p>}
            </div>
          ))}
        </div>
      ) : (
        /* Month selector strip */
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {monthlyPL.slice(-6).map(m => (
            <button
              key={m.ym}
              onClick={() => setSelectedYm(m.ym)}
              className={`flex-shrink-0 flex flex-col items-center px-3 py-2 rounded-lg border text-xs transition-all ${
                m.ym === currentYm
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border/40 text-muted-foreground hover:border-border/70"
              }`}
            >
              <span className="font-medium">{m.label}</span>
              <span className={`font-bold mt-0.5 ${m.netProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmtK(m.netProfit)}</span>
            </button>
          ))}
        </div>
      )}

      {/* Income Statement card */}
      {view === "monthly" && currentPL && (
        <div className="rounded-xl border border-border/60 bg-card p-6">
          <h3 className="text-sm font-semibold mb-5">Estado de resultados — {currentPL.label}</h3>
          <div className="space-y-1">
            {[
              { label: "Ingresos por ventas", value: currentPL.revenue, indent: 0, bold: false, color: "text-foreground" },
              { label: "Costo de mercadería vendida (COGS)", value: -currentPL.cogs, indent: 1, bold: false, color: "text-orange-400" },
              { label: "GANANCIA BRUTA", value: currentPL.grossProfit, indent: 0, bold: true, color: currentPL.grossProfit >= 0 ? "text-blue-400" : "text-red-400", border: true },
              { label: `Margen bruto: ${currentPL.grossMargin}%`, value: null, indent: 1, bold: false, color: "text-muted-foreground" },
              { label: "Gastos operativos", value: -currentPL.expenses, indent: 1, bold: false, color: "text-red-400" },
              { label: "GANANCIA NETA", value: currentPL.netProfit, indent: 0, bold: true, color: currentPL.netProfit >= 0 ? "text-emerald-400" : "text-red-400", border: true },
              { label: `Margen neto: ${currentPL.netMargin}%`, value: null, indent: 1, bold: false, color: "text-muted-foreground" },
            ].map((row, i) => (
              <div key={i} className={`flex items-center justify-between py-2 ${row.border ? "border-t border-border/40 mt-1" : ""} ${row.indent ? "pl-4" : ""}`}>
                <span className={`text-sm ${row.bold ? "font-bold uppercase tracking-wide" : ""} ${!row.value && !row.bold ? "text-xs" : ""} ${row.color}`}>
                  {row.label}
                </span>
                {row.value !== null && (
                  <div className="flex items-center gap-3">
                    {prevPL && (
                      <DeltaChip
                        curr={row.label.includes("COGS") ? currentPL.cogs : row.label.includes("Gasto") ? currentPL.expenses : row.label.includes("BRUTA") ? currentPL.grossProfit : row.label.includes("NETA") ? currentPL.netProfit : currentPL.revenue}
                        prev={row.label.includes("COGS") ? prevPL.cogs : row.label.includes("Gasto") ? prevPL.expenses : row.label.includes("BRUTA") ? prevPL.grossProfit : row.label.includes("NETA") ? prevPL.netProfit : prevPL.revenue}
                      />
                    )}
                    <span className={`font-mono text-sm font-semibold ${row.color}`}>{fmt(Math.abs(row.value))}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Charts row */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Revenue vs Net Profit trend */}
        <div className="rounded-xl border border-border/60 bg-card p-5">
          <h3 className="text-sm font-semibold mb-4">Ingresos vs Ganancia neta</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={monthlyPL} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(228 20% 14%)" />
              <XAxis dataKey="label" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} tickFormatter={fmtK} width={60} />
              <Tooltip contentStyle={{ background: 'hsl(228 32% 6%)', border: '1px solid hsl(228 20% 18%)', borderRadius: 8, fontSize: 11 }}
                formatter={(v: number, n: string) => [fmt(v), n === "revenue" ? "Ingresos" : "Neta"]} />
              <Legend formatter={(v) => v === "revenue" ? "Ingresos" : "Ganancia Neta"} />
              <Line type="monotone" dataKey="revenue" stroke="hsl(38 82% 52%)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="netProfit" stroke="#10b981" strokeWidth={2} dot={false} />
              {view === "monthly" && <Line type="monotone" dataKey="expenses" stroke="#ef4444" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Stacked bar: gross profit vs expenses */}
        <div className="rounded-xl border border-border/60 bg-card p-5">
          <h3 className="text-sm font-semibold mb-4">Waterfall mensual</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthlyPL.slice(-6)} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(228 20% 14%)" />
              <XAxis dataKey="label" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} tickFormatter={fmtK} width={60} />
              <Tooltip contentStyle={{ background: 'hsl(228 32% 6%)', border: '1px solid hsl(228 20% 18%)', borderRadius: 8, fontSize: 11 }}
                formatter={(v: number, n: string) => [fmt(v), { grossProfit: "Ganancia bruta", expenses: "Gastos", netProfit: "Neta" }[n] || n]} />
              <Bar dataKey="grossProfit" fill="#3b82f6" radius={[2, 2, 0, 0]} name="grossProfit" />
              <Bar dataKey="expenses" fill="#ef4444" radius={[2, 2, 0, 0]} name="expenses" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Expense breakdown */}
      {expenseByCategory.length > 0 && (
        <div className="rounded-xl border border-border/60 bg-card p-5">
          <h3 className="text-sm font-semibold mb-4">
            Gastos por categoría — {view === "ytd" ? `YTD ${new Date().getFullYear()}` : currentPL?.label}
          </h3>
          <div className="space-y-2">
            {expenseByCategory.map((c, i) => {
              const total = expenseByCategory.reduce((s, e) => s + e.total, 0);
              const widthPct = total > 0 ? (c.total / total) * 100 : 0;
              return (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-32 truncate shrink-0">{c.cat}</span>
                  <div className="flex-1 h-2 rounded-full bg-muted/40 overflow-hidden">
                    <div className="h-full rounded-full bg-red-500/60" style={{ width: `${widthPct}%` }} />
                  </div>
                  <span className="text-xs font-mono font-semibold shrink-0 w-24 text-right">{fmt(c.total)}</span>
                  <span className="text-xs text-muted-foreground shrink-0 w-10 text-right">{widthPct.toFixed(0)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Monthly table */}
      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <div className="p-4 border-b border-border/40">
          <h3 className="text-sm font-semibold">Tabla histórica</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/40 text-xs text-muted-foreground bg-muted/10">
                <th className="px-4 py-3 text-left">Mes</th>
                <th className="px-4 py-3 text-right">Ingresos</th>
                <th className="px-4 py-3 text-right">COGS</th>
                <th className="px-4 py-3 text-right">Ganancia Bruta</th>
                <th className="px-4 py-3 text-right">Mg Bruto</th>
                <th className="px-4 py-3 text-right">Gastos</th>
                <th className="px-4 py-3 text-right">Ganancia Neta</th>
                <th className="px-4 py-3 text-right">Mg Neto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {monthlyPL.slice().reverse().map((m, i) => (
                <tr
                  key={i}
                  onClick={() => { setView("monthly"); setSelectedYm(m.ym); }}
                  className={`cursor-pointer hover:bg-muted/20 transition-colors ${m.ym === currentYm && view === "monthly" ? "bg-primary/5" : ""}`}
                >
                  <td className="px-4 py-2.5 font-medium text-sm">{m.label}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{fmt(m.revenue)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-orange-400">{m.cogs > 0 ? fmt(m.cogs) : "—"}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-blue-400">{fmt(m.grossProfit)}</td>
                  <td className="px-4 py-2.5 text-right text-xs">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${m.grossMargin >= 40 ? "bg-emerald-500/15 text-emerald-400" : m.grossMargin >= 20 ? "bg-blue-500/15 text-blue-400" : "bg-red-500/15 text-red-400"}`}>
                      {m.grossMargin}%
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-red-400">{m.expenses > 0 ? fmt(m.expenses) : "—"}</td>
                  <td className={`px-4 py-2.5 text-right font-mono text-xs font-semibold ${m.netProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmt(m.netProfit)}</td>
                  <td className="px-4 py-2.5 text-right text-xs">
                    <span className={`${m.netMargin >= 15 ? "text-emerald-400" : m.netMargin >= 5 ? "text-blue-400" : "text-red-400"}`}>{m.netMargin}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
