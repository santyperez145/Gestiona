import { useEffect, useState } from "react";
import { getProducts, getSales, getPurchases, getDebts, getSettings, formatARS, formatUSD, getCategoryLabel } from "@/lib/store";
import { Product, Sale, Purchase, Debt } from "@/lib/types";
import { Package, TrendingUp, TrendingDown, AlertCircle, DollarSign, BarChart3, Percent, Users, ShoppingBag } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid } from "recharts";

interface DashboardStats {
  totalProducts: number;
  totalStock: number;
  totalSalesARS: number;
  totalSalesCount: number;
  totalPurchasesUSD: number;
  totalPurchasesARS: number;
  totalDebtsARS: number;
  pendingDebts: number;
  lowStock: number;
  grossProfitARS: number;
  grossProfitUSD: number;
  profitMargin: number;
  avgSaleARS: number;
  topProducts: { name: string; qty: number; revenue: number; profit: number }[];
  salesByMonth: { month: string; total: number; profit: number }[];
  salesByCategory: { name: string; value: number }[];
  uniqueCustomers: number;
  inventoryValueUSD: number;
}

function computeStats(products: Product[], sales: Sale[], purchases: Purchase[], debts: Debt[]): DashboardStats {
  const settings = getSettings();
  const pendingDebts = debts.filter(d => d.status !== 'paid');
  const totalSalesARS = sales.reduce((s, v) => s + v.totalARS, 0);
  const totalPurchasesUSD = purchases.reduce((s, c) => s + c.totalUSD, 0);
  const totalPurchasesARS = purchases.reduce((s, c) => s + c.totalARS, 0);
  
  const grossProfitARS = sales.reduce((s, v) => s + v.profitARS, 0);
  const grossProfitUSD = sales.reduce((s, v) => s + v.profitUSD, 0);
  const profitMargin = totalSalesARS > 0 ? (grossProfitARS / totalSalesARS) * 100 : 0;

  const productSales: Record<string, { qty: number; revenue: number; name: string; profit: number }> = {};
  sales.forEach(s => {
    if (!productSales[s.productId]) productSales[s.productId] = { qty: 0, revenue: 0, name: s.productName, profit: 0 };
    productSales[s.productId].qty += s.quantity;
    productSales[s.productId].revenue += s.totalARS;
    productSales[s.productId].profit += s.profitARS;
  });
  const topProducts = Object.values(productSales).sort((a, b) => b.revenue - a.revenue).slice(0, 5);

  const monthMap: Record<string, { total: number; profit: number }> = {};
  sales.forEach(s => {
    const d = new Date(s.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!monthMap[key]) monthMap[key] = { total: 0, profit: 0 };
    monthMap[key].total += s.totalARS;
    monthMap[key].profit += s.profitARS;
  });
  const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const salesByMonth = Object.entries(monthMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([month, data]) => {
      const [y, m] = month.split('-');
      return { month: `${monthNames[parseInt(m) - 1]} ${y.slice(2)}`, total: data.total, profit: data.profit };
    });

  const catMap: Record<string, number> = {};
  sales.forEach(s => {
    const prod = products.find(p => p.id === s.productId);
    const cat = prod ? getCategoryLabel(prod.category) : 'Otro';
    catMap[cat] = (catMap[cat] || 0) + s.totalARS;
  });
  const salesByCategory = Object.entries(catMap).map(([name, value]) => ({ name, value }));

  const customers = new Set(sales.filter(s => s.customerName).map(s => s.customerName));
  const inventoryValueUSD = products.reduce((s, p) => s + (p.totalCostUSD * p.stock), 0);

  return {
    totalProducts: products.length,
    totalStock: products.reduce((s, p) => s + p.stock, 0),
    totalSalesARS,
    totalSalesCount: sales.length,
    totalPurchasesUSD,
    totalPurchasesARS,
    totalDebtsARS: pendingDebts.reduce((s, d) => s + d.remainingARS, 0),
    pendingDebts: pendingDebts.length,
    lowStock: products.filter(p => p.stock <= 3 && p.stock > 0).length,
    grossProfitARS,
    grossProfitUSD,
    profitMargin,
    avgSaleARS: sales.length > 0 ? totalSalesARS / sales.length : 0,
    topProducts,
    salesByMonth,
    salesByCategory,
    uniqueCustomers: customers.size,
    inventoryValueUSD,
  };
}

