import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { useClipboard } from "@/hooks/useClipboard";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
import { formatARS, recordMemberStockMovementDB } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as QRCode from "qrcode";
import {
  arcaQrUrl,
  condicionIvaLabel,
  fechaFiscalArgentina,
  numeroFiscal,
} from "@/lib/arcaInvoice";
import {
  Receipt, Plus, Trash2, FileDown, CheckCircle2, Clock, XCircle,
  Send, Eye, ChevronDown, ChevronUp, DollarSign, FileText, Mail,
  ShieldCheck, ShieldAlert, Loader2, QrCode, Search, FileMinus,
  Square, CheckSquare, CheckCheck, RotateCcw, Package, Copy, AlertTriangle,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";

/** El formato de plata de esta pantalla, en un solo lugar. */
const fmtARS = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";

import { plural } from "@/lib/plural";
import { mensajeDeEdgeFunction } from "@/lib/edgeErrors";
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
  sale_id: string | null;
  invoice_items?: InvoiceItem[];
  // AFIP fields
  tipo_comprobante: number | null;
  condicion_iva_receptor: number;
  cae: string | null;
  cae_vencimiento: string | null;
  afip_status: string | null;
  afip_error: string | null;
  numero_afip: number | null;
  afip_environment: string | null;
  emisor_razon_social: string | null;
  emisor_cuit: string | null;
  emisor_domicilio: string | null;
  emisor_condicion_iva: string | null;
  emisor_ingresos_brutos: string | null;
  emisor_inicio_actividades: string | null;
  punto_venta: number | null;
  receptor_tipo_documento: number | null;
  moneda_cotizacion: number | null;
  codigo_autorizacion_tipo: string | null;
  arca_qr_payload: unknown;
  fiscal_snapshot_source: string | null;
  fiscal_issued_at: string | null;
}

