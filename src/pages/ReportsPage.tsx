import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { getProductsDB, getSalesDB, getPurchasesDB, getDebtsDB, getSettingsDB, getExpensesDB, formatARS, formatUSD, getCategoryLabel, calculateTaxes } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileSpreadsheet, TrendingUp, Package, DollarSign, Users, FileText, Receipt, FileDown, ArrowUpDown, Boxes } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

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
  const style = `<style>body{font-family:Arial,sans-serif;margin:20px}h1{color:#333;font-size:18px}table{border-collapse:collapse;width:100%;margin-top:10px}th,td{border:1px solid #ddd;padding:6px 8px;font-size:11px;text-align:left}th{background:#f4f4f4;font-weight:600}tr:nth-child(even){background:#fafafa}.footer{margin-top:20px;font-size:10px;color:#999}</style>`;
  const tableHtml = `<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${style}</head><body><h1>${title}</h1><p>Generado: ${new Date().toLocaleDateString('es-AR')}</p>${tableHtml}<div class="footer">Sistema de Gestión</div></body></html>`;
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); w.print(); }
}

type PeriodKey = 'current_month' | 'last_month' | 'quarter' | 'year' | 'all';

function getPeriodRange(key: PeriodKey): { from: Date; to: Date; label: string } {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  if (key === 'current_month') return { from: new Date(y, m, 1), to: new Date(y, m + 1, 0, 23, 59, 59), label: now.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }) };
  if (key === 'last_month') {
    const from = new Date(y, m - 1, 1); const to = new Date(y, m, 0, 23, 59, 59);
    return { from, to, label: from.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }) };
  }
  if (key === 'quarter') {
    const q = Math.floor(m / 3); return { from: new Date(y, q * 3, 1), to: new Date(y, q * 3 + 3, 0, 23, 59, 59), label: `Q${q + 1} ${y}` };
  }
  if (key === 'year') return { from: new Date(y, 0, 1), to: new Date(y, 11, 31, 23, 59, 59), label: String(y) };
  return { from: new Date(2000, 0, 1), to: new Date(2999, 11, 31), label: 'Histórico' };
}

