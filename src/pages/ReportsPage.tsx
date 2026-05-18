import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { getProductsDB, getSalesDB, getPurchasesDB, getDebtsDB, getSettingsDB, getExpensesDB, formatARS, formatUSD, getCategoryLabel, calculateTaxes, getOrgMembersWithProfilesDB } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileSpreadsheet, TrendingUp, TrendingDown, Package, DollarSign, Users, FileText, Receipt, FileDown, ArrowUpDown, Boxes, Shield, BarChart2, MapPin } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LineChart, Line, CartesianGrid, ReferenceLine } from "recharts";
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
      setMembers(orgMembers);
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

  // Previous period for comparison in ER
  const prevFiltered = useMemo(() => {
    if (!data || period === 'all') return null;
    const { from, to } = getPeriodRange(period);
    const diffMs = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - diffMs - 86_400_000);
    const prevTo = new Date(from.getTime() - 1);
    const inPrev = (d: string) => { const x = new Date(d); return x >= prevFrom && x <= prevTo; };
    return {
      sales: data.sales.filter((s: any) => inPrev(s.date)),
      expenses: data.expenses.filter((e: any) => inPrev(e.date)),
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

  // ===== CSV P&L mensual =====
  const handlePLCSV = () => {
    const monthMap: Record<string, { revenue: number; cogs: number; grossProfit: number; expenses: number; net: number }> = {};
    data.sales.forEach((s: any) => {
      const key = String(s.date).slice(0, 7);
      if (!monthMap[key]) monthMap[key] = { revenue: 0, cogs: 0, grossProfit: 0, expenses: 0, net: 0 };
      monthMap[key].revenue += Number(s.total_ars);
      monthMap[key].grossProfit += Number(s.profit_ars);
      monthMap[key].cogs += Number(s.total_ars) - Number(s.profit_ars);
    });
    data.expenses.forEach((e: any) => {
      const key = String(e.date).slice(0, 7);
      if (!monthMap[key]) monthMap[key] = { revenue: 0, cogs: 0, grossProfit: 0, expenses: 0, net: 0 };
      monthMap[key].expenses += Number(e.amount_ars);
    });
    Object.values(monthMap).forEach(m => { m.net = m.grossProfit - m.expenses; });
    const rows = Object.entries(monthMap).sort(([a], [b]) => a.localeCompare(b)).map(([month, m]) => {
      const [y, mo] = month.split('-');
      const label = new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
      const grossPct = m.revenue > 0 ? ((m.grossProfit / m.revenue) * 100).toFixed(1) : '0';
      const netPct = m.revenue > 0 ? ((m.net / m.revenue) * 100).toFixed(1) : '0';
      return [label, m.revenue.toFixed(0), m.cogs.toFixed(0), m.grossProfit.toFixed(0), grossPct, m.expenses.toFixed(0), m.net.toFixed(0), netPct];
    });
    exportCSV(`PL_${new Date().getFullYear()}.csv`,
      ['Período', 'Ingresos ARS', 'COGS ARS', 'Ganancia Bruta ARS', 'Margen Bruto %', 'Gastos ARS', 'Ganancia Neta ARS', 'Margen Neto %'],
      rows
    );
  };

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
      body: rows as [string, string][],
      theme: 'grid',
      headStyles: { fillColor: [26, 26, 46], textColor: [212, 168, 67], fontStyle: 'bold' },
      styles: { fontSize: 10, cellPadding: 6 },
      columnStyles: { 0: { cellWidth: 360 }, 1: { cellWidth: 'auto' } },
    });

    const finalY = doc.lastAutoTable.finalY + 30;
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    doc.text('Documento generado automáticamente — uso interno / informativo.', 40, finalY);

    doc.save(`estado-resultados-${filtered.label.replace(/\s/g, '-').toLowerCase()}.pdf`);
    toast.success('PDF generado');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={BarChart2}
        title="Reportes & Análisis"
        description="Métricas avanzadas, estado de resultados y exportación"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={handleExportProducts}><FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />Productos CSV</Button>
            <Button variant="outline" size="sm" onClick={handleExportSales}><FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />Ventas CSV</Button>
            <Button variant="outline" size="sm" onClick={handleExportPurchases}><FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />Compras CSV</Button>
            <Button variant="outline" size="sm" onClick={handlePDFSales}><FileText className="w-3.5 h-3.5 mr-1.5" />Ventas PDF</Button>
            <Button variant="outline" size="sm" onClick={handlePDFPurchases}><FileText className="w-3.5 h-3.5 mr-1.5" />Compras PDF</Button>
          </div>
        }
      />

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="overview">Resumen</TabsTrigger>
          <TabsTrigger value="income">Estado de Resultados</TabsTrigger>
          <TabsTrigger value="inventory">Inventario Valorado</TabsTrigger>
          <TabsTrigger value="products">Rentabilidad Productos</TabsTrigger>
          <TabsTrigger value="sellers">Vendedores</TabsTrigger>
          <TabsTrigger value="taxes">Impuestos</TabsTrigger>
          <TabsTrigger value="budget">Presupuesto</TabsTrigger>
          <TabsTrigger value="categories">Por Categoría</TabsTrigger>
          <TabsTrigger value="cashflow">Flujo de Caja</TabsTrigger>
          <TabsTrigger value="audit">Auditoría</TabsTrigger>
          <TabsTrigger value="suppliers">Proveedores</TabsTrigger>
          <TabsTrigger value="compare">Comparativa</TabsTrigger>
          <TabsTrigger value="sucursales">Sucursales</TabsTrigger>
          <TabsTrigger value="margin_trend">📈 Tendencia</TabsTrigger>
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
          {/* ── Comparativa rápida con período anterior ── */}
          {prevFiltered && period !== 'all' && (() => {
            const prevRev = prevFiltered.sales.reduce((s: number, v: any) => s + Number(v.total_ars), 0);
            const prevProfit = prevFiltered.sales.reduce((s: number, v: any) => s + Number(v.profit_ars), 0);
            const prevOpex = prevFiltered.expenses.reduce((s: number, e: any) => s + Number(e.amount_ars), 0);
            const prevNet = prevProfit - prevOpex;
            const delta = (curr: number, prev: number) => {
              if (prev === 0) return null;
              const pct = ((curr - prev) / Math.abs(prev)) * 100;
              return { pct, up: pct >= 0 };
            };
            const kpis = [
              { label: "Ingresos", curr: periodRevenue, prev: prevRev },
              { label: "Ganancia bruta", curr: periodGrossProfit, prev: prevProfit },
              { label: "Gastos", curr: totalOpex, prev: prevOpex, invert: true },
              { label: "Resultado neto", curr: netIncome, prev: prevNet },
            ];
            return (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {kpis.map(k => {
                  const d = delta(k.curr, k.prev);
                  const good = d ? (k.invert ? !d.up : d.up) : null;
                  return (
                    <div key={k.label} className="bg-card border border-border rounded-lg p-3">
                      <p className="text-xs text-muted-foreground">{k.label}</p>
                      <p className="font-mono font-bold text-sm mt-0.5">{formatARS(k.curr)}</p>
                      {d && (
                        <p className={`text-[10px] mt-0.5 font-medium ${good ? "text-green-400" : "text-red-400"}`}>
                          {d.up ? "▲" : "▼"} {Math.abs(d.pct).toFixed(1)}% vs período anterior
                        </p>
                      )}
                      {!d && <p className="text-[10px] text-muted-foreground/50 mt-0.5">Sin datos anteriores</p>}
                    </div>
                  );
                })}
              </div>
            );
          })()}

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
                <Button variant="outline" onClick={handlePLCSV} size="sm">
                  <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />CSV P&L
                </Button>
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

        <TabsContent value="products">
          <ProductProfitabilityTab sales={filtered.sales} />
        </TabsContent>

        <TabsContent value="budget">
          <BudgetTab sales={data.sales} expenses={data.expenses} settings={settings} userId={user?.id || ""} />
        </TabsContent>

        <TabsContent value="categories">
          <SalesByCategoryTab sales={filtered.sales} products={data.products} period={filtered.label} />
        </TabsContent>

        <TabsContent value="cashflow">
          <CashFlowTab sales={data.sales} expenses={data.expenses} purchases={data.purchases} />
        </TabsContent>

        <TabsContent value="audit">
          <AuditTab />
        </TabsContent>

        <TabsContent value="suppliers">
          <SuppliersTab purchases={data.purchases} />
        </TabsContent>

        <TabsContent value="compare">
          <ComparePeriodTab sales={data.sales} expenses={data.expenses} />
        </TabsContent>

        <TabsContent value="sucursales">
          <SucursalesTab sales={data.sales} />
        </TabsContent>

        <TabsContent value="margin_trend">
          <MarginTrendTab sales={data.sales} expenses={data.expenses} />
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
          <table className="w-full text-sm table-compact-mobile">
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
  const [commissionRate, setCommissionRate] = useState(5);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Período: {label}</h3>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-1.5">
            <span className="text-xs text-muted-foreground whitespace-nowrap">Comisión %</span>
            <input
              type="number" min="0" max="100" step="0.5"
              value={commissionRate}
              onChange={e => setCommissionRate(Number(e.target.value))}
              className="w-14 text-xs text-right bg-transparent outline-none font-bold text-primary"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => {
            exportCSV(`vendedores_${label.replace(/\s/g, '_')}.csv`,
              ['Vendedor', 'Rol', 'Ventas ARS', 'Ganancia ARS', 'Margen %', 'Unidades', 'Clientes únicos', 'Ticket prom.', `Comisión (${commissionRate}%)`],
              rows.map(r => [r.name, r.role, r.totalARS.toFixed(0), r.profit.toFixed(0), r.margin.toFixed(1), String(r.count), String(r.customersCount), r.avgTicket.toFixed(0), (r.totalARS * commissionRate / 100).toFixed(0)])
            );
          }}><FileDown className="w-3.5 h-3.5 mr-1.5" />CSV</Button>
        </div>
      </div>

      {/* Monthly trend chart — compare sellers over last 12 months */}
      {rows.length > 0 && (() => {
        const now = new Date();
        const months: string[] = [];
        for (let i = 11; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }
        const trendData = months.map(mo => {
          const entry: Record<string, any> = {
            label: new Date(mo + '-01').toLocaleDateString('es-AR', { month: 'short', year: '2-digit' }),
          };
          rows.forEach(r => { entry[r.name.split(' ')[0]] = r.byMonth[mo] || 0; });
          return entry;
        });
        const sellerNames = rows.map(r => r.name.split(' ')[0]);
        return (
          <div className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wide">Evolución mensual por vendedor (últimos 12 meses)</p>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trendData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#888' }} />
                <YAxis tick={{ fontSize: 10, fill: '#888' }} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                <Tooltip
                  formatter={(v: number, name: string) => [formatARS(v), name]}
                  contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                />
                {sellerNames.map((name, i) => (
                  <Line key={name} type="monotone" dataKey={name} stroke={SELLER_COLORS[i % SELLER_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
            {sellerNames.length > 1 && (
              <div className="flex gap-4 mt-2 text-xs text-muted-foreground justify-center flex-wrap">
                {sellerNames.map((name, i) => (
                  <span key={name} className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: SELLER_COLORS[i % SELLER_COLORS.length] }} />{name}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })()}

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
              {commissionRate > 0 && (
                <div className="mt-2 pt-2 border-t border-border flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Comisión estimada ({commissionRate}%)</span>
                  <span className="text-xs font-bold text-primary">{formatARS(r.totalARS * commissionRate / 100)}</span>
                </div>
              )}
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

  // Projected taxes: based on last 3 months average revenue & profit
  const projectedTaxes = useMemo(() => {
    const today = new Date();
    const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const recent = monthlyData.slice(-3);
    const avgRevenue = recent.length > 0 ? recent.reduce((s, r) => s + r.revenue, 0) / recent.length : 0;
    const avgProfit = recent.length > 0 ? recent.reduce((s, r) => s + r.profit, 0) / recent.length : 0;
    if (avgRevenue <= 0) return [];
    return Array.from({ length: 3 }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() + i + 1, 1);
      const iva = taxEnabled ? avgProfit * (ivaRate / 100) : 0;
      const iibb = taxEnabled ? avgProfit * (iibbRate / 100) : 0;
      const mono = taxEnabled ? monotributoMonthly : 0;
      return {
        label: `${months[d.getMonth()]} ${d.getFullYear()}`,
        revenue: avgRevenue,
        profit: avgProfit,
        iva, iibb, mono,
        total: iva + iibb + mono,
        netProfit: avgProfit - iva - iibb - mono,
      };
    });
  }, [monthlyData, taxEnabled, ivaRate, iibbRate, monotributoMonthly]);

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

      {/* Tax projection section */}
      {projectedTaxes.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-destructive" />
            <h3 className="text-sm font-semibold">Proyección impositiva — próximos 3 meses</h3>
            <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-full">basado en promedio últimos 3 meses</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {projectedTaxes.map(p => (
              <div key={p.label} className="bg-muted/40 rounded-xl p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{p.label}</p>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between"><span className="text-muted-foreground">Facturación est.</span><span>{formatARS(p.revenue)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Ganancia est.</span><span className="text-success">{formatARS(p.profit)}</span></div>
                  {taxEnabled && <>
                    <div className="flex justify-between"><span className="text-muted-foreground">IVA ({ivaRate}%)</span><span className="text-destructive">-{formatARS(p.iva)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">IIBB ({iibbRate}%)</span><span className="text-destructive">-{formatARS(p.iibb)}</span></div>
                    {p.mono > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Monotributo</span><span className="text-destructive">-{formatARS(p.mono)}</span></div>}
                  </>}
                  <div className="flex justify-between border-t border-border/40 pt-1 font-semibold">
                    <span>Total impuestos</span>
                    <span className="text-destructive">{taxEnabled ? `-${formatARS(p.total)}` : "—"}</span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span>Ganancia neta</span>
                    <span className={p.netProfit >= 0 ? "text-success" : "text-destructive"}>{formatARS(p.netProfit)}</span>
                  </div>
                </div>
              </div>
            ))}
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
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => {
            const businessName = settings?.business_name || 'Mi Negocio';
            const generated = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
            const rowsHtml = monthlyData.map((r, i) => `
              <tr style="background:${i % 2 === 0 ? '#fff' : '#f9f9f9'}">
                <td>${r.label}</td>
                <td style="text-align:right">${formatARS(r.revenue)}</td>
                <td style="text-align:right;color:#16a34a">${formatARS(r.profit)}</td>
                <td style="text-align:right;color:#ea580c">${taxEnabled ? `-${formatARS(r.iva)}` : '—'}</td>
                <td style="text-align:right;color:#ea580c">${taxEnabled ? `-${formatARS(r.iibb)}` : '—'}</td>
                ${monotributoMonthly > 0 ? `<td style="text-align:right;color:#ea580c">${taxEnabled ? `-${formatARS(r.monotributo)}` : '—'}</td>` : ''}
                <td style="text-align:right;font-weight:bold;color:#dc2626">${taxEnabled ? `-${formatARS(r.total)}` : '—'}</td>
                <td style="text-align:right;font-weight:bold;color:${r.netProfit >= 0 ? '#16a34a' : '#dc2626'}">${formatARS(r.netProfit)}</td>
              </tr>`).join('');
            const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
  body{font-family:Arial,sans-serif;margin:24px;color:#222;font-size:12px}
  h1{font-size:20px;margin-bottom:2px}
  .sub{color:#666;font-size:11px;margin-bottom:16px}
  table{border-collapse:collapse;width:100%}
  th{background:#1a1a2e;color:#d4a843;font-size:10px;text-transform:uppercase;letter-spacing:.5px;padding:6px 8px;text-align:left}
  th.r,td.r{text-align:right}
  td{padding:5px 8px;border-bottom:1px solid #eee}
  .tfoot td{background:#f0f0f0;font-weight:bold;border-top:2px solid #ccc}
  .disclaimer{margin-top:16px;font-size:9px;color:#999;border-top:1px solid #eee;padding-top:8px}
  @media print{body{margin:0}}
</style></head><body>
<h1>${businessName} — Reporte de Impuestos</h1>
<div class="sub">Generado: ${generated} · IVA ${ivaRate}% · IIBB ${iibbRate}%${monotributoMonthly > 0 ? ` · Monotributo $${monotributoMonthly.toLocaleString('es-AR')}/mes` : ''}</div>
<table>
<thead><tr>
  <th>Mes</th><th class="r">Facturación</th><th class="r">G. Bruta</th>
  <th class="r">IVA ${ivaRate}%</th><th class="r">IIBB ${iibbRate}%</th>
  ${monotributoMonthly > 0 ? '<th class="r">Monotributo</th>' : ''}
  <th class="r">Total Imp.</th><th class="r">G. Neta</th>
</tr></thead>
<tbody>${rowsHtml}</tbody>
<tfoot><tr class="tfoot">
  <td>TOTAL</td>
  <td class="r">${formatARS(totals.revenue)}</td>
  <td class="r" style="color:#16a34a">${formatARS(totals.profit)}</td>
  <td class="r" style="color:#ea580c">${taxEnabled ? `-${formatARS(totals.iva)}` : '—'}</td>
  <td class="r" style="color:#ea580c">${taxEnabled ? `-${formatARS(totals.iibb)}` : '—'}</td>
  ${monotributoMonthly > 0 ? `<td class="r" style="color:#ea580c">${taxEnabled ? `-${formatARS(totals.monotributo)}` : '—'}</td>` : ''}
  <td class="r" style="color:#dc2626">${taxEnabled ? `-${formatARS(totals.total)}` : '—'}</td>
  <td class="r" style="color:${totals.netProfit >= 0 ? '#16a34a' : '#dc2626'}">${formatARS(totals.netProfit)}</td>
</tr></tfoot>
</table>
<div class="disclaimer">Este reporte es orientativo. Consultá con tu contador para declaraciones oficiales ante AFIP. Sistema Gestiona.</div>
</body></html>`;
            const w = window.open('', '_blank');
            if (w) { w.document.write(html); w.document.close(); w.print(); }
          }}>
            <FileDown className="w-3.5 h-3.5 mr-1.5" />PDF Contador
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportCSV(
            'impuestos.csv',
            ['Mes', 'Ventas', 'Ganancia bruta', `IVA (${ivaRate}%)`, `IIBB (${iibbRate}%)`, 'Monotributo', 'Total impuestos', 'Ganancia neta'],
            monthlyData.map(r => [r.label, r.revenue.toFixed(0), r.profit.toFixed(0), r.iva.toFixed(0), r.iibb.toFixed(0), r.monotributo.toFixed(0), r.total.toFixed(0), r.netProfit.toFixed(0)])
          )}>
            <FileDown className="w-3.5 h-3.5 mr-1.5" />CSV
          </Button>
        </div>
      </div>

      {monthlyData.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground py-10">Sin ventas registradas</p>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm table-compact-mobile">
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

// ─────────────────────────────────────────────────────────────
// Presupuesto Tab — Meta mensual vs. Real
// ─────────────────────────────────────────────────────────────
function BudgetTab({ sales, expenses, settings, userId }: { sales: any[]; expenses: any[]; settings: any; userId: string }) {
  const [targets, setTargets] = useState({
    sales_ars: String(settings?.monthly_targets?.sales_ars || ""),
    profit_ars: String(settings?.monthly_targets?.profit_ars || ""),
    expenses_ars: String(settings?.monthly_targets?.expenses_ars || ""),
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await supabase.from("settings").update({
        monthly_targets: {
          sales_ars: Number(targets.sales_ars) || null,
          profit_ars: Number(targets.profit_ars) || null,
          expenses_ars: Number(targets.expenses_ars) || null,
        },
      }).eq("user_id", userId);
      toast.success("Metas guardadas");
    } catch { toast.error("Error al guardar metas"); }
    finally { setSaving(false); }
  };

  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  const monthlyActual = useMemo(() => {
    const salesMap: Record<string, number> = {};
    const profitMap: Record<string, number> = {};
    const expMap: Record<string, number> = {};
    sales.forEach((s: any) => {
      const key = String(s.date).slice(0, 7);
      salesMap[key] = (salesMap[key] || 0) + Number(s.total_ars);
      profitMap[key] = (profitMap[key] || 0) + Number(s.profit_ars);
    });
    expenses.forEach((e: any) => {
      const key = String(e.date).slice(0, 7);
      expMap[key] = (expMap[key] || 0) + Number(e.amount_ars);
    });
    const allKeys = new Set([...Object.keys(salesMap), ...Object.keys(expMap)]);
    return Array.from(allKeys).sort().map(key => {
      const [y, mo] = key.split('-');
      return {
        key, label: `${months[parseInt(mo) - 1]} ${y.slice(2)}`,
        sales: salesMap[key] || 0,
        profit: profitMap[key] || 0,
        expenses: expMap[key] || 0,
      };
    });
  }, [sales, expenses]);

  const tSales = Number(targets.sales_ars) || 0;
  const tProfit = Number(targets.profit_ars) || 0;
  const tExpenses = Number(targets.expenses_ars) || 0;
  const hasTargets = tSales > 0 || tProfit > 0 || tExpenses > 0;

  function BudgetBar({ actual, target, color }: { actual: number; target: number; color: string }) {
    if (!target) return <span className="text-xs text-muted-foreground">Sin meta</span>;
    const pct = Math.min((actual / target) * 100, 100);
    const over = actual > target;
    return (
      <div className="space-y-0.5">
        <div className="flex justify-between text-[10px]">
          <span className={over ? "text-success font-bold" : "text-muted-foreground"}>{pct.toFixed(0)}%</span>
          <span className="text-muted-foreground">{formatARS(actual)} / {formatARS(target)}</span>
        </div>
        <div className="w-full bg-muted rounded-full h-1.5">
          <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: over ? 'hsl(152,58%,42%)' : color }} />
        </div>
      </div>
    );
  }

  const now = new Date();
  const curKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const currentMonth = monthlyActual.find(m => m.key === curKey) || { sales: 0, profit: 0, expenses: 0 };

  return (
    <div className="space-y-6">
      {/* Set targets */}
      <div className="bg-card border border-border rounded-xl p-5">
        <h3 className="font-semibold text-sm mb-4">Metas mensuales</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { key: "sales_ars" as const, label: "Meta de ventas (ARS)", color: "text-primary" },
            { key: "profit_ars" as const, label: "Meta de ganancia (ARS)", color: "text-success" },
            { key: "expenses_ars" as const, label: "Límite de gastos (ARS)", color: "text-warning" },
          ].map(f => (
            <div key={f.key}>
              <label className={`text-xs font-medium mb-1 block ${f.color}`}>{f.label}</label>
              <Input
                type="number"
                placeholder="0"
                value={targets[f.key]}
                onChange={e => setTargets(prev => ({ ...prev, [f.key]: e.target.value }))}
                className="bg-muted"
              />
            </div>
          ))}
        </div>
        <Button className="mt-4 gradient-gold text-primary-foreground gap-2" onClick={handleSave} disabled={saving}>
          {saving ? "Guardando…" : "Guardar metas"}
        </Button>
      </div>

      {/* Current month progress */}
      {hasTargets && (
        <div className="bg-card border border-border rounded-xl p-5">
          <h3 className="font-semibold text-sm mb-4">Mes actual</h3>
          <div className="space-y-4">
            {tSales > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Ventas</p>
                <BudgetBar actual={currentMonth.sales} target={tSales} color="hsl(40,70%,50%)" />
              </div>
            )}
            {tProfit > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Ganancia bruta</p>
                <BudgetBar actual={currentMonth.profit} target={tProfit} color="hsl(152,58%,42%)" />
              </div>
            )}
            {tExpenses > 0 && (
              <div>
                <p className="text-xs text-muted-foreground mb-1.5">Gastos (límite)</p>
                <BudgetBar actual={currentMonth.expenses} target={tExpenses} color="hsl(30,80%,55%)" />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Monthly comparison table */}
      {monthlyActual.length > 0 && hasTargets && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold text-sm">Historial vs. meta</h3>
            <Button variant="outline" size="sm" onClick={() => exportCSV(
              'presupuesto_vs_real.csv',
              ['Mes', 'Ventas real', 'Meta ventas', '% cumpl.', 'Ganancia real', 'Meta ganancia', 'Gastos real', 'Límite gastos'],
              monthlyActual.map(r => [r.label, r.sales.toFixed(0), tSales.toFixed(0), tSales > 0 ? ((r.sales / tSales) * 100).toFixed(1) : '—', r.profit.toFixed(0), tProfit.toFixed(0), r.expenses.toFixed(0), tExpenses.toFixed(0)])
            )}>
              <FileDown className="w-3.5 h-3.5 mr-1.5" />CSV
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm table-compact-mobile">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-3 py-2.5 text-left text-xs text-muted-foreground uppercase">Mes</th>
                  {tSales > 0 && <th className="px-3 py-2.5 text-right text-xs text-muted-foreground uppercase">Ventas</th>}
                  {tSales > 0 && <th className="px-3 py-2.5 text-right text-xs text-muted-foreground uppercase">% meta</th>}
                  {tProfit > 0 && <th className="px-3 py-2.5 text-right text-xs text-muted-foreground uppercase">Ganancia</th>}
                  {tProfit > 0 && <th className="px-3 py-2.5 text-right text-xs text-muted-foreground uppercase">% meta</th>}
                  {tExpenses > 0 && <th className="px-3 py-2.5 text-right text-xs text-muted-foreground uppercase">Gastos</th>}
                </tr>
              </thead>
              <tbody>
                {monthlyActual.map((row, i) => {
                  const salesPct = tSales > 0 ? (row.sales / tSales) * 100 : null;
                  const profitPct = tProfit > 0 ? (row.profit / tProfit) * 100 : null;
                  const expOver = tExpenses > 0 && row.expenses > tExpenses;
                  return (
                    <tr key={row.key} className={`border-b border-border/40 ${i % 2 === 0 ? '' : 'bg-muted/10'}`}>
                      <td className="px-3 py-2.5 font-medium">{row.label}</td>
                      {tSales > 0 && <td className="px-3 py-2.5 text-right font-mono text-xs">{formatARS(row.sales)}</td>}
                      {tSales > 0 && <td className={`px-3 py-2.5 text-right text-xs font-bold ${salesPct !== null && salesPct >= 100 ? 'text-success' : salesPct !== null && salesPct >= 75 ? 'text-warning' : 'text-destructive'}`}>
                        {salesPct !== null ? `${salesPct.toFixed(0)}%` : '—'}
                      </td>}
                      {tProfit > 0 && <td className="px-3 py-2.5 text-right font-mono text-xs text-success">{formatARS(row.profit)}</td>}
                      {tProfit > 0 && <td className={`px-3 py-2.5 text-right text-xs font-bold ${profitPct !== null && profitPct >= 100 ? 'text-success' : profitPct !== null && profitPct >= 75 ? 'text-warning' : 'text-destructive'}`}>
                        {profitPct !== null ? `${profitPct.toFixed(0)}%` : '—'}
                      </td>}
                      {tExpenses > 0 && <td className={`px-3 py-2.5 text-right font-mono text-xs font-bold ${expOver ? 'text-destructive' : 'text-success'}`}>{formatARS(row.expenses)}</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!hasTargets && (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="text-sm">Configurá tus metas mensuales arriba para ver el seguimiento real vs. presupuesto</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Auditoría Tab
// ─────────────────────────────────────────────────────────────
const ACTION_LABELS: Record<string, string> = {
  create: 'Creación', update: 'Edición', delete: 'Eliminación',
  settings_change: 'Ajuste', price_change: 'Precio', role_change: 'Rol',
};
const ENTITY_LABELS: Record<string, string> = {
  product: 'Producto', sale: 'Venta', purchase: 'Compra', debt: 'Deuda',
  settings: 'Ajustes', user_role: 'Usuario', marketing_post: 'Marketing',
  exchange: 'Canje', expense: 'Gasto',
};
const ACTION_COLORS: Record<string, string> = {
  create: 'text-success bg-success/10',
  update: 'text-primary bg-primary/10',
  delete: 'text-destructive bg-destructive/10',
  settings_change: 'text-warning bg-warning/10',
  price_change: 'text-orange-400 bg-orange-500/10',
  role_change: 'text-purple-400 bg-purple-500/10',
};

function AuditTab() {
  const { activeOrg } = useOrg();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => {
    if (!activeOrg) return;
    setLoading(true);
    (async () => {
      const { data } = await supabase
        .from('audit_logs')
        .select('id, action, entity_type, entity_id, details, created_at, user_id')
        .eq('org_id', activeOrg.id)
        .order('created_at', { ascending: false })
        .limit(500);
      setLogs(data || []);
      setLoading(false);
    })();
  }, [activeOrg]);

  const filtered = useMemo(() => {
    let rows = logs;
    if (actionFilter !== 'all') rows = rows.filter(l => l.action === actionFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(l =>
        l.entity_type?.toLowerCase().includes(q) ||
        l.action?.toLowerCase().includes(q) ||
        JSON.stringify(l.details || {}).toLowerCase().includes(q)
      );
    }
    return rows;
  }, [logs, search, actionFilter]);

  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const handleExport = () => {
    exportCSV('auditoria.csv', ['Fecha', 'Acción', 'Entidad', 'ID', 'Detalles'], filtered.map(l => [
      new Date(l.created_at).toLocaleString('es-AR'),
      ACTION_LABELS[l.action] || l.action,
      ENTITY_LABELS[l.entity_type] || l.entity_type,
      l.entity_id || '',
      JSON.stringify(l.details || {}),
    ]));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          <Input placeholder="Buscar en log…" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} className="w-48 h-8 text-sm" />
          <Select value={actionFilter} onValueChange={v => { setActionFilter(v); setPage(0); }}>
            <SelectTrigger className="h-8 w-36 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las acciones</SelectItem>
              {Object.entries(ACTION_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport} disabled={filtered.length === 0}>
          <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />Exportar CSV
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Cargando log de auditoría…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <Shield className="w-10 h-10 mx-auto mb-3 text-muted-foreground/20" />
          <p className="text-muted-foreground text-sm">Sin registros de auditoría para este filtro</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Fecha</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Acción</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Entidad</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden sm:table-cell">Detalles</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((log) => (
                  <tr key={log.id} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${ACTION_COLORS[log.action] || 'text-muted-foreground bg-muted'}`}>
                        {ACTION_LABELS[log.action] || log.action}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-medium">
                      {ENTITY_LABELS[log.entity_type] || log.entity_type}
                      {log.entity_id && <span className="ml-1.5 text-[10px] text-muted-foreground font-mono">{String(log.entity_id).slice(0, 8)}…</span>}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell max-w-xs truncate">
                      {log.details && Object.keys(log.details).length > 0
                        ? Object.entries(log.details).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' · ')
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{filtered.length} registros</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</Button>
                <span className="self-center">Pág {page + 1} / {totalPages}</span>
                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Flujo de Caja Tab
// ─────────────────────────────────────────────────────────────
function CashFlowTab({ sales, expenses, purchases }: { sales: any[]; expenses: any[]; purchases: any[] }) {
  const rows = useMemo(() => {
    const map: Record<string, { revenue: number; expensesAmt: number; purchasesAmt: number }> = {};
    const ensure = (k: string) => { if (!map[k]) map[k] = { revenue: 0, expensesAmt: 0, purchasesAmt: 0 }; };
    sales.forEach((s: any) => { const k = String(s.date).slice(0, 7); ensure(k); map[k].revenue += Number(s.total_ars || 0); });
    expenses.forEach((e: any) => { const k = String(e.date).slice(0, 7); ensure(k); map[k].expensesAmt += Number(e.amount_ars || 0); });
    purchases.filter((p: any) => !p.is_scheduled).forEach((p: any) => { const k = String(p.date).slice(0, 7); ensure(k); map[k].purchasesAmt += Number(p.total_ars || 0); });
    const sorted = Object.keys(map).sort();
    const last12 = sorted.slice(-12);
    return last12.map(key => {
      const [y, mo] = key.split('-');
      const label = new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });
      const { revenue, expensesAmt, purchasesAmt } = map[key];
      const totalOutflow = expensesAmt + purchasesAmt;
      const net = revenue - totalOutflow;
      return { key, label, revenue: Math.round(revenue), expenses: Math.round(expensesAmt), purchasesAmt: Math.round(purchasesAmt), outflow: Math.round(totalOutflow), net: Math.round(net) };
    });
  }, [sales, expenses, purchases]);

  const totals = rows.reduce((a, r) => ({ revenue: a.revenue + r.revenue, outflow: a.outflow + r.outflow, net: a.net + r.net }), { revenue: 0, outflow: 0, net: 0 });
  const positiveMonths = rows.filter(r => r.net >= 0).length;

  const tooltipStyle = { background: "hsl(220,14%,12%)", border: "1px solid hsl(220,14%,20%)", borderRadius: 8, fontSize: 12 };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Ingresos totales", value: formatARS(totals.revenue), color: "text-success" },
          { label: "Egresos totales", value: formatARS(totals.outflow), color: "text-destructive" },
          { label: "Resultado neto", value: formatARS(totals.net), color: totals.net >= 0 ? "text-success" : "text-destructive" },
          { label: "Meses positivos", value: `${positiveMonths} / ${rows.length}`, color: positiveMonths === rows.length ? "text-success" : positiveMonths > rows.length / 2 ? "text-warning" : "text-destructive" },
        ].map(k => (
          <div key={k.label} className="bg-card border border-border rounded-xl p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{k.label}</p>
            <p className={`text-lg font-bold font-display ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {rows.length > 0 ? (
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Ingresos vs. Egresos — últimos {rows.length} meses</h3>
            <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" />Ingresos</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-rose-500 inline-block" />Egresos</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-primary inline-block" />Neto</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={rows} barGap={2} barCategoryGap="25%">
              <XAxis dataKey="label" tick={{ fill: "hsl(220,10%,55%)", fontSize: 11 }} />
              <YAxis tickFormatter={(v: number) => `$${Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} tick={{ fill: "hsl(220,10%,55%)", fontSize: 10 }} width={55} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: number, name: string) => [formatARS(v), name === "revenue" ? "Ingresos" : name === "outflow" ? "Egresos" : "Neto"]}
                labelFormatter={(l: string) => `Mes: ${l}`}
              />
              <Bar dataKey="revenue" name="revenue" fill="hsl(152,58%,42%)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="outflow" name="outflow" fill="hsl(0,72%,51%)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="net" name="net" radius={[4, 4, 0, 0]}>
                {rows.map((r, i) => <Cell key={i} fill={r.net >= 0 ? "hsl(43,86%,55%)" : "hsl(0,60%,45%)"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="text-center py-16 text-muted-foreground">
          <BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-20" />
          <p className="text-sm">Aún no hay datos suficientes para mostrar el flujo de caja</p>
        </div>
      )}

      {rows.length > 0 && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="font-semibold text-sm">Detalle mensual</h3>
            <Button variant="outline" size="sm" onClick={() => exportCSV(
              'flujo_de_caja.csv',
              ['Mes', 'Ingresos ARS', 'Gastos ARS', 'Compras ARS', 'Egresos totales ARS', 'Resultado neto ARS'],
              rows.map(r => [r.label, r.revenue.toString(), r.expenses.toString(), r.purchasesAmt.toString(), r.outflow.toString(), r.net.toString()])
            )}>
              <FileDown className="w-3.5 h-3.5 mr-1.5" />CSV
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-4 py-2.5 text-left text-xs text-muted-foreground uppercase">Mes</th>
                  <th className="px-4 py-2.5 text-right text-xs text-muted-foreground uppercase">Ingresos</th>
                  <th className="px-4 py-2.5 text-right text-xs text-muted-foreground uppercase">Gastos</th>
                  <th className="px-4 py-2.5 text-right text-xs text-muted-foreground uppercase">Compras</th>
                  <th className="px-4 py-2.5 text-right text-xs text-muted-foreground uppercase">Egresos</th>
                  <th className="px-4 py-2.5 text-right text-xs text-muted-foreground uppercase">Neto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {rows.map((r, i) => (
                  <tr key={r.key} className={`${i % 2 === 0 ? '' : 'bg-muted/10'} ${r.net < 0 ? 'bg-rose-500/5' : ''}`}>
                    <td className="px-4 py-2.5 font-medium text-sm">{r.label}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-emerald-400">{formatARS(r.revenue)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">{formatARS(r.expenses)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">{formatARS(r.purchasesAmt)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs text-rose-400">{formatARS(r.outflow)}</td>
                    <td className={`px-4 py-2.5 text-right font-mono text-xs font-bold ${r.net >= 0 ? 'text-primary' : 'text-destructive'}`}>{formatARS(r.net)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                  <td className="px-4 py-2.5 text-sm">Total</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-emerald-400">{formatARS(totals.revenue)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs" colSpan={2}></td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-rose-400">{formatARS(totals.outflow)}</td>
                  <td className={`px-4 py-2.5 text-right font-mono text-xs font-bold ${totals.net >= 0 ? 'text-primary' : 'text-destructive'}`}>{formatARS(totals.net)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Rentabilidad por Producto Tab
// ─────────────────────────────────────────────────────────────
function ProductProfitabilityTab({ sales }: { sales: any[] }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"profit" | "revenue" | "units" | "margin">("profit");
  const [sortAsc, setSortAsc] = useState(false);

  const rows = useMemo(() => {
    const map: Record<string, { name: string; revenue: number; profit: number; units: number; transactions: number }> = {};
    sales.forEach((s: any) => {
      const key = s.product_name || "Sin nombre";
      if (!map[key]) map[key] = { name: key, revenue: 0, profit: 0, units: 0, transactions: 0 };
      map[key].revenue += Number(s.total_ars);
      map[key].profit += Number(s.profit_ars);
      map[key].units += Number(s.quantity);
      map[key].transactions++;
    });
    return Object.values(map).map(r => ({ ...r, margin: r.revenue > 0 ? (r.profit / r.revenue) * 100 : 0 }));
  }, [sales]);

  const filtered = useMemo(() => {
    let list = search ? rows.filter(r => r.name.toLowerCase().includes(search.toLowerCase())) : rows;
    list = [...list].sort((a, b) => {
      const diff = (a[sortKey] as number) - (b[sortKey] as number);
      return sortAsc ? diff : -diff;
    });
    return list;
  }, [rows, search, sortKey, sortAsc]);

  const totals = useMemo(() => filtered.reduce((acc, r) => ({
    revenue: acc.revenue + r.revenue,
    profit: acc.profit + r.profit,
    units: acc.units + r.units,
  }), { revenue: 0, profit: 0, units: 0 }), [filtered]);

  const handleExport = () => {
    const csvRows = [
      ["Producto", "Facturación ARS", "Ganancia ARS", "Margen %", "Unidades", "Transacciones"],
      ...filtered.map(r => [r.name, r.revenue.toFixed(2), r.profit.toFixed(2), r.margin.toFixed(1), r.units, r.transactions]),
    ];
    const csv = csvRows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rentabilidad_productos_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${filtered.length} productos exportados`);
  };

  const toggle = (key: typeof sortKey) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
  };

  const top5 = [...rows].sort((a, b) => b.profit - a.profit).slice(0, 5);

  if (sales.length === 0) return (
    <div className="text-center py-16 text-muted-foreground">
      <Package className="w-10 h-10 mx-auto mb-3 opacity-40" />
      <p className="text-sm">Sin ventas en el período seleccionado</p>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Top 5 bar chart */}
      {top5.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Top 5 por Ganancia</p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={top5} layout="vertical" margin={{ left: 8, right: 16 }}>
              <XAxis type="number" tickFormatter={v => formatARS(v)} tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: any) => formatARS(Number(v))} />
              <Bar dataKey="profit" radius={[0, 4, 4, 0]}>
                {top5.map((_, i) => <Cell key={i} fill={`hsl(${45 - i * 6}, 80%, ${55 - i * 4}%)`} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center justify-between">
        <Input
          placeholder="Buscar producto..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-muted h-8 text-sm w-full sm:w-64"
        />
        <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5 shrink-0">
          <FileSpreadsheet className="w-3.5 h-3.5" />Exportar CSV
        </Button>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Producto</th>
                {(["revenue", "profit", "margin", "units"] as const).map(k => (
                  <th key={k} className="text-right px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer hover:text-foreground transition-colors" onClick={() => toggle(k)}>
                    <span className="flex items-center justify-end gap-1">
                      {k === "revenue" ? "Facturación" : k === "profit" ? "Ganancia" : k === "margin" ? "Margen %" : "Unidades"}
                      <ArrowUpDown className={`w-3 h-3 ${sortKey === k ? "text-primary" : "opacity-40"}`} />
                    </span>
                  </th>
                ))}
                <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Ventas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r, i) => (
                <tr key={r.name} className={`hover:bg-muted/20 transition-colors ${i === 0 && sortKey === "profit" && !sortAsc ? "bg-primary/5" : ""}`}>
                  <td className="px-4 py-2.5 font-medium text-sm max-w-[200px] truncate" title={r.name}>
                    {i === 0 && sortKey === "profit" && !sortAsc && <span className="mr-1">🥇</span>}
                    {r.name}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs">{formatARS(r.revenue)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-emerald-400">{formatARS(r.profit)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${r.margin >= 40 ? "bg-emerald-500/15 text-emerald-400" : r.margin >= 20 ? "bg-yellow-500/15 text-yellow-400" : "bg-red-500/15 text-red-400"}`}>
                      {r.margin.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{r.units}</td>
                  <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{r.transactions}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                <td className="px-4 py-2.5 text-sm">Total ({filtered.length} productos)</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{formatARS(totals.revenue)}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs text-emerald-400">{formatARS(totals.profit)}</td>
                <td className="px-4 py-2.5 text-right text-xs">
                  <span className="text-xs font-semibold">{totals.revenue > 0 ? ((totals.profit / totals.revenue) * 100).toFixed(1) : "0.0"}%</span>
                </td>
                <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{totals.units}</td>
                <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{filtered.reduce((s, r) => s + r.transactions, 0)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Ventas por Categoría Tab
// ─────────────────────────────────────────────────────────────
const CATEGORY_PALETTE = [
  "hsl(40,70%,50%)", "hsl(150,60%,40%)", "hsl(200,70%,55%)", "hsl(280,60%,55%)",
  "hsl(0,65%,55%)", "hsl(60,70%,50%)", "hsl(25,70%,50%)", "hsl(320,60%,50%)",
  "hsl(180,60%,45%)", "hsl(100,55%,40%)",
];

function SalesByCategoryTab({ sales, products, period }: { sales: any[]; products: any[]; period: string }) {
  const [sortKey, setSortKey] = useState<"revenue" | "profit" | "margin" | "units">("revenue");
  const [sortAsc, setSortAsc] = useState(false);

  const productCatMap = useMemo(() => {
    const m: Record<string, string> = {};
    products.forEach((p: any) => { if (p.id) m[p.id] = p.category || "sin_categoria"; });
    return m;
  }, [products]);

  const rows = useMemo(() => {
    const byCat: Record<string, { revenue: number; profit: number; units: number; transactions: number }> = {};
    sales.forEach((s: any) => {
      const cat = productCatMap[s.product_id] || "sin_categoria";
      if (!byCat[cat]) byCat[cat] = { revenue: 0, profit: 0, units: 0, transactions: 0 };
      byCat[cat].revenue += Number(s.total_ars) || 0;
      byCat[cat].profit += Number(s.profit_ars) || 0;
      byCat[cat].units += Number(s.quantity) || 1;
      byCat[cat].transactions++;
    });
    return Object.entries(byCat).map(([cat, d]) => ({
      cat,
      label: getCategoryLabel(cat),
      revenue: d.revenue,
      profit: d.profit,
      margin: d.revenue > 0 ? (d.profit / d.revenue) * 100 : 0,
      units: d.units,
      transactions: d.transactions,
    })).sort((a, b) => (sortAsc ? 1 : -1) * (a[sortKey] - b[sortKey]));
  }, [sales, productCatMap, sortKey, sortAsc]);

  const totals = useMemo(() => ({
    revenue: rows.reduce((s, r) => s + r.revenue, 0),
    profit: rows.reduce((s, r) => s + r.profit, 0),
    units: rows.reduce((s, r) => s + r.units, 0),
  }), [rows]);

  const top8 = useMemo(() => [...rows].sort((a, b) => b.revenue - a.revenue).slice(0, 8), [rows]);
  const tooltipStyle = { background: "hsl(220, 18%, 12%)", border: "1px solid hsl(220, 15%, 18%)", borderRadius: 8 };
  const handleSort = (k: typeof sortKey) => { if (sortKey === k) setSortAsc(!sortAsc); else { setSortKey(k); setSortAsc(false); } };

  const exportCat = () => exportCSV(`ventas-por-categoria-${period}.csv`,
    ["Categoría", "Ingresos ARS", "Ganancia ARS", "Margen %", "Unidades", "Transacciones"],
    rows.map(r => [r.label, Math.round(r.revenue).toString(), Math.round(r.profit).toString(), r.margin.toFixed(1), r.units.toString(), r.transactions.toString()])
  );

  if (rows.length === 0) return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
      <BarChart2 className="w-10 h-10 mb-3 opacity-30" />
      <p className="text-sm">Sin ventas en el período seleccionado</p>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Ingresos totales", value: formatARS(totals.revenue), color: "text-primary" },
          { label: "Ganancia bruta", value: formatARS(totals.profit), color: "text-success" },
          { label: "Margen promedio", value: `${totals.revenue > 0 ? ((totals.profit / totals.revenue) * 100).toFixed(1) : "0"}%`, color: "text-warning" },
          { label: "Categorías activas", value: rows.length, color: "text-blue-400" },
        ].map(k => (
          <div key={k.label} className="bg-card border border-border rounded-lg p-3 md:p-4">
            <p className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wider mb-1">{k.label}</p>
            <p className={`text-lg md:text-xl font-bold font-display ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {top8.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="text-sm font-display font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Ingresos por categoría — {period}</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={top8} layout="vertical">
              <XAxis type="number" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fill: "hsl(220,10%,55%)", fontSize: 10 }} />
              <YAxis type="category" dataKey="label" width={120} tick={{ fill: "hsl(220,10%,55%)", fontSize: 10 }} tickFormatter={(v: string) => v.length > 20 ? v.slice(0, 20) + "…" : v} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatARS(v), "Ingresos"]} />
              <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                {top8.map((_, i) => <Cell key={i} fill={CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={exportCat}><FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />Exportar CSV</Button>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Categoría</th>
                {(["revenue", "profit", "margin", "units"] as const).map(k => (
                  <th key={k} className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground transition-colors"
                    onClick={() => handleSort(k)}>
                    {k === "revenue" ? "Ingresos" : k === "profit" ? "Ganancia" : k === "margin" ? "Margen" : "Unidades"}
                    {sortKey === k ? (sortAsc ? " ▲" : " ▼") : ""}
                  </th>
                ))}
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">% del total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r, i) => {
                const pct = totals.revenue > 0 ? (r.revenue / totals.revenue) * 100 : 0;
                return (
                  <tr key={r.cat} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length] }} />
                        <span className="font-medium">{r.label}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{formatARS(r.revenue)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-emerald-400">{formatARS(r.profit)}</td>
                    <td className="px-4 py-3 text-right text-xs">
                      <span className={`font-semibold ${r.margin >= 30 ? "text-emerald-400" : r.margin >= 15 ? "text-warning" : "text-destructive"}`}>{r.margin.toFixed(1)}%</span>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">{r.units}</td>
                    <td className="px-4 py-3 text-right text-xs">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-muted-foreground w-10 text-right">{pct.toFixed(1)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                <td className="px-4 py-2.5 text-sm">Total ({rows.length} categorías)</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{formatARS(totals.revenue)}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs text-emerald-400">{formatARS(totals.profit)}</td>
                <td className="px-4 py-2.5 text-right text-xs">
                  <span className="font-semibold">{totals.revenue > 0 ? ((totals.profit / totals.revenue) * 100).toFixed(1) : "0.0"}%</span>
                </td>
                <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{totals.units}</td>
                <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Suppliers Tab
// ─────────────────────────────────────────────────────────────
function SuppliersTab({ purchases }: { purchases: any[] }) {
  const navigate = useNavigate();

  const supplierData = useMemo(() => {
    const map: Record<string, { name: string; totalUSD: number; totalARS: number; count: number; lastDate: string }> = {};
    for (const p of purchases) {
      const name = p.supplier || "Sin proveedor";
      if (!map[name]) map[name] = { name, totalUSD: 0, totalARS: 0, count: 0, lastDate: "" };
      map[name].totalUSD += Number(p.total_cost_usd) || 0;
      map[name].totalARS += Number(p.total_cost_ars) || 0;
      map[name].count += 1;
      if (!map[name].lastDate || p.date > map[name].lastDate) map[name].lastDate = p.date;
    }
    return Object.values(map).sort((a, b) => b.totalUSD - a.totalUSD);
  }, [purchases]);

  const totalUSD = supplierData.reduce((s, r) => s + r.totalUSD, 0);

  if (!supplierData.length) return (
    <div className="text-center py-16 text-muted-foreground">
      <p>No hay compras registradas aún.</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Compras por proveedor</h3>
          <p className="text-xs text-muted-foreground">{supplierData.length} proveedores · Total: U$S {totalUSD.toFixed(0)}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => navigate('/proveedores')} className="text-xs">
          Ir a Proveedores →
        </Button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left p-3 font-medium">Proveedor</th>
              <th className="text-right p-3 font-medium">Compras</th>
              <th className="text-right p-3 font-medium">Total U$S</th>
              <th className="text-right p-3 font-medium">Total ARS</th>
              <th className="text-right p-3 font-medium">Promedio U$S</th>
              <th className="text-right p-3 font-medium">Última compra</th>
              <th className="text-right p-3 font-medium">Share</th>
            </tr>
          </thead>
          <tbody>
            {supplierData.map(s => {
              const share = totalUSD > 0 ? (s.totalUSD / totalUSD) * 100 : 0;
              return (
                <tr key={s.name} className="border-b border-border last:border-0 hover:bg-muted/20">
                  <td className="p-3 font-medium">{s.name}</td>
                  <td className="p-3 text-right text-muted-foreground">{s.count}</td>
                  <td className="p-3 text-right font-semibold text-warning">U$S {s.totalUSD.toFixed(0)}</td>
                  <td className="p-3 text-right text-muted-foreground">{s.totalARS > 0 ? `$${Math.round(s.totalARS).toLocaleString('es-AR')}` : "—"}</td>
                  <td className="p-3 text-right text-muted-foreground">U$S {(s.totalUSD / s.count).toFixed(0)}</td>
                  <td className="p-3 text-right text-muted-foreground">{s.lastDate ? new Date(s.lastDate).toLocaleDateString('es-AR') : "—"}</td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-warning rounded-full" style={{ width: `${share}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground w-8 text-right">{share.toFixed(0)}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Comparativa de Períodos Tab
// ─────────────────────────────────────────────────────────────
function ComparePeriodTab({ sales, expenses }: { sales: any[]; expenses: any[] }) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const [aFrom, setAFrom] = useState(fmt(new Date(y, m, 1)));
  const [aTo, setATo] = useState(fmt(new Date(y, m + 1, 0)));
  const [bFrom, setBFrom] = useState(fmt(new Date(y, m - 1, 1)));
  const [bTo, setBTo] = useState(fmt(new Date(y, m, 0)));

  const calcPeriod = (from: string, to: string) => {
    const f = new Date(from + 'T00:00:00');
    const t = new Date(to + 'T23:59:59');
    const inRange = (d: string) => { const x = new Date(d); return x >= f && x <= t; };
    const ps = sales.filter((s: any) => inRange(s.date));
    const pe = expenses.filter((e: any) => inRange(e.date));
    const revenue = ps.reduce((a: number, s: any) => a + Number(s.total_ars || 0), 0);
    const profit = ps.reduce((a: number, s: any) => a + Number(s.profit_ars || 0), 0);
    const expAmt = pe.reduce((a: number, e: any) => a + Number(e.amount_ars || 0), 0);
    const units = ps.reduce((a: number, s: any) => a + Number(s.quantity || 1), 0);
    const count = ps.length;
    const margin = revenue > 0 ? (profit / revenue) * 100 : 0;
    const ticket = count > 0 ? revenue / count : 0;
    const netResult = profit - expAmt;
    return { revenue, profit, expAmt, units, count, margin, ticket, netResult };
  };

  const A = useMemo(() => calcPeriod(aFrom, aTo), [aFrom, aTo, sales, expenses]);
  const B = useMemo(() => calcPeriod(bFrom, bTo), [bFrom, bTo, sales, expenses]);

  const diff = (a: number, b: number) => b === 0 ? null : ((a - b) / Math.abs(b)) * 100;
  const DiffBadge = ({ a, b, invert = false }: { a: number; b: number; invert?: boolean }) => {
    const d = diff(a, b);
    if (d === null) return <span className="text-[10px] text-muted-foreground">—</span>;
    const positive = invert ? d < 0 : d >= 0;
    return (
      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${positive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
        {d >= 0 ? '+' : ''}{d.toFixed(1)}%
      </span>
    );
  };

  const metrics = [
    { label: 'Facturado (ARS)', a: A.revenue, b: B.revenue, fmt: formatARS },
    { label: 'Ganancia bruta (ARS)', a: A.profit, b: B.profit, fmt: formatARS },
    { label: 'Gastos (ARS)', a: A.expAmt, b: B.expAmt, fmt: formatARS, invert: true },
    { label: 'Resultado neto (ARS)', a: A.netResult, b: B.netResult, fmt: formatARS },
    { label: 'Margen bruto', a: A.margin, b: B.margin, fmt: (n: number) => `${n.toFixed(1)}%` },
    { label: 'Ticket promedio (ARS)', a: A.ticket, b: B.ticket, fmt: formatARS },
    { label: 'Unidades vendidas', a: A.units, b: B.units, fmt: (n: number) => n.toString() },
    { label: 'Transacciones', a: A.count, b: B.count, fmt: (n: number) => n.toString() },
  ];

  const chartData = [
    { metric: 'Facturado', A: Math.round(A.revenue), B: Math.round(B.revenue) },
    { metric: 'Ganancia', A: Math.round(A.profit), B: Math.round(B.profit) },
    { metric: 'Gastos', A: Math.round(A.expAmt), B: Math.round(B.expAmt) },
    { metric: 'Neto', A: Math.round(A.netResult), B: Math.round(B.netResult) },
  ];

  const ttStyle = { background: "hsl(220,14%,12%)", border: "1px solid hsl(220,14%,20%)", borderRadius: 8, fontSize: 12 };

  return (
    <div className="space-y-6">
      {/* Period pickers */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-card border border-primary/30 rounded-xl p-4 space-y-2">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide">Período A</p>
          <div className="flex gap-2 flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">Desde</label>
              <input type="date" value={aFrom} onChange={e => setAFrom(e.target.value)} className="h-8 text-xs px-2 rounded-md border border-border bg-muted/50 text-foreground" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">Hasta</label>
              <input type="date" value={aTo} onChange={e => setATo(e.target.value)} className="h-8 text-xs px-2 rounded-md border border-border bg-muted/50 text-foreground" />
            </div>
          </div>
        </div>
        <div className="bg-card border border-muted rounded-xl p-4 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Período B</p>
          <div className="flex gap-2 flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">Desde</label>
              <input type="date" value={bFrom} onChange={e => setBFrom(e.target.value)} className="h-8 text-xs px-2 rounded-md border border-border bg-muted/50 text-foreground" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">Hasta</label>
              <input type="date" value={bTo} onChange={e => setBTo(e.target.value)} className="h-8 text-xs px-2 rounded-md border border-border bg-muted/50 text-foreground" />
            </div>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Comparativa visual</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} barGap={4} barCategoryGap="30%">
            <XAxis dataKey="metric" tick={{ fill: "hsl(220,10%,55%)", fontSize: 11 }} />
            <YAxis tickFormatter={(v: number) => `$${Math.abs(v) >= 1000000 ? `${(v/1000000).toFixed(1)}M` : Math.abs(v) >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} tick={{ fill: "hsl(220,10%,55%)", fontSize: 10 }} width={60} />
            <Tooltip contentStyle={ttStyle} formatter={(v: number, name: string) => [formatARS(v), name]} />
            <Bar dataKey="A" name="Período A" fill="hsl(43,86%,55%)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="B" name="Período B" fill="hsl(220,14%,40%)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Metrics table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase tracking-wide">Métrica</th>
              <th className="px-4 py-3 text-right text-xs text-primary uppercase tracking-wide">Período A</th>
              <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase tracking-wide">Período B</th>
              <th className="px-4 py-3 text-right text-xs text-muted-foreground uppercase tracking-wide">Variación</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {metrics.map(({ label, a, b, fmt: fmtFn, invert }) => (
              <tr key={label} className="hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3 font-medium text-sm">{label}</td>
                <td className="px-4 py-3 text-right font-mono text-sm font-bold text-primary">{fmtFn(a)}</td>
                <td className="px-4 py-3 text-right font-mono text-sm text-muted-foreground">{fmtFn(b)}</td>
                <td className="px-4 py-3 text-right"><DiffBadge a={a} b={b} invert={invert} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Button variant="outline" size="sm" onClick={() => exportCSV(
          'comparativa-periodos.csv',
          ['Métrica', `Período A (${aFrom} a ${aTo})`, `Período B (${bFrom} a ${bTo})`, 'Variación %'],
          metrics.map(({ label, a, b, fmt: fmtFn }) => {
            const d = b === 0 ? '—' : `${((a - b) / Math.abs(b) * 100).toFixed(1)}%`;
            return [label, fmtFn(a), fmtFn(b), d];
          })
        )}>
          <FileDown className="w-3.5 h-3.5 mr-1.5" />Exportar CSV
        </Button>
        <Button variant="outline" size="sm" onClick={() => {
          const labelA = `${aFrom} → ${aTo}`;
          const labelB = `${bFrom} → ${bTo}`;
          const tableRows = metrics.map(({ label, a, b, fmt: fmtFn }) => {
            const d = b === 0 ? '—' : `${((a - b) / Math.abs(b) * 100).toFixed(1)}%`;
            return `<tr><td>${label}</td><td style="text-align:right;font-weight:600">${fmtFn(a)}</td><td style="text-align:right;color:#888">${fmtFn(b)}</td><td style="text-align:right;color:${b > 0 && a >= b ? '#4ade80' : '#f87171'}">${d}</td></tr>`;
          }).join('');
          const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Comparativa de períodos</title>
<style>body{font-family:Arial,sans-serif;margin:24px;color:#111}h1{font-size:16px;margin-bottom:4px}p{font-size:12px;color:#666;margin:0 0 12px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:7px 10px;font-size:12px}th{background:#f0f0f0;font-weight:600;text-align:left}th:not(:first-child){text-align:right}@media print{body{margin:0}}</style></head>
<body><h1>Comparativa de Períodos</h1><p>Generado: ${new Date().toLocaleDateString('es-AR')}</p>
<table><thead><tr><th>Métrica</th><th>Período A<br/><small style="font-weight:400;color:#888">${labelA}</small></th><th>Período B<br/><small style="font-weight:400;color:#888">${labelB}</small></th><th>Variación</th></tr></thead><tbody>${tableRows}</tbody></table></body></html>`;
          const w = window.open('', '_blank');
          if (w) { w.document.write(html); w.document.close(); w.print(); }
        }}>
          <FileDown className="w-3.5 h-3.5 mr-1.5" />Imprimir / PDF
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sucursales Tab — stock + transfers by location
// ─────────────────────────────────────────────────────────────
function SucursalesTab({ sales }: { sales: any[] }) {
  const { activeOrg } = useOrg();
  const [locations, setLocations] = useState<any[]>([]);
  const [locationStock, setLocationStock] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    if (!activeOrg) return;
    (async () => {
      setLoading(true);
      const [{ data: locs }, { data: ls }, { data: tr }] = await Promise.all([
        supabase.from("locations").select("id, name, address, is_main, active").eq("org_id", activeOrg.id).eq("active", true).order("is_main", { ascending: false }),
        supabase.from("location_stock").select("location_id, product_id, stock").eq("org_id", activeOrg.id),
        supabase.from("stock_transfers").select("id, from_location_id, to_location_id, product_id, quantity, created_at, notes").eq("org_id", activeOrg.id).order("created_at", { ascending: false }).limit(20),
      ]);
      setLocations(locs || []);
      setLocationStock(ls || []);
      setTransfers(tr || []);
      setLoading(false);
    })();
  }, [activeOrg?.id]);

  // Seller-based sales summary (proxy for per-branch performance)
  const sellerSummary = useMemo(() => {
    const map: Record<string, { total: number; profit: number; count: number }> = {};
    sales.forEach((s: any) => {
      const seller = s.seller_name || "(Sin asignar)";
      if (!map[seller]) map[seller] = { total: 0, profit: 0, count: 0 };
      map[seller].total += Number(s.total_ars);
      map[seller].profit += Number(s.profit_ars);
      map[seller].count++;
    });
    return Object.entries(map).sort((a, b) => b[1].total - a[1].total).map(([name, d]) => ({ name, ...d }));
  }, [sales]);

  const totalSales = sellerSummary.reduce((a, s) => a + s.total, 0);

  // Stock per location
  const stockByLocation = useMemo(() => {
    return locations.map(loc => {
      const items = locationStock.filter(ls => ls.location_id === loc.id);
      const totalUnits = items.reduce((a, ls) => a + Number(ls.stock), 0);
      const productCount = items.filter(ls => ls.stock > 0).length;
      return { ...loc, totalUnits, productCount, items };
    });
  }, [locations, locationStock]);

  if (loading) return <div className="py-16 text-center text-muted-foreground">Cargando datos de sucursales…</div>;

  if (!locations.length) return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-4">
      <MapPin className="w-12 h-12 opacity-20" />
      <div className="text-center">
        <p className="font-medium">No tenés sucursales configuradas</p>
        <p className="text-sm mt-1">Creá tus ubicaciones para ver stock y comparativas por local.</p>
      </div>
      <Button size="sm" variant="outline" onClick={() => navigate('/locations')}>
        Ir a Ubicaciones →
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Location stock overview */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
          <MapPin className="w-4 h-4" />Stock por sucursal
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {stockByLocation.map(loc => (
            <div key={loc.id} className={`bg-card border rounded-xl p-4 ${loc.is_main ? 'border-primary/30' : 'border-border'}`}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-semibold text-sm flex items-center gap-1.5">
                    {loc.name}
                    {loc.is_main && <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-full font-semibold">Principal</span>}
                  </p>
                  {loc.address && <p className="text-[10px] text-muted-foreground mt-0.5">{loc.address}</p>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div className="bg-muted/40 rounded-lg p-2 text-center">
                  <p className="text-lg font-bold">{loc.totalUnits}</p>
                  <p className="text-[10px] text-muted-foreground">Unidades</p>
                </div>
                <div className="bg-muted/40 rounded-lg p-2 text-center">
                  <p className="text-lg font-bold">{loc.productCount}</p>
                  <p className="text-[10px] text-muted-foreground">Productos</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Seller sales comparison */}
      {sellerSummary.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <Users className="w-4 h-4" />Ventas por vendedor
          </h3>
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-medium">Vendedor</th>
                  <th className="text-right p-3 font-medium">Ventas</th>
                  <th className="text-right p-3 font-medium">Facturado</th>
                  <th className="text-right p-3 font-medium">Ganancia</th>
                  <th className="text-right p-3 font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {sellerSummary.map(s => {
                  const share = totalSales > 0 ? (s.total / totalSales) * 100 : 0;
                  return (
                    <tr key={s.name} className="border-t border-border/40 hover:bg-muted/20 transition-colors">
                      <td className="p-3 font-medium">{s.name}</td>
                      <td className="p-3 text-right text-muted-foreground">{s.count}</td>
                      <td className="p-3 text-right font-semibold">{formatARS(s.total)}</td>
                      <td className="p-3 text-right text-success">{formatARS(s.profit)}</td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-20 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full" style={{ width: `${share}%` }} />
                          </div>
                          <span className="text-xs text-muted-foreground w-8 text-right">{share.toFixed(0)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-muted-foreground mt-2">Las ventas por vendedor actúan como indicador de performance por sucursal cuando cada vendedor trabaja en una ubicación específica.</p>
        </div>
      )}

      {/* Recent transfers */}
      {transfers.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
            <ArrowUpDown className="w-4 h-4" />Transferencias recientes entre sucursales
          </h3>
          <div className="space-y-2">
            {transfers.slice(0, 10).map(t => {
              const from = locations.find(l => l.id === t.from_location_id)?.name || "—";
              const to = locations.find(l => l.id === t.to_location_id)?.name || "—";
              return (
                <div key={t.id} className="flex items-center gap-3 bg-card border border-border rounded-lg p-3 text-sm">
                  <div className="flex-1">
                    <span className="font-medium">{from}</span>
                    <span className="text-muted-foreground mx-2">→</span>
                    <span className="font-medium">{to}</span>
                    <span className="ml-2 text-muted-foreground">· {t.quantity} u.</span>
                    {t.notes && <span className="ml-2 text-muted-foreground text-xs italic">{t.notes}</span>}
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {new Date(t.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Tendencia de Márgenes Tab
// ─────────────────────────────────────────────────────────────
function MarginTrendTab({ sales, expenses }: { sales: any[]; expenses: any[] }) {
  const [months, setMonths] = useState(12);

  const chartData = useMemo(() => {
    const now = new Date();
    const result: { month: string; label: string; revenue: number; grossProfit: number; net: number; grossMargin: number; netMargin: number; expenses: number }[] = [];

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });

      const monthSales = sales.filter((s: any) => String(s.date).slice(0, 7) === key);
      const monthExpenses = expenses.filter((e: any) => String(e.date).slice(0, 7) === key);

      const revenue = monthSales.reduce((acc: number, s: any) => acc + Number(s.total_ars), 0);
      const grossProfit = monthSales.reduce((acc: number, s: any) => acc + Number(s.profit_ars), 0);
      const totalExpenses = monthExpenses.reduce((acc: number, e: any) => acc + Number(e.amount_ars), 0);
      const net = grossProfit - totalExpenses;

      result.push({
        month: key,
        label,
        revenue,
        grossProfit,
        net,
        expenses: totalExpenses,
        grossMargin: revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0,
        netMargin: revenue > 0 ? Math.round((net / revenue) * 1000) / 10 : 0,
      });
    }
    return result;
  }, [sales, expenses, months]);

  const withRevenue = chartData.filter(d => d.revenue > 0);
  const avgGrossMargin = withRevenue.length > 0
    ? withRevenue.reduce((acc, d) => acc + d.grossMargin, 0) / withRevenue.length
    : 0;
  const bestMonth = [...withRevenue].sort((a, b) => b.grossMargin - a.grossMargin)[0];
  const worstMonth = [...withRevenue].sort((a, b) => a.grossMargin - b.grossMargin)[0];
  const lastMonth = chartData[chartData.length - 1];
  const prevMonth = chartData[chartData.length - 2];
  const trend = lastMonth && prevMonth && prevMonth.revenue > 0 ? lastMonth.grossMargin - prevMonth.grossMargin : 0;

  const fmtARS = (v: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(v);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Tendencia de Márgenes</h3>
        <select
          value={months}
          onChange={e => setMonths(Number(e.target.value))}
          className="text-xs border border-border rounded px-2 py-1 bg-background text-foreground"
        >
          <option value={3}>3 meses</option>
          <option value={6}>6 meses</option>
          <option value={12}>12 meses</option>
          <option value={24}>24 meses</option>
        </select>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-lg p-3 text-center">
          <p className="text-xs text-muted-foreground mb-1">Margen bruto promedio</p>
          <p className="text-xl font-bold text-primary">{avgGrossMargin.toFixed(1)}%</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 text-center">
          <p className="text-xs text-muted-foreground mb-1">Margen mes actual</p>
          <p className={`text-xl font-bold ${(lastMonth?.grossMargin ?? 0) >= 30 ? 'text-success' : (lastMonth?.grossMargin ?? 0) >= 15 ? 'text-amber-400' : 'text-destructive'}`}>
            {lastMonth?.revenue > 0 ? `${lastMonth.grossMargin.toFixed(1)}%` : '—'}
          </p>
          {prevMonth?.revenue > 0 && (
            <p className={`text-[10px] mt-0.5 ${trend >= 0 ? 'text-success' : 'text-destructive'}`}>
              {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(1)}pp vs anterior
            </p>
          )}
        </div>
        <div className="bg-card border border-border rounded-lg p-3 text-center">
          <p className="text-xs text-muted-foreground mb-1">Mejor mes</p>
          <p className="text-xl font-bold text-success">{bestMonth ? `${bestMonth.grossMargin.toFixed(1)}%` : '—'}</p>
          <p className="text-[10px] text-muted-foreground">{bestMonth?.label}</p>
        </div>
        <div className="bg-card border border-border rounded-lg p-3 text-center">
          <p className="text-xs text-muted-foreground mb-1">Peor mes</p>
          <p className="text-xl font-bold text-destructive">{worstMonth ? `${worstMonth.grossMargin.toFixed(1)}%` : '—'}</p>
          <p className="text-[10px] text-muted-foreground">{worstMonth?.label}</p>
        </div>
      </div>

      {/* Gross margin % line chart */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h4 className="text-sm font-semibold mb-3">Margen bruto mensual (%)</h4>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#888' }} />
            <YAxis tick={{ fontSize: 10, fill: '#888' }} unit="%" domain={[0, 'auto']} />
            <Tooltip
              formatter={(v: number) => [`${v.toFixed(1)}%`, 'Margen bruto']}
              contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
            />
            <ReferenceLine y={avgGrossMargin} stroke="#888" strokeDasharray="4 2" label={{ value: `Prom ${avgGrossMargin.toFixed(0)}%`, fill: '#888', fontSize: 10 }} />
            <Line type="monotone" dataKey="grossMargin" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 4, fill: '#f59e0b' }} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Net margin line chart */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h4 className="text-sm font-semibold mb-1">Margen neto mensual (%) <span className="text-xs font-normal text-muted-foreground">descontando gastos operativos</span></h4>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#888' }} />
            <YAxis tick={{ fontSize: 10, fill: '#888' }} unit="%" />
            <Tooltip
              formatter={(v: number) => [`${v.toFixed(1)}%`, 'Margen neto']}
              contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
            />
            <ReferenceLine y={0} stroke="#555" />
            <Line type="monotone" dataKey="netMargin" stroke="#22c55e" strokeWidth={2} dot={{ r: 3, fill: '#22c55e' }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Revenue + gross profit bar */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h4 className="text-sm font-semibold mb-3">Ganancia bruta vs Gastos mensuales</h4>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#888' }} />
            <YAxis tick={{ fontSize: 10, fill: '#888' }} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
            <Tooltip
              formatter={(v: number, name: string) => [fmtARS(v), name === 'grossProfit' ? 'Ganancia bruta' : 'Gastos']}
              contentStyle={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
            />
            <Bar dataKey="grossProfit" fill="#f59e0b" radius={[3, 3, 0, 0]} name="grossProfit" />
            <Bar dataKey="expenses" fill="#ef4444" radius={[3, 3, 0, 0]} name="expenses" />
          </BarChart>
        </ResponsiveContainer>
        <div className="flex gap-4 mt-2 text-xs text-muted-foreground justify-center">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block" />Ganancia bruta</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" />Gastos</span>
        </div>
      </div>

      {/* Monthly summary table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">Mes</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">Ingresos</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">Gan. bruta</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">Gastos</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">Resultado neto</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">Mg. bruto</th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">Mg. neto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {[...chartData].reverse().map(row => (
              <tr key={row.month} className="hover:bg-muted/20 transition-colors">
                <td className="px-4 py-2.5 font-medium text-xs">{row.label}</td>
                <td className="px-4 py-2.5 text-right text-xs">{fmtARS(row.revenue)}</td>
                <td className="px-4 py-2.5 text-right text-xs text-amber-400">{fmtARS(row.grossProfit)}</td>
                <td className="px-4 py-2.5 text-right text-xs text-destructive">{row.expenses > 0 ? `-${fmtARS(row.expenses)}` : '—'}</td>
                <td className={`px-4 py-2.5 text-right text-xs font-medium ${row.net >= 0 ? 'text-success' : 'text-destructive'}`}>{fmtARS(row.net)}</td>
                <td className="px-4 py-2.5 text-right text-xs">
                  <span className={`font-semibold ${row.grossMargin >= 30 ? 'text-success' : row.grossMargin >= 15 ? 'text-amber-400' : 'text-destructive'}`}>
                    {row.revenue > 0 ? `${row.grossMargin.toFixed(1)}%` : '—'}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right text-xs">
                  <span className={`font-semibold ${row.netMargin >= 10 ? 'text-success' : row.netMargin >= 0 ? 'text-amber-400' : 'text-destructive'}`}>
                    {row.revenue > 0 ? `${row.netMargin.toFixed(1)}%` : '—'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