interface AfipSettings {
  afip_cuit: string | null;
  afip_razon_social: string | null;
  afip_domicilio: string | null;
  afip_punto_venta: number | null;
  afip_tipo_emisor: string | null;
  afip_environment: string | null;
  afip_ingresos_brutos: string | null;
  afip_inicio_actividades: string | null;
}

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
const TIPO_CBTE: Record<number, string> = { 1: "A", 6: "B", 11: "C" };

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  draft:    { label: "Borrador",  color: "bg-muted text-muted-foreground border-border",              icon: FileText },
  issued:   { label: "Emitida",   color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/25", icon: ShieldCheck },
  sent:     { label: "Enviada",   color: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/25",            icon: Send },
  paid:     { label: "Pagada",    color: "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/25",        icon: CheckCircle2 },
  overdue:  { label: "Vencida",   color: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/25",                icon: XCircle },
  canceled: { label: "Cancelada", color: "bg-muted text-muted-foreground/50 border-border/50",        icon: XCircle },
};

/**
 * El estado comercial y el fiscal son ejes distintos. Una factura POS nace
 * como `draft`, pero cuando ARCA entrega CAE ya está emitida fiscalmente. La
 * vista lo expresa sin inventar otro enum ni duplicar el flujo del Core.
 */
function visibleInvoiceStatus(inv: Pick<Invoice, "status" | "cae">): string {
  return inv.cae && inv.status === "draft" ? "issued" : inv.status;
}

const EMPTY_FORM = {
  customer_name: "", customer_email: "", customer_address: "", customer_tax_id: "",
  due_date: "", notes: "", tax_pct: "21", tipo_comprobante: "",
};

function emptyItem(): InvoiceItem { return { description: "", quantity: 1, unit_price: 0, total: 0 }; }

// ─────────────────────────────────────────────────────────────
// PDF generator — includes AFIP data when authorized
// ─────────────────────────────────────────────────────────────
async function generatePDF(inv: Invoice, orgName: string, afipSettings?: AfipSettings | null) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const tipoCbte = inv.tipo_comprobante ? TIPO_CBTE[inv.tipo_comprobante] : null;
  const autorizado = !!(inv.cae && inv.numero_afip && tipoCbte);
  const razonSocial = inv.emisor_razon_social || (!autorizado ? afipSettings?.afip_razon_social : null) || orgName;
  const cuit = inv.emisor_cuit || (!autorizado ? afipSettings?.afip_cuit : null);
  const domicilio = inv.emisor_domicilio || (!autorizado ? afipSettings?.afip_domicilio : null);
  const condicionEmisor = inv.emisor_condicion_iva || (!autorizado ? afipSettings?.afip_tipo_emisor : null);
  const ingresosBrutos = inv.emisor_ingresos_brutos || (!autorizado ? afipSettings?.afip_ingresos_brutos : null);
  const inicioActividades = inv.emisor_inicio_actividades || (!autorizado ? afipSettings?.afip_inicio_actividades : null);
  const puntoVenta = inv.punto_venta || (!autorizado ? afipSettings?.afip_punto_venta : null);
  const numero = numeroFiscal(puntoVenta, inv.numero_afip);
  const esHomologacion = inv.afip_environment === "homologacion";

  // ── Header band ──────────────────────────────────────────
  doc.setFillColor(17, 24, 39);
  doc.rect(0, 0, W, 104, "F");
  doc.setTextColor(124, 92, 255);
  doc.setFontSize(21);
  doc.setFont("helvetica", "bold");
  doc.text(razonSocial.toUpperCase(), 40, 34, { maxWidth: W / 2 - 72 });
  doc.setFontSize(11);
  doc.setTextColor(229, 231, 235);
  doc.text(
    autorizado
      ? `FACTURA ${tipoCbte} · ORIGINAL`
      : tipoCbte
        ? `BORRADOR FACTURA ${tipoCbte} · SIN CAE`
        : "COMPROBANTE BORRADOR",
    40,
    56,
  );
  if (cuit) {
    doc.setFontSize(9);
    doc.setTextColor(156, 163, 175);
    doc.text(`CUIT ${cuit.replace(/^(\d{2})(\d{8})(\d)$/, "$1-$2-$3")}`, 40, 73);
    doc.text(condicionIvaLabel(condicionEmisor), 40, 88);
  }
  doc.setFontSize(14);
  doc.setTextColor(255, 255, 255);
  doc.text(numero ? `N° ${numero}` : `N° interno ${inv.number}`, W - 40, 34, { align: "right" });
  doc.setFontSize(10);
  doc.setTextColor(209, 213, 219);
  doc.text(`Fecha de emisión ${fechaFiscalArgentina(inv.issue_date)}`, W - 40, 55, { align: "right" });
  doc.setFontSize(8);
  doc.text(`Punto de venta ${puntoVenta ? String(puntoVenta).padStart(5, "0") : "—"}`, W - 40, 72, { align: "right" });
  doc.text(`Código de comprobante ${inv.tipo_comprobante ?? "—"}`, W - 40, 87, { align: "right" });

  // ── Punto de venta divider (AFIP layout) ─────────────────
  if (tipoCbte) {
    doc.setFillColor(124, 92, 255);
    doc.rect(W / 2 - 22, 0, 44, 104, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(28);
    doc.setTextColor(255, 255, 255);
    doc.text(tipoCbte, W / 2, 48, { align: "center" });
    doc.setFontSize(7);
    doc.text(`COD. ${inv.tipo_comprobante}`, W / 2, 67, { align: "center" });
  }

  if (esHomologacion) {
    doc.setFillColor(254, 243, 199);
    doc.rect(0, 104, W, 24, "F");
    doc.setFont("helvetica", "bold");
    doc.setTextColor(146, 64, 14);
    doc.setFontSize(9);
    doc.text("HOMOLOGACIÓN · COMPROBANTE DE PRUEBA SIN VALOR FISCAL", W / 2, 120, { align: "center" });
  }

  // ── Identidad del emisor ──────────────────────────────────
  let yStart = esHomologacion ? 145 : 121;
  doc.setTextColor(55, 65, 81);
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  doc.text(`Domicilio comercial: ${domicilio || "No informado"}`, 40, yStart, { maxWidth: W - 80 });
  yStart += 13;
  doc.text(`Ingresos Brutos: ${ingresosBrutos || "No informado"}`, 40, yStart);
  doc.text(`Inicio de actividades: ${inicioActividades ? fechaFiscalArgentina(inicioActividades) : "No informado"}`, W / 2, yStart);
  yStart += 18;

  // ── Customer box ──────────────────────────────────────────
  doc.setFillColor(249, 250, 251);
  doc.roundedRect(34, yStart - 2, W - 68, 76, 5, 5, "F");
  doc.setTextColor(50, 50, 50);
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("RECEPTOR", 46, yStart + 12);
  doc.setFont("helvetica", "normal");
  doc.text(inv.customer_name || "Consumidor final", 46, yStart + 28);
  let cy = yStart + 28;
  if (inv.customer_tax_id) { cy += 13; doc.text(`CUIT/DNI: ${inv.customer_tax_id}`, 46, cy); }
  if (inv.customer_address) { cy += 13; doc.text(`Domicilio: ${inv.customer_address}`, 46, cy, { maxWidth: W / 2 - 60 }); }
  doc.setFont("helvetica", "bold");
  doc.text("Condición IVA", W / 2, yStart + 12);
  doc.setFont("helvetica", "normal");
  doc.text(condicionIvaLabel(inv.condicion_iva_receptor), W / 2, yStart + 28);
  if (inv.customer_email) doc.text(inv.customer_email, W / 2, yStart + 44, { maxWidth: W / 2 - 54 });

  if (inv.due_date) {
    doc.setFont("helvetica", "bold");
    doc.text("Vencimiento de pago", W / 2, yStart + 59);
    doc.setFont("helvetica", "normal");
    doc.text(fechaFiscalArgentina(inv.due_date), W - 46, yStart + 59, { align: "right" });
  }

  // ── Items table ───────────────────────────────────────────
  const items = inv.invoice_items || [];
  const tableY = Math.max(cy + 18, yStart + 88);
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
    headStyles: { fillColor: [17, 24, 39], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 5 },
    columnStyles: { 0: { cellWidth: "auto" }, 1: { cellWidth: 45, halign: "right" }, 2: { cellWidth: 90, halign: "right" }, 3: { cellWidth: 90, halign: "right" } },
  });

  let y = doc.lastAutoTable.finalY + 16;
  const right = W - 40;

  // ── Totals ────────────────────────────────────────────────
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.setFont("helvetica", "normal");
  doc.text(`Subtotal: ${formatARS(inv.subtotal)}`, W / 2 + 8, y + 9);
  doc.text(formatARS(inv.subtotal), right, y + 9, { align: "right" });
  y += 20;
  // Sólo Factura A discrimina IVA en la representación entregada al receptor.
  if (inv.tipo_comprobante === 1 && inv.tax_pct > 0) {
    doc.text(`IVA (${inv.tax_pct}%):`, W / 2 + 8, y + 9);
    doc.text(formatARS(inv.tax_amount), right, y + 9, { align: "right" });
    y += 20;
  }
  doc.setFillColor(124, 92, 255);
  doc.rect(W / 2, y - 2, W / 2 - 40, 20, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
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
    if (y > 680) { doc.addPage(); y = 48; }
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
    doc.text(fechaFiscalArgentina(inv.cae_vencimiento), W / 2 + 60, y);
    y += 16;

    const qrUrl = arcaQrUrl(inv);
    if (qrUrl) {
      const qrDataUrl = await QRCode.toDataURL(qrUrl, {
        errorCorrectionLevel: "M", margin: 1, width: 220,
        color: { dark: "#111827", light: "#FFFFFF" },
      });
      doc.addImage(qrDataUrl, "PNG", 40, y, 76, 76);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(17, 24, 39);
      doc.setFontSize(10);
      doc.text("Comprobante autorizado por ARCA", 130, y + 21);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(75, 85, 99);
      doc.text("Escaneá el QR para consultar los datos oficiales del comprobante.", 130, y + 39);
      doc.text(`CAE ${inv.cae} · Vencimiento ${fechaFiscalArgentina(inv.cae_vencimiento)}`, 130, y + 56);
      y += 84;
    }
  }

  // ── Footer ────────────────────────────────────────────────
  const fY = doc.internal.pageSize.getHeight() - 24;
  doc.setFontSize(8);
  doc.setTextColor(160, 160, 160);
  doc.setFont("helvetica", "normal");
  const footerText = inv.cae
    ? `Comprobante electrónico autorizado por ARCA${esHomologacion ? " · HOMOLOGACIÓN" : ""}`
    : "Borrador sin CAE · No es un comprobante fiscal";
  doc.text(footerText, W / 2, fY, { align: "center" });

  doc.save(`factura-${numero || inv.number}.pdf`);
  toast.success("PDF generado");
}

