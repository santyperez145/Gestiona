import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
import { formatARS } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  Receipt, Plus, Trash2, FileDown, CheckCircle2, Clock, XCircle,
  Send, Eye, ChevronDown, ChevronUp, DollarSign, FileText, Mail,
  ShieldCheck, ShieldAlert, Loader2, QrCode, Download,
} from "lucide-react";
import { exportCSV, csvDate, csvARS } from "@/lib/exportCSV";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface InvoiceItem { id?: string; description: string; quantity: number; unit_price: number; total: number }
interface Invoice {
  id: string; number: string; customer_name: string; customer_email: string | null;
  customer_address: string | null; customer_tax_id: string | null;
  issue_date: string; due_date: string | null; status: string; notes: string | null;
  currency: string; subtotal: number; tax_pct: number; tax_amount: number; total: number;
  paid_at: string | null; created_at: string;
  invoice_items?: InvoiceItem[];
  // AFIP fields
  tipo_comprobante: number | null;
  cae: string | null;
  cae_vencimiento: string | null;
  afip_status: string | null;
  afip_error: string | null;
  numero_afip: number | null;
}

interface AfipSettings {
  afip_cuit: string | null;
  afip_razon_social: string | null;
  afip_domicilio: string | null;
  afip_punto_venta: number | null;
  afip_tipo_emisor: string | null;
  afip_environment: string | null;
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
const TIPO_CBTE: Record<number, string> = { 1: "A", 6: "B", 11: "C" };

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  draft:    { label: "Borrador",  color: "bg-muted text-muted-foreground border-border",              icon: FileText },
  sent:     { label: "Enviada",   color: "bg-blue-500/15 text-blue-400 border-blue-500/20",           icon: Send },
  paid:     { label: "Pagada",    color: "bg-green-500/15 text-green-400 border-green-500/20",        icon: CheckCircle2 },
  overdue:  { label: "Vencida",   color: "bg-red-500/15 text-red-400 border-red-500/20",              icon: XCircle },
  canceled: { label: "Cancelada", color: "bg-muted text-muted-foreground/50 border-border/50",        icon: XCircle },
};

const EMPTY_FORM = {
  customer_name: "", customer_email: "", customer_address: "", customer_tax_id: "",
  due_date: "", notes: "", tax_pct: "21", tipo_comprobante: "",
};

function emptyItem(): InvoiceItem { return { description: "", quantity: 1, unit_price: 0, total: 0 }; }

