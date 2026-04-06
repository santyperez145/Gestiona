import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { getProductsDB, getSalesDB, getPurchasesDB, getDebtsDB, getSettingsDB, formatARS, formatUSD, getCategoryLabel, seedProductsForUser, calculateTaxes } from "@/lib/supabaseStore";
import { Package, TrendingUp, TrendingDown, AlertCircle, DollarSign, BarChart3, Users, ShoppingBag } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid } from "recharts";

const CHART_COLORS = ['hsl(40, 70%, 50%)', 'hsl(150, 60%, 40%)', 'hsl(35, 90%, 55%)', 'hsl(0, 70%, 50%)', 'hsl(200, 60%, 50%)'];

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      await seedProductsForUser(user.id);
      const [products, sales, purchases, debts, settings] = await Promise.all([
        getProductsDB(user.id), getSalesDB(user.id), getPurchasesDB(user.id), getDebtsDB(user.id), getSettingsDB(user.id),
      ]);

      const pendingDebts = debts.filter(d => d.status !== 'paid');
      const totalSalesARS = sales.reduce((s: number, v: any) => s + Number(v.total_ars), 0);
      const grossProfitARS = sales.reduce((s: number, v: any) => s + Number(v.profit_ars), 0);
      const grossProfitUSD = sales.reduce((s: number, v: any) => s + Number(v.profit_usd), 0);
      const totalPurchasesUSD = purchases.reduce((s: number, c: any) => s + Number(c.total_usd), 0);
      const totalPurchasesARS = purchases.reduce((s: number, c: any) => s + Number(c.total_ars), 0);

      const taxes = calculateTaxes(grossProfitARS, settings);

      const productSales: Record<string, any> = {};
      sales.forEach((s: any) => {
        if (!productSales[s.product_id]) productSales[s.product_id] = { qty: 0, revenue: 0, name: s.product_name, profit: 0 };
        productSales[s.product_id].qty += s.quantity;
        productSales[s.product_id].revenue += Number(s.total_ars);
        productSales[s.product_id].profit += Number(s.profit_ars);
      });
      const topProducts = Object.values(productSales).sort((a: any, b: any) => b.revenue - a.revenue).slice(0, 5);

      const monthMap: Record<string, any> = {};
      sales.forEach((s: any) => {
        const d = new Date(s.date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!monthMap[key]) monthMap[key] = { total: 0, profit: 0 };
        monthMap[key].total += Number(s.total_ars);
        monthMap[key].profit += Number(s.profit_ars);
      });
      const monthNames = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
      const salesByMonth = Object.entries(monthMap).sort(([a],[b]) => a.localeCompare(b)).slice(-6).map(([m, data]: any) => {
        const [y, mo] = m.split('-');
        return { month: `${monthNames[parseInt(mo)-1]} ${y.slice(2)}`, total: data.total, profit: data.profit };
      });

      const catMap: Record<string, number> = {};
      sales.forEach((s: any) => {
        const prod = products.find((p: any) => p.id === s.product_id);
        const cat = prod ? getCategoryLabel(prod.category) : 'Otro';
        catMap[cat] = (catMap[cat] || 0) + Number(s.total_ars);
      });

      const customers = new Set(sales.filter((s: any) => s.customer_name).map((s: any) => s.customer_name));
      const inventoryValueUSD = products.reduce((s: number, p: any) => s + (Number(p.total_cost_usd) * p.stock), 0);
      const totalStock = products.reduce((s: number, p: any) => s + p.stock, 0);

      setStats({
        totalProducts: products.length, totalStock, totalSalesARS, totalSalesCount: sales.length,
        totalPurchasesUSD, totalPurchasesARS,
        totalDebtsARS: pendingDebts.reduce((s: number, d: any) => s + Number(d.remaining_ars), 0),
        pendingDebts: pendingDebts.length,
        lowStock: products.filter((p: any) => p.stock <= 3 && p.stock > 0).length,
        grossProfitARS, grossProfitUSD,
        netProfitARS: taxes.netProfit,
        taxEnabled: settings.tax_enabled,
        profitMargin: totalSalesARS > 0 ? (grossProfitARS / totalSalesARS) * 100 : 0,
        avgSaleARS: sales.length > 0 ? totalSalesARS / sales.length : 0,
        topProducts, salesByMonth,
        salesByCategory: Object.entries(catMap).map(([name, value]) => ({ name, value })),
        uniqueCustomers: customers.size, inventoryValueUSD,
        recentSales: sales.slice(0, 5),
      });
      setLoading(false);
    })();
  }, [user]);

  if (loading || !stats) return (
    <div className="flex items-center justify-center py-20">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  const kpiCards = [
    { label: "Ganancia Bruta", value: formatARS(stats.grossProfitARS), sub: `${formatUSD(stats.grossProfitUSD)} · Margen: ${stats.profitMargin.toFixed(1)}%`, icon: TrendingUp, color: stats.grossProfitARS >= 0 ? "text-success" : "text-destructive" },
    ...(stats.taxEnabled ? [{ label: "Ganancia Neta", value: formatARS(stats.netProfitARS), sub: "Post impuestos", icon: TrendingUp, color: stats.netProfitARS >= 0 ? "text-success" : "text-destructive" }] : []),
    { label: "Facturación", value: formatARS(stats.totalSalesARS), sub: `${stats.totalSalesCount} ventas`, icon: DollarSign, color: "text-primary" },
    { label: "Inversión", value: formatUSD(stats.totalPurchasesUSD), sub: formatARS(stats.totalPurchasesARS), icon: TrendingDown, color: "text-warning" },
    { label: "Deudas", value: formatARS(stats.totalDebtsARS), sub: `${stats.pendingDebts} activas`, icon: AlertCircle, color: "text-destructive" },
    { label: "Inventario", value: `${stats.totalStock} uds`, sub: formatUSD(stats.inventoryValueUSD), icon: Package, color: "text-primary" },
    { label: "Ticket Prom.", value: formatARS(stats.avgSaleARS), sub: "Por venta", icon: ShoppingBag, color: "text-accent" },
    { label: "Stock Bajo", value: stats.lowStock, sub: "≤3 uds", icon: BarChart3, color: stats.lowStock > 0 ? "text-destructive" : "text-success" },
    { label: "Clientes", value: stats.uniqueCustomers, sub: "Únicos", icon: Users, color: "text-primary" },
  ];

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-1 gap-1">
        <h1 className="text-2xl md:text-3xl font-display font-bold">Dashboard</h1>
        <span className="text-xs text-muted-foreground">{new Date().toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
      </div>
      <p className="text-muted-foreground text-sm mb-4 md:mb-6">Resumen general de Exentry Imports</p>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4 mb-6 md:mb-8">
        {kpiCards.map(c => (
          <div key={c.label} className="bg-card border border-border rounded-lg p-3 md:p-4 shadow-card hover:border-primary/30 transition-colors">
            <div className="flex items-center justify-between mb-1 md:mb-2">
              <span className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wider leading-tight">{c.label}</span>
              <c.icon className={`w-3.5 h-3.5 md:w-4 md:h-4 ${c.color} shrink-0`} />
            </div>
            <p className="text-base md:text-xl font-bold font-display">{c.value}</p>
            <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5 truncate">{c.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6 md:mb-8">
        <div className="lg:col-span-2 bg-card border border-border rounded-lg p-4 md:p-5 shadow-card">
          <h2 className="text-sm font-display font-semibold mb-4 text-muted-foreground uppercase tracking-wider">Ventas y Ganancia por Mes</h2>
          {stats.salesByMonth.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stats.salesByMonth}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 15%, 18%)" />
                <XAxis dataKey="month" tick={{ fill: 'hsl(220, 10%, 55%)', fontSize: 11 }} axisLine={false} />
                <YAxis tick={{ fill: 'hsl(220, 10%, 55%)', fontSize: 11 }} axisLine={false} tickFormatter={(v: number) => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ background: 'hsl(220, 18%, 12%)', border: '1px solid hsl(220, 15%, 18%)', borderRadius: 8, color: 'hsl(40, 20%, 92%)' }} formatter={(v: number, name: string) => [formatARS(v), name === 'total' ? 'Ventas' : 'Ganancia']} />
                <Bar dataKey="total" fill="hsl(40, 70%, 50%)" radius={[4,4,0,0]} name="Ventas" />
                <Bar dataKey="profit" fill="hsl(150, 60%, 40%)" radius={[4,4,0,0]} name="Ganancia" />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">Sin datos de ventas aún</div>}
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
                  <Tooltip contentStyle={{ background: 'hsl(220, 18%, 12%)', border: '1px solid hsl(220, 15%, 18%)', borderRadius: 8, color: 'hsl(40, 20%, 92%)' }} formatter={(v: number) => [formatARS(v), 'Total']} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap justify-center gap-3 mt-2">
                {stats.salesByCategory.map((cat: any, i: number) => (
                  <div key={cat.name} className="flex items-center gap-1.5 text-xs">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                    <span className="text-muted-foreground">{cat.name}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">Sin datos</div>}
        </div>
      </div>

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
                      <span className="font-medium truncate mr-2">{i+1}. {p.name}</span>
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
                      <th className="text-center p-3 font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.recentSales.map((s: any) => (
                      <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="p-3">{s.product_name}</td>
                        <td className="p-3">{s.customer_name || '—'}</td>
                        <td className="p-3 text-right font-medium">{formatARS(Number(s.total_ars))}</td>
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
