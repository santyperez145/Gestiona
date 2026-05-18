import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import {
  getProductsDB, getSalesDB, getPurchasesDB, getExpensesDB,
  formatARS,
} from "@/lib/supabaseStore";
import { supabase } from "@/integrations/supabase/client";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  TrendingUp, TrendingDown, BarChart3, Users, DollarSign,
  Package, Calendar, Percent, Clock, Filter, Brain, Sparkles,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PALETTE = [
  "hsl(40,70%,50%)", "hsl(150,60%,40%)", "hsl(200,70%,55%)",
  "hsl(280,60%,55%)", "hsl(0,65%,55%)", "hsl(60,70%,50%)",
];

function KPI({ label, value, sub, icon: Icon, trend, color = "text-foreground" }: {
  label: string; value: string; sub?: string;
  icon: typeof TrendingUp; trend?: number; color?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-2xl p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-muted-foreground uppercase tracking-wide">{label}</span>
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div className={`text-2xl font-display font-bold ${color}`}>{value}</div>
      {(sub || trend !== undefined) && (
        <div className="flex items-center gap-1 mt-0.5">
          {trend !== undefined && (
            trend >= 0
              ? <TrendingUp className="w-3 h-3 text-green-400" />
              : <TrendingDown className="w-3 h-3 text-red-400" />
          )}
          <p className={`text-xs ${trend !== undefined ? (trend >= 0 ? "text-green-400" : "text-red-400") : "text-muted-foreground"}`}>
            {trend !== undefined ? `${trend >= 0 ? "+" : ""}${trend.toFixed(1)}% vs año anterior` : sub}
          </p>
        </div>
      )}
    </div>
  );
}

const MONTHS_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function buildMonthlyData(sales: any[], expenses: any[], purchases: any[], yearOffset = 0) {
  const now = new Date();
  const year = now.getFullYear() - yearOffset;
  return MONTHS_ES.map((name, i) => {
    const monthSales = sales.filter((s) => {
      const d = new Date(s.date);
      return d.getFullYear() === year && d.getMonth() === i;
    });
    const monthExp = expenses.filter((e) => {
      const d = new Date(e.date);
      return d.getFullYear() === year && d.getMonth() === i;
    });
    const monthPurch = purchases.filter((p) => {
      const d = new Date(p.date);
      return d.getFullYear() === year && d.getMonth() === i;
    });
    const revenue = monthSales.reduce((s: number, v: any) => s + Number(v.total_ars), 0);
    const profit = monthSales.reduce((s: number, v: any) => s + Number(v.profit_ars), 0);
    const opex = monthExp.reduce((s: number, e: any) => s + Number(e.amount_ars), 0);
    const cogs = monthPurch.reduce((s: number, p: any) => s + Number(p.total_ars), 0);
    const units = monthSales.reduce((s: number, v: any) => s + Number(v.quantity), 0);
    return { name, revenue, profit, opex, cogs, units, net: profit - opex };
  });
}

function buildProductPerformance(sales: any[], products: any[]) {
  const map: Record<string, { name: string; revenue: number; profit: number; units: number; margin: number }> = {};
  for (const s of sales) {
    const key = s.product_name;
    if (!map[key]) {
      const prod = products.find((p: any) => p.name === key);
      map[key] = { name: key, revenue: 0, profit: 0, units: 0, margin: 0 };
    }
    map[key].revenue += Number(s.total_ars);
    map[key].profit += Number(s.profit_ars);
    map[key].units += Number(s.quantity);
  }
  return Object.values(map)
    .map((p) => ({ ...p, margin: p.revenue > 0 ? (p.profit / p.revenue) * 100 : 0 }))
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 15);
}

function buildCustomerData(sales: any[]) {
  const map: Record<string, { name: string; total: number; orders: number; first: Date; last: Date }> = {};
  for (const s of sales) {
    const key = s.customer_name || "Sin nombre";
    if (!map[key]) map[key] = { name: key, total: 0, orders: 0, first: new Date(s.date), last: new Date(s.date) };
    map[key].total += Number(s.total_ars);
    map[key].orders += 1;
    const d = new Date(s.date);
    if (d < map[key].first) map[key].first = d;
    if (d > map[key].last) map[key].last = d;
  }
  return Object.values(map).sort((a, b) => b.total - a.total).slice(0, 20);
}

const DAYS_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

function buildHeatmapData(sales: any[]) {
  // day-of-week × hour grid, counting sales count and revenue
  const grid: Record<string, { count: number; revenue: number }> = {};
  for (const s of sales) {
    if (!s.created_at && !s.date) continue;
    const d = new Date(s.created_at || s.date);
    const dow = d.getDay(); // 0=Sun
    const hour = d.getHours();
    const key = `${dow}-${hour}`;
    if (!grid[key]) grid[key] = { count: 0, revenue: 0 };
    grid[key].count += 1;
    grid[key].revenue += Number(s.total_ars) || 0;
  }
  return grid;
}

function buildHourlyBars(sales: any[]) {
  const hours = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: 0, revenue: 0 }));
  for (const s of sales) {
    if (!s.created_at && !s.date) continue;
    const d = new Date(s.created_at || s.date);
    const h = d.getHours();
    hours[h].count += 1;
    hours[h].revenue += Number(s.total_ars) || 0;
  }
  return hours.map(h => ({ ...h, label: `${String(h.hour).padStart(2, "0")}h` }));
}

function buildDailyBars(sales: any[]) {
  const days = DAYS_ES.map((name, i) => ({ name, dow: i, count: 0, revenue: 0 }));
  for (const s of sales) {
    if (!s.created_at && !s.date) continue;
    const d = new Date(s.created_at || s.date);
    const dow = d.getDay();
    days[dow].count += 1;
    days[dow].revenue += Number(s.total_ars) || 0;
  }
  // reorder to start on Monday
  const mon = days.slice(1).concat(days[0]);
  return mon;
}

function buildCategoryMix(sales: any[], products: any[]) {
  const map: Record<string, number> = {};
  for (const s of sales) {
    const prod = products.find((p: any) => p.name === s.product_name);
    const cat = prod?.category || "otros";
    map[cat] = (map[cat] || 0) + Number(s.profit_ars);
  }
  return Object.entries(map)
    .map(([cat, value]) => ({ name: cat, value: Math.round(value) }))
    .sort((a, b) => b.value - a.value);
}

const tooltipStyle = {
  contentStyle: { background: "hsl(220,15%,12%)", border: "1px solid hsl(220,15%,22%)", borderRadius: 8 },
  labelStyle: { color: "hsl(220,15%,70%)", fontSize: 11 },
  itemStyle: { color: "hsl(40,70%,60%)", fontSize: 11 },
};

function buildRentabilidadData(sales: any[], products: any[]) {
  // Per-product: accumulate revenue, cost (via profit = revenue - cost), gross profit
  const map: Record<string, { name: string; category: string; revenue: number; profit: number; units: number }> = {};
  for (const s of sales) {
    const key = s.product_name || "Sin nombre";
    const prod = products.find((p: any) => p.name === key || p.id === s.product_id);
    if (!map[key]) map[key] = { name: key, category: prod?.category || "otros", revenue: 0, profit: 0, units: 0 };
    map[key].revenue += Number(s.total_ars || 0);
    map[key].profit += Number(s.profit_ars || 0);
    map[key].units += Number(s.quantity || 1);
  }
  const list = Object.values(map)
    .map(p => ({ ...p, margin: p.revenue > 0 ? (p.profit / p.revenue) * 100 : 0 }))
    .filter(p => p.revenue > 0);

  const top5 = [...list].sort((a, b) => b.margin - a.margin).slice(0, 5);
  const bottom5 = [...list].filter(p => p.margin < 100).sort((a, b) => a.margin - b.margin).slice(0, 5);

  // Category breakdown
  const catMap: Record<string, { revenue: number; profit: number }> = {};
  for (const p of list) {
    if (!catMap[p.category]) catMap[p.category] = { revenue: 0, profit: 0 };
    catMap[p.category].revenue += p.revenue;
    catMap[p.category].profit += p.profit;
  }
  const byCategory = Object.entries(catMap)
    .map(([cat, d]) => ({ cat, revenue: d.revenue, profit: d.profit, margin: d.revenue > 0 ? (d.profit / d.revenue) * 100 : 0 }))
    .sort((a, b) => b.margin - a.margin);

  return { top5, bottom5, byCategory, totalProducts: list.length };
}

