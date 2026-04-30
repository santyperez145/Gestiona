import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import {
  getProductsDB, getSalesDB, getPurchasesDB, getExpensesDB,
  formatARS,
} from "@/lib/supabaseStore";
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  TrendingUp, TrendingDown, BarChart3, Users, DollarSign,
  Package, Calendar, Percent,
} from "lucide-react";
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

export default function AnalyticsPage() {
  const { user } = useAuth();
  const [rawData, setRawData] = useState<any>(null);
  const [year, setYear] = useState<"0" | "1">("0");

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [products, sales, purchases, expenses] = await Promise.all([
        getProductsDB(user.id), getSalesDB(user.id),
        getPurchasesDB(user.id), getExpensesDB(user.id),
      ]);
      setRawData({ products, sales, purchases, expenses });
    })();
  }, [user]);

  const derived = useMemo(() => {
    if (!rawData) return null;
    const { products, sales, purchases, expenses } = rawData;
    const offset = Number(year);
    const monthly = buildMonthlyData(sales, expenses, purchases, offset);
    const prevMonthly = buildMonthlyData(sales, expenses, purchases, offset + 1);
    const productPerf = buildProductPerformance(sales, products);
    const customerData = buildCustomerData(sales);
    const categoryMix = buildCategoryMix(sales, products);

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

    return {
      monthly, yoyData, productPerf, customerData, categoryMix,
      totalRevenue, totalProfit, totalUnits, revYoY, profYoY,
      uniqueCustomers, avgTicket, avgMargin,
    };
  }, [rawData, year]);

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">Analytics Avanzado</h1>
          <p className="text-sm text-muted-foreground">Métricas profundas, tendencias y comparativas interanuales</p>
        </div>
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
      </div>

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
          <TabsTrigger value="yoy" className="text-xs">Año vs Año</TabsTrigger>
          <TabsTrigger value="products" className="text-xs">Productos</TabsTrigger>
          <TabsTrigger value="customers" className="text-xs">Clientes</TabsTrigger>
          <TabsTrigger value="mix" className="text-xs">Mix</TabsTrigger>
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
              <table className="w-full text-sm">
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
        <TabsContent value="customers" className="mt-4">
          <div className="bg-card border border-border rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border bg-muted/40 flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold flex-1">Top clientes por gasto total</h3>
              <span className="text-xs text-muted-foreground">{derived.uniqueCustomers} únicos</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
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
      </Tabs>
    </div>
  );
}