// ─────────────────────────────────────────────────────────────
// PDF generator — includes AFIP data when authorized
// ─────────────────────────────────────────────────────────────
function generatePDF(inv: Invoice, orgName: string, afipSettings?: AfipSettings | null) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const tipoCbte = inv.tipo_comprobante ? TIPO_CBTE[inv.tipo_comprobante] : null;

  // ── Header band ──────────────────────────────────────────
  doc.setFillColor(26, 26, 46);
  doc.rect(0, 0, W, 80, "F");
  doc.setTextColor(212, 168, 67);
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.text((afipSettings?.afip_razon_social || orgName).toUpperCase(), 40, 38);
  doc.setFontSize(11);
  doc.setTextColor(200, 200, 220);
  doc.text(tipoCbte ? `FACTURA ${tipoCbte}` : "FACTURA / COMPROBANTE", 40, 58);
  if (afipSettings?.afip_cuit) {
    doc.setFontSize(9);
    doc.setTextColor(160, 160, 190);
    doc.text(`CUIT: ${afipSettings.afip_cuit}`, 40, 72);
  }
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text(`N° ${inv.number}`, W - 40, 38, { align: "right" });
  doc.setFontSize(10);
  doc.setTextColor(180, 180, 200);
  doc.text(`Fecha: ${new Date(inv.issue_date).toLocaleDateString("es-AR")}`, W - 40, 56, { align: "right" });
  if (inv.numero_afip && tipoCbte) {
    doc.setFontSize(9);
    doc.text(`Comprobante ${tipoCbte} Nro ${String(inv.numero_afip).padStart(8, "0")}`, W - 40, 72, { align: "right" });
  }

  // ── Punto de venta divider (AFIP layout) ─────────────────
  if (tipoCbte) {
    doc.setFillColor(212, 168, 67);
    doc.rect(W / 2 - 20, 0, 40, 80, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(28);
    doc.setTextColor(26, 26, 46);
    doc.text(tipoCbte, W / 2, 50, { align: "center" });
    if (afipSettings?.afip_punto_venta) {
      doc.setFontSize(8);
      doc.text(`Pto.Vta: ${String(afipSettings.afip_punto_venta).padStart(4, "0")}`, W / 2, 64, { align: "center" });
    }
  }

  // ── Domicilio comercial ───────────────────────────────────
  let yStart = 95;
  if (afipSettings?.afip_domicilio) {
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.setFont("helvetica", "normal");
    doc.text(`Domicilio: ${afipSettings.afip_domicilio}`, 40, yStart);
    yStart += 12;
  }

  // ── Customer box ──────────────────────────────────────────
  doc.setTextColor(50, 50, 50);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("CLIENTE", 40, yStart + 10);
  doc.setFont("helvetica", "normal");
  doc.text(inv.customer_name, 40, yStart + 23);
  let cy = yStart + 23;
  if (inv.customer_tax_id) { cy += 12; doc.text(`CUIT/DNI: ${inv.customer_tax_id}`, 40, cy); }
  if (inv.customer_email) { cy += 12; doc.text(inv.customer_email, 40, cy); }
  if (inv.customer_address) { cy += 12; doc.text(inv.customer_address, 40, cy); }

  if (inv.due_date) {
    doc.setFont("helvetica", "bold");
    doc.text("VENCIMIENTO", W / 2, yStart + 10);
    doc.setFont("helvetica", "normal");
    doc.text(new Date(inv.due_date).toLocaleDateString("es-AR"), W / 2, yStart + 23);
  }

  // ── Items table ───────────────────────────────────────────
  const items = inv.invoice_items || [];
  const tableY = Math.max(cy + 18, yStart + 60);
  autoTable(doc, {
    startY: tableY,
    head: [["Descripción", "Cant.", "Precio unit.", "Total"]],
    body: items.map((it) => [
      it.description,
      String(it.quantity),
      formatARS(it.unit_price),
      formatARS(it.total),
    ]),
    theme: "grid",
    headStyles: { fillColor: [26, 26, 46], textColor: [212, 168, 67], fontStyle: "bold", fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 5 },
    columnStyles: { 0: { cellWidth: "auto" }, 1: { cellWidth: 45, halign: "right" }, 2: { cellWidth: 90, halign: "right" }, 3: { cellWidth: 90, halign: "right" } },
  });

  let y = (doc as any).lastAutoTable.finalY + 16;
  const right = W - 40;

  // ── Totals ────────────────────────────────────────────────
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.setFont("helvetica", "normal");
  doc.text(`Subtotal: ${formatARS(inv.subtotal)}`, W / 2 + 8, y + 9);
  doc.text(formatARS(inv.subtotal), right, y + 9, { align: "right" });
  y += 20;
  if (inv.tax_pct > 0) {
    doc.text(`IVA (${inv.tax_pct}%):`, W / 2 + 8, y + 9);
    doc.text(formatARS(inv.tax_amount), right, y + 9, { align: "right" });
    y += 20;
  }
  doc.setFillColor(212, 168, 67);
  doc.rect(W / 2, y - 2, W / 2 - 40, 20, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(26, 26, 46);
  doc.text("TOTAL:", W / 2 + 8, y + 13);
  doc.text(formatARS(inv.total), right, y + 13, { align: "right" });
  y += 28;

  // ── Notes ─────────────────────────────────────────────────
  if (inv.notes) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(`Notas: ${inv.notes}`, 40, y + 10);
    y += 20;
  }

  // ── CAE block ─────────────────────────────────────────────
  if (inv.cae && inv.cae_vencimiento) {
    y += 10;
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.5);
    doc.line(40, y, W - 40, y);
    y += 14;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    doc.text("CAE:", 40, y);
    doc.setFont("helvetica", "normal");
    doc.text(inv.cae, 80, y);

    doc.setFont("helvetica", "bold");
    doc.text("Vto. CAE:", W / 2, y);
    doc.setFont("helvetica", "normal");
    doc.text(new Date(inv.cae_vencimiento).toLocaleDateString("es-AR"), W / 2 + 60, y);
    y += 16;

    // ── AFIP QR code (text-based — real QR requires a library) ──
    // AFIP QR payload per RG 4291/2018
    const qrData = {
      ver: 1,
      fecha: inv.issue_date,
      cuit: parseInt((afipSettings?.afip_cuit || "0").replace(/[-\s]/g, "")),
      ptoVta: afipSettings?.afip_punto_venta || 1,
      tipoCmp: inv.tipo_comprobante || 11,
      nroCmp: inv.numero_afip || 0,
      importe: Number(inv.total),
      moneda: "PES",
      ctz: 1,
      tipoDocRec: inv.customer_tax_id ? (inv.customer_tax_id.replace(/[-\s]/g, "").length === 11 ? 80 : 96) : 99,
      nroDocRec: inv.customer_tax_id ? parseInt(inv.customer_tax_id.replace(/[-\s]/g, "")) : 0,
      tipoCodAut: "E",
      codAut: parseInt(inv.cae),
    };
    const qrUrl = `https://www.afip.gob.ar/fe/qr/?p=${btoa(JSON.stringify(qrData))}`;
    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    doc.text("Verificá en AFIP:", 40, y);
    y += 10;
    doc.setTextColor(26, 86, 219);
    doc.text(qrUrl.slice(0, 90), 40, y);
  }

  // ── Footer ────────────────────────────────────────────────
  const fY = doc.internal.pageSize.getHeight() - 24;
  doc.setFontSize(8);
  doc.setTextColor(160, 160, 160);
  doc.setFont("helvetica", "normal");
  const footerText = inv.cae
    ? "Comprobante Electrónico Autorizado — AFIP"
    : "Documento generado automáticamente — Gestiona SaaS";
  doc.text(footerText, W / 2, fY, { align: "center" });

  doc.save(`factura-${inv.number}.pdf`);
  toast.success("PDF generado");
}

