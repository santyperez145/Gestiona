import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { getProductsDB, getSalesDB, getPurchasesDB, getDebtsDB, getSettingsDB, getExpensesDB, formatARS, formatUSD, getCategoryLabel, calculateTaxes, getOrgMembersWithProfilesDB } from "@/lib/supabaseStore";
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
  const [members, setMembers] = useState<any[]>([]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [products, sales, purchases, debts, settings, expenses, orgMembers] = await Promise.all([
        getProductsDB(user.id), getSalesDB(user.id), getPurchasesDB(user.id), getDebtsDB(user.id), getSettingsDB(user.id), getExpensesDB(user.id),
        getOrgMembersWithProfilesDB(user.id).catch(() => []),
      ]);
      setData({ products, sales, purchases, debts, settings, expenses });
      setMembers(orgMembers as any[]);
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
          <TabsTrigger value="sellers">Vendedores</TabsTrigger>
          <TabsTrigger value="taxes">Impuestos</TabsTrigger>
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

        <TabsContent value="sellers">
          <SellersTab sales={data.sales} members={members} period={period} />
        </TabsContent>

        <TabsContent value="taxes">
          <TaxesTab sales={data.sales} settings={settings} />
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

// ─────────────────────────────────────────────────────────────
// Vendedores Tab
// ─────────────────────────────────────────────────────────────
function SellersTab({ sales, members, period }: { sales: any[]; members: any[]; period: PeriodKey }) {
  const { from, to, label } = getPeriodRange(period);
  const inRange = (d: string) => { const x = new Date(d); return x >= from && x <= to; };

  const sellerMap = useMemo(() => {
    const map: Record<string, { name: string; role: string; totalARS: number; profit: number; count: number; customers: Set<string>; byMonth: Record<string, number> }> = {};
    const memberByUserId: Record<string, any> = {};
    members.forEach(m => { memberByUserId[m.user_id] = m; });

    sales.filter(s => inRange(s.date)).forEach(s => {
      const uid = s.user_id || 'unknown';
      if (!map[uid]) {
        const m = memberByUserId[uid];
        map[uid] = {
          name: m?.display_name || `Vendedor ${uid.slice(0, 6)}`,
          role: m?.role || 'vendedor',
          totalARS: 0, profit: 0, count: 0,
          customers: new Set(),
          byMonth: {},
        };
      }
      map[uid].totalARS += Number(s.total_ars);
      map[uid].profit += Number(s.profit_ars);
      map[uid].count += s.quantity;
      if (s.customer_name) map[uid].customers.add(s.customer_name);
      const mo = String(s.date).slice(0, 7);
      map[uid].byMonth[mo] = (map[uid].byMonth[mo] || 0) + Number(s.total_ars);
    });
    return map;
  }, [sales, members, period]);

  const rows = useMemo(() =>
    Object.entries(sellerMap)
      .map(([uid, d]) => ({ uid, ...d, margin: d.totalARS > 0 ? (d.profit / d.totalARS) * 100 : 0, customersCount: d.customers.size, avgTicket: d.count > 0 ? d.totalARS / d.count : 0 }))
      .sort((a, b) => b.totalARS - a.totalARS),
    [sellerMap]
  );

  const totalARS = rows.reduce((s, r) => s + r.totalARS, 0);

  const chartData = rows.map(r => ({ name: r.name.split(' ')[0], total: Math.round(r.totalARS) }));

  if (rows.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm">Sin ventas registradas en el período seleccionado.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Período: {label}</h3>
        <Button variant="outline" size="sm" onClick={() => {
          exportCSV(`vendedores_${label.replace(/\s/g, '_')}.csv`,
            ['Vendedor', 'Rol', 'Ventas ARS', 'Ganancia ARS', 'Margen %', 'Unidades', 'Clientes únicos', 'Ticket prom.'],
            rows.map(r => [r.name, r.role, r.totalARS.toFixed(0), r.profit.toFixed(0), r.margin.toFixed(1), String(r.count), String(r.customersCount), r.avgTicket.toFixed(0)])
          );
        }}><FileDown className="w-3.5 h-3.5 mr-1.5" />CSV</Button>
      </div>

      {/* Bar chart */}
      {chartData.length > 1 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wide">Facturación por vendedor</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 8 }}>
              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
              <Tooltip formatter={(v: any) => formatARS(v)} contentStyle={{ background: 'hsl(220,18%,12%)', border: '1px solid hsl(220,15%,18%)', borderRadius: 8, fontSize: 11 }} />
              <Bar dataKey="total" radius={[0, 4, 4, 0]}>
                {chartData.map((_, i) => <Cell key={i} fill={SELLER_COLORS[i % SELLER_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map((r, i) => {
          const sharePct = totalARS > 0 ? (r.totalARS / totalARS) * 100 : 0;
          return (
            <div key={r.uid} className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white" style={{ background: SELLER_COLORS[i % SELLER_COLORS.length] }}>
                    {r.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{r.name}</p>
                    <p className="text-[10px] text-muted-foreground capitalize">{r.role}</p>
                  </div>
                </div>
                <span className="text-[10px] text-muted-foreground bg-muted rounded-full px-2 py-0.5">{sharePct.toFixed(1)}%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-1.5">
                <div className="h-1.5 rounded-full transition-all" style={{ width: `${sharePct}%`, background: SELLER_COLORS[i % SELLER_COLORS.length] }} />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><p className="text-muted-foreground">Facturado</p><p className="font-bold text-success">{formatARS(r.totalARS)}</p></div>
                <div><p className="text-muted-foreground">Ganancia</p><p className="font-bold">{formatARS(r.profit)}</p></div>
                <div><p className="text-muted-foreground">Margen</p><p className={`font-bold ${r.margin >= 30 ? "text-success" : r.margin >= 15 ? "text-warning" : "text-destructive"}`}>{r.margin.toFixed(1)}%</p></div>
                <div><p className="text-muted-foreground">Unidades</p><p className="font-bold">{r.count}</p></div>
                <div><p className="text-muted-foreground">Clientes</p><p className="font-bold">{r.customersCount}</p></div>
                <div><p className="text-muted-foreground">Ticket prom.</p><p className="font-bold">{formatARS(r.avgTicket)}</p></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const SELLER_COLORS = ['hsl(40,70%,50%)', 'hsl(152,58%,42%)', 'hsl(200,60%,50%)', 'hsl(280,60%,50%)', 'hsl(0,70%,50%)', 'hsl(35,90%,55%)'];

// ─────────────────────────────────────────────────────────────
// Impuestos Tab
// ─────────────────────────────────────────────────────────────
function TaxesTab({ sales, settings }: { sales: any[]; settings: any }) {
  const taxEnabled = settings?.tax_enabled;
  const ivaRate = Number(settings?.tax_iva_percent || 21);
  const iibbRate = Number(settings?.tax_iibb_percent || 3.5);
  const monotributoMonthly = Number(settings?.tax_monotributo_monthly || 0);

  // Group sales by month and calculate taxes
  const monthlyData = useMemo(() => {
    const map: Record<string, { revenue: number; profit: number; count: number }> = {};
    sales.forEach((s: any) => {
      const key = String(s.date).slice(0, 7);
      if (!map[key]) map[key] = { revenue: 0, profit: 0, count: 0 };
      map[key].revenue += Number(s.total_ars);
      map[key].profit += Number(s.profit_ars);
      map[key].count++;
    });
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, d]) => {
        const [y, mo] = key.split('-');
        const iva = taxEnabled ? d.profit * (ivaRate / 100) : 0;
        const iibb = taxEnabled ? d.profit * (iibbRate / 100) : 0;
        const total = iva + iibb + (taxEnabled ? monotributoMonthly : 0);
        return {
          key,
          label: `${months[parseInt(mo) - 1]} ${y.slice(2)}`,
          revenue: d.revenue,
          profit: d.profit,
          salesCount: d.count,
          iva, iibb,
          monotributo: taxEnabled ? monotributoMonthly : 0,
          total,
          netProfit: d.profit - total,
        };
      });
  }, [sales, settings]);

  const totals = monthlyData.reduce((acc, row) => ({
    revenue: acc.revenue + row.revenue,
    profit: acc.profit + row.profit,
    iva: acc.iva + row.iva,
    iibb: acc.iibb + row.iibb,
    monotributo: acc.monotributo + row.monotributo,
    total: acc.total + row.total,
    netProfit: acc.netProfit + row.netProfit,
  }), { revenue: 0, profit: 0, iva: 0, iibb: 0, monotributo: 0, total: 0, netProfit: 0 });

  return (
    <div className="space-y-6">
      {!taxEnabled && (
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-4 flex items-start gap-3">
          <TrendingUp className="w-4 h-4 text-warning mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-warning">Impuestos desactivados</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Activá los impuestos en Ajustes → Impuestos para ver el impacto real en tu rentabilidad.
              Las tasas configuradas son: IVA {ivaRate}%, IIBB {iibbRate}%, Monotributo ${monotributoMonthly.toLocaleString("es-AR")}/mes.
            </p>
          </div>
        </div>
      )}

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Facturación total", value: formatARS(totals.revenue), color: "text-primary" },
          { label: "Ganancia bruta", value: formatARS(totals.profit), color: "text-success" },
          { label: "Total impuestos", value: formatARS(totals.total), color: "text-destructive" },
          { label: "Ganancia neta", value: formatARS(totals.netProfit), color: totals.netProfit >= 0 ? "text-success" : "text-destructive" },
        ].map(k => (
          <div key={k.label} className="bg-card border border-border rounded-xl p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{k.label}</p>
            <p className={`text-lg font-bold font-display ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Tax breakdown header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Detalle mensual</h3>
        <Button variant="outline" size="sm" onClick={() => exportCSV(
          'impuestos.csv',
          ['Mes', 'Ventas', 'Ganancia bruta', `IVA (${ivaRate}%)`, `IIBB (${iibbRate}%)`, 'Monotributo', 'Total impuestos', 'Ganancia neta'],
          monthlyData.map(r => [r.label, r.revenue.toFixed(0), r.profit.toFixed(0), r.iva.toFixed(0), r.iibb.toFixed(0), r.monotributo.toFixed(0), r.total.toFixed(0), r.netProfit.toFixed(0)])
        )}>
          <FileDown className="w-3.5 h-3.5 mr-1.5" />CSV
        </Button>
      </div>

      {monthlyData.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-10">Sin ventas registradas</p>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-3 py-2.5 text-left text-xs text-muted-foreground uppercase tracking-wide">Mes</th>
                  <th className="px-3 py-2.5 text-right text-xs text-muted-foreground uppercase tracking-wide">Ventas</th>
                  <th className="px-3 py-2.5 text-right text-xs text-muted-foreground uppercase tracking-wide">G. Bruta</th>
                  <th className="px-3 py-2.5 text-right text-xs text-muted-foreground uppercase tracking-wide text-orange-400">IVA {ivaRate}%</th>
                  <th className="px-3 py-2.5 text-right text-xs text-muted-foreground uppercase tracking-wide text-orange-400">IIBB {iibbRate}%</th>
                  {monotributoMonthly > 0 && <th className="px-3 py-2.5 text-right text-xs text-muted-foreground uppercase tracking-wide text-orange-400">Monotributo</th>}
                  <th className="px-3 py-2.5 text-right text-xs text-muted-foreground uppercase tracking-wide text-destructive">Total imp.</th>
                  <th className="px-3 py-2.5 text-right text-xs text-muted-foreground uppercase tracking-wide text-success">G. Neta</th>
                </tr>
              </thead>
              <tbody>
                {monthlyData.map((row, i) => (
                  <tr key={row.key} className={`border-b border-border/40 ${i % 2 === 0 ? '' : 'bg-muted/10'}`}>
                    <td className="px-3 py-2.5 font-medium">{row.label}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">{formatARS(row.revenue)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-success">{formatARS(row.profit)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-orange-400">{taxEnabled ? `-${formatARS(row.iva)}` : '—'}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-orange-400">{taxEnabled ? `-${formatARS(row.iibb)}` : '—'}</td>
                    {monotributoMonthly > 0 && <td className="px-3 py-2.5 text-right font-mono text-xs text-orange-400">{taxEnabled ? `-${formatARS(row.monotributo)}` : '—'}</td>}
                    <td className="px-3 py-2.5 text-right font-mono text-xs font-bold text-destructive">{taxEnabled ? `-${formatARS(row.total)}` : '—'}</td>
                    <td className={`px-3 py-2.5 text-right font-mono text-xs font-bold ${row.netProfit >= 0 ? 'text-success' : 'text-destructive'}`}>{formatARS(row.netProfit)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/40 font-bold">
                  <td className="px-3 py-2.5">TOTAL</td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs">{formatARS(totals.revenue)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-success">{formatARS(totals.profit)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-orange-400">{taxEnabled ? `-${formatARS(totals.iva)}` : '—'}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-orange-400">{taxEnabled ? `-${formatARS(totals.iibb)}` : '—'}</td>
                  {monotributoMonthly > 0 && <td className="px-3 py-2.5 text-right font-mono text-xs text-orange-400">{taxEnabled ? `-${formatARS(totals.monotributo)}` : '—'}</td>}
                  <td className="px-3 py-2.5 text-right font-mono text-xs font-bold text-destructive">{taxEnabled ? `-${formatARS(totals.total)}` : '—'}</td>
                  <td className={`px-3 py-2.5 text-right font-mono text-xs font-bold ${totals.netProfit >= 0 ? 'text-success' : 'text-destructive'}`}>{formatARS(totals.netProfit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {taxEnabled && (
        <div className="bg-muted/30 border border-border/50 rounded-xl p-4 text-xs text-muted-foreground space-y-1">
          <p className="font-semibold text-foreground text-[11px] uppercase tracking-wide mb-2">Configuración de tasas</p>
          <p>IVA: {ivaRate}% sobre ganancia bruta</p>
          <p>IIBB (Ingresos Brutos): {iibbRate}% sobre ganancia bruta</p>
          {monotributoMonthly > 0 && <p>Monotributo: ${monotributoMonthly.toLocaleString("es-AR")} fijos por mes</p>}
          <p className="text-[10px] mt-2 opacity-70">Modificar tasas: Ajustes → Impuestos. Importante: este reporte es orientativo. Consultá con tu contador para declaraciones oficiales.</p>
        </div>
      )}
    </div>
  );
}