export default function AnalyticsPage() {
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const [rawData, setRawData] = useState<any>(null);
  const [year, setYear] = useState<"0" | "1">("0");
  const [trendFrom, setTrendFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 29); return d.toISOString().slice(0, 10);
  });
  const [trendTo, setTrendTo] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [products, sales, purchases, expenses] = await Promise.all([
        getProductsDB(user.id), getSalesDB(user.id),
        getPurchasesDB(user.id), getExpensesDB(user.id),
      ]);
      // Load quotes for funnel
      let quotes: any[] = [];
      if (activeOrg) {
        const { data } = await supabase.from("quotes").select("id,status,total_ars,created_at").eq("org_id", activeOrg.id);
        quotes = data || [];
      }
      setRawData({ products, sales, purchases, expenses, quotes });
    })();
  }, [user, activeOrg]);

  const derived = useMemo(() => {
    if (!rawData) return null;
    const { products, sales, purchases, expenses, quotes = [] } = rawData;
    const offset = Number(year);
    const monthly = buildMonthlyData(sales, expenses, purchases, offset);
    const prevMonthly = buildMonthlyData(sales, expenses, purchases, offset + 1);
    const productPerf = buildProductPerformance(sales, products);
    const customerData = buildCustomerData(sales);
    const categoryMix = buildCategoryMix(sales, products);
    const heatmap = buildHeatmapData(sales);
    const hourlyBars = buildHourlyBars(sales);
    const dailyBars = buildDailyBars(sales);

    const totalRevenue = monthly.reduce((s, m) => s + m.revenue, 0);
    const totalProfit = monthly.reduce((s, m) => s + m.profit, 0);
    const totalUnits = monthly.reduce((s, m) => s + m.units, 0);
    const prevRevenue = prevMonthly.reduce((s, m) => s + m.revenue, 0);
    const prevProfit = prevMonthly.reduce((s, m) => s + m.profit, 0);
    const revYoY = prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : 0;
    const profYoY = prevProfit > 0 ? ((totalProfit - prevProfit) / prevProfit) * 100 : 0;

    const yoyData = MONTHS_ES.map((name, i) => ({
      name,
      actual: Math.round(monthly[i].revenue),
      anterior: Math.round(prevMonthly[i].revenue),
    }));

    const uniqueCustomers = new Set(sales.map((s: any) => s.customer_name).filter(Boolean)).size;
    const avgTicket = totalUnits > 0 ? totalRevenue / totalUnits : 0;
    const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

    // Customer retention metrics
    const now30 = new Date(); now30.setDate(now30.getDate() - 30);
    const now60 = new Date(); now60.setDate(now60.getDate() - 60);
    const customersLast30 = new Set(
      sales.filter((s: any) => s.customer_name && new Date(s.date) >= now30).map((s: any) => s.customer_name)
    );
    const customersPrev30 = new Set(
      sales.filter((s: any) => s.customer_name && new Date(s.date) >= now60 && new Date(s.date) < now30).map((s: any) => s.customer_name)
    );
    const returningCustomers = [...customersLast30].filter(c => {
      const firstSale = sales.filter((s: any) => s.customer_name === c).sort((a: any, b: any) => a.date.localeCompare(b.date))[0];
      return firstSale && new Date(firstSale.date) < now30;
    }).length;
    const retentionRate = customersPrev30.size > 0
      ? Math.round(([...customersPrev30].filter(c => customersLast30.has(c)).length / customersPrev30.size) * 100)
      : 0;
    const newCustomersLast30 = [...customersLast30].filter(c => {
      const firstSale = sales.filter((s: any) => s.customer_name === c).sort((a: any, b: any) => a.date.localeCompare(b.date))[0];
      return firstSale && new Date(firstSale.date) >= now30;
    }).length;

    // Funnel: quotes → won → sales
    const yearStart = new Date(new Date().getFullYear() - Number(year), 0, 1);
    const yearQuotes = quotes.filter((q: any) => new Date(q.created_at) >= yearStart);
    const totalQuotes = yearQuotes.length;
    const wonQuotes = yearQuotes.filter((q: any) => q.status === "approved" || q.status === "won").length;
    const conversionRate = totalQuotes > 0 ? Math.round((wonQuotes / totalQuotes) * 100) : 0;
    const totalSalesCount = monthly.reduce((s, m) => s + m.units, 0);
    const quotesValue = yearQuotes.reduce((s: number, q: any) => s + Number(q.total_ars || 0), 0);
    const funnel = [
      { name: "Presupuestos", value: totalQuotes, pct: 100, color: "hsl(200,70%,55%)" },
      { name: "Aprobados", value: wonQuotes, pct: totalQuotes > 0 ? Math.round(wonQuotes / totalQuotes * 100) : 0, color: "hsl(40,70%,50%)" },
      { name: "Ventas totales", value: totalSalesCount, pct: 100, color: "hsl(150,60%,40%)" },
    ];

    // ABC Analysis — product contribution to total revenue
    const productRevMap: Record<string, { name: string; brand?: string; revenue: number; units: number }> = {};
    sales.forEach((s: any) => {
      if (!s.product_name) return;
      const key = s.product_id || s.product_name;
      if (!productRevMap[key]) productRevMap[key] = { name: s.product_name, brand: s.brand || "", revenue: 0, units: 0 };
      productRevMap[key].revenue += Number(s.total_ars || 0);
      productRevMap[key].units += Number(s.quantity || 1);
    });
    const abcList = Object.values(productRevMap).sort((a, b) => b.revenue - a.revenue);
    const totalRev = abcList.reduce((s, p) => s + p.revenue, 0);
    let cumulative = 0;
    const abcProducts = abcList.map(p => {
      cumulative += p.revenue;
      const cumPct = totalRev > 0 ? (cumulative / totalRev) * 100 : 0;
      const revPct = totalRev > 0 ? (p.revenue / totalRev) * 100 : 0;
      const cls = cumPct - revPct < 80 ? "A" : cumPct - revPct < 95 ? "B" : "C";
      return { ...p, revPct, cumPct, cls };
    });

    // Category monthly trend for current year
    const currentYear = new Date().getFullYear() - Number(year);
    const catSet = new Set<string>();
    const catMonthly: Record<string, number[]> = {}; // cat -> [jan..dec]
    sales.forEach((s: any) => {
      const d = new Date(s.date);
      if (d.getFullYear() !== currentYear) return;
      const prod = products.find((p: any) => p.id === s.product_id || p.name === s.product_name);
      const cat = prod?.category || "otros";
      catSet.add(cat);
      if (!catMonthly[cat]) catMonthly[cat] = new Array(12).fill(0);
      catMonthly[cat][d.getMonth()] += Number(s.total_ars || 0);
    });
    const catTrend = MONTHS_ES.map((month, mi) => {
      const row: Record<string, number | string> = { month };
      catSet.forEach(cat => { row[cat] = Math.round(catMonthly[cat]?.[mi] || 0); });
      return row;
    });
    const catKeys = Array.from(catSet).sort();

    // ===== Weekly comparison (current week vs prev week) =====
    const now = new Date();
    const dow = now.getDay(); // 0=Sun
    const startOfThisWeek = new Date(now); startOfThisWeek.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1)); startOfThisWeek.setHours(0,0,0,0);
    const startOfPrevWeek = new Date(startOfThisWeek); startOfPrevWeek.setDate(startOfPrevWeek.getDate() - 7);
    const endOfPrevWeek = new Date(startOfThisWeek); endOfPrevWeek.setMilliseconds(-1);
    const DAY_NAMES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
    const weekThis: { day: string; revenue: number; count: number }[] = DAY_NAMES.map(day => ({ day, revenue: 0, count: 0 }));
    const weekPrev: number[] = Array(7).fill(0);
    sales.forEach((s: any) => {
      const d = new Date(s.date + "T12:00:00");
      if (d >= startOfThisWeek && d <= now) {
        const idx = (d.getDay() + 6) % 7; // Mon=0..Sun=6
        weekThis[idx].revenue += Number(s.total_ars);
        weekThis[idx].count++;
      } else if (d >= startOfPrevWeek && d <= endOfPrevWeek) {
        const idx = (d.getDay() + 6) % 7;
        weekPrev[idx] += Number(s.total_ars);
      }
    });
    const weeklyComparison = weekThis.map((d, i) => ({ day: d.day, actual: Math.round(d.revenue), prevWeek: Math.round(weekPrev[i]), count: d.count }));
    const weekTotalThis = weekThis.reduce((s, d) => s + d.revenue, 0);
    const weekTotalPrev = weekPrev.reduce((s, v) => s + v, 0);

    const rentabilidad = buildRentabilidadData(sales, products);

    return {
      monthly, yoyData, productPerf, customerData, categoryMix,
      heatmap, hourlyBars, dailyBars,
      totalRevenue, totalProfit, totalUnits, revYoY, profYoY,
      uniqueCustomers, avgTicket, avgMargin,
      returningCustomers, retentionRate, newCustomersLast30, customersLast30Size: customersLast30.size,
      funnel, conversionRate, quotesValue, totalQuotes, wonQuotes,
      abcProducts, catTrend, catKeys, weeklyComparison, weekTotalThis, weekTotalPrev,
      rentabilidad,
    };
  }, [rawData, year]);

  const trendDailyData = useMemo(() => {
    if (!rawData) return [];
    const from = new Date(trendFrom + "T00:00:00");
    const to = new Date(trendTo + "T23:59:59");
    const byDay: Record<string, { revenue: number; profit: number; units: number }> = {};
    rawData.sales.filter((s: any) => {
      const d = new Date(s.date);
      return d >= from && d <= to;
    }).forEach((s: any) => {
      const day = s.date.slice(0, 10);
      if (!byDay[day]) byDay[day] = { revenue: 0, profit: 0, units: 0 };
      byDay[day].revenue += Number(s.total_ars || 0);
      byDay[day].profit += Number(s.profit_ars || 0);
      byDay[day].units += Number(s.quantity || 1);
    });
    const result = [];
    const cur = new Date(from);
    while (cur <= to) {
      const key = cur.toISOString().slice(0, 10);
      result.push({ name: key.slice(5), ...( byDay[key] || { revenue: 0, profit: 0, units: 0 }) });
      cur.setDate(cur.getDate() + 1);
    }
    return result;
  }, [rawData, trendFrom, trendTo]);

  if (!derived) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const currentYear = new Date().getFullYear() - Number(year);

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        icon={BarChart3}
        title="Analytics Avanzado"
        description="Métricas profundas, tendencias y comparativas interanuales"
        actions={
          <Select value={year} onValueChange={(v) => setYear(v as "0" | "1")}>
            <SelectTrigger className="w-36 bg-muted border-border text-sm">
              <Calendar className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">{new Date().getFullYear()}</SelectItem>
              <SelectItem value="1">{new Date().getFullYear() - 1}</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Ingresos" value={formatARS(derived.totalRevenue)} trend={derived.revYoY} icon={DollarSign} />
        <KPI label="Ganancia bruta" value={formatARS(derived.totalProfit)} trend={derived.profYoY} icon={TrendingUp} />
        <KPI label="Margen promedio" value={`${derived.avgMargin.toFixed(1)}%`} sub="sobre ingresos" icon={Percent}
          color={derived.avgMargin >= 30 ? "text-green-400" : derived.avgMargin >= 15 ? "text-yellow-400" : "text-red-400"} />
        <KPI label="Clientes únicos" value={String(derived.uniqueCustomers)} sub={`${derived.totalUnits} unidades`} icon={Users} />
      </div>

      <Tabs defaultValue="trend" className="w-full">
        <TabsList className="flex-wrap h-auto gap-1 bg-muted/60 p-1 rounded-xl">
          <TabsTrigger value="trend" className="text-xs">Tendencia</TabsTrigger>
          <TabsTrigger value="forecast" className="text-xs">📈 Forecast</TabsTrigger>
          <TabsTrigger value="demand" className="text-xs">🔮 Demanda</TabsTrigger>
          <TabsTrigger value="yoy" className="text-xs">Año vs Año</TabsTrigger>
          <TabsTrigger value="products" className="text-xs">Productos</TabsTrigger>
          <TabsTrigger value="customers" className="text-xs">Clientes</TabsTrigger>
          <TabsTrigger value="mix" className="text-xs">Mix</TabsTrigger>
          <TabsTrigger value="horarios" className="text-xs">Horarios</TabsTrigger>
          <TabsTrigger value="funnel" className="text-xs">Conversión</TabsTrigger>
          <TabsTrigger value="abc" className="text-xs">ABC</TabsTrigger>
          <TabsTrigger value="cattrend" className="text-xs">Por Categoría</TabsTrigger>
          <TabsTrigger value="weekly" className="text-xs">Semana</TabsTrigger>
          <TabsTrigger value="cohorts" className="text-xs">👥 Cohorts</TabsTrigger>
          <TabsTrigger value="dormant" className="text-xs">⚠️ Sin movimiento</TabsTrigger>
          <TabsTrigger value="rentabilidad" className="text-xs">💰 Rentabilidad</TabsTrigger>
        </TabsList>

        {/* TREND TAB */}
        <TabsContent value="trend" className="mt-4 space-y-4">
          <div className="bg-card border border-border rounded-2xl p-5">
            <h3 className="text-sm font-semibold mb-4">Ingresos & Ganancia — {currentYear}</h3>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={derived.monthly} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={PALETTE[0]} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={PALETTE[0]} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradProf" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={PALETTE[1]} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={PALETTE[1]} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,18%)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(220,15%,55%)" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} tick={{ fontSize: 10, fill: "hsl(220,15%,45%)" }} axisLine={false} tickLine={false} width={45} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => formatARS(v)} />
                <Area type="monotone" dataKey="revenue" name="Ingresos" stroke={PALETTE[0]} fill="url(#gradRev)" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="profit" name="Ganancia" stroke={PALETTE[1]} fill="url(#gradProf)" strokeWidth={2} dot={false} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Custom date range daily chart */}
          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <h3 className="text-sm font-semibold flex-1">Detalle por día — rango personalizado</h3>
              <div className="flex items-center gap-2 text-xs">
                <input type="date" value={trendFrom} max={trendTo} onChange={e => setTrendFrom(e.target.value)}
                  className="bg-muted border border-border rounded-lg px-2 py-1 text-xs text-foreground" />
                <span className="text-muted-foreground">→</span>
                <input type="date" value={trendTo} min={trendFrom} max={new Date().toISOString().slice(0,10)} onChange={e => setTrendTo(e.target.value)}
                  className="bg-muted border border-border rounded-lg px-2 py-1 text-xs text-foreground" />
              </div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trendDailyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradRevDay" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={PALETTE[0]} stopOpacity={0.25} />
                    <stop offset="95%" stopColor={PALETTE[0]} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,18%)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: "hsl(220,15%,55%)" }} axisLine={false} tickLine={false}
                  interval={Math.floor(trendDailyData.length / 7)} />
                <YAxis tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} tick={{ fontSize: 9, fill: "hsl(220,15%,45%)" }} axisLine={false} tickLine={false} width={40} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => formatARS(v)} />
                <Area type="monotone" dataKey="revenue" name="Ingresos" stroke={PALETTE[0]} fill="url(#gradRevDay)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-card border border-border rounded-2xl p-5">
              <h3 className="text-sm font-semibold mb-4">Resultado neto mensual (ganancia − gastos)</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={derived.monthly} barSize={16} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,18%)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(220,15%,55%)" }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} tick={{ fontSize: 9, fill: "hsl(220,15%,45%)" }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip {...tooltipStyle} formatter={(v: number) => formatARS(v)} />
                  <Bar dataKey="net" name="Neto" radius={[4, 4, 0, 0]}>
                    {derived.monthly.map((entry, i) => (
                      <Cell key={i} fill={entry.net >= 0 ? PALETTE[1] : "hsl(0,65%,55%)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-card border border-border rounded-2xl p-5">
              <h3 className="text-sm font-semibold mb-4">Unidades vendidas por mes</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={derived.monthly} barSize={16} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,18%)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(220,15%,55%)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: "hsl(220,15%,45%)" }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="units" name="Unidades" fill={PALETTE[2]} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </TabsContent>

        {/* YoY TAB */}
        <TabsContent value="yoy" className="mt-4">
          <div className="bg-card border border-border rounded-2xl p-5">
            <h3 className="text-sm font-semibold mb-4">
              Ingresos: {currentYear} vs {currentYear - 1}
            </h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={derived.yoyData} barCategoryGap="30%" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,18%)" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(220,15%,55%)" }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} tick={{ fontSize: 10, fill: "hsl(220,15%,45%)" }} axisLine={false} tickLine={false} width={45} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => formatARS(v)} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="actual" name={String(currentYear)} fill={PALETTE[0]} radius={[4, 4, 0, 0]} />
                <Bar dataKey="anterior" name={String(currentYear - 1)} fill="hsl(220,15%,30%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </TabsContent>

        {/* PRODUCTS TAB */}
        <TabsContent value="products" className="mt-4 space-y-4">
          <div className="bg-card border border-border rounded-2xl p-5">
            <h3 className="text-sm font-semibold mb-4">Top 15 productos por ganancia acumulada</h3>
            <ResponsiveContainer width="100%" height={340}>
              <BarChart
                data={derived.productPerf}
                layout="vertical"
                margin={{ top: 0, right: 60, left: 0, bottom: 0 }}
                barSize={12}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,18%)" horizontal={false} />
                <XAxis type="number" tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} tick={{ fontSize: 9, fill: "hsl(220,15%,45%)" }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10, fill: "hsl(220,15%,65%)" }} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle} formatter={(v: number) => formatARS(v)} />
                <Bar dataKey="profit" name="Ganancia" fill={PALETTE[0]} radius={[0, 4, 4, 0]}>
                  {derived.productPerf.map((_: any, i: number) => (
                    <Cell key={i} fill={i < 3 ? PALETTE[0] : i < 8 ? PALETTE[2] : "hsl(220,15%,30%)"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border bg-muted/40">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Detalle de rendimiento</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm table-compact-mobile">
                <thead className="bg-muted/20">
                  <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="text-left px-4 py-2">#</th>
                    <th className="text-left px-4 py-2">Producto</th>
                    <th className="text-right px-4 py-2">Ingresos</th>
                    <th className="text-right px-4 py-2">Ganancia</th>
                    <th className="text-right px-4 py-2">Margen</th>
                    <th className="text-right px-4 py-2">Uds</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {derived.productPerf.map((p: any, i: number) => (
                    <tr key={p.name} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 text-muted-foreground text-xs">{i + 1}</td>
                      <td className="px-4 py-2.5 font-medium max-w-[200px] truncate">{p.name}</td>
                      <td className="px-4 py-2.5 text-right text-xs font-mono">{formatARS(p.revenue)}</td>
                      <td className="px-4 py-2.5 text-right text-xs font-mono text-green-400">{formatARS(p.profit)}</td>
                      <td className={`px-4 py-2.5 text-right text-xs font-mono ${p.margin >= 30 ? "text-green-400" : p.margin >= 15 ? "text-yellow-400" : "text-red-400"}`}>
                        {p.margin.toFixed(1)}%
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs">{p.units}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* CUSTOMERS TAB */}
        <TabsContent value="customers" className="mt-4 space-y-4">
          {/* Retention KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-card border border-border rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-primary">{derived.customersLast30Size}</div>
              <div className="text-xs text-muted-foreground mt-1">Activos últimos 30d</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4 text-center">
              <div className={`text-2xl font-bold ${derived.retentionRate >= 50 ? 'text-success' : derived.retentionRate >= 25 ? 'text-warning' : 'text-destructive'}`}>{derived.retentionRate}%</div>
              <div className="text-xs text-muted-foreground mt-1">Retención 30d</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-blue-400">{derived.returningCustomers}</div>
              <div className="text-xs text-muted-foreground mt-1">Clientes que regresaron</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4 text-center">
              <div className="text-2xl font-bold text-success">{derived.newCustomersLast30}</div>
              <div className="text-xs text-muted-foreground mt-1">Nuevos últimos 30d</div>
            </div>
          </div>
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border bg-muted/40 flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold flex-1">Top clientes por gasto total</h3>
              <span className="text-xs text-muted-foreground">{derived.uniqueCustomers} únicos</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm table-compact-mobile">
                <thead className="bg-muted/20">
                  <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="text-left px-4 py-2">#</th>
                    <th className="text-left px-4 py-2">Cliente</th>
                    <th className="text-right px-4 py-2">Gasto total</th>
                    <th className="text-right px-4 py-2">Órdenes</th>
                    <th className="text-right px-4 py-2">Ticket prom.</th>
                    <th className="text-left px-4 py-2">Última compra</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {derived.customerData.map((c: any, i: number) => {
                    const daysSince = Math.round((Date.now() - c.last.getTime()) / 86400000);
                    const isChurning = daysSince > 60;
                    return (
                      <tr key={c.name} className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-2.5 text-muted-foreground text-xs">{i + 1}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                              {c.name.slice(0, 1).toUpperCase()}
                            </div>
                            <span className="font-medium truncate max-w-[140px]">{c.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right text-xs font-mono font-semibold">{formatARS(c.total)}</td>
                        <td className="px-4 py-2.5 text-right text-xs">{c.orders}</td>
                        <td className="px-4 py-2.5 text-right text-xs font-mono">{formatARS(c.total / c.orders)}</td>
                        <td className="px-4 py-2.5 text-xs">
                          <span className={isChurning ? "text-red-400" : "text-muted-foreground"}>
                            {c.last.toLocaleDateString("es-AR")}
                            {isChurning ? " ⚠" : ""}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* MIX TAB */}
        <TabsContent value="mix" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-card border border-border rounded-2xl p-5">
              <h3 className="text-sm font-semibold mb-4">Mix de ganancia por categoría</h3>
              {derived.categoryMix.length === 0 ? (
                <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">Sin datos</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={derived.categoryMix} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                      {derived.categoryMix.map((_: any, i: number) => (
                        <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                      ))}
                    </Pie>
                    <Tooltip {...tooltipStyle} formatter={(v: number) => formatARS(v)} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="bg-card border border-border rounded-2xl p-5">
              <h3 className="text-sm font-semibold mb-4">Detalle de categorías</h3>
              <div className="space-y-3">
                {derived.categoryMix.map((cat: any, i: number) => {
                  const total = derived.categoryMix.reduce((s: number, c: any) => s + c.value, 0);
                  const pct = total > 0 ? (cat.value / total) * 100 : 0;
                  return (
                    <div key={cat.name}>
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm capitalize">{cat.name.replace(/_/g, " ")}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{formatARS(cat.value)}</span>
                          <span className="text-xs font-mono font-semibold" style={{ color: PALETTE[i % PALETTE.length] }}>
                            {pct.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, background: PALETTE[i % PALETTE.length] }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </TabsContent>
        {/* HORARIOS TAB */}
        <TabsContent value="horarios" className="mt-4 space-y-4">
          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">Ventas por hora del día</h3>
              <span className="text-xs text-muted-foreground ml-auto">Cantidad de transacciones</span>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={derived.hourlyBars} barSize={10} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,18%)" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 9, fill: "hsl(220,15%,45%)" }} axisLine={false} tickLine={false} interval={2} />
                <YAxis tick={{ fontSize: 9, fill: "hsl(220,15%,45%)" }} axisLine={false} tickLine={false} width={24} />
                <Tooltip {...tooltipStyle} formatter={(v: number, name: string) => [v, name === "count" ? "Ventas" : formatARS(v)]} />
                <Bar dataKey="count" name="Ventas" radius={[3, 3, 0, 0]}>
                  {derived.hourlyBars.map((h: any, i: number) => {
                    const maxCount = Math.max(...derived.hourlyBars.map((x: any) => x.count), 1);
                    const intensity = h.count / maxCount;
                    return (
                      <Cell key={i} fill={`hsl(40,70%,${30 + intensity * 30}%)`} opacity={0.4 + intensity * 0.6} />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Calendar className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-semibold">Ventas por día de la semana</h3>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={derived.dailyBars} barSize={20} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,18%)" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "hsl(220,15%,55%)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: "hsl(220,15%,45%)" }} axisLine={false} tickLine={false} width={24} />
                  <Tooltip {...tooltipStyle} formatter={(v: number) => [v, "Ventas"]} />
                  <Bar dataKey="count" name="Ventas" radius={[4, 4, 0, 0]}>
                    {derived.dailyBars.map((d: any, i: number) => {
                      const maxCount = Math.max(...derived.dailyBars.map((x: any) => x.count), 1);
                      const intensity = d.count / maxCount;
                      return <Cell key={i} fill={`hsl(200,70%,${35 + intensity * 25}%)`} opacity={0.5 + intensity * 0.5} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-card border border-border rounded-2xl p-5">
              <h3 className="text-sm font-semibold mb-3">Pico de actividad</h3>
              {(() => {
                const topHour = derived.hourlyBars.reduce((a: any, b: any) => b.count > a.count ? b : a, derived.hourlyBars[0]);
                const topDay = derived.dailyBars.reduce((a: any, b: any) => b.count > a.count ? b : a, derived.dailyBars[0]);
                const quietHour = derived.hourlyBars.reduce((a: any, b: any) => b.count < a.count ? b : a, derived.hourlyBars[0]);
                const totalWithTime = derived.hourlyBars.reduce((s: number, h: any) => s + h.count, 0);
                return (
                  <div className="space-y-3">
                    <div className="flex justify-between items-center p-3 rounded-xl bg-primary/10 border border-primary/20">
                      <div>
                        <div className="text-xs text-muted-foreground">Hora pico</div>
                        <div className="text-lg font-bold">{topHour?.label}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">ventas</div>
                        <div className="text-lg font-bold text-primary">{topHour?.count}</div>
                      </div>
                    </div>
                    <div className="flex justify-between items-center p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
                      <div>
                        <div className="text-xs text-muted-foreground">Día más activo</div>
                        <div className="text-lg font-bold">{topDay?.name}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">ventas</div>
                        <div className="text-lg font-bold text-blue-400">{topDay?.count}</div>
                      </div>
                    </div>
                    <div className="flex justify-between items-center p-3 rounded-xl bg-muted/40">
                      <div>
                        <div className="text-xs text-muted-foreground">Registros con horario</div>
                        <div className="text-sm font-semibold">{totalWithTime} ventas</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">Hora silenciosa</div>
                        <div className="text-sm font-semibold text-muted-foreground">{quietHour?.label}</div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </TabsContent>
        {/* FORECAST TAB */}
        <TabsContent value="forecast" className="mt-4 space-y-4">
          <ForecastTab monthly={derived.monthly} currentYear={currentYear} />
        </TabsContent>

        {/* DEMAND FORECAST TAB */}
        <TabsContent value="demand" className="mt-4 space-y-4">
          <ProductDemandTab products={rawData.products} sales={rawData.sales} />
        </TabsContent>

        {/* FUNNEL TAB */}
        <TabsContent value="funnel" className="mt-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-card border border-border rounded-2xl p-4 text-center">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Presupuestos</div>
              <div className="text-3xl font-bold">{derived.totalQuotes}</div>
              <div className="text-xs text-muted-foreground mt-1">este año</div>
            </div>
            <div className="bg-card border border-border rounded-2xl p-4 text-center">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Conversión</div>
              <div className={`text-3xl font-bold ${derived.conversionRate >= 50 ? "text-green-400" : derived.conversionRate >= 25 ? "text-yellow-400" : "text-red-400"}`}>
                {derived.conversionRate}%
              </div>
              <div className="text-xs text-muted-foreground mt-1">{derived.wonQuotes} aprobados</div>
            </div>
            <div className="bg-card border border-border rounded-2xl p-4 text-center">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Valor total</div>
              <div className="text-2xl font-bold">{formatARS(derived.quotesValue)}</div>
              <div className="text-xs text-muted-foreground mt-1">presupuestado</div>
            </div>
          </div>

          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-6">
              <Filter className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold">Embudo de conversión — {currentYear}</h3>
            </div>
            <div className="space-y-3">
              {derived.funnel.map((stage: any, i: number) => (
                <div key={stage.name}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ background: stage.color }} />
                      <span className="text-sm font-medium">{stage.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">{stage.value} unidades</span>
                      {i > 0 && (
                        <span className="text-xs font-mono font-semibold" style={{ color: stage.color }}>
                          {stage.pct}%
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="h-8 bg-muted/40 rounded-lg overflow-hidden">
                    <div
                      className="h-full rounded-lg transition-all duration-700 flex items-center justify-end pr-3"
                      style={{
                        width: `${Math.max(stage.pct, 2)}%`,
                        background: stage.color,
                        opacity: 0.8,
                      }}
                    >
                      {stage.value > 0 && (
                        <span className="text-xs font-bold text-white">{stage.value}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {derived.totalQuotes === 0 && (
              <p className="text-center text-sm text-muted-foreground mt-4">
                Aún no hay presupuestos registrados. Creá presupuestos en la sección <strong>Presupuestos</strong> para ver tu tasa de conversión.
              </p>
            )}
          </div>

          <div className="bg-card border border-border rounded-2xl p-5">
            <h3 className="text-sm font-semibold mb-3">Cómo mejorar la conversión</h3>
            <div className="space-y-2">
              {[
                { tip: "Seguí tus presupuestos a los 48hs de enviarlos — el 60% de las conversiones ocurren en las primeras 72hs", ok: derived.conversionRate >= 40 },
                { tip: "Incluí un link de pago en cada presupuesto para facilitar el cierre", ok: derived.conversionRate >= 50 },
                { tip: `Tenés ${derived.totalQuotes - derived.wonQuotes} presupuesto(s) sin convertir — considerá hacer seguimiento`, ok: derived.totalQuotes - derived.wonQuotes === 0 },
              ].map((item, i) => (
                <div key={i} className={`flex items-start gap-2 p-3 rounded-lg text-sm ${item.ok ? "bg-green-500/10 text-green-300" : "bg-muted/40 text-muted-foreground"}`}>
                  <span className="mt-0.5">{item.ok ? "✓" : "→"}</span>
                  <span>{item.tip}</span>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* ABC Analysis */}
        <TabsContent value="abc" className="mt-4 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            {(["A", "B", "C"] as const).map(cls => {
              const items = derived.abcProducts.filter((p: any) => p.cls === cls);
              const rev = items.reduce((s: number, p: any) => s + p.revenue, 0);
              const colors: Record<string, string> = { A: "border-success/30 bg-success/5 text-success", B: "border-warning/30 bg-warning/5 text-warning", C: "border-muted border-border bg-muted/10 text-muted-foreground" };
              const descriptions: Record<string, string> = { A: "Alta rotación → mantener stock", B: "Rotación media → optimizar", C: "Baja rotación → revisar o eliminar" };
              return (
                <div key={cls} className={`rounded-xl border p-4 ${colors[cls]}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-2xl font-black font-display">{cls}</span>
                    <span className="text-xs opacity-60">{items.length} productos</span>
                  </div>
                  <p className="text-lg font-bold">{formatARS(rev)}</p>
                  <p className="text-[10px] opacity-70 mt-1">{descriptions[cls]}</p>
                </div>
              );
            })}
          </div>

          {derived.abcProducts.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-20" />
              <p>Sin datos de ventas para analizar</p>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <h3 className="text-sm font-semibold">Clasificación ABC por ingreso</h3>
                <p className="text-xs text-muted-foreground mt-0.5">A=80% del ingreso · B=siguiente 15% · C=último 5%</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground text-xs">
                      <th className="text-left p-3">Clase</th>
                      <th className="text-left p-3">Producto</th>
                      <th className="text-right p-3">Ingreso</th>
                      <th className="text-right p-3">% del total</th>
                      <th className="text-right p-3">% acumulado</th>
                      <th className="text-right p-3">Unidades</th>
                    </tr>
                  </thead>
                  <tbody>
                    {derived.abcProducts.slice(0, 50).map((p: any, i: number) => (
                      <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/20">
                        <td className="p-3">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                            p.cls === "A" ? "bg-success/15 text-success" :
                            p.cls === "B" ? "bg-warning/15 text-warning" :
                            "bg-muted text-muted-foreground"
                          }`}>{p.cls}</span>
                        </td>
                        <td className="p-3">
                          <p className="font-medium truncate max-w-[200px]">{p.name}</p>
                        </td>
                        <td className="p-3 text-right font-mono text-xs">{formatARS(p.revenue)}</td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-muted/40 rounded-full overflow-hidden">
                              <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(p.revPct, 100)}%` }} />
                            </div>
                            <span className="text-xs text-muted-foreground w-10 text-right">{p.revPct.toFixed(1)}%</span>
                          </div>
                        </td>
                        <td className="p-3 text-right text-xs text-muted-foreground">{p.cumPct.toFixed(1)}%</td>
                        <td className="p-3 text-right text-xs">{p.units}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="bg-muted/20 border border-border rounded-xl p-4 space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">¿Cómo usar el análisis ABC?</h4>
            {[
              { cls: "A", tip: "Productos clase A: asegurate de tener siempre stock. Negociá volumen con tus proveedores." },
              { cls: "B", tip: "Productos clase B: monitoreá la rotación. Pueden subir a A con mejor posicionamiento o bajar a C." },
              { cls: "C", tip: "Productos clase C: evaluá si vale la pena mantenerlos. Considerá liquidar stock o descontinuar." },
            ].map(item => (
              <div key={item.cls} className="flex items-start gap-2 text-xs text-muted-foreground">
                <span className={`shrink-0 font-bold px-1.5 py-0.5 rounded text-[10px] ${
                  item.cls === "A" ? "bg-success/15 text-success" :
                  item.cls === "B" ? "bg-warning/15 text-warning" :
                  "bg-muted text-muted-foreground"
                }`}>{item.cls}</span>
                <span>{item.tip}</span>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* CATEGORY TREND TAB */}
        <TabsContent value="cattrend" className="mt-4 space-y-4">
          {derived.catKeys.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-12">Sin ventas en el período seleccionado.</p>
          ) : (
            <>
              <div className="bg-card border border-border rounded-2xl p-5">
                <h3 className="text-sm font-semibold mb-4">Ingresos por categoría — mes a mes</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={derived.catTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,18%)" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(220,10%,55%)" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "hsl(220,10%,55%)" }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={48} />
                    <Tooltip formatter={(v: number, name: string) => [formatARS(v), name]} contentStyle={{ background: "hsl(220,18%,12%)", border: "1px solid hsl(220,15%,18%)", borderRadius: 8, fontSize: 12 }} />
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                    {derived.catKeys.map((cat: string, i: number) => (
                      <Bar key={cat} dataKey={cat} stackId="a" fill={PALETTE[i % PALETTE.length]} radius={i === derived.catKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Summary table */}
              <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Categoría</th>
                      {MONTHS_ES.map(m => (
                        <th key={m} className="text-right px-2 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">{m}</th>
                      ))}
                      <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total año</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {derived.catKeys.map((cat: string, i: number) => {
                      const yearTotal = derived.catTrend.reduce((s: number, row: any) => s + (row[cat] || 0), 0);
                      return (
                        <tr key={cat} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                              <span className="font-medium text-sm capitalize">{cat.replace(/_/g, ' ')}</span>
                            </div>
                          </td>
                          {derived.catTrend.map((row: any) => (
                            <td key={row.month} className="px-2 py-2.5 text-right text-xs text-muted-foreground hidden lg:table-cell">
                              {row[cat] > 0 ? `$${(row[cat] / 1000).toFixed(0)}k` : '—'}
                            </td>
                          ))}
                          <td className="px-4 py-2.5 text-right font-bold text-sm">{formatARS(yearTotal)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </TabsContent>

        {/* WEEKLY COMPARISON TAB */}
        <TabsContent value="weekly" className="mt-4 space-y-4">
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: "Esta semana", value: formatARS(derived.weekTotalThis), color: "text-primary" },
              { label: "Semana anterior", value: formatARS(derived.weekTotalPrev), color: "text-muted-foreground" },
              {
                label: "Diferencia",
                value: derived.weekTotalPrev > 0 ? `${derived.weekTotalThis > derived.weekTotalPrev ? '+' : ''}${(((derived.weekTotalThis - derived.weekTotalPrev) / derived.weekTotalPrev) * 100).toFixed(1)}%` : '—',
                color: derived.weekTotalThis >= derived.weekTotalPrev ? 'text-success' : 'text-destructive',
              },
            ].map(k => (
              <div key={k.label} className="bg-card border border-border rounded-xl p-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{k.label}</p>
                <p className={`text-lg font-bold font-display ${k.color}`}>{k.value}</p>
              </div>
            ))}
          </div>

          <div className="bg-card border border-border rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">Ventas por día — semana actual vs anterior</h3>
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-primary inline-block" />Esta semana</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-muted-foreground/40 inline-block" />Semana ant.</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={derived.weeklyComparison} barGap={2} barCategoryGap="25%">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,18%)" vertical={false} />
                <XAxis dataKey="day" tick={{ fill: "hsl(220,10%,55%)", fontSize: 12 }} />
                <YAxis tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} tick={{ fill: "hsl(220,10%,55%)", fontSize: 10 }} width={55} />
                <Tooltip
                  contentStyle={{ background: "hsl(220,14%,12%)", border: "1px solid hsl(220,14%,20%)", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number, name: string) => [formatARS(v), name === "actual" ? "Esta semana" : "Semana anterior"]}
                />
                <Bar dataKey="prevWeek" name="prevWeek" fill="hsl(220,10%,40%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="actual" name="actual" fill="hsl(43,86%,55%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Day-by-day table */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-2.5 text-xs text-muted-foreground uppercase">Día</th>
                  <th className="text-right px-4 py-2.5 text-xs text-muted-foreground uppercase">Esta semana</th>
                  <th className="text-right px-4 py-2.5 text-xs text-muted-foreground uppercase">Semana ant.</th>
                  <th className="text-right px-4 py-2.5 text-xs text-muted-foreground uppercase">Diferencia</th>
                  <th className="text-right px-4 py-2.5 text-xs text-muted-foreground uppercase">Ventas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {derived.weeklyComparison.map((d: any, i: number) => {
                  const diff = d.actual - d.prevWeek;
                  const diffPct = d.prevWeek > 0 ? (diff / d.prevWeek) * 100 : null;
                  return (
                    <tr key={d.day} className={i % 2 === 0 ? '' : 'bg-muted/10'}>
                      <td className="px-4 py-2.5 font-medium">{d.day}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs font-bold text-primary">{d.actual > 0 ? formatARS(d.actual) : '—'}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">{d.prevWeek > 0 ? formatARS(d.prevWeek) : '—'}</td>
                      <td className={`px-4 py-2.5 text-right text-xs font-bold ${diff > 0 ? 'text-success' : diff < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {diffPct !== null ? `${diff > 0 ? '+' : ''}${diffPct.toFixed(0)}%` : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{d.count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* COHORTS TAB */}
        <TabsContent value="cohorts" className="mt-4">
          <CohortTab sales={rawData?.sales || []} />
        </TabsContent>

        {/* DORMANT PRODUCTS TAB */}
        <TabsContent value="dormant" className="mt-4">
          <DormantProductsTab products={rawData?.products || []} sales={rawData?.sales || []} />
        </TabsContent>

        {/* RENTABILIDAD TAB */}
        <TabsContent value="rentabilidad" className="mt-4 space-y-4">
          {derived.rentabilidad.totalProducts === 0 ? (
            <div className="bg-card border border-border rounded-2xl p-8 text-center text-muted-foreground text-sm">
              Sin datos de ventas para calcular rentabilidad.
            </div>
          ) : (
            <>
              {/* Top 5 / Bottom 5 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Top 5 por margen */}
                <div className="bg-card border border-border rounded-2xl p-5">
                  <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                    <span className="text-green-400">▲</span> Top 5 — Mayor margen bruto
                  </h3>
                  <div className="space-y-3">
                    {derived.rentabilidad.top5.map((p, i) => (
                      <div key={p.name} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-green-500/20 text-green-400 text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                            <span className="font-medium truncate max-w-[140px]" title={p.name}>{p.name}</span>
                          </span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-muted-foreground">{formatARS(p.profit)}</span>
                            <span className="font-bold text-green-400 w-12 text-right">{p.margin.toFixed(1)}%</span>
                          </div>
                        </div>
                        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-green-400 rounded-full" style={{ width: `${Math.min(100, p.margin)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Bottom 5 por margen */}
                <div className="bg-card border border-border rounded-2xl p-5">
                  <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                    <span className="text-red-400">▼</span> Bottom 5 — Menor margen bruto
                  </h3>
                  <div className="space-y-3">
                    {derived.rentabilidad.bottom5.map((p, i) => (
                      <div key={p.name} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-red-500/20 text-red-400 text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                            <span className="font-medium truncate max-w-[140px]" title={p.name}>{p.name}</span>
                          </span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-muted-foreground">{formatARS(p.profit)}</span>
                            <span className={`font-bold w-12 text-right ${p.margin < 10 ? 'text-red-400' : p.margin < 20 ? 'text-yellow-400' : 'text-muted-foreground'}`}>{p.margin.toFixed(1)}%</span>
                          </div>
                        </div>
                        <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${p.margin < 10 ? 'bg-red-400' : p.margin < 20 ? 'bg-yellow-400' : 'bg-muted-foreground'}`} style={{ width: `${Math.min(100, Math.max(2, p.margin))}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Category margin breakdown */}
              <div className="bg-card border border-border rounded-2xl p-5">
                <h3 className="text-sm font-semibold mb-4">Margen por categoría</h3>
                <div className="space-y-3">
                  {derived.rentabilidad.byCategory.map((c, i) => (
                    <div key={c.cat} className="grid grid-cols-[1fr_80px_80px_72px] items-center gap-3 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                        <span className="capitalize truncate font-medium">{c.cat}</span>
                      </div>
                      <span className="text-right text-muted-foreground">{formatARS(c.revenue)}</span>
                      <span className="text-right text-success">{formatARS(c.profit)}</span>
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.min(100, c.margin)}%`, background: PALETTE[i % PALETTE.length] }} />
                        </div>
                        <span className={`w-8 text-right font-bold ${c.margin >= 30 ? 'text-green-400' : c.margin >= 15 ? 'text-yellow-400' : 'text-red-400'}`}>{c.margin.toFixed(0)}%</span>
                      </div>
                    </div>
                  ))}
                  <div className="pt-2 border-t border-border grid grid-cols-[1fr_80px_80px_72px] gap-3 text-xs font-semibold">
                    <span>Total</span>
                    <span className="text-right">{formatARS(derived.rentabilidad.byCategory.reduce((s, c) => s + c.revenue, 0))}</span>
                    <span className="text-right text-success">{formatARS(derived.rentabilidad.byCategory.reduce((s, c) => s + c.profit, 0))}</span>
                    <span className="text-right text-primary">
                      {(() => {
                        const rev = derived.rentabilidad.byCategory.reduce((s, c) => s + c.revenue, 0);
                        const prof = derived.rentabilidad.byCategory.reduce((s, c) => s + c.profit, 0);
                        return rev > 0 ? `${((prof / rev) * 100).toFixed(1)}%` : '—';
                      })()}
                    </span>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground mt-3">Ingresos · Ganancia bruta · Margen % — basado en todas las ventas del año seleccionado</p>
              </div>

              {/* Margin distribution chart */}
              <div className="bg-card border border-border rounded-2xl p-5">
                <h3 className="text-sm font-semibold mb-4">Distribución de margen por producto (Top 15)</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={[...derived.rentabilidad.top5, ...derived.rentabilidad.bottom5.filter(p => !derived.rentabilidad.top5.find(t => t.name === p.name))].slice(0, 15).sort((a, b) => b.margin - a.margin)} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,18%)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(220,15%,55%)" }} angle={-35} textAnchor="end" interval={0} />
                    <YAxis tickFormatter={(v: number) => `${v.toFixed(0)}%`} tick={{ fontSize: 10, fill: "hsl(220,15%,45%)" }} width={38} />
                    <Tooltip {...tooltipStyle} formatter={(v: number) => [`${v.toFixed(1)}%`, "Margen"]} />
                    <Bar dataKey="margin" name="Margen %" radius={[4, 4, 0, 0]}>
                      {[...derived.rentabilidad.top5, ...derived.rentabilidad.bottom5.filter(p => !derived.rentabilidad.top5.find(t => t.name === p.name))].slice(0, 15).sort((a, b) => b.margin - a.margin).map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.margin >= 30 ? "hsl(150,60%,40%)" : entry.margin >= 15 ? "hsl(40,70%,50%)" : "hsl(0,65%,55%)"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex items-center gap-4 mt-1 justify-center text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-500 inline-block" />≥30%</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-yellow-500 inline-block" />15–30%</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500 inline-block" />&lt;15%</span>
                </div>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ForecastTab — Actual vs Projected sales with linear trend
// ─────────────────────────────────────────────────────────────────────────────

const MONTHS_SHORT = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

function linearRegression(points: { x: number; y: number }[]): (x: number) => number {
  const n = points.length;
  if (n < 2) return () => 0;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
  const m = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const b = (sumY - m * sumX) / n;
  return (x: number) => Math.max(0, m * x + b);
}

function ForecastTab({ monthly, currentYear }: { monthly: any[]; currentYear: number }) {
  const currentMonth = new Date().getMonth(); // 0-indexed

  // Build historical data points from actual months (up to current)
  const historicalPoints = monthly
    .map((m, i) => ({ x: i, y: m.revenue }))
    .filter(p => p.x <= currentMonth);

  const predict = linearRegression(historicalPoints);

  // Build chart data: all 12 months, with actual and projected
  const chartData = MONTHS_SHORT.map((name, i) => {
    const actual = i <= currentMonth ? Math.round(monthly[i].revenue) : null;
    const trend = Math.round(predict(i));
    // Projected = trend for future months, null for past (already actual)
    const projected = i > currentMonth ? trend : null;
    return { name, actual, projected, trend };
  });

  // Future months for projection table
  const futureMonths = MONTHS_SHORT.slice(currentMonth + 1).map((name, j) => {
    const idx = currentMonth + 1 + j;
    return { name, month: idx, projected: Math.round(predict(idx)) };
  });

  // Stats
  const pastRevenue = historicalPoints.reduce((s, p) => s + p.y, 0);
  const avgMonthly = historicalPoints.length > 0 ? pastRevenue / historicalPoints.length : 0;
  const nextMonthProjected = predict(currentMonth + 1);
  const trendPct = avgMonthly > 0 ? ((nextMonthProjected - avgMonthly) / avgMonthly) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <div className="flex items-start gap-3 bg-primary/5 border border-primary/20 rounded-xl p-4">
        <Brain className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-medium">Forecast basado en regresión lineal</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Proyecta los meses restantes del año usando la tendencia de tus ventas reales.
            Los meses futuros muestran la proyección estadística — no incluyen factores externos.
          </p>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Ventas acumuladas {currentYear}</p>
          <p className="text-lg font-bold text-primary">{formatARS(pastRevenue)}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Promedio mensual</p>
          <p className="text-lg font-bold">{formatARS(avgMonthly)}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Próximo mes proyectado</p>
          <p className="text-lg font-bold text-success">{formatARS(nextMonthProjected)}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 text-center">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Tendencia vs promedio</p>
          <p className={`text-lg font-bold flex items-center justify-center gap-1 ${trendPct >= 0 ? "text-success" : "text-destructive"}`}>
            {trendPct >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
            {trendPct >= 0 ? "+" : ""}{trendPct.toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Chart: Actual vs Projected */}
      <div className="bg-card border border-border rounded-xl p-4 md:p-5">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          Ventas reales vs proyección {currentYear}
        </h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} barGap={4} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(220,15%,18%)" />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(215,20%,55%)" }} />
            <YAxis tick={{ fontSize: 10, fill: "hsl(215,20%,55%)" }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
            <Tooltip
              contentStyle={{ background: "hsl(222,15%,12%)", border: "1px solid hsl(220,15%,22%)", borderRadius: 8 }}
              formatter={(value: any, name: string) => [
                `$${Number(value).toLocaleString("es-AR")}`,
                name === "actual" ? "Real" : "Proyectado",
              ]}
            />
            <Legend formatter={(v) => v === "actual" ? "Real" : "Proyectado"} />
            <Bar dataKey="actual" fill="hsl(40,70%,50%)" radius={[4,4,0,0]} name="actual" />
            <Bar dataKey="projected" fill="hsl(200,60%,50%)" radius={[4,4,0,0]} name="projected" opacity={0.7} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Projection table */}
      {futureMonths.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="text-sm font-semibold mb-3">Proyección mensual restante</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {futureMonths.map(m => (
              <div key={m.month} className="bg-muted/30 border border-border rounded-lg p-3 text-center">
                <p className="text-xs text-muted-foreground mb-1">{m.name} {currentYear}</p>
                <p className="text-sm font-bold text-blue-400">{formatARS(m.projected)}</p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5">proyectado</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-3">
            * Proyección estadística — la tendencia real puede variar por estacionalidad, cambios de precios u otros factores.
          </p>
        </div>
      )}
    </div>
  );
}

function ProductDemandTab({ products, sales }: { products: any[]; sales: any[] }) {
  const demandData = useMemo(() => {
    const since60 = new Date(Date.now() - 60 * 86400000);
    const vel: Record<string, number> = {};
    sales.filter(s => new Date(s.date) >= since60).forEach(s => {
      if (s.product_id) vel[s.product_id] = (vel[s.product_id] || 0) + Number(s.quantity || 1);
    });

    return products
      .filter(p => p.stock >= 0)
      .map(p => {
        const units60 = vel[p.id] || 0;
        const unitsPerDay = units60 / 60;
        const demand30 = Math.round(unitsPerDay * 30);
        const daysOfStock = unitsPerDay > 0 ? Math.floor(p.stock / unitsPerDay) : Infinity;
        const gap = demand30 - p.stock;
        const urgency: "critical" | "warning" | "ok" =
          daysOfStock <= 7 && unitsPerDay > 0 ? "critical" :
          daysOfStock <= 21 && unitsPerDay > 0 ? "warning" : "ok";
        return { id: p.id, name: p.name, brand: p.brand, stock: p.stock, units60, unitsPerDay, demand30, daysOfStock, gap, urgency };
      })
      .filter(p => p.units60 > 0)
      .sort((a, b) => (a.daysOfStock === Infinity ? 1 : 0) - (b.daysOfStock === Infinity ? 1 : 0) || a.daysOfStock - b.daysOfStock);
  }, [products, sales]);

  const critical = demandData.filter(p => p.urgency === "critical");
  const warning = demandData.filter(p => p.urgency === "warning");

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 bg-primary/5 border border-primary/20 rounded-xl p-4">
        <Package className="w-5 h-5 text-primary shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-medium">Proyección de demanda por producto — próximos 30 días</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Basado en la velocidad de ventas de los últimos 60 días. Solo se muestran productos con ventas registradas.
          </p>
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2">
        {critical.length > 0 && (
          <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-destructive/15 text-destructive border border-destructive/20">
            🔴 {critical.length} crítico{critical.length !== 1 ? "s" : ""} (≤7 días de stock)
          </span>
        )}
        {warning.length > 0 && (
          <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-orange-500/15 text-orange-400 border border-orange-500/20">
            🟡 {warning.length} en riesgo (≤21 días)
          </span>
        )}
        {demandData.filter(p => p.urgency === "ok").length > 0 && (
          <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-green-500/15 text-green-400 border border-green-500/20">
            🟢 {demandData.filter(p => p.urgency === "ok").length} con stock suficiente
          </span>
        )}
      </div>

      {demandData.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p>No hay ventas registradas en los últimos 60 días con producto asignado.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-[11px]">
                <th className="text-left p-3 font-medium">Producto</th>
                <th className="text-right p-3 font-medium">Stock actual</th>
                <th className="text-right p-3 font-medium">Uds./día</th>
                <th className="text-right p-3 font-medium">Demanda 30d</th>
                <th className="text-right p-3 font-medium">Días de stock</th>
                <th className="text-right p-3 font-medium">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {demandData.map(p => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                  <td className="p-3">
                    <p className="font-medium truncate max-w-[200px]">{p.name}</p>
                    {p.brand && <p className="text-[10px] text-muted-foreground">{p.brand}</p>}
                  </td>
                  <td className="p-3 text-right font-mono">{p.stock}</td>
                  <td className="p-3 text-right font-mono text-muted-foreground">{p.unitsPerDay.toFixed(2)}</td>
                  <td className="p-3 text-right font-mono font-semibold">{p.demand30}</td>
                  <td className="p-3 text-right">
                    <span className={`font-bold text-xs ${
                      p.urgency === "critical" ? "text-destructive" :
                      p.urgency === "warning" ? "text-orange-400" : "text-green-400"
                    }`}>
                      {p.daysOfStock === Infinity ? "∞" : `${p.daysOfStock}d`}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <span className={`text-xs font-semibold ${p.gap > 0 ? "text-destructive" : "text-green-400"}`}>
                      {p.gap > 0 ? `−${p.gap} faltan` : `+${Math.abs(p.gap)} extra`}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── CohortTab — Retención de clientes por mes de primera compra ──────────────

function CohortTab({ sales }: { sales: any[] }) {
  const cohortData = useMemo(() => {
    if (!sales.length) return [];

    const firstPurchase: Record<string, string> = {};
    for (const s of sales) {
      const name = s.customer_name || 'Sin nombre';
      if (!firstPurchase[name] || s.date < firstPurchase[name]) firstPurchase[name] = s.date;
    }

    const cohortCustomers: Record<string, Set<string>> = {};
    for (const [name, date] of Object.entries(firstPurchase)) {
      const cohort = date.slice(0, 7);
      if (!cohortCustomers[cohort]) cohortCustomers[cohort] = new Set();
      cohortCustomers[cohort].add(name);
    }

    const cohortRetention: Record<string, Record<number, Set<string>>> = {};
    for (const s of sales) {
      const name = s.customer_name || 'Sin nombre';
      const firstDate = firstPurchase[name];
      if (!firstDate) continue;
      const cohort = firstDate.slice(0, 7);
      const [cy, cm] = cohort.split('-').map(Number);
      const [sy, sm] = s.date.slice(0, 7).split('-').map(Number);
      const offset = (sy - cy) * 12 + (sm - cm);
      if (offset < 0 || offset > 11) continue;
      if (!cohortRetention[cohort]) cohortRetention[cohort] = {};
      if (!cohortRetention[cohort][offset]) cohortRetention[cohort][offset] = new Set();
      cohortRetention[cohort][offset].add(name);
    }

    const MAX_OFFSET = 6;
    return Object.keys(cohortCustomers)
      .sort((a, b) => b.localeCompare(a)).slice(0, 12)
      .map(cohort => {
        const total = cohortCustomers[cohort].size;
        const [y, m] = cohort.split('-');
        const label = `${MONTHS_ES[parseInt(m) - 1]} ${y.slice(2)}`;
        const retention = Array.from({ length: MAX_OFFSET + 1 }, (_, i) => {
          const returned = cohortRetention[cohort]?.[i]?.size || 0;
          return { offset: i, count: returned, pct: total > 0 ? Math.round((returned / total) * 100) : 0 };
        });
        return { cohort, label, total, retention };
      });
  }, [sales]);

  if (!cohortData.length) return <p className="text-center text-sm text-muted-foreground py-16">Sin suficientes datos.</p>;

  const getColor = (pct: number) => {
    if (pct === 0) return 'bg-muted/20 text-muted-foreground/40';
    if (pct >= 60) return 'bg-green-500/80 text-white';
    if (pct >= 40) return 'bg-green-500/50 text-white';
    if (pct >= 20) return 'bg-yellow-500/50 text-white';
    if (pct >= 10) return 'bg-orange-500/40 text-white';
    return 'bg-red-500/30 text-white';
  };

  return (
    <div className="space-y-5">
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="text-sm font-semibold mb-1">Retención por cohorte mensual</h3>
        <p className="text-xs text-muted-foreground mb-4">% de clientes de cada cohorte que volvieron a comprar en los meses siguientes. Mes 0 = mes de primera compra.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Cohorte</th>
                <th className="text-center px-2 py-2 font-medium text-muted-foreground">Clientes</th>
                {Array.from({ length: 7 }, (_, i) => (
                  <th key={i} className="text-center px-2 py-2 font-medium text-muted-foreground">{i === 0 ? 'Mes 0' : `+${i}m`}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {cohortData.map(row => (
                <tr key={row.cohort} className="hover:bg-muted/10">
                  <td className="px-3 py-2 font-medium">{row.label}</td>
                  <td className="px-2 py-2 text-center text-muted-foreground">{row.total}</td>
                  {row.retention.map(cell => (
                    <td key={cell.offset} className="px-1 py-1.5 text-center">
                      <div className={`mx-auto w-12 h-8 flex items-center justify-center rounded-md font-bold text-[11px] ${getColor(cell.pct)}`}>
                        {cell.count > 0 ? `${cell.pct}%` : '—'}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center gap-3 mt-4 flex-wrap">
          <span className="text-[10px] text-muted-foreground">Retención:</span>
          {[['≥60%','bg-green-500/80'],['40–59%','bg-green-500/50'],['20–39%','bg-yellow-500/50'],['10–19%','bg-orange-500/40'],['<10%','bg-red-500/30']].map(([l,c]) => (
            <span key={l} className="flex items-center gap-1 text-[10px]">
              <span className={`w-3 h-3 rounded ${c} inline-block`} />{l}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── DormantProductsTab — Productos sin movimiento por días ───────────────────

function DormantProductsTab({ products, sales }: { products: any[]; sales: any[] }) {
  const [daysFilter, setDaysFilter] = useState<30 | 60 | 90>(30);

  const dormantData = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysFilter);
    const cutoffTs = cutoff.getTime();

    const lastSale: Record<string, number> = {};
    for (const s of sales) {
      if (!s.product_id) continue;
      const ts = new Date(s.date).getTime();
      if (!lastSale[s.product_id] || ts > lastSale[s.product_id]) lastSale[s.product_id] = ts;
    }

    return products
      .filter(p => p.stock > 0)
      .map(p => {
        const last = lastSale[p.id];
        const daysSince = last ? Math.floor((Date.now() - last) / 86400000) : null;
        return { ...p, daysSince, hasAnySale: !!last };
      })
      .filter(p => !p.hasAnySale || (p.daysSince !== null && p.daysSince >= daysFilter))
      .sort((a, b) => {
        if (a.daysSince === null && b.daysSince !== null) return -1;
        if (b.daysSince === null && a.daysSince !== null) return 1;
        return (b.daysSince ?? 0) - (a.daysSince ?? 0);
      });
  }, [products, sales, daysFilter]);

  const totalInmovilizado = dormantData.reduce((s, p) => s + (Number(p.cost_usd) * p.stock || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="font-semibold">Productos sin movimiento</h3>
          <p className="text-xs text-muted-foreground">{dormantData.length} producto{dormantData.length !== 1 ? "s" : ""} sin ventas en los últimos {daysFilter} días · Stock inmovilizado: U$S {totalInmovilizado.toFixed(0)}</p>
        </div>
        <div className="flex gap-2">
          {([30, 60, 90] as const).map(d => (
            <button key={d} onClick={() => setDaysFilter(d)} className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${daysFilter === d ? "bg-primary text-primary-foreground border-primary" : "bg-muted border-border text-muted-foreground hover:border-primary/40"}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>
      {dormantData.length === 0 ? (
        <p className="text-center py-12 text-muted-foreground text-sm">No hay productos sin movimiento en este período</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">Producto</th>
                <th className="text-right p-3 font-medium">Stock</th>
                <th className="text-right p-3 font-medium">Costo U$S</th>
                <th className="text-right p-3 font-medium">Inmovilizado</th>
                <th className="text-right p-3 font-medium">Última venta</th>
                <th className="text-center p-3 font-medium">Acción sugerida</th>
              </tr>
            </thead>
            <tbody>
              {dormantData.map(p => (
                <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                  <td className="p-3">
                    <p className="font-medium truncate max-w-[180px]">{p.name}</p>
                    {p.brand && <p className="text-[10px] text-muted-foreground">{p.brand}</p>}
                  </td>
                  <td className="p-3 text-right font-mono">{p.stock}</td>
                  <td className="p-3 text-right text-muted-foreground">{p.cost_usd ? `U$S ${Number(p.cost_usd).toFixed(2)}` : "—"}</td>
                  <td className="p-3 text-right font-semibold text-orange-400">
                    {p.cost_usd ? `U$S ${(Number(p.cost_usd) * p.stock).toFixed(0)}` : "—"}
                  </td>
                  <td className="p-3 text-right">
                    {p.daysSince === null
                      ? <span className="text-xs text-red-400 font-semibold">Sin ventas</span>
                      : <span className={`text-xs font-semibold ${p.daysSince >= 90 ? "text-red-400" : p.daysSince >= 60 ? "text-orange-400" : "text-yellow-400"}`}>{p.daysSince}d</span>
                    }
                  </td>
                  <td className="p-3 text-center">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${p.daysSince === null || p.daysSince >= 90 ? "bg-red-500/10 text-red-400" : "bg-orange-500/10 text-orange-400"}`}>
                      {p.daysSince === null || p.daysSince >= 90 ? "Liquidar" : "Promover"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
