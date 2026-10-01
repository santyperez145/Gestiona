import jsPDF from "jspdf";
import * as QRCode from "qrcode";
import { supabase } from "@/integrations/supabase/client";
import {
  condicionIvaLabel,
  fechaFiscalArgentina,
  numeroFiscal,
  printableArcaQrUrl,
} from "@/lib/arcaInvoice";
import { mensajeDeEdgeFunction } from "@/lib/edgeErrors";
import { invoiceIvaGroups, invoiceDisplayLines } from "../../supabase/functions/_shared/invoiceIva";
import {
  posDebeIntentarAutorizar,
  posParseFacturarResult,
  type PosFacturaEstado,
} from "@/lib/posComprobante";

export type FiscalTicketItem = {
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  tax_rate?: number | null;
  tax_amount?: number | null;
};

export type FiscalTicketInvoice = {
  id: string;
  org_id?: string;
  number: string;
  customer_name: string;
  customer_tax_id?: string | null;
  issue_date: string;
  currency: string;
  subtotal: number;
  tax_pct: number;
  tax_amount: number;
  total: number;
  tipo_comprobante: number | null;
  condicion_iva_receptor: number | string | null;
  cae: string | null;
  cae_vencimiento: string | null;
  numero_afip: number | null;
  afip_environment?: string | null;
  emisor_razon_social?: string | null;
  emisor_cuit?: string | null;
  emisor_domicilio?: string | null;
  emisor_condicion_iva?: string | null;
  emisor_ingresos_brutos?: string | null;
  emisor_inicio_actividades?: string | null;
  punto_venta?: number | null;
  receptor_tipo_documento?: number | null;
  moneda_cotizacion?: number | null;
  codigo_autorizacion_tipo?: string | null;
  arca_qr_payload?: unknown;
  nota_credito_de?: string | null;
  invoice_items?: FiscalTicketItem[];
};

export type AssociatedFiscalInvoice = { title: string; number: string; issueDate: string };

const DOCUMENT_TYPE: Record<number, { letter: string; title: string }> = {
  1: { letter: "A", title: "FACTURA A" },
  3: { letter: "NC A", title: "NOTA DE CRÉDITO A" },
  6: { letter: "B", title: "FACTURA B" },
  8: { letter: "NC B", title: "NOTA DE CRÉDITO B" },
  11: { letter: "C", title: "FACTURA C" },
  13: { letter: "NC C", title: "NOTA DE CRÉDITO C" },
};
const money = (value: unknown) => new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
}).format(Number(value) || 0);

export async function loadAssociatedFiscalInvoice(invoice: {
  org_id?: string;
  nota_credito_de?: string | null;
  tipo_comprobante?: number | null;
}): Promise<AssociatedFiscalInvoice | null> {
  const sourceType: Record<number, number> = { 3: 1, 8: 6, 13: 11 };
  const expectedType = sourceType[Number(invoice.tipo_comprobante)];
  if (!invoice.nota_credito_de) {
    if (expectedType) throw new Error("La nota de crédito no tiene una factura fiscal asociada.");
    return null;
  }
  if (!expectedType) throw new Error("El comprobante asociado no corresponde a una nota de crédito válida.");
  if (!invoice.org_id) throw new Error("No se pudo verificar la factura asociada a esta nota de crédito.");
  const { data, error } = await supabase.from("invoices")
    .select("tipo_comprobante, punto_venta, numero_afip, issue_date, cae")
    .eq("id", invoice.nota_credito_de)
    .eq("org_id", invoice.org_id)
    .maybeSingle();
  const title = data?.tipo_comprobante ? DOCUMENT_TYPE[data.tipo_comprobante]?.title : null;
  const number = numeroFiscal(data?.punto_venta, data?.numero_afip);
  if (error || !data?.cae || !title || !number || data.tipo_comprobante !== expectedType) {
    throw new Error("No se pudo verificar el comprobante fiscal asociado a la nota de crédito.");
  }
  return { title, number, issueDate: fechaFiscalArgentina(data.issue_date) };
}

