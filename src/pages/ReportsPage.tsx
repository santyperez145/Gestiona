import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { cotizacionDe } from "@/lib/exchangeRate";
import { calcPnLMargins } from "@/lib/businessCalc";
import { getProductsDB, getSalesDB, getPurchasesDB, getDebtsDB, getSettingsDB, getExpensesDB, saveSettingsDB, formatARS, formatUSD, getCategoryLabel, calculateTaxes, getOrgMembersWithProfilesDB } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileSpreadsheet, TrendingUp, TrendingDown, Package, DollarSign, Users, FileText, Receipt, FileDown, ArrowUpDown, Boxes, Shield, BarChart2, MapPin, Printer, Sparkles, Mail, Calendar, Check, RefreshCw, Bell, Send, Clock, FolderOpen } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { FAMILIAS_OLFATIVAS, taxLabel } from "@/lib/scentTaxonomy";
import { useFileSystemAccess } from "@/hooks/useFileSystemAccess";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, LineChart, Line, CartesianGrid, ReferenceLine, Area, AreaChart, ComposedChart } from "recharts";
import { useSalesForecaster } from "@/hooks/useSalesForecaster";
import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { usePageTitle } from "@/hooks/usePageTitle";
import { orgViewKey, usePersistedState } from "@/hooks/usePersistedState";
import DataPagination from "@/components/shared/DataPagination";

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
  usePageTitle("Reportes");
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const [reportsTab, setReportsTab] = usePersistedState(
    orgViewKey("reports.tab", activeOrg?.id),
    "overview",
  );
  const [data, setData] = useState<any>(null);
  const [period, setPeriod] = usePersistedState<PeriodKey>(
    orgViewKey("reports.period", activeOrg?.id),
    "current_month",
  );
  const [members, setMembers] = useState<any[]>([]);
  const { saveFile: fsSaveFile, supported: fsSupported } = useFileSystemAccess();

  // Enhanced CSV save: uses File System Access API (native "Save As" dialog) when available,
  // falls back to anchor-click blob download on unsupported browsers.
  const saveCSV = async (filename: string, headers: string[], rows: string[][]) => {
    const bom = '﻿';
    const csv = bom + [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
    if (fsSupported) {
      await fsSaveFile(csv, {
        suggestedName: filename,
        types: [{ description: 'CSV', accept: { 'text/csv': ['.csv'] } }],
      });
      toast.success(`${filename} guardado`);
    } else {
      exportCSV(filename, headers, rows);
    }
  };

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

  const taxes = calculateTaxes(totalSalesARS, grossProfitARS, settings);
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
  const periodTaxes = settings.tax_enabled ? calculateTaxes(periodRevenue, periodGrossProfit, settings) : { iva: 0, iibb: 0, totalTax: 0, netProfit: opBeforeTax };
  const totalTaxImpact = settings.tax_enabled ? periodTaxes.totalTax : 0;
  const netIncome = opBeforeTax - totalTaxImpact;
  const { grossMargin: grossMarginPct, netMargin: netMarginPct } = calcPnLMargins(periodRevenue, periodGrossProfit, totalOpex + totalTaxImpact);

  const handleExportProducts = () => saveCSV('productos.csv',
    ['Nombre','Marca','Categoría','Costo USD','Costo+Pasero USD','Precio ARS','Precio Oferta ARS','Ganancia ARS','Stock'],
    products.map((p: any) => [p.name, p.brand, getCategoryLabel(p.category), p.cost_usd, p.total_cost_usd, p.sale_price_ars, p.discount_price_ars || '', p.profit_per_unit_ars, p.stock])
  );
  const handleExportSales = () => saveCSV('ventas.csv',
    ['Fecha','Producto','Cliente','Cantidad','Precio Unit.','Descuento','Total ARS','Ganancia ARS','Ganancia USD','Pagado'],
    sales.map((s: any) => [s.date, s.product_name, s.customer_name || '', s.quantity, s.unit_price_ars, s.discount_applied ? 'Sí' : 'No', s.total_ars, s.profit_ars, s.profit_usd, s.paid ? 'Sí' : 'No'])
  );
  const handleExportPurchases = () => saveCSV('compras.csv',
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
    saveCSV(`PL_${new Date().getFullYear()}.csv`,
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

  // ===== PDF Reporte Mensual automático =====
  const handleMonthlyReportPDF = async () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const biz = (settings.business_name || 'Negocio').toUpperCase();
    const fmt = (n: number) => formatARS(Math.round(n));
    const fmtPct = (n: number) => `${n.toFixed(1)}%`;

    // ── Header ──────────────────────────────────────────────────────────────
    doc.setFillColor(26, 26, 46);
    doc.rect(0, 0, pageW, 72, 'F');
    doc.setTextColor(212, 168, 67);
    doc.setFontSize(20); doc.setFont('helvetica', 'bold');
    doc.text(biz, 40, 36);
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11); doc.setFont('helvetica', 'normal');
    doc.text('Reporte Mensual de Gestión', 40, 56);
    doc.setFontSize(9); doc.setTextColor(180, 180, 210);
    doc.text(`Período: ${filtered.label}  ·  Generado: ${new Date().toLocaleDateString('es-AR')}`, 40, 92);

    // Logo
    if (settings.logo_url) {
      try {
        const res = await fetch(settings.logo_url);
        const blob = await res.blob();
        const dataUrl: string = await new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result as string); rd.readAsDataURL(blob); });
        doc.addImage(dataUrl, 'PNG', pageW - 82, 14, 42, 42);
      } catch { /* ignore */ }
    }

    // ── KPI Cards row ────────────────────────────────────────────────────────
    const prevRev = prevFiltered ? prevFiltered.sales.reduce((s: number, v: any) => s + Number(v.total_ars), 0) : null;
    const prevProfit = prevFiltered ? prevFiltered.sales.reduce((s: number, v: any) => s + Number(v.profit_ars), 0) : null;

    const kpis = [
      { label: 'Facturado', value: fmt(periodRevenue), delta: prevRev != null ? periodRevenue - prevRev : null, color: [26, 26, 46] as [number,number,number] },
      { label: 'Ganancia Bruta', value: fmt(periodGrossProfit), delta: prevProfit != null ? periodGrossProfit - prevProfit : null, color: [22, 101, 52] as [number,number,number] },
      { label: 'Margen', value: fmtPct(grossMarginPct), color: [30, 60, 114] as [number,number,number] },
      { label: 'Ganancia Neta', value: fmt(netIncome), color: netIncome > 0 ? [22, 101, 52] as [number,number,number] : [153, 27, 27] as [number,number,number] },
    ];
    const kpiW = (pageW - 80) / 4;
    kpis.forEach((k, i) => {
      const x = 40 + i * (kpiW + 6.67);
      doc.setFillColor(...k.color);
      doc.roundedRect(x, 108, kpiW, 52, 4, 4, 'F');
      doc.setTextColor(180, 200, 255);
      doc.setFontSize(7.5); doc.setFont('helvetica', 'normal');
      doc.text(k.label.toUpperCase(), x + 8, 122);
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(13); doc.setFont('helvetica', 'bold');
      doc.text(k.value, x + 8, 140);
      if (k.delta != null) {
        const sign = k.delta >= 0 ? '+' : '';
        doc.setFontSize(7.5); doc.setFont('helvetica', 'normal');
        doc.setTextColor(k.delta >= 0 ? 134 : 252, k.delta >= 0 ? 239 : 165, k.delta >= 0 ? 172 : 165);
        doc.text(`${sign}${fmt(k.delta)} vs período ant.`, x + 8, 153);
      }
    });

    // ── Gastos y unidades ────────────────────────────────────────────────────
    const unitsSold = filtered.sales.reduce((s: number, v: any) => s + Number(v.quantity || 1), 0);
    autoTable(doc, {
      startY: 175,
      head: [['Métrica', 'Valor']],
      body: [
        ['Unidades vendidas', String(unitsSold)],
        ['Gastos operativos', fmt(totalOpex)],
        ['Ticket promedio', fmt(filtered.sales.length > 0 ? periodRevenue / filtered.sales.length : 0)],
        ['Ventas realizadas', String(filtered.sales.length)],
        ['Resultado operativo', fmt(periodGrossProfit - totalOpex)],
      ],
      headStyles: { fillColor: [26, 26, 46], textColor: [212, 168, 67] },
      styles: { fontSize: 9 },
      columnStyles: { 1: { halign: 'right', fontStyle: 'bold' } },
      tableWidth: (pageW - 80) / 2,
      margin: { left: 40 },
    });

    // ── Top 5 Productos ──────────────────────────────────────────────────────
    const productMap: Record<string, { revenue: number; profit: number; qty: number }> = {};
    filtered.sales.forEach((s: any) => {
      const k = s.product_name || '(sin nombre)';
      if (!productMap[k]) productMap[k] = { revenue: 0, profit: 0, qty: 0 };
      productMap[k].revenue += Number(s.total_ars);
      productMap[k].profit += Number(s.profit_ars);
      productMap[k].qty += Number(s.quantity || 1);
    });
    const topProducts = Object.entries(productMap)
      .sort(([, a], [, b]) => b.revenue - a.revenue)
      .slice(0, 5);

    const afterFirstTable = (doc as any).lastAutoTable?.finalY ?? 230;
    autoTable(doc, {
      startY: afterFirstTable + 16,
      head: [['#', 'Producto', 'Ingresos', 'Ganancia', 'Uds.']],
      body: topProducts.map(([name, v], i) => [
        String(i + 1), name, fmt(v.revenue), fmt(v.profit), String(v.qty),
      ]),
      headStyles: { fillColor: [26, 26, 46], textColor: [212, 168, 67] },
      styles: { fontSize: 9 },
      columnStyles: { 0: { cellWidth: 20 }, 2: { halign: 'right' }, 3: { halign: 'right', textColor: [22, 101, 52] }, 4: { halign: 'right' } },
      didDrawPage: (_: any) => {
        doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 26, 46);
        doc.text('Top 5 Productos', 40, afterFirstTable + 8);
      },
    });

    // ── Top 5 Clientes ───────────────────────────────────────────────────────
    const clientMap: Record<string, { revenue: number; count: number }> = {};
    filtered.sales.forEach((s: any) => {
      const k = s.customer_name || '(sin nombre)';
      if (!clientMap[k]) clientMap[k] = { revenue: 0, count: 0 };
      clientMap[k].revenue += Number(s.total_ars);
      clientMap[k].count += 1;
    });
    const topClients = Object.entries(clientMap)
      .sort(([, a], [, b]) => b.revenue - a.revenue)
      .slice(0, 5);

    const afterProducts = (doc as any).lastAutoTable?.finalY ?? 370;
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 26, 46);
    doc.text('Top 5 Clientes', 40, afterProducts + 16);
    autoTable(doc, {
      startY: afterProducts + 24,
      head: [['#', 'Cliente', 'Total ARS', 'Compras']],
      body: topClients.map(([name, v], i) => [String(i + 1), name, fmt(v.revenue), String(v.count)]),
      headStyles: { fillColor: [26, 26, 46], textColor: [212, 168, 67] },
      styles: { fontSize: 9 },
      columnStyles: { 0: { cellWidth: 20 }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    });

    // ── Métodos de pago ──────────────────────────────────────────────────────
    const payMap: Record<string, number> = {};
    filtered.sales.forEach((s: any) => {
      const k = s.payment_method || 'efectivo';
      payMap[k] = (payMap[k] || 0) + Number(s.total_ars);
    });
    const afterClients = (doc as any).lastAutoTable?.finalY ?? 500;
    if (afterClients < 650) {
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 26, 46);
      doc.text('Métodos de Pago', 40, afterClients + 16);
      autoTable(doc, {
        startY: afterClients + 24,
        head: [['Método', 'Total ARS', 'Share %']],
        body: Object.entries(payMap).sort(([, a], [, b]) => b - a).map(([m, v]) => [
          m.charAt(0).toUpperCase() + m.slice(1),
          fmt(v),
          `${periodRevenue > 0 ? ((v / periodRevenue) * 100).toFixed(1) : '0'}%`,
        ]),
        headStyles: { fillColor: [26, 26, 46], textColor: [212, 168, 67] },
        styles: { fontSize: 9 },
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      });
    }

    // ── Footer ───────────────────────────────────────────────────────────────
    const pageH = doc.internal.pageSize.getHeight();
    doc.setFontSize(7.5); doc.setTextColor(160, 160, 180); doc.setFont('helvetica', 'normal');
    doc.text('Documento generado automáticamente — uso interno / informativo.', 40, pageH - 20);

    doc.save(`reporte-mensual-${filtered.label.replace(/\s/g, '-').toLowerCase()}.pdf`);
    toast.success('Reporte mensual generado ✓');
  };

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={BarChart2}
        title="Reportes & Análisis"
        description="Métricas avanzadas, estado de resultados y exportación"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={handleMonthlyReportPDF} className="gradient-gold text-primary-foreground gap-1.5 font-semibold"><Sparkles className="w-3.5 h-3.5" />Reporte del mes PDF</Button>
            <Button variant="outline" size="sm" onClick={handleExportProducts} title={fsSupported ? "Guardar con diálogo nativo del sistema" : "Descargar CSV"}>
              {fsSupported ? <FolderOpen className="w-3.5 h-3.5 mr-1.5 text-primary" /> : <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />}Productos CSV
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportSales} title={fsSupported ? "Guardar con diálogo nativo del sistema" : "Descargar CSV"}>
              {fsSupported ? <FolderOpen className="w-3.5 h-3.5 mr-1.5 text-primary" /> : <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />}Ventas CSV
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPurchases} title={fsSupported ? "Guardar con diálogo nativo del sistema" : "Descargar CSV"}>
              {fsSupported ? <FolderOpen className="w-3.5 h-3.5 mr-1.5 text-primary" /> : <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />}Compras CSV
            </Button>
            <Button variant="outline" size="sm" onClick={handlePDFSales}><FileText className="w-3.5 h-3.5 mr-1.5" />Ventas PDF</Button>
            <Button variant="outline" size="sm" onClick={handlePDFPurchases}><FileText className="w-3.5 h-3.5 mr-1.5" />Compras PDF</Button>
          </div>
        }
      />

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard label="Ingresos del período" value={formatARS(periodRevenue)} icon={TrendingUp} color="primary" sub={filtered.label} />
        <KPICard label="Ganancia bruta" value={formatARS(periodGrossProfit)} icon={DollarSign} color={periodGrossProfit > 0 ? "success" : "destructive"} sub={`${grossMarginPct.toFixed(1)}% margen`} />
        <KPICard label="Resultado neto" value={formatARS(netIncome)} icon={BarChart2} color={netIncome > 0 ? "success" : "destructive"} sub={`${netMarginPct.toFixed(1)}% margen neto`} />
        <KPICard label="Ventas registradas" value={filtered.sales.length} icon={Receipt} color="blue" sub={`${filtered.purchases.length} compras`} />
      </div>

      <Tabs value={reportsTab} onValueChange={value => setReportsTab(value as typeof reportsTab)} className="workspace-tabs-layout w-full">
        <TabsList className="workspace-tabs-nav mb-0 flex-wrap">
          <TabsTrigger value="overview">Resumen</TabsTrigger>
          <TabsTrigger value="income">Estado de Resultados</TabsTrigger>
          <TabsTrigger value="inventory">Inventario Valorado</TabsTrigger>
          <TabsTrigger value="products">Rentabilidad Productos</TabsTrigger>
          <TabsTrigger value="sellers">Vendedores</TabsTrigger>
          <TabsTrigger value="taxes">Impuestos</TabsTrigger>
          <TabsTrigger value="budget">Presupuesto</TabsTrigger>
          <TabsTrigger value="categories">Por Categoría</TabsTrigger>
          <TabsTrigger value="brands">🏷️ Marcas</TabsTrigger>
          <TabsTrigger value="cashflow">Flujo de Caja</TabsTrigger>
          <TabsTrigger value="audit">Auditoría</TabsTrigger>
          <TabsTrigger value="suppliers">Proveedores</TabsTrigger>
          <TabsTrigger value="compare">Comparativa</TabsTrigger>
          <TabsTrigger value="sucursales">Sucursales</TabsTrigger>
          <TabsTrigger value="margin_trend">📈 Tendencia</TabsTrigger>
          <TabsTrigger value="customers">Clientes</TabsTrigger>
          <TabsTrigger value="weekly_trend">📅 Por día</TabsTrigger>
          <TabsTrigger value="by_week">📊 Semanas</TabsTrigger>
          <TabsTrigger value="forecast">🔮 Proyección</TabsTrigger>
          <TabsTrigger value="scheduled">✉️ Programados</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6 pb-12">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            <div className="bg-card border border-border/60 rounded-[10px] p-3 md:p-4">
              <div className="flex items-center gap-2 mb-2"><TrendingUp className="w-4 h-4 text-emerald-400" /><span className="text-[10px] md:text-xs text-muted-foreground uppercase">Ganancia Bruta</span></div>
              <p className="text-lg md:text-xl font-bold font-mono tracking-tight text-emerald-400">{formatARS(grossProfitARS)}</p>
              <p className="text-xs text-muted-foreground">{formatUSD(grossProfitUSD)}</p>
            </div>
            <div className="bg-card border border-border/60 rounded-[10px] p-3 md:p-4">
              <div className="flex items-center gap-2 mb-2"><DollarSign className="w-4 h-4 text-primary" /><span className="text-[10px] md:text-xs text-muted-foreground uppercase">Facturado</span></div>
              <p className="text-lg md:text-xl font-bold font-mono tracking-tight">{formatARS(totalSalesARS)}</p>
              <p className="text-xs text-muted-foreground">{sales.length} ventas</p>
            </div>
            <div className="bg-card border border-border/60 rounded-[10px] p-3 md:p-4">
              <div className="flex items-center gap-2 mb-2"><Package className="w-4 h-4 text-yellow-400" /><span className="text-[10px] md:text-xs text-muted-foreground uppercase">Inventario</span></div>
              <p className="text-lg md:text-xl font-bold font-mono tracking-tight">{totalStock} uds</p>
              <p className="text-xs text-muted-foreground">{formatUSD(inventoryValueUSD)}</p>
            </div>
            <div className="bg-card border border-border/60 rounded-[10px] p-3 md:p-4">
              <div className="flex items-center gap-2 mb-2"><Users className="w-4 h-4 text-destructive" /><span className="text-[10px] md:text-xs text-muted-foreground uppercase">Deudas</span></div>
              <p className="text-lg md:text-xl font-bold font-mono tracking-tight text-destructive">{formatARS(totalDebtsARS)}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
            <div className="bg-card border border-border/60 rounded-[10px] p-4 md:p-5">
              <h2 className="text-sm font-display font-semibold mb-4 text-muted-foreground uppercase tracking-wider">Métricas de Rendimiento</h2>
              <div className="space-y-3 pb-12">
                {[
                  ['Margen Bruto', totalSalesARS > 0 ? `${((grossProfitARS / totalSalesARS) * 100).toFixed(1)}%` : '0%', 'text-emerald-400'],
                  ['ROI', `${roi.toFixed(1)}%`, 'text-primary'],
                  ['Inversión Total', `${formatUSD(totalPurchasesUSD)} (${formatARS(totalPurchasesARS)})`, 'text-yellow-400'],
                  ['Ticket Promedio', formatARS(sales.length > 0 ? totalSalesARS / sales.length : 0), ''],
                  ['Ganancia Promedio/Venta', formatARS(sales.length > 0 ? grossProfitARS / sales.length : 0), 'text-emerald-400'],
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
              <div className="bg-card border border-border/60 rounded-[10px] p-4 md:p-5">
                <h2 className="text-sm font-display font-semibold mb-4 text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                  <Receipt className="w-4 h-4" />Impuestos (Estimación)
                </h2>
                <div className="space-y-3 pb-12">
                  {[
                    ['Ganancia Bruta', formatARS(grossProfitARS), 'text-emerald-400'],
                    [`IVA (${settings.tax_iva_percent}%)`, `-${formatARS(taxes.iva)}`, 'text-destructive'],
                    [`IIBB (${settings.tax_iibb_percent}%)`, `-${formatARS(taxes.iibb)}`, 'text-destructive'],
                    ...(Number(settings.tax_monotributo_monthly) > 0 ? [['Monotributo/mes', formatARS(Number(settings.tax_monotributo_monthly)), 'text-yellow-400']] : []),
                    ['Total Impuestos', `-${formatARS(taxes.totalTax)}`, 'text-destructive'],
                    ['Ganancia Neta (post-imp)', formatARS(taxes.netProfit), taxes.netProfit > 0 ? 'text-emerald-400' : 'text-destructive'],
                  ].map(([label, value, color]) => (
                    <div key={label as string} className="flex justify-between items-center py-2 border-b border-border">
                      <span className="text-sm text-muted-foreground">{label}</span>
                      <span className={`font-bold text-sm ${color}`}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-card border border-border/60 rounded-[10px] p-4 md:p-5 flex items-center justify-center">
                <div className="text-center">
                  <Receipt className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">Módulo de impuestos desactivado</p>
                  <p className="text-xs text-muted-foreground mt-1">Activalo en Ajustes para ver estimaciones fiscales</p>
                </div>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="income" className="space-y-4 pb-12">
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
                    <div key={k.label} className="bg-card border border-border/60 rounded-[10px] p-3">
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

          <div className="bg-card border border-border/60 rounded-[10px] p-4 md:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
              <div>
                <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50 font-display">Estado de Resultados</h2>
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
          <InventoryTab products={products} settings={settings} sales={data.sales} />
        </TabsContent>

        <TabsContent value="sellers">
          <SellersTab sales={data.sales} members={members} period={period} />
        </TabsContent>

        <TabsContent value="taxes">
          <TaxesTab sales={data.sales} settings={settings} />
        </TabsContent>

        <TabsContent value="products">
          <ProductProfitabilityTab sales={filtered.sales} allSales={data.sales} />
        </TabsContent>

        <TabsContent value="budget">
          <BudgetTab sales={data.sales} expenses={data.expenses} settings={settings} userId={user?.id || ""} />
        </TabsContent>

        <TabsContent value="categories">
          <SalesByCategoryTab sales={filtered.sales} products={data.products} period={filtered.label} />
        </TabsContent>

        <TabsContent value="brands">
          <BrandStatsTab sales={filtered.sales} products={data.products} settings={settings} period={filtered.label} />
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

        <TabsContent value="customers">
          <CustomersTab sales={filtered.sales} period={filtered.label} />
        </TabsContent>

        <TabsContent value="weekly_trend">
          <WeeklyTrendTab sales={data.sales} />
        </TabsContent>

        <TabsContent value="by_week">
          <ByWeekTab sales={data.sales} />
        </TabsContent>

        <TabsContent value="forecast">
          <ForecastTab sales={data.sales} />
        </TabsContent>

        <TabsContent value="scheduled">
          <ScheduledReportsTab userId={user!.id} settings={settings} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Inventario Valorado Tab
// ─────────────────────────────────────────────────────────────
function InventoryTab({ products, settings, sales }: { products: any[]; settings: any; sales: any[] }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"cost_value" | "retail_value" | "stock" | "margin" | "days_remaining">("cost_value");
  const [sortAsc, setSortAsc] = useState(false);
  const [catFilter, setCatFilter] = useState("all");
  // `0` cuando no hay cotización: los productos en dólares quedan con costo 0 y
  // se ven en el reporte como lo que son, sin costo conocido. Ver `cotizacionDe`.
  const rate = cotizacionDe(settings) ?? 0;

  // Compute units sold per product in last 30 days
  const velocityMap = useMemo(() => {
    const cutoff = Date.now() - 30 * 86400000;
    const map: Record<string, number> = {};
    for (const s of sales) {
      if (new Date(s.created_at).getTime() < cutoff) continue;
      for (const it of s.items ?? []) {
        const pid = it.product_id || it.id;
        if (pid) map[pid] = (map[pid] || 0) + (Number(it.quantity) || 0);
      }
    }
    return map;
  }, [sales]);

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
        const unitsSold30 = velocityMap[p.id] || 0;
        const velocity = unitsSold30 / 30; // units/day
        const days_remaining = velocity > 0 && p.stock > 0 ? Math.round(p.stock / velocity) : null;
        return { ...p, costARS, margin, costValue, retailValue, unitsSold30, velocity, days_remaining };
      })
      .sort((a, b) => {
        const dir = sortAsc ? 1 : -1;
        if (sortKey === "days_remaining") {
          // nulls (no recent sales) always go to end
          if (a.days_remaining === null && b.days_remaining === null) return 0;
          if (a.days_remaining === null) return 1;
          if (b.days_remaining === null) return -1;
          return (a.days_remaining - b.days_remaining) * dir;
        }
        return (a[sortKey] - b[sortKey]) * dir;
      });
  }, [products, search, catFilter, sortKey, sortAsc, rate, velocityMap]);

  const totalCostValue = rows.reduce((s, r) => s + r.costValue, 0);
  const totalRetailValue = rows.reduce((s, r) => s + r.retailValue, 0);
  const totalUnits = rows.reduce((s, r) => s + r.stock, 0);
  const totalCostUSD = rows.reduce((s, r) => s + (Number(r.total_cost_usd) || 0) * r.stock, 0);
  const unrealizedMargin = totalRetailValue > 0 ? ((totalRetailValue - totalCostValue) / totalRetailValue) * 100 : 0;
  const criticalStock = rows.filter(r => r.days_remaining !== null && r.days_remaining < 7).length;
  const lowStock = rows.filter(r => r.days_remaining !== null && r.days_remaining >= 7 && r.days_remaining < 30).length;

  // Top 10 by cost value for chart
  const top10 = [...rows].sort((a, b) => b.costValue - a.costValue).slice(0, 10);

  const categories = ["all", ...Array.from(new Set(products.map(p => p.category).filter(Boolean)))];

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const exportInventoryCSV = () => {
    exportCSV("inventario-valorado.csv",
      ["Producto", "Marca", "Categoría", "Stock", "Costo USD", "Costo ARS", "Precio ARS", "Margen %", "Valor Costo (ARS)", "Valor Retail (ARS)", "Uds vendidas 30d", "Días stock restante"],
      rows.map(r => [
        r.name, r.brand || "", getCategoryLabel(r.category),
        r.stock, (Number(r.total_cost_usd) || 0).toFixed(2),
        Math.round(r.costARS).toString(), r.sale_price_ars || "",
        r.margin.toFixed(1), Math.round(r.costValue).toString(), Math.round(r.retailValue).toString(),
        r.unitsSold30.toString(), r.days_remaining !== null ? r.days_remaining.toString() : "—",
      ])
    );
  };

  const exportInventoryPDF = () => {
    const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "landscape" });
    const businessName = settings?.business_name || "Mi negocio";
    const now = new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" });

    // Header
    doc.setFontSize(16);
    doc.setTextColor(40, 40, 40);
    doc.text("Inventario Valorado", 40, 40);
    doc.setFontSize(10);
    doc.setTextColor(120, 120, 120);
    doc.text(businessName, 40, 56);
    doc.text(`Generado: ${now}  ·  ${rows.length} productos`, 40, 70);

    // KPI summary line
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    const summaryY = 84;
    doc.text(`Unidades: ${totalUnits.toLocaleString("es-AR")}`, 40, summaryY);
    doc.text(`Val. Costo: ${formatARS(totalCostValue)}`, 160, summaryY);
    doc.text(`Val. Retail: ${formatARS(totalRetailValue)}`, 310, summaryY);
    doc.text(`Margen no realizado: ${unrealizedMargin.toFixed(1)}%`, 470, summaryY);
    doc.text(`USD inmovilizado: ${formatUSD(totalCostUSD)}`, 630, summaryY);

    autoTable(doc, {
      startY: 98,
      head: [["Producto", "Marca", "Categoría", "Stock", "Costo ARS", "Precio ARS", "Margen %", "Val. Costo", "Val. Retail", "Días stock"]],
      body: rows.map(r => [
        r.name,
        r.brand || "",
        getCategoryLabel(r.category),
        r.stock,
        formatARS(r.costARS).replace("$ ", "$ "),
        formatARS(Number(r.sale_price_ars) || 0).replace("$ ", "$ "),
        `${r.margin.toFixed(1)}%`,
        formatARS(r.costValue).replace("$ ", "$ "),
        formatARS(r.retailValue).replace("$ ", "$ "),
        r.days_remaining !== null ? `${r.days_remaining}d` : "—",
      ]),
      foot: [["TOTAL", "", "", totalUnits, "", "", `${unrealizedMargin.toFixed(1)}%`, formatARS(totalCostValue), formatARS(totalRetailValue), ""]],
      styles: { fontSize: 7.5, cellPadding: 3 },
      headStyles: { fillColor: [40, 40, 40], textColor: [255, 255, 255], fontSize: 8 },
      footStyles: { fillColor: [240, 240, 240], fontStyle: "bold", fontSize: 8 },
      columnStyles: {
        0: { cellWidth: 130 },
        3: { halign: "center" },
        4: { halign: "right" },
        5: { halign: "right" },
        6: { halign: "center" },
        7: { halign: "right" },
        8: { halign: "right" },
        9: { halign: "center" },
      },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 6) {
          const margin = parseFloat(data.cell.text[0]);
          if (margin >= 30) data.cell.styles.textColor = [34, 197, 94];
          else if (margin >= 15) data.cell.styles.textColor = [234, 179, 8];
          else data.cell.styles.textColor = [239, 68, 68];
        }
      },
    });

    doc.save(`inventario-${new Date().toISOString().slice(0, 10)}.pdf`);
    toast.success("PDF descargado");
  };

  const tooltipStyle = { background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(40, 20%, 92%)" };
  const PALETTE = ["hsl(40,70%,50%)", "hsl(150,60%,40%)", "hsl(200,70%,55%)", "hsl(280,60%,55%)", "hsl(0,65%,55%)", "hsl(60,70%,50%)", "hsl(25,70%,50%)", "hsl(320,60%,50%)", "hsl(180,60%,45%)", "hsl(100,55%,40%)"];

  return (
    <div className="space-y-5 pb-12">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Unidades en stock", value: totalUnits.toLocaleString("es-AR"), icon: Boxes, color: "text-primary" },
          { label: "Valor al costo (ARS)", value: formatARS(totalCostValue), icon: DollarSign, color: "text-yellow-400" },
          { label: "Valor retail (ARS)", value: formatARS(totalRetailValue), icon: TrendingUp, color: "text-emerald-400" },
          { label: "Margen no realizado", value: `${unrealizedMargin.toFixed(1)}%`, icon: Package, color: unrealizedMargin >= 30 ? "text-emerald-400" : unrealizedMargin >= 15 ? "text-yellow-400" : "text-destructive" },
        ].map(k => (
          <div key={k.label} className="bg-card border border-border/60 rounded-[10px] p-3 md:p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wider leading-tight">{k.label}</span>
              <k.icon className={`w-3.5 h-3.5 shrink-0 ${k.color}`} />
            </div>
            <p className={`text-lg md:text-xl font-bold font-mono tracking-tight font-display ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Additional metric */}
      <div className="bg-card border border-border/60 rounded-[10px] p-4">
        <div className="flex flex-wrap gap-4 text-sm">
          <div>
            <span className="text-muted-foreground">Inversión inmovilizada (USD): </span>
            <span className="font-bold text-yellow-400">{formatUSD(totalCostUSD)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Ganancia potencial: </span>
            <span className="font-bold text-emerald-400">{formatARS(totalRetailValue - totalCostValue)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Sin stock: </span>
            <span className="font-bold text-destructive">{products.filter(p => p.stock <= 0).length}</span>
          </div>
          {criticalStock > 0 && (
            <div>
              <span className="text-muted-foreground">Stock crítico (&lt;7d): </span>
              <span className="font-bold text-red-400">{criticalStock}</span>
            </div>
          )}
          {lowStock > 0 && (
            <div>
              <span className="text-muted-foreground">Stock bajo (7-30d): </span>
              <span className="font-bold text-yellow-400">{lowStock}</span>
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      {top10.length > 0 && (
        <div className="bg-card border border-border/60 rounded-[10px] p-4">
          <h3 className="text-sm font-display font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Top 10 productos por valor al costo</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={top10} layout="vertical">
              <XAxis type="number" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
              <YAxis type="category" dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} width={110} tickFormatter={(v) => v.length > 18 ? v.slice(0, 18) + "…" : v} />
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
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportInventoryCSV}>
            <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />CSV
          </Button>
          <Button variant="outline" size="sm" onClick={exportInventoryPDF}>
            <FileText className="w-3.5 h-3.5 mr-1.5" />PDF
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-border/60 rounded-[10px] overflow-hidden">
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
                <SortTh label="Días stock" sortKey="days_remaining" current={sortKey} asc={sortAsc} onClick={handleSort} right />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-muted-foreground text-sm">Sin productos</td>
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
                      <span className={`px-2 py-0.5 rounded-[5px] text-xs font-medium ${
                        r.stock <= 0 ? "bg-red-500/15 text-red-400" :
                        r.stock <= 3 ? "bg-yellow-500/15 text-yellow-400" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {r.stock}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs text-muted-foreground hidden lg:table-cell font-mono">{formatARS(r.costARS)}</td>
                    <td className="px-3 py-2.5 text-right text-xs font-mono">{formatARS(Number(r.sale_price_ars) || 0)}</td>
                    <td className={`px-3 py-2.5 text-right text-xs font-bold ${r.margin >= 30 ? "text-emerald-400" : r.margin >= 15 ? "text-yellow-400" : "text-destructive"}`}>
                      {r.margin.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs font-mono text-yellow-400">{formatARS(r.costValue)}</td>
                    <td className="px-3 py-2.5 text-right text-xs font-mono text-emerald-400">{formatARS(r.retailValue)}</td>
                    <td className="px-3 py-2.5 text-right">
                      {r.days_remaining !== null ? (
                        <span className={`px-2 py-0.5 rounded-[5px] text-xs font-medium ${
                          r.days_remaining < 7 ? "bg-red-500/15 text-red-400" :
                          r.days_remaining < 30 ? "bg-yellow-500/15 text-yellow-400" :
                          "bg-green-500/15 text-green-400"
                        }`}>
                          {r.days_remaining}d
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </td>
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
                  <td className="px-3 py-2.5 text-right text-yellow-400 font-mono">{formatARS(totalCostValue)}</td>
                  <td className="px-3 py-2.5 text-right text-emerald-400 font-mono">{formatARS(totalRetailValue)}</td>
                  <td />
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
    <div className="space-y-6 pb-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">Período: {label}</h3>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-card border border-border/60 rounded-[5px] px-3 py-1.5">
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
          <div className="bg-card border border-border/60 rounded-[10px] p-4">
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
        <div className="bg-card border border-border/60 rounded-[10px] p-4">
          <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wide">Facturación por vendedor</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 8 }}>
              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
              <Tooltip formatter={(v: any) => formatARS(v)} contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11 }} />
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
            <div key={r.uid} className="bg-card border border-border/60 rounded-[10px] p-4 space-y-3">
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
                <span className="text-[10px] text-muted-foreground bg-muted rounded-[5px] px-2 py-0.5">{sharePct.toFixed(1)}%</span>
              </div>
              <div className="w-full bg-muted rounded-full h-1.5">
                <div className="h-1.5 rounded-full transition-all" style={{ width: `${sharePct}%`, background: SELLER_COLORS[i % SELLER_COLORS.length] }} />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><p className="text-muted-foreground">Facturado</p><p className="font-bold text-emerald-400">{formatARS(r.totalARS)}</p></div>
                <div><p className="text-muted-foreground">Ganancia</p><p className="font-bold">{formatARS(r.profit)}</p></div>
                <div><p className="text-muted-foreground">Margen</p><p className={`font-bold ${r.margin >= 30 ? "text-emerald-400" : r.margin >= 15 ? "text-yellow-400" : "text-destructive"}`}>{r.margin.toFixed(1)}%</p></div>
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
    <div className="space-y-6 pb-12">
      {!taxEnabled && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-[10px] p-4 flex items-start gap-3">
          <TrendingUp className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-yellow-400">Impuestos desactivados</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Activá los impuestos en Ajustes → Impuestos para ver el impacto real en tu rentabilidad.
              Las tasas configuradas son: IVA {ivaRate}%, IIBB {iibbRate}%, Monotributo ${monotributoMonthly.toLocaleString("es-AR")}/mes.
            </p>
          </div>
        </div>
      )}

      {/* Tax projection section */}
      {projectedTaxes.length > 0 && (
        <div className="bg-card border border-border/60 rounded-[10px] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <TrendingDown className="w-4 h-4 text-destructive" />
            <h3 className="text-sm font-semibold">Proyección impositiva — próximos 3 meses</h3>
            <span className="text-[10px] bg-muted text-muted-foreground px-2 py-0.5 rounded-[5px]">basado en promedio últimos 3 meses</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {projectedTaxes.map(p => (
              <div key={p.label} className="bg-muted/40 rounded-[10px] p-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{p.label}</p>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between"><span className="text-muted-foreground">Facturación est.</span><span>{formatARS(p.revenue)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Ganancia est.</span><span className="text-emerald-400">{formatARS(p.profit)}</span></div>
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
                    <span className={p.netProfit >= 0 ? "text-emerald-400" : "text-destructive"}>{formatARS(p.netProfit)}</span>
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
          { label: "Ganancia bruta", value: formatARS(totals.profit), color: "text-emerald-400" },
          { label: "Total impuestos", value: formatARS(totals.total), color: "text-destructive" },
          { label: "Ganancia neta", value: formatARS(totals.netProfit), color: totals.netProfit >= 0 ? "text-emerald-400" : "text-destructive" },
        ].map(k => (
          <div key={k.label} className="bg-card border border-border/60 rounded-[10px] p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{k.label}</p>
            <p className={`text-lg font-bold font-mono tracking-tight font-display ${k.color}`}>{k.value}</p>
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
        <div className="bg-card border border-border/60 rounded-[10px] overflow-hidden">
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
                  <th className="px-3 py-2.5 text-right text-xs text-muted-foreground uppercase tracking-wide text-emerald-400">G. Neta</th>
                </tr>
              </thead>
              <tbody>
                {monthlyData.map((row, i) => (
                  <tr key={row.key} className={`border-b border-border/40 ${i % 2 === 0 ? '' : 'bg-muted/10'}`}>
                    <td className="px-3 py-2.5 font-medium">{row.label}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">{formatARS(row.revenue)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-emerald-400">{formatARS(row.profit)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-orange-400">{taxEnabled ? `-${formatARS(row.iva)}` : '—'}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs text-orange-400">{taxEnabled ? `-${formatARS(row.iibb)}` : '—'}</td>
                    {monotributoMonthly > 0 && <td className="px-3 py-2.5 text-right font-mono text-xs text-orange-400">{taxEnabled ? `-${formatARS(row.monotributo)}` : '—'}</td>}
                    <td className="px-3 py-2.5 text-right font-mono text-xs font-bold text-destructive">{taxEnabled ? `-${formatARS(row.total)}` : '—'}</td>
                    <td className={`px-3 py-2.5 text-right font-mono text-xs font-bold ${row.netProfit >= 0 ? 'text-emerald-400' : 'text-destructive'}`}>{formatARS(row.netProfit)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/40 font-bold">
                  <td className="px-3 py-2.5">TOTAL</td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs">{formatARS(totals.revenue)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-emerald-400">{formatARS(totals.profit)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-orange-400">{taxEnabled ? `-${formatARS(totals.iva)}` : '—'}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-orange-400">{taxEnabled ? `-${formatARS(totals.iibb)}` : '—'}</td>
                  {monotributoMonthly > 0 && <td className="px-3 py-2.5 text-right font-mono text-xs text-orange-400">{taxEnabled ? `-${formatARS(totals.monotributo)}` : '—'}</td>}
                  <td className="px-3 py-2.5 text-right font-mono text-xs font-bold text-destructive">{taxEnabled ? `-${formatARS(totals.total)}` : '—'}</td>
                  <td className={`px-3 py-2.5 text-right font-mono text-xs font-bold ${totals.netProfit >= 0 ? 'text-emerald-400' : 'text-destructive'}`}>{formatARS(totals.netProfit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {taxEnabled && (
        <div className="bg-muted/30 border border-border/50 rounded-[10px] p-4 text-xs text-muted-foreground space-y-1">
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
          <span className={over ? "text-emerald-400 font-bold" : "text-muted-foreground"}>{pct.toFixed(0)}%</span>
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
    <div className="space-y-6 pb-12">
      {/* Set targets */}
      <div className="bg-card border border-border/60 rounded-[10px] p-5">
        <h3 className="font-semibold text-sm mb-4">Metas mensuales</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { key: "sales_ars" as const, label: "Meta de ventas (ARS)", color: "text-primary" },
            { key: "profit_ars" as const, label: "Meta de ganancia (ARS)", color: "text-emerald-400" },
            { key: "expenses_ars" as const, label: "Límite de gastos (ARS)", color: "text-yellow-400" },
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
        <div className="bg-card border border-border/60 rounded-[10px] p-5">
          <h3 className="font-semibold text-sm mb-4">Mes actual</h3>
          <div className="space-y-4 pb-12">
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
        <div className="bg-card border border-border/60 rounded-[10px] overflow-hidden">
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
                      {tSales > 0 && <td className={`px-3 py-2.5 text-right text-xs font-bold ${salesPct !== null && salesPct >= 100 ? 'text-emerald-400' : salesPct !== null && salesPct >= 75 ? 'text-yellow-400' : 'text-destructive'}`}>
                        {salesPct !== null ? `${salesPct.toFixed(0)}%` : '—'}
                      </td>}
                      {tProfit > 0 && <td className="px-3 py-2.5 text-right font-mono text-xs text-emerald-400">{formatARS(row.profit)}</td>}
                      {tProfit > 0 && <td className={`px-3 py-2.5 text-right text-xs font-bold ${profitPct !== null && profitPct >= 100 ? 'text-emerald-400' : profitPct !== null && profitPct >= 75 ? 'text-yellow-400' : 'text-destructive'}`}>
                        {profitPct !== null ? `${profitPct.toFixed(0)}%` : '—'}
                      </td>}
                      {tExpenses > 0 && <td className={`px-3 py-2.5 text-right font-mono text-xs font-bold ${expOver ? 'text-destructive' : 'text-emerald-400'}`}>{formatARS(row.expenses)}</td>}
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
  create: 'text-emerald-400 bg-emerald-500/10',
  update: 'text-primary bg-primary/10',
  delete: 'text-destructive bg-destructive/10',
  settings_change: 'text-yellow-400 bg-yellow-500/10',
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
    <div className="space-y-4 pb-12">
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
          <div className="overflow-x-auto rounded-[10px] border border-border/60">
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
                      <span className={`inline-flex items-center rounded-[5px] px-2 py-0.5 text-[10px] font-semibold ${ACTION_COLORS[log.action] || 'text-muted-foreground bg-muted'}`}>
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
          <DataPagination
            page={page}
            totalPages={totalPages}
            totalItems={filtered.length}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
          />
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

  const tooltipStyle = { background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 };

  return (
    <div className="space-y-6 pb-12">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Ingresos totales", value: formatARS(totals.revenue), color: "text-emerald-400" },
          { label: "Egresos totales", value: formatARS(totals.outflow), color: "text-destructive" },
          { label: "Resultado neto", value: formatARS(totals.net), color: totals.net >= 0 ? "text-emerald-400" : "text-destructive" },
          { label: "Meses positivos", value: `${positiveMonths} / ${rows.length}`, color: positiveMonths === rows.length ? "text-emerald-400" : positiveMonths > rows.length / 2 ? "text-yellow-400" : "text-destructive" },
        ].map(k => (
          <div key={k.label} className="bg-card border border-border/60 rounded-[10px] p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">{k.label}</p>
            <p className={`text-lg font-bold font-mono tracking-tight font-display ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {rows.length > 0 ? (
        <div className="bg-card border border-border/60 rounded-[10px] p-4">
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
              <XAxis dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
              <YAxis tickFormatter={(v: number) => `$${Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} width={55} />
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
        <div className="bg-card border border-border/60 rounded-[10px] overflow-hidden">
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
// ─── helper: build month label for input[type=month] ────────
function monthLabel(yyyy: number, mm: number) {
  return `${yyyy}-${String(mm + 1).padStart(2, '0')}`;
}

// Rentabilidad por Producto Tab
// ─────────────────────────────────────────────────────────────
function ProductProfitabilityTab({ sales, allSales }: { sales: any[]; allSales: any[] }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<"profit" | "revenue" | "units" | "margin">("profit");
  const [sortAsc, setSortAsc] = useState(false);

  // Period comparison state — default: current month vs previous month
  const now = new Date();
  const [compareMode, setCompareMode] = useState(false);
  const [periodA, setPeriodA] = useState(() => monthLabel(now.getFullYear(), now.getMonth()));
  const [periodB, setPeriodB] = useState(() => monthLabel(now.getFullYear(), now.getMonth() - 1 >= 0 ? now.getMonth() - 1 : 11));

  // Build rows from either provided sales (normal mode) or filtered by period (compare mode)
  function buildRows(salesArr: any[]) {
    const map: Record<string, { name: string; revenue: number; profit: number; units: number; transactions: number }> = {};
    salesArr.forEach((s: any) => {
      const key = s.product_name || "Sin nombre";
      if (!map[key]) map[key] = { name: key, revenue: 0, profit: 0, units: 0, transactions: 0 };
      map[key].revenue += Number(s.total_ars);
      map[key].profit += Number(s.profit_ars);
      map[key].units += Number(s.quantity);
      map[key].transactions++;
    });
    return Object.values(map).map(r => ({ ...r, margin: r.revenue > 0 ? (r.profit / r.revenue) * 100 : 0 }));
  }

  const salesA = useMemo(() => compareMode
    ? allSales.filter((s: any) => s.date?.startsWith(periodA))
    : sales, [compareMode, allSales, periodA, sales]);

  const salesB = useMemo(() => compareMode
    ? allSales.filter((s: any) => s.date?.startsWith(periodB))
    : [], [compareMode, allSales, periodB]);

  const rowsA = useMemo(() => buildRows(salesA), [salesA]);
  const rowsB = useMemo(() => buildRows(salesB), [salesB]);

  // In compare mode, merge both period results
  const rows = useMemo(() => {
    if (!compareMode) return rowsA;
    const allNames = new Set([...rowsA.map(r => r.name), ...rowsB.map(r => r.name)]);
    const mapA = Object.fromEntries(rowsA.map(r => [r.name, r]));
    const mapB = Object.fromEntries(rowsB.map(r => [r.name, r]));
    return Array.from(allNames).map(name => ({
      name,
      revenue: mapA[name]?.revenue || 0,
      profit: mapA[name]?.profit || 0,
      units: mapA[name]?.units || 0,
      transactions: mapA[name]?.transactions || 0,
      margin: mapA[name]?.margin || 0,
      revB: mapB[name]?.revenue || 0,
      profitB: mapB[name]?.profit || 0,
      marginB: mapB[name]?.margin || 0,
    }));
  }, [compareMode, rowsA, rowsB]);

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
    <div className="space-y-5 pb-12">
      {/* Top 5 bar chart */}
      {top5.length > 0 && (
        <div className="bg-card border border-border/60 rounded-[10px] p-4">
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
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setCompareMode(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[5px] border text-xs font-medium transition-all ${compareMode ? 'bg-primary/15 border-primary/40 text-primary' : 'border-border text-muted-foreground hover:text-foreground'}`}
          >
            <ArrowUpDown className="w-3.5 h-3.5" />Comparar períodos
          </button>
          <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5 shrink-0">
            <FileSpreadsheet className="w-3.5 h-3.5" />CSV
          </Button>
        </div>
      </div>

      {/* Compare period pickers */}
      {compareMode && (
        <div className="flex flex-wrap items-center gap-4 bg-primary/5 border border-primary/20 rounded-[10px] px-4 py-3">
          <ArrowUpDown className="w-4 h-4 text-primary shrink-0" />
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground font-medium">Período A:</label>
            <Input type="month" value={periodA} onChange={e => setPeriodA(e.target.value)}
              className="h-8 w-32 px-2 text-xs" aria-label="Período A" />
          </div>
          <span className="text-muted-foreground text-xs">vs</span>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground font-medium">Período B:</label>
            <Input type="month" value={periodB} onChange={e => setPeriodB(e.target.value)}
              className="h-8 w-32 px-2 text-xs" aria-label="Período B" />
          </div>
          <span className="text-[10px] text-muted-foreground">{salesA.length} vs {salesB.length} ventas</span>
        </div>
      )}

      {/* Table */}
      <div className="bg-card border border-border/60 rounded-[10px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Producto</th>
                {compareMode ? (
                  <>
                    <th className="text-right px-3 py-2.5 text-[11px] font-semibold text-primary/70 uppercase tracking-wide">Ganancia A</th>
                    <th className="text-right px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Ganancia B</th>
                    <th className="text-right px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Δ Ganancia</th>
                    <th className="text-right px-3 py-2.5 text-[11px] font-semibold text-primary/70 uppercase tracking-wide">Margen A</th>
                    <th className="text-right px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Margen B</th>
                  </>
                ) : (
                  <>
                    {(["revenue", "profit", "margin", "units"] as const).map(k => (
                      <th key={k} className="text-right px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer hover:text-foreground transition-colors" onClick={() => toggle(k)}>
                        <span className="flex items-center justify-end gap-1">
                          {k === "revenue" ? "Facturación" : k === "profit" ? "Ganancia" : k === "margin" ? "Margen %" : "Unidades"}
                          <ArrowUpDown className={`w-3 h-3 ${sortKey === k ? "text-primary" : "opacity-40"}`} />
                        </span>
                      </th>
                    ))}
                    <th className="text-right px-4 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Ventas</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r, i) => {
                const rAny = r as any;
                if (compareMode) {
                  const profitDiff = rAny.profit - (rAny.profitB || 0);
                  const marginDiff = rAny.margin - (rAny.marginB || 0);
                  return (
                    <tr key={r.name} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2.5 font-medium text-sm max-w-[160px] truncate" title={r.name}>{r.name}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-primary/80">{formatARS(r.profit)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs text-muted-foreground">{formatARS(rAny.profitB || 0)}</td>
                      <td className={`px-3 py-2.5 text-right font-semibold text-xs ${profitDiff >= 0 ? 'text-emerald-400' : 'text-destructive'}`}>
                        {profitDiff >= 0 ? '▲' : '▼'}{formatARS(Math.abs(profitDiff))}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs">
                        <span className={`px-1.5 py-0.5 rounded-[5px] text-[10px] font-semibold ${r.margin >= 40 ? "bg-emerald-500/15 text-emerald-400" : r.margin >= 20 ? "bg-yellow-500/15 text-yellow-400" : "bg-red-500/15 text-red-400"}`}>
                          {r.margin.toFixed(1)}%
                        </span>
                      </td>
                      <td className={`px-3 py-2.5 text-right text-xs font-semibold ${marginDiff >= 0 ? 'text-emerald-400' : 'text-destructive'}`}>
                        {marginDiff >= 0 ? '+' : ''}{marginDiff.toFixed(1)}pp
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={r.name} className={`hover:bg-muted/20 transition-colors ${i === 0 && sortKey === "profit" && !sortAsc ? "bg-primary/5" : ""}`}>
                    <td className="px-4 py-2.5 font-medium text-sm max-w-[200px] truncate" title={r.name}>
                      {i === 0 && sortKey === "profit" && !sortAsc && <span className="mr-1">🥇</span>}
                      {r.name}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">{formatARS(r.revenue)}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-emerald-400">{formatARS(r.profit)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-[5px] ${r.margin >= 40 ? "bg-emerald-500/15 text-emerald-400" : r.margin >= 20 ? "bg-yellow-500/15 text-yellow-400" : "bg-red-500/15 text-red-400"}`}>
                        {r.margin.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{r.units}</td>
                    <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">{r.transactions}</td>
                  </tr>
                );
              })}
            </tbody>
            {!compareMode && (
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
            )}
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
  const tooltipStyle = { background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 };
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
    <div className="space-y-5 pb-12">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Ingresos totales", value: formatARS(totals.revenue), color: "text-primary" },
          { label: "Ganancia bruta", value: formatARS(totals.profit), color: "text-emerald-400" },
          { label: "Margen promedio", value: `${totals.revenue > 0 ? ((totals.profit / totals.revenue) * 100).toFixed(1) : "0"}%`, color: "text-yellow-400" },
          { label: "Categorías activas", value: rows.length, color: "text-blue-400" },
        ].map(k => (
          <div key={k.label} className="bg-card border border-border/60 rounded-[10px] p-3 md:p-4">
            <p className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wider mb-1">{k.label}</p>
            <p className={`text-lg md:text-xl font-bold font-mono tracking-tight font-display ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {top8.length > 0 && (
        <div className="bg-card border border-border/60 rounded-[10px] p-4">
          <h3 className="text-sm font-display font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Ingresos por categoría — {period}</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={top8} layout="vertical">
              <XAxis type="number" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
              <YAxis type="category" dataKey="label" width={120} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickFormatter={(v: string) => v.length > 20 ? v.slice(0, 20) + "…" : v} />
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

      <div className="bg-card border border-border/60 rounded-[10px] overflow-hidden">
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
                      <span className={`font-semibold ${r.margin >= 30 ? "text-emerald-400" : r.margin >= 15 ? "text-yellow-400" : "text-destructive"}`}>{r.margin.toFixed(1)}%</span>
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
// Brand & Family Stats Tab — ¿qué marca vende/rinde más? ¿capital inmovilizado?
// ─────────────────────────────────────────────────────────────
function BrandStatsTab({ sales, products, settings, period }: { sales: any[]; products: any[]; settings: any; period: string }) {
  const { activeOrg } = useOrg();
  const [sortKey, setSortKey] = useState<"revenue" | "profit" | "margin" | "units" | "capital">("revenue");
  const [sortAsc, setSortAsc] = useState(false);
  const [familiaByProduct, setFamiliaByProduct] = useState<Record<string, string>>({});
  // `0` cuando no hay cotización: los productos en dólares quedan con costo 0 y
  // se ven en el reporte como lo que son, sin costo conocido. Ver `cotizacionDe`.
  const rate = cotizacionDe(settings) ?? 0;

  useEffect(() => {
    if (!activeOrg) return;
    supabase.from("product_perfume_details").select("product_id, familia_olfativa").eq("org_id", activeOrg.id)
      .then(({ data }) => {
        const m: Record<string, string> = {};
        (data || []).forEach((d: any) => { if (d.familia_olfativa) m[d.product_id] = d.familia_olfativa; });
        setFamiliaByProduct(m);
      });
  }, [activeOrg?.id]);

  const productById = useMemo(() => {
    const m: Record<string, any> = {};
    products.forEach((p: any) => { if (p.id) m[p.id] = p; });
    return m;
  }, [products]);

  // Capital inmovilizado + nº de productos por marca (desde el stock actual)
  const brandInventory = useMemo(() => {
    const m: Record<string, { capital: number; skus: number; stock: number }> = {};
    products.forEach((p: any) => {
      const brand = (p.brand || "Sin marca").trim() || "Sin marca";
      if (!m[brand]) m[brand] = { capital: 0, skus: 0, stock: 0 };
      m[brand].capital += (Number(p.total_cost_usd) || 0) * rate * (Number(p.stock) || 0);
      m[brand].skus += 1;
      m[brand].stock += Number(p.stock) || 0;
    });
    return m;
  }, [products, rate]);

  const rows = useMemo(() => {
    const byBrand: Record<string, { revenue: number; profit: number; units: number; transactions: number }> = {};
    sales.forEach((s: any) => {
      const p = productById[s.product_id];
      const brand = ((p?.brand || "Sin marca").trim()) || "Sin marca";
      if (!byBrand[brand]) byBrand[brand] = { revenue: 0, profit: 0, units: 0, transactions: 0 };
      byBrand[brand].revenue += Number(s.total_ars) || 0;
      byBrand[brand].profit += Number(s.profit_ars) || 0;
      byBrand[brand].units += Number(s.quantity) || 1;
      byBrand[brand].transactions++;
    });
    // Unir todas las marcas: las que vendieron + las que solo tienen stock
    const allBrands = new Set([...Object.keys(byBrand), ...Object.keys(brandInventory)]);
    return Array.from(allBrands).map(brand => {
      const d = byBrand[brand] || { revenue: 0, profit: 0, units: 0, transactions: 0 };
      const inv = brandInventory[brand] || { capital: 0, skus: 0, stock: 0 };
      return {
        brand,
        revenue: d.revenue,
        profit: d.profit,
        margin: d.revenue > 0 ? (d.profit / d.revenue) * 100 : 0,
        units: d.units,
        transactions: d.transactions,
        capital: inv.capital,
        skus: inv.skus,
        stock: inv.stock,
      };
    }).sort((a, b) => (sortAsc ? 1 : -1) * ((a as any)[sortKey] - (b as any)[sortKey]));
  }, [sales, productById, brandInventory, sortKey, sortAsc]);

  const totals = useMemo(() => ({
    revenue: rows.reduce((s, r) => s + r.revenue, 0),
    profit: rows.reduce((s, r) => s + r.profit, 0),
    capital: rows.reduce((s, r) => s + r.capital, 0),
  }), [rows]);

  // Marca más rentable (por margen, con ingreso mínimo relevante)
  const topBrand = useMemo(() => [...rows].sort((a, b) => b.revenue - a.revenue)[0], [rows]);
  const mostProfitable = useMemo(() => {
    const withSales = rows.filter(r => r.revenue > 0);
    return [...withSales].sort((a, b) => b.margin - a.margin)[0];
  }, [rows]);

  const top10 = useMemo(() => [...rows].filter(r => r.revenue > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 10), [rows]);

  // Desglose por familia olfativa
  const familiaRows = useMemo(() => {
    const byFam: Record<string, { revenue: number; units: number }> = {};
    sales.forEach((s: any) => {
      const fam = familiaByProduct[s.product_id];
      if (!fam) return;
      if (!byFam[fam]) byFam[fam] = { revenue: 0, units: 0 };
      byFam[fam].revenue += Number(s.total_ars) || 0;
      byFam[fam].units += Number(s.quantity) || 1;
    });
    return Object.entries(byFam)
      .map(([fam, d]) => ({ fam, label: taxLabel(FAMILIAS_OLFATIVAS, fam), revenue: d.revenue, units: d.units }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [sales, familiaByProduct]);
  const familiaTotal = familiaRows.reduce((s, r) => s + r.revenue, 0);

  const tooltipStyle = { background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 };
  const handleSort = (k: typeof sortKey) => { if (sortKey === k) setSortAsc(!sortAsc); else { setSortKey(k); setSortAsc(false); } };

  const exportBrands = () => exportCSV(`ventas-por-marca-${period}.csv`,
    ["Marca", "Ingresos ARS", "Ganancia ARS", "Margen %", "Unidades", "% del total", "SKUs", "Stock", "Capital inmovilizado ARS"],
    rows.map(r => [r.brand, Math.round(r.revenue).toString(), Math.round(r.profit).toString(), r.margin.toFixed(1), r.units.toString(),
      (totals.revenue > 0 ? (r.revenue / totals.revenue) * 100 : 0).toFixed(1), r.skus.toString(), r.stock.toString(), Math.round(r.capital).toString()])
  );

  if (rows.length === 0) return (
    <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
      <BarChart2 className="w-10 h-10 mb-3 opacity-30" />
      <p className="text-sm">Sin productos ni ventas para analizar por marca</p>
    </div>
  );

  return (
    <div className="space-y-5 pb-12">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Marca líder", value: topBrand?.revenue > 0 ? topBrand.brand : "—", sub: topBrand?.revenue > 0 ? formatARS(topBrand.revenue) : "sin ventas", color: "text-primary" },
          { label: "Más rentable", value: mostProfitable ? mostProfitable.brand : "—", sub: mostProfitable ? `${mostProfitable.margin.toFixed(1)}% margen` : "sin ventas", color: "text-emerald-400" },
          { label: "Capital inmovilizado", value: formatARS(totals.capital), sub: `${rows.length} marcas`, color: "text-yellow-400" },
          { label: "Ingresos totales", value: formatARS(totals.revenue), sub: `${formatARS(totals.profit)} ganancia`, color: "text-blue-400" },
        ].map(k => (
          <div key={k.label} className="bg-card border border-border/60 rounded-[10px] p-3 md:p-4">
            <p className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wider mb-1">{k.label}</p>
            <p className={`text-base md:text-lg font-bold tracking-tight font-display truncate ${k.color}`}>{k.value}</p>
            <p className="text-[10px] text-muted-foreground/70 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      {top10.length > 0 && (
        <div className="bg-card border border-border/60 rounded-[10px] p-4">
          <h3 className="text-sm font-display font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Ingresos por marca — {period}</h3>
          <ResponsiveContainer width="100%" height={Math.max(180, top10.length * 34)}>
            <BarChart data={top10} layout="vertical">
              <XAxis type="number" tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
              <YAxis type="category" dataKey="brand" width={110} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} tickFormatter={(v: string) => v.length > 18 ? v.slice(0, 18) + "…" : v} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [formatARS(v), "Ingresos"]} />
              <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
                {top10.map((_, i) => <Cell key={i} fill={CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {familiaRows.length > 0 && (
        <div className="bg-card border border-border/60 rounded-[10px] p-4">
          <h3 className="text-sm font-display font-semibold mb-3 text-muted-foreground uppercase tracking-wider">Ingresos por familia olfativa</h3>
          <div className="space-y-2">
            {familiaRows.map((f, i) => {
              const pct = familiaTotal > 0 ? (f.revenue / familiaTotal) * 100 : 0;
              return (
                <div key={f.fam} className="flex items-center gap-3">
                  <span className="text-xs w-28 shrink-0 truncate">{f.label}</span>
                  <div className="flex-1 h-4 rounded-full bg-muted/40 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length] }} />
                  </div>
                  <span className="text-xs font-mono w-24 text-right shrink-0">{formatARS(f.revenue)}</span>
                  <span className="text-[10px] text-muted-foreground w-10 text-right shrink-0">{pct.toFixed(0)}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={exportBrands}><FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />Exportar CSV</Button>
      </div>

      <div className="bg-card border border-border/60 rounded-[10px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Marca</th>
                {(["revenue", "profit", "margin", "units", "capital"] as const).map(k => (
                  <th key={k} className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground transition-colors"
                    onClick={() => handleSort(k)}>
                    {k === "revenue" ? "Ingresos" : k === "profit" ? "Ganancia" : k === "margin" ? "Margen" : k === "units" ? "Uds" : "Capital"}
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
                  <tr key={r.brand} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CATEGORY_PALETTE[i % CATEGORY_PALETTE.length] }} />
                        <span className="font-medium">{r.brand}</span>
                        <span className="text-[10px] text-muted-foreground">· {r.skus} SKU{r.skus === 1 ? "" : "s"}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{formatARS(r.revenue)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-emerald-400">{formatARS(r.profit)}</td>
                    <td className="px-4 py-3 text-right text-xs">
                      <span className={`font-semibold ${r.margin >= 30 ? "text-emerald-400" : r.margin >= 15 ? "text-yellow-400" : r.revenue > 0 ? "text-destructive" : "text-muted-foreground"}`}>{r.revenue > 0 ? `${r.margin.toFixed(1)}%` : "—"}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{r.units}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-yellow-400">{formatARS(r.capital)}</td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">{pct.toFixed(1)}%</td>
                  </tr>
                );
              })}
            </tbody>
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
    <div className="space-y-4 pb-12">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Compras por proveedor</h3>
          <p className="text-xs text-muted-foreground">{supplierData.length} proveedores · Total: U$S {totalUSD.toFixed(0)}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => navigate('/proveedores')} className="text-xs">
          Ir a Proveedores →
        </Button>
      </div>
      <div className="overflow-x-auto rounded-[10px] border border-border/60">
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
                  <td className="p-3 text-right font-semibold text-yellow-400">U$S {s.totalUSD.toFixed(0)}</td>
                  <td className="p-3 text-right text-muted-foreground">{s.totalARS > 0 ? `$${Math.round(s.totalARS).toLocaleString('es-AR')}` : "—"}</td>
                  <td className="p-3 text-right text-muted-foreground">U$S {(s.totalUSD / s.count).toFixed(0)}</td>
                  <td className="p-3 text-right text-muted-foreground">{s.lastDate ? new Date(s.lastDate).toLocaleDateString('es-AR') : "—"}</td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-yellow-500 rounded-full" style={{ width: `${share}%` }} />
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
      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-[5px] ${positive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
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

  const ttStyle = { background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 };

  return (
    <div className="space-y-6 pb-12">
      {/* Period pickers */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-card border border-primary/30 rounded-[10px] p-4 space-y-2">
          <p className="text-xs font-semibold text-primary uppercase tracking-wide">Período A</p>
          <div className="flex gap-2 flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">Desde</label>
              <Input type="date" value={aFrom} onChange={e => setAFrom(e.target.value)} className="h-8 px-2 text-xs" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">Hasta</label>
              <Input type="date" value={aTo} onChange={e => setATo(e.target.value)} className="h-8 px-2 text-xs" />
            </div>
          </div>
        </div>
        <div className="bg-card border border-muted rounded-[10px] p-4 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Período B</p>
          <div className="flex gap-2 flex-wrap">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">Desde</label>
              <Input type="date" value={bFrom} onChange={e => setBFrom(e.target.value)} className="h-8 px-2 text-xs" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-muted-foreground">Hasta</label>
              <Input type="date" value={bTo} onChange={e => setBTo(e.target.value)} className="h-8 px-2 text-xs" />
            </div>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-card border border-border/60 rounded-[10px] p-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Comparativa visual</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} barGap={4} barCategoryGap="30%">
            <XAxis dataKey="metric" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
            <YAxis tickFormatter={(v: number) => `$${Math.abs(v) >= 1000000 ? `${(v/1000000).toFixed(1)}M` : Math.abs(v) >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} width={60} />
            <Tooltip contentStyle={ttStyle} formatter={(v: number, name: string) => [formatARS(v), name]} />
            <Bar dataKey="A" name="Período A" fill="hsl(43,86%,55%)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="B" name="Período B" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Metrics table */}
      <div className="bg-card border border-border/60 rounded-[10px] overflow-x-auto">
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
    <div className="space-y-6 pb-12">
      {/* Location stock overview */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
          <MapPin className="w-4 h-4" />Stock por sucursal
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {stockByLocation.map(loc => (
            <div key={loc.id} className={`bg-card border rounded-[10px] p-4 ${loc.is_main ? 'border-primary/30' : 'border-border/60'}`}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-semibold text-sm flex items-center gap-1.5">
                    {loc.name}
                    {loc.is_main && <span className="text-[10px] bg-primary/15 text-primary px-1.5 py-0.5 rounded-[5px] font-semibold">Principal</span>}
                  </p>
                  {loc.address && <p className="text-[10px] text-muted-foreground mt-0.5">{loc.address}</p>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div className="bg-muted/40 rounded-lg p-2 text-center">
                  <p className="text-lg font-bold font-mono tracking-tight">{loc.totalUnits}</p>
                  <p className="text-[10px] text-muted-foreground">Unidades</p>
                </div>
                <div className="bg-muted/40 rounded-lg p-2 text-center">
                  <p className="text-lg font-bold font-mono tracking-tight">{loc.productCount}</p>
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
          <div className="bg-card border border-border/60 rounded-[10px] overflow-x-auto">
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
                      <td className="p-3 text-right text-emerald-400">{formatARS(s.profit)}</td>
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
          <div className="space-y-2 pb-12">
            {transfers.slice(0, 10).map(t => {
              const from = locations.find(l => l.id === t.from_location_id)?.name || "—";
              const to = locations.find(l => l.id === t.to_location_id)?.name || "—";
              return (
                <div key={t.id} className="flex items-center gap-3 bg-card border border-border/60 rounded-[10px] p-3 text-sm">
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

  const printPDF = () => {
    const fmtPct = (v: number) => `${v.toFixed(1)}%`;
    const rows = chartData.filter(d => d.revenue > 0).map(d => `
      <tr>
        <td>${d.label}</td>
        <td>${fmtARS(d.revenue)}</td>
        <td>${fmtARS(d.grossProfit)}</td>
        <td style="color:${d.grossMargin >= 30 ? '#16a34a' : d.grossMargin >= 15 ? '#d97706' : '#dc2626'};font-weight:bold">${fmtPct(d.grossMargin)}</td>
        <td>${fmtARS(d.expenses)}</td>
        <td>${fmtARS(d.net)}</td>
        <td style="color:${d.netMargin >= 15 ? '#16a34a' : d.netMargin >= 0 ? '#d97706' : '#dc2626'};font-weight:bold">${fmtPct(d.netMargin)}</td>
      </tr>`).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Tendencia de Márgenes</title>
<style>
  body{font-family:Arial,sans-serif;font-size:11px;color:#111;margin:20px}
  h1{font-size:16px;margin-bottom:4px}p.sub{color:#666;font-size:10px;margin:0 0 16px}
  table{width:100%;border-collapse:collapse}th{background:#f3f4f6;text-align:left;padding:6px 8px;font-size:10px;border-bottom:2px solid #e5e7eb}
  td{padding:5px 8px;border-bottom:1px solid #f0f0f0}
  .kpi{display:flex;gap:16px;margin-bottom:16px}
  .kpi-item{background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:8px 14px;min-width:120px;text-align:center}
  .kpi-item .val{font-size:18px;font-weight:bold;color:#b8860b}.kpi-item .lbl{font-size:9px;color:#777;margin-top:2px}
</style></head><body>
<h1>📈 Tendencia de Márgenes — Últimos ${months} meses</h1>
<p class="sub">Generado el ${new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
<div class="kpi">
  <div class="kpi-item"><div class="val">${avgGrossMargin.toFixed(1)}%</div><div class="lbl">Margen bruto promedio</div></div>
  ${lastMonth?.revenue > 0 ? `<div class="kpi-item"><div class="val">${lastMonth.grossMargin.toFixed(1)}%</div><div class="lbl">Margen mes actual</div></div>` : ''}
  ${bestMonth ? `<div class="kpi-item"><div class="val">${bestMonth.grossMargin.toFixed(1)}%</div><div class="lbl">Mejor mes (${bestMonth.label})</div></div>` : ''}
  ${worstMonth ? `<div class="kpi-item"><div class="val">${worstMonth.grossMargin.toFixed(1)}%</div><div class="lbl">Peor mes (${worstMonth.label})</div></div>` : ''}
</div>
<table>
  <thead><tr><th>Mes</th><th>Ingresos</th><th>Gan. Bruta</th><th>Margen %</th><th>Gastos</th><th>Gan. Neta</th><th>Margen Neto %</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
</body></html>`;
    const w = window.open('', '_blank', 'width=900,height=600');
    if (w) { w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 500); }
  };

  return (
    <div className="space-y-6 pb-12">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50 font-display">Tendencia de Márgenes</h3>
        <div className="flex items-center gap-2">
          <Select value={String(months)} onValueChange={value => setMonths(Number(value))}>
            <SelectTrigger className="h-8 w-[108px] text-xs" aria-label="Período de tendencia"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="3">3 meses</SelectItem>
              <SelectItem value="6">6 meses</SelectItem>
              <SelectItem value="12">12 meses</SelectItem>
              <SelectItem value="24">24 meses</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={printPDF} className="h-8 text-xs">
            <Printer className="w-3.5 h-3.5 mr-1.5" />PDF
          </Button>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card border border-border/60 rounded-[10px] p-3 text-center">
          <p className="text-xs text-muted-foreground mb-1">Margen bruto promedio</p>
          <p className="text-xl font-bold font-mono tracking-tight text-primary">{avgGrossMargin.toFixed(1)}%</p>
        </div>
        <div className="bg-card border border-border/60 rounded-[10px] p-3 text-center">
          <p className="text-xs text-muted-foreground mb-1">Margen mes actual</p>
          <p className={`text-xl font-bold font-mono tracking-tight ${(lastMonth?.grossMargin ?? 0) >= 30 ? 'text-emerald-400' : (lastMonth?.grossMargin ?? 0) >= 15 ? 'text-amber-400' : 'text-destructive'}`}>
            {lastMonth?.revenue > 0 ? `${lastMonth.grossMargin.toFixed(1)}%` : '—'}
          </p>
          {prevMonth?.revenue > 0 && (
            <p className={`text-[10px] mt-0.5 ${trend >= 0 ? 'text-emerald-400' : 'text-destructive'}`}>
              {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(1)}pp vs anterior
            </p>
          )}
        </div>
        <div className="bg-card border border-border/60 rounded-[10px] p-3 text-center">
          <p className="text-xs text-muted-foreground mb-1">Mejor mes</p>
          <p className="text-xl font-bold font-mono tracking-tight text-emerald-400">{bestMonth ? `${bestMonth.grossMargin.toFixed(1)}%` : '—'}</p>
          <p className="text-[10px] text-muted-foreground">{bestMonth?.label}</p>
        </div>
        <div className="bg-card border border-border/60 rounded-[10px] p-3 text-center">
          <p className="text-xs text-muted-foreground mb-1">Peor mes</p>
          <p className="text-xl font-bold font-mono tracking-tight text-destructive">{worstMonth ? `${worstMonth.grossMargin.toFixed(1)}%` : '—'}</p>
          <p className="text-[10px] text-muted-foreground">{worstMonth?.label}</p>
        </div>
      </div>

      {/* Gross margin % line chart */}
      <div className="bg-card border border-border/60 rounded-[10px] p-4">
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
      <div className="bg-card border border-border/60 rounded-[10px] p-4">
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
      <div className="bg-card border border-border/60 rounded-[10px] p-4">
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
      <div className="bg-card border border-border/60 rounded-[10px] overflow-x-auto">
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
                <td className={`px-4 py-2.5 text-right text-xs font-medium ${row.net >= 0 ? 'text-emerald-400' : 'text-destructive'}`}>{fmtARS(row.net)}</td>
                <td className="px-4 py-2.5 text-right text-xs">
                  <span className={`font-semibold ${row.grossMargin >= 30 ? 'text-emerald-400' : row.grossMargin >= 15 ? 'text-amber-400' : 'text-destructive'}`}>
                    {row.revenue > 0 ? `${row.grossMargin.toFixed(1)}%` : '—'}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right text-xs">
                  <span className={`font-semibold ${row.netMargin >= 10 ? 'text-emerald-400' : row.netMargin >= 0 ? 'text-amber-400' : 'text-destructive'}`}>
                    {row.revenue > 0 ? `${row.netMargin.toFixed(1)}%` : '—'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Period comparison panel */}
      <PeriodComparisonPanel sales={sales} expenses={expenses} />
    </div>
  );
}

function PeriodComparisonPanel({ sales, expenses }: { sales: any[]; expenses: any[] }) {
  const allMonths = Array.from(new Set(sales.map((s: any) => String(s.date).slice(0, 7)))).sort().reverse().slice(0, 24);
  const [monthA, setMonthA] = useState(allMonths[1] || allMonths[0]);
  const [monthB, setMonthB] = useState(allMonths[0]);
  if (allMonths.length < 2) return null;
        const fmtARS = (v: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(v);
        const computeMonth = (key: string) => {
          const ms = sales.filter((s: any) => String(s.date).slice(0, 7) === key);
          const es = expenses.filter((e: any) => String(e.date).slice(0, 7) === key);
          const revenue = ms.reduce((a: number, s: any) => a + Number(s.total_ars), 0);
          const grossProfit = ms.reduce((a: number, s: any) => a + Number(s.profit_ars), 0);
          const totalExpenses = es.reduce((a: number, e: any) => a + Number(e.amount_ars), 0);
          const net = grossProfit - totalExpenses;
          return { revenue, grossProfit, net, totalExpenses, grossMargin: revenue > 0 ? (grossProfit / revenue) * 100 : 0, netMargin: revenue > 0 ? (net / revenue) * 100 : 0 };
        };
        const dataA = computeMonth(monthA);
        const dataB = computeMonth(monthB);
        const monthLabel = (k: string) => { const [y, m] = k.split('-'); return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('es-AR', { month: 'long', year: '2-digit' }); };
        const Delta = ({ a, b, pct = false }: { a: number; b: number; pct?: boolean }) => {
          const diff = a - b;
          const diffPct = b !== 0 ? (diff / Math.abs(b)) * 100 : null;
          return diff === 0 ? <span className="text-muted-foreground text-xs">=</span> : (
            <span className={`text-xs font-semibold ${diff > 0 ? 'text-emerald-400' : 'text-destructive'}`}>
              {diff > 0 ? '▲' : '▼'} {pct ? `${Math.abs(diff).toFixed(1)}pp` : diffPct !== null ? `${Math.abs(diffPct).toFixed(0)}%` : '—'}
            </span>
          );
        };
        return (
          <div className="bg-card border border-border/60 rounded-[10px] p-4">
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">Comparativa de dos períodos</h4>
            <div className="flex gap-3 mb-4 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-12">Período A:</span>
                <Select value={monthA} onValueChange={setMonthA}>
                  <SelectTrigger className="h-8 w-[132px] text-xs" aria-label="Período A"><SelectValue /></SelectTrigger>
                  <SelectContent>{allMonths.map(m => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground w-12">Período B:</span>
                <Select value={monthB} onValueChange={setMonthB}>
                  <SelectTrigger className="h-8 w-[132px] text-xs" aria-label="Período B"><SelectValue /></SelectTrigger>
                  <SelectContent>{allMonths.map(m => <SelectItem key={m} value={m}>{monthLabel(m)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left py-2 pr-4">Métrica</th>
                    <th className="text-right py-2 px-3 capitalize">{monthLabel(monthA)}</th>
                    <th className="text-right py-2 px-3 capitalize">{monthLabel(monthB)}</th>
                    <th className="text-right py-2 pl-3">Δ A vs B</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {[
                    { label: "Ingresos", a: dataA.revenue, b: dataB.revenue },
                    { label: "Ganancia bruta", a: dataA.grossProfit, b: dataB.grossProfit },
                    { label: "Gastos", a: dataA.totalExpenses, b: dataB.totalExpenses },
                    { label: "Resultado neto", a: dataA.net, b: dataB.net },
                  ].map(row => (
                    <tr key={row.label}>
                      <td className="py-2 pr-4 text-muted-foreground">{row.label}</td>
                      <td className="py-2 px-3 text-right font-mono">{fmtARS(row.a)}</td>
                      <td className="py-2 px-3 text-right font-mono text-muted-foreground">{fmtARS(row.b)}</td>
                      <td className="py-2 pl-3 text-right"><Delta a={row.a} b={row.b} /></td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-2 pr-4 text-muted-foreground">Margen bruto %</td>
                    <td className={`py-2 px-3 text-right font-semibold ${dataA.grossMargin >= 30 ? 'text-emerald-400' : dataA.grossMargin >= 15 ? 'text-amber-400' : 'text-destructive'}`}>{dataA.grossMargin.toFixed(1)}%</td>
                    <td className={`py-2 px-3 text-right font-semibold text-muted-foreground`}>{dataB.grossMargin.toFixed(1)}%</td>
                    <td className="py-2 pl-3 text-right"><Delta a={dataA.grossMargin} b={dataB.grossMargin} pct /></td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4 text-muted-foreground">Margen neto %</td>
                    <td className={`py-2 px-3 text-right font-semibold ${dataA.netMargin >= 15 ? 'text-emerald-400' : dataA.netMargin >= 0 ? 'text-amber-400' : 'text-destructive'}`}>{dataA.netMargin.toFixed(1)}%</td>
                    <td className="py-2 px-3 text-right font-semibold text-muted-foreground">{dataB.netMargin.toFixed(1)}%</td>
                    <td className="py-2 pl-3 text-right"><Delta a={dataA.netMargin} b={dataB.netMargin} pct /></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
}

// ─────────────────────────────────────────────────────────────
// Clientes Tab
// ─────────────────────────────────────────────────────────────
function CustomersTab({ sales, period }: { sales: any[]; period: string }) {
  const [sortKey, setSortKey] = useState<"total" | "profit" | "count" | "avgTicket" | "lastDate">("total");
  const [sortAsc, setSortAsc] = useState(false);
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const map: Record<string, { name: string; total: number; profit: number; count: number; lastDate: string; units: number }> = {};
    for (const s of sales) {
      const key = s.customer_name?.trim() || "(Sin nombre)";
      if (!map[key]) map[key] = { name: key, total: 0, profit: 0, count: 0, lastDate: s.date || "", units: 0 };
      map[key].total += Number(s.total_ars) || 0;
      map[key].profit += Number(s.profit_ars) || 0;
      map[key].count++;
      map[key].units += Number(s.quantity) || 0;
      if ((s.date || "") > map[key].lastDate) map[key].lastDate = s.date;
    }
    const arr = Object.values(map).map(r => ({ ...r, avgTicket: r.count > 0 ? r.total / r.count : 0, margin: r.total > 0 ? (r.profit / r.total) * 100 : 0 }));
    const totalRev = arr.reduce((a, r) => a + r.total, 0);
    const withShare = arr.map(r => ({ ...r, share: totalRev > 0 ? (r.total / totalRev) * 100 : 0 }));
    return withShare
      .filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => {
        const dir = sortAsc ? 1 : -1;
        if (sortKey === "lastDate") return a.lastDate.localeCompare(b.lastDate) * dir;
        return (a[sortKey as keyof typeof a] as number - (b[sortKey as keyof typeof b] as number)) * dir;
      });
  }, [sales, sortKey, sortAsc, search]);

  const grandTotal = rows.reduce((a, r) => a + r.total, 0);
  const grandProfit = rows.reduce((a, r) => a + r.profit, 0);
  const top20Count = Math.max(1, Math.ceil(rows.length * 0.2));
  const top20Rev = [...rows].sort((a, b) => b.total - a.total).slice(0, top20Count).reduce((a, r) => a + r.total, 0);
  const concentration = grandTotal > 0 ? (top20Rev / grandTotal) * 100 : 0;

  const handleSort = (key: typeof sortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const exportCSVCustomers = () => {
    exportCSV("clientes-reporte.csv",
      ["Cliente", "Compras", "Unidades", "Total ARS", "Ganancia ARS", "Margen %", "Ticket Prom.", "% del total", "Última compra"],
      rows.map(r => [
        r.name, r.count.toString(), r.units.toString(),
        Math.round(r.total).toString(), Math.round(r.profit).toString(),
        r.margin.toFixed(1), Math.round(r.avgTicket).toString(),
        r.share.toFixed(1), r.lastDate,
      ])
    );
  };

  return (
    <div className="space-y-4 pb-12">
      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Clientes únicos", value: rows.length.toLocaleString("es-AR"), icon: Users, color: "text-primary" },
          { label: "Revenue por cliente", value: formatARS(rows.length > 0 ? grandTotal / rows.length : 0), icon: DollarSign, color: "text-emerald-400" },
          { label: "Ticket promedio", value: formatARS(sales.length > 0 ? grandTotal / sales.length : 0), icon: TrendingUp, color: "text-yellow-400" },
          { label: `Concentración top ${top20Count}`, value: `${concentration.toFixed(0)}%`, icon: BarChart2, color: concentration > 80 ? "text-destructive" : concentration > 60 ? "text-yellow-400" : "text-emerald-400" },
        ].map(k => (
          <div key={k.label} className="bg-card border border-border/60 rounded-[10px] p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider leading-tight">{k.label}</span>
              <k.icon className={`w-3.5 h-3.5 shrink-0 ${k.color}`} />
            </div>
            <p className={`text-lg font-bold font-mono tracking-tight font-display ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <Input placeholder="Buscar cliente..." value={search} onChange={e => setSearch(e.target.value)} className="bg-muted border-border w-56" />
        <div className="flex gap-2 items-center">
          <span className="text-xs text-muted-foreground">{period}</span>
          <Button variant="outline" size="sm" onClick={exportCSVCustomers}>
            <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />CSV
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-border/60 rounded-[10px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-3 py-2.5 text-xs text-muted-foreground uppercase tracking-wide font-medium">#</th>
                <th className="text-left px-3 py-2.5 text-xs text-muted-foreground uppercase tracking-wide font-medium">Cliente</th>
                <SortTh label="Compras" sortKey="count" current={sortKey} asc={sortAsc} onClick={handleSort} />
                <SortTh label="Total ARS" sortKey="total" current={sortKey} asc={sortAsc} onClick={handleSort} right />
                <SortTh label="Ganancia" sortKey="profit" current={sortKey} asc={sortAsc} onClick={handleSort} right />
                <SortTh label="Ticket prom." sortKey="avgTicket" current={sortKey} asc={sortAsc} onClick={handleSort} right />
                <th className="text-right px-3 py-2.5 text-xs text-muted-foreground uppercase tracking-wide font-medium hidden md:table-cell">% Total</th>
                <SortTh label="Última compra" sortKey="lastDate" current={sortKey} asc={sortAsc} onClick={handleSort} right />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-10 text-muted-foreground text-sm">Sin datos para el período seleccionado</td></tr>
              ) : rows.map((r, i) => (
                <tr key={r.name} className="hover:bg-muted/20 transition-colors">
                  <td className="px-3 py-2.5 text-xs text-muted-foreground font-mono">{i + 1}</td>
                  <td className="px-3 py-2.5">
                    <div>
                      <p className="font-medium text-sm leading-tight">{r.name}</p>
                      <div className="w-full bg-muted h-1 rounded-full mt-1">
                        <div className="h-1 rounded-full bg-primary/60" style={{ width: `${Math.min(100, r.share * 3)}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className="px-2 py-0.5 rounded-[5px] text-xs font-medium bg-muted text-muted-foreground">{r.count}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-xs font-mono text-primary">{formatARS(r.total)}</td>
                  <td className="px-3 py-2.5 text-right text-xs font-mono text-emerald-400">{formatARS(r.profit)}</td>
                  <td className="px-3 py-2.5 text-right text-xs font-mono">{formatARS(r.avgTicket)}</td>
                  <td className="px-3 py-2.5 text-right text-xs text-muted-foreground hidden md:table-cell">{r.share.toFixed(1)}%</td>
                  <td className="px-3 py-2.5 text-right text-xs text-muted-foreground">
                    {r.lastDate ? new Date(r.lastDate + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "short" }) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/40 font-bold text-sm">
                  <td className="px-3 py-2.5" colSpan={2}>TOTAL ({rows.length} clientes)</td>
                  <td className="px-3 py-2.5 text-center">{sales.length}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-primary">{formatARS(grandTotal)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-emerald-400">{formatARS(grandProfit)}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{formatARS(sales.length > 0 ? grandTotal / sales.length : 0)}</td>
                  <td className="hidden md:table-cell" />
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Tendencia por Día de Semana Tab
// ─────────────────────────────────────────────────────────────
function WeeklyTrendTab({ sales }: { sales: any[] }) {
  const [weeks, setWeeks] = useState(8);

  const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const DAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  const { byDay, byDayByWeek, topDay } = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - weeks * 7);

    const recent = sales.filter(s => new Date(s.date + 'T12:00:00') >= cutoff);

    // Count occurrences of each weekday in the period (to compute averages)
    const dayCount: number[] = [0, 0, 0, 0, 0, 0, 0];
    const d = new Date(cutoff);
    while (d <= new Date()) {
      dayCount[d.getDay()]++;
      d.setDate(d.getDate() + 1);
    }

    // Aggregate totals and profit per weekday
    const totals: number[] = [0, 0, 0, 0, 0, 0, 0];
    const profits: number[] = [0, 0, 0, 0, 0, 0, 0];
    const counts: number[] = [0, 0, 0, 0, 0, 0, 0];
    recent.forEach(s => {
      const dow = new Date(s.date + 'T12:00:00').getDay();
      totals[dow] += Number(s.total_ars || 0);
      profits[dow] += Number(s.profit_ars || 0);
      counts[dow]++;
    });

    const byDay = DAY_NAMES.map((name, i) => ({
      name: DAY_SHORT[i],
      fullName: name,
      avgRevenue: dayCount[i] > 0 ? Math.round(totals[i] / dayCount[i]) : 0,
      avgProfit: dayCount[i] > 0 ? Math.round(profits[i] / dayCount[i]) : 0,
      totalRevenue: totals[i],
      salesCount: counts[i],
    }));

    // Reorder Mon→Sun (1..6, 0)
    const ordered = [...byDay.slice(1), byDay[0]];

    const topDay = ordered.reduce((best, d) => d.avgRevenue > best.avgRevenue ? d : best, ordered[0]);

    // Week-by-week heatmap data (last N weeks, grouped by week start)
    const weekMap: Record<string, { week: string; days: number[] }> = {};
    recent.forEach(s => {
      const dt = new Date(s.date + 'T12:00:00');
      const mon = new Date(dt);
      mon.setDate(dt.getDate() - ((dt.getDay() + 6) % 7)); // Monday of that week
      const key = mon.toISOString().slice(0, 10);
      if (!weekMap[key]) {
        weekMap[key] = { week: mon.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }), days: [0, 0, 0, 0, 0, 0, 0] };
      }
      const dow = (dt.getDay() + 6) % 7; // 0=Mon … 6=Sun
      weekMap[key].days[dow] += Number(s.total_ars || 0);
    });
    const byDayByWeek = Object.entries(weekMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-weeks)
      .map(([, v]) => v);

    return { byDay: ordered, byDayByWeek, topDay };
  }, [sales, weeks]);

  const maxRevenue = Math.max(...byDay.map(d => d.avgRevenue), 1);

  const exportCSV2 = () => {
    const rows = byDay.map(d => [d.fullName, formatARS(d.avgRevenue), formatARS(d.avgProfit), String(d.salesCount)]);
    exportCSV(`tendencia_semanal_${new Date().toISOString().slice(0, 10)}.csv`,
      ['Día', 'Ingreso Promedio (ARS)', 'Ganancia Promedio (ARS)', '# Ventas'],
      rows
    );
  };

  return (
    <div className="space-y-6 mt-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-display font-semibold uppercase tracking-wider">Tendencia por día de semana</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Promedio de ingresos y ganancias por día, últimas {weeks} semanas</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(weeks)} onValueChange={value => setWeeks(Number(value))}>
            <SelectTrigger className="h-8 w-[166px] text-xs" aria-label="Período por día de semana"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="4">Últimas 4 semanas</SelectItem>
              <SelectItem value="8">Últimas 8 semanas</SelectItem>
              <SelectItem value="12">Últimas 12 semanas</SelectItem>
            </SelectContent>
          </Select>
          <button onClick={exportCSV2} className="text-xs text-primary hover:underline flex items-center gap-1">
            <FileSpreadsheet className="w-3.5 h-3.5" />CSV
          </button>
        </div>
      </div>

      {/* Best day badge */}
      {topDay && topDay.avgRevenue > 0 && (
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-[5px] bg-primary/10 border border-primary/20">
          <TrendingUp className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-medium">Mejor día: <span className="text-primary font-bold">{topDay.fullName}</span> — promedio {formatARS(topDay.avgRevenue)}</span>
        </div>
      )}

      {/* Bar chart */}
      <div className="bg-card border border-border/60 rounded-[10px] p-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Ingreso promedio por día</p>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={byDay} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis width={80} tickFormatter={v => formatARS(v)} tick={{ fontSize: 10 }} />
            <Tooltip
              formatter={(v: number, name: string) => [formatARS(v), name === 'avgRevenue' ? 'Ingresos' : 'Ganancia']}
              labelFormatter={(l: string) => DAY_NAMES[['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].indexOf(l)] || l}
            />
            <Bar dataKey="avgRevenue" name="avgRevenue" radius={[4, 4, 0, 0]}>
              {byDay.map((d, i) => (
                <Cell key={i} fill={d.avgRevenue === maxRevenue ? '#D4A843' : '#6366f1'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Detail table */}
      <div className="bg-card border border-border/60 rounded-[10px] overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-muted-foreground text-xs">
              <th className="text-left px-4 py-2.5 font-medium">Día</th>
              <th className="text-right px-4 py-2.5 font-medium">Ing. promedio</th>
              <th className="text-right px-4 py-2.5 font-medium">Gan. promedio</th>
              <th className="text-right px-4 py-2.5 font-medium"># Ventas</th>
              <th className="text-right px-4 py-2.5 font-medium hidden md:table-cell">Participación</th>
            </tr>
          </thead>
          <tbody>
            {byDay.map((d, i) => {
              const pct = maxRevenue > 0 ? (d.avgRevenue / maxRevenue) * 100 : 0;
              const isTop = d.avgRevenue === maxRevenue && d.avgRevenue > 0;
              return (
                <tr key={i} className={`border-b border-border last:border-0 ${isTop ? 'bg-primary/5' : 'hover:bg-muted/20'}`}>
                  <td className="px-4 py-2.5 font-medium">
                    {d.fullName}
                    {isTop && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-[5px] bg-primary/20 text-primary font-bold">MEJOR</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-primary text-xs">{formatARS(d.avgRevenue)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-emerald-400 text-xs">{formatARS(d.avgProfit)}</td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground text-xs">{d.salesCount}</td>
                  <td className="px-4 py-2.5 hidden md:table-cell">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] text-muted-foreground w-8 text-right">{Math.round(pct)}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Weekly heatmap */}
      {byDayByWeek.length > 0 && (
        <div className="bg-card border border-border/60 rounded-[10px] p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Heatmap semanal (ingresos por día)</p>
          <div className="overflow-x-auto">
            <table className="text-[10px] border-collapse w-full min-w-[360px]">
              <thead>
                <tr>
                  <th className="text-left pr-2 pb-1 text-muted-foreground font-medium">Semana</th>
                  {['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(d => (
                    <th key={d} className="px-1 pb-1 text-center text-muted-foreground font-medium w-14">{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {byDayByWeek.map((w, wi) => {
                  const maxDay = Math.max(...w.days, 1);
                  return (
                    <tr key={wi}>
                      <td className="pr-2 py-0.5 text-muted-foreground font-mono whitespace-nowrap">{w.week}</td>
                      {w.days.map((val, di) => {
                        const intensity = val > 0 ? Math.max(0.1, val / maxDay) : 0;
                        return (
                          <td key={di} className="px-0.5 py-0.5">
                            <div
                              className="rounded text-center py-1 text-[9px] font-mono"
                              style={{ background: val > 0 ? `rgba(212, 168, 67, ${intensity})` : 'transparent', color: intensity > 0.6 ? '#1a1a1a' : '#aaa' }}
                              title={val > 0 ? formatARS(val) : 'Sin ventas'}
                            >
                              {val > 0 ? `${Math.round(val / 1000)}k` : '—'}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// By Week Tab — week-over-week comparison (last 12 weeks)
// ─────────────────────────────────────────────────────────────
function ByWeekTab({ sales }: { sales: any[] }) {
  const [weeksCount, setWeeksCount] = useState(8);

  const weekData = useMemo(() => {
    const now = new Date();
    // Start from Monday of (weeksCount) weeks ago
    const dow = now.getDay();
    const thisMon = new Date(now);
    thisMon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
    thisMon.setHours(0, 0, 0, 0);

    const weeks = Array.from({ length: weeksCount }, (_, i) => {
      const mon = new Date(thisMon);
      mon.setDate(thisMon.getDate() - (weeksCount - 1 - i) * 7);
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      sun.setHours(23, 59, 59, 999);
      const label = `${String(mon.getDate()).padStart(2, '0')}/${String(mon.getMonth() + 1).padStart(2, '0')}`;
      return { label, mon, sun, revenue: 0, profit: 0, count: 0 };
    });

    sales.forEach((s: any) => {
      const d = new Date(s.date + "T12:00:00");
      const slot = weeks.find(w => d >= w.mon && d <= w.sun);
      if (slot) {
        slot.revenue += Number(s.total_ars || 0);
        slot.profit += Number(s.profit_ars || 0);
        slot.count++;
      }
    });

    return weeks;
  }, [sales, weeksCount]);

  const maxRevenue = Math.max(...weekData.map(w => w.revenue), 1);
  const currentWeek = weekData[weekData.length - 1];
  const prevWeek = weekData[weekData.length - 2];
  const deltaRev = prevWeek && prevWeek.revenue > 0 ? ((currentWeek.revenue - prevWeek.revenue) / prevWeek.revenue) * 100 : 0;

  function exportWeeksCSV() {
    const BOM = "﻿";
    const headers = ["Semana (inicio)", "Ingresos (ARS)", "Ganancia (ARS)", "Margen %", "Ventas"];
    const rows = weekData.map(w => [
      w.label,
      w.revenue.toFixed(2),
      w.profit.toFixed(2),
      w.revenue > 0 ? ((w.profit / w.revenue) * 100).toFixed(2) : "0",
      w.count,
    ]);
    const csv = BOM + [headers, ...rows].map(r => r.join(";")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    a.download = `ventas-semanas-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  return (
    <div className="space-y-4 mt-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold">Ventas semana a semana</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Semana actual: <span className={`font-semibold ${deltaRev >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {deltaRev >= 0 ? '▲' : '▼'} {Math.abs(deltaRev).toFixed(1)}%
            </span> vs semana anterior
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(weeksCount)} onValueChange={value => setWeeksCount(Number(value))}>
            <SelectTrigger className="h-8 w-[116px] text-xs" aria-label="Semanas a comparar"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="4">4 semanas</SelectItem>
              <SelectItem value="8">8 semanas</SelectItem>
              <SelectItem value="12">12 semanas</SelectItem>
            </SelectContent>
          </Select>
          <button onClick={exportWeeksCSV} className="text-xs text-primary hover:underline flex items-center gap-1">
            <FileSpreadsheet className="w-3.5 h-3.5" />CSV
          </button>
        </div>
      </div>

      {/* Bar chart */}
      <div className="bg-card border border-border/60 rounded-[10px] p-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Ingresos por semana</p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={weekData} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip formatter={(v: number) => [formatARS(v), "Ingresos"]} />
            <Bar dataKey="revenue" name="Ingresos" radius={[4, 4, 0, 0]}>
              {weekData.map((w, i) => (
                <Cell key={i} fill={i === weekData.length - 1 ? 'hsl(40,70%,50%)' : 'hsl(200,60%,40%)'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Table */}
      <div className="bg-card border border-border/60 rounded-[10px] overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Semana</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ingresos</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Ganancia</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Margen</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ventas</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">Δ vs ant.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {weekData.map((w, i) => {
              const prev = weekData[i - 1];
              const delta = prev && prev.revenue > 0 ? ((w.revenue - prev.revenue) / prev.revenue) * 100 : null;
              const margin = w.revenue > 0 ? (w.profit / w.revenue) * 100 : 0;
              const barW = Math.round((w.revenue / maxRevenue) * 100);
              const isCurrent = i === weekData.length - 1;
              return (
                <tr key={w.label} className={`hover:bg-muted/20 transition-colors ${isCurrent ? 'bg-primary/5' : ''}`}>
                  <td className="px-4 py-3 font-medium">
                    <div className="flex items-center gap-2">
                      <span>{w.label}</span>
                      {isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-semibold">Esta semana</span>}
                    </div>
                    <div className="mt-1 h-1 bg-muted rounded-full overflow-hidden w-24">
                      <div className="h-full rounded-full bg-primary/60" style={{ width: `${barW}%` }} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-bold">{w.revenue > 0 ? formatARS(w.revenue) : <span className="text-muted-foreground text-xs">—</span>}</td>
                  <td className="px-4 py-3 text-right text-emerald-400 hidden md:table-cell">{w.profit > 0 ? formatARS(w.profit) : <span className="text-muted-foreground text-xs">—</span>}</td>
                  <td className="px-4 py-3 text-right hidden md:table-cell">
                    <span className={`font-semibold ${margin >= 30 ? 'text-green-400' : margin >= 15 ? 'text-yellow-400' : 'text-red-400'}`}>
                      {w.revenue > 0 ? `${margin.toFixed(1)}%` : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{w.count}</td>
                  <td className="px-4 py-3 text-right hidden sm:table-cell">
                    {delta !== null ? (
                      <span className={`text-xs font-semibold ${delta >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
                      </span>
                    ) : <span className="text-muted-foreground text-xs">—</span>}
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
// Scheduled Reports Tab
// Configure and trigger automated monthly report emails
// ─────────────────────────────────────────────────────────────
type ReportType = "income" | "sales" | "inventory" | "debts";

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  income: "Estado de Resultados",
  sales: "Reporte de Ventas",
  inventory: "Inventario Valorado",
  debts: "Deudas Pendientes",
};

function ScheduledReportsTab({ userId, settings }: { userId: string; settings: any }) {
  const LAST_KEY = `gestiona.report_last_sent.${userId}`;
  const [enabled, setEnabled] = useState<boolean>(settings?.report_monthly_enabled ?? false);
  const [dayOfMonth, setDayOfMonth] = useState<string>(String(settings?.report_monthly_day ?? 1));
  const [recipientEmail, setRecipientEmail] = useState<string>(settings?.report_monthly_email ?? settings?.email ?? "");
  const [reportTypes, setReportTypes] = useState<ReportType[]>(() => {
    const saved = settings?.report_monthly_types;
    return Array.isArray(saved) && saved.length > 0 ? saved : ["income", "sales"];
  });
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [lastSent, setLastSent] = useState<string | null>(() => localStorage.getItem(LAST_KEY));

  const toggleType = (t: ReportType) => {
    setReportTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSettingsDB(userId, {
        report_monthly_enabled: enabled,
        report_monthly_day: parseInt(dayOfMonth) || 1,
        report_monthly_email: recipientEmail.trim(),
        report_monthly_types: reportTypes,
      });
      toast.success("Configuracion de reportes guardada");
    } catch (e: any) {
      toast.error("Error guardando: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSendNow = async () => {
    if (!recipientEmail.trim()) { toast.error("Configura un email destinatario"); return; }
    if (reportTypes.length === 0) { toast.error("Selecciona al menos un tipo de reporte"); return; }
    setSending(true);
    try {
      const { error } = await supabase.functions.invoke("weekly-performance-digest", {
        body: {
          userId,
          force: true,
          recipientEmail: recipientEmail.trim(),
          reportTypes,
          subject: `Reporte mensual — ${new Date().toLocaleDateString("es-AR", { month: "long", year: "numeric" })}`,
        },
      });
      if (error) throw error;
      const ts = new Date().toLocaleString("es-AR");
      setLastSent(ts);
      localStorage.setItem(LAST_KEY, ts);
      toast.success(`Reporte enviado a ${recipientEmail.trim()}`, { duration: 5000 });
    } catch (e: any) {
      toast.error("Error: " + (e.message ?? "Verifica la configuracion SMTP en Ajustes"));
    } finally {
      setSending(false);
    }
  };

  const nextRunDate = useMemo(() => {
    const day = parseInt(dayOfMonth) || 1;
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), day);
    if (target <= now) target.setMonth(target.getMonth() + 1);
    return target.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
  }, [dayOfMonth]);

  return (
    <div className="space-y-6 mt-4 max-w-2xl">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Mail className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h3 className="font-semibold">Reportes automaticos por email</h3>
          <p className="text-sm text-muted-foreground">Recibi un resumen mensual del negocio directamente en tu email.</p>
        </div>
      </div>

      <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-card">
        <div>
          <p className="text-sm font-medium">Reporte mensual automatico</p>
          <p className="text-xs text-muted-foreground">
            {enabled ? `Proximo envio: ${nextRunDate}` : "Desactivado"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEnabled(e => !e)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled ? "bg-primary" : "bg-muted"}`}
        >
          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? "translate-x-6" : "translate-x-1"}`} />
        </button>
      </div>

      <div className="space-y-4 p-4 rounded-xl border border-border bg-card">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          Configuracion
        </h4>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Email destinatario</label>
            <div className="relative">
              <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="email"
                value={recipientEmail}
                onChange={e => setRecipientEmail(e.target.value)}
                placeholder="tu@email.com"
                className="w-full pl-8 pr-3 py-2 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Dia del mes</label>
            <Select value={dayOfMonth} onValueChange={setDayOfMonth}>
              <SelectTrigger className="w-full" aria-label="Día del reporte mensual"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                  <SelectItem key={d} value={String(d)}>Día {d}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-2 block">Incluir en el reporte</label>
          <div className="grid grid-cols-2 gap-2">
            {(Object.entries(REPORT_TYPE_LABELS) as [ReportType, string][]).map(([type, label]) => (
              <button
                key={type}
                type="button"
                onClick={() => toggleType(type)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                  reportTypes.includes(type)
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"
                }`}
              >
                <div className={`w-4 h-4 rounded flex items-center justify-center border flex-shrink-0 ${reportTypes.includes(type) ? "border-primary bg-primary" : "border-border"}`}>
                  {reportTypes.includes(type) && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                </div>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <Button onClick={handleSave} disabled={saving} className="gradient-gold text-primary-foreground font-semibold">
          {saving ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Guardando...</> : <><Check className="w-4 h-4 mr-2" />Guardar configuracion</>}
        </Button>
        <Button variant="outline" onClick={handleSendNow} disabled={sending}>
          {sending ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Enviando...</> : <><Send className="w-4 h-4 mr-2" />Enviar ahora</>}
        </Button>
      </div>

      {lastSent && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground p-3 rounded-lg bg-muted/30 border border-border/50">
          <Clock className="w-3.5 h-3.5 shrink-0" />
          Ultimo envio: {lastSent}
        </div>
      )}

      <div className="p-4 rounded-xl border border-blue-500/20 bg-blue-500/5 space-y-2">
        <p className="text-xs font-semibold text-blue-400 flex items-center gap-1.5">
          <Bell className="w-3.5 h-3.5" />Como funciona
        </p>
        <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
          <li>El reporte se genera automaticamente el dia configurado.</li>
          <li>Incluye resumen de ventas, ganancias, stock y deudas del mes.</li>
          <li>Podes enviar una prueba ahora con "Enviar ahora".</li>
          <li>Requiere configurar SMTP en Ajustes.</li>
        </ul>
      </div>
    </div>
  );
}

// ─── Forecast Tab ─────────────────────────────────────────────────────────────

function ForecastTab({ sales }: { sales: any[] }) {
  const [lookback, setLookback] = useState(30);
  const [horizon, setHorizon] = useState(14);

  const { forecast, trend, r2, slope } = useSalesForecaster(sales, { lookback, horizon });

  // Build combined chart data: last 14 days actual + forecast
  const chartData = useMemo(() => {
    const dailyMap: Record<string, number> = {};
    for (const s of sales) {
      const d = String(s.date).slice(0, 10);
      dailyMap[d] = (dailyMap[d] ?? 0) + Number(s.total_ars ?? 0);
    }
    const today = new Date().toISOString().slice(0, 10);
    const actuals: { date: string; actual: number; projected?: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() - i);
      const ds = d.toISOString().slice(0, 10);
      actuals.push({ date: ds, actual: dailyMap[ds] ?? 0 });
    }
    const projections = forecast.map(f => ({
      date: f.date,
      actual: undefined as unknown as number,
      projected: f.projected,
      lower: f.lower,
      upper: f.upper,
    }));
    return [...actuals, ...projections];
  }, [sales, forecast]);

  const totalForecast = forecast.reduce((s, f) => s + f.projected, 0);
  const avgForecast = forecast.length > 0 ? totalForecast / forecast.length : 0;

  const trendIcon = trend === "up" ? "↑" : trend === "down" ? "↓" : "→";
  const trendColor = trend === "up" ? "text-emerald-400" : trend === "down" ? "text-red-400" : "text-yellow-400";
  const trendLabel = trend === "up" ? "Tendencia alcista" : trend === "down" ? "Tendencia bajista" : "Tendencia estable";

  const r2Color = r2 >= 0.7 ? "text-emerald-400" : r2 >= 0.4 ? "text-yellow-400" : "text-red-400";
  const r2Label = r2 >= 0.7 ? "Alta confianza" : r2 >= 0.4 ? "Confianza media" : "Baja confianza";

  const slopeAbs = Math.abs(slope);
  const slopeSign = slope >= 0 ? "+" : "-";

  return (
    <div className="space-y-5 pb-12">
      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center p-4 rounded-xl border border-border bg-card">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Historial:</span>
          {[14, 30, 60, 90].map(d => (
            <button
              key={d}
              onClick={() => setLookback(d)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${lookback === d ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
            >
              {d}d
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 border-l border-border/50 pl-3">
          <span className="text-xs text-muted-foreground">Proyectar:</span>
          {[7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => setHorizon(d)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${horizon === d ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card border border-border rounded-xl p-4 space-y-1">
          <p className="text-xs text-muted-foreground">Tendencia</p>
          <p className={`text-2xl font-bold ${trendColor}`}>{trendIcon}</p>
          <p className={`text-xs font-medium ${trendColor}`}>{trendLabel}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 space-y-1">
          <p className="text-xs text-muted-foreground">Proyección {horizon}d</p>
          <p className="text-lg font-bold text-primary font-mono">{formatARS(totalForecast)}</p>
          <p className="text-xs text-muted-foreground">~{formatARS(avgForecast)}/día</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 space-y-1">
          <p className="text-xs text-muted-foreground">Confianza (R²)</p>
          <p className={`text-2xl font-bold ${r2Color}`}>{(r2 * 100).toFixed(0)}%</p>
          <p className={`text-xs font-medium ${r2Color}`}>{r2Label}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4 space-y-1">
          <p className="text-xs text-muted-foreground">Pendiente diaria</p>
          <p className={`text-lg font-bold font-mono ${slope >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {slopeSign}{formatARS(slopeAbs)}
          </p>
          <p className="text-xs text-muted-foreground">por día</p>
        </div>
      </div>

      {/* Chart */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <span>Ventas reales + proyección (regresión lineal)</span>
          <span className="text-[10px] text-muted-foreground bg-muted rounded px-2 py-0.5">OLS</span>
        </h3>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartData} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={d => {
                const dt = new Date(d + "T12:00:00Z");
                return dt.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
              }}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
              tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 11 }}
              formatter={(val: any, name: string) => [
                formatARS(Number(val)),
                name === "actual" ? "Real" : name === "projected" ? "Proyectado" : name === "upper" ? "Límite sup." : "Límite inf.",
              ]}
              labelFormatter={d => {
                const dt = new Date(d + "T12:00:00Z");
                return dt.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "short" });
              }}
            />
            {/* Confidence band */}
            <Area dataKey="upper" fill="hsl(var(--primary))" stroke="none" opacity={0.08} name="upper" />
            <Area dataKey="lower" fill="hsl(var(--background))" stroke="none" opacity={1} name="lower" />
            {/* Actual sales bars */}
            <Bar dataKey="actual" fill="hsl(var(--primary))" opacity={0.85} radius={[3, 3, 0, 0]} name="actual" />
            {/* Projected line */}
            <Line
              dataKey="projected"
              stroke="hsl(45, 90%, 55%)"
              strokeWidth={2}
              strokeDasharray="5 3"
              dot={false}
              name="projected"
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Forecast table */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border/50">
          <h3 className="text-sm font-semibold">Proyección día a día</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <th className="px-4 py-2.5 text-left text-xs text-muted-foreground font-medium">Fecha</th>
                <th className="px-4 py-2.5 text-right text-xs text-muted-foreground font-medium">Proyectado</th>
                <th className="px-4 py-2.5 text-right text-xs text-muted-foreground font-medium">Rango 80%</th>
              </tr>
            </thead>
            <tbody>
              {forecast.map((f, i) => {
                const dt = new Date(f.date + "T12:00:00Z");
                const isWeekend = dt.getUTCDay() === 0 || dt.getUTCDay() === 6;
                return (
                  <tr key={f.date} className={`border-b border-border/30 last:border-0 ${isWeekend ? "bg-muted/20" : ""}`}>
                    <td className="px-4 py-2 text-xs">
                      <span className={`font-medium ${isWeekend ? "text-muted-foreground" : ""}`}>
                        {dt.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "short" })}
                      </span>
                      {isWeekend && <span className="ml-1.5 text-[10px] text-muted-foreground/60">fin de semana</span>}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs font-semibold text-primary">
                      {formatARS(f.projected)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs text-muted-foreground">
                      {formatARS(f.lower)} – {formatARS(f.upper)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-muted/30">
                <td className="px-4 py-2.5 text-xs font-bold">Total proyectado</td>
                <td className="px-4 py-2.5 text-right font-mono text-sm font-bold text-primary">{formatARS(totalForecast)}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">
                  {formatARS(forecast.reduce((s, f) => s + f.lower, 0))} – {formatARS(forecast.reduce((s, f) => s + f.upper, 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Methodology note */}
      <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-1.5">
        <p className="text-xs font-semibold text-primary flex items-center gap-1.5">🔬 Metodología</p>
        <p className="text-xs text-muted-foreground">
          Regresión lineal OLS (Ordinary Least Squares) sobre los últimos <strong>{lookback} días</strong> de ventas diarias.
          R² = <strong className={r2Color}>{(r2 * 100).toFixed(1)}%</strong> — indica qué tan bien el modelo se ajusta a los datos históricos.
          Rango de confianza al <strong>80%</strong>. No considera estacionalidad ni eventos extraordinarios.
        </p>
      </div>
    </div>
  );
}

