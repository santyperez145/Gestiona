/**
 * Cola operativa de la bandeja F3 (Mendel-class sin clonar Core).
 * Las vistas se derivan de estados ya persistidos; no inventan política F5.
 */
import type { FinanceDocument } from "@/lib/financeDocumentUpload";

export const FINANCE_INBOX_VIEW_IDS = [
  "todos",
  "revisar",
  "matching",
  "borradores",
  "aprobados",
  "excepcion",
] as const;

export type FinanceInboxView = (typeof FINANCE_INBOX_VIEW_IDS)[number];

export const FINANCE_INBOX_VIEWS: { id: FinanceInboxView; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "revisar", label: "Por revisar" },
  { id: "matching", label: "Coincidencias" },
  { id: "borradores", label: "Borradores" },
  { id: "aprobados", label: "Aprobados" },
  { id: "excepcion", label: "Con excepción" },
];

export function parseFinanceInboxView(raw: string | null | undefined): FinanceInboxView {
  return FINANCE_INBOX_VIEW_IDS.includes(raw as FinanceInboxView)
    ? (raw as FinanceInboxView)
    : "todos";
}

function latestVersion(document: FinanceDocument) {
  return document.versions[0] ?? null;
}

function matchingStale(document: FinanceDocument): boolean {
  const extraction = latestVersion(document)?.extraction;
  return Boolean(extraction?.matching && extraction.matching.revisionNumber !== extraction.revisionNumber);
}

export function financeDocumentNextAction(document: FinanceDocument): string {
  const latest = latestVersion(document);
  if (!latest) return "Cargar original";
  if (latest.uploadStatus === "failed" || document.status === "upload_failed") return "Reintentar carga";
  if (latest.uploadStatus === "pending_upload" || document.status === "pending_upload") return "Completar carga";
  if (document.status === "rejected" || document.status === "quarantined" || latest.inspectionStatus === "rejected" || latest.inspectionStatus === "quarantined") {
    return "Revisar excepción";
  }
  if (["pending", "scanning", "scanner_unavailable"].includes(latest.inspectionStatus)) return "Inspeccionar";
  const extraction = latest.extraction;
  if (latest.inspectionStatus === "ready_for_extraction" && (!extraction || extraction.status === "failed")) {
    return extraction?.status === "failed" ? "Reintentar extracción" : "Extraer datos";
  }
  if (extraction && ["needs_review", "ready_for_review"].includes(extraction.status)) return "Revisar datos";
  if (extraction?.status === "reviewed" && (!extraction.matching || extraction.matching.status === "proposed" || matchingStale(document))) {
    return extraction.matching ? "Confirmar coincidencias" : "Buscar coincidencias";
  }
  if (extraction?.matching?.status === "confirmed" && extraction.draft?.status !== "approved") {
    return extraction.draft ? "Revisar borradores" : "Preparar borradores";
  }
  if (extraction?.draft?.status === "approved" || document.status === "approved") return "Ver en operación";
  return "Abrir documento";
}

export function financeDocumentInboxKind(document: FinanceDocument): Exclude<FinanceInboxView, "todos"> | null {
  const latest = latestVersion(document);
  const extraction = latest?.extraction;
  if (
    document.status === "rejected"
    || document.status === "quarantined"
    || document.status === "upload_failed"
    || latest?.uploadStatus === "failed"
    || latest?.inspectionStatus === "rejected"
    || latest?.inspectionStatus === "quarantined"
    || extraction?.status === "failed"
  ) {
    return "excepcion";
  }
  if (document.status === "approved" || extraction?.draft?.status === "approved") return "aprobados";
  if (extraction?.draft?.status === "draft") return "borradores";
  if (extraction?.matching?.status === "proposed" || matchingStale(document)) return "matching";
  return "revisar";
}

export function financeDocumentMatchesQuery(document: FinanceDocument, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const latest = latestVersion(document);
  const payload = latest?.extraction?.payload;
  const haystack = [
    document.title,
    document.documentType,
    document.status,
    financeDocumentNextAction(document),
    latest?.originalFilename,
    payload?.supplier_name,
    payload?.supplier_tax_id,
    payload?.document_number,
  ].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(q);
}

export function filterFinanceInbox(
  documents: FinanceDocument[],
  view: FinanceInboxView,
  query = "",
): FinanceDocument[] {
  return documents.filter(document => {
    if (!financeDocumentMatchesQuery(document, query)) return false;
    if (view === "todos") return true;
    return financeDocumentInboxKind(document) === view;
  });
}

export function countFinanceInboxViews(documents: FinanceDocument[]): Record<FinanceInboxView, number> {
  const counts: Record<FinanceInboxView, number> = {
    todos: documents.length,
    revisar: 0,
    matching: 0,
    borradores: 0,
    aprobados: 0,
    excepcion: 0,
  };
  for (const document of documents) {
    const kind = financeDocumentInboxKind(document);
    if (kind) counts[kind] += 1;
  }
  return counts;
}

export function financeDocumentAgeLabel(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "sin fecha";
  const minutes = Math.max(0, Math.floor((now - then) / 60_000));
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} días`;
}
