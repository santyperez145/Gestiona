import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { getProductsDB, getSalesDB, getPurchasesDB, getDebtsDB, getSettingsDB, formatARS, formatUSD, getCategoryLabel, seedProductsForUser, calculateTaxes } from "@/lib/supabaseStore";
import { Package, TrendingUp, TrendingDown, AlertCircle, DollarSign, BarChart3, Users, ShoppingBag, AlertTriangle, Bell, Filter } from "lucide-react";
import { DashboardSkeleton } from "@/components/shared/PageSkeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid,
  LineChart, Line, Legend, AreaChart, Area,
} from "recharts";

const CHART_COLORS = ['hsl(40, 70%, 50%)', 'hsl(150, 60%, 40%)', 'hsl(35, 90%, 55%)', 'hsl(0, 70%, 50%)', 'hsl(200, 60%, 50%)', 'hsl(280, 60%, 50%)'];

const CATEGORIES = [
  { value: 'all', label: 'Todas las categorías' },
  { value: 'perfume_arabe', label: 'Perfume Árabe' },
  { value: 'perfume_diseñador', label: 'Perfume Diseñador' },
  { value: 'vaper', label: 'Vaper' },
  { value: 'electronico', label: 'Electrónico' },
];

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

export default function Dashboard() {
  const { user } = useAuth();
  const [rawData, setRawData] = useState<{ products: any[]; sales: any[]; purchases: any[]; debts: any[]; settings: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterCat, setFilterCat] = useState('all');

  useEffect(() => {
    if (!user) return;
    (async () => {
      await seedProductsForUser(user.id);
      const [products, sales, purchases, debts, settings] = await Promise.all([
        getProductsDB(user.id), getSalesDB(user.id), getPurchasesDB(user.id), getDebtsDB(user.id), getSettingsDB(user.id),
      ]);
      setRawData({ products, sales, purchases, debts, settings });
      setLoading(false);
    })();
  }, [user]);

  const stats = useMemo(() => {
    if (!rawData) return null;
    const { products: allProducts, sales: allSales, purchases: allPurchases, debts, settings } = rawData;

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
      if (!monthMap[key]) monthMap[key] = { total: 0, profit: 0, count: 0, costARS: 0 };
      monthMap[key].total += Number(s.total_ars);
      monthMap[key].profit += Number(s.profit_ars);
      monthMap[key].count += s.quantity;
      monthMap[key].costARS += Number(s.cost_per_unit_usd) * Number(settings.exchange_rate) * s.quantity;
    });
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const salesByMonth = Object.entries(monthMap).sort(([a], [b]) => a.localeCompare(b)).slice(-6).map(([m, data]: any) => {
      const [y, mo] = m.split('-');
      return {
        month: `${monthNames[parseInt(mo) - 1]} ${y.slice(2)}`,
        total: data.total, profit: data.profit, count: data.count,
        margin: data.total > 0 ? (data.profit / data.total * 100) : 0,
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

    const lowStockProducts = products.filter((p: any) => p.stock > 0 && p.stock <= 3);
    const outOfStockProducts = products.filter((p: any) => p.stock <= 0);

    const restockSuggestions = Object.entries(productSales)
      .map(([id, data]: any) => {
        const prod = products.find((p: any) => p.id === id);
        return prod ? { name: prod.name, stock: prod.stock, soldQty: data.qty, revenue: data.revenue } : null;
      })
      .filter((r: any) => r && r.stock <= 3)
      .sort((a: any, b: any) => b.soldQty - a.soldQty)
      .slice(0, 5);

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
    };
  }, [rawData, filterCat]);

  if (loading || !stats) return <DashboardSkeleton />;

  const kpiCards = [
    { label: "Ganancia Bruta", value: formatARS(stats.grossProfitARS), sub: `${formatUSD(stats.grossProfitUSD)}`, icon: TrendingUp, color: stats.grossProfitARS >= 0 ? "text-success" : "text-destructive" },
    ...(stats.taxEnabled ? [{ label: "Ganancia Neta", value: formatARS(stats.netProfitARS), sub: "Post impuestos", icon: TrendingUp, color: stats.netProfitARS >= 0 ? "text-success" : "text-destructive" }] : []),
    { label: "Facturación", value: formatARS(stats.totalSalesARS), sub: `${stats.totalSalesCount} ventas`, icon: DollarSign, color: "text-primary" },
    { label: "Inversión", value: formatUSD(stats.totalPurchasesUSD), sub: formatARS(stats.totalPurchasesARS), icon: TrendingDown, color: "text-warning" },
    { label: "Deudas", value: formatARS(stats.totalDebtsARS), sub: `${stats.pendingDebts} activas`, icon: AlertCircle, color: "text-destructive" },
    { label: "Inventario", value: `${stats.totalStock} uds`, sub: formatUSD(stats.inventoryValueUSD), icon: Package, color: "text-primary" },
    { label: "Ticket Prom.", value: formatARS(stats.avgSaleARS), sub: "Por venta", icon: ShoppingBag, color: "text-accent" },
    { label: "Stock Bajo", value: `${stats.lowStock} / ${stats.outOfStock}`, sub: "Bajo / Agotado", icon: BarChart3, color: stats.lowStock > 0 ? "text-destructive" : "text-success" },
    { label: "Clientes", value: stats.uniqueCustomers, sub: "Únicos", icon: Users, color: "text-primary" },
  ];

  const tooltipStyle = { background: 'hsl(220, 18%, 12%)', border: '1px solid hsl(220, 15%, 18%)', borderRadius: 8, color: 'hsl(40, 20%, 92%)' };

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Buenos días';
    if (h < 18) return 'Buenas tardes';
    return 'Buenas noches';
  })();

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-2 gap-2">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold">{greeting} 👋</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {filterCat === 'all' ? 'Resumen general de tu negocio' : `Filtrado: ${CATEGORIES.find(c => c.value === filterCat)?.label}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filterCat} onValueChange={setFilterCat}>
            <SelectTrigger className="bg-card border-border/50 w-[200px] h-9 text-sm rounded-lg">
              <Filter className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map(c => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-[11px] text-muted-foreground/60 hidden sm:block">{new Date().toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4 mb-8 mt-5">
        {kpiCards.map((c, i) => (
          <div key={c.label} className="group bg-card border border-border rounded-xl p-3.5 md:p-4 shadow-card hover:border-primary/25 hover:glow-gold transition-all duration-300"
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] md:text-[11px] text-muted-foreground font-medium uppercase tracking-wider">{c.label}</span>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                c.color === 'text-success' ? 'bg-success/10' : 
                c.color === 'text-destructive' ? 'bg-destructive/10' : 
                c.color === 'text-warning' ? 'bg-warning/10' : 
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

      {/* ROI & Margin Gauges */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6 md:mb-8">
        <div className="bg-card border border-border rounded-lg p-4 shadow-card flex items-center justify-center">
          <GaugeChart value={stats.profitMargin} max={100} label="Margen Bruto" color="hsl(150, 60%, 40%)" />
        </div>
        <div className="bg-card border border-border rounded-lg p-4 shadow-card flex items-center justify-center">
          <GaugeChart value={stats.roi} max={200} label="ROI" color="hsl(40, 70%, 50%)" />
        </div>
        <div className="bg-card border border-border rounded-lg p-4 shadow-card">
          <h3 className="text-xs text-muted-foreground uppercase tracking-wider mb-3">Cobranza</h3>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Cobrado</span>
              <span className="text-success font-medium">{formatARS(stats.paidSalesARS)}</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-success rounded-full" style={{ width: `${stats.totalSalesARS > 0 ? (stats.paidSalesARS / stats.totalSalesARS * 100) : 0}%` }} />
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Por cobrar</span>
              <span className="text-destructive font-medium">{formatARS(stats.unpaidSalesARS)}</span>
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
              <div className="bg-warning/10 rounded-lg p-3">
                <p className="text-xs font-semibold text-warning mb-2 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Stock Bajo ≤3 ({stats.lowStockProducts.length})</p>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {stats.lowStockProducts.map((p: any) => (
                    <p key={p.id} className="text-xs text-muted-foreground truncate">• {p.name} — <span className="text-warning font-medium">{p.stock}u</span></p>
                  ))}
                </div>
              </div>
            )}
          </div>
          {stats.restockSuggestions?.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-xs font-semibold text-primary mb-2">🔄 Sugerencias de Restock (más vendidos con bajo stock)</p>
              <div className="flex flex-wrap gap-2">
                {stats.restockSuggestions.map((r: any) => (
                  <span key={r.name} className="px-2 py-1 bg-primary/10 text-primary rounded-md text-[10px] font-medium">
                    {r.name} ({r.stock}u · {r.soldQty} vendidos)
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Top Products + Recent Sales */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-lg p-4 md:p-5 shadow-card">
          <h2 className="text-sm font-display font-semibold mb-4 text-muted-foreground uppercase tracking-wider">Productos Más Vendidos</h2>
          {stats.topProducts.length > 0 ? (
            <div className="space-y-3">
              {stats.topProducts.map((p: any, i: number) => {
                const maxRev = stats.topProducts[0]?.revenue || 1;
                return (
                  <div key={p.name}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium truncate mr-2">{i + 1}. {p.name}</span>
                      <span className="text-muted-foreground shrink-0 text-xs">{p.qty}u · <span className="text-success">{formatARS(p.profit)}</span></span>
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
                          <span className={Number(s.profit_ars) > 0 ? 'text-success' : 'text-destructive'}>{formatARS(Number(s.profit_ars))}</span>
                        </td>
                        <td className="p-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.paid ? 'bg-success/20 text-success' : 'bg-destructive/20 text-destructive'}`}>
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
                      <span className={`text-xs ${s.paid ? 'text-success' : 'text-destructive'}`}>{s.paid ? 'Pagado' : 'Debe'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : <p className="p-5 text-muted-foreground text-sm">No hay ventas registradas aún.</p>}
        </div>
      </div>
    </div>
  );
}