// ─────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────
export default function InvoicesPage() {
  const { user } = useAuth();
  const { activeOrg, activeRole } = useOrg();
  const [searchParams, setSearchParams] = useSearchParams();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [items, setItems] = useState<InvoiceItem[]>([emptyItem()]);
  const [saving, setSaving] = useState(false);
  const [sendingEmail, setSendingEmail] = useState<string | null>(null);
  const [authorizingId, setAuthorizingId] = useState<string | null>(null);
  const [afipSettings, setAfipSettings] = useState<AfipSettings | null>(null);
  const fromSaleHandled = useRef(false);

  const canManage = activeRole === "owner" || activeRole === "admin";

  // Pre-fill form when navigated from SalesPage with ?from_sale=...
  useEffect(() => {
    const fromSale = searchParams.get("from_sale");
    const customer = searchParams.get("customer") ?? "";
    const total = searchParams.get("total") ?? "";
    if (fromSale && !fromSaleHandled.current) {
      fromSaleHandled.current = true;
      setForm(f => ({
        ...f,
        customer_name: decodeURIComponent(customer),
        notes: `Factura generada desde venta ID: ${fromSale}`,
      }));
      if (total) {
        setItems([{ ...emptyItem(), description: "Venta", quantity: 1, unit_price: Number(total) }]);
      }
      setShowForm(true);
      // Clean the URL params
      setSearchParams({}, { replace: true });
    }
  }, [searchParams]);

  // Load AFIP org settings
  useEffect(() => {
    if (!activeOrg) return;
    (async () => {
      const { data } = await supabase
        .from("settings" as any)
        .select("afip_cuit,afip_razon_social,afip_domicilio,afip_punto_venta,afip_tipo_emisor,afip_environment")
        .eq("org_id", activeOrg.id)
        .maybeSingle();
      if (data) setAfipSettings(data as AfipSettings);
    })();
  }, [activeOrg]);

  const handleSendEmail = async (inv: Invoice) => {
    if (!inv.customer_email) { toast.error("Esta factura no tiene email del cliente"); return; }
    setSendingEmail(inv.id);
    try {
      const { error } = await supabase.functions.invoke("send-invoice-email", {
        body: {
          to: inv.customer_email,
          subject: `Factura N° ${inv.number} — ${activeOrg?.name || ""}`,
          invoiceNumber: inv.number,
          customerName: inv.customer_name,
          orgName: activeOrg?.name || "",
          totalARS: new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(Number(inv.total)),
          dueDate: inv.due_date,
          notes: inv.notes,
        },
      });
      if (error) throw error;
      toast.success(`Email enviado a ${inv.customer_email}`);
      if (inv.status === "draft") await updateStatus(inv.id, "sent");
    } catch (e: any) {
      toast.error(e.message || "Error al enviar email");
    } finally {
      setSendingEmail(null);
    }
  };

  const handleAuthorizeAfip = async (inv: Invoice) => {
    if (!afipSettings?.afip_cuit) {
      toast.error("Configurá AFIP en Ajustes antes de autorizar facturas");
      return;
    }
    if (inv.cae) { toast.info("Esta factura ya tiene CAE"); return; }

    setAuthorizingId(inv.id);
    try {
      const { data, error } = await supabase.functions.invoke("afip-authorize", {
        body: { invoice_id: inv.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`CAE obtenido: ${data.cae}`);
      load();
    } catch (e: any) {
      // Persist error on invoice
      await supabase.from("invoices").update({ afip_status: "rejected", afip_error: e.message }).eq("id", inv.id);
      toast.error("Error AFIP: " + e.message);
      load();
    } finally {
      setAuthorizingId(null);
    }
  };

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data } = await supabase
      .from("invoices")
      .select("*, invoice_items(*)")
      .eq("org_id", activeOrg.id)
      .order("created_at", { ascending: false });
    setInvoices((data || []) as Invoice[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { load(); }, [load]);

  const recalcItems = (newItems: InvoiceItem[]) =>
    newItems.map((it) => ({ ...it, total: it.quantity * it.unit_price }));

  const subtotal = items.reduce((s, it) => s + it.quantity * it.unit_price, 0);
  const taxAmt = subtotal * (Number(form.tax_pct) / 100);
  const total = subtotal + taxAmt;

  const nextNumber = async () => {
    if (!activeOrg) return "FAC-0001";
    const { data } = await supabase
      .from("invoice_sequences")
      .select("last_number")
      .eq("org_id", activeOrg.id)
      .single();
    const n = (data?.last_number || 0) + 1;
    await supabase.from("invoice_sequences").upsert({ org_id: activeOrg.id, last_number: n });
    return `FAC-${String(n).padStart(4, "0")}`;
  };

  const handleSave = async () => {
    if (!activeOrg || !user) return;
    if (!form.customer_name.trim()) { toast.error("Nombre del cliente requerido"); return; }
    if (items.every((it) => !it.description.trim())) { toast.error("Agregá al menos un ítem"); return; }
    setSaving(true);
    try {
      const number = await nextNumber();
      const tipoCbte = form.tipo_comprobante ? parseInt(form.tipo_comprobante) : null;

      const { data: inv, error } = await supabase.from("invoices").insert({
        org_id: activeOrg.id,
        number,
        customer_name: form.customer_name,
        customer_email: form.customer_email || null,
        customer_address: form.customer_address || null,
        customer_tax_id: form.customer_tax_id || null,
        issue_date: new Date().toISOString().slice(0, 10),
        due_date: form.due_date || null,
        notes: form.notes || null,
        status: "draft",
        currency: "ARS",
        subtotal,
        tax_pct: Number(form.tax_pct),
        tax_amount: taxAmt,
        total,
        created_by: user.id,
        tipo_comprobante: tipoCbte,
        afip_status: tipoCbte ? "pending" : "not_applicable",
      }).select().single();

      if (error) throw error;

      const validItems = items.filter((it) => it.description.trim());
      await supabase.from("invoice_items").insert(
        validItems.map((it) => ({
          invoice_id: inv!.id,
          description: it.description,
          quantity: it.quantity,
          unit_price: it.unit_price,
          total: it.quantity * it.unit_price,
        }))
      );

      toast.success(`Factura ${number} creada`);
      setShowForm(false);
      setForm({ ...EMPTY_FORM });
      setItems([emptyItem()]);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    const extra = status === "paid" ? { paid_at: new Date().toISOString() } : {};
    await supabase.from("invoices").update({ status, ...extra }).eq("id", id);
    load();
  };

  const deleteInvoice = async (id: string) => {
    if (!confirm("¿Eliminar factura?")) return;
    await supabase.from("invoices").delete().eq("id", id);
    toast.success("Factura eliminada");
    load();
  };

  const stats = {
    total: invoices.length,
    paid: invoices.filter((i) => i.status === "paid").reduce((s, i) => s + Number(i.total), 0),
    pending: invoices.filter((i) => i.status === "sent").reduce((s, i) => s + Number(i.total), 0),
    overdue: invoices.filter((i) => i.status === "overdue").length,
  };

  const afipConfigured = !!afipSettings?.afip_cuit;

  // Default tipo_comprobante based on emisor type
  const defaultTipoCbte = afipSettings?.afip_tipo_emisor === "responsable_inscripto" ? "6" : "11";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Receipt className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold">Facturas</h1>
            <p className="text-sm text-muted-foreground">
              Creá y gestioná comprobantes
              {afipConfigured && (
                <span className="ml-2 inline-flex items-center gap-1 text-green-400 text-xs">
                  <ShieldCheck className="w-3 h-3" />AFIP configurado
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline" size="sm"
            disabled={invoices.length === 0}
            onClick={() => exportCSV(
              `facturas-${new Date().toISOString().slice(0, 10)}`,
              ["Número", "Cliente", "Email", "Fecha", "Vencimiento", "Total", "Estado", "CAE"],
              invoices.map(i => [
                i.number, i.customer_name, i.customer_email ?? "",
                csvDate(i.date), csvDate(i.due_date),
                csvARS(i.total), i.status, i.cae ?? "",
              ])
            )}
          >
            <Download className="w-4 h-4 mr-1.5" />CSV
          </Button>
          {canManage && (
            <Button onClick={() => setShowForm(!showForm)} className="gradient-gold text-primary-foreground">
              <Plus className="w-4 h-4 mr-2" />Nueva factura
            </Button>
          )}
        </div>
      </div>

      {/* AFIP not configured warning */}
      {!afipConfigured && canManage && (
        <div className="p-3 rounded-xl border border-yellow-500/20 bg-yellow-500/5 flex items-center gap-2 text-sm text-yellow-400">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>
            AFIP no configurado. Las facturas generadas <strong>no tienen validez fiscal</strong>.
            Configurá tus credenciales en <strong>Ajustes → AFIP</strong>.
          </span>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { l: "Facturas totales", v: stats.total, icon: FileText, color: "" },
          { l: "Cobrado", v: formatARS(stats.paid), icon: CheckCircle2, color: "text-green-400" },
          { l: "Pendiente cobro", v: formatARS(stats.pending), icon: Clock, color: "text-blue-400" },
          { l: "Vencidas", v: stats.overdue, icon: XCircle, color: "text-red-400" },
        ].map((s) => (
          <div key={s.l} className="bg-card border border-border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">{s.l}</span>
              <s.icon className="w-4 h-4 text-primary" />
            </div>
            <div className={`text-xl font-display font-bold ${s.color}`}>{s.v}</div>
          </div>
        ))}
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-card border border-border rounded-2xl p-5 space-y-5">
          <h2 className="font-semibold flex items-center gap-2"><Plus className="w-4 h-4" />Nueva factura</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Cliente *</Label>
              <Input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} placeholder="Nombre o razón social" />
            </div>
            <div>
              <Label className="text-xs">CUIT / DNI</Label>
              <Input value={form.customer_tax_id} onChange={(e) => setForm({ ...form, customer_tax_id: e.target.value })} placeholder="20-12345678-9" />
            </div>
            <div>
              <Label className="text-xs">Email</Label>
              <Input type="email" value={form.customer_email} onChange={(e) => setForm({ ...form, customer_email: e.target.value })} placeholder="cliente@email.com" />
            </div>
            <div>
              <Label className="text-xs">Dirección</Label>
              <Input value={form.customer_address} onChange={(e) => setForm({ ...form, customer_address: e.target.value })} placeholder="Calle 123, CABA" />
            </div>
            <div>
              <Label className="text-xs">Vencimiento</Label>
              <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">IVA %</Label>
              <Input type="number" min={0} max={100} value={form.tax_pct} onChange={(e) => setForm({ ...form, tax_pct: e.target.value })} />
            </div>
            {afipConfigured && (
              <div className="md:col-span-2">
                <Label className="text-xs">Tipo de comprobante AFIP</Label>
                <Select
                  value={form.tipo_comprobante || defaultTipoCbte}
                  onValueChange={(v) => setForm({ ...form, tipo_comprobante: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="11">Factura C (monotributista → cualquier receptor)</SelectItem>
                    <SelectItem value="6">Factura B (R.I. → consumidor final / monotributista)</SelectItem>
                    <SelectItem value="1">Factura A (R.I. → responsable inscripto — requiere CUIT cliente)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Podés autorizar con AFIP después de crear la factura usando el botón de escudo.
                </p>
              </div>
            )}
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs">Ítems</Label>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setItems([...items, emptyItem()])}>
                <Plus className="w-3 h-3 mr-1" />Agregar ítem
              </Button>
            </div>
            <div className="space-y-2">
              <div className="hidden md:grid grid-cols-12 gap-2 text-[10px] text-muted-foreground uppercase px-1">
                <div className="col-span-6">Descripción</div>
                <div className="col-span-2 text-right">Cant.</div>
                <div className="col-span-2 text-right">Precio unit.</div>
                <div className="col-span-2 text-right">Total</div>
              </div>
              {items.map((it, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <Input
                    className="col-span-6 h-8 text-xs"
                    placeholder="Descripción del producto/servicio"
                    value={it.description}
                    onChange={(e) => {
                      const n = [...items]; n[i] = { ...it, description: e.target.value };
                      setItems(recalcItems(n));
                    }}
                  />
                  <Input
                    className="col-span-2 h-8 text-xs text-right"
                    type="number" min={1} step={1}
                    value={it.quantity}
                    onChange={(e) => {
                      const n = [...items]; n[i] = { ...it, quantity: Number(e.target.value) };
                      setItems(recalcItems(n));
                    }}
                  />
                  <Input
                    className="col-span-2 h-8 text-xs text-right"
                    type="number" min={0} step={100}
                    value={it.unit_price}
                    onChange={(e) => {
                      const n = [...items]; n[i] = { ...it, unit_price: Number(e.target.value) };
                      setItems(recalcItems(n));
                    }}
                  />
                  <div className="col-span-1 text-right text-xs font-mono text-muted-foreground">
                    {formatARS(it.quantity * it.unit_price)}
                  </div>
                  <Button size="icon" variant="ghost" className="col-span-1 h-7 w-7" onClick={() => setItems(items.filter((_, j) => j !== i))}>
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="space-y-1 text-sm min-w-[220px]">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-mono">{formatARS(subtotal)}</span>
              </div>
              {Number(form.tax_pct) > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">IVA ({form.tax_pct}%)</span>
                  <span className="font-mono">{formatARS(taxAmt)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-border pt-1 font-bold text-primary">
                <span>Total</span>
                <span className="font-mono">{formatARS(total)}</span>
              </div>
            </div>
          </div>

          <div>
            <Label className="text-xs">Notas</Label>
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Condiciones de pago, observaciones..." />
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} className="gradient-gold text-primary-foreground">
              {saving ? "Guardando..." : "Crear factura"}
            </Button>
          </div>
        </div>
      )}

      {/* Invoice list */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h2 className="font-semibold text-sm">Facturas ({invoices.length})</h2>
        </div>
        {loading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Cargando...</div>
        ) : invoices.length === 0 ? (
          <div className="p-10 text-center">
            <Receipt className="w-10 h-10 mx-auto mb-3 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground">Aún no hay facturas. Creá tu primera.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {invoices.map((inv) => {
              const sc = STATUS_CONFIG[inv.status] || STATUS_CONFIG.draft;
              const Icon = sc.icon;
              const isOpen = expanded === inv.id;
              const tipoCbte = inv.tipo_comprobante ? TIPO_CBTE[inv.tipo_comprobante] : null;
              const isAuthorizing = authorizingId === inv.id;

              return (
                <div key={inv.id}>
                  <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-muted/20 transition-colors">
                    <button className="flex-1 flex items-center gap-3 min-w-0 text-left" onClick={() => setExpanded(isOpen ? null : inv.id)}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-semibold">{inv.number}</span>
                          {tipoCbte && (
                            <span className="inline-flex items-center px-1.5 py-0 rounded text-[10px] font-bold border border-primary/30 text-primary bg-primary/5">
                              F{tipoCbte}
                            </span>
                          )}
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${sc.color}`}>
                            <Icon className="w-3 h-3" />{sc.label}
                          </span>
                          {/* AFIP status badge */}
                          {inv.afip_status === "authorized" && inv.cae && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                              <ShieldCheck className="w-3 h-3" />CAE
                            </span>
                          )}
                          {inv.afip_status === "rejected" && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20">
                              <ShieldAlert className="w-3 h-3" />Rechazada AFIP
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{inv.customer_name}</p>
                        <p className="text-xs text-muted-foreground/60">{new Date(inv.issue_date).toLocaleDateString("es-AR")}</p>
                      </div>
                    </button>
                    <div className="text-right shrink-0">
                      <div className="font-semibold font-mono text-sm">{formatARS(Number(inv.total))}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="icon" variant="ghost" className="h-8 w-8" title="Descargar PDF"
                        onClick={() => generatePDF({ ...inv, invoice_items: inv.invoice_items || [] }, activeOrg?.name || "Gestiona", afipSettings)}
                      >
                        <FileDown className="w-4 h-4" />
                      </Button>
                      {inv.customer_email && (
                        <Button size="icon" variant="ghost" className="h-8 w-8" title={`Enviar por email a ${inv.customer_email}`}
                          onClick={() => handleSendEmail(inv)} disabled={sendingEmail === inv.id}
                        >
                          {sendingEmail === inv.id
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Mail className="w-4 h-4 text-blue-400" />
                          }
                        </Button>
                      )}
                      {/* AFIP authorize button */}
                      {canManage && afipConfigured && inv.tipo_comprobante && !inv.cae && inv.afip_status !== "authorized" && (
                        <Button
                          size="icon" variant="ghost" className="h-8 w-8"
                          title="Autorizar con AFIP (obtener CAE)"
                          onClick={() => handleAuthorizeAfip(inv)}
                          disabled={isAuthorizing}
                        >
                          {isAuthorizing
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <ShieldCheck className="w-4 h-4 text-green-400" />
                          }
                        </Button>
                      )}
                      {canManage && inv.status === "draft" && (
                        <Button size="icon" variant="ghost" className="h-8 w-8" title="Marcar como enviada"
                          onClick={() => updateStatus(inv.id, "sent")}
                        >
                          <Send className="w-4 h-4 text-blue-400" />
                        </Button>
                      )}
                      {canManage && inv.status === "sent" && (
                        <Button size="icon" variant="ghost" className="h-8 w-8" title="Marcar como pagada"
                          onClick={() => updateStatus(inv.id, "paid")}
                        >
                          <CheckCircle2 className="w-4 h-4 text-green-400" />
                        </Button>
                      )}
                      {canManage && (
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => deleteInvoice(inv.id)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      )}
                      {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-t border-border bg-muted/10 px-5 py-4 space-y-3">
                      {inv.customer_email && <p className="text-xs text-muted-foreground">Email: {inv.customer_email}</p>}
                      {inv.customer_tax_id && <p className="text-xs text-muted-foreground">CUIT/DNI: {inv.customer_tax_id}</p>}
                      {inv.due_date && <p className="text-xs text-muted-foreground">Vence: {new Date(inv.due_date).toLocaleDateString("es-AR")}</p>}

                      {/* CAE info */}
                      {inv.cae && (
                        <div className="p-3 rounded-lg bg-green-500/5 border border-green-500/20 space-y-1">
                          <p className="text-xs font-semibold text-green-400 flex items-center gap-1">
                            <ShieldCheck className="w-3.5 h-3.5" />Autorizada por AFIP
                          </p>
                          <p className="text-xs text-muted-foreground font-mono">CAE: {inv.cae}</p>
                          {inv.cae_vencimiento && (
                            <p className="text-xs text-muted-foreground">Vto. CAE: {new Date(inv.cae_vencimiento).toLocaleDateString("es-AR")}</p>
                          )}
                          {inv.numero_afip && tipoCbte && (
                            <p className="text-xs text-muted-foreground">
                              Comprobante F{tipoCbte} Nro {String(inv.numero_afip).padStart(8, "0")}
                            </p>
                          )}
                        </div>
                      )}
                      {inv.afip_status === "rejected" && inv.afip_error && (
                        <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                          <p className="text-xs font-semibold text-red-400 flex items-center gap-1 mb-1">
                            <ShieldAlert className="w-3.5 h-3.5" />Error AFIP
                          </p>
                          <p className="text-xs text-muted-foreground">{inv.afip_error}</p>
                        </div>
                      )}

                      {inv.invoice_items && inv.invoice_items.length > 0 && (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-muted-foreground uppercase tracking-wide border-b border-border">
                              <th className="text-left py-1">Descripción</th>
                              <th className="text-right py-1">Cant.</th>
                              <th className="text-right py-1">Precio unit.</th>
                              <th className="text-right py-1">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {inv.invoice_items.map((it, i) => (
                              <tr key={i} className="border-b border-border/40">
                                <td className="py-1.5">{it.description}</td>
                                <td className="text-right">{it.quantity}</td>
                                <td className="text-right font-mono">{formatARS(it.unit_price)}</td>
                                <td className="text-right font-mono">{formatARS(it.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      <div className="flex justify-end gap-4 text-xs font-mono pt-1">
                        <span className="text-muted-foreground">Subtotal: {formatARS(Number(inv.subtotal))}</span>
                        {Number(inv.tax_pct) > 0 && <span className="text-muted-foreground">IVA: {formatARS(Number(inv.tax_amount))}</span>}
                        <span className="font-bold text-primary">Total: {formatARS(Number(inv.total))}</span>
                      </div>
                      {inv.notes && <p className="text-xs text-muted-foreground italic">Notas: {inv.notes}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