export async function ensureSaleTransactionInvoice({
  orgId,
  transactionId,
}: {
  orgId: string;
  transactionId: string;
}): Promise<PosFacturaEstado> {
  const { data, error } = await supabase.rpc("facturar_venta_pos", {
    p_org: orgId,
    p_transaction_id: transactionId,
  });
  if (error) {
    console.error("facturar_venta_pos:", error);
    return posParseFacturarResult({
      ok: false,
      motivo: "No se pudo crear la factura del ticket. Revisá la configuración fiscal.",
    });
  }

  const parsed = posParseFacturarResult(data);
  if (!posDebeIntentarAutorizar(parsed) || !parsed.invoiceId) return parsed;

  const { data: authData, error: authError } = await supabase.functions.invoke("afip-authorize", {
    body: { invoice_id: parsed.invoiceId },
  });
  if (authError || (authData as { error?: unknown } | null)?.error) {
    console.error("afip-authorize:", authError || authData);
    return {
      ...parsed,
      motivo: (await mensajeDeEdgeFunction(authError, authData)) || "ARCA no autorizó el comprobante.",
    };
  }
  const authorized = (authData ?? {}) as { cae?: unknown; status?: unknown };
  return {
    ...parsed,
    cae: typeof authorized.cae === "string" ? authorized.cae : undefined,
    afipStatus: typeof authorized.status === "string" ? authorized.status : undefined,
  };
}

