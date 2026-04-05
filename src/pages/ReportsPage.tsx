import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getProductsDB, getSalesDB, getPurchasesDB, getDebtsDB, getSettingsDB, formatARS, formatUSD, getCategoryLabel, getGenderLabel } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, TrendingUp, Package, DollarSign, Users } from "lucide-react";
import { toast } from "sonner";

function exportCSV(filename: string, headers: string[], rows: string[][]) {
  const bom = '\uFEFF';
  const csv = bom + [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  toast.success(`${filename} exportado`);
}

export default function ReportsPage() {
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [products, sales, purchases, debts, settings] = await Promise.all([
        getProductsDB(user.id), getSalesDB(user.id), getPurchasesDB(user.id), getDebtsDB(user.id), getSettingsDB(user.id),
      ]);
      setData({ products, sales, purchases, debts, settings });
    })();
  }, [user]);

  if (!data) return <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  const { products, sales, purchases, debts, settings } = data;
  const totalSalesARS = sales.reduce((s: number, v: any) => s + Number(v.total_ars), 0);
  const totalProfitARS = sales.reduce((s: number, v: any) => s + Number(v.profit_ars), 0);
  const totalProfitUSD = sales.reduce((s: number, v: any) => s + Number(v.profit_usd), 0);
  const totalPurchasesUSD = purchases.reduce((s: number, c: any) => s + Number(c.total_usd), 0);
  const totalDebtsARS = debts.filter((d: any) => d.status !== 'paid').reduce((s: number, d: any) => s + Number(d.remaining_ars), 0);
  const inventoryValueUSD = products.reduce((s: number, p: any) => s + (Number(p.total_cost_usd) * p.stock), 0);
  const totalStock = products.reduce((s: number, p: any) => s + p.stock, 0);

  const handleExportProducts = () => exportCSV('productos_exentry.csv',
    ['Nombre','Marca','Categoría','Costo USD','Precio ARS','Ganancia ARS','Stock'],
    products.map((p: any) => [p.name, p.brand, getCategoryLabel(p.category), p.cost_usd, p.sale_price_ars, p.profit_per_unit_ars, p.stock])
  );
  const handleExportSales = () => exportCSV('ventas_exentry.csv',
    ['Fecha','Producto','Cliente','Cantidad','Total ARS','Ganancia ARS','Pagado'],
    sales.map((s: any) => [s.date, s.product_name, s.customer_name || '', s.quantity, s.total_ars, s.profit_ars, s.paid ? 'Sí' : 'No'])
  );

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold">Reportes & Análisis</h1>
          <p className="text-muted-foreground">Métricas avanzadas y exportación</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExportProducts}><FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />Productos</Button>
          <Button variant="outline" size="sm" onClick={handleExportSales}><FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />Ventas</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2"><TrendingUp className="w-4 h-4 text-success" /><span className="text-xs text-muted-foreground uppercase">Ganancia Total</span></div>
          <p className="text-xl font-bold text-success">{formatARS(totalProfitARS)}</p>
          <p className="text-xs text-muted-foreground">{formatUSD(totalProfitUSD)}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2"><DollarSign className="w-4 h-4 text-primary" /><span className="text-xs text-muted-foreground uppercase">Facturado</span></div>
          <p className="text-xl font-bold">{formatARS(totalSalesARS)}</p>
          <p className="text-xs text-muted-foreground">{sales.length} ventas</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2"><Package className="w-4 h-4 text-warning" /><span className="text-xs text-muted-foreground uppercase">Inventario</span></div>
          <p className="text-xl font-bold">{totalStock} uds</p>
          <p className="text-xs text-muted-foreground">{formatUSD(inventoryValueUSD)}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2"><Users className="w-4 h-4 text-destructive" /><span className="text-xs text-muted-foreground uppercase">Deudas</span></div>
          <p className="text-xl font-bold text-destructive">{formatARS(totalDebtsARS)}</p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-5">
        <h2 className="text-sm font-display font-semibold mb-4 text-muted-foreground uppercase tracking-wider">Métricas de Rendimiento</h2>
        <div className="space-y-3">
          {[
            ['Margen de Ganancia Bruta', totalSalesARS > 0 ? `${((totalProfitARS / totalSalesARS) * 100).toFixed(1)}%` : '0%', 'text-success'],
            ['ROI', totalPurchasesUSD > 0 ? `${((totalProfitUSD / totalPurchasesUSD) * 100).toFixed(1)}%` : '0%', 'text-primary'],
            ['Ticket Promedio', formatARS(sales.length > 0 ? totalSalesARS / sales.length : 0), ''],
            ['Ganancia Promedio/Venta', formatARS(sales.length > 0 ? totalProfitARS / sales.length : 0), 'text-success'],
            ['TC Actual', `$${Number(settings.exchange_rate).toLocaleString('es-AR')}`, ''],
          ].map(([label, value, color]) => (
            <div key={label as string} className="flex justify-between items-center py-2 border-b border-border">
              <span className="text-sm text-muted-foreground">{label}</span>
              <span className={`font-bold ${color}`}>{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
