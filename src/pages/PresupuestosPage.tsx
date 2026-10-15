import { hoyAR } from "@/lib/fechaAR";
import { selloHechoConNerqia } from "@/lib/selloNerqia";
import { useNavigate } from "react-router-dom";
import EditorDePresupuesto, { type PresupuestoEditable } from "@/components/presupuestos/EditorDePresupuesto";
import { linkDePagoDePresupuesto } from "@/lib/linksDePago";
import { mensajeDeError } from "@/lib/cuentaCorriente";
import { useState, useEffect, useRef, useCallback } from "react";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Plus, Trash2, Search, FileText, Download, Send,
  CheckCircle2, XCircle, Clock, Eye, Copy, X, ChevronDown, ChevronUp, Link2, Loader2,
  DollarSign, Mail, CopyPlus, Pencil, Bookmark, BookOpen, Sparkles, User, Package, Zap, ArrowUpDown,
} from "lucide-react";
import FinancePageHeader from "@/components/finance/FinancePageHeader";
import FinanceKPICard from "@/components/finance/FinanceKPICard";
import FinanceEmptyState from "@/components/finance/FinanceEmptyState";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { formatARS } from "@/lib/supabaseStore";
import { usePageTitle } from "@/hooks/usePageTitle";
import { mensajeDeEdgeFunction } from "@/lib/edgeErrors";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";