export async function printFiscalInvoiceTicket(
  invoice: FiscalTicketInvoice,
  organizationName: string,
  printWindow?: Window,
): Promise<void> {
  const popup = printWindow ?? window.open("", "_blank");
  if (!popup) throw new Error("Permití las ventanas emergentes para imprimir la factura.");

  try {
    const groups = invoiceIvaGroups(invoice);
    const items = invoiceDisplayLines(invoice);
    const discriminatesVat = [1, 2, 3].includes(Number(invoice.tipo_comprobante));
    const documentType = invoice.tipo_comprobante ? DOCUMENT_TYPE[invoice.tipo_comprobante] : null;
    const qrUrl = printableArcaQrUrl(invoice);
    const authorized = Boolean(qrUrl);
    const associated = await loadAssociatedFiscalInvoice(invoice);
    const itemHeight = items.reduce((height, item) => (
      height + Math.max(1, Math.ceil(String(item.description || "Producto").length / 34)) * 3.2 + 4
    ), 0);
    const estimatedHeight = Math.max(170, 122 + itemHeight + (qrUrl ? 45 : 15) + (associated ? 18 : 0) + groups.length * 4);
    const doc = new jsPDF({ unit: "mm", format: [80, estimatedHeight], orientation: "portrait" });
    const width = 80;
    const left = 4;
    const right = 76;
    let y = 7;
    const center = (text: string, size = 9, bold = false) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      const lines = doc.splitTextToSize(text, 70) as string[];
      doc.text(lines, width / 2, y, { align: "center" });
      y += lines.length * (size * 0.38) + 1;
    };
    const row = (label: string, value: string, bold = false) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(bold ? 10 : 7.5);
      doc.text(label, left, y);
      doc.text(value, right, y, { align: "right" });
      y += bold ? 5 : 4;
    };
    const rule = () => {
      doc.setDrawColor(130);
      doc.setLineDashPattern([1, 1], 0);
      doc.line(left, y, right, y);
      doc.setLineDashPattern([], 0);
      y += 4;
    };

    center(invoice.emisor_razon_social || organizationName || "Nerqia", 12, true);
    if (invoice.emisor_cuit) center(`CUIT ${invoice.emisor_cuit}`, 8);
    if (invoice.emisor_domicilio) center(invoice.emisor_domicilio, 7.5);
    center(condicionIvaLabel(invoice.emisor_condicion_iva), 7.5);
    if (invoice.emisor_ingresos_brutos) center(`Ingresos Brutos ${invoice.emisor_ingresos_brutos}`, 7);
    if (invoice.emisor_inicio_actividades) center(`Inicio de actividades ${fechaFiscalArgentina(invoice.emisor_inicio_actividades)}`, 7);
    rule();

    center(authorized && documentType ? `${documentType.title} · ORIGINAL` : "BORRADOR DE COMPROBANTE", 11, true);
    center(
      numeroFiscal(invoice.punto_venta, invoice.numero_afip) || `N° interno ${invoice.number}`,
      9,
      true,
    );
    center(`Fecha ${fechaFiscalArgentina(invoice.issue_date)}`, 7.5);
    if (invoice.afip_environment === "homologacion") {
      center("HOMOLOGACIÓN · SIN VALOR FISCAL", 8, true);
    }
    rule();

    center(`Receptor: ${invoice.customer_name || "Consumidor final"}`, 8, true);
    if (invoice.customer_tax_id) center(`CUIT/DNI ${invoice.customer_tax_id}`, 7.5);
    center(condicionIvaLabel(invoice.condicion_iva_receptor), 7.5);
    rule();

    if (associated) {
      center("Comprobante asociado", 7.5, true);
      center(`${associated.title} ${associated.number}`, 7.5);
      center(`Emitido el ${associated.issueDate}`, 7);
      rule();
    }

    doc.setFontSize(7.5);
    for (const item of items) {
      const description = doc.splitTextToSize(item.description || "Producto", 46) as string[];
      doc.setFont("helvetica", "normal");
      doc.text(description, left, y);
      doc.text(`${Number(item.quantity || 0)} x ${money(item.unit_price)}`, right, y, { align: "right" });
      y += Math.max(description.length * 3.2, 4);
      doc.setFont("helvetica", "bold");
      doc.text(money(item.total), right, y, { align: "right" });
      y += 4;
    }
    rule();
    row("Subtotal", money(discriminatesVat ? invoice.subtotal : invoice.total));
    if (discriminatesVat) {
      for (const group of groups) row(`IVA ${group.rate}%`, money(group.amount));
    }
    row("TOTAL", money(invoice.total), true);
    rule();

    center("TRANSPARENCIA FISCAL", 7.5, true);
    row("IVA contenido", money(invoice.tax_amount));
    row("Otros impuestos nacionales indirectos", money(0));
    rule();

    if (authorized && invoice.cae && invoice.cae_vencimiento) {
      center(`CAE ${invoice.cae}`, 8, true);
      center(`Vencimiento CAE ${fechaFiscalArgentina(invoice.cae_vencimiento)}`, 7.5);
      if (qrUrl) {
        const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 240, margin: 1, errorCorrectionLevel: "M" });
        doc.addImage(qrDataUrl, "PNG", 25, y, 30, 30);
        y += 33;
        center("QR oficial ARCA", 7, true);
      }
      center("Comprobante electrónico autorizado por ARCA", 7);
    } else {
      center("BORRADOR SIN CAE", 9, true);
      center("NO ES UN COMPROBANTE FISCAL", 8, true);
    }

    doc.autoPrint();
    const url = doc.output("bloburl");
    popup.location.href = url.toString();
    window.setTimeout(() => URL.revokeObjectURL(url.toString()), 60_000);
  } catch (error) {
    popup.close();
    throw error;
  }
}

export async function printFiscalInvoiceById(
  invoiceId: string,
  organizationName: string,
  printWindow?: Window,
): Promise<void> {
  const popup = printWindow ?? window.open("", "_blank");
  if (!popup) throw new Error("Permití las ventanas emergentes para imprimir la factura.");
  try {
    const { data, error } = await supabase
      .from("invoices")
      .select("*, invoice_items(*)")
      .eq("id", invoiceId)
      .single();
    if (error || !data) {
      console.error("printFiscalInvoiceById:", error);
      throw new Error("No se pudo cargar la factura para imprimir.");
    }
    await printFiscalInvoiceTicket(data as unknown as FiscalTicketInvoice, organizationName, popup);
  } catch (error) {
    popup.close();
    throw error;
  }
}
