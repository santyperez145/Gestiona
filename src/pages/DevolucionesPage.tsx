import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useOrg } from "@/lib/orgContext";
import { formatARS } from "@/lib/supabaseStore";
import {
  allocateSalesReturnRefund,
  salesReturnLineAmount,
  salesReturnPaymentLabel,
  salesReturnStatusLabel,
  salesReturnTotal,
  type RefundAllocation,
  type SalesReturnPreview,
  type SalesReturnPreviewPayment,
} from "@/lib/salesReturn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import ReturnsPortalTab from "@/components/sales/ReturnsPortalTab";
import { usePageTitle } from "@/hooks/usePageTitle";
import { toast } from "sonner";
import {
  AlertCircle, BadgeCheck, Banknote, Calendar, CheckCircle2, ChevronDown,
  ChevronUp, CircleDollarSign, FileSpreadsheet, FileText, Loader2, Package,
  ReceiptText, RefreshCw, RotateCcw, Search, ShieldCheck, Split,
} from "lucide-react";

type ReturnOperation = Database["public"]["Views"]["sales_return_operations"]["Row"];
type ReturnRefund = Database["public"]["Tables"]["sales_return_refunds"]["Row"];
type SaleSearchResult = Pick<Database["public"]["Tables"]["sales"]["Row"],
  "id" | "sale_transaction_id" | "product_name" | "customer_name" | "date" |
  "total_ars" | "quantity" | "location_id" | "source" | "ecommerce_order_id">;

const REASONS = [
  "Producto defectuoso",
  "Error en el pedido",
  "El cliente cambió de opinión",
  "Producto no corresponde a la descripción",
  "Producto dañado",
  "Otro",
];

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const numeric = (value: number | null | undefined) => Number(value ?? 0);
const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

