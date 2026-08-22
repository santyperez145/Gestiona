import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  FileCheck2,
  FileClock,
  FileLock2,
  FilePlus2,
  FileSearch2,
  FileText,
  Loader2,
  LockKeyhole,
  PencilLine,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import PageHeader from '@/components/shared/PageHeader';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useOrg } from '@/lib/orgContext';
import {
  createFinanceDocumentSignedUrl,
  createFinanceDocumentUpload,
  createFinanceDocumentVersion,
  extractFinanceDocument,
  financeDocumentStatusLabel,
  financeDocumentTypeLabel,
  getFinanceDocuments,
  inspectFinanceDocument,
  markFinanceDocumentUploadFailed,
  reviewFinanceDocumentExtraction,
  sha256File,
  uploadFinanceDocument,
  validateFinanceDocumentFile,
  type FinanceDocument,
  type FinanceDocumentExtraction,
  type FinanceDocumentExtractionPayload,
  type FinanceDocumentStatus,
  type FinanceDocumentType,
  type FinanceUploadIntent,
} from '@/lib/financeDocumentUpload';

const DOCUMENT_TYPES: FinanceDocumentType[] = ['supplier_invoice', 'receipt', 'purchase_order', 'other'];

export default function FinanceDocumentsPage() {
  usePageTitle('Documentos · Finance');
  const { activeOrg } = useOrg();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<FinanceDocument[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState<FinanceDocumentType>('supplier_invoice');
  const [newVersionFor, setNewVersionFor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const [inspectingVersionId, setInspectingVersionId] = useState<string | null>(null);
  const [extractingVersionId, setExtractingVersionId] = useState<string | null>(null);
  const [reviewTarget, setReviewTarget] = useState<FinanceDocumentExtraction | null>(null);
  const [reviewPayload, setReviewPayload] = useState<FinanceDocumentExtractionPayload | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadDocuments = async () => {
    if (!activeOrg?.id) return;
    setLoading(true);
    try {
      setDocuments(await getFinanceDocuments(activeOrg.id));
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause, 'No se pudo leer la bandeja documental.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDocuments();
  }, [activeOrg?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearFile = () => {
    setSelectedFile(null);
    setNewVersionFor(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const selectFile = (file: File | undefined) => {
    if (!file) return;
    const validationError = validateFinanceDocumentFile(file);
    if (validationError) {
      setError(validationError);
      clearFile();
      return;
    }
    setError(null);
    setNotice(null);
    setSelectedFile(file);
  };

  const submitUpload = async () => {
    if (!activeOrg?.id || !selectedFile) return;
    const validationError = validateFinanceDocumentFile(selectedFile);
    if (validationError) {
      setError(validationError);
      return;
    }

    setUploading(true);
    setError(null);
    setNotice(null);
    let intent: FinanceUploadIntent | null = null;
    try {
      const hash = await sha256File(selectedFile);
      intent = newVersionFor
        ? await createFinanceDocumentVersion(newVersionFor, selectedFile, hash)
        : await createFinanceDocumentUpload(activeOrg.id, documentType, selectedFile, hash);
      await uploadFinanceDocument(intent, selectedFile);
      setNotice(newVersionFor ? 'Nueva versión guardada. Quedó esperando inspección.' : 'Documento guardado. Quedó esperando inspección.');
      clearFile();
      await loadDocuments();
    } catch (cause) {
      if (intent) {
        try {
          await markFinanceDocumentUploadFailed(intent, errorMessage(cause, 'Error de transferencia'));
        } catch {
          // La intención queda visible para soporte si tampoco se puede auditar el fallo.
        }
      }
      setError(errorMessage(cause, 'No se pudo completar la carga.'));
    } finally {
      setUploading(false);
    }
  };

  const openDocument = async (storagePath: string) => {
    setOpeningPath(storagePath);
    setError(null);
    try {
      const url = await createFinanceDocumentSignedUrl(storagePath);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (cause) {
      setError(errorMessage(cause, 'No se pudo generar el acceso temporal al original.'));
    } finally {
      setOpeningPath(null);
    }
  };

  const inspectDocument = async (documentId: string, versionId: string) => {
    setInspectingVersionId(versionId);
    setError(null);
    setNotice(null);
    try {
      const result = await inspectFinanceDocument(documentId, versionId);
      if (!result) {
        setNotice('La versión ya tenía un estado final de inspección.');
      } else if (result.inspection_status === 'ready_for_extraction') {
        setNotice('Integridad, formato y scanner confirmados. El documento quedó listo para extracción.');
      } else if (result.inspection_status === 'duplicate') {
        setNotice('El contenido ya existía. Quedó marcado como duplicado para revisión, sin ejecutar OCR otra vez.');
      } else if (result.inspection_status === 'scanner_unavailable') {
        setError('El original pasó la lectura server-side, pero el scanner privado no está disponible. Sigue bloqueado antes de extracción.');
      } else if (result.inspection_status === 'quarantined') {
        setError('La inspección encontró una diferencia o contenido riesgoso. El original quedó aislado en cuarentena.');
      } else {
        setError('La inspección no habilitó este documento para extracción.');
      }
      await loadDocuments();
    } catch (cause) {
      setError(errorMessage(cause, 'No se pudo inspeccionar el documento.'));
    } finally {
      setInspectingVersionId(null);
    }
  };

  const extractDocument = async (documentId: string, versionId: string) => {
    setExtractingVersionId(versionId);
    setError(null);
    setNotice(null);
    try {
      const result = await extractFinanceDocument(documentId, versionId);
      if (!result) {
        setNotice('La última extracción ya está disponible para revisión.');
      } else if (result.extraction_status === 'ready_for_review') {
        setNotice(`Borrador estructurado listo · ${Math.round(Number(result.overall_confidence || 0) * 100)}% de confianza.`);
      } else if (result.extraction_status === 'needs_review') {
        setNotice('La extracción terminó con campos que requieren revisión humana.');
      } else {
        setError('La extracción no produjo un borrador revisable.');
      }
      await loadDocuments();
    } catch (cause) {
      setError(errorMessage(cause, 'No se pudo extraer el documento.'));
      await loadDocuments();
    } finally {
      setExtractingVersionId(null);
    }
  };

  const openReview = (extraction: FinanceDocumentExtraction) => {
    if (!extraction.payload) return;
    setReviewTarget(extraction);
    setReviewPayload(clonePayload(extraction.payload));
    setReviewNote('');
  };

  const submitReview = async () => {
    if (!reviewTarget || !reviewPayload) return;
    setReviewing(true);
    setError(null);
    try {
      await reviewFinanceDocumentExtraction(reviewTarget.id, reviewPayload, reviewNote);
      setNotice('Revisión humana registrada como una nueva versión. Todavía no creó compras, deuda, stock ni asientos.');
      setReviewTarget(null);
      setReviewPayload(null);
      setReviewNote('');
      await loadDocuments();
    } catch (cause) {
      setError(errorMessage(cause, 'No se pudo guardar la revisión.'));
    } finally {
      setReviewing(false);
    }
  };

  const pending = documents.filter(document => document.status === 'awaiting_inspection' || document.status === 'pending_upload').length;
  const approved = documents.filter(document => document.status === 'approved').length;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={FileLock2}
        eyebrow="Gestiona Finance / Document Inbox"
        title="Documentos bajo custodia"
        description="Cada original entra privado, queda versionado y espera inspección antes de que cualquier dato pueda sugerir una compra, una obligación o un asiento."
        actions={(
          <Button variant="outline" size="sm" onClick={() => void loadDocuments()} disabled={loading || uploading}>
            <RefreshCw className={loading ? 'animate-spin' : ''} />Actualizar
          </Button>
        )}
      />

      {error && <Feedback tone="error" icon={XCircle}>{error}</Feedback>}
      {notice && <Feedback tone="success" icon={CheckCircle2}>{notice}</Feedback>}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_270px]">
        <div className="rounded-[12px] border border-teal-500/25 bg-card p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px] border border-teal-500/25 bg-teal-500/10 text-teal-600 dark:text-teal-300"><UploadCloud className="h-5 w-5" /></span>
            <div>
              <h2 className="text-sm font-semibold">{newVersionFor ? 'Subir nueva versión' : 'Capturar documento'}</h2>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">PDF, JPG, PNG o WEBP · hasta 10 MB · acceso privado por organización.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-[190px_minmax(0,1fr)]">
            {!newVersionFor && (
              <label className="space-y-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Tipo</span>
                <Select value={documentType} onValueChange={value => setDocumentType(value as FinanceDocumentType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_TYPES.map(type => <SelectItem key={type} value={type}>{financeDocumentTypeLabel(type)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
            )}
            <div className={newVersionFor ? 'sm:col-span-2' : ''}>
              <input ref={fileInputRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="sr-only" onChange={event => selectFile(event.target.files?.[0])} />
              <button type="button" onClick={() => fileInputRef.current?.click()} className="flex min-h-[82px] w-full items-center justify-between gap-4 rounded-[9px] border border-dashed border-border/80 bg-muted/15 px-4 text-left transition-colors hover:border-teal-500/50 hover:bg-teal-500/[0.04]">
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">{selectedFile?.name || 'Elegí un archivo original'}</span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">{selectedFile ? formatBytes(selectedFile.size) : 'El hash se calcula en el navegador antes de subirlo'}</span>
                </span>
                <FilePlus2 className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-300" />
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            {newVersionFor ? <button type="button" onClick={clearFile} className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">Cancelar nueva versión</button> : <span className="text-[11px] text-muted-foreground">La carga no crea deuda ni mueve stock.</span>}
            <Button size="sm" onClick={() => void submitUpload()} disabled={!selectedFile || uploading}>
              {uploading ? <Loader2 className="animate-spin" /> : <UploadCloud />} {uploading ? 'Guardando...' : newVersionFor ? 'Guardar versión' : 'Guardar documento'}
            </Button>
          </div>
        </div>

        <aside className="grid grid-cols-2 gap-3 lg:grid-cols-1">
          <Stat icon={FileText} label="Documentos" value={documents.length} />
          <Stat icon={Clock3} label="En inspección" value={pending} />
          <Stat icon={CheckCircle2} label="Aprobados" value={approved} />
          <div className="col-span-2 rounded-[10px] border border-amber-500/20 bg-amber-500/[0.04] p-4 lg:col-span-1">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-300"><LockKeyhole className="h-3.5 w-3.5" /><p className="text-[10px] font-semibold uppercase tracking-[0.1em]">Cadena de custodia</p></div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">El servidor recalcula hash, tamaño y firma binaria. Sólo un resultado limpio del scanner privado habilita extracción; si no está disponible, el documento sigue bloqueado.</p>
          </div>
        </aside>
      </section>

      <section className="rounded-[12px] border border-border/70 bg-card">
        <div className="flex flex-col gap-2 border-b border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-sm font-semibold">Bandeja de documentos</h2><p className="mt-1 text-xs text-muted-foreground">Los originales se abren con una URL firmada de corta duración.</p></div>
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{documents.length} registrados</span>
        </div>
        {loading ? <div className="flex items-center justify-center py-14 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Leyendo documentos...</div> : documents.length === 0 ? <EmptyState /> : <div className="divide-y divide-border/60">{documents.map(document => <DocumentRow key={document.id} document={document} openingPath={openingPath} inspectingVersionId={inspectingVersionId} extractingVersionId={extractingVersionId} onOpen={openDocument} onInspect={inspectDocument} onExtract={extractDocument} onReview={openReview} onNewVersion={id => { clearFile(); setNewVersionFor(id); }} />)}</div>}
      </section>

      <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-3">
        <Contract icon={FileLock2} title="Privado" detail="Bucket no público y permisos por organización." />
        <Contract icon={FileSearch2} title="Revisable" detail="La inspección ocurre antes de extracción." />
        <Contract icon={FileCheck2} title="Sin efectos prematuros" detail="Aprobar será una acción explícita y auditable." />
      </div>

      <ExtractionReviewDialog
        extraction={reviewTarget}
        payload={reviewPayload}
        note={reviewNote}
        saving={reviewing}
        onPayloadChange={setReviewPayload}
        onNoteChange={setReviewNote}
        onClose={() => { if (!reviewing) { setReviewTarget(null); setReviewPayload(null); } }}
        onSubmit={() => void submitReview()}
      />
    </div>
  );
}

function DocumentRow({ document, openingPath, inspectingVersionId, extractingVersionId, onOpen, onInspect, onExtract, onReview, onNewVersion }: { document: FinanceDocument; openingPath: string | null; inspectingVersionId: string | null; extractingVersionId: string | null; onOpen: (path: string) => void; onInspect: (documentId: string, versionId: string) => void; onExtract: (documentId: string, versionId: string) => void; onReview: (extraction: FinanceDocumentExtraction) => void; onNewVersion: (id: string) => void }) {
  const latest = document.versions[0];
  const extraction = latest?.extraction;
  const canVersion = document.status !== 'approved';
  const canInspect = latest?.uploadStatus === 'uploaded' && ['pending', 'scanner_unavailable'].includes(latest.inspectionStatus);
  const canExtract = latest?.inspectionStatus === 'ready_for_extraction' && (!extraction || extraction.status === 'failed');
  const canReview = extraction?.payload && ['needs_review', 'ready_for_review'].includes(extraction.status);
  return (
    <article className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-border bg-muted/20 text-muted-foreground"><FileText className="h-4 w-4" /></span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-medium">{document.title}</h3><StatusBadge status={document.status} /></div>
          <p className="mt-1 text-xs text-muted-foreground">{financeDocumentTypeLabel(document.documentType)} · {latest ? `v${latest.versionNumber} · ${formatBytes(latest.sizeBytes)}` : 'sin versión'}</p>
          {latest && <div className="mt-1 flex flex-wrap items-center gap-2"><p className="truncate font-mono text-[10px] text-muted-foreground/70">SHA-256 {latest.sha256.slice(0, 16)}... · {latest.hashStatus === 'declared' ? 'declarado' : latest.hashStatus}</p><InspectionBadge status={latest.inspectionStatus} /></div>}
          {latest?.failureReason && <p className="mt-1 max-w-2xl text-[11px] text-amber-700 dark:text-amber-300">{latest.failureReason}</p>}
          {extraction && <ExtractionSummary extraction={extraction} />}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        {latest && latest.uploadStatus === 'uploaded' && <Button variant="outline" size="xs" disabled={openingPath === latest.storagePath} onClick={() => onOpen(latest.storagePath)}><FileCheck2 /> {openingPath === latest.storagePath ? 'Abriendo...' : 'Ver original'}</Button>}
        {latest && canInspect && <Button size="xs" disabled={inspectingVersionId === latest.id} onClick={() => onInspect(document.id, latest.id)}>{inspectingVersionId === latest.id ? <Loader2 className="animate-spin" /> : <FileSearch2 />} {inspectingVersionId === latest.id ? 'Inspeccionando...' : 'Inspeccionar'}</Button>}
        {latest && canExtract && <Button size="xs" disabled={extractingVersionId === latest.id} onClick={() => onExtract(document.id, latest.id)}>{extractingVersionId === latest.id ? <Loader2 className="animate-spin" /> : <Sparkles />} {extractingVersionId === latest.id ? 'Extrayendo...' : extraction?.status === 'failed' ? 'Reintentar extracción' : 'Extraer datos'}</Button>}
        {extraction && canReview && <Button variant="outline" size="xs" onClick={() => onReview(extraction)}><PencilLine /> Revisar datos</Button>}
        {canVersion && <Button variant="ghost" size="xs" onClick={() => onNewVersion(document.id)}><FilePlus2 /> Nueva versión</Button>}
      </div>
    </article>
  );
}

function ExtractionSummary({ extraction }: { extraction: FinanceDocumentExtraction }) {
  const payload = extraction.payload;
  const confidence = extraction.overallConfidence === null ? null : Math.round(extraction.overallConfidence * 100);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
      <ExtractionBadge status={extraction.status} />
      {confidence !== null && <span className="tabular-nums">Confianza {confidence}%</span>}
      {payload && <span>{payload.supplier_name || 'Proveedor no detectado'} · {payload.items.length} líneas · {formatMoney(payload.total, payload.currency)}</span>}
      {extraction.validationErrors.length > 0 && <span className="text-amber-700 dark:text-amber-300">{extraction.validationErrors.length} observaciones</span>}
      {extraction.failureReason && <span className="text-destructive">{extraction.failureReason}</span>}
    </div>
  );
}

function ExtractionBadge({ status }: { status: FinanceDocumentExtraction['status'] }) {
  const config = {
    extracting: { label: 'Extrayendo', variant: 'blue' as const },
    needs_review: { label: 'Revisión prioritaria', variant: 'warning' as const },
    ready_for_review: { label: 'Listo para revisar', variant: 'success' as const },
    reviewed: { label: 'Revisado', variant: 'success' as const },
    failed: { label: 'Extracción fallida', variant: 'destructive' as const },
  }[status];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

function ExtractionReviewDialog({ extraction, payload, note, saving, onPayloadChange, onNoteChange, onClose, onSubmit }: { extraction: FinanceDocumentExtraction | null; payload: FinanceDocumentExtractionPayload | null; note: string; saving: boolean; onPayloadChange: (payload: FinanceDocumentExtractionPayload) => void; onNoteChange: (note: string) => void; onClose: () => void; onSubmit: () => void }) {
  if (!payload) return null;
  const setHeader = <K extends keyof Omit<FinanceDocumentExtractionPayload, 'items'>>(key: K, value: FinanceDocumentExtractionPayload[K]) => {
    onPayloadChange({ ...payload, [key]: value });
  };
  const setItem = (index: number, patch: Partial<FinanceDocumentExtractionPayload['items'][number]>) => {
    onPayloadChange({ ...payload, items: payload.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
  };
  const addItem = () => onPayloadChange({
    ...payload,
    items: [...payload.items, { description: '', sku: null, quantity: 1, unit_price: 0, line_total: 0, tax_rate: null }],
  });
  const removeItem = (index: number) => onPayloadChange({ ...payload, items: payload.items.filter((_, itemIndex) => itemIndex !== index) });

  return (
    <Dialog open={Boolean(extraction)} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Revisar extracción estructurada</DialogTitle>
          <p className="text-xs leading-relaxed text-muted-foreground">Cada guardado crea una revisión append-only. Confirmar estos datos no crea compras, obligaciones, stock ni asientos.</p>
        </DialogHeader>

        {extraction && extraction.validationErrors.length > 0 && (
          <div className="rounded-[9px] border border-amber-500/25 bg-amber-500/[0.05] p-3">
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">Observaciones del borrador del modelo</p>
            <ul className="mt-1.5 space-y-1 text-[11px] text-muted-foreground">
              {extraction.validationErrors.map(error => <li key={error}>· {error}</li>)}
            </ul>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ReviewField label="Proveedor"><Input value={payload.supplier_name || ''} onChange={event => setHeader('supplier_name', event.target.value || null)} /></ReviewField>
          <ReviewField label="CUIT"><Input value={payload.supplier_tax_id || ''} onChange={event => setHeader('supplier_tax_id', event.target.value || null)} /></ReviewField>
          <ReviewField label="Número"><Input value={payload.document_number || ''} onChange={event => setHeader('document_number', event.target.value || null)} /></ReviewField>
          <ReviewField label="Fecha"><Input type="date" value={payload.issue_date || ''} onChange={event => setHeader('issue_date', event.target.value || null)} /></ReviewField>
          <ReviewField label="Moneda">
            <Select value={payload.currency || '__none'} onValueChange={value => setHeader('currency', value === '__none' ? null : value as 'ARS' | 'USD')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="__none">Sin detectar</SelectItem><SelectItem value="ARS">ARS</SelectItem><SelectItem value="USD">USD</SelectItem></SelectContent>
            </Select>
          </ReviewField>
          <ReviewField label="Subtotal"><Input type="number" min="0" step="0.01" value={numberInput(payload.subtotal)} onChange={event => setHeader('subtotal', nullableNumber(event.target.value))} /></ReviewField>
          <ReviewField label="IVA / impuestos"><Input type="number" min="0" step="0.01" value={numberInput(payload.tax_total)} onChange={event => setHeader('tax_total', nullableNumber(event.target.value))} /></ReviewField>
          <ReviewField label="Total"><Input type="number" min="0" step="0.01" value={numberInput(payload.total)} onChange={event => setHeader('total', nullableNumber(event.target.value))} /></ReviewField>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">Líneas</p><p className="text-[11px] text-muted-foreground">Reconciliá cantidad × precio con el total de cada línea.</p></div><Button type="button" variant="outline" size="xs" onClick={addItem}><Plus />Agregar línea</Button></div>
          {payload.items.length === 0 ? (
            <div className="rounded-[9px] border border-dashed border-amber-500/30 p-5 text-center text-xs text-muted-foreground">Agregá al menos una línea para poder confirmar la revisión.</div>
          ) : payload.items.map((item, index) => (
            <div key={index} className="grid gap-2 rounded-[9px] border border-border/70 bg-muted/[0.08] p-3 lg:grid-cols-[minmax(180px,2fr)_120px_90px_120px_120px_90px_32px]">
              <ReviewField label={`Descripción ${index + 1}`}><Input value={item.description} onChange={event => setItem(index, { description: event.target.value })} /></ReviewField>
              <ReviewField label="SKU"><Input value={item.sku || ''} onChange={event => setItem(index, { sku: event.target.value || null })} /></ReviewField>
              <ReviewField label="Cantidad"><Input type="number" min="0.0001" step="0.0001" value={numberInput(item.quantity)} onChange={event => setItem(index, { quantity: nullableNumber(event.target.value) })} /></ReviewField>
              <ReviewField label="Precio unitario"><Input type="number" min="0" step="0.01" value={numberInput(item.unit_price)} onChange={event => setItem(index, { unit_price: nullableNumber(event.target.value) })} /></ReviewField>
              <ReviewField label="Total línea"><Input type="number" min="0" step="0.01" value={numberInput(item.line_total)} onChange={event => setItem(index, { line_total: nullableNumber(event.target.value) })} /></ReviewField>
              <ReviewField label="IVA %"><Input type="number" min="0" step="0.01" value={numberInput(item.tax_rate)} onChange={event => setItem(index, { tax_rate: nullableNumber(event.target.value) })} /></ReviewField>
              <Button type="button" variant="ghost" size="icon" className="mt-[18px] h-8 w-8 text-muted-foreground hover:text-destructive" aria-label={`Quitar línea ${index + 1}`} onClick={() => removeItem(index)}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
          ))}
        </div>

        <ReviewField label="Nota de revisión"><Textarea value={note} maxLength={500} placeholder="Qué verificaste o corregiste (opcional)" onChange={event => onNoteChange(event.target.value)} /></ReviewField>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={onSubmit} disabled={saving || payload.items.length === 0}>{saving ? <Loader2 className="animate-spin" /> : <FileCheck2 />}{saving ? 'Guardando...' : 'Confirmar revisión'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewField({ label, children }: { label: string; children: React.ReactNode }) {
  return <Label className="space-y-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"><span>{label}</span>{children}</Label>;
}

function StatusBadge({ status }: { status: FinanceDocumentStatus }) {
  const variant = status === 'approved' ? 'success' : status === 'rejected' || status === 'upload_failed' || status === 'quarantined' ? 'destructive' : status === 'awaiting_inspection' || status === 'pending_upload' ? 'warning' : 'blue';
  return <Badge variant={variant}>{status === 'awaiting_inspection' ? <FileClock className="h-3 w-3" /> : status === 'approved' ? <CheckCircle2 className="h-3 w-3" /> : <Clock3 className="h-3 w-3" />}{financeDocumentStatusLabel(status)}</Badge>;
}

function InspectionBadge({ status }: { status: FinanceDocument['versions'][number]['inspectionStatus'] }) {
  const config = {
    pending: { label: 'Sin inspeccionar', variant: 'warning' as const },
    scanning: { label: 'Inspeccionando', variant: 'blue' as const },
    scanner_unavailable: { label: 'Scanner pendiente', variant: 'warning' as const },
    clean: { label: 'Limpio', variant: 'success' as const },
    ready_for_extraction: { label: 'Listo para extraer', variant: 'success' as const },
    duplicate: { label: 'Duplicado', variant: 'blue' as const },
    quarantined: { label: 'Cuarentena', variant: 'destructive' as const },
    rejected: { label: 'Rechazado', variant: 'destructive' as const },
  }[status];
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

function Stat({ icon: Icon, label, value }: { icon: typeof FileText; label: string; value: number }) {
  return <div className="rounded-[10px] border border-border/70 bg-card p-4"><Icon className="h-4 w-4 text-teal-500" /><p className="mt-3 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{value}</p></div>;
}

function Contract({ icon: Icon, title, detail }: { icon: typeof FileLock2; title: string; detail: string }) {
  return <div className="flex items-start gap-2.5 rounded-[9px] border border-border/60 bg-muted/10 p-3"><Icon className="mt-0.5 h-4 w-4 shrink-0 text-teal-500" /><div><p className="font-medium text-foreground/80">{title}</p><p className="mt-0.5 leading-relaxed">{detail}</p></div></div>;
}

function Feedback({ tone, icon: Icon, children }: { tone: 'error' | 'success'; icon: typeof XCircle; children: React.ReactNode }) {
  return <div className={`flex items-start gap-2 rounded-[8px] border p-3 text-sm ${tone === 'error' ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'border-emerald-500/25 bg-emerald-500/[0.05] text-emerald-700 dark:text-emerald-300'}`}><Icon className="mt-0.5 h-4 w-4 shrink-0" />{children}</div>;
}

function EmptyState() {
  return <div className="flex flex-col items-center justify-center px-6 py-14 text-center"><span className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-teal-500/20 bg-teal-500/10 text-teal-600 dark:text-teal-300"><FileText className="h-5 w-5" /></span><h3 className="mt-3 text-sm font-semibold">Todavía no hay documentos</h3><p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">El primer archivo se guarda como original privado y queda esperando inspección. Todavía no produce asientos ni deudas.</p></div>;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMoney(value: number | null, currency: FinanceDocumentExtractionPayload['currency']) {
  if (value === null || !currency) return 'total pendiente';
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency }).format(value);
}

function clonePayload(payload: FinanceDocumentExtractionPayload): FinanceDocumentExtractionPayload {
  return { ...payload, items: payload.items.map(item => ({ ...item })) };
}

function nullableNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberInput(value: number | null) {
  return value === null ? '' : String(value);
}

function errorMessage(cause: unknown, fallback: string) {
  if (cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string') return cause.message;
  return fallback;
}
