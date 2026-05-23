import { useState, useEffect, useMemo } from "react";
import { broadcastSync } from "@/lib/broadcastSync";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useAuth } from "@/lib/auth";
import { usePlanLimits } from "@/lib/usePlanLimits";
import { getSalesDB, addSaleDB, deleteSaleDB, updateSaleDB, getProductsDB, getSettingsDB, formatARS, formatUSD, getCategoryLabel, getUniqueCustomersDB, formatDateAR, dateToNoon, calculateDecantPrice, calculateWholesalePrice, validateCouponDB, incrementCouponUse, getVariantsByUserDB, addSaleWithVariantDB, findExchangeByCode, attributeSaleToExchange } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Trash2, DollarSign, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Edit, Filter, Ticket, ShoppingCart, X, FileText, TrendingUp, Search, Percent, Users, LayoutList, Square, CheckSquare, CheckCheck, Printer, FileSpreadsheet, Calendar, FileDown, Share2, MessageCircle, CheckCircle2 } from "lucide-react";
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
  usePageTitle("Ventas");
  const { user } = useAuth();
  const { isAdmin } = useUserRole();
  // If vendedor, only show their own sales
  const sellerFilter = !isAdmin ? (localStorage.getItem('gestiona.pos.seller') || null) : null;
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
    if (preset === "year") {
      setDateFrom(new Date(now.getFullYear(), 0, 1)); setDateTo(now); return;
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
  const [viewMode, setViewMode] = useState<"list" | "by_customer" | "by_session" | "by_product" | "by_date">("list");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [filterPaid, setFilterPaid] = useState<'all' | 'paid' | 'pending'>('all');
  const [filterMethod, setFilterMethod] = useState('all');
  const [filterSellerName, setFilterSellerName] = useState('all');
  const [saleSort, setSaleSort] = useState<{ col: "date" | "total_ars" | "customer_name" | "product_name"; dir: "asc" | "desc" }>({ col: "date", dir: "desc" });
  const [filterHasNote, setFilterHasNote] = useState(false);
  const [commPct, setCommPct] = useState(5);
  const [collapsedSessions, setCollapsedSessions] = useState<Set<string>>(new Set());

  const filtered = sales.filter(s => {
    // Vendedor can only see their own sales (if seller name is set in localStorage)
    if (sellerFilter && s.seller_name && s.seller_name.trim() !== sellerFilter) return false;
    if (filterCat !== 'all' && productCatMap[s.product_id] !== filterCat) return false;
    if (filterPaid === 'paid' && !s.paid) return false;
    if (filterPaid === 'pending' && s.paid) return false;
    if (filterMethod !== 'all' && s.payment_method !== filterMethod) return false;
    if (filterSellerName !== 'all' && (s as any).seller_name !== filterSellerName) return false;
    if (filterHasNote && !s.notes) return false;
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
  const filteredSorted = [...filtered].sort((a, b) => {
    let cmp = 0;
    if (saleSort.col === "date") cmp = String(a.date).localeCompare(String(b.date));
    else if (saleSort.col === "total_ars") cmp = Number(a.total_ars) - Number(b.total_ars);
    else if (saleSort.col === "customer_name") cmp = (a.customer_name || "").localeCompare(b.customer_name || "");
    else if (saleSort.col === "product_name") cmp = (a.product_name || "").localeCompare(b.product_name || "");
    return saleSort.dir === "asc" ? cmp : -cmp;
  });
  const totalPages = Math.ceil(filteredSorted.length / PAGE_SIZE);
  const paged = filteredSorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

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

  const productGroups = useMemo(() => {
    const map: Record<string, { name: string; units: number; total: number; profit: number; sales: number; lastDate: string }> = {};
    filtered.forEach(s => {
      const key = s.product_name || "(Sin nombre)";
      if (!map[key]) map[key] = { name: key, units: 0, total: 0, profit: 0, sales: 0, lastDate: s.date };
      map[key].units += Number(s.quantity || 1);
      map[key].total += Number(s.total_ars || 0);
      map[key].profit += Number(s.profit_ars || 0);
      map[key].sales++;
      if (s.date > map[key].lastDate) map[key].lastDate = s.date;
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

  // Set of sale IDs that belong to multi-item POS sessions (for Ticket badge in list view)
  const multiItemSaleIds = useMemo(() => {
    const s = new Set<string>();
    sessionGroups.forEach(sess => { if (sess.items.length > 1) sess.items.forEach(it => s.add(it.id)); });
    return s;
  }, [sessionGroups]);

  // Group by calendar day + compare vs same day 7 days prior
  const dateGroups = useMemo(() => {
    const map: Record<string, { date: string; total: number; profit: number; count: number; paid: number }> = {};
    filtered.forEach(s => {
      const day = s.date.slice(0, 10);
      if (!map[day]) map[day] = { date: day, total: 0, profit: 0, count: 0, paid: 0 };
      map[day].total += Number(s.total_ars || 0);
      map[day].profit += Number(s.profit_ars || 0);
      map[day].count++;
      if (s.paid) map[day].paid++;
    });
    // Build a lookup for prior week same-day sales (from allSales not filtered by date)
    const prevWeekMap: Record<string, number> = {};
    sales.forEach(s => {
      const d = new Date(s.date);
      const nextWeek = new Date(d); nextWeek.setDate(d.getDate() + 7);
      const nextDay = nextWeek.toISOString().slice(0, 10);
      if (map[nextDay] !== undefined) {
        prevWeekMap[nextDay] = (prevWeekMap[nextDay] || 0) + Number(s.total_ars || 0);
      }
    });
    return Object.values(map)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(d => ({ ...d, prevWeekTotal: prevWeekMap[d.date] || 0 }));
  }, [filtered, sales]);

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

  const downloadSalePDF = async (s: any) => {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const PW = 210;
    const businessName = (settings as any)?.business_name || "Mi Negocio";
    const logoUrl = (settings as any)?.logo_url;
    const date = new Date(s.date + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" });

    // Header
    doc.setFillColor(26, 26, 46);
    doc.rect(0, 0, PW, 32, "F");

    // Logo
    let logoX = 12;
    if (logoUrl) {
      try {
        const resp = await fetch(logoUrl);
        const blob = await resp.blob();
        const dataUrl = await new Promise<string>(res => {
          const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(blob);
        });
        doc.addImage(dataUrl, "PNG", 12, 4, 24, 24);
        logoX = 42;
      } catch { /* fallback: just text */ }
    }

    doc.setTextColor(212, 168, 67);
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(businessName, logoX, 14);
    doc.setTextColor(200, 200, 200);
    doc.setFontSize(9);
    doc.text("RECIBO DE VENTA", logoX, 22);
    doc.setFontSize(9);
    doc.text(`N° ${s.id?.slice(0, 8).toUpperCase() || "—"}`, PW - 12, 12, { align: "right" });
    doc.text(date, PW - 12, 19, { align: "right" });
    doc.text(s.paid ? "✓ COBRADO" : "⏳ PENDIENTE", PW - 12, 26, { align: "right" });

    // Client
    let y = 44;
    doc.setTextColor(30, 30, 30);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("CLIENTE:", 14, y);
    doc.setFont("helvetica", "normal");
    doc.text(s.customer_name || "Consumidor final", 40, y);

    // Divider
    y += 8;
    doc.setDrawColor(200, 200, 200);
    doc.line(14, y, PW - 14, y);

    // Items table
    y += 8;
    doc.setFillColor(240, 240, 248);
    doc.rect(14, y - 4, PW - 28, 8, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Producto", 16, y);
    doc.text("Cant.", 120, y, { align: "center" });
    doc.text("P. Unit.", 155, y, { align: "right" });
    doc.text("Total", PW - 16, y, { align: "right" });

    y += 8;
    doc.setFont("helvetica", "normal");
    doc.text(s.product_name || "—", 16, y);
    doc.text(String(s.quantity || 1), 120, y, { align: "center" });
    doc.text(formatARS(Number(s.unit_price_ars)), 155, y, { align: "right" });
    doc.text(formatARS(Number(s.total_ars)), PW - 16, y, { align: "right" });

    // Totals
    y += 14;
    doc.line(14, y, PW - 14, y);
    y += 8;
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(26, 26, 46);
    doc.text("TOTAL:", 120, y);
    doc.setTextColor(212, 168, 67);
    doc.text(formatARS(Number(s.total_ars)), PW - 16, y, { align: "right" });

    // Payment method
    y += 10;
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(100, 100, 100);
    doc.text(`Método de pago: ${s.payment_method || "efectivo"}`, 14, y);
    if (s.notes) {
      y += 6;
      doc.text(`Nota: ${s.notes}`, 14, y);
    }

    // Footer
    y = 275;
    doc.setFontSize(8);
    doc.setTextColor(160, 160, 160);
    doc.text("¡Gracias por su compra!", PW / 2, y, { align: "center" });

    doc.save(`recibo_${(s.product_name || "venta").replace(/\s+/g, '_')}_${s.date}.pdf`);
    toast.success("PDF descargado");
  };

  const printReceipt = (s: any) => {
    const businessName = (settings as any)?.business_name || "Mi Negocio";
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
<div class="qr-block" style="text-align:center;border-top:1px dashed #ddd;padding-top:12px;margin-top:14px">
  <img src="https://api.qrserver.com/v1/create-qr-code/?size=72x72&data=${encodeURIComponent('VTA-' + s.id)}" alt="QR" width="72" height="72" style="opacity:.55" />
  <p style="font-size:8px;color:#bbb;margin:4px 0 0">Ref: ${s.id.slice(0,8).toUpperCase()}</p>
</div>
</body></html>`;
    const w = window.open("", "_blank", "width=380,height=560");
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
<div style="text-align:center;border-top:1px dashed #ddd;padding-top:12px;margin-top:14px">
  <img src="https://api.qrserver.com/v1/create-qr-code/?size=72x72&data=${encodeURIComponent(selected.map(s => s.id.slice(0,8)).join(','))}" alt="QR" width="72" height="72" style="opacity:.5" />
  <p style="font-size:8px;color:#bbb;margin:4px 0 0">${selected.length} comprobante${selected.length > 1 ? 's' : ''}</p>
</div>
</body></html>`;
    const w = window.open("", "_blank", "width=440,height=660");
    if (w) { w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 200); }
  };

  const exportSalesCSV = () => {
    const header = ['Fecha', 'Producto', 'Cliente', 'Vendedor', 'Cantidad', 'P.Unit (ARS)', 'Total (ARS)', 'Ganancia (ARS)', 'Ganancia (USD)', 'Método', 'Cobrado', 'Descuento', 'Facturado'];
    const rows = filtered.map(s => [
      s.date,
      `"${(s.product_name || '').replace(/"/g, '""')}"`,
      `"${(s.customer_name || '').replace(/"/g, '""')}"`,
      `"${((s as any).seller_name || '').replace(/"/g, '""')}"`,
      s.quantity,
      Number(s.unit_price_ars).toFixed(2),
      Number(s.total_ars).toFixed(2),
      Number(s.profit_ars || 0).toFixed(2),
      Number(s.profit_usd || 0).toFixed(2),
      s.payment_method || 'efectivo',
      s.paid ? 'Sí' : 'No',
      s.discount_applied ? 'Sí' : 'No',
      s.invoice_id ? 'Sí' : 'No',
    ]);
    const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `ventas_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(`${filtered.length} ventas exportadas`);
  };

  const printCierreCaja = () => {
    const fmtARS = (v: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(v);
    const periodLabel = (() => {
      if (!dateFrom) return 'Todo el período';
      const from = dateFrom.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const to = dateTo ? dateTo.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      return from === to ? from : `${from} – ${to}`;
    })();
    const byMethod: Record<string, { total: number; count: number; paid: number; debt: number }> = {};
    filtered.forEach(s => {
      const m = s.payment_method || 'efectivo';
      if (!byMethod[m]) byMethod[m] = { total: 0, count: 0, paid: 0, debt: 0 };
      byMethod[m].total += Number(s.total_ars);
      byMethod[m].count++;
      if (s.paid) byMethod[m].paid += Number(s.total_ars);
      else byMethod[m].debt += Number(s.total_ars);
    });
    const methods = Object.entries(byMethod).sort((a, b) => b[1].total - a[1].total);
    const methodRows = methods.map(([m, d]) => `
      <tr>
        <td style="text-transform:capitalize">${m}</td>
        <td style="text-align:right">${d.count}</td>
        <td style="text-align:right;font-weight:bold">${fmtARS(d.total)}</td>
        <td style="text-align:right;color:#16a34a">${fmtARS(d.paid)}</td>
        <td style="text-align:right;color:#dc2626">${fmtARS(d.debt)}</td>
      </tr>`).join('');
    const topProds = (() => {
      const map: Record<string, number> = {};
      filtered.forEach(s => { const k = s.product_name || '—'; map[k] = (map[k] || 0) + Number(s.total_ars); });
      return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 5);
    })();
    const topRows = topProds.map(([name, total]) => `<tr><td>${name}</td><td style="text-align:right;font-weight:bold">${fmtARS(total)}</td></tr>`).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Cierre de Caja</title>
<style>
  body{font-family:Arial,sans-serif;font-size:12px;color:#111;margin:24px;max-width:700px}
  h1{font-size:18px;margin:0 0 2px}
  p.sub{color:#666;font-size:10px;margin:0 0 20px}
  h2{font-size:13px;margin:16px 0 6px;color:#444;border-bottom:1px solid #e5e7eb;padding-bottom:4px}
  table{width:100%;border-collapse:collapse;margin-bottom:12px}
  th{background:#f3f4f6;text-align:left;padding:5px 8px;font-size:10px;border-bottom:2px solid #d1d5db}
  td{padding:4px 8px;border-bottom:1px solid #f0f0f0}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
  .kpi{background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:8px 10px;text-align:center}
  .kpi .val{font-size:16px;font-weight:bold;color:#b8860b}.kpi .lbl{font-size:9px;color:#777;margin-top:2px}
  @media print{body{margin:10px}}
</style></head><body>
<h1>📊 Cierre de Caja</h1>
<p class="sub">Período: ${periodLabel} · Generado el ${new Date().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
<div class="kpis">
  <div class="kpi"><div class="val">${fmtARS(totalSales)}</div><div class="lbl">Total facturado</div></div>
  <div class="kpi"><div class="val">${fmtARS(totalProfit)}</div><div class="lbl">Ganancia neta</div></div>
  <div class="kpi"><div class="val">${marginPct.toFixed(1)}%</div><div class="lbl">Margen</div></div>
  <div class="kpi"><div class="val">${filtered.length}</div><div class="lbl">Ventas</div></div>
</div>
<h2>Por método de pago</h2>
<table>
  <thead><tr><th>Método</th><th style="text-align:right">Cant.</th><th style="text-align:right">Total</th><th style="text-align:right">Cobrado</th><th style="text-align:right">Debe</th></tr></thead>
  <tbody>${methodRows}</tbody>
</table>
<h2>Top 5 productos</h2>
<table>
  <thead><tr><th>Producto</th><th style="text-align:right">Facturado</th></tr></thead>
  <tbody>${topRows}</tbody>
</table>
</body></html>`;
    const w = window.open('', '_blank', 'width=800,height=600');
    if (w) { w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 400); }
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

  const markSinglePaid = async (s: any) => {
    await updateSaleDB(s.id, { paid: true }, s);
    reload();
    toast.success(`Venta de ${s.product_name} marcada como cobrada ✓`);
  };

  if (loading) return <TableSkeleton rows={8} cols={7} />;

  const marginPct = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;
  const paidCount = filtered.filter(s => s.paid).length;
  const debtCount = filtered.length - paidCount;

  const sharePeriodWhatsApp = () => {
    if (!filtered.length) return;
    const from = dateFrom ? dateFrom.toLocaleDateString("es-AR") : null;
    const to = dateTo ? dateTo.toLocaleDateString("es-AR") : null;
    const range = from && to ? `${from} al ${to}` : from ? `desde ${from}` : "todo el historial";

    // Top 3 products by total
    const prodMap: Record<string, number> = {};
    filtered.forEach(s => { prodMap[s.product_name || "?"] = (prodMap[s.product_name || "?"] || 0) + Number(s.total_ars); });
    const top3 = Object.entries(prodMap).sort((a, b) => b[1] - a[1]).slice(0, 3);

    // Unique customers
    const uniqCustomers = new Set(filtered.map(s => s.customer_name).filter(Boolean)).size;

    const margin = totalSales > 0 ? ((totalProfit / totalSales) * 100).toFixed(1) : "0";

    const lines = [
      `📊 *Resumen de Ventas — ${range}*`,
      ``,
      `💰 Total facturado: *${formatARS(totalSales)}*`,
      `📈 Ganancia bruta: *${formatARS(totalProfit)}* (${margin}%)`,
      `🛒 Transacciones: *${filtered.length}*`,
      `👥 Clientes distintos: *${uniqCustomers}*`,
      `✅ Cobradas: ${paidCount} | ⏳ Pendientes: ${debtCount}`,
      ``,
      `🏆 *Top productos:*`,
      ...top3.map(([ name, val ], i) => `  ${["🥇","🥈","🥉"][i]} ${name}: ${formatARS(val)}`),
    ];
    window.open(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
  };

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
              <>
                <Button variant="outline" size="sm" onClick={sharePeriodWhatsApp} title="Compartir resumen por WhatsApp" className="hidden sm:flex gap-1.5 border-green-500/30 text-green-400 hover:bg-green-500/10">
                  <MessageCircle className="w-4 h-4" />WA
                </Button>
                <Button variant="outline" size="sm" onClick={printCierreCaja} title="Imprimir cierre de caja" className="hidden sm:flex">
                  <Printer className="w-4 h-4 mr-1.5" />Cierre
                </Button>
                <Button variant="outline" size="sm" onClick={exportSalesCSV} title={`Exportar ${filtered.length} ventas a CSV`}>
                  <FileSpreadsheet className="w-4 h-4 mr-1.5" />CSV
                </Button>
              </>
            )}
            <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditItem(null); }}>
              <DialogTrigger asChild>
                <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold">
                  <Plus className="w-4 h-4 mr-2" />Nueva Venta
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-[hsl(228_24%_7%)] border-border/60 max-w-2xl p-0">
                <DialogHeader className="p-6 pb-0"><DialogTitle className="font-display">{editItem ? 'Editar Venta' : 'Registrar Venta'}</DialogTitle></DialogHeader>
                <ScrollArea className="max-h-[75vh] px-6 pb-6">
                  <SaleForm userId={user!.id} editItem={editItem} onSave={() => { setOpen(false); setEditItem(null); reload(); }} />
                </ScrollArea>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      {/* Today's quick stats */}
      {(() => {
        const todayStr = new Date().toISOString().slice(0, 10);
        const todaySales = sales.filter((s: any) => s.date === todayStr);
        if (todaySales.length === 0) return null;
        const todayTotal = todaySales.reduce((s: number, v: any) => s + Number(v.total_ars), 0);
        const todayProfit = todaySales.reduce((s: number, v: any) => s + Number(v.profit_ars), 0);
        const todayPaid = todaySales.filter((s: any) => s.paid).length;
        const maxTicket = todaySales.reduce((max: any, v: any) => !max || Number(v.total_ars) > Number(max.total_ars) ? v : max, null);
        // Top product by count
        const prodCount: Record<string, number> = {};
        todaySales.forEach((s: any) => { if (s.product_name) prodCount[s.product_name] = (prodCount[s.product_name] || 0) + Number(s.quantity || 1); });
        const topProd = Object.entries(prodCount).sort((a, b) => b[1] - a[1])[0];
        return (
          <div className="mb-4 flex items-center gap-3 flex-wrap rounded-lg border border-primary/20 bg-primary/5 px-4 py-2.5 text-sm">
            <span className="text-primary font-semibold text-xs uppercase tracking-wide">Hoy</span>
            <span className="font-bold text-primary">{formatARS(todayTotal)}</span>
            <span className="text-success text-xs">{formatARS(todayProfit)} ganancia</span>
            <span className="text-muted-foreground text-xs">{todaySales.length} venta{todaySales.length !== 1 ? 's' : ''}</span>
            <span className="text-muted-foreground text-xs">{todayPaid} cobrada{todayPaid !== 1 ? 's' : ''}</span>
            {maxTicket && (
              <span className="text-muted-foreground text-xs border-l border-border/60 pl-3 hidden sm:inline">
                🏆 Mayor: <span className="font-semibold text-foreground">{formatARS(Number(maxTicket.total_ars))}</span>
                {maxTicket.customer_name && <span className="text-muted-foreground"> · {maxTicket.customer_name}</span>}
              </span>
            )}
            {topProd && (
              <span className="text-muted-foreground text-xs hidden sm:inline">
                📦 Top: <span className="font-semibold text-foreground">{topProd[0].length > 20 ? topProd[0].slice(0, 18) + '…' : topProd[0]}</span> ×{topProd[1]}
              </span>
            )}
          </div>
        );
      })()}

      {/* Seller mode banner */}
      {sellerFilter && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-2.5 text-sm text-blue-300">
          <Users className="w-4 h-4 shrink-0" />
          <span>Mostrando solo tus ventas como <strong>{sellerFilter}</strong>. Los admins ven todas.</span>
        </div>
      )}

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
          <div className="mb-5 bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-4">
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

      {/* Daily sparkline */}
      {(() => {
        const dailyMap: Record<string, number> = {};
        filtered.forEach(s => { const d = String(s.date).slice(0, 10); dailyMap[d] = (dailyMap[d] || 0) + Number(s.total_ars); });
        const days = Object.keys(dailyMap).sort();
        if (days.length < 2) return null;
        const maxVal = Math.max(...days.map(d => dailyMap[d]));
        const show = days.slice(-30);
        return (
          <div className="mb-5 bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] p-4">
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Tendencia diaria ({show.length} días)</h3>
            <div className="flex items-end gap-0.5 h-14 overflow-x-auto">
              {show.map(d => {
                const val = dailyMap[d];
                const pct = maxVal > 0 ? (val / maxVal) * 100 : 0;
                const label = new Date(d + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
                return (
                  <div key={d} className="flex flex-col items-center gap-0.5 flex-1 min-w-[12px] group relative" title={`${label}: ${formatARS(val)}`}>
                    <div className="w-full bg-primary/70 rounded-sm hover:bg-primary transition-colors"
                      style={{ height: `${Math.max(4, pct)}%`, minHeight: 3, maxHeight: "100%" }} />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-[9px] text-muted-foreground mt-1.5">
              <span>{new Date(show[0] + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}</span>
              <span>{new Date(show[show.length - 1] + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}</span>
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
          { key: "year", label: "Este año" },
        ].map(p => (
          <button key={p.key} onClick={() => applyPreset(p.key)}
            className={`px-3 py-1 rounded-[5px] text-xs font-medium transition-colors ${datePreset === p.key ? 'bg-primary text-primary-foreground' : 'bg-card border border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'}`}>
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
        {isAdmin && (() => {
          const sellerNames = Array.from(new Set(sales.map((s: any) => s.seller_name).filter(Boolean))).sort() as string[];
          if (sellerNames.length === 0) return null;
          return (
            <Select value={filterSellerName} onValueChange={v => { setFilterSellerName(v); setPage(0); }}>
              <SelectTrigger className="bg-card border-border w-full sm:w-[140px] h-9 text-sm">
                <SelectValue placeholder="Vendedor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los vendedores</SelectItem>
                {sellerNames.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          );
        })()}
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
        {sales.some(s => s.notes) && (
          <button
            onClick={() => { setFilterHasNote(f => !f); setPage(0); }}
            className={`flex items-center gap-1.5 px-3 h-9 rounded-lg border text-xs font-medium transition-all shrink-0 ${filterHasNote ? 'bg-primary/20 border-primary/40 text-primary' : 'bg-muted border-border text-muted-foreground hover:text-foreground'}`}
            title="Mostrar solo ventas con notas internas"
          >
            📝 Con nota
          </button>
        )}
        {/* Commission summary (only in by_customer / by_product) */}
        {(viewMode === "by_customer" || viewMode === "by_product") && (() => {
          const sellerMap: Record<string, { total: number; count: number }> = {};
          filtered.forEach(s => {
            const key = (s as any).seller_name?.trim() || "(Sin vendedor)";
            if (!sellerMap[key]) sellerMap[key] = { total: 0, count: 0 };
            sellerMap[key].total += Number(s.total_ars);
            sellerMap[key].count++;
          });
          const sellers = Object.entries(sellerMap).filter(([k]) => k !== "(Sin vendedor)");
          if (sellers.length === 0) return null;
          return (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/30 border border-border rounded-lg text-xs">
              <span className="text-muted-foreground">Comisiones:</span>
              <input type="number" min={0} max={100} value={commPct} onChange={e => setCommPct(Number(e.target.value))}
                className="w-12 bg-muted border border-border rounded px-1.5 text-center" />
              <span className="text-muted-foreground">%</span>
              {sellers.map(([name, data]) => (
                <span key={name} className="ml-2 font-medium text-success">
                  {name}: {new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(data.total * commPct / 100)}
                </span>
              ))}
            </div>
          );
        })()}
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
          <button
            onClick={() => setViewMode("by_product")}
            className={`px-3 flex items-center gap-1.5 text-xs transition-colors ${viewMode === "by_product" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
            title="Ranking de productos más vendidos"
          >
            <TrendingUp className="w-3.5 h-3.5" />Por producto
          </button>
          <button
            onClick={() => setViewMode("by_date")}
            className={`px-3 flex items-center gap-1.5 text-xs transition-colors ${viewMode === "by_date" ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"}`}
            title="Agrupar por día con delta vs semana anterior"
          >
            <Calendar className="w-3.5 h-3.5" />Por fecha
          </button>
        </div>
      </div>

      {!filtered.length ? (
        <EmptyState icon={DollarSign} title="No hay ventas registradas" description="Registrá tu primera venta para comenzar a ver tus ganancias." actionLabel="Nueva Venta" onAction={() => setOpen(true)} />
      ) : viewMode === "by_customer" ? (
        /* ── By Customer view ── */
        <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold font-display tracking-tight">{customerGroups.length} clientes</h3>
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
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-muted-foreground">{sessionGroups.length} ticket{sessionGroups.length !== 1 ? 's' : ''} · {filtered.length} líneas · {formatARS(totalSales)}</span>
            <button onClick={() => setCollapsedSessions(prev => prev.size > 0 ? new Set() : new Set(sessionGroups.map(s => s.id)))}
              className="text-[11px] text-primary hover:underline">
              {collapsedSessions.size > 0 ? 'Expandir todo' : 'Colapsar todo'}
            </button>
          </div>
          {sessionGroups.map((sess) => {
            const isCollapsed = collapsedSessions.has(sess.id);
            const toggleCollapse = () => setCollapsedSessions(prev => {
              const next = new Set(prev);
              if (next.has(sess.id)) next.delete(sess.id); else next.add(sess.id);
              return next;
            });
            return (
              <div key={sess.id} className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] overflow-hidden">
                <button
                  className="w-full px-4 py-3 bg-muted/30 flex items-center justify-between hover:bg-muted/50 transition-colors"
                  onClick={toggleCollapse}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <ShoppingCart className="w-4 h-4 text-primary shrink-0" />
                    <div className="text-left min-w-0">
                      <span className="font-semibold text-sm">{sess.customer}</span>
                      <span className="text-xs text-muted-foreground ml-2">{formatDateAR(sess.date)} · {new Date(sess.date).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-muted-foreground">{sess.items.length} ítem{sess.items.length !== 1 ? 's' : ''}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${sess.paid ? 'bg-success/20 text-success' : 'bg-warning/20 text-warning'}`}>{sess.paid ? '✓' : 'Debe'}</span>
                    <span className="font-bold text-sm">{formatARS(sess.total)}</span>
                    <ChevronLeft className={`w-4 h-4 text-muted-foreground transition-transform ${isCollapsed ? '-rotate-90' : 'rotate-90'}`} />
                  </div>
                </button>
                {!isCollapsed && (
                  <div className="divide-y divide-border">
                    {sess.items.map(s => (
                      <div key={s.id} className="px-4 py-2.5 flex items-center justify-between">
                        <span className="text-sm">{s.product_name} <span className="text-xs text-muted-foreground">×{s.quantity}</span></span>
                        <div className="flex items-center gap-3">
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${PAYMENT_BADGE[s.payment_method] || 'bg-muted'}`}>{s.payment_method || 'efectivo'}</span>
                          <span className="text-sm font-medium">{formatARS(Number(s.total_ars))}</span>
                        </div>
                      </div>
                    ))}
                    <div className="px-4 py-2 bg-muted/20 flex justify-between items-center">
                      <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => { setSelectedIds(new Set(sess.items.map((s: any) => s.id))); }}>
                        <Printer className="w-3 h-3" />Recibo
                      </Button>
                      <span className="text-xs font-bold">{formatARS(sess.total)}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {sessionGroups.length === 0 && (
            <EmptyState icon={ShoppingCart} title="Sin tickets" description="No hay ventas en el período seleccionado." />
          )}
        </div>
      ) : viewMode === "by_product" ? (
        /* ── By Product view ── */
        <div className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold font-display tracking-tight">{productGroups.length} productos</h3>
            <span className="text-xs text-muted-foreground">{formatARS(totalSales)} total · {filtered.length} ventas</span>
          </div>
          {productGroups.length === 0 ? (
            <p className="text-center text-muted-foreground text-sm py-10">Sin ventas en el período</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">#</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Producto</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Unidades</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ingresos</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">Ganancia</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden lg:table-cell">Margen</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden xl:table-cell">Última venta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {productGroups.map((p, i) => {
                  const share = totalSales > 0 ? (p.total / totalSales) * 100 : 0;
                  const margin = p.total > 0 ? (p.profit / p.total) * 100 : 0;
                  return (
                    <tr key={p.name} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 text-xs text-muted-foreground">{i + 1}</td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium text-sm">{p.name}</p>
                          <div className="flex items-center gap-1 mt-0.5">
                            <div className="h-1 bg-primary/50 rounded-full" style={{ width: `${Math.min(share * 1.5, 80)}px` }} />
                            <span className="text-[10px] text-muted-foreground">{share.toFixed(1)}%</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm">{p.units}</td>
                      <td className="px-4 py-3 text-right font-bold">{formatARS(p.total)}</td>
                      <td className="px-4 py-3 text-right text-success hidden md:table-cell">{formatARS(p.profit)}</td>
                      <td className={`px-4 py-3 text-right hidden lg:table-cell font-semibold text-xs ${margin >= 30 ? 'text-success' : margin >= 15 ? 'text-warning' : 'text-destructive'}`}>
                        {margin.toFixed(1)}%
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground hidden xl:table-cell">
                        {new Date(p.lastDate + "T12:00:00").toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ) : viewMode === "by_date" ? (
        /* ── By Date view ── */
        (() => {
          const dateMap: Record<string, { total: number; profit: number; count: number; paid: number }> = {};
          filtered.forEach(s => {
            const d = String(s.date).slice(0, 10);
            if (!dateMap[d]) dateMap[d] = { total: 0, profit: 0, count: 0, paid: 0 };
            dateMap[d].total += Number(s.total_ars);
            dateMap[d].profit += Number(s.profit_ars || 0);
            dateMap[d].count += 1;
            if (s.status === "paid") dateMap[d].paid += Number(s.total_ars);
          });
          const dates = Object.keys(dateMap).sort().reverse();
          if (dates.length === 0) return <EmptyState icon={Calendar} title="Sin ventas" description="No hay ventas en el período seleccionado." />;
          return (
            <div className="space-y-2">
              {dates.map(d => {
                const data = dateMap[d];
                // Delta vs same weekday 7 days ago
                const prevDay = new Date(d + "T12:00:00");
                prevDay.setDate(prevDay.getDate() - 7);
                const prevKey = prevDay.toISOString().slice(0, 10);
                const prevData = dateMap[prevKey];
                const delta = prevData && prevData.total > 0 ? ((data.total - prevData.total) / prevData.total) * 100 : null;
                const label = new Date(d + "T12:00:00").toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "short" });
                return (
                  <div key={d} className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] px-4 py-3 flex items-center gap-4">
                    <div className="w-28 shrink-0">
                      <p className="text-sm font-semibold capitalize">{label}</p>
                      <p className="text-[10px] text-muted-foreground">{data.count} venta{data.count !== 1 ? "s" : ""}</p>
                    </div>
                    <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                      <div className="h-full bg-primary/60 rounded-full" style={{ width: `${Math.min(100, (data.total / (dateMap[dates[dates.length - 1]]?.total || 1)) * 100)}%` }} />
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-sm font-mono">{formatARS(data.total)}</p>
                      <p className="text-[10px] text-success">{formatARS(data.profit)} gan.</p>
                    </div>
                    {delta !== null ? (
                      <div className={`w-14 text-right shrink-0 text-xs font-semibold ${delta >= 0 ? "text-success" : "text-destructive"}`}>
                        {delta >= 0 ? "▲" : "▼"}{Math.abs(delta).toFixed(0)}%
                        <p className="text-[9px] font-normal text-muted-foreground">vs -7d</p>
                      </div>
                    ) : (
                      <div className="w-14 shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()
      ) : (
        <>
          {/* Bulk action bar */}
          {selectedIds.size > 0 && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-card border border-primary/40 shadow-xl rounded-[10px] px-4 py-3">
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

          <div className="hidden md:block bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] overflow-hidden">
            <div className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 340px)" }}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-border bg-muted/30 shadow-sm">
                  <th className="px-3 py-3 w-8">
                    <button onClick={toggleSelectAll} className="text-muted-foreground hover:text-foreground transition-colors" title="Seleccionar todas">
                      {selectedIds.size > 0 && selectedIds.size === paged.length ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
                    </button>
                  </th>
                  {(["date", "product_name", "customer_name", "total_ars"] as const).map((col, i) => {
                    const labels: Record<string, string> = { date: "Fecha", product_name: "Producto", customer_name: "Cliente", total_ars: "Total" };
                    const hidden = col === "customer_name" ? "hidden lg:table-cell" : "";
                    const align = col === "total_ars" ? "text-right" : "text-left";
                    const active = saleSort.col === col;
                    return (
                      <th key={col} className={`px-4 py-3 ${align} ${hidden}`}>
                        <button
                          onClick={() => setSaleSort(prev => prev.col === col ? { col, dir: prev.dir === "asc" ? "desc" : "asc" } : { col, dir: col === "date" ? "desc" : "asc" })}
                          className={`flex items-center gap-1 text-xs font-semibold uppercase tracking-wider transition-colors ${active ? "text-primary" : "text-muted-foreground hover:text-foreground"} ${align === "text-right" ? "ml-auto" : ""}`}
                        >
                          {labels[col]}
                          {active ? (saleSort.dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : <ChevronDown className="w-3 h-3 opacity-30" />}
                        </button>
                      </th>
                    );
                  })}
                  <th className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden xl:table-cell">Vendedor</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Medio</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cant.</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden xl:table-cell">Ganancia</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Estado</th>
                  {isAdmin && <th className="px-4 py-3"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paged.map(s => (
                  <tr key={s.id} className={`hover:bg-muted/20 transition-colors group ${selectedIds.has(s.id) ? 'bg-primary/5' : multiItemSaleIds.has(s.id) ? 'bg-primary/[0.02]' : ''}`}>
                    <td className="px-3 py-3 w-8">
                      <button onClick={() => toggleSelect(s.id)} className="text-muted-foreground hover:text-primary transition-colors">
                        {selectedIds.has(s.id) ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4 opacity-40 group-hover:opacity-100" />}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatDateAR(s.date)}</td>
                    <td className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span>{s.product_name}</span>
                        {multiItemSaleIds.has(s.id) && (
                          <span
                            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20 cursor-pointer"
                            title="Parte de un ticket con múltiples productos — ver en vista Sesiones"
                            onClick={() => setViewMode("by_session")}
                          >
                            <Ticket className="w-3 h-3" />Ticket
                          </span>
                        )}
                        {s.discount_applied && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-500/10 text-orange-400 border border-orange-500/20" title="Precio con descuento aplicado">
                            🏷️ Desc.
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs hidden lg:table-cell">{s.customer_name || '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs hidden xl:table-cell">{(s as any).seller_name || '—'}</td>
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
                        {!s.paid && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[11px] text-success hover:text-success hover:bg-success/10 gap-1"
                            title="Marcar como cobrado"
                            onClick={() => markSinglePaid(s)}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />Cobrar
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Imprimir recibo" onClick={() => printReceipt(s)}>
                          <Printer className="w-3.5 h-3.5 text-muted-foreground" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="Descargar PDF" onClick={() => downloadSalePDF(s)}>
                          <FileDown className="w-3.5 h-3.5 text-muted-foreground" />
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
          </div>

          <div className="md:hidden space-y-3">
            {paged.map(s => (
              <div key={s.id} className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-lg p-4">
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
                    {s.discount_applied && (
                      <span className="px-1.5 py-0 rounded text-[10px] font-medium bg-orange-500/10 text-orange-400 border border-orange-500/20">
                        🏷️ Desc.
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
                  <div className="flex gap-1">
                    {!s.paid && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-[11px] text-success hover:bg-success/10 gap-1"
                        onClick={() => markSinglePaid(s)}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />Cobrar
                      </Button>
                    )}
                    {isAdmin && <>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditItem(s); setOpen(true); }}><Edit className="w-3 h-3" /></Button>
                      <ConfirmDialog
                        trigger={<Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                        title="¿Eliminar venta?"
                        confirmText="Eliminar"
                        onConfirm={() => handleDelete(s)}
                      />
                    </>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Period totals footer */}
          {filtered.length > 0 && (
            <div className="mt-3 bg-[hsl(228_24%_7%)] border border-border/60 rounded-[10px] px-4 py-3 flex flex-wrap items-center gap-4 text-sm">
              <span className="text-muted-foreground text-xs uppercase tracking-wider font-semibold">Totales del período</span>
              <span className="font-bold text-primary">{formatARS(totalSales)}</span>
              <span className="text-success text-xs">{formatARS(totalProfit)} ganancia</span>
              <span className="text-muted-foreground text-xs">{marginPct.toFixed(1)}% margen</span>
              <span className="text-muted-foreground text-xs">{filtered.length} ventas</span>
              {debtCount > 0 && <span className="text-destructive text-xs font-medium">{formatARS(filtered.filter(s => !s.paid).reduce((a, s) => a + Number(s.total_ars), 0))} pendiente</span>}
            </div>
          )}

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
        broadcastSync({ type: "sale_created", count: lines.length });
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
          <div className="absolute z-50 w-full mt-1 bg-[hsl(228_24%_7%)] border border-border/60 rounded-lg shadow-lg max-h-40 overflow-y-auto">
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
