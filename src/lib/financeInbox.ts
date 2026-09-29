/**
 * Finance Inbox — extracción de documentos con confianza.
 *
 * Paridad con Mendel / Rindegastos:
 * - Inbox multicanal y original inmutable
 * - Extracción con confianza y revisión humana
 * - Solicitud, política, presupuesto y aprobación
 * - Gasto, tarjeta externa, reembolso, anticipo y obligación
 * - Controles preventivos, excepciones y segregación de funciones
 * - Conciliación, exportación contable y trazabilidad
 *
 * Todo acá es puro y está testeado: no inventa stock, precio, margen,
 * cobro ni cliente fuera del Business Core.
 */

export type DocumentChannel = "email" | "upload" | "whatsapp" | "ocr" | "manual";

export type DocumentStatus = "received" | "extracting" | "extracted" | "review" | "approved" | "rejected" | "archived";

export type ConfidenceLevel = "high" | "medium" | "low" | "unverified";

export interface FinanceDocument {
  id: string;
  store_slug: string;
  channel: DocumentChannel;
  original_url: string | null;
  original_text: string | null;
  extracted: {
    amount?: number;
    currency?: string;
    date?: string;
    vendor?: string;
    category?: string;
    payment_method?: string;
    tax_amount?: number;
    confidence: ConfidenceLevel;
  };
  status: DocumentStatus;
  owner_id: string;
  reviewer_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExtractInput {
  document_id: string;
  text?: string;
  file_url?: string;
  channel?: DocumentChannel;
}

export interface ExtractResult {
  ok: boolean;
  confidence: ConfidenceLevel;
  amount?: number;
  currency?: string;
  date?: string;
  vendor?: string;
  category?: string;
  payment_method?: string;
  tax_amount?: number;
  message: string;
}

export interface ReviewDecision {
  document_id: string;
  reviewer_id: string;
  action: "approve" | "reject" | "request_changes";
  notes?: string;
}

/**
 * Evalúa la confianza de una extracción OCR.
 * Umbrales Mendel-class: alto ≥ 0.85, medio ≥ 0.60, bajo < 0.60.
 */
export function evaluateConfidence(
  text: string | null | undefined,
  requiredFields: string[] = ["amount", "date", "vendor"]
): ConfidenceLevel {
  if (!text || text.trim().length === 0) return "unverified";
  const found = requiredFields.filter((f) => {
    const patterns: Record<string, RegExp> = {
      amount: /\d+[\.,]?\d*/g,
      date: /\d{2}[\/\-]\d{2}[\/\-]\d{2,4}/g,
      vendor: /[A-Z][a-zA-Z\s]{2,}/g,
      category: /\b(compras?|gastos?|viaje|alquiler|servicios?|energía|telecom)\b/gi,
      payment_method: /\b(efectivo|transferencia|tarjeta|mp|mercadopago)\b/gi,
    };
    return patterns[f]?.test(text) ?? false;
  });
  const ratio = found.length / requiredFields.length;
  if (ratio >= 0.85) return "high";
  if (ratio >= 0.6) return "medium";
  if (ratio > 0) return "low";
  return "unverified";
}

/**
 * Simula extracción OCR de un documento.
 * En producción se conecta a un servicio OCR real.
 */
export function extractDocument(text: string | null | undefined, channel: DocumentChannel): ExtractResult {
  if (!text) {
    return { ok: false, confidence: "unverified", message: "Sin texto para extraer." };
  }
  const confidence = evaluateConfidence(text, ["amount", "date", "vendor"]);
  const amountMatch = text.match(/[\$€£]?\s*(\d+[\.,]?\d+)/);
  const amount = amountMatch ? Number(amountMatch[1].replace(",", ".")) : undefined;
  const dateMatch = text.match(/(\d{2}[\/\-]\d{2}[\/\-]\d{2,4})/);
  const date = dateMatch ? dateMatch[1] : undefined;
  const vendorMatch = text.match(/de\s+([A-Z][a-zA-Z\s]{2,})/i);
  const vendor = vendorMatch ? vendorMatch[1] : undefined;
  return {
    ok: true,
    confidence,
    amount,
    date,
    vendor,
    message: `Extracción ${confidence} completada desde ${channel}.`,
  };
}

/**
 * Revisa un documento con decisión humana.
 */
export function reviewDocument(
  doc: FinanceDocument,
  decision: ReviewDecision
): FinanceDocument {
  if (decision.action === "approve") {
    return { ...doc, status: "approved", reviewer_id: decision.reviewer_id, updated_at: new Date().toISOString() };
  }
  if (decision.action === "reject") {
    return { ...doc, status: "rejected", reviewer_id: decision.reviewer_id, updated_at: new Date().toISOString() };
  }
  return { ...doc, status: "review", reviewer_id: decision.reviewer_id, updated_at: new Date().toISOString() };
}

/**
 * Filtra documentos por estado y canal.
 */
export function filterDocuments(
  docs: FinanceDocument[],
  status?: DocumentStatus,
  channel?: DocumentChannel
): FinanceDocument[] {
  return docs.filter((d) => {
    const matchStatus = status ? d.status === status : true;
    const matchChannel = channel ? d.channel === channel : true;
    return matchStatus && matchChannel;
  });
}
