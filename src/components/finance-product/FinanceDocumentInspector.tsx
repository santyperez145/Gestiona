/**
 * Ficha Mendel F3 de un documento sin sacar al operador de la bandeja.
 * Selección en URL: `?documento=`. Los dialogs densos (revisión/matching/draft)
 * siguen aparte; acá van resumen, próxima acción y CTAs F3.
 */
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import WorkspaceState from "@/components/shared/WorkspaceState";
import {
  financeDocumentAgeLabel,
  financeDocumentNextAction,
} from "@/lib/financeDocumentInbox";
import {
  financeDocumentStatusLabel,
  financeDocumentTypeLabel,
  type FinanceDocument,
  type FinanceDocumentExtraction,
} from "@/lib/financeDocumentUpload";
import {
  ClipboardCheck,
  FileCheck2,
  FilePlus2,
  FileSearch2,
  Link2,
  Loader2,
  PencilLine,
  Sparkles,
} from "lucide-react";

interface Props {
  open: boolean;
  document: FinanceDocument | null;
  requestedId: string | null;
  loading?: boolean;
  online: boolean;
  openingPath: string | null;
  inspectingVersionId: string | null;
  extractingVersionId: string | null;
  matchingExtractionId: string | null;
  draftingExtractionId: string | null;
  onClose: () => void;
  onOpenOriginal: (path: string) => void;
  onInspect: (documentId: string, versionId: string) => void;
  onExtract: (documentId: string, versionId: string) => void;
  onReview: (extraction: FinanceDocumentExtraction) => void;
  onMatch: (extraction: FinanceDocumentExtraction) => void;
  onDraft: (extraction: FinanceDocumentExtraction) => void;
  onNewVersion: (documentId: string) => void;
}