/** `productId`: el producto del catálogo, para cobrarlo en la caja con stock real. */
type QuoteItem = { description: string; qty: number; unitPrice: number; total: number; discountPct?: number; productId?: string | null; variantId?: string | null };
type Quote = {
  id: string;
  quote_number: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  items: QuoteItem[];
  subtotal: number;
  discount_amount: number;
  total: number;
  status: string;
  valid_until: string | null;
  notes: string;
  created_at: string;
  customer_id?: string | null;
  /** La venta de la caja que lo cobró (20261014000900). Vendido = congelado. */
  converted_at?: string | null;
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft:    { label: "Borrador",  color: "text-muted-foreground bg-muted/30 border-border" },
  sent:     { label: "Enviado",   color: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
  accepted: { label: "Aceptado", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
  rejected: { label: "Rechazado",color: "text-destructive bg-destructive/10 border-destructive/20" },
  expired:  { label: "Vencido",  color: "text-orange-400 bg-orange-500/10 border-orange-500/20" },
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  draft:    <Clock className="w-3 h-3" />,
  sent:     <Send className="w-3 h-3" />,
  accepted: <CheckCircle2 className="w-3 h-3" />,
  rejected: <XCircle className="w-3 h-3" />,
  expired:  <Clock className="w-3 h-3" />,
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${c.color}`}>
      {STATUS_ICON[status]}{c.label}
    </span>
  );
}

// ─── PDF helpers ──────────────────────────────────────────────────────────────
async function generatePDF(quote: Quote, orgName: string, orgId?: string) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW = 210, PH = 297;

  doc.setFillColor(26, 26, 46);
  doc.rect(0, 0, PW, 35, "F");
  doc.setTextColor(212, 168, 67);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text(orgName, 15, 15);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.text("PRESUPUESTO", 15, 25);
  doc.setFontSize(10);
  doc.text(quote.quote_number, PW - 15, 15, { align: "right" });
  doc.setFontSize(9);
  doc.text(`Fecha: ${new Date(quote.created_at).toLocaleDateString("es-AR")}`, PW - 15, 22, { align: "right" });
  if (quote.valid_until) doc.text(`Válido hasta: ${new Date(quote.valid_until).toLocaleDateString("es-AR")}`, PW - 15, 29, { align: "right" });

  doc.setTextColor(30, 30, 30);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("PARA:", 15, 50);
  doc.setFont("helvetica", "normal");
  doc.text(quote.customer_name, 15, 57);
  if (quote.customer_email) doc.text(quote.customer_email, 15, 63);
  if (quote.customer_phone) doc.text(quote.customer_phone, 15, 69);

  const rows = quote.items.map(item => [
    item.description,
    item.qty.toString(),
    formatARS(item.unitPrice),
    formatARS(item.total),
  ]);

  autoTable(doc, {
    startY: 78,
    head: [["Descripción", "Cant.", "Precio unit.", "Total"]],
    body: rows,
    theme: "striped",
    headStyles: { fillColor: [26, 26, 46], textColor: [212, 168, 67], fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 95 }, 1: { cellWidth: 15, halign: "center" }, 2: { cellWidth: 35, halign: "right" }, 3: { cellWidth: 35, halign: "right" } },
    styles: { fontSize: 9 },
  });

  const finalY = doc.lastAutoTable.finalY + 6;
  const RIGHT = PW - 15;
  const COL = PW - 70;

  doc.setFontSize(9);
  if (quote.discount_amount > 0) {
    doc.text("Subtotal:", COL, finalY, { align: "right" });
    doc.text(formatARS(quote.subtotal), RIGHT, finalY, { align: "right" });
    doc.text("Descuento:", COL, finalY + 6, { align: "right" });
    doc.setTextColor(180, 40, 40);
    doc.text(`-${formatARS(quote.discount_amount)}`, RIGHT, finalY + 6, { align: "right" });
    doc.setTextColor(30, 30, 30);
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("TOTAL:", COL, finalY + (quote.discount_amount > 0 ? 14 : 6), { align: "right" });
  doc.text(formatARS(quote.total), RIGHT, finalY + (quote.discount_amount > 0 ? 14 : 6), { align: "right" });

  if (quote.notes) {
    const notesY = finalY + 28;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text("Notas:", 15, notesY);
    const lines = doc.splitTextToSize(quote.notes, PW - 30);
    doc.text(lines, 15, notesY + 5);
  }

  // Sello «Hecho con Nerqia» (TESIS §5); no va con marca propia vigente.
  const sello = orgId ? await selloHechoConNerqia(orgId) : null;
  if (sello) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(160, 160, 160);
    doc.text(sello, PW / 2, PH - 8, { align: "center" });
  }

  doc.save(`presupuesto_${quote.quote_number}.pdf`);
}

async function generateRemito(quote: Quote, orgName: string) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW = 210;

  doc.setFillColor(20, 83, 45);
  doc.rect(0, 0, PW, 35, "F");
  doc.setTextColor(134, 239, 172);
  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  doc.text(orgName, 15, 15);
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(12);
  doc.text("REMITO DE ENTREGA", 15, 25);
  doc.setFontSize(10);
  doc.text(`Ref: ${quote.quote_number}`, PW - 15, 15, { align: "right" });
  doc.setFontSize(9);
  doc.text(`Fecha: ${new Date().toLocaleDateString("es-AR")}`, PW - 15, 22, { align: "right" });

  doc.setTextColor(30, 30, 30);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("ENTREGAR A:", 15, 50);
  doc.setFont("helvetica", "normal");
  doc.text(quote.customer_name, 15, 57);
  if (quote.customer_phone) doc.text(quote.customer_phone, 15, 63);

  const rows = quote.items.map(item => [
    item.qty.toString(),
    item.description,
    "□ Recibido",
  ]);

  autoTable(doc, {
    startY: 73,
    head: [["Cant.", "Descripción", "Confirmación"]],
    body: rows,
    theme: "striped",
    headStyles: { fillColor: [20, 83, 45], textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 15, halign: "center" }, 1: { cellWidth: 130 }, 2: { cellWidth: 35, halign: "center" } },
    styles: { fontSize: 9, cellPadding: 5 },
  });

  const finalY = doc.lastAutoTable.finalY + 20;
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text("Firma recepción: __________________________________", 15, finalY);
  doc.text(`Aclaración: __________________________  DNI: ______________`, 15, finalY + 12);
  doc.text(`Fecha de recepción: ______________`, 15, finalY + 24);

  doc.save(`remito_${quote.quote_number}_${hoyAR()}.pdf`);
}

// ─── Default valid_until (+15 days) ──────────────────────────────────────────
function defaultValidUntil() {
  const d = new Date();
  d.setDate(d.getDate() + 15);
  return d.toISOString().slice(0, 10);
}

export default function PresupuestosPage() {
  usePageTitle("Presupuestos");
  const { activeOrg } = useOrg();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewByCustomer, setViewByCustomer] = useState(false);
  const [quoteSort, setQuoteSort] = useState<{ col: "date" | "total" | "customer"; dir: "asc" | "desc" }>({ col: "date", dir: "desc" });

  // Editor (crear, editar o duplicar): components/presupuestos/EditorDePresupuesto.
  const [editor, setEditor] = useState<{ modo: "nuevo" | "editar" | "duplicar"; inicial: PresupuestoEditable | null } | null>(null);
  const [orgName, setOrgName] = useState("Mi Negocio");
  // Un link de pago por presupuesto (lib/linksDePago): se reutiliza y, al
  // pagarse, registra la venta y lo marca vendido.
  const [payLinks, setPayLinks] = useState<Record<string, string>>({});
  const [payLinkLoading, setPayLinkLoading] = useState<string | null>(null);
  const [emailLoading, setEmailLoading] = useState<string | null>(null);

  const [showBulkReminder, setShowBulkReminder] = useState(false);

  const generatePayLink = async (q: Quote) => {
    if (!activeOrg) return;
    if (payLinks[q.id]) { await copiar(payLinks[q.id], "Link de pago copiado"); return; }
    setPayLinkLoading(q.id);
    try {
      const r = await linkDePagoDePresupuesto(activeOrg.id, q, orgName);
      setPayLinks(prev => ({ ...prev, [q.id]: r.url }));
      await copiar(r.url, r.nuevo ? "Link de pago creado y copiado" : "Link de pago copiado",
        r.conMercadoPago ? "Se puede pagar con Mercado Pago, transferencia o efectivo." : "Sin Mercado Pago conectado: el cliente ve los datos para transferir.");
    } catch (err) {
      toast.error(mensajeDeError(err, "No se pudo generar el link de pago"));
    } finally {
      setPayLinkLoading(null);
    }
  };
  const copiar = async (texto: string, ok: string, detalle?: string) => {
    try { await navigator.clipboard.writeText(texto); toast.success(ok, { description: detalle }); }
    catch { toast.info("Copiá el link", { description: texto, duration: 15000 }); }
  };

  const sendQuoteEmail = async (q: Quote) => {
    if (!q.customer_email) { toast.error("El presupuesto no tiene email de cliente"); return; }
    setEmailLoading(q.id);
    try {
      const { data, error } = await supabase.functions.invoke("send-invoice-email", {
        body: {
          orgId: activeOrg?.id,
          documentType: "quote",
          documentId: q.id,
        },
      });
      if (error || data?.error) throw new Error(await mensajeDeEdgeFunction(error, data));
      toast.success(`Presupuesto enviado a ${q.customer_email}`);
      if (q.status === "draft") updateStatus(q.id, "sent");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo enviar el presupuesto");
    } finally {
      setEmailLoading(null);
    }
  };

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data } = await supabase
      .from("quotes")
      .select("*")
      .eq("org_id", activeOrg.id)
      .order("created_at", { ascending: false });
    setQuotes((data as unknown as Quote[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    if (activeOrg) {
      supabase.from("organizations").select("name").eq("id", activeOrg.id).maybeSingle()
        .then(({ data }) => { if (data?.name) setOrgName(data.name); });
    }
  }, [activeOrg]);

  const updateStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("quotes").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success(`Estado actualizado: ${STATUS_CONFIG[status]?.label}`); load(); }
  };

  // Duplicar abre el editor con lo mismo; se guarda recién al confirmar.
  const duplicar = (q: Quote) => setEditor({ modo: "duplicar", inicial: { ...q, id: undefined, quote_number: undefined } });
  const editar = (q: Quote) => setEditor({ modo: "editar", inicial: q });

  // Convertir en venta = cobrarlo en la caja: stock, caja, factura y topes de
  // descuento como cualquier venta, y la base lo marca vendido una sola vez.
  const convertirEnCaja = (q: Quote) => navigate(`/caja?presupuesto=${q.id}`);

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("quotes").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Presupuesto eliminado"); load(); }
  };

  const copyWhatsApp = (q: Quote) => {
    const lines = [
      `*Presupuesto ${q.quote_number}*`,
      `Cliente: ${q.customer_name}`,
      `Fecha: ${new Date(q.created_at).toLocaleDateString("es-AR")}`,
      q.valid_until ? `Válido hasta: ${new Date(q.valid_until).toLocaleDateString("es-AR")}` : "",
      "",
      "*Ítems:*",
      ...q.items.map(it => `• ${it.description} × ${it.qty} = ${formatARS(it.total)}`),
      "",
      q.discount_amount > 0 ? `Descuento: -${formatARS(q.discount_amount)}` : "",
      `*TOTAL: ${formatARS(q.total)}*`,
      q.notes ? `\nNotas: ${q.notes}` : "",
    ].filter(l => l !== null && l !== undefined);
    navigator.clipboard.writeText(lines.join("\n"));
    toast.success("Copiado para WhatsApp");
  };

  const now30 = new Date(); now30.setDate(now30.getDate() - 30);
  const expiredQuotes = quotes.filter(q =>
    (q.status === "draft" || q.status === "sent") &&
    new Date(q.created_at) < now30
  );

  const filtered = (() => {
    const base = quotes.filter(q => {
      let matchStatus: boolean;
      if (filterStatus === "all") matchStatus = true;
      else if (filterStatus === "expired_pending") matchStatus = expiredQuotes.some(e => e.id === q.id);
      else matchStatus = q.status === filterStatus;
      const matchSearch = q.customer_name.toLowerCase().includes(search.toLowerCase()) ||
        q.quote_number.toLowerCase().includes(search.toLowerCase());
      return matchStatus && matchSearch;
    });
    return [...base].sort((a, b) => {
      let cmp = 0;
      if (quoteSort.col === "date") cmp = a.created_at.localeCompare(b.created_at);
      else if (quoteSort.col === "total") cmp = a.total - b.total;
      else if (quoteSort.col === "customer") cmp = a.customer_name.localeCompare(b.customer_name);
      return quoteSort.dir === "asc" ? cmp : -cmp;
    });
  })();

  const stats = {
    total: quotes.length,
    accepted: quotes.filter(q => q.status === "accepted").length,
    // Lo efectivamente vendido (cobrado en la caja o por link), no lo «aceptado».
    totalValue: quotes.filter(q => q.converted_at).reduce((s, q) => s + q.total, 0),
    pending: quotes.filter(q => q.status === "sent").length,
    expired: expiredQuotes.length,
    conversionRate: quotes.length > 0
      ? Math.round(quotes.filter(q => q.status === "accepted").length / quotes.length * 100)
      : 0,
  };

  return (
    <div className="space-y-5 pb-12">
      <PageHeader
        icon={FileText}
        eyebrow="Commerce · Ventas"
        title="Presupuestos"
        description={`${quotes.length} presupuestos · ${stats.accepted} aceptados · ${stats.conversionRate}% conversión a pedido`}
        badge={
          stats.pending > 0
            ? { label: `${stats.pending} en espera`, variant: "warning" }
            : stats.accepted > 0
            ? { label: `${stats.accepted} aceptados`, variant: "success" }
            : undefined
        }
        actions={
          <Button className="h-9" onClick={() => setEditor({ modo: "nuevo", inicial: null })}>
            <Plus className="w-4 h-4 mr-2" /> Nuevo presupuesto
          </Button>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <KPICard label="Total generados" value={stats.total} icon={FileText} color="primary" />
        <KPICard label="Aceptados" value={stats.accepted} icon={CheckCircle2} color="success"
          sub={stats.total > 0 ? `${stats.conversionRate}% conversión` : undefined} />
        <KPICard label="En espera" value={stats.pending} icon={Clock}
          color={stats.pending > 0 ? "warning" : "primary"} sub="enviados al cliente" />
        <KPICard label="Vendido" value={formatARS(stats.totalValue)} icon={DollarSign} color="success" sub="presupuestos cobrados" />
      </div>

      {/* Expired / pending sent banner */}
      {(stats.expired > 0 || stats.pending > 0) && (
        <div className="bg-orange-500/5 border border-orange-500/30 rounded-xl p-3 flex items-center gap-3">
          <Clock className="w-4 h-4 text-orange-400 shrink-0" />
          <p className="text-sm text-orange-400 flex-1">
            {stats.expired > 0 && (
              <><span className="font-semibold">{stats.expired} presupuesto{stats.expired !== 1 ? "s" : ""}</span> sin respuesta +30 días. </>
            )}
            {stats.pending > 0 && (
              <><span className="font-semibold">{stats.pending} enviado{stats.pending !== 1 ? "s" : ""}</span> esperando respuesta.</>
            )}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            {stats.expired > 0 && (
              <button
                className="text-xs px-3 py-1.5 rounded-lg border border-orange-500/40 text-orange-400 hover:bg-orange-500/10 transition-colors"
                onClick={() => setFilterStatus("expired_pending")}
              >
                Ver +30d ({stats.expired})
              </button>
            )}
            <button
              className="text-xs px-3 py-1.5 rounded-lg border border-green-500/40 text-green-400 hover:bg-green-500/10 transition-colors flex items-center gap-1"
              onClick={() => setShowBulkReminder(v => !v)}
            >
              <Send className="w-3 h-3" />Recordatorio masivo
            </button>
          </div>
        </div>
      )}

      {/* Bulk WhatsApp reminder panel */}
      {showBulkReminder && (() => {
        const sentQuotes = quotes.filter(q => q.status === "sent");
        const daysAgo = (dateStr: string) => Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
        return (
          <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-green-400 flex items-center gap-2">
                <Send className="w-4 h-4" />Recordatorio masivo por WhatsApp
                <span className="text-xs font-normal text-muted-foreground">({sentQuotes.length} presupuestos enviados)</span>
              </h3>
              <button onClick={() => setShowBulkReminder(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
            </div>
            {sentQuotes.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No hay presupuestos en estado "Enviado".</p>
            ) : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                {sentQuotes.map(q => {
                  const days = daysAgo(q.created_at);
                  const phone = (q.customer_phone || "").replace(/[^0-9]/g, "");
                  const msg = encodeURIComponent(
                    `Hola ${q.customer_name.split(" ")[0]}! Te escribo para hacer seguimiento del presupuesto *${q.quote_number}* que te enviamos hace ${days} día${days !== 1 ? "s" : ""} por *${formatARS(q.total)}*.\n¿Tuviste oportunidad de revisarlo? Quedamos a disposición para cualquier consulta. 😊`
                  );
                  return (
                    <div key={q.id} className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2 border border-border/40">
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{q.customer_name} · #{q.quote_number}</p>
                        <p className="text-[10px] text-muted-foreground">{formatARS(q.total)} · hace {days} días</p>
                      </div>
                      {phone ? (
                        <a
                          href={`https://wa.me/${phone}?text=${msg}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] px-2.5 py-1 rounded-lg bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/25 transition-colors shrink-0 font-medium"
                        >
                          WhatsApp
                        </a>
                      ) : (
                        <span className="text-[10px] text-muted-foreground shrink-0">Sin teléfono</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar cliente o número…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
        </div>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-36 h-9 text-xs">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v.label}</SelectItem>
            ))}
            <SelectItem value="expired_pending">⚠ Sin respuesta +30d</SelectItem>
          </SelectContent>
        </Select>
        <button
          onClick={() => setViewByCustomer(v => !v)}
          className={`flex items-center gap-1.5 px-3 h-9 rounded-lg border text-xs font-medium transition-all shrink-0 ${viewByCustomer ? 'bg-primary/20 border-primary/40 text-primary' : 'bg-muted border-border text-muted-foreground hover:text-foreground'}`}
          title="Agrupar por cliente"
        >
          Por cliente
        </button>
        {/* Sort buttons */}
        <div className="flex items-center gap-1 shrink-0">
          <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />
          {(["date", "total", "customer"] as const).map(col => {
            const labels: Record<string, string> = { date: "Fecha", total: "Monto", customer: "Cliente" };
            const active = quoteSort.col === col;
            return (
              <button key={col} onClick={() => setQuoteSort(s => s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: col === "date" ? "desc" : "asc" })}
                className={`text-xs px-2 py-1.5 rounded-md border transition-colors flex items-center gap-0.5 ${active ? "bg-primary/20 border-primary/40 text-primary" : "bg-muted border-border text-muted-foreground hover:text-foreground"}`}>
                {labels[col]}
                {active && (quoteSort.dir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
              </button>
            );
          })}
        </div>
        <Button variant="outline" size="sm" className="h-9" onClick={() => {
          const bom = '﻿';
          const headers = ['Número', 'Cliente', 'Email', 'Teléfono', 'Total ARS', 'Estado', 'Válido hasta', 'Fecha creación', 'Notas'];
          const rows = filtered.map(q => [
            q.quote_number,
            q.customer_name,
            q.customer_email || '',
            q.customer_phone || '',
            Number(q.total).toFixed(2),
            STATUS_CONFIG[q.status]?.label || q.status,
            q.valid_until ? new Date(q.valid_until).toLocaleDateString('es-AR') : '',
            new Date(q.created_at).toLocaleDateString('es-AR'),
            q.notes || '',
          ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
          const csv = bom + [headers.join(','), ...rows].join('\n');
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
          a.download = `presupuestos-${hoyAR()}.csv`;
          a.click();
          toast.success('Presupuestos exportados');
        }}>
          <Download className="w-3.5 h-3.5 mr-1.5" />CSV
        </Button>
      </div>

      {loading ? (
        <div className="space-y-3 pb-12">{[1,2,3].map(i => <div key={i} className="h-20 bg-muted/30 rounded-xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <FileText className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground">{search || filterStatus !== "all" ? "Sin resultados." : "Aún no hay presupuestos."}</p>
        </div>
      ) : viewByCustomer ? (
        <div className="space-y-3 pb-12">
          {(() => {
            const byCustomer: Record<string, { total: number; accepted: number; pending: number; quotes: typeof filtered }> = {};
            filtered.forEach(q => {
              const key = q.customer_name || '(Sin cliente)';
              if (!byCustomer[key]) byCustomer[key] = { total: 0, accepted: 0, pending: 0, quotes: [] };
              byCustomer[key].total += Number(q.total);
              if (q.status === 'accepted') byCustomer[key].accepted++;
              else if (q.status === 'sent' || q.status === 'draft') byCustomer[key].pending++;
              byCustomer[key].quotes.push(q);
            });
            return Object.entries(byCustomer)
              .sort(([, a], [, b]) => b.total - a.total)
              .map(([customer, data]) => (
                <div key={customer} className="bg-card border border-border rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/20">
                    <div>
                      <span className="font-semibold text-sm">{customer}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{data.quotes.length} presupuesto{data.quotes.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      {data.accepted > 0 && <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">{data.accepted} aceptado{data.accepted !== 1 ? 's' : ''}</span>}
                      {data.pending > 0 && <span className="text-[10px] font-semibold text-yellow-400 bg-yellow-500/10 px-1.5 py-0.5 rounded">{data.pending} pendiente{data.pending !== 1 ? 's' : ''}</span>}
                      <span className="font-bold text-sm text-primary">{formatARS(data.total)}</span>
                    </div>
                  </div>
                  <div className="divide-y divide-border">
                    {data.quotes.map(q => {
                      const cfg = STATUS_CONFIG[q.status] || { label: q.status, color: 'bg-muted text-muted-foreground' };
                      return (
                        <div key={q.id} className="flex items-center gap-3 px-4 py-2.5">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${cfg.color}`}>{cfg.label}</span>
                          <span className="text-xs text-muted-foreground">#{q.quote_number}</span>
                          <span className="text-xs text-muted-foreground flex-1">{q.valid_until ? `Válido hasta ${new Date(q.valid_until).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}` : ''}</span>
                          <span className="font-semibold text-sm">{formatARS(Number(q.total))}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ));
          })()}
        </div>
      ) : (
        <div className="space-y-2 pb-12">
          {filtered.map(q => {
            const today = hoyAR();
            const daysUntilExpiry = q.valid_until
              ? Math.ceil((new Date(q.valid_until).getTime() - new Date(today).getTime()) / 86400000)
              : null;
            const isExpiringSoon = daysUntilExpiry !== null && daysUntilExpiry >= 0 && daysUntilExpiry <= 3
              && q.status !== "accepted" && q.status !== "rejected";
            const isExpired = daysUntilExpiry !== null && daysUntilExpiry < 0
              && q.status !== "accepted" && q.status !== "rejected";
            return (
            <div key={q.id} className={`bg-card border rounded-[10px] overflow-hidden shadow-card ${isExpiringSoon ? "border-yellow-500/40" : isExpired ? "border-destructive/30" : "border-border/60"}`}>
              <div className="px-4 py-3.5 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground font-mono">{q.quote_number}</span>
                    <StatusBadge status={q.status} />
                    {isExpiringSoon && (
                      <span className="text-[10px] font-semibold text-yellow-400 bg-yellow-500/10 rounded-full px-2 py-0.5">
                        Vence en {daysUntilExpiry === 0 ? "hoy" : `${daysUntilExpiry}d`}
                      </span>
                    )}
                    {isExpired && (
                      <span className="text-[10px] font-semibold text-destructive bg-destructive/10 rounded-full px-2 py-0.5">
                        Vencido hace {Math.abs(daysUntilExpiry!)}d
                      </span>
                    )}
                  </div>
                  <p className="font-semibold text-sm mt-0.5">{q.customer_name}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-xs text-muted-foreground">{new Date(q.created_at).toLocaleDateString("es-AR")}</span>
                    {q.valid_until && <span className="text-xs text-muted-foreground">válido hasta {new Date(q.valid_until).toLocaleDateString("es-AR")}</span>}
                    <span className="text-sm font-bold text-primary">{formatARS(q.total)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setExpandedId(expandedId === q.id ? null : q.id)}
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
                  >
                    {expandedId === q.id ? <ChevronUp className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                  <button onClick={() => generatePDF(q, orgName, activeOrg?.id)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors" title="Descargar PDF presupuesto">
                    <Download className="w-4 h-4" />
                  </button>
                  <button onClick={() => generateRemito(q, orgName)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors" title="Remito de entrega">
                    <FileText className="w-4 h-4" />
                  </button>
                  {q.customer_email && (
                    <button
                      onClick={() => sendQuoteEmail(q)}
                      disabled={emailLoading === q.id}
                      className="p-1.5 rounded-lg hover:bg-blue-500/10 text-muted-foreground hover:text-blue-400 transition-colors disabled:opacity-50"
                      title={`Enviar por email a ${q.customer_email}`}
                    >
                      {emailLoading === q.id
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <Mail className="w-4 h-4" />}
                    </button>
                  )}
                  <button onClick={() => copyWhatsApp(q)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors" title="Copiar para WhatsApp">
                    <Copy className="w-4 h-4" />
                  </button>
                  {!q.converted_at && (
                    <button onClick={() => editar(q)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors" title="Editar presupuesto" aria-label={`Editar ${q.quote_number}`}>
                      <Pencil className="w-4 h-4" />
                    </button>
                  )}
                  <button onClick={() => duplicar(q)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors" title="Duplicar presupuesto" aria-label={`Duplicar ${q.quote_number}`}>
                    <CopyPlus className="w-4 h-4" />
                  </button>
                  <ConfirmDialog
                    title="Eliminar presupuesto"
                    description="Esta acción no se puede deshacer."
                    onConfirm={() => handleDelete(q.id)}
                    trigger={
                      <button className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    }
                  />
                </div>
              </div>

              {expandedId === q.id && (
                <div className="border-t border-border bg-muted/10 px-4 py-3 space-y-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Ítems</p>
                    <div className="space-y-1 pb-12">
                      {q.items.map((it, i) => (
                        <div key={i} className="flex items-center justify-between text-xs">
                          <span className="flex-1">{it.description}</span>
                          <span className="text-muted-foreground mx-3">×{it.qty}</span>
                          <span className="font-medium">{formatARS(it.total)}</span>
                        </div>
                      ))}
                    </div>
                    {q.discount_amount > 0 && (
                      <div className="flex justify-between text-xs mt-1 text-muted-foreground">
                        <span>Descuento</span>
                        <span>-{formatARS(q.discount_amount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-bold mt-1.5 pt-1.5 border-t border-border/50">
                      <span>Total</span>
                      <span className="text-primary">{formatARS(q.total)}</span>
                    </div>
                  </div>
                  {q.notes && <p className="text-xs text-muted-foreground italic">{q.notes}</p>}
                  <div className="flex flex-wrap gap-2">
                    {q.status === "draft" && (
                      <Button size="sm" className="h-7 text-xs" onClick={() => updateStatus(q.id, "sent")}>
                        <Send className="w-3 h-3 mr-1" /> Marcar enviado
                      </Button>
                    )}
                    {q.status === "sent" && (
                      <>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-emerald-400 border-emerald-500/30" onClick={() => updateStatus(q.id, "accepted")}>
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Aceptado
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-destructive border-destructive/30" onClick={() => updateStatus(q.id, "rejected")}>
                          <XCircle className="w-3 h-3 mr-1" /> Rechazado
                        </Button>
                      </>
                    )}
                    {!q.converted_at && (q.status === "draft" || q.status === "sent" || q.status === "accepted") && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 gap-1"
                        onClick={() => convertirEnCaja(q)}
                        data-testid="presupuesto-cobrar-en-caja"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        Cobrar en la caja
                      </Button>
                    )}
                    {q.converted_at && (
                      <span className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-xs font-medium text-emerald-500 bg-emerald-500/10 border border-emerald-500/20"
                        title={`Vendido el ${new Date(q.converted_at).toLocaleDateString("es-AR")}`}>
                        <CheckCircle2 className="w-3 h-3" /> Vendido
                      </span>
                    )}
                    {!q.converted_at && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      onClick={() => generatePayLink(q)}
                      disabled={payLinkLoading === q.id}
                      data-testid="presupuesto-link-de-pago"
                    >
                      {payLinkLoading === q.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link2 className="w-3 h-3" />}
                      {payLinks[q.id] ? "Copiar link de pago" : "Link de pago"}
                    </Button>
                    )}
                    {q.customer_phone && payLinks[q.id] && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-green-500/40 text-green-400 hover:bg-green-500/10 gap-1"
                        onClick={() => window.open(`https://wa.me/${q.customer_phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Hola ${q.customer_name.split(" ")[0]}! 🛍️ Tu presupuesto ${q.quote_number} por ${formatARS(q.total)}.\n\nPodés pagar con tarjeta, transferencia o efectivo desde este link:\n${payLinks[q.id]}`)}`, "_blank")}
                      >
                        <Send className="w-3 h-3" />Enviar
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      {editor && activeOrg && user && (
        <EditorDePresupuesto
          open={!!editor}
          onOpenChange={v => { if (!v) setEditor(null); }}
          orgId={activeOrg.id}
          userId={user.id}
          modo={editor.modo}
          inicial={editor.inicial}
          onGuardado={(fila, { enviarPorCorreo }) => {
            load();
            if (enviarPorCorreo) void sendQuoteEmail(fila as unknown as Quote);
          }}
        />
      )}
    </div>
  );
}