const CHART_COLORS = ['hsl(40, 70%, 50%)', 'hsl(150, 60%, 40%)', 'hsl(35, 90%, 55%)', 'hsl(0, 70%, 50%)', 'hsl(200, 60%, 50%)'];

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);

  useEffect(() => {
    setStats(computeStats(getProducts(), getSales(), getPurchases(), getDebts()));
  }, []);

  if (!stats) return null;

  const kpiCards = [
    { label: "Ganancia Bruta", value: formatARS(stats.grossProfitARS), sub: `${formatUSD(stats.grossProfitUSD)} · Margen: ${stats.profitMargin.toFixed(1)}%`, icon: TrendingUp, color: stats.grossProfitARS >= 0 ? "text-success" : "text-destructive" },
    { label: "Ventas Totales", value: formatARS(stats.totalSalesARS), sub: `${stats.totalSalesCount} ventas realizadas`, icon: DollarSign, color: "text-primary" },
    { label: "Inversión Total", value: formatUSD(stats.totalPurchasesUSD), sub: `${formatARS(stats.totalPurchasesARS)} en ARS`, icon: TrendingDown, color: "text-warning" },
    { label: "Deudas Pendientes", value: formatARS(stats.totalDebtsARS), sub: `${stats.pendingDebts} deudas activas`, icon: AlertCircle, color: "text-destructive" },
    { label: "Inventario", value: `${stats.totalStock} uds`, sub: `Valor: ${formatUSD(stats.inventoryValueUSD)}`, icon: Package, color: "text-primary" },
    { label: "Ticket Promedio", value: formatARS(stats.avgSaleARS), sub: "Por venta", icon: ShoppingBag, color: "text-accent" },
    { label: "Stock Bajo", value: stats.lowStock, sub: "≤3 unidades", icon: BarChart3, color: stats.lowStock > 0 ? "text-destructive" : "text-success" },
    { label: "Clientes", value: stats.uniqueCustomers, sub: "Clientes únicos", icon: Users, color: "text-primary" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-3xl font-display font-bold">Dashboard</h1>
        <span className="text-xs text-muted-foreground">{new Date().toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
      </div>
      <p className="text-muted-foreground mb-6">Resumen general de Exentry Imports</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {kpiCards.map((c) => (
          <div key={c.label} className="bg-card border border-border rounded-lg p-4 shadow-card hover:border-primary/30 transition-colors">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground uppercase tracking-wider">{c.label}</span>
              <c.icon className={`w-4 h-4 ${c.color}`} />
            </div>
            <p className="text-xl font-bold font-display">{c.value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{c.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
        <div className="lg:col-span-2 bg-card border border-border rounded-lg p-5 shadow-card">
          <h2 className="text-sm font-display font-semibold mb-4 text-muted-foreground uppercase tracking-wider">Ventas y Ganancia por Mes</h2>
          {stats.salesByMonth.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={stats.salesByMonth}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 15%, 18%)" />
                <XAxis dataKey="month" tick={{ fill: 'hsl(220, 10%, 55%)', fontSize: 11 }} axisLine={false} />
                <YAxis tick={{ fill: 'hsl(220, 10%, 55%)', fontSize: 11 }} axisLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ background: 'hsl(220, 18%, 12%)', border: '1px solid hsl(220, 15%, 18%)', borderRadius: 8, color: 'hsl(40, 20%, 92%)' }} formatter={(v: number, name: string) => [formatARS(v), name === 'total' ? 'Ventas' : 'Ganancia']} />
                <Bar dataKey="total" fill="hsl(40, 70%, 50%)" radius={[4, 4, 0, 0]} name="Ventas" />
                <Bar dataKey="profit" fill="hsl(150, 60%, 40%)" radius={[4, 4, 0, 0]} name="Ganancia" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">Sin datos de ventas aún</div>
          )}
        </div>

        <div className="bg-card border border-border rounded-lg p-5 shadow-card">
          <h2 className="text-sm font-display font-semibold mb-4 text-muted-foreground uppercase tracking-wider">Ventas por Categoría</h2>
          {stats.salesByCategory.length > 0 ? (
            <div>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={stats.salesByCategory} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" stroke="none">
                    {stats.salesByCategory.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: 'hsl(220, 18%, 12%)', border: '1px solid hsl(220, 15%, 18%)', borderRadius: 8, color: 'hsl(40, 20%, 92%)' }} formatter={(v: number) => [formatARS(v), 'Total']} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap justify-center gap-3 mt-2">
                {stats.salesByCategory.map((cat, i) => (
                  <div key={cat.name} className="flex items-center gap-1.5 text-xs">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                    <span className="text-muted-foreground">{cat.name}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">Sin datos</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-lg p-5 shadow-card">
          <h2 className="text-sm font-display font-semibold mb-4 text-muted-foreground uppercase tracking-wider">Productos Más Vendidos</h2>
          {stats.topProducts.length > 0 ? (
            <div className="space-y-3">
              {stats.topProducts.map((p, i) => {
                const maxRev = stats.topProducts[0]?.revenue || 1;
                return (
                  <div key={p.name}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium truncate mr-2">{i + 1}. {p.name}</span>
                      <span className="text-muted-foreground shrink-0">{p.qty} uds · <span className="text-success">{formatARS(p.profit)}</span></span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full rounded-full gradient-gold" style={{ width: `${(p.revenue / maxRev) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm py-8 text-center">Sin ventas registradas</p>
          )}
        </div>

        <div className="bg-card border border-border rounded-lg overflow-hidden shadow-card">
          <h2 className="text-sm font-display font-semibold p-5 pb-3 text-muted-foreground uppercase tracking-wider">Últimas Ventas</h2>
          <RecentSalesTable />
        </div>
      </div>

      {stats.totalSalesCount > 0 && (
        <div className="mt-6 bg-card border border-border rounded-lg p-5 shadow-card">
          <h2 className="text-sm font-display font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Análisis de Rentabilidad</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <p className="text-xs text-muted-foreground mb-1">Ingreso Total</p>
              <p className="text-lg font-bold text-primary">{formatARS(stats.totalSalesARS)}</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <p className="text-xs text-muted-foreground mb-1">Costo Mercadería</p>
              <p className="text-lg font-bold text-warning">{formatARS(stats.totalSalesARS - stats.grossProfitARS)}</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <p className="text-xs text-muted-foreground mb-1">Ganancia ARS</p>
              <p className={`text-lg font-bold ${stats.grossProfitARS >= 0 ? 'text-success' : 'text-destructive'}`}>{formatARS(stats.grossProfitARS)}</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-muted/50">
              <p className="text-xs text-muted-foreground mb-1">Ganancia USD</p>
              <p className={`text-lg font-bold ${stats.grossProfitUSD >= 0 ? 'text-success' : 'text-destructive'}`}>
                {formatUSD(stats.grossProfitUSD)}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5"><Percent className="w-3 h-3 inline mr-1" />Margen: {stats.profitMargin.toFixed(1)}%</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RecentSalesTable() {
  const sales = getSales().sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5);
  if (!sales.length) return <p className="p-5 text-muted-foreground text-sm">No hay ventas registradas aún.</p>;
  return (
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
        {sales.map(s => (
          <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
            <td className="p-3">{s.productName}</td>
            <td className="p-3">{s.customerName || '—'}</td>
            <td className="p-3 text-right font-medium">{formatARS(s.totalARS)}</td>
            <td className="p-3 text-right">
              <span className={s.profitARS > 0 ? 'text-success' : 'text-destructive'}>{formatARS(s.profitARS)}</span>
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
  );
}