export default function FinanceDocumentInspector({
  open,
  document,
  requestedId,
  loading,
  online,
  openingPath,
  inspectingVersionId,
  extractingVersionId,
  matchingExtractionId,
  draftingExtractionId,
  onClose,
  onOpenOriginal,
  onInspect,
  onExtract,
  onReview,
  onMatch,
  onDraft,
  onNewVersion,
}: Props) {
  const latest = document?.versions[0];
  const extraction = latest?.extraction;
  const next = document ? financeDocumentNextAction(document) : null;
  const canVersion = document ? document.status !== "approved" : false;
  const canInspect = latest?.uploadStatus === "uploaded"
    && ["pending", "scanner_unavailable"].includes(latest.inspectionStatus);
  const canExtract = latest?.inspectionStatus === "ready_for_extraction"
    && (!extraction || extraction.status === "failed");
  const matchingStale = Boolean(
    extraction?.matching && extraction.matching.revisionNumber !== extraction.revisionNumber,
  );
  const canReview = Boolean(
    extraction?.payload
    && extraction.draft?.status !== "approved"
    && ["needs_review", "ready_for_review", "reviewed"].includes(extraction.status),
  );
  const canMatch = Boolean(
    extraction?.payload
    && extraction.status === "reviewed"
    && (!extraction.matching || extraction.matching.status === "proposed" || matchingStale),
  );
  const canDraft = Boolean(
    document?.documentType === "supplier_invoice"
    && extraction?.matching?.status === "confirmed"
    && !matchingStale,
  );
  const payload = extraction?.payload;

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <SheetContent
        side="right"
        data-testid="finance-document-inspector"
        className="flex w-full flex-col p-0 sm:max-w-2xl"
      >
        {loading ? (
          <div className="flex h-full flex-col">
            <SheetHeader className="border-b border-border/60 px-5 pb-4 pt-5 pr-12 sm:px-6 sm:pt-6">
              <SheetTitle>Documento</SheetTitle>
              <SheetDescription>Leyendo la ficha sin salir de la bandeja.</SheetDescription>
            </SheetHeader>
            <WorkspaceState kind="initial-loading" title="Leyendo el documento" loadingRows={4} layout="embedded" />
          </div>
        ) : document ? (
          <>
            <SheetHeader className="mb-0 border-b border-border/60 px-5 pb-4 pt-5 pr-12 sm:px-6 sm:pt-6">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {financeDocumentStatusLabel(document.status)}
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  {financeDocumentTypeLabel(document.documentType)}
                </Badge>
              </div>
              <SheetTitle className="pr-2">{document.title}</SheetTitle>
              <SheetDescription>
                {financeDocumentAgeLabel(document.updatedAt)}
                {latest ? ` · v${latest.versionNumber}` : " · sin versión"}
                {` · Próxima acción: ${next}`}
              </SheetDescription>
            </SheetHeader>

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-5 px-5 py-5 sm:px-6">
                <section aria-labelledby="doc-proxima">
                  <h3 id="doc-proxima" className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Próxima acción
                  </h3>
                  <p className="rounded-lg border border-border/60 bg-muted/20 px-3 py-3 text-sm font-medium">
                    {next}
                  </p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    No crea asientos, deudas ni stock hasta que apruebes un borrador F3. Capacidades F5 no viven en esta ficha.
                  </p>
                </section>

                {payload ? (
                  <section aria-labelledby="doc-extraccion">
                    <h3 id="doc-extraccion" className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Extracción
                    </h3>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-border/60 bg-card p-3">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Proveedor</p>
                        <p className="mt-1 text-sm font-medium">{payload.supplier_name || "—"}</p>
                      </div>
                      <div className="rounded-lg border border-border/60 bg-card p-3">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">CUIT</p>
                        <p className="mt-1 font-mono text-sm">{payload.supplier_tax_id || "—"}</p>
                      </div>
                      <div className="rounded-lg border border-border/60 bg-card p-3">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Comprobante</p>
                        <p className="mt-1 text-sm font-medium">{payload.document_number || "—"}</p>
                      </div>
                      <div className="rounded-lg border border-border/60 bg-card p-3">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</p>
                        <p className="mt-1 text-sm font-semibold tabular-nums">
                          {payload.total != null
                            ? new Intl.NumberFormat("es-AR", {
                                style: "currency",
                                currency: payload.currency || "ARS",
                                maximumFractionDigits: 2,
                              }).format(Number(payload.total) || 0)
                            : "—"}
                        </p>
                      </div>
                    </div>
                  </section>
                ) : null}

                {latest?.failureReason ? (
                  <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-800 dark:text-amber-200">
                    {latest.failureReason}
                  </p>
                ) : null}

                <section aria-labelledby="doc-acciones" className="flex flex-wrap gap-2 pb-4">
                  <h3 id="doc-acciones" className="sr-only">Acciones</h3>
                  {latest && latest.uploadStatus === "uploaded" ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      disabled={!online || openingPath === latest.storagePath}
                      onClick={() => onOpenOriginal(latest.storagePath)}
                    >
                      <FileCheck2 className="h-4 w-4" />
                      {openingPath === latest.storagePath ? "Abriendo..." : "Ver original"}
                    </Button>
                  ) : null}
                  {latest && canInspect ? (
                    <Button
                      type="button"
                      className="min-h-11"
                      disabled={!online || inspectingVersionId === latest.id}
                      onClick={() => onInspect(document.id, latest.id)}
                    >
                      {inspectingVersionId === latest.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch2 className="h-4 w-4" />}
                      {inspectingVersionId === latest.id ? "Inspeccionando..." : "Inspeccionar"}
                    </Button>
                  ) : null}
                  {latest && canExtract ? (
                    <Button
                      type="button"
                      className="min-h-11"
                      disabled={!online || extractingVersionId === latest.id}
                      onClick={() => onExtract(document.id, latest.id)}
                    >
                      {extractingVersionId === latest.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      {extractingVersionId === latest.id
                        ? "Extrayendo..."
                        : extraction?.status === "failed"
                          ? "Reintentar extracción"
                          : "Extraer datos"}
                    </Button>
                  ) : null}
                  {extraction && canReview ? (
                    <Button type="button" variant="outline" className="min-h-11" disabled={!online} onClick={() => onReview(extraction)}>
                      <PencilLine className="h-4 w-4" />
                      {extraction.status === "reviewed" ? "Corregir revisión" : "Revisar datos"}
                    </Button>
                  ) : null}
                  {extraction && canMatch ? (
                    <Button
                      type="button"
                      className="min-h-11"
                      disabled={!online || matchingExtractionId === extraction.id}
                      onClick={() => onMatch(extraction)}
                    >
                      {matchingExtractionId === extraction.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                      {matchingExtractionId === extraction.id
                        ? "Buscando..."
                        : extraction.matching
                          ? "Confirmar matching"
                          : "Buscar coincidencias"}
                    </Button>
                  ) : null}
                  {extraction && canDraft ? (
                    <Button
                      type="button"
                      variant={extraction.draft?.status === "approved" ? "outline" : "default"}
                      className="min-h-11"
                      disabled={!online || draftingExtractionId === extraction.id}
                      onClick={() => onDraft(extraction)}
                    >
                      {draftingExtractionId === extraction.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
                      {draftingExtractionId === extraction.id
                        ? "Preparando..."
                        : extraction.draft?.status === "approved"
                          ? "Ver aprobación"
                          : extraction.draft
                            ? "Revisar borradores"
                            : "Preparar borradores"}
                    </Button>
                  ) : null}
                  {canVersion ? (
                    <Button type="button" variant="ghost" className="min-h-11" disabled={!online} onClick={() => onNewVersion(document.id)}>
                      <FilePlus2 className="h-4 w-4" />
                      Nueva versión
                    </Button>
                  ) : null}
                </section>
              </div>
            </ScrollArea>
          </>
        ) : (
          <div className="flex h-full flex-col">
            <SheetHeader className="border-b border-border/60 px-5 pb-4 pt-5 pr-12 sm:px-6 sm:pt-6">
              <SheetTitle>Documento</SheetTitle>
              <SheetDescription>
                {requestedId ? "No está en esta organización o ya no existe." : "Elegí un documento de la bandeja."}
              </SheetDescription>
            </SheetHeader>
            <WorkspaceState
              kind="empty-filtered"
              layout="embedded"
              title="Documento no disponible"
              description="El deep link no inventa filas de otra organización. Volvé a la bandeja o elegí otro."
              actionLabel="Cerrar"
              onAction={onClose}
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