// ─────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────
export default function InvoicesPage() {
  usePageTitle("Facturas");
  const { user } = useAuth();
  const { activeOrg, activeRole } = useOrg();
  const { ask, dialog } = useConfirmDialog();
  const [searchParams, setSearchParams] = useSearchParams();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [items, setItems] = useState<InvoiceItem[]>([emptyItem()]);
  const [saving, setSaving] = useState(false);
  const [sendingEmail, setSendingEmail] = useState<string | null>(null);
  const [authorizingId, setAuthorizingId] = useState<string | null>(null);
  const [afipSettings, setAfipSettings] = useState<AfipSettings | null>(null);
  const [search, setSearch] = useState("");
  const [creatingNC, setCreatingNC] = useState<string | null>(null);
  const [ncDialogInv, setNcDialogInv] = useState<Invoice | null>(null);
  const [ncRevertStock, setNcRevertStock] = useState(true);
  const [ncMarkReturned, setNcMarkReturned] = useState(true);
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSending, setBulkSending] = useState(false);
  const fromSaleHandled = useRef(false);
  const fromSaleId = useRef<string | null>(null); // track sale_id to persist on save

  const canManage = activeRole === "owner" || activeRole === "admin";
  const { copy } = useClipboard();

  // Pre-fill form when navigated from SalesPage with ?from_sale=...
  useEffect(() => {
    const fromSale = searchParams.get("from_sale");
    const customer = searchParams.get("customer") ?? "";
    const total = searchParams.get("total") ?? "";
    const productName = searchParams.get("product") ?? "Venta";
    if (fromSale && !fromSaleHandled.current) {
      fromSaleHandled.current = true;
      fromSaleId.current = fromSale; // save for submission
      setForm(f => ({
        ...f,
        customer_name: decodeURIComponent(customer),
        notes: "",
      }));
      if (total) {
        setItems([{ ...emptyItem(), description: decodeURIComponent(productName), quantity: 1, unit_price: Number(total) }]);
      }
      setShowForm(true);
      // Clean the URL params
      setSearchParams({}, { replace: true });
    }
  }, [searchParams]);

  // Estado de AFIP.
  //
  // ⚠️ Se lee de `afip_connection_status`, **nunca de `settings.afip_*`**.
  // Esta pantalla miraba `settings.afip_cuit` para decidir si AFIP estaba
  // configurado, pero `save_afip_config` escribe en `afip_credentials`: con el
  // certificado cargado y funcionando —CAE obtenido contra ARCA— el panel
  // seguía diciendo "AFIP no configurado" y escondía el botón de autorizar.
  //
  // `settings.afip_*` es la generación vieja y nadie la llena. La vista es la
  // fuente única, y además dice si el Ticket de Acceso está vigente.
  useEffect(() => {
    if (!activeOrg || !user) return;
    (async () => {
      const { data, error } = await supabase
        .from("afip_connection_status")
        .select("cuit,razon_social,domicilio,ingresos_brutos,inicio_actividades,punto_venta,tipo_emisor,environment,configured")
        .eq("org_id", activeOrg.id)
        .maybeSingle();

      // Un error acá no puede leerse como "no está configurado": son cosas
      // distintas, y confundirlas es lo que hace que alguien vuelva a cargar
      // un certificado que ya estaba bien.
      if (error) {
        console.error("afip_connection_status", error);
        return;
      }
      if (!data) return;

      setAfipSettings({
        afip_cuit: data.configured ? data.cuit : null,
        afip_razon_social: data.razon_social,
        afip_domicilio: data.domicilio,
        afip_punto_venta: data.punto_venta,
        afip_tipo_emisor: data.tipo_emisor,
        afip_environment: data.environment,
        afip_ingresos_brutos: data.ingresos_brutos,
        afip_inicio_actividades: data.inicio_actividades,
      });
    })();
  }, [activeOrg, user]);

  const handleSendEmail = async (inv: Invoice) => {
    if (!inv.customer_email) { toast.error("Esta factura no tiene email del cliente"); return; }
    setSendingEmail(inv.id);
    try {
      const { data, error } = await supabase.functions.invoke("send-invoice-email", {
        body: {
          orgId: activeOrg?.id,
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
      if (error || data?.error) throw new Error(await mensajeDeEdgeFunction(error, data));
      toast.success(`Email enviado a ${inv.customer_email}`);
      if (inv.status === "draft") await updateStatus(inv.id, "sent");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "No se pudo enviar el correo");
    } finally {
      setSendingEmail(null);
    }
  };

  const handleBulkSendEmail = async () => {
    const toSend = filteredInvoices.filter(inv => selectedIds.has(inv.id) && inv.customer_email);
    if (toSend.length === 0) { toast.error("Ninguna factura seleccionada tiene email de cliente"); return; }
    setBulkSending(true);
    let sent = 0; let failed = 0;
    for (const inv of toSend) {
      try {
        const { data, error } = await supabase.functions.invoke("send-invoice-email", {
          body: {
            orgId: activeOrg?.id,
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
        if (error || data?.error) throw new Error(await mensajeDeEdgeFunction(error, data));
        if (inv.status === "draft") await updateStatus(inv.id, "sent");
        sent++;
      } catch (error) {
        failed++;
        if (failed === 1) toast.error(error instanceof Error ? error.message : "Un correo no pudo enviarse");
      }
    }
    if (sent > 0) toast.success(`${sent} email${sent > 1 ? "s" : ""} enviado${sent > 1 ? "s" : ""}${failed > 0 ? `, ${failed} fallaron` : ""}`);
    else toast.error(`${failed} envíos fallaron`);
    setSelectedIds(new Set());
    setBulkSending(false);
  };

  const handleAuthorizeAfip = async (inv: Invoice) => {
    if (!afipSettings?.afip_cuit) {
      toast.error("Configurá ARCA en Facturación electrónica antes de autorizar facturas");
      return;
    }
    if (inv.cae) { toast.info("Esta factura ya tiene CAE"); return; }

    setAuthorizingId(inv.id);
    try {
      const { data, error } = await supabase.functions.invoke("afip-authorize", {
        body: { invoice_id: inv.id },
      });
      if (error) {
        const msg = (error.message || '').toLowerCase();
        if (msg.includes('failed to send') || msg.includes('networkerror') || msg.includes('fetch')) {
          throw new Error('No se pudo conectar con ARCA. Verificá tu conexión o reintentá en unos segundos.');
        }
        throw error;
      }
      if (data?.error) throw new Error(data.error);
      if (data?.status === "processing") {
        toast.info("La autorización quedó en verificación. Esperá antes de reintentar para evitar duplicar el comprobante.");
      } else if (data?.cae) {
        toast.success(`CAE obtenido: ${data.cae}`);
      } else {
        toast.info("ARCA recibió la solicitud. Actualizá la lista para ver el estado.");
      }
      load();
    } catch (e: any) {
      toast.error("Error ARCA: " + e.message);
      load();
    } finally {
      setAuthorizingId(null);
    }
  };

  /**
   * C16 — ventas cobradas que quedaron sin comprobante.
   *
   * `ordenes_sin_facturar` existía desde C13 y no la leía ninguna pantalla.
   * Una salvaguarda que nadie consulta es un comentario: medido hoy contra
   * producción había 2 órdenes pagadas y 0 facturas, y nada lo decía.
   */
  const [pendientes, setPendientes] = useState<{ cantidad: number; monto: number } | null>(null);
  const [facturandoPend, setFacturandoPend] = useState(false);

  const cargarPendientes = useCallback(async () => {
    if (!activeOrg) return;
    const { data, error } = await supabase.rpc("resumen_sin_facturar", { p_org: activeOrg.id });
    // ⚠️ No se traga: "no pude leer" y "no hay pendientes" se ven igual en
    // pantalla y son problemas opuestos.
    if (error) {
      console.error("resumen_sin_facturar:", error.message);
      return;
    }
    const d = data as { cantidad: number; monto: number } | null;
    setPendientes(d && Number(d.cantidad) > 0
      ? { cantidad: Number(d.cantidad), monto: Number(d.monto) }
      : null);
  }, [activeOrg]);

  const facturarPendientes = async () => {
    if (!activeOrg || !pendientes) return;
    setFacturandoPend(true);
    const { data, error } = await supabase.rpc("facturar_pendientes", {
      p_org: activeOrg.id, p_limite: 500,
    });
    setFacturandoPend(false);

    if (error) { toast.error(error.message.replace(/^.*?:\s*/, "")); return; }

    const res = data as { creadas: number; fallas: { orden: string; error: string }[] } | null;
    const creadas = Number(res?.creadas ?? 0);
    const fallas = res?.fallas ?? [];

    if (creadas > 0) {
      toast.success(`${creadas} comprobante${creadas > 1 ? "s" : ""} generado${creadas > 1 ? "s" : ""}. Falta autorizarlos en ARCA.`);
    }
    // Las fallas se muestran con el número de orden: un contador sin el motivo
    // obliga a mirar logs que el dueño no tiene.
    for (const f of fallas.slice(0, 3)) {
      toast.error(`Orden ${f.orden}: ${f.error}`);
    }
    if (fallas.length > 3) toast.error(`y ${fallas.length - 3} más`);

    await Promise.all([load(), cargarPendientes()]);
  };

  const load = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from("invoices")
      .select("*, invoice_items(*)")
      .eq("org_id", activeOrg.id)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("No se pudieron cargar las facturas", error);
      setInvoices([]);
      setLoadError(error.message);
    } else {
      setInvoices((data || []) as Invoice[]);
    }
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { cargarPendientes(); }, [cargarPendientes]);

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
        sale_id: fromSaleId.current || null,
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

      // If created from a sale, update the sale's invoice_id bidirectional link
      if (fromSaleId.current && inv) {
        await supabase
          .from("sales")
          .update({ invoice_id: inv.id })
          .eq("id", fromSaleId.current);
        fromSaleId.current = null;
      }

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
    await supabase.from("invoices").update({ status: status as any, ...extra }).eq("id", id);
    load();
  };

  const deleteInvoice = async (id: string) => {
    if (!(await ask({ title: "¿Eliminar factura?", confirmText: "Eliminar", variant: "destructive" }))) return;
    await supabase.from("invoices").delete().eq("id", id);
    toast.success("Factura eliminada");
    load();
  };

  const createCreditNote = async (inv: Invoice, revertStock: boolean, markReturned: boolean) => {
    if (!activeOrg || !user) return;
    setCreatingNC(inv.id);
    setNcDialogInv(null);
    try {
      const ncNumber = `NC-${inv.number}`;
      const ncItems = (inv.invoice_items ?? [{ description: `Anulación ${inv.number}`, quantity: 1, unit_price: Number(inv.total), total: Number(inv.total) }])
        .map((it) => ({ ...it, unit_price: -Math.abs(it.unit_price), total: -Math.abs(it.total) }));
      const ncSubtotal = ncItems.reduce((s, it) => s + it.total, 0);
      const taxAmt = ncSubtotal * (Number(inv.tax_pct) / 100);
      const { data: creditNote, error } = await supabase.from("invoices").insert({
        org_id: activeOrg.id,
        number: ncNumber,
        customer_name: inv.customer_name,
        customer_email: inv.customer_email,
        customer_address: inv.customer_address,
        customer_tax_id: inv.customer_tax_id,
        issue_date: new Date().toISOString().slice(0, 10),
        due_date: null,
        status: "draft",
        currency: inv.currency || "ARS",
        subtotal: ncSubtotal,
        tax_pct: Number(inv.tax_pct),
        tax_amount: taxAmt,
        total: ncSubtotal + taxAmt,
        notes: `Nota de Crédito — anula/ajusta factura ${inv.number}`,
        invoice_items: ncItems,
        sale_id: inv.sale_id,
        tipo_comprobante: null,
      }).select("id").single();
      if (error) throw error;

      // Si se repone, primero deja el asiento de inventario que referencia la
      // nota de crédito. Luego cambia el estado comercial de la venta.
      if (inv.sale_id) {
        if (revertStock) {
          // El reverso es un movimiento de base, no una suma a products.stock.
          // Así queda en Kardex con la nota de crédito que lo originó.
          const { data: saleRows, error: saleRowsError } = await supabase
            .from("sales")
            .select("product_id, product_name, variant_id, quantity")
            .eq("id", inv.sale_id);
          if (saleRowsError) throw saleRowsError;
          if (saleRows && saleRows.length > 0) {
            for (const row of saleRows) {
              if (!row.product_id || !row.quantity) continue;
              await recordMemberStockMovementDB({
                orgId: activeOrg.id,
                productId: row.product_id,
                productName: row.product_name,
                variantId: row.variant_id,
                movementType: "invoice_credit_note",
                quantity: Number(row.quantity),
                referenceType: "invoice_credit_note",
                referenceId: creditNote.id,
                notes: `Nota de crédito ${ncNumber}`,
                userId: user.id,
              });
            }
          }
        }
        if (markReturned) {
          const { error: saleError } = await supabase
            .from("sales")
            .update({ paid: false, payment_method: "devolucion" })
            .eq("id", inv.sale_id);
          if (saleError) throw saleError;
        }
      }

      toast.success(`Nota de Crédito ${ncNumber} creada${revertStock && inv.sale_id ? " · Stock revertido" : ""}`);
      load();
    } catch (e: any) {
      toast.error(e.message || "Error al crear Nota de Crédito");
    } finally {
      setCreatingNC(null);
    }
  };

  const stats = {
    total: invoices.length,
    paid: invoices.filter((i) => i.status === "paid").reduce((s, i) => s + Number(i.total), 0),
    pending: invoices.filter((i) => i.status === "sent").reduce((s, i) => s + Number(i.total), 0),
    overdue: invoices.filter((i) => i.status === "overdue").length,
  };

  const filteredInvoices = invoices.filter((inv) => {
    if (filterStatus !== "all" && visibleInvoiceStatus(inv) !== filterStatus) return false;
    if (filterType !== "all") {
      if (filterType === "NC" && !inv.number.startsWith("NC-")) return false;
      if (filterType === "A" && (inv.tipo_comprobante !== 1 || inv.number.startsWith("NC-"))) return false;
      if (filterType === "B" && (inv.tipo_comprobante !== 6 || inv.number.startsWith("NC-"))) return false;
      if (filterType === "C" && (inv.tipo_comprobante !== 11 || inv.number.startsWith("NC-"))) return false;
      if (filterType === "none" && (inv.tipo_comprobante !== null || inv.number.startsWith("NC-"))) return false;
    }
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      inv.number.toLowerCase().includes(q) ||
      inv.customer_name.toLowerCase().includes(q) ||
      (inv.customer_email?.toLowerCase().includes(q) ?? false)
    );
  });

  const afipConfigured = !!afipSettings?.afip_cuit;

  // Default tipo_comprobante based on emisor type
  const defaultTipoCbte = afipSettings?.afip_tipo_emisor === "responsable_inscripto" ? "6" : "11";

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <PageHeader
        icon={Receipt}
        title="Facturas"
        description={afipConfigured ? "Comprobantes con autorización ARCA" : "Creá y gestioná comprobantes"}
        badge={
          stats.overdue > 0
            ? { label: `${stats.overdue} vencida${stats.overdue > 1 ? "s" : ""}`, variant: "destructive" }
            : afipConfigured
            ? { label: "ARCA ✓", variant: "success" }
            : undefined
        }
        actions={
          canManage ? (
            <Button onClick={() => setShowForm(!showForm)} className="gradient-gold text-primary-foreground">
              <Plus className="w-4 h-4 mr-2" />Nueva factura
            </Button>
          ) : undefined
        }
      />

      {/* ── C16: plata cobrada sin comprobante ─────────────────────────
          Va antes del aviso de AFIP a propósito: que falte configurar AFIP es
          una tarea pendiente; que haya ventas cobradas sin factura es un
          problema fiscal que ya está ocurriendo. */}
      {pendientes && canManage && (
        <div className="p-3 rounded-[8px] border border-amber-500/25 bg-amber-500/5 flex flex-wrap items-center gap-3 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
          <span className="text-amber-200 flex-1 min-w-[16rem]">
            <strong>{pendientes.cantidad}</strong>{" "}
            {pendientes.cantidad === 1 ? "venta cobrada" : "ventas cobradas"} por{" "}
            <strong>{fmtARS(pendientes.monto)}</strong>{" "}
            {pendientes.cantidad === 1 ? "no tiene" : "no tienen"} comprobante.
          </span>
          <Button
            size="sm" variant="outline" onClick={facturarPendientes} disabled={facturandoPend}
          >
            {facturandoPend
              ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Generando…</>
              : "Generar comprobantes"}
          </Button>
        </div>
      )}

      {/* AFIP not configured warning */}
      {!afipConfigured && canManage && (
        <div className="p-3 rounded-[8px] border border-yellow-500/20 bg-yellow-500/5 flex items-center gap-2 text-sm text-yellow-400">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span>
            ARCA no está configurado. Los borradores generados <strong>no tienen validez fiscal</strong>.
            Completá la conexión en <strong>Facturación electrónica</strong>.
          </span>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="Facturas totales" value={stats.total} icon={FileText} color="primary" />
        <KPICard label="Cobrado" value={formatARS(stats.paid)} icon={CheckCircle2} color="success"
          sub={`${plural(invoices.filter(i => i.status === "paid").length, "factura")}`} />
        <KPICard label="Pendiente cobro" value={formatARS(stats.pending)} icon={Clock} color="blue"
          sub={`${invoices.filter(i => i.status === "sent").length} enviadas`} />
        <KPICard label="Vencidas" value={stats.overdue} icon={XCircle}
          color={stats.overdue > 0 ? "destructive" : "success"} />
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-card border border-border/60 rounded-[10px] p-5 space-y-5">
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
                <Label className="text-xs">Tipo de comprobante ARCA</Label>
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
                  Podés autorizar con ARCA después de crear la factura usando el botón de escudo.
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
            <div className="space-y-2 pb-12">
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
      <div className="bg-card border border-border/60 rounded-[10px] overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-sm shrink-0">Facturas ({filteredInvoices.length})</h2>
          <div className="flex gap-1 flex-wrap">
            {["all", "draft", "issued", "sent", "paid", "overdue", "canceled"].map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-2.5 py-0.5 rounded-[5px] text-[10px] font-medium border transition-all ${
                  filterStatus === s
                    ? "bg-primary/15 text-primary border-primary/30"
                    : "text-muted-foreground border-border hover:border-primary/20"
                }`}
              >
                {s === "all" ? `Todas (${invoices.length})` : STATUS_CONFIG[s]?.label}
              </button>
            ))}
          </div>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="h-8 w-[148px] text-xs" aria-label="Filtrar por tipo de factura">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tipo: Todos</SelectItem>
              <SelectItem value="A">Factura A</SelectItem>
              <SelectItem value="B">Factura B</SelectItem>
              <SelectItem value="C">Factura C</SelectItem>
              <SelectItem value="NC">Nota de Crédito</SelectItem>
              <SelectItem value="none">Sin tipo</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative ml-auto">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por número o cliente…"
              className="pl-8 pr-3 h-8 text-xs bg-muted/40 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/40 w-52"
            />
          </div>
          <Button variant="outline" size="sm" className="h-8" onClick={() => {
            const bom = '﻿';
            const headers = ['Número', 'Cliente', 'Email', 'Estado', 'Total ARS', 'IVA %', 'Fecha emisión', 'Vencimiento', 'CAE', 'Pagada el'];
            const rows = filteredInvoices.map(inv => [
              inv.number,
              inv.customer_name,
              inv.customer_email || '',
              STATUS_CONFIG[visibleInvoiceStatus(inv)]?.label || inv.status,
              Number(inv.total).toFixed(2),
              inv.tax_pct,
              new Date(inv.issue_date).toLocaleDateString('es-AR'),
              inv.due_date ? new Date(inv.due_date).toLocaleDateString('es-AR') : '',
              inv.cae || '',
              inv.paid_at ? new Date(inv.paid_at).toLocaleDateString('es-AR') : '',
            ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
            const csv = bom + [headers.join(','), ...rows].join('\n');
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
            a.download = `facturas-${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            toast.success('Facturas exportadas');
          }}>
            <FileDown className="w-3.5 h-3.5 mr-1.5" />CSV
          </Button>
          {canManage && (
            <button
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border text-xs text-muted-foreground hover:border-primary/30 transition-all"
              title="Seleccionar todas"
              onClick={() => {
                if (selectedIds.size === filteredInvoices.length) {
                  setSelectedIds(new Set());
                } else {
                  setSelectedIds(new Set(filteredInvoices.map(i => i.id)));
                }
              }}
            >
              {selectedIds.size === filteredInvoices.length && filteredInvoices.length > 0
                ? <CheckCheck className="w-3.5 h-3.5 text-primary" />
                : <Square className="w-3.5 h-3.5" />
              }
              {selectedIds.size > 0 ? `${selectedIds.size} sel.` : "Sel."}
            </button>
          )}
        </div>
        {/* Bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 px-5 py-2.5 bg-primary/5 border-b border-primary/20">
            <CheckSquare className="w-4 h-4 text-primary shrink-0" />
            <span className="text-xs text-primary font-medium">{selectedIds.size} factura{selectedIds.size > 1 ? "s" : ""} seleccionada{selectedIds.size > 1 ? "s" : ""}</span>
            <Button size="sm" variant="outline" className="h-7 text-xs ml-auto border-primary/30 text-primary hover:bg-primary/10"
              onClick={handleBulkSendEmail} disabled={bulkSending}
            >
              {bulkSending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Mail className="w-3.5 h-3.5 mr-1.5" />}
              Enviar emails
            </Button>
            <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setSelectedIds(new Set())}>Cancelar</button>
          </div>
        )}
        {loadError ? (
          <div className="p-8 text-center">
            <AlertTriangle className="mx-auto mb-3 h-9 w-9 text-destructive" />
            <p className="text-sm font-medium text-destructive">No se pudieron cargar las facturas</p>
            <p className="mx-auto mt-1 max-w-xl text-xs text-muted-foreground">{loadError}</p>
            <Button className="mt-4" size="sm" variant="outline" onClick={() => void load()}>
              Reintentar
            </Button>
          </div>
        ) : loading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Cargando...</div>
        ) : filteredInvoices.length === 0 ? (
          <div className="p-10 text-center">
            <Receipt className="w-10 h-10 mx-auto mb-3 text-muted-foreground/20" />
            <p className="text-sm text-muted-foreground">
              {search ? "Sin resultados para tu búsqueda." : "Aún no hay facturas. Creá tu primera."}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filteredInvoices.map((inv) => {
              const sc = STATUS_CONFIG[visibleInvoiceStatus(inv)] || STATUS_CONFIG.draft;
              const Icon = sc.icon;
              const isOpen = expanded === inv.id;
              const tipoCbte = inv.tipo_comprobante ? TIPO_CBTE[inv.tipo_comprobante] : null;
              const isAuthorizing = authorizingId === inv.id;
              const qrUrl = arcaQrUrl(inv);
              const fiscalNumber = numeroFiscal(inv.punto_venta, inv.numero_afip);

              return (
                <div key={inv.id}>
                  <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-muted/20 transition-colors">
                    {canManage && (
                      <button
                        className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
                        onClick={(e) => { e.stopPropagation(); setSelectedIds(prev => { const n = new Set(prev); if (n.has(inv.id)) n.delete(inv.id); else n.add(inv.id); return n; }); }}
                      >
                        {selectedIds.has(inv.id)
                          ? <CheckSquare className="w-4 h-4 text-primary" />
                          : <Square className="w-4 h-4" />
                        }
                      </button>
                    )}
                    <button className="flex-1 flex items-center gap-3 min-w-0 text-left" onClick={() => setExpanded(isOpen ? null : inv.id)}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-mono text-sm font-semibold ${inv.number.startsWith("NC-") ? "text-orange-400" : ""}`}>{inv.number}</span>
                          <button
                            className="opacity-40 hover:opacity-100 transition-opacity"
                            title="Copiar número de factura"
                            onClick={e => { e.stopPropagation(); copy(inv.number, inv.number); }}
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                          {inv.number.startsWith("NC-") && (
                            <span className="inline-flex items-center px-1.5 py-0 rounded text-[10px] font-bold border border-orange-500/30 text-orange-400 bg-orange-500/5">
                              N.Crédito
                            </span>
                          )}
                          {tipoCbte && (
                            <span className="inline-flex items-center px-1.5 py-0 rounded text-[10px] font-bold border border-primary/30 text-primary bg-primary/5">
                              F{tipoCbte}
                            </span>
                          )}
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] text-[10px] font-medium border ${sc.color}`}>
                            <Icon className="w-3 h-3" />{sc.label}
                          </span>
                          {/* AFIP status badge */}
                          {inv.afip_status === "authorized" && inv.cae && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] text-[10px] font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                              <ShieldCheck className="w-3 h-3" />CAE
                            </span>
                          )}
                          {inv.afip_status === "processing" && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] text-[10px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20" title={inv.afip_error || "La respuesta de ARCA está en verificación"}>
                              <Loader2 className="w-3 h-3 animate-spin" />En verificación
                            </span>
                          )}
                          {(inv.afip_status === "rejected" || inv.afip_status === "error" || inv.afip_status === "config_error" || inv.afip_status === "network_error" || inv.afip_status === "validation_error") && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[3px] text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20" title={inv.afip_error || undefined}>
                              <ShieldAlert className="w-3 h-3" />
                              {inv.afip_status === "config_error" ? "Config ARCA" : inv.afip_status === "network_error" ? "Sin conexión ARCA" : "Error ARCA"}
                            </span>
                          )}
                          {inv.sale_id && (
                            <a
                              href={`/ventas`}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20"
                              title="Esta factura tiene una venta vinculada"
                              onClick={e => e.stopPropagation()}
                            >
                              <Receipt className="w-3 h-3" />Venta
                            </a>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground truncate">{inv.customer_name}</p>
                        <p className="text-xs text-muted-foreground/60">{fechaFiscalArgentina(inv.issue_date)}</p>
                      </div>
                    </button>
                    <div className="text-right shrink-0">
                      <div className="font-semibold font-mono text-sm">{formatARS(Number(inv.total))}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="icon" variant="ghost" className="h-8 w-8" title="Descargar PDF"
                        onClick={() => void generatePDF(
                          { ...inv, invoice_items: inv.invoice_items || [] },
                          activeOrg?.name || "Nerqia",
                          afipSettings,
                        ).catch((error) => {
                          console.error("No se pudo generar el PDF fiscal", error);
                          toast.error("No se pudo generar el PDF de la factura");
                        })}
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
                      {canManage && afipConfigured && inv.tipo_comprobante && !inv.cae && inv.afip_status !== "authorized" && inv.afip_status !== "processing" && (
                        <Button
                          size="icon" variant="ghost" className="h-8 w-8"
                          title="Autorizar con ARCA (obtener CAE)"
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
                      {canManage && (inv.status === "paid" || inv.status === "sent") && !inv.number.startsWith("NC-") && (
                        <Button size="icon" variant="ghost" className="h-8 w-8" title="Crear Nota de Crédito"
                          onClick={() => { setNcDialogInv(inv); setNcRevertStock(true); setNcMarkReturned(true); }} disabled={creatingNC === inv.id}
                        >
                          {creatingNC === inv.id
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <FileMinus className="w-4 h-4 text-orange-400" />}
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
                      {inv.due_date && <p className="text-xs text-muted-foreground">Vence: {fechaFiscalArgentina(inv.due_date)}</p>}

                      {/* CAE info */}
                      {inv.cae && (
                        <div className="p-3 rounded-lg bg-green-500/5 border border-green-500/20 space-y-1">
                          <p className="text-xs font-semibold text-green-400 flex items-center gap-1">
                            <ShieldCheck className="w-3.5 h-3.5" />Autorizada por ARCA
                          </p>
                          <p className="text-xs text-muted-foreground font-mono flex items-center gap-1.5">
                            CAE: {inv.cae}
                            <button
                              className="opacity-40 hover:opacity-100 transition-opacity shrink-0"
                              title="Copiar CAE"
                              onClick={() => copy(inv.cae!, `CAE ${inv.cae}`)}
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          </p>
                          {inv.cae_vencimiento && (
                            <p className="text-xs text-muted-foreground">Vto. CAE: {fechaFiscalArgentina(inv.cae_vencimiento)}</p>
                          )}
                          {inv.numero_afip && tipoCbte && (
                            <p className="text-xs text-muted-foreground">
                              Factura {tipoCbte} N° {fiscalNumber || String(inv.numero_afip).padStart(8, "0")}
                            </p>
                          )}
                          <div className="grid gap-2 pt-2 text-[11px] text-muted-foreground sm:grid-cols-2">
                            <p><span className="font-medium text-foreground">Emisor:</span> {inv.emisor_razon_social || "Snapshot no disponible"}</p>
                            <p><span className="font-medium text-foreground">CUIT:</span> {inv.emisor_cuit || "—"}</p>
                            <p><span className="font-medium text-foreground">Condición IVA:</span> {condicionIvaLabel(inv.emisor_condicion_iva)}</p>
                            <p><span className="font-medium text-foreground">Receptor:</span> {condicionIvaLabel(inv.condicion_iva_receptor)}</p>
                            <p className="sm:col-span-2"><span className="font-medium text-foreground">Domicilio:</span> {inv.emisor_domicilio || "No informado en el snapshot"}</p>
                            <p><span className="font-medium text-foreground">Ingresos Brutos:</span> {inv.emisor_ingresos_brutos || "No informado"}</p>
                            <p><span className="font-medium text-foreground">Inicio de actividades:</span> {inv.emisor_inicio_actividades ? fechaFiscalArgentina(inv.emisor_inicio_actividades) : "No informado"}</p>
                          </div>
                          {inv.afip_environment === "homologacion" && (
                            <p className="rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                              Homologación: comprobante de prueba sin valor fiscal.
                            </p>
                          )}
                          {inv.fiscal_snapshot_source === "legacy_backfill" && (
                            <p className="text-[10px] text-amber-700 dark:text-amber-300">
                              Comprobante histórico: la identidad se reconstruyó desde la configuración actual y no prueba qué domicilio había al emitir.
                            </p>
                          )}
                          {/* QR v1 oficial, construido desde el snapshot server-side. */}
                          {qrUrl && (
                            <div className="flex items-center gap-3 pt-1">
                              <div className="bg-white p-1.5 rounded-lg inline-flex">
                                <QRCodeSVG value={qrUrl} size={84} bgColor="#ffffff" fgColor="#111827" level="M" />
                              </div>
                              <div>
                                <p className="text-[10px] font-medium text-green-400 flex items-center gap-1">
                                  <QrCode className="w-3 h-3" />QR oficial ARCA
                                </p>
                                <p className="text-[9px] text-muted-foreground mt-0.5">Escaneá para verificar en arca.gob.ar</p>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {inv.afip_status === "processing" && (
                        <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 space-y-1">
                          <p className="text-xs font-semibold text-amber-400 flex items-center gap-1">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />Autorización en verificación
                          </p>
                          <p className="text-xs text-muted-foreground">
                            La respuesta de ARCA todavía no es concluyente. El sistema mantiene el intento reservado para no emitir dos veces el mismo comprobante.
                          </p>
                          {inv.afip_error && <p className="text-xs text-muted-foreground">{inv.afip_error}</p>}
                        </div>
                      )}
                      {["rejected","error","config_error","network_error","validation_error"].includes(inv.afip_status || "") && inv.afip_error && (
                        <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20 space-y-2">
                          <p className="text-xs font-semibold text-red-400 flex items-center gap-1">
                            <ShieldAlert className="w-3.5 h-3.5" />Error ARCA
                          </p>
                          <p className="text-xs text-muted-foreground">{inv.afip_error}</p>
                          {canManage && afipConfigured && inv.tipo_comprobante && (
                            <Button size="sm" variant="outline" className="h-7 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10"
                              onClick={() => handleAuthorizeAfip(inv)}
                            >
                              Reintentar autorización
                            </Button>
                          )}
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

      {/* NC Confirm Dialog */}
      <Dialog open={!!ncDialogInv} onOpenChange={v => { if (!v) setNcDialogInv(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileMinus className="w-5 h-5 text-orange-400" />
              Nota de Crédito — {ncDialogInv?.number}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Se creará la Nota de Crédito <strong className="text-foreground">NC-{ncDialogInv?.number}</strong> con los ítems negados de la factura original.
            </p>
            {ncDialogInv?.sale_id && (
              <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Opciones de devolución</p>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ncMarkReturned}
                    onChange={e => setNcMarkReturned(e.target.checked)}
                    className="mt-0.5 accent-primary"
                  />
                  <div>
                    <p className="text-sm font-medium">Marcar venta como devuelta</p>
                    <p className="text-xs text-muted-foreground">Cambia el estado de la venta vinculada a "devolución"</p>
                  </div>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ncRevertStock}
                    onChange={e => setNcRevertStock(e.target.checked)}
                    className="mt-0.5 accent-primary"
                  />
                  <div className="flex items-start gap-1.5">
                    <div>
                      <p className="text-sm font-medium flex items-center gap-1.5"><Package className="w-3.5 h-3.5 text-primary" />Revertir stock</p>
                      <p className="text-xs text-muted-foreground">Devuelve al inventario las unidades de la venta</p>
                    </div>
                  </div>
                </label>
              </div>
            )}
            {!ncDialogInv?.sale_id && (
              <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-300">
                Esta factura no está vinculada a una venta. Solo se creará la NC sin modificar el inventario.
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNcDialogInv(null)}>Cancelar</Button>
            <Button
              className="bg-orange-500 hover:bg-orange-600 text-white"
              onClick={() => ncDialogInv && createCreditNote(ncDialogInv, ncRevertStock, ncMarkReturned)}
              disabled={!!creatingNC}
            >
              {creatingNC ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <RotateCcw className="w-4 h-4 mr-1.5" />}
              Crear Nota de Crédito
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {dialog}
    </div>
  );
}