export default function DevolucionesPage() {
  usePageTitle("Devoluciones");
  const navigate = useNavigate();
  const { activeOrg } = useOrg();

  const [pageTab, setPageTab] = useState<"standard" | "rma">("standard");
  const [operations, setOperations] = useState<ReturnOperation[]>([]);
  const [refunds, setRefunds] = useState<ReturnRefund[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [saleSearch, setSaleSearch] = useState("");
  const [saleResults, setSaleResults] = useState<SaleSearchResult[]>([]);
  const [searchingSales, setSearchingSales] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [preview, setPreview] = useState<SalesReturnPreview | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [allocations, setAllocations] = useState<RefundAllocation[]>([]);
  const [reason, setReason] = useState(REASONS[0]);
  const [notes, setNotes] = useState("");
  const [restock, setRestock] = useState(true);
  const [clientReturnId, setClientReturnId] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);

  const [refundToConfirm, setRefundToConfirm] = useState<ReturnRefund | null>(null);
  const [externalReference, setExternalReference] = useState("");
  const [confirmingRefund, setConfirmingRefund] = useState(false);

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    setLoadError(null);
    const [operationsResult, refundsResult] = await Promise.all([
      supabase.from("sales_return_operations").select("*")
        .eq("org_id", activeOrg.id).order("created_at", { ascending: false }),
      supabase.from("sales_return_refunds").select("*")
        .eq("org_id", activeOrg.id).order("created_at", { ascending: true }),
    ]);
    if (operationsResult.error || refundsResult.error) {
      const error = operationsResult.error ?? refundsResult.error;
      console.error("[Devoluciones] No se pudo cargar la operación completa:", error);
      setLoadError(error?.message ?? "No se pudieron cargar las devoluciones");
      setOperations([]);
      setRefunds([]);
    } else {
      setOperations(operationsResult.data);
      setRefunds(refundsResult.data);
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, [activeOrg?.id]);

  const resetForm = () => {
    setSaleSearch(""); setSaleResults([]); setPreview(null); setQuantities({});
    setAllocations([]); setReason(REASONS[0]); setNotes(""); setRestock(true);
    setClientReturnId(crypto.randomUUID());
  };

  const searchSales = async (query: string) => {
    setSaleSearch(query);
    if (!activeOrg || query.trim().length < 2) { setSaleResults([]); return; }
    setSearchingSales(true);
    const normalized = query.trim().toLocaleLowerCase("es");
    const uuidSearch = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(query.trim());
    const safeText = query.trim().replace(/[,%().]/g, " ");
    let salesQuery = supabase.from("sales")
      .select("id, sale_transaction_id, product_name, customer_name, date, total_ars, quantity, location_id, source, ecommerce_order_id")
      .eq("org_id", activeOrg.id).eq("paid", true);
    salesQuery = uuidSearch
      ? salesQuery.or(`id.eq.${query.trim()},sale_transaction_id.eq.${query.trim()}`)
      : salesQuery.or(`product_name.ilike.%${safeText}%,customer_name.ilike.%${safeText}%`);
    const { data, error } = await salesQuery.order("date", { ascending: false }).limit(80);
    setSearchingSales(false);
    if (error) {
      console.error("[Devoluciones] No se pudieron buscar tickets:", error);
      toast.error("No se pudieron buscar las ventas", { description: error.message });
      setSaleResults([]);
      return;
    }
    const uniqueTickets = new Map<string, SaleSearchResult>();
    data.filter((sale) => sale.source !== "tienda_online" && !sale.ecommerce_order_id)
      .filter((sale) => [sale.product_name, sale.customer_name, sale.sale_transaction_id, sale.id]
        .filter(Boolean).join(" ").toLocaleLowerCase("es").includes(normalized))
      .forEach((sale) => uniqueTickets.set(sale.sale_transaction_id ?? sale.id, sale));
    setSaleResults([...uniqueTickets.values()].slice(0, 10));
  };

  const selectSale = async (sale: SaleSearchResult) => {
    if (!activeOrg) return;
    setLoadingPreview(true);
    setSaleResults([]);
    const { data, error } = await supabase.rpc("preview_sales_return", {
      p_org_id: activeOrg.id, p_sale_id: sale.id,
    });
    setLoadingPreview(false);
    if (error) {
      console.error("[Devoluciones] No se pudo previsualizar el ticket:", error);
      toast.error("Ese ticket no se puede devolver", { description: error.message });
      return;
    }
    const nextPreview = data as unknown as SalesReturnPreview;
    if (!Array.isArray(nextPreview.lines) || !Array.isArray(nextPreview.payments)) {
      console.error("[Devoluciones] Contrato de preview inválido:", data);
      toast.error("El ticket llegó con un formato inválido");
      return;
    }
    const nextQuantities = Object.fromEntries(nextPreview.lines.map((line) => [
      line.sale_id, line.sale_id === sale.id && line.available_quantity > 0 ? 1 : 0,
    ]));
    const nextTotal = salesReturnTotal(nextPreview.lines, nextQuantities);
    setPreview(nextPreview);
    setQuantities(nextQuantities);
    setAllocations(allocateSalesReturnRefund(nextPreview.payments, nextTotal));
    setSaleSearch(`Ticket ${nextPreview.ticket_code} · ${sale.product_name}`);
    setClientReturnId(crypto.randomUUID());
  };

  const changeQuantity = (saleId: string, value: number) => {
    if (!preview) return;
    const line = preview.lines.find((item) => item.sale_id === saleId);
    if (!line) return;
    const next = { ...quantities,
      [saleId]: Math.max(0, Math.min(Math.trunc(value || 0), line.available_quantity)) };
    const nextTotal = salesReturnTotal(preview.lines, next);
    setQuantities(next);
    setAllocations(allocateSalesReturnRefund(preview.payments, nextTotal));
  };

  const changeAllocation = (key: string, value: number) => {
    setAllocations((current) => current.map((allocation) =>
      (allocation.payment_transaction_id ?? allocation.sale_method) === key
        ? { ...allocation, amount: money(Math.max(0, value || 0)) } : allocation));
  };

  const returnTotal = preview ? salesReturnTotal(preview.lines, quantities) : 0;
  const allocatedTotal = money(allocations.reduce((sum, item) => sum + item.amount, 0));
  const cashAllocation = allocations.some((allocation) => {
    const payment = preview?.payments.find((item) =>
      (item.payment_transaction_id ?? item.sale_method)
      === (allocation.payment_transaction_id ?? allocation.sale_method));
    return allocation.amount > 0 && payment?.execution_mode === "cash";
  });
  const allocationMatches = Math.abs(returnTotal - allocatedTotal) <= 0.01;
  const needsOpenCashSession = Boolean(cashAllocation && preview && !preview.open_cash_session_id);

  const handleCreate = async () => {
    if (!activeOrg || !preview || returnTotal <= 0 || !allocationMatches || needsOpenCashSession) return;
    const selectedLines = preview.lines.map((line) => ({
      sale_id: line.sale_id, quantity: quantities[line.sale_id] ?? 0,
    })).filter((line) => line.quantity > 0);
    const selectedAllocations = allocations.filter((item) => item.amount > 0).map((item) => ({
      payment_transaction_id: item.payment_transaction_id,
      sale_method: item.payment_transaction_id ? undefined : item.sale_method,
      amount: item.amount,
    }));
    setSaving(true);
    const { data, error } = await supabase.rpc("create_sales_return_v1", {
      p_org_id: activeOrg.id, p_sale_id: preview.sale_id, p_lines: selectedLines,
      p_refund_allocations: selectedAllocations, p_reason: reason,
      p_notes: notes.trim() || undefined, p_restock: restock,
      p_client_return_id: clientReturnId,
    });
    setSaving(false);
    if (error) {
      console.error("[Devoluciones] La operación atómica fue rechazada:", error);
      toast.error("No se registró la devolución", { description: error.message });
      return;
    }
    const result = data as unknown as { status: string; reused: boolean };
    if (result.status === "completed") {
      toast.success(result.reused ? "La devolución ya estaba registrada" : "Devolución y reintegro completados");
    } else {
      toast.warning("Devolución registrada; falta confirmar parte del reintegro", {
        description: "El stock y el libro quedaron conciliados. El dinero externo no se muestra como devuelto hasta tener evidencia.",
      });
    }
    setOpen(false); resetForm(); await load();
  };

  const confirmExternalRefund = async () => {
    if (!refundToConfirm || externalReference.trim().length < 4) return;
    setConfirmingRefund(true);
    const { error } = await supabase.rpc("sales_return_refund_complete", {
      p_refund_id: refundToConfirm.id,
      p_external_reference: externalReference.trim(),
      p_raw: { confirmed_from: "devoluciones_ui" },
    });
    setConfirmingRefund(false);
    if (error) {
      console.error("[Devoluciones] No se pudo confirmar el reintegro:", error);
      toast.error("No se confirmó el reintegro", { description: error.message });
      return;
    }
    toast.success("Reintegro conciliado con su referencia externa");
    setRefundToConfirm(null); setExternalReference(""); await load();
  };

  const printInternalReceipt = (operation: ReturnOperation) => {
    const date = new Date(operation.created_at ?? Date.now()).toLocaleString("es-AR");
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Comprobante interno</title><style>
      body{font-family:Inter,Arial,sans-serif;margin:0;padding:36px;color:#10214a;background:#fff}.eyebrow{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#315cf5;font-weight:800}h1{font-size:26px;margin:7px 0 4px}.muted{color:#64748b;font-size:12px}.card{margin:24px 0;padding:20px;border:1px solid #dbe3f2;border-radius:16px;background:#f8faff}.row{display:flex;justify-content:space-between;gap:24px;padding:8px 0;border-bottom:1px solid #e7ecf5}.row:last-child{border:0}.total{font-size:22px;font-weight:800;color:#163dcc}.warning{margin-top:28px;padding:14px;border:1px solid #f2c94c;background:#fffbea;border-radius:12px;font-size:12px;line-height:1.5}
    </style></head><body><div class="eyebrow">Gestiona · operación interna</div><h1>Comprobante interno de devolución</h1><div class="muted">${escapeHtml(date)} · ID ${escapeHtml(operation.id ?? "—")}</div><div class="card"><div class="row"><span>Productos</span><strong>${escapeHtml(operation.product_names ?? "—")}</strong></div><div class="row"><span>Unidades</span><strong>${numeric(operation.units)}</strong></div><div class="row"><span>Motivo</span><strong>${escapeHtml(operation.reason ?? "—")}</strong></div><div class="row"><span>Estado</span><strong>${escapeHtml(salesReturnStatusLabel(operation.status))}</strong></div><div class="row"><span>Monto</span><strong class="total">${escapeHtml(formatARS(numeric(operation.refund_amount)))}</strong></div></div><div class="warning"><strong>No es una nota de crédito fiscal.</strong><br>No reemplaza un comprobante fiscal autorizado por ARCA. Si la venta tenía CAE, emití la nota de crédito desde Facturación.</div></body></html>`;
    const popup = window.open("", "_blank", "width=760,height=680");
    if (!popup) { toast.error("El navegador bloqueó la ventana de impresión"); return; }
    popup.document.write(html); popup.document.close(); popup.focus(); popup.print();
  };

  const filtered = useMemo(() => operations.filter((operation) => {
    const normalized = search.toLocaleLowerCase("es");
    const matchesSearch = [operation.product_names, operation.reason, operation.id]
      .filter(Boolean).join(" ").toLocaleLowerCase("es").includes(normalized);
    return matchesSearch && (filterStatus === "all" || operation.status === filterStatus);
  }), [operations, search, filterStatus]);

  const totalUnits = operations.reduce((sum, item) => sum + numeric(item.units), 0);
  const completedAmount = operations.reduce((sum, item) => sum + numeric(item.completed_amount), 0);
  const pendingAmount = operations.reduce((sum, item) => sum + numeric(item.pending_amount), 0);

  const exportCsv = () => {
    const headers = ["Fecha", "ID", "Productos", "Unidades", "Monto", "Completado", "Pendiente", "Estado", "Motivo"];
    const rows = filtered.map((item) => [new Date(item.created_at ?? Date.now()).toLocaleString("es-AR"),
      item.id, item.product_names, item.units, item.refund_amount, item.completed_amount,
      item.pending_amount, salesReturnStatusLabel(item.status), item.reason]
      .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","));
    const url = URL.createObjectURL(new Blob([`\ufeff${[headers.join(","), ...rows].join("\n")}`],
      { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url;
    anchor.download = `devoluciones-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click(); URL.revokeObjectURL(url); toast.success("Devoluciones exportadas");
  };

  return (
    <div className="space-y-5 pb-12">
      <PageHeader icon={RotateCcw} title="Devoluciones"
        description="Revertí productos, stock, caja y resultado sin perder la trazabilidad del ticket."
        badge={pendingAmount > 0 ? { label: `${formatARS(pendingAmount)} pendiente`, variant: "destructive" } : undefined}
        actions={<Button className="gradient-gold h-9 text-primary-foreground shadow-gold" onClick={() => setOpen(true)}><RotateCcw className="mr-2 h-4 w-4" /> Nueva devolución</Button>} />

      <div className="flex w-fit gap-1 rounded-xl border border-border/70 bg-muted/30 p-1">
        <button type="button" onClick={() => setPageTab("standard")} className={`rounded-lg px-4 py-1.5 text-sm font-medium ${pageTab === "standard" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>Mostrador</button>
        <button type="button" onClick={() => setPageTab("rma")} className={`rounded-lg px-4 py-1.5 text-sm font-medium ${pageTab === "rma" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>Tienda online / RMA</button>
      </div>

      {pageTab === "rma" ? <ReturnsPortalTab /> : <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KPICard label="Operaciones" value={operations.length} icon={RotateCcw} color="primary" />
          <KPICard label="Unidades" value={totalUnits} icon={Package} color="warning" />
          <KPICard label="Reintegrado" value={formatARS(completedAmount)} icon={BadgeCheck} color="success" />
          <KPICard label="Pendiente externo" value={formatARS(pendingAmount)} icon={CircleDollarSign} color="destructive" />
        </div>

        <div className="rounded-2xl border border-primary/15 bg-gradient-to-r from-primary/[0.07] via-card to-card p-4 shadow-card sm:flex sm:items-center sm:gap-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10"><ShieldCheck className="h-5 w-5 text-primary" /></div>
          <div><p className="font-semibold">Una operación, una sola verdad</p><p className="mt-0.5 text-sm text-muted-foreground">El importe sale del ticket original. Efectivo exige caja abierta; tarjetas, transferencias y QR no figuran reintegrados hasta tener evidencia externa.</p></div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por producto, motivo o ID…" className="h-9 pl-9" /></div>
          <Select value={filterStatus} onValueChange={setFilterStatus}><SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todos los estados</SelectItem><SelectItem value="completed">Completadas</SelectItem><SelectItem value="pending_refund">Reintegro pendiente</SelectItem></SelectContent></Select>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}><FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" /> CSV</Button>
        </div>

        {loading ? <div className="space-y-3">{[1, 2, 3].map((item) => <div key={item} className="h-24 animate-pulse rounded-2xl bg-muted/40" />)}</div>
          : loadError ? <div className="rounded-2xl border border-destructive/25 bg-destructive/5 p-8 text-center"><AlertCircle className="mx-auto h-9 w-9 text-destructive" /><p className="mt-3 font-semibold">No pudimos leer las devoluciones</p><p className="mt-1 text-sm text-muted-foreground">{loadError}</p><Button className="mt-4" variant="outline" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" /> Reintentar</Button></div>
          : filtered.length === 0 ? <div className="rounded-2xl border border-dashed border-border bg-card/60 py-16 text-center"><RotateCcw className="mx-auto h-11 w-11 text-muted-foreground/30" /><p className="mt-3 font-medium">{operations.length ? "No hay coincidencias" : "Todavía no hay devoluciones"}</p><p className="mt-1 text-sm text-muted-foreground">Las devoluciones de mostrador aparecerán acá con su reintegro y documento fiscal.</p></div>
          : <div className="space-y-3">{filtered.map((operation) => {
            const parts = refunds.filter((refund) => refund.return_transaction_id === operation.id);
            const expanded = expandedId === operation.id;
            return <article key={operation.id} className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-card">
              <div className="flex items-start gap-3 p-4 sm:p-5">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${operation.status === "completed" ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"}`}>{operation.status === "completed" ? <CheckCircle2 className="h-5 w-5" /> : <CircleDollarSign className="h-5 w-5" />}</div>
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{operation.product_names || "Devolución"}</h3><Badge variant="outline" className={operation.status === "completed" ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-700" : "border-amber-500/25 bg-amber-500/5 text-amber-700"}>{salesReturnStatusLabel(operation.status)}</Badge>{operation.credit_note_required && <Badge variant="outline" className="border-blue-500/25 bg-blue-500/5 text-blue-700">Nota fiscal requerida</Badge>}</div><div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> {new Date(operation.created_at ?? Date.now()).toLocaleString("es-AR")}</span><span>{numeric(operation.units)} u.</span><span>{operation.reason}</span></div></div>
                <div className="text-right"><p className="text-lg font-bold">{formatARS(numeric(operation.refund_amount))}</p>{numeric(operation.pending_amount) > 0 && <p className="text-xs font-medium text-amber-700">{formatARS(numeric(operation.pending_amount))} pendiente</p>}</div>
                <button type="button" onClick={() => setExpandedId(expanded ? null : operation.id)} className="rounded-lg p-2 text-muted-foreground hover:bg-muted" aria-label={expanded ? "Contraer devolución" : "Ver detalle de devolución"}>{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>
              </div>
              {expanded && <div className="space-y-4 border-t border-border/70 bg-muted/[0.12] p-4 sm:p-5">
                <div className="grid gap-3 md:grid-cols-2">{parts.map((refund) => <div key={refund.id} className="rounded-xl border border-border/70 bg-card p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{salesReturnPaymentLabel(refund.sale_method)}</p><p className="mt-0.5 text-xs text-muted-foreground">{refund.execution_mode === "cash" ? "Egreso en caja" : refund.execution_mode === "mercadopago_api" ? "Validación con Mercado Pago" : "Confirmación externa manual"}</p></div><p className="font-bold">{formatARS(refund.amount)}</p></div><div className="mt-3 flex items-center justify-between gap-2"><Badge variant="outline" className={refund.status === "completed" ? "border-emerald-500/20 text-emerald-700" : "border-amber-500/20 text-amber-700"}>{refund.status === "completed" ? "Completado" : "Pendiente"}</Badge>{refund.external_reference && <span className="truncate text-xs text-muted-foreground">Ref. {refund.external_reference}</span>}{refund.status === "pending_external" && refund.execution_mode === "manual_external" && <Button size="sm" variant="outline" onClick={() => { setRefundToConfirm(refund); setExternalReference(""); }}>Confirmar pago</Button>}</div>{refund.status === "pending_external" && refund.execution_mode === "mercadopago_api" && <p className="mt-2 text-xs text-amber-700">No puede cerrarse a mano: debe confirmarlo el proveedor.</p>}</div>)}</div>
                <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => printInternalReceipt(operation)}><FileText className="mr-2 h-4 w-4" /> Comprobante interno</Button>{operation.credit_note_required && <Button size="sm" variant="outline" onClick={() => navigate("/facturas")}><ReceiptText className="mr-2 h-4 w-4" /> Emitir nota de crédito ARCA</Button>}</div>
                <p className="text-xs text-muted-foreground">ID auditable: {operation.id} · {operation.restock ? "Stock repuesto" : "Sin reposición de stock"}</p>
              </div>}
            </article>;
          })}</div>}
      </div>}

      <Dialog open={open} onOpenChange={(value) => { setOpen(value); if (!value) resetForm(); }}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto"><DialogHeader><DialogTitle>Nueva devolución de mostrador</DialogTitle></DialogHeader>
          <div className="space-y-5 pt-1">
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/[0.06] p-3 text-sm text-blue-900 dark:text-blue-100"><div className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><p>Seleccioná una venta cobrada. Gestiona calcula importes y topes desde el ticket: no se puede devolver más dinero ni más unidades que las originales.</p></div></div>
            <div><label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Ticket, cliente o producto</label><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={saleSearch} onChange={(event) => void searchSales(event.target.value)} placeholder="Escribí al menos 2 caracteres…" className="pl-9 pr-9" />{(searchingSales || loadingPreview) && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-primary" />}</div>
              {saleResults.length > 0 && <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-border bg-card shadow-xl">{saleResults.map((sale) => <button type="button" key={sale.sale_transaction_id ?? sale.id} onClick={() => void selectSale(sale)} className="flex w-full items-center justify-between gap-3 border-b border-border/60 px-3 py-3 text-left last:border-0 hover:bg-muted/50"><div className="min-w-0"><p className="truncate text-sm font-semibold">{sale.product_name}</p><p className="mt-0.5 text-xs text-muted-foreground">{sale.customer_name || "Consumidor final"} · {new Date(sale.date).toLocaleString("es-AR")}</p></div><div className="text-right"><p className="text-sm font-bold">{formatARS(sale.total_ars)}</p><p className="font-mono text-[10px] text-muted-foreground">#{(sale.sale_transaction_id ?? sale.id).slice(-8).toUpperCase()}</p></div></button>)}</div>}
            </div>

            {preview && <>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/20 p-3"><div><p className="text-sm font-semibold">Ticket #{preview.ticket_code}</p><p className="text-xs text-muted-foreground">{preview.customer_name || "Consumidor final"} · {new Date(preview.sold_at).toLocaleString("es-AR")}</p></div><Badge variant="outline">{preview.lines.length} {preview.lines.length === 1 ? "renglón" : "renglones"}</Badge></div>
              <section><div className="mb-2 flex items-center gap-2"><Package className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">1. Productos que vuelven</h3></div><div className="space-y-2">{preview.lines.map((line) => <div key={line.sale_id} className={`grid gap-3 rounded-xl border p-3 sm:grid-cols-[1fr_110px_120px] sm:items-center ${line.available_quantity === 0 ? "border-border/50 bg-muted/30 opacity-60" : "border-border bg-card"}`}><div><p className="text-sm font-medium">{line.product_name}</p><p className="mt-0.5 text-xs text-muted-foreground">Vendidas {line.sold_quantity} · devueltas {line.returned_quantity} · disponibles {line.available_quantity}</p></div><div><label className="mb-1 block text-[11px] text-muted-foreground">Cantidad</label><Input type="number" min={0} max={line.available_quantity} disabled={line.available_quantity === 0} value={quantities[line.sale_id] ?? 0} onChange={(event) => changeQuantity(line.sale_id, Number(event.target.value))} className="h-9" /></div><div className="text-right"><p className="text-[11px] text-muted-foreground">A reintegrar</p><p className="font-bold">{formatARS(salesReturnLineAmount(line, quantities[line.sale_id] ?? 0))}</p></div></div>)}</div></section>
              <section><div className="mb-2 flex items-center gap-2"><Split className="h-4 w-4 text-primary" /><h3 className="text-sm font-semibold">2. Reintegro sobre el cobro original</h3></div><div className="grid gap-2 md:grid-cols-2">{preview.payments.map((payment: SalesReturnPreviewPayment) => { const key = payment.payment_transaction_id ?? payment.sale_method; const allocation = allocations.find((item) => (item.payment_transaction_id ?? item.sale_method) === key); return <div key={key} className="rounded-xl border border-border bg-card p-3"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">{salesReturnPaymentLabel(payment.sale_method)}</p><p className="text-xs text-muted-foreground">Cobrado {formatARS(payment.paid_amount)} · disponible {formatARS(payment.available_amount)}</p></div><Banknote className="h-4 w-4 text-muted-foreground" /></div><label className="mb-1 mt-3 block text-[11px] text-muted-foreground">Importe por este medio</label><Input type="number" min={0} max={payment.available_amount} step="0.01" value={allocation?.amount ?? 0} onChange={(event) => changeAllocation(key, Number(event.target.value))} className="h-9" /><p className="mt-2 text-[11px] text-muted-foreground">{payment.execution_mode === "cash" ? "Sale de la caja abierta ahora." : payment.execution_mode === "mercadopago_api" ? "Queda pendiente hasta confirmación del proveedor." : "Queda pendiente hasta cargar una referencia externa."}</p></div>; })}</div>
                {!allocationMatches && returnTotal > 0 && <div className="mt-2 flex gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-2.5 text-xs text-destructive"><AlertCircle className="h-4 w-4 shrink-0" /> Los medios suman {formatARS(allocatedTotal)} y los productos {formatARS(returnTotal)}.</div>}
                {needsOpenCashSession && <div className="mt-2 flex gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-200"><AlertCircle className="h-4 w-4 shrink-0" /> Abrí la caja de la sucursal original antes de devolver efectivo.</div>}
              </section>
              <section className="grid gap-3 md:grid-cols-2"><div><label className="mb-1 block text-xs font-semibold text-muted-foreground">Motivo</label><Select value={reason} onValueChange={setReason}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{REASONS.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></div><div><label className="mb-1 block text-xs font-semibold text-muted-foreground">Notas internas</label><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Estado del producto, evidencia, autorización…" className="min-h-10 resize-none" /></div></section>
              <button type="button" onClick={() => setRestock((value) => !value)} className="flex w-full items-center justify-between rounded-xl border border-border p-3 text-left"><div><p className="text-sm font-semibold">Reponer al stock vendible</p><p className="text-xs text-muted-foreground">Desactivá sólo si el producto está dañado o no puede revenderse.</p></div><span className={`relative h-6 w-11 rounded-full ${restock ? "bg-primary" : "bg-muted"}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${restock ? "translate-x-6" : "translate-x-1"}`} /></span></button>
              <div className="sticky bottom-0 -mx-6 flex items-center justify-between gap-4 border-t border-border bg-background/95 px-6 py-4 backdrop-blur"><div><p className="text-xs text-muted-foreground">Total de la devolución</p><p className="text-xl font-bold">{formatARS(returnTotal)}</p></div><Button disabled={saving || returnTotal <= 0 || !allocationMatches || needsOpenCashSession} onClick={() => void handleCreate()} className="gradient-gold min-w-48 text-primary-foreground">{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />} Confirmar operación</Button></div>
            </>}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(refundToConfirm)} onOpenChange={(value) => { if (!value) { setRefundToConfirm(null); setExternalReference(""); } }}>
        <DialogContent className="max-w-md"><DialogHeader><DialogTitle>Confirmar reintegro externo</DialogTitle></DialogHeader><div className="space-y-4"><div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.08] p-3 text-sm"><p className="font-semibold">Confirmá sólo cuando el dinero salió realmente.</p><p className="mt-1 text-xs text-muted-foreground">Esta acción cancela la deuda al cliente y registra la salida financiera. No inicia un pago.</p></div><div><label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Referencia bancaria o del adquirente</label><Input value={externalReference} onChange={(event) => setExternalReference(event.target.value)} placeholder="Ej. transferencia 00491382" /></div><Button className="w-full" disabled={externalReference.trim().length < 4 || confirmingRefund} onClick={() => void confirmExternalRefund()}>{confirmingRefund ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />} Conciliar {refundToConfirm ? formatARS(refundToConfirm.amount) : ""}</Button></div></DialogContent>
      </Dialog>
    </div>
  );
}
