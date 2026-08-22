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
  RefreshCw,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import PageHeader from '@/components/shared/PageHeader';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useOrg } from '@/lib/orgContext';
import {
  createFinanceDocumentSignedUrl,
  createFinanceDocumentUpload,
  createFinanceDocumentVersion,
  financeDocumentStatusLabel,
  financeDocumentTypeLabel,
  getFinanceDocuments,
  markFinanceDocumentUploadFailed,
  sha256File,
  uploadFinanceDocument,
  validateFinanceDocumentFile,
  type FinanceDocument,
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
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">El hash está declarado por la carga. La verificación server-side y el antivirus son el siguiente paso antes de habilitar extracción.</p>
          </div>
        </aside>
      </section>

      <section className="rounded-[12px] border border-border/70 bg-card">
        <div className="flex flex-col gap-2 border-b border-border/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-sm font-semibold">Bandeja de documentos</h2><p className="mt-1 text-xs text-muted-foreground">Los originales se abren con una URL firmada de corta duración.</p></div>
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{documents.length} registrados</span>
        </div>
        {loading ? <div className="flex items-center justify-center py-14 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Leyendo documentos...</div> : documents.length === 0 ? <EmptyState /> : <div className="divide-y divide-border/60">{documents.map(document => <DocumentRow key={document.id} document={document} openingPath={openingPath} onOpen={openDocument} onNewVersion={id => { clearFile(); setNewVersionFor(id); }} />)}</div>}
      </section>

      <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-3">
        <Contract icon={FileLock2} title="Privado" detail="Bucket no público y permisos por organización." />
        <Contract icon={FileSearch2} title="Revisable" detail="La inspección ocurre antes de extracción." />
        <Contract icon={FileCheck2} title="Sin efectos prematuros" detail="Aprobar será una acción explícita y auditable." />
      </div>
    </div>
  );
}

function DocumentRow({ document, openingPath, onOpen, onNewVersion }: { document: FinanceDocument; openingPath: string | null; onOpen: (path: string) => void; onNewVersion: (id: string) => void }) {
  const latest = document.versions[0];
  const canVersion = document.status !== 'approved';
  return (
    <article className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-border bg-muted/20 text-muted-foreground"><FileText className="h-4 w-4" /></span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-medium">{document.title}</h3><StatusBadge status={document.status} /></div>
          <p className="mt-1 text-xs text-muted-foreground">{financeDocumentTypeLabel(document.documentType)} · {latest ? `v${latest.versionNumber} · ${formatBytes(latest.sizeBytes)}` : 'sin versión'}</p>
          {latest && <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground/70">SHA-256 {latest.sha256.slice(0, 16)}... · {latest.hashStatus === 'declared' ? 'declarado' : latest.hashStatus}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        {latest && latest.uploadStatus === 'uploaded' && <Button variant="outline" size="xs" disabled={openingPath === latest.storagePath} onClick={() => onOpen(latest.storagePath)}><FileCheck2 /> {openingPath === latest.storagePath ? 'Abriendo...' : 'Ver original'}</Button>}
        {canVersion && <Button variant="ghost" size="xs" onClick={() => onNewVersion(document.id)}><FilePlus2 /> Nueva versión</Button>}
      </div>
    </article>
  );
}

function StatusBadge({ status }: { status: FinanceDocumentStatus }) {
  const variant = status === 'approved' ? 'success' : status === 'rejected' || status === 'upload_failed' ? 'destructive' : status === 'awaiting_inspection' || status === 'pending_upload' ? 'warning' : 'blue';
  return <Badge variant={variant}>{status === 'awaiting_inspection' ? <FileClock className="h-3 w-3" /> : status === 'approved' ? <CheckCircle2 className="h-3 w-3" /> : <Clock3 className="h-3 w-3" />}{financeDocumentStatusLabel(status)}</Badge>;
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

function errorMessage(cause: unknown, fallback: string) {
  if (cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string') return cause.message;
  return fallback;
}
