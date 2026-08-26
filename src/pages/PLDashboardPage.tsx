import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useOrg } from "@/lib/orgContext";
import { useBusinessConfig } from "@/lib/useBusinessConfig";
import { usePageTitle } from "@/hooks/usePageTitle";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from "recharts";
import {
  TrendingUp, TrendingDown, Minus, DollarSign, ShoppingCart, Wallet,
  ArrowDownRight, ArrowUpRight, Download, BarChart2, AlertTriangle,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import FinancialScenariosTab from "@/components/finance/FinancialScenariosTab";
import DateRangeFilter, { useDateRangeFilter } from "@/components/shared/DateRangeFilter";
import StoreFilter, { useStoreFilter } from "@/components/shared/StoreFilter";
import { orgViewKey, usePersistedState } from "@/hooks/usePersistedState";
// StoreFilter scopes sales/expenses to the selected sucursal via `location_id`.
// Purchases carry no location_id, so they are not scoped by store.

// ── Types ─────────────────────────────────────────────────────────────────────
interface Expense { amount_ars?: number; amount?: number; date: string; category?: string; location_id?: string | null }

// ── Helpers ───────────────────────────────────────────────────────────────────
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

/** Lo que devuelve `ledger_resultado_mensual`. Los importes vienen como
 *  `numeric`, que PostgREST serializa a string: se convierten con Number. */
interface LedgerMonth {
  mes: string;
  ingresos: number | string;
  costo_mercaderia: number | string;
  margen_bruto: number | string;
  gastos_operativos: number | string;
  resultado: number | string;
  ventas_sin_costo: number | string;
}

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
  /** Ventas del mes sin costo conocido: su margen no se puede afirmar. */
  ventasSinCosto: number;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function PLDashboardPage() {
  usePageTitle("Dashboard P&L");
  const { activeOrg } = useOrg();
  const config = useBusinessConfig();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [months, setMonths] = useState(12);
  const [selectedYm, setSelectedYm] = useState<string | null>(null);
  const [activeTab, setActiveTab] = usePersistedState(
    orgViewKey("pl-dashboard.tab", activeOrg?.id),
    "mensual",
  );
  const { from: dateFrom, to: dateTo, inRange } = useDateRangeFilter();
  const { storeId } = useStoreFilter();

  useEffect(() => {
    if (!activeOrg) return;
    setLoading(true);
    const since = new Date();
    since.setMonth(since.getMonth() - 24);
    const sinceStr = since.toISOString();
    // Sólo los gastos: el desglose por categoría necesita el detalle de cada
    // fila. Las ventas y las compras ya no se cargan — el resultado lo da el
    // ledger, y traer 24 meses de ventas para no usarlas era puro peso.
    supabase
      .from("expenses")
      .select("amount_ars, date, category, location_id")
      .eq("org_id", activeOrg.id)
      .gte("date", sinceStr.slice(0, 10))
      .then(({ data, error }) => {
        if (error) console.error("no se pudieron leer los gastos", error.message);
        setExpenses((data as Expense[]) || []);
        setLoading(false);
      });
  }, [activeOrg]);

  // ── Monthly P&L data ───────────────────────────────────────────────────────
  // Shared date-range filter (URL-persisted) — scopes which raw rows feed the P&L
  const hasDateFilter = !!dateFrom;
  // ⚠️ El filtro de fecha y sucursal aplica SOLO al desglose de gastos por
  //    categoría. La serie mensual del P&L viene del ledger, que no lleva
  //    `location_id`: filtrarla acá sería mentir — mostraría el mismo número
  //    con cualquier sucursal elegida.
  const filteredExpenses = useMemo(() => {
    let out = hasDateFilter ? expenses.filter(e => inRange(e.date)) : expenses;
    if (storeId) out = out.filter(e => e.location_id === storeId);
    return out;
  }, [expenses, hasDateFilter, dateFrom, dateTo, storeId]);

  // ── El resultado sale del ledger, no del navegador ──────────────────────
  //
  // ⚠️ Acá se calculaba el P&L sumando filas de `sales`, `expenses` y
  //    `purchases` en el cliente. `ReportsPage` y `AnalyticsPage` hacían lo
  //    suyo por separado, así que el mismo mes podía dar números distintos
  //    según qué pantalla se abriera — y éste estaba mal: informaba margen
  //    bruto 100% porque el costo le daba cero.
  //
  //    `ledger_resultado_mensual` suma **cuentas contables**, no filas de
  //    ventas. Si mañana entra un ingreso que no es una venta, aparece sin
  //    tocar esta pantalla. Ver 20260826000280.
  const [monthlyPL, setMonthlyPL] = useState<MonthlyPL[]>([]);

  useEffect(() => {
    if (!activeOrg) return;
    let vigente = true;
    supabase
      .rpc("ledger_resultado_mensual", { p_org: activeOrg.id, p_meses: months })
      .then(({ data, error }) => {
        if (!vigente) return;
        if (error) {
          // No se traga: un resultado que no se pudo leer no es un resultado
          // en cero. Ver la regla de `?? []` en CLAUDE.md.
          console.error("no se pudo leer el resultado del ledger", error.message);
          toast.error("No se pudo leer el resultado contable");
          setMonthlyPL([]);
          return;
        }
        const filas = (data ?? []) as LedgerMonth[];
        setMonthlyPL(filas.map(f => {
          const revenue = Number(f.ingresos) || 0;
          const cogs = Number(f.costo_mercaderia) || 0;
          const grossProfit = Number(f.margen_bruto) || 0;
          const expensesTotal = Number(f.gastos_operativos) || 0;
          const netProfit = Number(f.resultado) || 0;
          const d = new Date(`${f.mes}T12:00:00`);
          return {
            ym: f.mes.slice(0, 7),
            label: `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`,
            revenue, cogs, grossProfit,
            grossMargin: pct(grossProfit, revenue),
            expenses: expensesTotal,
            netProfit,
            netMargin: pct(netProfit, revenue),
            ventasSinCosto: Number(f.ventas_sin_costo) || 0,
          };
        }));
      });
    return () => { vigente = false; };
  }, [activeOrg, months]);

  // Cuántas ventas del período no tienen costo conocido. Ver el aviso de
  // arriba: sin esto, el margen se muestra mejor de lo que es y nadie lo sabe.
  const sinCostoTotal = useMemo(
    () => monthlyPL.reduce((n, m) => n + (m.ventasSinCosto || 0), 0),
    [monthlyPL],
  );

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

  // ── Expense breakdown by category (monthly view) ───────────────────────────
  const expenseByCategory = useMemo(() => {
    const catMap = new Map<string, number>();
    filteredExpenses.filter(e => {
      const d = yyyymm(new Date(e.date));
      return d === currentYm;
    }).forEach(e => {
      const cat = e.category || "Sin categoría";
      catMap.set(cat, (catMap.get(cat) || 0) + (e.amount_ars || e.amount || 0));
    });
    return Array.from(catMap.entries())
      .map(([cat, total]) => ({ cat, total }))
      .sort((a, b) => b.total - a.total);
  }, [filteredExpenses, currentYm]);

  // ── Expense breakdown YTD ─────────────────────────────────────────────────
  const expenseByCategoryYtd = useMemo(() => {
    const year = String(new Date().getFullYear());
    const catMap = new Map<string, number>();
    filteredExpenses.filter(e => yyyymm(new Date(e.date)).startsWith(year)).forEach(e => {
      const cat = e.category || "Sin categoría";
      catMap.set(cat, (catMap.get(cat) || 0) + (e.amount_ars || e.amount || 0));
    });
    return Array.from(catMap.entries())
      .map(([cat, total]) => ({ cat, total }))
      .sort((a, b) => b.total - a.total);
  }, [filteredExpenses]);

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

  // ── Trend value for KPICard (percentage vs prev month) ────────────────────
  const revenueTrend = currentPL && prevPL && prevPL.revenue > 0
    ? { value: ((currentPL.revenue - prevPL.revenue) / prevPL.revenue) * 100, label: "vs mes ant." }
    : undefined;
  const netProfitTrend = currentPL && prevPL && prevPL.netProfit !== 0
    ? { value: changePct(currentPL.netProfit, prevPL.netProfit) ?? 0, label: "vs mes ant." }
    : undefined;

  if (loading) return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-6 pb-12">
      {/* ── PageHeader ──────────────────────────────────────────────────────── */}
      <PageHeader
        icon={TrendingUp}
        title="Dashboard P&L"
        description="Estado de resultados en tiempo real"
        actions={
          <div className="flex flex-wrap items-center gap-2 flex-wrap">
            <StoreFilter />
            <DateRangeFilter label="Todo el período" />
            <button
              onClick={exportCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/60 text-xs hover:bg-muted/50 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Exportar CSV
            </button>
          </div>
        }
      />

      {sinCostoTotal > 0 && (
        <div className="rounded-[10px] border border-amber-500/30 bg-amber-500/10 p-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
            <div className="flex-1 min-w-0 text-sm">
              <p className="font-semibold text-amber-400">
                {sinCostoTotal} venta{sinCostoTotal !== 1 ? "s" : ""} sin costo conocido
              </p>
              <p className="text-xs text-amber-300/80 mt-0.5">
                El margen bruto de {sinCostoTotal !== 1 ? "esas ventas" : "esa venta"} no se
                puede calcular, así que el que ves acá está <strong>mejor de lo que es</strong>.
                No se rellena con las compras del período: una compra entra al stock, no al
                resultado.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── KPI Cards ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          label="Revenue"
          value={currentPL ? fmtK(currentPL.revenue) : "—"}
          sub={currentPL ? `${currentPL.label}` : "Sin datos"}
          icon={DollarSign}
          color="primary"
          trend={revenueTrend}
        />
        <KPICard
          label="Margen Bruto"
          value={currentPL ? `${currentPL.grossMargin}%` : "—"}
          sub={currentPL ? fmt(currentPL.grossProfit) : "Sin datos"}
          icon={BarChart2}
          color="blue"
        />
        <KPICard
          label="Ganancia Neta"
          value={currentPL ? fmtK(currentPL.netProfit) : "—"}
          sub={currentPL ? `Margen neto ${currentPL.netMargin}%` : "Sin datos"}
          icon={currentPL && currentPL.netProfit >= 0 ? TrendingUp : TrendingDown}
          color={currentPL && currentPL.netProfit < 0 ? "destructive" : "success"}
          trend={netProfitTrend}
        />
        <KPICard
          label="Gastos Operativos"
          value={currentPL ? fmtK(currentPL.expenses) : "—"}
          sub={currentPL ? currentPL.label : "Sin datos"}
          icon={Wallet}
          color="warning"
        />
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={value => setActiveTab(value)}>
        <TabsList>
          <TabsTrigger value="mensual">P&amp;L Mensual</TabsTrigger>
          <TabsTrigger value="ytd">YTD</TabsTrigger>
          <TabsTrigger value="gastos">Desglose de Gastos</TabsTrigger>
          <TabsTrigger value="comparacion">Comparación</TabsTrigger>
          <TabsTrigger value="escenarios">Escenarios</TabsTrigger>
        </TabsList>

        {/* ── Tab: Mensual ──────────────────────────────────────────────────── */}
        <TabsContent value="mensual" className="space-y-5 pb-12">
          {/* Month selector + range selector */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide flex-1">
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
            <Select value={String(months)} onValueChange={value => setMonths(Number(value))}>
              <SelectTrigger className="h-9 w-[112px] shrink-0 text-xs" aria-label="Rango de meses"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="6">6 meses</SelectItem>
                <SelectItem value="12">12 meses</SelectItem>
                <SelectItem value="24">24 meses</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Income statement card */}
          {currentPL && (
            <div className="rounded-xl border border-border/60 bg-card p-6">
              <h3 className="text-sm font-semibold mb-5">Estado de resultados — {currentPL.label}</h3>
              <div className="space-y-1 pb-12">
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

          {/* Revenue vs Net Profit trend chart */}
          <div className="rounded-xl border border-border/60 bg-card p-5">
            <h3 className="text-sm font-semibold mb-4">Ingresos vs Ganancia neta</h3>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={monthlyPL} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} tickFormatter={fmtK} width={60} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number, n: string) => [fmt(v), n === "revenue" ? "Ingresos" : n === "expenses" ? "Gastos" : "Neta"]}
                />
                <Legend formatter={(v) => v === "revenue" ? "Ingresos" : v === "expenses" ? "Gastos" : "Ganancia Neta"} />
                <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="netProfit" stroke="#10b981" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="expenses" stroke="#ef4444" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Waterfall bar chart */}
          <div className="rounded-xl border border-border/60 bg-card p-5">
            <h3 className="text-sm font-semibold mb-4">Waterfall mensual</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyPL.slice(-6)} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} tickFormatter={fmtK} width={60} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number, n: string) => [fmt(v), { grossProfit: "Ganancia bruta", expenses: "Gastos", netProfit: "Neta" }[n] || n]}
                />
                <Bar dataKey="grossProfit" fill="#3b82f6" radius={[2, 2, 0, 0]} name="grossProfit" />
                <Bar dataKey="expenses" fill="#ef4444" radius={[2, 2, 0, 0]} name="expenses" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Historical table */}
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
                      onClick={() => setSelectedYm(m.ym)}
                      className={`cursor-pointer hover:bg-muted/20 transition-colors ${m.ym === currentYm ? "bg-primary/5" : ""}`}
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
        </TabsContent>

        {/* ── Tab: YTD ──────────────────────────────────────────────────────── */}
        <TabsContent value="ytd" className="space-y-5 pb-12">
          {/* YTD summary cards */}
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

          {/* YTD monthly trend */}
          <div className="rounded-xl border border-border/60 bg-card p-5">
            <h3 className="text-sm font-semibold mb-4">Tendencia {new Date().getFullYear()}</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={monthlyPL.filter(m => m.ym.startsWith(String(new Date().getFullYear())))}
                margin={{ top: 5, right: 20, left: 0, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} />
                <YAxis tick={{ fontSize: 9 }} tickFormatter={fmtK} width={60} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                  formatter={(v: number, n: string) => [fmt(v), { revenue: "Ingresos", netProfit: "Ganancia Neta", expenses: "Gastos" }[n] || n]}
                />
                <Legend formatter={(v) => ({ revenue: "Ingresos", netProfit: "Ganancia Neta", expenses: "Gastos" })[v] || v} />
                <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} name="revenue" />
                <Bar dataKey="netProfit" fill="#10b981" radius={[2, 2, 0, 0]} name="netProfit" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </TabsContent>

        {/* ── Tab: Gastos ───────────────────────────────────────────────────── */}
        <TabsContent value="gastos" className="space-y-5 pb-12">
          {/* Monthly breakdown */}
          {expenseByCategory.length > 0 && (
            <div className="rounded-xl border border-border/60 bg-card p-5">
              <h3 className="text-sm font-semibold mb-4">
                Gastos por categoría — {currentPL?.label ?? "Mes actual"}
              </h3>
              <div className="space-y-2 pb-12">
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

          {/* YTD breakdown */}
          {expenseByCategoryYtd.length > 0 && (
            <div className="rounded-xl border border-border/60 bg-card p-5">
              <h3 className="text-sm font-semibold mb-4">
                Gastos por categoría — YTD {new Date().getFullYear()}
              </h3>
              <div className="space-y-2 pb-12">
                {expenseByCategoryYtd.map((c, i) => {
                  const total = expenseByCategoryYtd.reduce((s, e) => s + e.total, 0);
                  const widthPct = total > 0 ? (c.total / total) * 100 : 0;
                  return (
                    <div key={i} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-32 truncate shrink-0">{c.cat}</span>
                      <div className="flex-1 h-2 rounded-full bg-muted/40 overflow-hidden">
                        <div className="h-full rounded-full bg-orange-500/60" style={{ width: `${widthPct}%` }} />
                      </div>
                      <span className="text-xs font-mono font-semibold shrink-0 w-24 text-right">{fmt(c.total)}</span>
                      <span className="text-xs text-muted-foreground shrink-0 w-10 text-right">{widthPct.toFixed(0)}%</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {expenseByCategory.length === 0 && expenseByCategoryYtd.length === 0 && (
            <div className="rounded-xl border border-border/40 bg-card p-10 text-center text-sm text-muted-foreground">
              No hay gastos registrados para mostrar.
            </div>
          )}
        </TabsContent>

        {/* ── Tab: Comparación ─────────────────────────────────────────────── */}
        <TabsContent value="comparacion" className="space-y-5 pb-12">
          {currentPL && prevPL ? (
            <>
              {/* Side-by-side summary */}
              <div className="grid grid-cols-2 gap-4">
                {[
                  { title: prevPL.label, pl: prevPL, muted: true },
                  { title: currentPL.label, pl: currentPL, muted: false },
                ].map(({ title, pl, muted }) => (
                  <div key={title} className={`rounded-xl border bg-card p-5 ${muted ? "opacity-70 border-border/40" : "border-primary/30"}`}>
                    <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{title}</h4>
                    <div className="space-y-2 pb-12">
                      {[
                        { label: "Ingresos", value: pl.revenue, color: "text-foreground" },
                        { label: "COGS", value: pl.cogs, color: "text-orange-400" },
                        { label: "Ganancia Bruta", value: pl.grossProfit, color: "text-blue-400" },
                        { label: "Gastos", value: pl.expenses, color: "text-red-400" },
                        { label: "Ganancia Neta", value: pl.netProfit, color: pl.netProfit >= 0 ? "text-emerald-400" : "text-red-400" },
                      ].map(row => (
                        <div key={row.label} className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">{row.label}</span>
                          <span className={`text-xs font-mono font-semibold ${row.color}`}>{fmt(row.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Bar chart comparison */}
              <div className="rounded-xl border border-border/60 bg-card p-5">
                <h3 className="text-sm font-semibold mb-4">
                  Comparación {prevPL.label} vs {currentPL.label}
                </h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart
                    data={[
                      { metric: "Ingresos", anterior: prevPL.revenue, actual: currentPL.revenue },
                      { metric: "Ganancia Bruta", anterior: prevPL.grossProfit, actual: currentPL.grossProfit },
                      { metric: "Gastos", anterior: prevPL.expenses, actual: currentPL.expenses },
                      { metric: "Neta", anterior: prevPL.netProfit, actual: currentPL.netProfit },
                    ]}
                    margin={{ top: 5, right: 20, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="metric" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 9 }} tickFormatter={fmtK} width={60} />
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
                      formatter={(v: number, n: string) => [fmt(v), n === "anterior" ? prevPL.label : currentPL.label]}
                    />
                    <Legend formatter={(v) => v === "anterior" ? prevPL.label : currentPL.label} />
                    <Bar dataKey="anterior" fill="hsl(var(--border))" radius={[2, 2, 0, 0]} name="anterior" />
                    <Bar dataKey="actual" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} name="actual" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Delta table */}
              <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
                <div className="p-4 border-b border-border/40">
                  <h3 className="text-sm font-semibold">Variación mes a mes</h3>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/40 text-xs text-muted-foreground bg-muted/10">
                      <th className="px-4 py-3 text-left">Métrica</th>
                      <th className="px-4 py-3 text-right">{prevPL.label}</th>
                      <th className="px-4 py-3 text-right">{currentPL.label}</th>
                      <th className="px-4 py-3 text-right">Variación</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {[
                      { label: "Ingresos", curr: currentPL.revenue, prev: prevPL.revenue },
                      { label: "COGS", curr: currentPL.cogs, prev: prevPL.cogs },
                      { label: "Ganancia Bruta", curr: currentPL.grossProfit, prev: prevPL.grossProfit },
                      { label: "Gastos Operativos", curr: currentPL.expenses, prev: prevPL.expenses },
                      { label: "Ganancia Neta", curr: currentPL.netProfit, prev: prevPL.netProfit },
                    ].map(row => {
                      const delta = changePct(row.curr, row.prev);
                      return (
                        <tr key={row.label} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2.5 text-sm">{row.label}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">{fmt(row.prev)}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold">{fmt(row.curr)}</td>
                          <td className="px-4 py-2.5 text-right text-xs">
                            {delta === null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <span className={`font-semibold ${delta >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {delta >= 0 ? "+" : ""}{delta.toFixed(1)}%
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-border/40 bg-card p-10 text-center text-sm text-muted-foreground">
              Se necesitan al menos dos meses de datos para mostrar la comparación.
            </div>
          )}
        </TabsContent>

        {/* ── Tab: Escenarios ───────────────────────────────────────────────── */}
        <TabsContent value="escenarios">
          <FinancialScenariosTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
