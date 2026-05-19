import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { usePlanLimits } from "@/lib/usePlanLimits";
import { getSalesDB, addSaleDB, deleteSaleDB, updateSaleDB, getProductsDB, getSettingsDB, formatARS, formatUSD, getCategoryLabel, getUniqueCustomersDB, formatDateAR, dateToNoon, calculateDecantPrice, calculateWholesalePrice, validateCouponDB, incrementCouponUse, getVariantsByUserDB, addSaleWithVariantDB, findExchangeByCode, attributeSaleToExchange } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Trash2, DollarSign, ChevronLeft, ChevronRight, Edit, Filter, Ticket, ShoppingCart, X, FileText, TrendingUp, Search, Percent, Users, LayoutList, Square, CheckSquare, CheckCheck, Printer, FileSpreadsheet } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { toast } from "sonner";
import { checkStockAfterSale } from "@/lib/stockNotifications";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import EmptyState from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/PageSkeleton";
import { logAudit } from "@/lib/auditLog";
import { useUserRole } from "@/lib/useUserRole";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";

const PAGE_SIZE = 20;

const PAYMENT_METHODS = [
  { value: 'efectivo', label: 'Efectivo', usesDiscount: true },
  { value: 'transferencia', label: 'Transferencia', usesDiscount: true },
  { value: 'mayorista', label: 'Mayorista', usesDiscount: true },
  { value: 'debito', label: 'Débito', usesDiscount: false },
  { value: 'credito', label: 'Crédito', usesDiscount: false },
  { value: 'fiado', label: 'Fiado', usesDiscount: false },
];

const CATEGORIES = [
  { value: 'all', label: 'Todas' },
  { value: 'perfume_arabe', label: 'Perfume Árabe' },
  { value: 'perfume_diseñador', label: 'Perfume Diseñador' },
  { value: 'vaper', label: 'Vaper' },
  { value: 'electronico', label: 'Electrónico' },
];

const PAYMENT_BADGE: Record<string, string> = {
  efectivo: 'bg-success/15 text-success',
  transferencia: 'bg-blue-500/15 text-blue-400',
  mayorista: 'bg-purple-500/15 text-purple-400',
  debito: 'bg-primary/15 text-primary',
  credito: 'bg-warning/15 text-warning',
  fiado: 'bg-destructive/15 text-destructive',
};

// ============ LINE ITEM TYPE ============
interface SaleLineItem {
  id: string;
  productId: string;
  variantId: string;
  quantity: number;
  decantSize: string;
  customPrice: string;
}

function createLineItem(): SaleLineItem {
  return { id: crypto.randomUUID(), productId: '', variantId: '', quantity: 1, decantSize: 'full', customPrice: '' };
}

