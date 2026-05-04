import { useEffect, useState, useMemo, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { getProductsDB, getSalesDB, getPurchasesDB, getDebtsDB, getSettingsDB, getExpensesDB, formatARS, formatUSD, getCategoryLabel, seedProductsForUser, calculateTaxes, getExpenseCategoryLabel, buildExpenseCategories } from "@/lib/supabaseStore";
import { Package, TrendingUp, TrendingDown, AlertCircle, DollarSign, BarChart3, Users, ShoppingBag, AlertTriangle, Bell, Filter, Banknote, Target, SlidersHorizontal, Wallet, Crown, ArrowUp, ArrowDown, Zap, Cake, MessageCircle, Share2 } from "lucide-react";
import { DashboardSkeleton } from "@/components/shared/PageSkeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid,
  LineChart, Line, Legend, AreaChart, Area,
} from "recharts";
import { Link } from "react-router-dom";
import CashFlowProjector from "@/components/dashboard/CashFlowProjector";
import HealthScore from "@/components/dashboard/HealthScore";
import ConsistencyAlerts from "@/components/dashboard/ConsistencyAlerts";
import AIPrediction from "@/components/dashboard/AIPrediction";

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
        <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-3 flex items-center gap-1.5"><Banknote className="w-4 h-4 text-success" />Flujo de Caja Proyectado</h3>
        <div className="space-y-2.5">
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Ventas/mes (proy.)</span><span className="text-success font-bold">{formatARS(stats.projectedMonthlySalesARS)}</span></div>
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Compras/mes (prom.)</span><span className="text-warning font-bold">-{formatARS(stats.avgMonthlyPurchasesARS)}</span></div>
          <div className="flex justify-between text-sm border-t border-border pt-2"><span className="font-medium">Flujo neto</span><span className={`font-bold ${stats.projectedCashFlowARS >= 0 ? 'text-success' : 'text-destructive'}`}>{formatARS(stats.projectedCashFlowARS)}</span></div>
          <div className="flex justify-between text-xs"><span className="text-muted-foreground">Ganancia/mes (proy.)</span><span className="text-success">{formatARS(stats.projectedMonthlyProfitARS)}</span></div>
        </div>
      </div>
      <div className="bg-card border border-border rounded-xl p-4 md:p-5 shadow-card">
        <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-3 flex items-center gap-1.5"><Target className="w-4 h-4 text-primary" />Punto de Equilibrio</h3>
        <div className="text-center py-3"><p className="text-3xl font-black font-display text-primary">{stats.breakEvenUnits}</p><p className="text-xs text-muted-foreground mt-1">unidades/mes para cubrir gastos</p></div>
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between"><span className="text-muted-foreground">Gastos fijos est.</span><span>{formatARS(stats.avgMonthlyPurchasesARS)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Margen prom./unidad</span><span className="text-success">{formatARS(stats.avgMarginPerUnit)}</span></div>
        </div>
      </div>
      <div className="bg-card border border-border rounded-xl p-4 md:p-5 shadow-card">
        <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-3 flex items-center gap-1.5"><SlidersHorizontal className="w-4 h-4 text-warning" />Simulador Tipo de Cambio</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">TC Simulado:</span><span className="font-bold">${simRate[0].toLocaleString('es-AR')}</span></div>
          <Slider value={simRate} onValueChange={setSimRate} min={Math.round(currentRate * 0.7)} max={Math.round(currentRate * 1.5)} step={10} className="w-full" />
          <div className="flex justify-between text-[10px] text-muted-foreground"><span>-30%</span><span className={`font-bold ${rateChange > 0 ? 'text-destructive' : rateChange < 0 ? 'text-success' : ''}`}>{rateChange > 0 ? '+' : ''}{ratePct}%</span><span>+50%</span></div>
          <div className="space-y-1 text-xs">
            <div className="flex justify-between"><span className="text-muted-foreground">Margen prom.</span><span className={avgSimMargin > 20 ? 'text-success font-bold' : 'text-destructive font-bold'}>{avgSimMargin.toFixed(1)}%</span></div>
            {losers > 0 && <p className="text-destructive text-[10px] font-medium flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{losers} productos a pérdida con este TC</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [rawData, setRawData] = useState<{ products: any[]; sales: any[]; purchases: any[]; debts: any[]; settings: any; expenses: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterCat, setFilterCat] = useState('all');
  const [reloadKey, setReloadKey] = useState(0);
  const [liveTodaySales, setLiveTodaySales] = useState<{ total: number; count: number } | null>(null);
  const [birthdayCustomers, setBirthdayCustomers] = useState<{ name: string; phone?: string; birthday: string; daysUntil: number }[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

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

  // Birthday reminders: customers with birthday in next 7 days
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from('customers' as any).select('name, phone, birthday').not('birthday', 'is', null);
      if (!data?.length) return;
      const today = new Date();
      const upcoming: { name: string; phone?: string; birthday: string; daysUntil: number }[] = [];
      for (const c of data as any[]) {
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

  // Realtime: subscribe to today's sales updates
  useEffect(() => {
    if (!user) return;
    const today = new Date().toISOString().slice(0, 10);

    // subscribe
    const channel = supabase
      .channel('dashboard-sales-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sales' }, (payload) => {
        const row = payload.new as any;
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

  // Seed liveTodaySales from initial data load
  useEffect(() => {
    if (!rawData) return;
    const today = new Date().toISOString().slice(0, 10);
    const todaySales = rawData.sales.filter((s: any) => String(s.date).slice(0, 10) === today);
    setLiveTodaySales({
      total: todaySales.reduce((sum: number, s: any) => sum + Number(s.total_ars), 0),
      count: todaySales.length,
    });
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

    const restockSuggestions = Object.entries(productSales)
      .map(([id, data]: any) => {
        const prod = products.find((p: any) => p.id === id);
        return prod ? { name: prod.name, stock: prod.stock, soldQty: data.qty, revenue: data.revenue } : null;
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

    // ===== Top customers (this month) =====
    const custMap: Record<string, { total: number; count: number }> = {};
    monthSales.forEach((s: any) => {
      const name = s.customer_name || 'Sin nombre';
      if (!custMap[name]) custMap[name] = { total: 0, count: 0 };
      custMap[name].total += Number(s.total_ars); custMap[name].count++;
    });
    const topCustomers = Object.entries(custMap).sort((a, b) => b[1].total - a[1].total).slice(0, 5)
      .map(([name, d]) => ({ name, ...d }));

    const dueDebtsWeek = debts.filter((d: any) => d.status !== 'paid' && d.due_date && new Date(d.due_date) > new Date() && new Date(d.due_date) < new Date(Date.now() + 7 * 86400000)).length;
    const expensesRatio = monthSalesARS > 0 ? (totalMonthExpenses / monthSalesARS) * 100 : 0;
    const lowMarginCount = products.filter((p: any) => Number(p.sale_price_ars) > 0 && (Number(p.profit_per_unit_ars) / Number(p.sale_price_ars)) * 100 < marginAlertPct).length;
    const smartAlerts: { type: 'destructive' | 'warning' | 'success'; icon: any; msg: string; link?: string }[] = [];
    if (outOfStockProducts.length > 0) smartAlerts.push({ type: 'destructive', icon: AlertTriangle, msg: `${outOfStockProducts.length} productos sin stock`, link: '/productos' });
    if (lowMarginCount > 0) smartAlerts.push({ type: 'warning', icon: TrendingDown, msg: `${lowMarginCount} productos con margen < ${marginAlertPct}%`, link: '/productos' });
    if (dueDebtsWeek > 0) smartAlerts.push({ type: 'warning', icon: AlertCircle, msg: `${dueDebtsWeek} deudas vencen esta semana`, link: '/deudas' });
    if (expensesRatio > expenseRatioAlertPct && monthSalesARS > 0) smartAlerts.push({ type: 'destructive', icon: Wallet, msg: `Gastos representan ${expensesRatio.toFixed(0)}% de tus ventas (límite ${expenseRatioAlertPct}%)`, link: '/gastos' });

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
      monthSalesARS, monthGrossProfit, totalMonthExpenses, netMonthProfitARS, expensesChartData,
      salesGrowth, profitGrowth, topCustomers, smartAlerts,
      lowStockThreshold, marginAlertPct,
      // raw passthrough
      rawSales: sales, rawDebts: debts, rawExpenses: expenses, rawPurchases: allPurchases, rawSettings: settings,
    };
  }, [rawData, filterCat]);

  if (loading || !stats) return <DashboardSkeleton />;

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

  const kpiCards = [
    { label: "Hoy (en vivo)", value: formatARS(liveTodaySales?.total ?? 0), sub: `${liveTodaySales?.count ?? 0} ventas hoy`, icon: Zap, color: "text-success", live: true },
    { label: "Ganancia Bruta", value: formatARS(stats.grossProfitARS), sub: `${formatUSD(stats.grossProfitUSD)}`, icon: TrendingUp, color: stats.grossProfitARS >= 0 ? "text-success" : "text-destructive" },
    { label: "Ganancia Neta (mes)", value: formatARS(stats.netMonthProfitARS), sub: `Bruta - gastos${stats.taxEnabled ? ' - imp.' : ''}`, icon: Zap, color: stats.netMonthProfitARS >= 0 ? "text-success" : "text-destructive" },
    { label: "Gastos del Mes", value: formatARS(stats.totalMonthExpenses), sub: `${stats.expensesChartData.length} categorías`, icon: Wallet, color: "text-warning" },
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
          <button onClick={shareDailyResume} title="Compartir resumen del día por WhatsApp" className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground hover:text-success transition-colors">
            <Share2 className="w-3.5 h-3.5" />Compartir
          </button>
          <span className="text-[11px] text-muted-foreground/60 hidden sm:block">{new Date().toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
        </div>
      </div>

      {/* Consistency Alerts (auto-repair) */}
      {user && <ConsistencyAlerts
        sales={stats.rawSales} debts={stats.rawDebts} products={stats.products} settings={stats.rawSettings}
        userId={user.id}
        onRepair={() => setReloadKey(k => k + 1)}
      />}

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
                    className="ml-1 p-1.5 rounded-md bg-success/10 hover:bg-success/20 text-success transition-colors"
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

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4 mb-8 mt-5">
        {kpiCards.map((c, i) => (
          <div key={c.label} className={`group bg-card border rounded-xl p-3.5 md:p-4 shadow-card hover:border-primary/25 hover:glow-gold transition-all duration-300 ${'live' in c && c.live ? 'border-success/40 ring-1 ring-success/20' : 'border-border'}`}
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] md:text-[11px] text-muted-foreground font-medium uppercase tracking-wider">{c.label}</span>
                {'live' in c && c.live && (
                  <span className="flex items-center gap-1 text-[9px] font-bold text-success bg-success/10 rounded-full px-1.5 py-0.5 leading-none">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                    LIVE
                  </span>
                )}
              </div>
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-card border border-border rounded-xl p-5 shadow-card flex items-center justify-center">
          <GaugeChart value={stats.profitMargin} max={100} label="Margen Bruto" color="hsl(152, 58%, 42%)" />
        </div>
        <div className="bg-card border border-border rounded-xl p-5 shadow-card flex items-center justify-center">
          <GaugeChart value={stats.roi} max={200} label="ROI" color="hsl(40, 72%, 52%)" />
        </div>
        <div className="bg-card border border-border rounded-xl p-5 shadow-card">
          <h3 className="text-[11px] text-muted-foreground font-medium uppercase tracking-wider mb-4">Cobranza</h3>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Cobrado</span>
              <span className="text-success font-semibold">{formatARS(stats.paidSalesARS)}</span>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-success rounded-full transition-all duration-500" style={{ width: `${stats.totalSalesARS > 0 ? (stats.paidSalesARS / stats.totalSalesARS * 100) : 0}%` }} />
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

      {/* Margin Rankings */}
      {(stats.topMarginProducts?.length > 0 || stats.lowMarginProducts?.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6 md:mb-8">
          {stats.topMarginProducts?.length > 0 && (
            <div className="bg-card border border-border rounded-lg p-4 md:p-5 shadow-card">
              <h2 className="text-sm font-display font-semibold mb-3 text-success uppercase tracking-wider flex items-center gap-2">
                <TrendingUp className="w-4 h-4" /> Top 5 Margen Más Alto
              </h2>
              <div className="space-y-2.5">
                {stats.topMarginProducts.map((p: any, i: number) => (
                  <div key={p.name} className="flex items-center justify-between text-sm">
                    <span className="truncate mr-2 text-muted-foreground">{i + 1}. {p.name}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-success font-bold">{p.margin.toFixed(1)}%</span>
                      <span className="text-xs text-muted-foreground">{formatARS(p.profitARS)}/u</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {stats.lowMarginProducts?.length > 0 && (
            <div className="bg-card border border-warning/30 rounded-lg p-4 md:p-5 shadow-card">
              <h2 className="text-sm font-display font-semibold mb-3 text-warning uppercase tracking-wider flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Margen Bajo (&lt;{stats.marginAlertPct}%) — Subir precio
              </h2>
              <div className="space-y-2.5">
                {stats.lowMarginProducts.map((p: any, i: number) => {
                  const suggestedPrice = stats.minPriceForMargin(p.costUSD, stats.marginAlertPct);
                  return (
                    <div key={p.name} className="flex items-center justify-between text-sm">
                      <span className="truncate mr-2 text-muted-foreground">{i + 1}. {p.name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-warning font-bold">{p.margin.toFixed(1)}%</span>
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
              <div className="bg-warning/10 rounded-lg p-3">
                <p className="text-xs font-semibold text-warning mb-2 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Stock Bajo ≤{stats.lowStockThreshold} ({stats.lowStockProducts.length})</p>
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
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-muted-foreground">Ventas</span>
                <span className={`font-bold flex items-center gap-1 ${stats.salesGrowth >= 0 ? 'text-success' : 'text-destructive'}`}>
                  {stats.salesGrowth >= 0 ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />}
                  {Math.abs(stats.salesGrowth).toFixed(1)}%
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{formatARS(stats.monthSalesARS)} este mes</p>
            </div>
            <div>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-muted-foreground">Ganancia</span>
                <span className={`font-bold flex items-center gap-1 ${stats.profitGrowth >= 0 ? 'text-success' : 'text-destructive'}`}>
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
            <div className="space-y-2">
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
        </div>
      </div>

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
