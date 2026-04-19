import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getProductsDB, getSalesDB, getPurchasesDB, getDebtsDB, getSettingsDB, formatARS, formatUSD, getCategoryLabel, calculateTaxes } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, TrendingUp, Package, DollarSign, Users, FileText, Receipt } from "lucide-react";
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

function exportPDF(title: string, headers: string[], rows: string[][]) {
  const style = `<style>body{font-family:Arial,sans-serif;margin:20px}h1{color:#333;font-size:18px}table{border-collapse:collapse;width:100%;margin-top:10px}th,td{border:1px solid #ddd;padding:6px 8px;text-size:11px;text-align:left}th{background:#f4f4f4;font-weight:600}tr:nth-child(even){background:#fafafa}.footer{margin-top:20px;font-size:10px;color:#999}</style>`;
  const tableHtml = `<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${style}</head><body><h1>${title} - EXENTRY IMPORTS</h1><p>Generado: ${new Date().toLocaleDateString('es-AR')}</p>${tableHtml}<div class="footer">EXENTRY IMPORTS · Sistema de Gestión</div></body></html>`;
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); w.print(); }
}

export default function ReportsPage() {
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);

  const [period, setPeriod] = useState<'month' | 'quarter' | 'year'>('month');
  const [tab, setTab] = useState<'overview' | 'income'>('overview');

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [products, sales, purchases, debts, settings, expenses] = await Promise.all([
        getProductsDB(user.id), getSalesDB(user.id), getPurchasesDB(user.id), getDebtsDB(user.id), getSettingsDB(user.id), getExpensesDB(user.id),
      ]);
      setData({ products, sales, purchases, debts, settings, expenses });
    })();
  }, [user]);

  if (!data) return <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  const { products, sales, purchases, debts, settings, expenses } = data;
  const totalSalesARS = sales.reduce((s: number, v: any) => s + Number(v.total_ars), 0);
  const grossProfitARS = sales.reduce((s: number, v: any) => s + Number(v.profit_ars), 0);
  const grossProfitUSD = sales.reduce((s: number, v: any) => s + Number(v.profit_usd), 0);
  const totalPurchasesUSD = purchases.reduce((s: number, c: any) => s + Number(c.total_usd), 0);
  const totalPurchasesARS = purchases.reduce((s: number, c: any) => s + Number(c.total_ars), 0);
  const totalDebtsARS = debts.filter((d: any) => d.status !== 'paid').reduce((s: number, d: any) => s + Number(d.remaining_ars), 0);
  const inventoryValueUSD = products.reduce((s: number, p: any) => s + (Number(p.total_cost_usd) * p.stock), 0);
  const totalStock = products.reduce((s: number, p: any) => s + p.stock, 0);

  const taxes = calculateTaxes(grossProfitARS, settings);
  const roi = totalPurchasesUSD > 0 ? ((grossProfitUSD / totalPurchasesUSD) * 100) : 0;

  const handleExportProducts = () => exportCSV('productos_exentry.csv',
    ['Nombre','Marca','Categoría','Costo USD','Costo+Pasero USD','Precio ARS','Precio Oferta ARS','Ganancia ARS','Stock'],
    products.map((p: any) => [p.name, p.brand, getCategoryLabel(p.category), p.cost_usd, p.total_cost_usd, p.sale_price_ars, p.discount_price_ars || '', p.profit_per_unit_ars, p.stock])
  );
  const handleExportSales = () => exportCSV('ventas_exentry.csv',
    ['Fecha','Producto','Cliente','Cantidad','Precio Unit.','Descuento','Total ARS','Ganancia ARS','Ganancia USD','Pagado'],
    sales.map((s: any) => [s.date, s.product_name, s.customer_name || '', s.quantity, s.unit_price_ars, s.discount_applied ? 'Sí' : 'No', s.total_ars, s.profit_ars, s.profit_usd, s.paid ? 'Sí' : 'No'])
  );
  const handleExportPurchases = () => exportCSV('compras_exentry.csv',
    ['Fecha','Producto','Proveedor','Cantidad','Costo Unit. USD','Pasero USD','Total USD','Total ARS','TC'],
    purchases.map((p: any) => [p.date, p.product_name, p.supplier || '', p.quantity, p.unit_cost_usd, p.customs_fee, p.total_usd, p.total_ars, p.exchange_rate])
  );

  const handlePDFSales = () => exportPDF('Reporte de Ventas',
    ['Fecha','Producto','Cliente','Cant.','Total ARS','Ganancia','Estado'],
    sales.map((s: any) => [new Date(s.date).toLocaleDateString('es-AR'), s.product_name, s.customer_name || '—', s.quantity, formatARS(Number(s.total_ars)), formatARS(Number(s.profit_ars)), s.paid ? 'Pagado' : 'Debe'])
  );
  const handlePDFPurchases = () => exportPDF('Reporte de Compras',
    ['Fecha','Producto','Cant.','Unit. USD','Pasero','Total USD','Total ARS'],
    purchases.map((p: any) => [new Date(p.date).toLocaleDateString('es-AR'), p.product_name, p.quantity, formatUSD(Number(p.unit_cost_usd)), formatUSD(Number(p.customs_fee)), formatUSD(Number(p.total_usd)), formatARS(Number(p.total_ars))])
  );

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold">Reportes & Análisis</h1>
          <p className="text-muted-foreground text-sm">Métricas avanzadas y exportación</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleExportProducts}><FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />Productos CSV</Button>
          <Button variant="outline" size="sm" onClick={handleExportSales}><FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />Ventas CSV</Button>
          <Button variant="outline" size="sm" onClick={handleExportPurchases}><FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />Compras CSV</Button>
          <Button variant="outline" size="sm" onClick={handlePDFSales}><FileText className="w-3.5 h-3.5 mr-1.5" />Ventas PDF</Button>
          <Button variant="outline" size="sm" onClick={handlePDFPurchases}><FileText className="w-3.5 h-3.5 mr-1.5" />Compras PDF</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6 md:mb-8">
        <div className="bg-card border border-border rounded-lg p-3 md:p-4">
          <div className="flex items-center gap-2 mb-2"><TrendingUp className="w-4 h-4 text-success" /><span className="text-[10px] md:text-xs text-muted-foreground uppercase">Ganancia Bruta</span></div>
          <p className="text-lg md:text-xl font-bold text-success">{formatARS(grossProfitARS)}</p>
          <p className="text-xs text-muted-foreground">{formatUSD(grossProfitUSD)}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 md:p-4">
          <div className="flex items-center gap-2 mb-2"><DollarSign className="w-4 h-4 text-primary" /><span className="text-[10px] md:text-xs text-muted-foreground uppercase">Facturado</span></div>
          <p className="text-lg md:text-xl font-bold">{formatARS(totalSalesARS)}</p>
          <p className="text-xs text-muted-foreground">{sales.length} ventas</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 md:p-4">
          <div className="flex items-center gap-2 mb-2"><Package className="w-4 h-4 text-warning" /><span className="text-[10px] md:text-xs text-muted-foreground uppercase">Inventario</span></div>
          <p className="text-lg md:text-xl font-bold">{totalStock} uds</p>
          <p className="text-xs text-muted-foreground">{formatUSD(inventoryValueUSD)}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 md:p-4">
          <div className="flex items-center gap-2 mb-2"><Users className="w-4 h-4 text-destructive" /><span className="text-[10px] md:text-xs text-muted-foreground uppercase">Deudas</span></div>
          <p className="text-lg md:text-xl font-bold text-destructive">{formatARS(totalDebtsARS)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <div className="bg-card border border-border rounded-lg p-4 md:p-5">
          <h2 className="text-sm font-display font-semibold mb-4 text-muted-foreground uppercase tracking-wider">Métricas de Rendimiento</h2>
          <div className="space-y-3">
            {[
              ['Margen Bruto', totalSalesARS > 0 ? `${((grossProfitARS / totalSalesARS) * 100).toFixed(1)}%` : '0%', 'text-success'],
              ['ROI', `${roi.toFixed(1)}%`, 'text-primary'],
              ['Inversión Total', `${formatUSD(totalPurchasesUSD)} (${formatARS(totalPurchasesARS)})`, 'text-warning'],
              ['Ticket Promedio', formatARS(sales.length > 0 ? totalSalesARS / sales.length : 0), ''],
              ['Ganancia Promedio/Venta', formatARS(sales.length > 0 ? grossProfitARS / sales.length : 0), 'text-success'],
              ['TC Actual', `$${Number(settings.exchange_rate).toLocaleString('es-AR')}`, ''],
            ].map(([label, value, color]) => (
              <div key={label as string} className="flex justify-between items-center py-2 border-b border-border">
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className={`font-bold text-sm ${color}`}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {settings.tax_enabled && (
          <div className="bg-card border border-border rounded-lg p-4 md:p-5">
            <h2 className="text-sm font-display font-semibold mb-4 text-muted-foreground uppercase tracking-wider flex items-center gap-2">
              <Receipt className="w-4 h-4" />Impuestos (Estimación)
            </h2>
            <div className="space-y-3">
              {[
                ['Ganancia Bruta', formatARS(grossProfitARS), 'text-success'],
                [`IVA (${settings.tax_iva_percent}%)`, `-${formatARS(taxes.iva)}`, 'text-destructive'],
                [`IIBB (${settings.tax_iibb_percent}%)`, `-${formatARS(taxes.iibb)}`, 'text-destructive'],
                ...(Number(settings.tax_monotributo_monthly) > 0 ? [['Monotributo/mes', formatARS(Number(settings.tax_monotributo_monthly)), 'text-warning']] : []),
                ['Total Impuestos', `-${formatARS(taxes.totalTax)}`, 'text-destructive'],
                ['Ganancia Neta (post-imp)', formatARS(taxes.netProfit), taxes.netProfit > 0 ? 'text-success' : 'text-destructive'],
              ].map(([label, value, color]) => (
                <div key={label as string} className="flex justify-between items-center py-2 border-b border-border">
                  <span className="text-sm text-muted-foreground">{label}</span>
                  <span className={`font-bold text-sm ${color}`}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!settings.tax_enabled && (
          <div className="bg-card border border-border rounded-lg p-4 md:p-5 flex items-center justify-center">
            <div className="text-center">
              <Receipt className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">Módulo de impuestos desactivado</p>
              <p className="text-xs text-muted-foreground mt-1">Activalo en Ajustes para ver estimaciones fiscales</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
