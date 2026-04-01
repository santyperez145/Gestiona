import { useEffect, useState } from "react";
import { getProducts, getSales, getPurchases, getDebts, formatARS, formatUSD } from "@/lib/store";
import { Package, TrendingUp, TrendingDown, AlertCircle, DollarSign } from "lucide-react";

export default function Dashboard() {
  const [stats, setStats] = useState({
    totalProducts: 0,
    totalStock: 0,
    totalSalesARS: 0,
    totalPurchasesUSD: 0,
    totalDebtsARS: 0,
    lowStock: 0,
  });

  useEffect(() => {
    const products = getProducts();
    const sales = getSales();
    const purchases = getPurchases();
    const debts = getDebts().filter(d => d.status !== 'paid');
    setStats({
      totalProducts: products.length,
      totalStock: products.reduce((s, p) => s + p.stock, 0),
      totalSalesARS: sales.reduce((s, v) => s + v.totalARS, 0),
      totalPurchasesUSD: purchases.reduce((s, c) => s + c.totalUSD, 0),
      totalDebtsARS: debts.reduce((s, d) => s + d.remainingARS, 0),
      lowStock: products.filter(p => p.stock <= 3).length,
    });
  }, []);

  const cards = [
    { label: "Productos", value: stats.totalProducts, sub: `${stats.totalStock} unidades en stock`, icon: Package, color: "text-primary" },
    { label: "Ventas Totales", value: formatARS(stats.totalSalesARS), sub: "En pesos argentinos", icon: TrendingUp, color: "text-success" },
    { label: "Compras Totales", value: formatUSD(stats.totalPurchasesUSD), sub: "En dólares + 15% pasero", icon: TrendingDown, color: "text-warning" },
    { label: "Deudas Pendientes", value: formatARS(stats.totalDebtsARS), sub: "Por cobrar", icon: AlertCircle, color: "text-destructive" },
    { label: "Stock Bajo", value: stats.lowStock, sub: "Productos con ≤3 unidades", icon: DollarSign, color: "text-primary" },
  ];

  return (
    <div>
      <h1 className="text-3xl font-display font-bold mb-1">Dashboard</h1>
      <p className="text-muted-foreground mb-8">Resumen general de tu negocio</p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="bg-card border border-border rounded-lg p-5 shadow-card">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground">{c.label}</span>
              <c.icon className={`w-5 h-5 ${c.color}`} />
            </div>
            <p className="text-2xl font-bold font-display">{c.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{c.sub}</p>
          </div>
        ))}
      </div>

      {/* Recent sales */}
      <div className="mt-8">
        <h2 className="text-xl font-display font-semibold mb-4">Últimas Ventas</h2>
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <RecentSalesTable />
        </div>
      </div>
    </div>
  );
}

function RecentSalesTable() {
  const sales = getSales().sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5);
  if (!sales.length) return <p className="p-6 text-muted-foreground text-sm">No hay ventas registradas aún.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border text-muted-foreground">
          <th className="text-left p-3 font-medium">Producto</th>
          <th className="text-left p-3 font-medium">Cliente</th>
          <th className="text-right p-3 font-medium">Cantidad</th>
          <th className="text-right p-3 font-medium">Total</th>
          <th className="text-center p-3 font-medium">Estado</th>
        </tr>
      </thead>
      <tbody>
        {sales.map(s => (
          <tr key={s.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
            <td className="p-3">{s.productName}</td>
            <td className="p-3">{s.customerName || '—'}</td>
            <td className="p-3 text-right">{s.quantity}</td>
            <td className="p-3 text-right font-medium">{formatARS(s.totalARS)}</td>
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
