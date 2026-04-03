import { useState } from "react";
import { getProducts, getSales, getPurchases, getDebts, formatARS, formatUSD, getSettings, getCategoryLabel, getGenderLabel } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, FileSpreadsheet, TrendingUp, Package, DollarSign, Users } from "lucide-react";
import { toast } from "sonner";

function exportCSV(filename: string, headers: string[], rows: string[][]) {
  const bom = '\uFEFF';
  const csv = bom + [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  toast.success(`${filename} exportado`);
}

export default function ReportsPage() {
  const settings = getSettings();
  const products = getProducts();
  const sales = getSales();
  const purchases = getPurchases();
  const debts = getDebts();

  const totalSalesARS = sales.reduce((s, v) => s + v.totalARS, 0);
  const totalProfitARS = sales.reduce((s, v) => s + v.profitARS, 0);
  const totalProfitUSD = sales.reduce((s, v) => s + v.profitUSD, 0);
  const totalPurchasesUSD = purchases.reduce((s, c) => s + c.totalUSD, 0);
  const totalDebtsARS = debts.filter(d => d.status !== 'paid').reduce((s, d) => s + d.remainingARS, 0);
  const inventoryValueUSD = products.reduce((s, p) => s + (p.totalCostUSD * p.stock), 0);
  const totalStock = products.reduce((s, p) => s + p.stock, 0);
  const inStockProducts = products.filter(p => p.stock > 0).length;

  // Top sellers
  const productSalesMap: Record<string, { name: string; qty: number; revenue: number; profit: number }> = {};
  sales.forEach(s => {
    if (!productSalesMap[s.productId]) productSalesMap[s.productId] = { name: s.productName, qty: 0, revenue: 0, profit: 0 };
    productSalesMap[s.productId].qty += s.quantity;
    productSalesMap[s.productId].revenue += s.totalARS;
    productSalesMap[s.productId].profit += s.profitARS;
  });
  const topSellers = Object.values(productSalesMap).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

  // Customer analysis
  const customerMap: Record<string, { name: string; total: number; count: number; debt: number }> = {};
  sales.forEach(s => {
    const name = s.customerName || 'Anónimo';
    if (!customerMap[name]) customerMap[name] = { name, total: 0, count: 0, debt: 0 };
    customerMap[name].total += s.totalARS;
    customerMap[name].count += s.quantity;
  });
  debts.filter(d => d.status !== 'paid').forEach(d => {
    if (!customerMap[d.customerName]) customerMap[d.customerName] = { name: d.customerName, total: 0, count: 0, debt: 0 };
    customerMap[d.customerName].debt += d.remainingARS;
  });
  const topCustomers = Object.values(customerMap).sort((a, b) => b.total - a.total).slice(0, 10);

  const handleExportProducts = () => {
    exportCSV('productos_exentry.csv',
      ['Nombre', 'Marca', 'Categoría', 'Género', 'Costo USD', 'Costo+Pasero USD', 'Precio Venta ARS', 'Precio Desc ARS', 'Ganancia/u ARS', 'Ganancia/u USD', 'Stock'],
      products.map(p => [p.name, p.brand, getCategoryLabel(p.category), getGenderLabel(p.gender), p.costUSD.toFixed(2), p.totalCostUSD.toFixed(2), p.salePriceARS.toString(), (p.discountPriceARS || 0).toString(), p.profitPerUnitARS.toFixed(2), p.profitPerUnitUSD.toFixed(2), p.stock.toString()])
    );
  };

  const handleExportSales = () => {
    exportCSV('ventas_exentry.csv',
      ['Fecha', 'Producto', 'Cliente', 'Cantidad', 'Precio Unit', 'Total ARS', 'Ganancia ARS', 'Ganancia USD', 'Descuento', 'Pagado'],
      sales.map(s => [s.date, s.productName, s.customerName || '', s.quantity.toString(), s.unitPriceARS.toString(), s.totalARS.toString(), s.profitARS.toFixed(2), s.profitUSD.toFixed(2), s.discountApplied ? 'Sí' : 'No', s.paid ? 'Sí' : 'No'])
    );
  };

  const handleExportPurchases = () => {
    exportCSV('compras_exentry.csv',
      ['Fecha', 'Producto', 'Cantidad', 'Costo Unit USD', 'Pasero USD', 'Total USD', 'TC', 'Total ARS', 'Proveedor'],
      purchases.map(p => [p.date, p.productName, p.quantity.toString(), p.unitCostUSD.toFixed(2), p.customsFee.toFixed(2), p.totalUSD.toFixed(2), p.exchangeRate.toString(), p.totalARS.toFixed(2), p.supplier || ''])
    );
  };

  const handleExportDebts = () => {
    exportCSV('deudas_exentry.csv',
      ['Fecha', 'Cliente', 'Descripción', 'Total ARS', 'Pagado ARS', 'Resta ARS', 'Estado'],
      debts.map(d => [d.date, d.customerName, d.description, d.amountARS.toString(), d.paidARS.toString(), d.remainingARS.toString(), d.status])
    );
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold">Reportes & Análisis</h1>
          <p className="text-muted-foreground">Métricas avanzadas y exportación de datos</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleExportProducts}><FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />Productos</Button>
          <Button variant="outline" size="sm" onClick={handleExportSales}><FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />Ventas</Button>
          <Button variant="outline" size="sm" onClick={handleExportPurchases}><FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />Compras</Button>
          <Button variant="outline" size="sm" onClick={handleExportDebts}><FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />Deudas</Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-success" />
            <span className="text-xs text-muted-foreground uppercase">Ganancia Total</span>
          </div>
          <p className="text-xl font-bold text-success">{formatARS(totalProfitARS)}</p>
          <p className="text-xs text-muted-foreground">{formatUSD(totalProfitUSD)}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-primary" />
            <span className="text-xs text-muted-foreground uppercase">Facturado</span>
          </div>
          <p className="text-xl font-bold">{formatARS(totalSalesARS)}</p>
          <p className="text-xs text-muted-foreground">{sales.length} ventas</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Package className="w-4 h-4 text-warning" />
            <span className="text-xs text-muted-foreground uppercase">Inventario</span>
          </div>
          <p className="text-xl font-bold">{totalStock} uds</p>
          <p className="text-xs text-muted-foreground">{formatUSD(inventoryValueUSD)} invertidos</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-destructive" />
            <span className="text-xs text-muted-foreground uppercase">Deudas</span>
          </div>
          <p className="text-xl font-bold text-destructive">{formatARS(totalDebtsARS)}</p>
          <p className="text-xs text-muted-foreground">{debts.filter(d => d.status !== 'paid').length} pendientes</p>
        </div>
      </div>

      {/* ROI and Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-8">
        <div className="bg-card border border-border rounded-lg p-5">
          <h2 className="text-sm font-display font-semibold mb-4 text-muted-foreground uppercase tracking-wider">Métricas de Rendimiento</h2>
          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-border">
              <span className="text-sm text-muted-foreground">Margen de Ganancia Bruta</span>
              <span className="font-bold text-success">{totalSalesARS > 0 ? ((totalProfitARS / totalSalesARS) * 100).toFixed(1) : '0'}%</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border">
              <span className="text-sm text-muted-foreground">ROI (Retorno sobre Inversión)</span>
              <span className="font-bold text-primary">{totalPurchasesUSD > 0 ? ((totalProfitUSD / totalPurchasesUSD) * 100).toFixed(1) : '0'}%</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border">
              <span className="text-sm text-muted-foreground">Ticket Promedio</span>
              <span className="font-bold">{formatARS(sales.length > 0 ? totalSalesARS / sales.length : 0)}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border">
              <span className="text-sm text-muted-foreground">Ganancia Promedio/Venta</span>
              <span className="font-bold text-success">{formatARS(sales.length > 0 ? totalProfitARS / sales.length : 0)}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border">
              <span className="text-sm text-muted-foreground">Productos en Stock</span>
              <span className="font-bold">{inStockProducts} de {products.length}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-border">
              <span className="text-sm text-muted-foreground">Total Invertido (USD)</span>
              <span className="font-bold text-warning">{formatUSD(totalPurchasesUSD)}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-sm text-muted-foreground">Tipo de Cambio Actual</span>
              <span className="font-bold">${settings.exchangeRate.toLocaleString('es-AR')}</span>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-5">
          <h2 className="text-sm font-display font-semibold mb-4 text-muted-foreground uppercase tracking-wider">Top Clientes</h2>
          {topCustomers.length > 0 ? (
            <div className="space-y-2">
              {topCustomers.map((c, i) => (
                <div key={c.name} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-5">{i + 1}.</span>
                    <span className="text-sm font-medium truncate max-w-[140px]">{c.name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span>{formatARS(c.total)}</span>
                    {c.debt > 0 && <span className="text-destructive text-xs">Debe: {formatARS(c.debt)}</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm py-8 text-center">Sin datos de clientes</p>
          )}
        </div>
      </div>

      {/* Top Products */}
      <div className="bg-card border border-border rounded-lg p-5">
        <h2 className="text-sm font-display font-semibold mb-4 text-muted-foreground uppercase tracking-wider">Ranking de Productos (por Ganancia)</h2>
        {topSellers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left p-2 font-medium">#</th>
                  <th className="text-left p-2 font-medium">Producto</th>
                  <th className="text-right p-2 font-medium">Uds Vendidas</th>
                  <th className="text-right p-2 font-medium">Facturado</th>
                  <th className="text-right p-2 font-medium">Ganancia</th>
                  <th className="text-right p-2 font-medium">Margen</th>
                </tr>
              </thead>
              <tbody>
                {topSellers.map((p, i) => (
                  <tr key={p.name} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="p-2 text-muted-foreground">{i + 1}</td>
                    <td className="p-2 font-medium">{p.name}</td>
                    <td className="p-2 text-right">{p.qty}</td>
                    <td className="p-2 text-right">{formatARS(p.revenue)}</td>
                    <td className="p-2 text-right text-success">{formatARS(p.profit)}</td>
                    <td className="p-2 text-right">{p.revenue > 0 ? ((p.profit / p.revenue) * 100).toFixed(1) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm py-8 text-center">Sin ventas registradas</p>
        )}
      </div>
    </div>
  );
}