export default function SalesPage() {
  const { user } = useAuth();
  const { isAdmin } = useUserRole();
  const navigate = useNavigate();
  const [sales, setSales] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [datePreset, setDatePreset] = useState<string>("all");
  const [filterCat, setFilterCat] = useState('all');

  const applyPreset = (preset: string) => {
    setDatePreset(preset);
    setPage(0);
    const now = new Date();
    if (preset === "all") { setDateFrom(undefined); setDateTo(undefined); return; }
    if (preset === "today") {
      const s = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      setDateFrom(s); setDateTo(now); return;
    }
    if (preset === "yesterday") {
      const s = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      const e = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59);
      setDateFrom(s); setDateTo(e); return;
    }
    if (preset === "week") {
      const s = new Date(now); s.setDate(now.getDate() - now.getDay()); s.setHours(0, 0, 0, 0);
      setDateFrom(s); setDateTo(now); return;
    }
    if (preset === "month") {
      setDateFrom(new Date(now.getFullYear(), now.getMonth(), 1)); setDateTo(now); return;
    }
    if (preset === "lastmonth") {
      setDateFrom(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      setDateTo(new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)); return;
    }
  };
  const reload = async () => {
    if (user) {
      const [s, p] = await Promise.all([getSalesDB(user.id), getProductsDB(user.id)]);
      setSales(s);
      setProducts(p);
      setLoading(false);
    }
  };
  useEffect(() => { reload(); }, [user]);

  const productCatMap = useMemo(() => {
    const map: Record<string, string> = {};
    products.forEach(p => { map[p.id] = p.category; });
    return map;
  }, [products]);

  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<"list" | "by_customer" | "by_session">("list");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [filterPaid, setFilterPaid] = useState<'all' | 'paid' | 'pending'>('all');
  const [filterMethod, setFilterMethod] = useState('all');

  const filtered = sales.filter(s => {
    if (filterCat !== 'all' && productCatMap[s.product_id] !== filterCat) return false;
    if (filterPaid === 'paid' && !s.paid) return false;
    if (filterPaid === 'pending' && s.paid) return false;
    if (filterMethod !== 'all' && s.payment_method !== filterMethod) return false;
    if (search && !s.product_name?.toLowerCase().includes(search.toLowerCase()) && !s.customer_name?.toLowerCase().includes(search.toLowerCase())) return false;
    if (!dateFrom) return true;
    const d = new Date(s.date);
    if (d < dateFrom) return false;
    if (dateTo) { const end = new Date(dateTo); end.setHours(23,59,59,999); if (d > end) return false; }
    return true;
  });
  const totalSales = filtered.reduce((s, v) => s + Number(v.total_ars), 0);
  const totalProfit = filtered.reduce((s, v) => s + Number(v.profit_ars), 0);
  const totalProfitUSD = filtered.reduce((s, v) => s + Number(v.profit_usd), 0);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const customerGroups = useMemo(() => {
    const map: Record<string, { name: string; count: number; total: number; profit: number; lastDate: string; products: Record<string, number> }> = {};
    filtered.forEach(s => {
      const key = s.customer_name || "(Sin nombre)";
      if (!map[key]) map[key] = { name: key, count: 0, total: 0, profit: 0, lastDate: s.date, products: {} };
      map[key].count++;
      map[key].total += Number(s.total_ars || 0);
      map[key].profit += Number(s.profit_ars || 0);
      if (s.date > map[key].lastDate) map[key].lastDate = s.date;
      const pn = s.product_name || "?";
      map[key].products[pn] = (map[key].products[pn] || 0) + Number(s.quantity || 1);
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [filtered]);

  // Group sales by POS session: same customer + within 3 minutes of each other
  const sessionGroups = useMemo(() => {
    const sorted = [...filtered].sort((a, b) => b.date.localeCompare(a.date));
    const sessions: { id: string; customer: string; date: string; items: any[]; total: number; paid: boolean; method: string }[] = [];
    sorted.forEach(s => {
      const sTime = new Date(s.date).getTime();
      const existing = sessions.find(sess => {
        const sessTime = new Date(sess.date).getTime();
        return sess.customer === (s.customer_name || '') && Math.abs(sTime - sessTime) <= 3 * 60 * 1000;
      });
      if (existing) {
        existing.items.push(s);
        existing.total += Number(s.total_ars || 0);
        if (!s.paid) existing.paid = false;
      } else {
        sessions.push({ id: s.id, customer: s.customer_name || '(Sin cliente)', date: s.date, items: [s], total: Number(s.total_ars || 0), paid: !!s.paid, method: s.payment_method || 'efectivo' });
      }
    });
    return sessions;
  }, [filtered]);

  // Period comparison: prior equivalent period
  const prevPeriod = useMemo(() => {
    if (!dateFrom) return null;
    const to = dateTo ? new Date(dateTo) : new Date();
    to.setHours(23, 59, 59, 999);
    const spanMs = to.getTime() - dateFrom.getTime();
    const prevTo = new Date(dateFrom.getTime() - 1);
    const prevFrom = new Date(dateFrom.getTime() - spanMs - 1);
    const prevSales = sales.filter(s => {
      if (filterCat !== 'all' && productCatMap[s.product_id] !== filterCat) return false;
      const d = new Date(s.date);
      return d >= prevFrom && d <= prevTo;
    });
    return {
      totalSales: prevSales.reduce((a, v) => a + Number(v.total_ars), 0),
      totalProfit: prevSales.reduce((a, v) => a + Number(v.profit_ars), 0),
      count: prevSales.length,
    };
  }, [sales, dateFrom, dateTo, filterCat, productCatMap]);

  const delta = (curr: number, prev: number | undefined) => {
    if (!prev || prev === 0) return undefined;
    const pct = ((curr - prev) / prev) * 100;
    return pct;
  };

  const handleDelete = async (sale: any) => {
    await deleteSaleDB(sale.id);
    if (user) await logAudit(user.id, 'delete', 'sale', sale.id, { product: sale.product_name, total: sale.total_ars });
    reload();
    toast.success("Venta eliminada");
  };

  const printReceipt = (s: any) => {
    const businessName = (sales as any).businessName || "Mi Negocio";
    const date = new Date(s.date + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" });
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Recibo</title>
<style>
  body{font-family:Arial,sans-serif;max-width:320px;margin:20px auto;font-size:13px;color:#333}
  h1{font-size:18px;text-align:center;margin-bottom:4px}
  .sub{text-align:center;color:#666;font-size:11px;margin-bottom:16px}
  hr{border:none;border-top:1px dashed #ccc;margin:10px 0}
  .row{display:flex;justify-content:space-between;padding:3px 0}
  .bold{font-weight:bold}
  .total{font-size:16px;font-weight:bold;text-align:right;margin-top:12px}
  .footer{text-align:center;font-size:10px;color:#999;margin-top:20px}
  .estado{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;${s.paid ? "background:#d1fae5;color:#065f46" : "background:#fee2e2;color:#991b1b"}}
</style></head><body>
<h1>RECIBO DE VENTA</h1>
<div class="sub">Fecha: ${date}</div>
<hr>
<div class="row"><span>Producto:</span><span class="bold">${s.product_name || "—"}</span></div>
${s.customer_name ? `<div class="row"><span>Cliente:</span><span>${s.customer_name}</span></div>` : ""}
<div class="row"><span>Cantidad:</span><span>${s.quantity}</span></div>
<div class="row"><span>Precio unitario:</span><span>${formatARS(Number(s.unit_price_ars))}</span></div>
${s.discount_applied ? `<div class="row"><span>Descuento:</span><span>—</span></div>` : ""}
<div class="row"><span>Método de pago:</span><span>${s.payment_method || "efectivo"}</span></div>
<hr>
<div class="total">TOTAL: ${formatARS(Number(s.total_ars))}</div>
<div style="text-align:right;margin-top:4px"><span class="estado">${s.paid ? "✓ Cobrado" : "Pendiente"}</span></div>
<div class="footer"><p>¡Gracias por su compra!</p></div>
</body></html>`;
    const w = window.open("", "_blank", "width=380,height=500");
    if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
  };

  const printBulkReceipt = () => {
    const selected = paged.filter(s => selectedIds.has(s.id));
    if (!selected.length) return;
    const businessName = (settings as any)?.business_name || "Mi Negocio";
    const customer = selected[0]?.customer_name || "";
    const date = new Date().toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" });
    const allPaid = selected.every(s => s.paid);
    const total = selected.reduce((sum, s) => sum + Number(s.total_ars), 0);
    const rows = selected.map(s =>
      `<tr><td>${s.product_name || "—"}</td><td style="text-align:center">${s.quantity}</td><td style="text-align:right">${formatARS(Number(s.unit_price_ars))}</td><td style="text-align:right">${formatARS(Number(s.total_ars))}</td></tr>`
    ).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Recibo</title>
<style>
  body{font-family:Arial,sans-serif;max-width:400px;margin:20px auto;font-size:13px;color:#333}
  h1{font-size:18px;text-align:center;margin-bottom:4px}
  .sub{text-align:center;color:#666;font-size:11px;margin-bottom:16px}
  hr{border:none;border-top:1px dashed #ccc;margin:10px 0}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;border-bottom:1px solid #ccc;padding:4px 0;font-size:11px;color:#666}
  td{padding:4px 0}
  .total{font-size:16px;font-weight:bold;text-align:right;margin-top:12px}
  .footer{text-align:center;font-size:10px;color:#999;margin-top:20px}
  .estado{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;${allPaid ? "background:#d1fae5;color:#065f46" : "background:#fee2e2;color:#991b1b"}}
</style></head><body>
<h1>RECIBO DE VENTA</h1>
<div class="sub">${businessName} · ${date}</div>
${customer ? `<div style="margin-bottom:8px">Cliente: <strong>${customer}</strong></div>` : ""}
<hr>
<table><thead><tr><th>Producto</th><th style="text-align:center">Cant.</th><th style="text-align:right">P.Unit</th><th style="text-align:right">Total</th></tr></thead>
<tbody>${rows}</tbody></table>
<hr>
<div class="total">TOTAL: ${formatARS(total)}</div>
<div style="text-align:right;margin-top:4px"><span class="estado">${allPaid ? "✓ Cobrado" : "Pendiente"}</span></div>
<div class="footer"><p>¡Gracias por su compra!</p></div>
</body></html>`;
    const w = window.open("", "_blank", "width=440,height=600");
    if (w) { w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 200); }
  };

  const exportSalesCSV = () => {
    const header = ['Fecha', 'Producto', 'Cliente', 'Cantidad', 'P.Unit (ARS)', 'Total (ARS)', 'Ganancia (ARS)', 'Ganancia (USD)', 'Método', 'Cobrado', 'Descuento'];
    const rows = filtered.map(s => [
      s.date,
      `"${(s.product_name || '').replace(/"/g, '""')}"`,
      `"${(s.customer_name || '').replace(/"/g, '""')}"`,
      s.quantity,
      Number(s.unit_price_ars).toFixed(2),
      Number(s.total_ars).toFixed(2),
      Number(s.profit_ars || 0).toFixed(2),
      Number(s.profit_usd || 0).toFixed(2),
      s.payment_method || 'efectivo',
      s.paid ? 'Sí' : 'No',
      s.discount_applied ? 'Sí' : 'No',
    ]);
    const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `ventas_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`${filtered.length} ventas exportadas`);
  };

  const unpaidPaged = paged.filter(s => !s.paid);
  const toggleSelect = (id: string) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelectAll = () => {
    if (selectedIds.size === paged.length && paged.length > 0) setSelectedIds(new Set());
    else setSelectedIds(new Set(paged.map(s => s.id)));
  };
  const bulkMarkPaid = async () => {
    const toMark = paged.filter(s => selectedIds.has(s.id) && !s.paid);
    if (!toMark.length) return;
    setBulkLoading(true);
    await Promise.all(toMark.map(s => updateSaleDB(s.id, { paid: true }, s)));
    setSelectedIds(new Set());
    reload();
    setBulkLoading(false);
    toast.success(`${toMark.length} venta${toMark.length !== 1 ? 's' : ''} marcada${toMark.length !== 1 ? 's' : ''} como cobrada${toMark.length !== 1 ? 's' : ''}`);
  };

  if (loading) return <TableSkeleton rows={8} cols={7} />;

  const marginPct = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;
  const paidCount = filtered.filter(s => s.paid).length;
  const debtCount = filtered.length - paidCount;

  return (
    <div>
      <PageHeader
        icon={ShoppingCart}
        title="Ventas"
        description="Historial y gestión de ventas"
        badge={{ label: `${filtered.length} registradas`, variant: "default" }}
        actions={
          <div className="flex items-center gap-2">
            <DateRangePicker from={dateFrom} to={dateTo} onChange={(f, t) => { setDateFrom(f); setDateTo(t); setPage(0); setDatePreset("custom"); }} />
            {filtered.length > 0 && (
              <Button variant="outline" size="sm" onClick={exportSalesCSV} title={`Exportar ${filtered.length} ventas a CSV`}>
                <FileSpreadsheet className="w-4 h-4 mr-1.5" />CSV
              </Button>
            )}
            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditItem(null); }}>
              <DialogTrigger asChild>
                <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold">
                  <Plus className="w-4 h-4 mr-2" />Nueva Venta
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border max-w-2xl p-0">
                <DialogHeader className="p-6 pb-0"><DialogTitle className="font-display">{editItem ? 'Editar Venta' : 'Registrar Venta'}</DialogTitle></DialogHeader>
                <ScrollArea className="max-h-[75vh] px-6 pb-6">
                  <SaleForm userId={user!.id} editItem={editItem} onSave={() => { setOpen(false); setEditItem(null); reload(); }} />
                </ScrollArea>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KPICard label="Total facturado" value={formatARS(totalSales)} icon={DollarSign} color="primary" sub={`${filtered.length} venta${filtered.length !== 1 ? 's' : ''}`} trend={prevPeriod && delta(totalSales, prevPeriod.totalSales) !== undefined ? { value: delta(totalSales, prevPeriod.totalSales)!, label: "vs período ant." } : undefined} />
        <KPICard label="Ganancia neta" value={formatARS(totalProfit)} icon={TrendingUp} color="success" sub={formatUSD(totalProfitUSD)} trend={prevPeriod && delta(totalProfit, prevPeriod.totalProfit) !== undefined ? { value: delta(totalProfit, prevPeriod.totalProfit)!, label: "vs período ant." } : undefined} />
        <KPICard label="Margen promedio" value={`${marginPct.toFixed(1)}%`} icon={Percent} color={marginPct >= 30 ? "success" : marginPct >= 15 ? "warning" : "destructive"} />
        <KPICard label="Cobradas / Deben" value={`${paidCount} / ${debtCount}`} icon={Ticket} color={debtCount > 0 ? "warning" : "success"} sub={debtCount > 0 ? `${formatARS(filtered.filter(s => !s.paid).reduce((a, s) => a + Number(s.total_ars), 0))} pendiente` : "todo cobrado"} trend={prevPeriod && delta(filtered.length, prevPeriod.count) !== undefined ? { value: delta(filtered.length, prevPeriod.count)!, label: "ventas vs ant." } : undefined} />
      </div>

      {/* Payment method breakdown */}
      {filtered.length > 0 && (() => {
        const byMethod: Record<string, { total: number; count: number }> = {};
        filtered.forEach(s => {
          const m = s.payment_method || 'efectivo';
          if (!byMethod[m]) byMethod[m] = { total: 0, count: 0 };
          byMethod[m].total += Number(s.total_ars);
          byMethod[m].count++;
        });
        const sorted = Object.entries(byMethod).sort((a, b) => b[1].total - a[1].total);
        return (
          <div className="mb-5 bg-card border border-border rounded-xl p-4">
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Desglose por método de pago</h3>
            <div className="space-y-2">
              {sorted.map(([method, data]) => {
                const pct = totalSales > 0 ? (data.total / totalSales) * 100 : 0;
                return (
                  <div key={method}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${PAYMENT_BADGE[method] || 'bg-muted text-muted-foreground'}`}>{method}</span>
                        <span className="text-muted-foreground">{data.count} venta{data.count !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold font-mono">{formatARS(data.total)}</span>
                        <span className="text-muted-foreground w-10 text-right">{pct.toFixed(1)}%</span>
                      </div>
                    </div>
                    <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          method === 'efectivo' ? 'bg-green-400' :
                          method === 'transferencia' ? 'bg-blue-400' :
                          method === 'mayorista' ? 'bg-purple-400' :
                          method === 'debito' ? 'bg-primary' :
                          method === 'credito' ? 'bg-yellow-400' : 'bg-red-400'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Date presets */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {[
          { key: "all", label: "Todas" },
          { key: "today", label: "Hoy" },
          { key: "yesterday", label: "Ayer" },
          { key: "week", label: "Esta semana" },
          { key: "month", label: "Este mes" },
          { key: "lastmonth", label: "Mes anterior" },
        ].map(p => (
          <button key={p.key} onClick={() => applyPreset(p.key)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${datePreset === p.key ? 'bg-primary text-primary-foreground' : 'bg-card border border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'}`}>
            {p.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-5">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar producto o cliente..."
            className="w-full pl-9 pr-3 h-9 text-sm rounded-lg bg-card border border-border outline-none focus:ring-1 focus:ring-primary/40 text-foreground placeholder:text-muted-foreground" />
        </div>
        <Select value={filterCat} onValueChange={v => { setFilterCat(v); setPage(0); }}>
          <SelectTrigger className="bg-card border-border w-full sm:w-[150px] h-9 text-sm">
            <Filter className="w-3.5 h-3.5 mr-1 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterMethod} onValueChange={v => { setFilterMethod(v); setPage(0); }}>
          <SelectTrigger className="bg-card border-border w-full sm:w-[140px] h-9 text-sm">
            <SelectValue placeholder="Método pago" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todo método</SelectItem>
            {PAYMENT_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex rounded-lg border border-border overflow-hidden h-9 shrink-0">
          {([
            { key: 'all', label: 'Todas' },
            { key: 'paid', label: '✓ Cobradas' },
            { key: 'pending', label: 'Deben' },
          ] as const).map(opt => (
            <button key={opt.key} onClick={() => { setFilterPaid(opt.key); setPage(0); }}
              className={`px-3 text-xs transition-colors ${filterPaid === opt.key ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}>
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden h-9">
          <button
            onClick={() => setViewMode("list")}
            className={`px-3 flex items-center gap-1.5 text-xs transition-colors ${viewMode === "list" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
            title="Vista lista"
          >
            <LayoutList className="w-3.5 h-3.5" />Lista
          </button>
          <button
            onClick={() => setViewMode("by_customer")}
            className={`px-3 flex items-center gap-1.5 text-xs transition-colors ${viewMode === "by_customer" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
            title="Agrupar por cliente"
          >
            <Users className="w-3.5 h-3.5" />Por cliente
          </button>
          <button
            onClick={() => setViewMode("by_session")}
            className={`px-3 flex items-center gap-1.5 text-xs transition-colors ${viewMode === "by_session" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
            title="Agrupar ventas del mismo POS en una sesión"
          >
            <ShoppingCart className="w-3.5 h-3.5" />Sesiones
          </button>
        </div>
      </div>

      {!filtered.length ? (
        <EmptyState icon={DollarSign} title="No hay ventas registradas" description="Registrá tu primera venta para comenzar a ver tus ganancias." actionLabel="Nueva Venta" onAction={() => setOpen(true)} />
      ) : viewMode === "by_customer" ? (
        /* ── By Customer view ── */
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold">{customerGroups.length} clientes</h3>
            <span className="text-xs text-muted-foreground">{formatARS(totalSales)} total</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cliente</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Compras</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Ganancia</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Último</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden xl:table-cell">Top producto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {customerGroups.map((c, i) => {
                const topProduct = Object.entries(c.products).sort((a, b) => b[1] - a[1])[0];
                const share = totalSales > 0 ? (c.total / totalSales) * 100 : 0;
                return (
                  <tr key={c.name} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-5">{i + 1}</span>
                        <div>
                          <p className="font-medium">{c.name}</p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <div className="h-1 bg-primary/60 rounded-full" style={{ width: `${Math.min(share * 2, 60)}px` }} />
                            <span className="text-[10px] text-muted-foreground">{share.toFixed(1)}%</span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{c.count}</td>
                    <td className="px-4 py-3 text-right font-bold">{formatARS(c.total)}</td>
                    <td className="px-4 py-3 text-right text-success hidden md:table-cell">{formatARS(c.profit)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell">
                      {new Date(c.lastDate + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground hidden xl:table-cell">
                      {topProduct ? `${topProduct[0]} (×${topProduct[1]})` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : viewMode === "by_session" ? (
        /* ── By Session view ── */
        <div className="space-y-3">
          {sessionGroups.map((sess) => (
            <div key={sess.id} className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ShoppingCart className="w-4 h-4 text-primary shrink-0" />
                  <div>
                    <span className="font-semibold text-sm">{sess.customer}</span>
                    <span className="text-xs text-muted-foreground ml-2">{formatDateAR(sess.date)} · {new Date(sess.date).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${sess.paid ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'}`}>{sess.paid ? '✓ Cobrado' : 'Pendiente'}</span>
                  <span className="font-bold text-sm">{formatARS(sess.total)}</span>
                  {sess.items.length > 1 && (
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => printBulkReceipt()} title="Imprimir recibo de esta sesión">
                      <Printer className="w-3 h-3 mr-1" />{sess.items.length} ítem{sess.items.length !== 1 ? 's' : ''}
                    </Button>
                  )}
                </div>
              </div>
              <div className="divide-y divide-border">
                {sess.items.map(s => (
                  <div key={s.id} className="px-4 py-2.5 flex items-center justify-between">
                    <span className="text-sm">{s.product_name} <span className="text-xs text-muted-foreground">×{s.quantity}</span></span>
                    <span className="text-sm font-medium">{formatARS(Number(s.total_ars))}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {sessionGroups.length === 0 && (
            <EmptyState icon={ShoppingCart} title="Sin sesiones" description="No hay ventas en el período seleccionado." />
          )}
        </div>
      ) : (
        <>
          {/* Bulk action bar */}
          {selectedIds.size > 0 && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-card border border-primary/40 shadow-xl rounded-2xl px-4 py-3">
              <span className="text-sm font-medium">{selectedIds.size} seleccionada{selectedIds.size !== 1 ? 's' : ''}</span>
              <Button size="sm" className="gradient-gold text-primary-foreground font-semibold shadow-gold h-8" onClick={bulkMarkPaid} disabled={bulkLoading}>
                <CheckCheck className="w-4 h-4 mr-1.5" />{bulkLoading ? "Procesando..." : "Marcar cobradas"}
              </Button>
              <Button size="sm" variant="outline" className="h-8" onClick={printBulkReceipt} title="Imprimir recibo con todos los ítems seleccionados">
                <Printer className="w-4 h-4 mr-1.5" />Recibo
              </Button>
              <Button size="sm" variant="ghost" className="h-8" onClick={() => setSelectedIds(new Set())}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}

          <div className="hidden md:block bg-card border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-3 py-3 w-8">
                    <button onClick={toggleSelectAll} className="text-muted-foreground hover:text-foreground transition-colors" title="Seleccionar todas">
                      {selectedIds.size > 0 && selectedIds.size === paged.length ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Fecha</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Producto</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Cliente</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Medio</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cant.</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Total</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden xl:table-cell">Ganancia</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Estado</th>
                  {isAdmin && <th className="px-4 py-3"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paged.map(s => (
                  <tr key={s.id} className={`hover:bg-muted/20 transition-colors group ${selectedIds.has(s.id) ? 'bg-primary/5' : ''}`}>
                    <td className="px-3 py-3 w-8">
                      <button onClick={() => toggleSelect(s.id)} className="text-muted-foreground hover:text-primary transition-colors">
                        {selectedIds.has(s.id) ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4 opacity-40 group-hover:opacity-100" />}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatDateAR(s.date)}</td>
                    <td className="px-4 py-3 font-medium">{s.product_name}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs hidden lg:table-cell">{s.customer_name || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${PAYMENT_BADGE[s.payment_method] || 'bg-muted'}`}>
                        {s.payment_method || 'efectivo'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="bg-muted px-2 py-0.5 rounded text-xs font-medium">{s.quantity}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-bold">{formatARS(Number(s.total_ars))}</td>
                    <td className="px-4 py-3 text-right hidden xl:table-cell">
                      <span className={`font-medium ${Number(s.profit_ars) > 0 ? 'text-success' : 'text-destructive'}`}>{formatARS(Number(s.profit_ars))}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex flex-col items-center gap-1">
                        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${s.paid ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'}`}>
                          {s.paid ? '✓ Cobrado' : 'Debe'}
                        </span>
                        {s.invoice_id && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                            Facturado
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Imprimir recibo" onClick={() => printReceipt(s)}>
                          <Printer className="w-3.5 h-3.5 text-muted-foreground" />
                        </Button>
                        {isAdmin && <>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0"
                            title={s.invoice_id ? "Ver factura" : "Crear factura"}
                            onClick={() => navigate(`/facturas?from_sale=${s.id}&customer=${encodeURIComponent(s.customer_name || '')}&total=${s.total_ars}&product=${encodeURIComponent(s.product_name || '')}`)}>
                            <FileText className={`w-3.5 h-3.5 ${s.invoice_id ? "text-blue-400" : "text-primary"}`} />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditItem(s); setOpen(true); }}><Edit className="w-3.5 h-3.5" /></Button>
                          <ConfirmDialog
                            trigger={<Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                            title="¿Eliminar esta venta?"
                            description={`Se eliminará la venta de ${s.product_name} por ${formatARS(Number(s.total_ars))}.`}
                            confirmText="Eliminar"
                            onConfirm={() => handleDelete(s)}
                          />
                        </>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {paged.map(s => (
              <div key={s.id} className="bg-card border border-border rounded-lg p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="font-medium text-sm">{s.product_name}</p>
                    <p className="text-xs text-muted-foreground">{formatDateAR(s.date)} · {s.customer_name || 'Sin cliente'}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium capitalize ${PAYMENT_BADGE[s.payment_method] || 'bg-muted'}`}>
                      {s.payment_method || 'efectivo'}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.paid ? 'bg-success/20 text-success' : 'bg-destructive/20 text-destructive'}`}>
                      {s.paid ? 'Pagado' : 'Debe'}
                    </span>
                    {s.invoice_id && (
                      <span className="px-1.5 py-0 rounded text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        Facturado
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex gap-4 text-sm">
                    <span>x{s.quantity}</span>
                    <span className="font-medium">{formatARS(Number(s.total_ars))}</span>
                    <span className={Number(s.profit_ars) > 0 ? 'text-success' : 'text-destructive'}>{formatARS(Number(s.profit_ars))}</span>
                  </div>
                  {isAdmin && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditItem(s); setOpen(true); }}><Edit className="w-3 h-3" /></Button>
                    <ConfirmDialog
                      trigger={<Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                      title="¿Eliminar venta?"
                      confirmText="Eliminar"
                      onConfirm={() => handleDelete(s)}
                    />
                  </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm text-muted-foreground">{page + 1} / {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============ HELPER: Calculate line item pricing ============
function calcLineItem(
  line: SaleLineItem,
  products: any[],
  allVariants: any[],
  settings: any,
  paymentMethod: string,
  couponResult: any,
) {
  const product = products.find(p => p.id === line.productId);
  if (!product) return null;

  const methodConfig = PAYMENT_METHODS.find(m => m.value === paymentMethod);
  const usesDiscount = methodConfig?.usesDiscount ?? false;
  const isMayorista = paymentMethod === 'mayorista';
  const isPerfume = product.category === 'perfume_arabe' || product.category === 'perfume_diseñador';
  const contentMl = Number(product.content_ml || 100);
  const exchangeRate = Number(settings?.exchange_rate || 1695);
  const volumeThreshold = Number(settings?.volume_discount_threshold || 3);
  const volumeDiscountPct = Number(settings?.volume_discount_percent || 10);

  const isDecant = line.decantSize !== 'full' && isPerfume;
  const decantMl = line.decantSize === '10' ? 10 : line.decantSize === '5' ? 5 : line.decantSize === '2.5' ? 2.5 : 0;
  const decantMargin = line.decantSize === '10' ? Number(settings?.decant_margin_10ml || 250) :
    line.decantSize === '5' ? Number(settings?.decant_margin_5ml || 350) : Number(settings?.decant_margin_2_5ml || 500);
  const decantPrice = isDecant ? calculateDecantPrice(Number(product.total_cost_usd || 0), contentMl, decantMl, decantMargin, exchangeRate) : 0;

  const discountPrice = product.discount_price_ars ? Number(product.discount_price_ars) : null;
  const normalPrice = Number(product.sale_price_ars) || 0;
  const baseUnitPrice = isDecant ? decantPrice : (usesDiscount && discountPrice ? discountPrice : normalPrice);

  const applyVolume = (isMayorista || line.quantity >= volumeThreshold) && !isDecant;
  let autoUnitPrice = baseUnitPrice;
  let volumeWarning = false;
  if (applyVolume) {
    const { wholesalePrice, belowFloor } = calculateWholesalePrice(
      discountPrice || 0, normalPrice, volumeDiscountPct, Number(product.total_cost_usd || 0), exchangeRate
    );
    autoUnitPrice = wholesalePrice;
    volumeWarning = belowFloor;
  }

  const couponDiscount = couponResult?.valid && couponResult.coupon ?
    (couponResult.coupon.discount_percent > 0 ? autoUnitPrice * (Number(couponResult.coupon.discount_percent) / 100) : Number(couponResult.coupon.discount_fixed_ars || 0)) : 0;
  const priceAfterCoupon = Math.max(0, autoUnitPrice - couponDiscount);

  const unitPrice = line.customPrice ? (parseFloat(line.customPrice) || priceAfterCoupon) : priceAfterCoupon;
  const total = unitPrice * line.quantity;
  const costPerUnitUSD = isDecant ? (Number(product.total_cost_usd || 0) / contentMl) * decantMl : Number(product.total_cost_usd || 0);
  const costPerUnitARS = costPerUnitUSD * exchangeRate;
  const profitARS = total - (costPerUnitARS * line.quantity);
  const profitUSD = exchangeRate > 0 ? profitARS / exchangeRate : 0;

  const productVariants = allVariants.filter(v => v.product_id === line.productId && v.stock > 0);
  const selectedVariant = productVariants.find(v => v.id === line.variantId);
  const variantLabel = selectedVariant ? ` (${selectedVariant.variant_name})` : '';
  const productLabel = isDecant ? `${product.name} (${line.decantSize}ml)` : `${product.name}${variantLabel}`;

  return {
    product, productVariants, selectedVariant, isPerfume, isDecant,
    unitPrice, total, costPerUnitUSD, profitARS, profitUSD,
    priceAfterCoupon, autoUnitPrice, volumeWarning, applyVolume,
    productLabel, usesDiscount, discountPrice, normalPrice, decantPrice,
    volumeDiscountPct,
  };
}

// ============ MULTI-PRODUCT SALE FORM ============
function SaleForm({ userId, editItem, onSave }: { userId: string; editItem?: any; onSave: () => void }) {
  const { checkSalesLimit } = usePlanLimits();
  const [products, setProducts] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [customers, setCustomers] = useState<string[]>([]);
  const [allVariants, setAllVariants] = useState<any[]>([]);

  // For edit mode, single line item
  const isEditMode = !!editItem;
  const [lines, setLines] = useState<SaleLineItem[]>(
    editItem
      ? [{ id: '1', productId: editItem.product_id || '', variantId: editItem.variant_id || '', quantity: editItem.quantity || 1, decantSize: 'full', customPrice: String(editItem.unit_price_ars || '') }]
      : [createLineItem()]
  );

  const [customerName, setCustomerName] = useState(editItem?.customer_name || '');
  const [customerFilter, setCustomerFilter] = useState('');
  const [showCustomerList, setShowCustomerList] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState(editItem?.payment_method || 'efectivo');
  const [date, setDate] = useState(editItem ? new Date(editItem.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [couponCode, setCouponCode] = useState('');
  const [couponResult, setCouponResult] = useState<any>(null);
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      const [p, s, c, v] = await Promise.all([getProductsDB(userId), getSettingsDB(userId), getUniqueCustomersDB(userId), getVariantsByUserDB(userId)]);
      setProducts(p); setSettings(s); setCustomers(c); setAllVariants(v);
    })();
  }, [userId]);

  const isFiado = paymentMethod === 'fiado';

  const updateLine = (lineId: string, updates: Partial<SaleLineItem>) => {
    setLines(prev => prev.map(l => l.id === lineId ? { ...l, ...updates } : l));
  };

  const addLine = () => setLines(prev => [...prev, createLineItem()]);
  const removeLine = (lineId: string) => {
    if (lines.length <= 1) return;
    setLines(prev => prev.filter(l => l.id !== lineId));
  };

  // Calculate all line items
  const lineCalcs = lines.map(line => ({
    line,
    calc: calcLineItem(line, products, allVariants, settings, paymentMethod, couponResult),
  }));

  const grandTotal = lineCalcs.reduce((s, { calc }) => s + (calc?.total || 0), 0);
  const grandProfit = lineCalcs.reduce((s, { calc }) => s + (calc?.profitARS || 0), 0);
  const grandProfitUSD = lineCalcs.reduce((s, { calc }) => s + (calc?.profitUSD || 0), 0);
  const totalItems = lines.reduce((s, l) => s + l.quantity, 0);

  const handleValidateCoupon = async () => {
    if (!couponCode.trim()) return;
    setValidatingCoupon(true);
    try {
      // Check influencer exchange code first (INF- prefix)
      if (couponCode.trim().toUpperCase().startsWith('INF-')) {
        const exchange = await findExchangeByCode(couponCode);
        if (exchange) {
          setCouponResult({ valid: true, coupon: { id: null, discount_type: 'influencer', influencer_exchange: exchange, description: `Canje: ${exchange.influencer_name}` } });
          setValidatingCoupon(false);
          return;
        }
      }
      const result = await validateCouponDB(userId, couponCode);
      setCouponResult(result);
    } catch { setCouponResult({ valid: false, reason: 'Error al validar' }); }
    setValidatingCoupon(false);
  };

  const filteredCustomers = customers.filter(c =>
    c.toLowerCase().includes((customerFilter || customerName).toLowerCase())
  ).slice(0, 8);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!await checkSalesLimit()) return;

    // Validate all lines
    for (const { line, calc } of lineCalcs) {
      if (!line.productId) { toast.error("Seleccioná un producto en cada línea"); return; }
      if (line.quantity <= 0) { toast.error("Cantidad inválida"); return; }
      if (!calc) { toast.error("Error al calcular precios"); return; }
      const productVariants = allVariants.filter(v => v.product_id === line.productId && v.stock > 0);
      const hasVariants = productVariants.length > 0;
      if (hasVariants && !line.variantId) { toast.error(`Seleccioná sabor para ${calc.product.name}`); return; }
      if (hasVariants && calc.selectedVariant && line.quantity > calc.selectedVariant.stock) {
        toast.error(`Stock insuficiente de ${calc.selectedVariant.variant_name} (${calc.selectedVariant.stock})`); return;
      }
      if (!hasVariants && !isEditMode && line.quantity > calc.product.stock) {
        toast.error(`Stock insuficiente de ${calc.product.name} (${calc.product.stock})`); return;
      }
    }

    setSubmitting(true);
    try {
      const paid = !isFiado;
      const discountApplied = PAYMENT_METHODS.find(m => m.value === paymentMethod)?.usesDiscount || false;

      if (isEditMode) {
        // Edit mode: line 0 updates existing sale; additional lines create NEW sales
        for (let i = 0; i < lineCalcs.length; i++) {
          const { line, calc } = lineCalcs[i];
          if (!calc) continue;
          const baseData: any = {
            product_id: line.productId, product_name: calc.productLabel,
            quantity: line.quantity, unit_price_ars: calc.unitPrice, discount_applied: discountApplied,
            total_ars: calc.total, cost_per_unit_usd: calc.costPerUnitUSD,
            profit_ars: calc.profitARS, profit_usd: calc.profitUSD,
            customer_name: customerName || null, date: dateToNoon(date), paid,
            payment_method: paymentMethod,
            coupon_id: couponResult?.valid ? couponResult.coupon.id : null,
            variant_id: line.variantId || null,
          };

          if (i === 0) {
            await updateSaleDB(editItem.id, baseData, editItem);
            await logAudit(userId, 'update', 'sale', editItem.id, { product: calc.productLabel, total: calc.total, profit: calc.profitARS });
          } else {
            const saleId = crypto.randomUUID();
            const newSale = { ...baseData, id: saleId, user_id: userId, source: "manual" };
            if (line.variantId) await addSaleWithVariantDB(newSale, line.variantId);
            else await addSaleDB(newSale);
            await logAudit(userId, 'create', 'sale', saleId, { product: calc.productLabel, total: calc.total, addedToEdit: editItem.id });
            if (line.productId && !calc.isDecant && !line.variantId) await checkStockAfterSale(line.productId, calc.product.name);
          }
        }
        toast.success(lineCalcs.length === 1 ? "Venta actualizada" : `Venta actualizada + ${lineCalcs.length - 1} línea(s) agregada(s)`);
      } else {
        // New: create one sale per line item
        for (const { line, calc } of lineCalcs) {
          if (!calc) continue;
          const saleId = crypto.randomUUID();
          const saleData: any = {
            id: saleId, user_id: userId,
            product_id: line.productId, product_name: calc.productLabel,
            quantity: line.quantity, unit_price_ars: calc.unitPrice, discount_applied: discountApplied,
            total_ars: calc.total, cost_per_unit_usd: calc.costPerUnitUSD,
            profit_ars: calc.profitARS, profit_usd: calc.profitUSD,
            customer_name: customerName || null, date: dateToNoon(date), paid,
            payment_method: paymentMethod,
            coupon_id: couponResult?.valid ? couponResult.coupon.id : null,
            variant_id: line.variantId || null,
            source: "manual",
          };

          if (line.variantId) {
            await addSaleWithVariantDB(saleData, line.variantId);
          } else {
            await addSaleDB(saleData);
          }
          await logAudit(userId, 'create', 'sale', saleId, { product: calc.productLabel, total: calc.total, profit: calc.profitARS, paymentMethod });
          if (line.productId && !calc.isDecant && !line.variantId) await checkStockAfterSale(line.productId, calc.product.name);
        }
        if (couponResult?.valid && couponResult.coupon?.id) await incrementCouponUse(couponResult.coupon.id);
        // Auto-attribute to influencer exchange when INF- code used
        if (couponResult?.valid && couponResult.coupon?.discount_type === 'influencer' && couponResult.coupon?.influencer_exchange) {
          const totalSaleAmount = lineCalcs.reduce((sum, { calc }) => sum + (calc?.total ?? 0), 0);
          await attributeSaleToExchange(couponResult.coupon.influencer_exchange.id, totalSaleAmount);
          toast.success(`✓ Venta atribuida a ${couponResult.coupon.influencer_exchange.influencer_name}`);
        }
        toast.success(`${lines.length === 1 ? 'Venta registrada' : `${lines.length} ventas registradas`}`);
      }
      onSave();
    } catch (err: any) {
      toast.error(err.message || "Error al guardar");
    } finally {
      setSubmitting(false);
    }
  };

  if (!settings) return null;

  return (
    <form onSubmit={handleSubmit} className="space-y-4 pt-4">
      {/* LINE ITEMS */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium flex items-center gap-1.5">
            <ShoppingCart className="w-4 h-4 text-primary" />
            Productos ({lines.length})
          </label>
          <Button type="button" variant="outline" size="sm" onClick={addLine} className="h-7 text-xs">
            <Plus className="w-3 h-3 mr-1" />Agregar producto
          </Button>
        </div>

        {lines.map((line, idx) => (
          <LineItemRow
            key={line.id}
            line={line}
            index={idx}
            products={products}
            allVariants={allVariants}
            settings={settings}
            paymentMethod={paymentMethod}
            couponResult={couponResult}
            canRemove={lines.length > 1 && (!isEditMode || idx > 0)}
            isEditMode={isEditMode && idx === 0}
            onUpdate={(updates) => updateLine(line.id, updates)}
            onRemove={() => removeLine(line.id)}
          />
        ))}
      </div>

      {/* Shared fields */}
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-sm text-muted-foreground">Fecha</label>
          <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="bg-muted border-border" /></div>
        <div>
          <label className="text-sm text-muted-foreground">Medio de Pago</label>
          <Select value={paymentMethod} onValueChange={v => { setPaymentMethod(v); lines.forEach(l => updateLine(l.id, { customPrice: '' })); }}>
            <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PAYMENT_METHODS.map(m => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Customer */}
      <div className="relative">
        <label className="text-sm text-muted-foreground">Cliente</label>
        <Input
          value={customerName}
          onChange={e => { setCustomerName(e.target.value); setCustomerFilter(e.target.value); setShowCustomerList(true); }}
          onFocus={() => setShowCustomerList(true)}
          onBlur={() => setTimeout(() => setShowCustomerList(false), 200)}
          placeholder="Buscar o escribir nombre..."
          className="bg-muted border-border"
        />
        {showCustomerList && filteredCustomers.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-card border border-border rounded-lg shadow-lg max-h-40 overflow-y-auto">
            {filteredCustomers.map(c => (
              <button key={c} type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors first:rounded-t-lg last:rounded-b-lg"
                onMouseDown={() => { setCustomerName(c); setShowCustomerList(false); }}>
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Coupon */}
      <div>
        <label className="text-sm text-muted-foreground flex items-center gap-1"><Ticket className="w-3.5 h-3.5" />Cupón de descuento</label>
        <div className="flex gap-2 mt-1">
          <Input
            value={couponCode}
            onChange={e => { setCouponCode(e.target.value.toUpperCase()); setCouponResult(null); }}
            placeholder="Ej: EXENTRY10"
            className="bg-muted border-border flex-1"
          />
          <Button type="button" variant="outline" size="sm" onClick={handleValidateCoupon} disabled={validatingCoupon || !couponCode.trim()}>
            {validatingCoupon ? '...' : 'Validar'}
          </Button>
        </div>
        {couponResult && (
          <p className={`text-[10px] mt-1 font-medium ${couponResult.valid ? 'text-success' : 'text-destructive'}`}>
            {couponResult.valid
              ? `✓ Cupón aplicado: ${couponResult.coupon.discount_percent > 0 ? `-${couponResult.coupon.discount_percent}%` : `-${formatARS(Number(couponResult.coupon.discount_fixed_ars))}`}`
              : `✗ ${couponResult.reason}`}
          </p>
        )}
      </div>

      {/* Grand total summary */}
      <div className="bg-muted rounded-lg p-4 space-y-1 text-sm animate-in fade-in duration-200">
        <div className="flex justify-between font-bold text-base border-b border-border pb-2 mb-1">
          <span>Total General ({totalItems} uds en {lines.length} {lines.length === 1 ? 'producto' : 'productos'}):</span>
          <span className="text-primary">{formatARS(grandTotal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Ganancia total:</span>
          <span className={grandProfit > 0 ? 'text-success font-medium' : 'text-destructive font-medium'}>{formatARS(grandProfit)} ({formatUSD(grandProfitUSD)})</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Margen:</span>
          <span className={grandProfit > 0 ? 'text-success' : 'text-destructive'}>{grandTotal > 0 ? Math.round(grandProfit / grandTotal * 100) : 0}%</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Medio:</span>
          <span className="capitalize font-medium">{paymentMethod}{!isFiado ? ' · Pagado' : ' · Deuda'}</span>
        </div>
      </div>

      <Button type="submit" disabled={submitting} className="w-full gradient-gold text-primary-foreground font-semibold">
        {submitting ? 'Guardando...' : editItem
          ? (lines.length > 1 ? `Actualizar + ${lines.length - 1} línea(s)` : 'Actualizar Venta')
          : (lines.length > 1 ? `Registrar ${lines.length} Ventas` : 'Registrar Venta')}
      </Button>
    </form>
  );
}

// ============ SINGLE LINE ITEM ROW ============
function LineItemRow({
  line, index, products, allVariants, settings, paymentMethod, couponResult,
  canRemove, isEditMode, onUpdate, onRemove,
}: {
  line: SaleLineItem;
  index: number;
  products: any[];
  allVariants: any[];
  settings: any;
  paymentMethod: string;
  couponResult: any;
  canRemove: boolean;
  isEditMode: boolean;
  onUpdate: (updates: Partial<SaleLineItem>) => void;
  onRemove: () => void;
}) {
  const calc = calcLineItem(line, products, allVariants, settings, paymentMethod, couponResult);
  const product = products.find(p => p.id === line.productId);
  const productVariants = allVariants.filter(v => v.product_id === line.productId && v.stock > 0);
  const hasVariants = productVariants.length > 0;
  const isPerfume = product?.category === 'perfume_arabe' || product?.category === 'perfume_diseñador';
  const contentMl = Number(product?.content_ml || 100);

  return (
    <div className="bg-muted/50 border border-border rounded-lg p-3 space-y-2 relative">
      {canRemove && (
        <button type="button" onClick={onRemove}
          className="absolute top-2 right-2 text-muted-foreground hover:text-destructive transition-colors">
          <X className="w-4 h-4" />
        </button>
      )}

      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-bold text-primary bg-primary/10 rounded-full w-5 h-5 flex items-center justify-center">{index + 1}</span>
        <span className="text-xs text-muted-foreground font-medium">
          {product ? getCategoryLabel(product.category) : 'Seleccionar producto'}
        </span>
      </div>

      {/* Product selector */}
      <Select value={line.productId} onValueChange={v => onUpdate({ productId: v, variantId: '', customPrice: '', decantSize: 'full' })}>
        <SelectTrigger className="bg-background border-border text-sm"><SelectValue placeholder="Seleccionar producto..." /></SelectTrigger>
        <SelectContent>
          {products.filter(p => isEditMode || p.stock > 0).map(p => (
            <SelectItem key={p.id} value={p.id}>{p.name} ({getCategoryLabel(p.category)}) — Stock: {p.stock}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Variant selector for vapers or products with variants */}
      {product && hasVariants && (
        <Select value={line.variantId} onValueChange={v => onUpdate({ variantId: v })}>
          <SelectTrigger className="bg-background border-border text-sm"><SelectValue placeholder="Seleccionar sabor..." /></SelectTrigger>
          <SelectContent>
            {productVariants.map(v => (
              <SelectItem key={v.id} value={v.id}>{v.variant_name} (Stock: {v.stock})</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Decant selector for perfumes */}
      {product && isPerfume && (
        <div className="flex gap-1.5 flex-wrap">
          {[
            { value: 'full', label: `${contentMl}ml` },
            { value: '10', label: '10ml' },
            { value: '5', label: '5ml' },
            { value: '2.5', label: '2.5ml' },
          ].map(s => (
            <button key={s.value} type="button"
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${line.decantSize === s.value ? 'bg-primary text-primary-foreground border-primary' : 'bg-background border-border hover:bg-accent'}`}
              onClick={() => onUpdate({ decantSize: s.value, customPrice: '' })}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-muted-foreground">Cantidad</label>
          <Input type="number" min="1" value={String(line.quantity)}
            onChange={e => onUpdate({ quantity: parseInt(e.target.value) || 1 })}
            className="bg-background border-border h-8 text-sm" />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground">Precio custom (opc.)</label>
          <Input type="number" value={line.customPrice}
            onChange={e => onUpdate({ customPrice: e.target.value })}
            placeholder={calc ? formatARS(calc.priceAfterCoupon) : '—'}
            className="bg-background border-border h-8 text-sm" />
        </div>
      </div>

      {/* Line subtotal */}
      {calc && (
        <div className="flex items-center justify-between text-xs pt-1 border-t border-border/50">
          <span className="text-muted-foreground">
            {formatARS(calc.unitPrice)} × {line.quantity}
            {calc.applyVolume && <span className="text-primary ml-1">-{calc.volumeDiscountPct}%</span>}
          </span>
          <div className="flex items-center gap-3">
            <span className="font-medium">{formatARS(calc.total)}</span>
            <span className={calc.profitARS > 0 ? 'text-success' : 'text-destructive'}>+{formatARS(calc.profitARS)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
