import { useState, useEffect } from "react";
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
} from "lucide-react";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import { formatARS, addSaleDB } from "@/lib/supabaseStore";

type QuoteItem = { description: string; qty: number; unitPrice: number; total: number };
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
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  draft:    { label: "Borrador",  color: "text-muted-foreground bg-muted/30 border-border" },
  sent:     { label: "Enviado",   color: "text-blue-400 bg-blue-500/10 border-blue-500/20" },
  accepted: { label: "Aceptado", color: "text-success bg-success/10 border-success/20" },
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

async function generatePDF(quote: Quote, orgName: string) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const PW = 210, PH = 297;

  // Header band
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

  // Customer info
  doc.setTextColor(30, 30, 30);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text("PARA:", 15, 50);
  doc.setFont("helvetica", "normal");
  doc.text(quote.customer_name, 15, 57);
  if (quote.customer_email) doc.text(quote.customer_email, 15, 63);
  if (quote.customer_phone) doc.text(quote.customer_phone, 15, 69);

  // Items table
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

  const finalY = (doc as any).lastAutoTable.finalY + 6;
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

  doc.save(`presupuesto_${quote.quote_number}.pdf`);
}

export default function PresupuestosPage() {
  const { activeOrg } = useOrg();
  const { user } = useAuth();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Form state
  const [custName, setCustName] = useState("");
  const [custEmail, setCustEmail] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [items, setItems] = useState<QuoteItem[]>([{ description: "", qty: 1, unitPrice: 0, total: 0 }]);
  const [discountAmount, setDiscountAmount] = useState("0");
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [orgName, setOrgName] = useState("Mi Negocio");
  const [mpLinks, setMpLinks] = useState<Record<string, string>>({});
  const [mpLoading, setMpLoading] = useState<string | null>(null);

  const generateMpLink = async (q: Quote) => {
    if (mpLinks[q.id]) { navigator.clipboard.writeText(mpLinks[q.id]); toast.success("Link copiado"); return; }
    setMpLoading(q.id);
    const { data, error } = await supabase.functions.invoke("mercadopago-link", {
      body: { orgId: activeOrg?.id, title: `Presupuesto ${q.quote_number} — ${q.customer_name}`, total: q.total },
    });
    setMpLoading(null);
    if (error || data?.error) { toast.error(data?.error || "Error al generar link MP"); return; }
    setMpLinks(prev => ({ ...prev, [q.id]: data.url }));
    navigator.clipboard.writeText(data.url);
    toast.success("Link de pago MercadoPago copiado");
  };

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data } = await supabase
      .from("quotes")
      .select("*")
      .eq("org_id", activeOrg.id)
      .order("created_at", { ascending: false });
    setQuotes((data as Quote[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    if (activeOrg) {
      supabase.from("organizations").select("name").eq("id", activeOrg.id).maybeSingle()
        .then(({ data }) => { if (data?.name) setOrgName(data.name); });
    }
  }, [activeOrg]);

  const updateItem = (i: number, field: keyof QuoteItem, val: string | number) => {
    setItems(prev => {
      const next = [...prev];
      (next[i] as any)[field] = val;
      next[i].total = Number(next[i].qty) * Number(next[i].unitPrice);
      return next;
    });
  };

  const subtotal = items.reduce((s, it) => s + it.total, 0);
  const total = subtotal - (parseFloat(discountAmount) || 0);

  const resetForm = () => {
    setCustName(""); setCustEmail(""); setCustPhone("");
    setItems([{ description: "", qty: 1, unitPrice: 0, total: 0 }]);
    setDiscountAmount("0"); setValidUntil(""); setNotes("");
  };

  const handleSave = async () => {
    if (!custName.trim() || !activeOrg || !user) return;
    if (items.every(it => !it.description.trim())) {
      toast.error("Agregá al menos un ítem con descripción");
      return;
    }
    setSaving(true);
    try {
      const { data: numData } = await supabase.rpc("next_quote_number", { p_org_id: activeOrg.id });
      const quoteNumber = numData || `PRE-${Date.now()}`;

      const { error } = await supabase.from("quotes").insert({
        org_id: activeOrg.id,
        quote_number: quoteNumber,
        customer_name: custName,
        customer_email: custEmail || null,
        customer_phone: custPhone || null,
        items: items.filter(it => it.description.trim()),
        subtotal,
        discount_amount: parseFloat(discountAmount) || 0,
        total: Math.max(0, total),
        status: "draft",
        valid_until: validUntil || null,
        notes: notes || null,
        created_by: user.id,
      });
      if (error) throw error;
      toast.success(`Presupuesto ${quoteNumber} creado`);
      setOpen(false);
      resetForm();
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("quotes").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success(`Estado actualizado: ${STATUS_CONFIG[status]?.label}`); load(); }
  };

  const [converting, setConverting] = useState<string | null>(null);
  const convertToSale = async (q: Quote) => {
    if (!activeOrg || !user) return;
    if (!confirm(`Registrar venta de ${formatARS(q.total)} para ${q.customer_name}?`)) return;
    setConverting(q.id);
    try {
      const saleId = crypto.randomUUID();
      await addSaleDB({
        id: saleId,
        user_id: user.id,
        org_id: activeOrg.id,
        product_name: q.items.map(it => it.description).join(", ").slice(0, 120),
        quantity: q.items.reduce((s, it) => s + it.qty, 0) || 1,
        unit_price_ars: q.total,
        total_ars: q.total,
        profit_ars: 0,
        profit_usd: 0,
        customer_name: q.customer_name || null,
        date: new Date().toISOString(),
        paid: true,
        payment_method: "transferencia",
        quote_id: q.id,
      });
      await updateStatus(q.id, "accepted");
      toast.success(`Venta de ${formatARS(q.total)} registrada`);
    } catch (e: any) {
      toast.error(e.message || "Error al convertir");
    } finally {
      setConverting(null);
    }
  };

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

  const filtered = quotes.filter(q => {
    const matchStatus = filterStatus === "all" || q.status === filterStatus;
    const matchSearch = q.customer_name.toLowerCase().includes(search.toLowerCase()) ||
      q.quote_number.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  const stats = {
    total: quotes.length,
    accepted: quotes.filter(q => q.status === "accepted").length,
    totalValue: quotes.filter(q => q.status === "accepted").reduce((s, q) => s + q.total, 0),
    pending: quotes.filter(q => q.status === "sent").length,
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2">
            <FileText className="w-6 h-6 text-primary" /> Presupuestos
          </h1>
          <p className="text-muted-foreground text-sm mt-1">{quotes.length} presupuestos · {stats.accepted} aceptados</p>
        </div>
        <Button className="gradient-gold text-primary-foreground shadow-gold h-9" onClick={() => setOpen(true)}>
          <Plus className="w-4 h-4 mr-2" /> Nuevo presupuesto
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-card border border-border rounded-xl p-3.5">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Total generado</p>
          <p className="text-xl font-bold font-display text-primary mt-1">{stats.total}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-3.5">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Aceptados</p>
          <p className="text-xl font-bold font-display text-success mt-1">{stats.accepted}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-3.5">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Valor ganado</p>
          <p className="text-xl font-bold font-display mt-1">{formatARS(stats.totalValue)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
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
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-muted/30 rounded-xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <FileText className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground">{search || filterStatus !== "all" ? "Sin resultados." : "Aún no hay presupuestos."}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(q => (
            <div key={q.id} className="bg-card border border-border rounded-xl overflow-hidden shadow-card">
              <div className="px-4 py-3.5 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground font-mono">{q.quote_number}</span>
                    <StatusBadge status={q.status} />
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
                  <button onClick={() => generatePDF(q, orgName)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors" title="Descargar PDF">
                    <Download className="w-4 h-4" />
                  </button>
                  <button onClick={() => copyWhatsApp(q)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors" title="Copiar para WhatsApp">
                    <Copy className="w-4 h-4" />
                  </button>
                  <ConfirmDialog title="Eliminar presupuesto" description="Esta acción no se puede deshacer." onConfirm={() => handleDelete(q.id)}>
                    <button className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </ConfirmDialog>
                </div>
              </div>

              {expandedId === q.id && (
                <div className="border-t border-border bg-muted/10 px-4 py-3 space-y-3">
                  {/* Items */}
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Ítems</p>
                    <div className="space-y-1">
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
                  {/* Status actions */}
                  <div className="flex flex-wrap gap-2">
                    {q.status === "draft" && (
                      <Button size="sm" className="h-7 text-xs" onClick={() => updateStatus(q.id, "sent")}>
                        <Send className="w-3 h-3 mr-1" /> Marcar enviado
                      </Button>
                    )}
                    {q.status === "sent" && (
                      <>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-success border-success/30" onClick={() => updateStatus(q.id, "accepted")}>
                          <CheckCircle2 className="w-3 h-3 mr-1" /> Aceptado
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-destructive border-destructive/30" onClick={() => updateStatus(q.id, "rejected")}>
                          <XCircle className="w-3 h-3 mr-1" /> Rechazado
                        </Button>
                      </>
                    )}
                    {(q.status === "draft" || q.status === "sent" || q.status === "accepted") && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/10 gap-1"
                        onClick={() => convertToSale(q)}
                        disabled={converting === q.id}
                        title="Convertir en venta registrada"
                      >
                        {converting === q.id
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <CheckCircle2 className="w-3 h-3" />
                        }
                        Convertir en venta
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs border-blue-500/40 text-blue-400 hover:bg-blue-500/10 gap-1"
                      onClick={() => generateMpLink(q)}
                      disabled={mpLoading === q.id}
                      title={mpLinks[q.id] ? "Link generado — click para copiar" : "Generar link de pago MercadoPago"}
                    >
                      {mpLoading === q.id
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <Link2 className="w-3 h-3" />
                      }
                      {mpLinks[q.id] ? "Copiar link MP" : "Link MP"}
                    </Button>
                    {q.customer_phone && mpLinks[q.id] && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-green-500/40 text-green-400 hover:bg-green-500/10 gap-1"
                        onClick={() => window.open(`https://wa.me/${q.customer_phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Hola ${q.customer_name.split(" ")[0]}! Te comparto el link para pagar tu presupuesto ${q.quote_number} (${formatARS(q.total)}): ${mpLinks[q.id]}`)}`, "_blank")}
                      >
                        <Send className="w-3 h-3" />WhatsApp
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuevo presupuesto</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-1">
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Cliente *</label>
                <Input placeholder="Nombre del cliente" value={custName} onChange={e => setCustName(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Email</label>
                <Input type="email" placeholder="cliente@email.com" value={custEmail} onChange={e => setCustEmail(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Teléfono</label>
                <Input placeholder="+54 9 11…" value={custPhone} onChange={e => setCustPhone(e.target.value)} />
              </div>
            </div>

            {/* Items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium text-muted-foreground">Ítems</label>
                <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setItems(p => [...p, { description: "", qty: 1, unitPrice: 0, total: 0 }])}>
                  <Plus className="w-3 h-3 mr-1" /> Ítem
                </Button>
              </div>
              <div className="space-y-2">
                {items.map((it, i) => (
                  <div key={i} className="flex gap-2 items-start">
                    <Input
                      className="flex-1 h-8 text-xs"
                      placeholder="Descripción del ítem…"
                      value={it.description}
                      onChange={e => updateItem(i, "description", e.target.value)}
                    />
                    <Input
                      className="w-14 h-8 text-xs text-center"
                      type="number"
                      min="1"
                      value={it.qty}
                      onChange={e => updateItem(i, "qty", Number(e.target.value))}
                    />
                    <Input
                      className="w-28 h-8 text-xs"
                      type="number"
                      placeholder="Precio"
                      value={it.unitPrice || ""}
                      onChange={e => updateItem(i, "unitPrice", Number(e.target.value))}
                    />
                    <div className="w-24 h-8 flex items-center text-xs text-muted-foreground px-2 bg-muted/30 rounded-md border border-border">
                      {formatARS(it.total)}
                    </div>
                    {items.length > 1 && (
                      <button onClick={() => setItems(p => p.filter((_, j) => j !== i))} className="text-muted-foreground/60 hover:text-destructive mt-2">
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Totals */}
            <div className="flex justify-end gap-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Descuento:</span>
                <Input className="w-28 h-7 text-xs text-right" type="number" min="0" value={discountAmount} onChange={e => setDiscountAmount(e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">Total:</span>
                <span className="font-bold text-primary text-base">{formatARS(Math.max(0, total))}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Válido hasta</label>
                <Input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} className="h-8 text-xs" />
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Notas</label>
              <Textarea placeholder="Condiciones, aclaraciones…" value={notes} onChange={e => setNotes(e.target.value)} className="h-16 resize-none text-xs" />
            </div>

            <Button
              className="w-full gradient-gold text-primary-foreground"
              disabled={!custName.trim() || saving}
              onClick={handleSave}
            >
              {saving ? "Guardando…" : "Crear presupuesto"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