export default function ReportsPage() {
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [period, setPeriod] = useState<PeriodKey>('current_month');

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [products, sales, purchases, debts, settings, expenses] = await Promise.all([
        getProductsDB(user.id), getSalesDB(user.id), getPurchasesDB(user.id), getDebtsDB(user.id), getSettingsDB(user.id), getExpensesDB(user.id),
      ]);
      setData({ products, sales, purchases, debts, settings, expenses });
    })();
  }, [user]);

  const filtered = useMemo(() => {
    if (!data) return null;
    const { from, to, label } = getPeriodRange(period);
    const inRange = (d: string) => { const x = new Date(d); return x >= from && x <= to; };
    return {
      label,
      sales: data.sales.filter((s: any) => inRange(s.date)),
      expenses: data.expenses.filter((e: any) => inRange(e.date)),
      purchases: data.purchases.filter((p: any) => inRange(p.date)),
    };
  }, [data, period]);

  if (!data || !filtered) return <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

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

  // Income Statement (period-filtered)
  const periodRevenue = filtered.sales.reduce((s: number, v: any) => s + Number(v.total_ars), 0);
  const periodGrossProfit = filtered.sales.reduce((s: number, v: any) => s + Number(v.profit_ars), 0);
  const periodCOGS = periodRevenue - periodGrossProfit;
  const expensesByCategory: Record<string, number> = {};
  filtered.expenses.forEach((e: any) => {
    const k = e.category || 'otros';
    expensesByCategory[k] = (expensesByCategory[k] || 0) + Number(e.amount_ars);
  });
  const totalOpex = Object.values(expensesByCategory).reduce((a, b) => a + b, 0);
  const opBeforeTax = periodGrossProfit - totalOpex;
  const periodTaxes = settings.tax_enabled ? calculateTaxes(periodGrossProfit, settings) : { iva: 0, iibb: 0, totalTax: 0, netProfit: opBeforeTax };
  const totalTaxImpact = settings.tax_enabled ? periodTaxes.totalTax : 0;
  const netIncome = opBeforeTax - totalTaxImpact;
  const grossMarginPct = periodRevenue > 0 ? (periodGrossProfit / periodRevenue) * 100 : 0;
  const netMarginPct = periodRevenue > 0 ? (netIncome / periodRevenue) * 100 : 0;

  const handleExportProducts = () => exportCSV('productos.csv',
    ['Nombre','Marca','Categoría','Costo USD','Costo+Pasero USD','Precio ARS','Precio Oferta ARS','Ganancia ARS','Stock'],
    products.map((p: any) => [p.name, p.brand, getCategoryLabel(p.category), p.cost_usd, p.total_cost_usd, p.sale_price_ars, p.discount_price_ars || '', p.profit_per_unit_ars, p.stock])
  );
  const handleExportSales = () => exportCSV('ventas.csv',
    ['Fecha','Producto','Cliente','Cantidad','Precio Unit.','Descuento','Total ARS','Ganancia ARS','Ganancia USD','Pagado'],
    sales.map((s: any) => [s.date, s.product_name, s.customer_name || '', s.quantity, s.unit_price_ars, s.discount_applied ? 'Sí' : 'No', s.total_ars, s.profit_ars, s.profit_usd, s.paid ? 'Sí' : 'No'])
  );
  const handleExportPurchases = () => exportCSV('compras.csv',
    ['Fecha','Producto','Proveedor','Cantidad','Costo Unit. USD','Pasero USD','Total USD','Total ARS','TC'],
    purchases.map((p: any) => [p.date, p.product_name, p.supplier || '', p.quantity, p.unit_cost_usd, p.customs_fee, p.total_usd, p.total_ars, p.exchange_rate])
  );

  const handlePDFSales = () => exportPDF('Reporte de Ventas',
    ['Fecha','Producto','Cliente','Cant.','Total ARS','Ganancia','Estado'],
    sales.map((s: any) => [new Date(s.date).toLocaleDateString('es-AR'), s.product_name, s.customer_name || '—', s.quantity, formatARS(Number(s.total_ars)), formatARS(Number(s.profit_ars)), s.paid ? 'Pagado' : 'Debe'])
  );
  const handlePDFPurchases = () => exportPDF('Reporte de Compras',
    ['Fecha','Producto','Cant.','Unit. USD','Pasero','Total USD','Total ARS'],
    purchases.map((p: any) => [new Date(p.date).toLocaleDateString('es-AR'), p.product_name, p.quantity, formatUSD(Number(p.unit_cost_usd)), formatUSD(Number(p.total_usd) - Number(p.unit_cost_usd) * p.quantity), formatUSD(Number(p.total_usd)), formatARS(Number(p.total_ars))])
  );

  // ===== PDF Estado de Resultados profesional =====
  const handleIncomeStatementPDF = async () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const businessName = (settings.business_name || 'Negocio').toUpperCase();

    // Header band
    doc.setFillColor(26, 26, 46);
    doc.rect(0, 0, pageWidth, 70, 'F');
    doc.setTextColor(212, 168, 67);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(businessName, 40, 35);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.text('Estado de Resultados', 40, 55);

    // Logo (best-effort, ignore on failure)
    if (settings.logo_url) {
      try {
        const res = await fetch(settings.logo_url);
        const blob = await res.blob();
        const dataUrl: string = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result as string); r.readAsDataURL(blob); });
        doc.addImage(dataUrl, 'PNG', pageWidth - 80, 15, 40, 40);
      } catch { /* ignore */ }
    }

    // Period box
    doc.setTextColor(50, 50, 50);
    doc.setFontSize(10);
    doc.text(`Período: ${filtered.label}`, 40, 95);
    doc.text(`Generado: ${new Date().toLocaleString('es-AR')}`, 40, 110);

    const fmt = (n: number) => formatARS(Math.round(n));
    const rows: any[] = [
      [{ content: 'Ingresos por ventas', styles: { fontStyle: 'bold' } }, { content: fmt(periodRevenue), styles: { halign: 'right', fontStyle: 'bold' } }],
      ['(-) Costo de mercadería vendida (COGS)', { content: '-' + fmt(periodCOGS), styles: { halign: 'right', textColor: [180, 60, 60] } }],
      [{ content: '= Ganancia bruta', styles: { fontStyle: 'bold', fillColor: [240, 240, 240] } }, { content: fmt(periodGrossProfit) + `  (${grossMarginPct.toFixed(1)}%)`, styles: { halign: 'right', fontStyle: 'bold', fillColor: [240, 240, 240] } }],
      [{ content: '(-) Gastos operativos', styles: { fontStyle: 'bold' } }, { content: '-' + fmt(totalOpex), styles: { halign: 'right', textColor: [180, 60, 60], fontStyle: 'bold' } }],
      ...Object.entries(expensesByCategory).map(([cat, val]) => [
        { content: '    · ' + getCategoryLabel(cat), styles: { textColor: [110, 110, 110], fontSize: 9 } },
        { content: '-' + fmt(val), styles: { halign: 'right', textColor: [110, 110, 110], fontSize: 9 } },
      ]),
      [{ content: '= Resultado operativo', styles: { fontStyle: 'bold', fillColor: [245, 245, 245] } }, { content: fmt(opBeforeTax), styles: { halign: 'right', fontStyle: 'bold', fillColor: [245, 245, 245] } }],
    ];

    if (settings.tax_enabled) {
      rows.push(
        [`(-) IVA (${settings.tax_iva_percent}%)`, { content: '-' + fmt(periodTaxes.iva), styles: { halign: 'right', textColor: [180, 60, 60] } }],
        [`(-) IIBB (${settings.tax_iibb_percent}%)`, { content: '-' + fmt(periodTaxes.iibb), styles: { halign: 'right', textColor: [180, 60, 60] } }],
      );
    }

    rows.push([
      { content: '= GANANCIA NETA', styles: { fontStyle: 'bold', fillColor: [212, 168, 67], textColor: [26, 26, 46], fontSize: 12 } },
      { content: fmt(netIncome) + `  (${netMarginPct.toFixed(1)}%)`, styles: { halign: 'right', fontStyle: 'bold', fillColor: [212, 168, 67], textColor: [26, 26, 46], fontSize: 12 } },
    ]);

    autoTable(doc, {
      startY: 130,
      head: [[{ content: 'Concepto', styles: { halign: 'left' } }, { content: 'Importe (ARS)', styles: { halign: 'right' } }]],
      body: rows as any,
      theme: 'grid',
      headStyles: { fillColor: [26, 26, 46], textColor: [212, 168, 67], fontStyle: 'bold' },
      styles: { fontSize: 10, cellPadding: 6 },
      columnStyles: { 0: { cellWidth: 360 }, 1: { cellWidth: 'auto' } },
    });

    const finalY = (doc as any).lastAutoTable.finalY + 30;
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text('Documento generado automáticamente — uso interno / informativo.', 40, finalY);

    doc.save(`estado-resultados-${filtered.label.replace(/\s/g, '-').toLowerCase()}.pdf`);
    toast.success('PDF generado');
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold">Reportes & Análisis</h1>
          <p className="text-muted-foreground text-sm">Métricas avanzadas, estado de resultados y exportación</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleExportProducts}><FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />Productos CSV</Button>
          <Button variant="outline" size="sm" onClick={handleExportSales}><FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />Ventas CSV</Button>
          <Button variant="outline" size="sm" onClick={handleExportPurchases}><FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />Compras CSV</Button>
          <Button variant="outline" size="sm" onClick={handlePDFSales}><FileText className="w-3.5 h-3.5 mr-1.5" />Ventas PDF</Button>
          <Button variant="outline" size="sm" onClick={handlePDFPurchases}><FileText className="w-3.5 h-3.5 mr-1.5" />Compras PDF</Button>
        </div>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="overview">Resumen</TabsTrigger>
          <TabsTrigger value="income">Estado de Resultados</TabsTrigger>
          <TabsTrigger value="inventory">Inventario Valorado</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
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

            {settings.tax_enabled ? (
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
            ) : (
              <div className="bg-card border border-border rounded-lg p-4 md:p-5 flex items-center justify-center">
                <div className="text-center">
                  <Receipt className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">Módulo de impuestos desactivado</p>
                  <p className="text-xs text-muted-foreground mt-1">Activalo en Ajustes para ver estimaciones fiscales</p>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="income" className="space-y-4">
          <div className="bg-card border border-border rounded-lg p-4 md:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
              <div>
                <h2 className="font-display font-bold text-lg">Estado de Resultados</h2>
                <p className="text-xs text-muted-foreground">Período: <span className="text-foreground capitalize">{filtered.label}</span></p>
              </div>
              <div className="flex gap-2">
                <Select value={period} onValueChange={(v) => setPeriod(v as PeriodKey)}>
                  <SelectTrigger className="w-[180px] bg-muted border-border"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="current_month">Mes actual</SelectItem>
                    <SelectItem value="last_month">Mes anterior</SelectItem>
                    <SelectItem value="quarter">Trimestre actual</SelectItem>
                    <SelectItem value="year">Año actual</SelectItem>
                    <SelectItem value="all">Histórico</SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={handleIncomeStatementPDF} className="gradient-gold text-primary-foreground">
                  <FileDown className="w-3.5 h-3.5 mr-1.5" />Descargar PDF
                </Button>
              </div>
            </div>

            <div className="space-y-1 font-mono text-sm">
              <Row label="Ingresos por ventas" value={formatARS(periodRevenue)} bold />
              <Row label="(-) Costo de mercadería vendida" value={`-${formatARS(periodCOGS)}`} negative />
              <Row label="= Ganancia bruta" value={`${formatARS(periodGrossProfit)}  (${grossMarginPct.toFixed(1)}%)`} bold highlight="muted" />
              <Row label="(-) Gastos operativos" value={`-${formatARS(totalOpex)}`} negative bold />
              {Object.entries(expensesByCategory).map(([cat, val]) => (
                <Row key={cat} label={`    · ${getCategoryLabel(cat)}`} value={`-${formatARS(val)}`} dim />
              ))}
              <Row label="= Resultado operativo" value={formatARS(opBeforeTax)} bold highlight="muted" />
              {settings.tax_enabled && (
                <>
                  <Row label={`(-) IVA (${settings.tax_iva_percent}%)`} value={`-${formatARS(periodTaxes.iva)}`} negative />
                  <Row label={`(-) IIBB (${settings.tax_iibb_percent}%)`} value={`-${formatARS(periodTaxes.iibb)}`} negative />
                </>
              )}
              <Row label="= GANANCIA NETA" value={`${formatARS(netIncome)}  (${netMarginPct.toFixed(1)}%)`} bold highlight="gold" />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="inventory">
          <InventoryTab products={products} settings={settings} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Inventario Valorado Tab
// ─────────────────────────────────────────────────────────────
function InventoryTab({ products, settings }: { products: any[]; settings: any }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"cost_value" | "retail_value" | "stock" | "margin">("cost_value");
  const [sortAsc, setSortAsc] = useState(false);
  const [catFilter, setCatFilter] = useState("all");
  const rate = Number(settings?.exchange_rate) || 1695;

  const rows = useMemo(() => {
    return products
      .filter(p => p.stock >= 0)
      .filter(p => catFilter === "all" || p.category === catFilter)
      .filter(p => !search || p.name?.toLowerCase().includes(search.toLowerCase()) || p.brand?.toLowerCase().includes(search.toLowerCase()))
      .map(p => {
        const costUSD = Number(p.total_cost_usd) || 0;
        const costARS = costUSD * rate;
        const retailARS = Number(p.sale_price_ars) || 0;
        const margin = retailARS > 0 ? ((retailARS - costARS) / retailARS) * 100 : 0;
        const costValue = costARS * p.stock;
        const retailValue = retailARS * p.stock;
        return { ...p, costARS, margin, costValue, retailValue };
      })
      .sort((a, b) => {
        const dir = sortAsc ? 1 : -1;
        return (a[sortKey] - b[sortKey]) * dir;
      });
  }, [products, search, catFilter, sortKey, sortAsc, rate]);

  const totalCostValue = rows.reduce((s, r) => s + r.costValue, 0);
  const totalRetailValue = rows.reduce((s, r) => s + r.retailValue, 0);
  const totalUnits = rows.reduce((s, r) => s + r.stock, 0);
  const totalCostUSD = rows.reduce((s, r) => s + (Number(r.total_cost_usd) || 0) * r.stock, 0);
  const unrealizedMargin = totalRetailValue > 0 ? ((totalRetailValue - totalCostValue) / totalRetailValue) * 100 : 0;

  // Top 10 by cost value for chart
  const top10 = [...rows].sort((a, b) => b.costValue - a.costValue).slice(0, 10);

  const categories = ["all", ...Array.from(new Set(products.map(p => p.category).filter(Boolean)))];

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const exportInventoryCSV = () => {
    exportCSV("inventario-valorado.csv",
      ["Producto", "Marca", "Categoría", "Stock", "Costo USD", "Costo ARS", "Precio ARS", "Margen %", "Valor Costo (ARS)", "Valor Retail (ARS)"],
      rows.map(r => [
        r.name, r.brand || "", getCategoryLabel(r.category),
        r.stock, (Number(r.total_cost_usd) || 0).toFixed(2),
        Math.round(r.costARS).toString(), r.sale_price_ars || "",
        r.margin.toFixed(1), Math.round(r.costValue).toString(), Math.round(r.retailValue).toString(),
      ])
    );
  };

  const tooltipStyle = { background: "hsl(220, 18%, 12%)", border: "1px solid hsl(220, 15%, 18%)", borderRadius: 8, color: "hsl(40, 20%, 92%)" };
  const PALETTE = ["hsl(40,70%,50%)", "hsl(150,60%,40%)", "hsl(200,70%,55%)", "hsl(280,60%,55%)", "hsl(0,65%,55%)", "hsl(60,70%,50%)", "hsl(25,70%,50%)", "hsl(320,60%,50%)", "hsl(180,60%,45%)", "hsl(100,55%,40%)"];

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Unidades en stock", value: totalUnits.toLocaleString("es-AR"), icon: Boxes, color: "text-primary" },
          { label: "Valor al costo (ARS)", value: formatARS(totalCostValue), icon: DollarSign, color: "text-warning" },
          { label: "Valor retail (ARS)", value: formatARS(totalRetailValue), icon: TrendingUp, color: "text-success" },
          { label: "Margen no realizado", value: `${unrealizedMargin.toFixed(1)}%`, icon: Package, color: unrealizedMargin >= 30 ? "text-success" : unrealizedMargin >= 15 ? "text-warning" : "text-destructive" },
        ].map(k => (
          <div key={k.label} className="bg-card border border-border rounded-lg p-3 md:p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wider leading-tight">{k.label}</span>
              <k.icon className={`w-3.5 h-3.5 shrink-0 ${k.color}`} />
            </div>
            <p className={`text-lg md:text-xl font-bold font-display ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Additional metric */}
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex flex-wrap gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Inversión inmovilizada (USD): </span>
            <span className="font-bold text-warning">{formatUSD(totalCostUSD)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Ganancia potencial: </span>
            <span className="font-bold text-success">{formatARS(totalRetailValue - totalCostValue)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Productos sin stock: </span>
            <span className="font-bold text-destructive">{products.filter(p => p.stock <= 0).length}</span>
          </div>
        </div>
      </div>

      {/* Chart */}
      {top10.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="text-sm font-display font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Top 10 productos por valor al costo</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={top10} layout="vertical">
              <XAxis type="number" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fill: "hsl(220, 10%, 55%)", fontSize: 10 }} />
              <YAxis type="category" dataKey="name" tick={{ fill: "hsl(220, 10%, 55%)", fontSize: 10 }} width={110} tickFormatter={(v) => v.length > 18 ? v.slice(0, 18) + "…" : v} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatARS(v), "Valor al costo"]} />
              <Bar dataKey="costValue" radius={[0, 4, 4, 0]}>
                {top10.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Table controls */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          <Input
            placeholder="Buscar producto..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-muted border-border w-52"
          />
          <Select value={catFilter} onValueChange={setCatFilter}>
            <SelectTrigger className="bg-muted border-border w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {categories.map(c => (
                <SelectItem key={c} value={c}>{c === "all" ? "Todas las categorías" : getCategoryLabel(c)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={exportInventoryCSV}>
          <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />Exportar CSV
        </Button>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-3 py-2.5 text-xs text-muted-foreground uppercase tracking-wide font-medium">Producto</th>
                <th className="text-left px-3 py-2.5 text-xs text-muted-foreground uppercase tracking-wide font-medium hidden md:table-cell">Categoría</th>
                <SortTh label="Stock" sortKey="stock" current={sortKey} asc={sortAsc} onClick={handleSort} />
                <th className="text-right px-3 py-2.5 text-xs text-muted-foreground uppercase tracking-wide font-medium hidden lg:table-cell">Costo/u ARS</th>
                <th className="text-right px-3 py-2.5 text-xs text-muted-foreground uppercase tracking-wide font-medium">Precio ARS</th>
                <SortTh label="Margen %" sortKey="margin" current={sortKey} asc={sortAsc} onClick={handleSort} right />
                <SortTh label="Val. Costo" sortKey="cost_value" current={sortKey} asc={sortAsc} onClick={handleSort} right />
                <SortTh label="Val. Retail" sortKey="retail_value" current={sortKey} asc={sortAsc} onClick={handleSort} right />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-muted-foreground text-sm">Sin productos</td>
                </tr>
              ) : rows.map(r => {
                const pct = totalCostValue > 0 ? (r.costValue / totalCostValue) * 100 : 0;
                return (
                  <tr key={r.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2.5">
                      <div>
                        <p className="font-medium text-sm leading-tight">{r.name}</p>
                        {r.brand && <p className="text-[10px] text-muted-foreground">{r.brand}</p>}
                        {/* Inline progress bar showing % of total stock value */}
                        <div className="w-full bg-muted h-1 rounded-full mt-1">
                          <div
                            className="h-1 rounded-full bg-primary/60"
                            style={{ width: `${Math.min(100, pct * 5)}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground hidden md:table-cell">{getCategoryLabel(r.category)}</td>
                    <td className="px-3 py-2.5 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        r.stock <= 0 ? "bg-red-500/15 text-red-400" :
                        r.stock <= 3 ? "bg-yellow-500/15 text-yellow-400" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {r.stock}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs text-muted-foreground hidden lg:table-cell font-mono">{formatARS(r.costARS)}</td>
                    <td className="px-3 py-2.5 text-right text-xs font-mono">{formatARS(Number(r.sale_price_ars) || 0)}</td>
                    <td className={`px-3 py-2.5 text-right text-xs font-bold ${r.margin >= 30 ? "text-success" : r.margin >= 15 ? "text-warning" : "text-destructive"}`}>
                      {r.margin.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs font-mono text-warning">{formatARS(r.costValue)}</td>
                    <td className="px-3 py-2.5 text-right text-xs font-mono text-success">{formatARS(r.retailValue)}</td>
                  </tr>
                );
              })}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/40 font-bold text-sm">
                  <td className="px-3 py-2.5">TOTAL ({rows.length} productos)</td>
                  <td className="hidden md:table-cell" />
                  <td className="px-3 py-2.5 text-center">{totalUnits}</td>
                  <td className="hidden lg:table-cell" />
                  <td />
                  <td className="px-3 py-2.5 text-right">{unrealizedMargin.toFixed(1)}%</td>
                  <td className="px-3 py-2.5 text-right text-warning font-mono">{formatARS(totalCostValue)}</td>
                  <td className="px-3 py-2.5 text-right text-success font-mono">{formatARS(totalRetailValue)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

function SortTh({ label, sortKey, current, asc, onClick, right }: {
  label: string; sortKey: string; current: string; asc: boolean; onClick: (k: any) => void; right?: boolean;
}) {
  const active = current === sortKey;
  return (
    <th
      className={`px-3 py-2.5 text-xs text-muted-foreground uppercase tracking-wide font-medium cursor-pointer hover:text-foreground transition-colors ${right ? "text-right" : "text-center"}`}
      onClick={() => onClick(sortKey)}
    >
      <span className={`flex items-center gap-1 ${right ? "justify-end" : "justify-center"}`}>
        {label}
        <ArrowUpDown className={`w-3 h-3 ${active ? "text-primary" : "opacity-40"}`} />
      </span>
    </th>
  );
}

function Row({ label, value, bold, negative, dim, highlight }: { label: string; value: string; bold?: boolean; negative?: boolean; dim?: boolean; highlight?: 'muted' | 'gold' }) {
  const bg = highlight === 'gold' ? 'bg-primary/15 border-primary/40' : highlight === 'muted' ? 'bg-muted/40 border-border' : 'border-border/40';
  const valColor = negative ? 'text-destructive' : highlight === 'gold' ? 'text-primary' : '';
  return (
    <div className={`flex justify-between items-center px-3 py-2 border-b ${bg} ${dim ? 'opacity-70 text-xs' : ''}`}>
      <span className={bold ? 'font-bold' : ''}>{label}</span>
      <span className={`${bold ? 'font-bold' : ''} ${valColor}`}>{value}</span>
    </div>
  );
}
