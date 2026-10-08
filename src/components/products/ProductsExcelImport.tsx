import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useOrg } from "@/lib/orgContext";
import { useModulePermissions } from "@/lib/usePermissions";
import { previewProductImportRow, productImportFormat, PRODUCT_IMPORT_MAX_BYTES, IMPORT_MAPPING_FIELDS, type ImportMapping } from "@/lib/productImport";
import { catalogMigrationSourceLabel } from "@/lib/catalogMigration";
import type { WorkbookImportOptions, WorkbookImportResult } from "@/lib/productImportWorkbook";
import { createProductImportReader } from "@/lib/productImportReader";
import {
  applyCatalogImportChunk, approveCatalogImport, cancelCatalogImport, catalogImportChunks, catalogImportErrorMessage,
  getCatalogImportSession, stageCatalogImportChunk, startCatalogImport, type CatalogImportSession,
} from "@/lib/catalogImportSession";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import FilePicker from "@/components/shared/FilePicker";
import { toast } from "sonner";
import { AlertCircle, ArrowLeft, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Download, FileCheck2, FileSpreadsheet, Loader2, PackageCheck, Pause, Play, ShieldCheck, Upload, X } from "lucide-react";

const PAGE_SIZE = 50;
type Step = "upload" | "preview" | "staged" | "done";
type StagedRow = { id: string; session_position: number; action: string; normalized: Json; validation_errors: string[]; validation_warnings: string[]; status: string };
type HistoryRow = { id: string; filename: string; status: string; total: number; prepared: number; applied: number };
const statusLabels: Record<string, string> = { preparing: "Validación pendiente", ready: "Por aprobar", applying: "Aplicación pendiente", completed: "Finalizada", cancelled: "Cancelada" };
const ars = (value: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 }).format(value || 0);
const object = (value: Json): Record<string, Json | undefined> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Json | undefined> : {};

function SelectField({ label, value, options, onChange, disabled }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; disabled?: boolean }) {
  return <div className="min-w-0 space-y-1"><Label className="text-xs">{label}</Label><Select value={value || "__none"} onValueChange={value => onChange(value === "__none" ? "" : value)} disabled={disabled}>
    <SelectTrigger aria-label={label} className="h-10 w-full text-sm"><SelectValue /></SelectTrigger><SelectContent>{options.map(option => <SelectItem key={option.value || "__none"} value={option.value || "__none"}>{option.label}</SelectItem>)}</SelectContent>
  </Select></div>;
}
function SummaryCard({ label, value }: { label: string; value: number }) {
  return <div className="min-w-0 border-b border-border py-2"><p className="text-xs text-muted-foreground">{label}</p><p className="text-xl font-semibold">{(value || 0).toLocaleString("es-AR")}</p></div>;
}
function Pagination({ page, total, onPage, disabled }: { page: number; total: number; onPage: (page: number) => void; disabled?: boolean }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return <div className="flex items-center justify-between gap-2 py-2 text-xs text-muted-foreground"><span>{total ? page * PAGE_SIZE + 1 : 0}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total.toLocaleString("es-AR")}</span>
    <div className="flex items-center gap-2"><Button variant="outline" size="icon" title="Página anterior" aria-label="Página anterior" disabled={disabled || page === 0} onClick={() => onPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button><span>{page + 1} / {pages}</span><Button variant="outline" size="icon" title="Página siguiente" aria-label="Página siguiente" disabled={disabled || page + 1 >= pages} onClick={() => onPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button></div>
  </div>;
}

export default function ProductsExcelImport({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { activeOrg, activeRole } = useOrg();
  const permissions = useModulePermissions("products");
  const orgId = activeOrg?.id;
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [workbook, setWorkbook] = useState<WorkbookImportResult | null>(null);
  const [stage, setStage] = useState<CatalogImportSession | null>(null);
  const [stagedRows, setStagedRows] = useState<StagedRow[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [rowLoading, setRowLoading] = useState(false);
  const [error, setError] = useState("");
  const [contextError, setContextError] = useState("");
  const [contextLoading, setContextLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [validationFilter, setValidationFilter] = useState("all");
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [stockMode, setStockMode] = useState<"replace" | "ignore">("replace");
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [locationId, setLocationId] = useState("");
  const [stores, setStores] = useState<{ id: string; name: string; is_primary: boolean }[]>([]);
  const [destinationStoreId, setDestinationStoreId] = useState("");
  const [exchangeRate, setExchangeRate] = useState(0);
  const [marginPercent, setMarginPercent] = useState(80);
  const [autoPrice, setAutoPrice] = useState(false);
  const [currencyConfirmed, setCurrencyConfirmed] = useState(false);
  const [mirrorState, setMirrorState] = useState({ busy: false, mirrored: 0, remaining: false, failed: 0, done: false });
  const reader = useRef<ReturnType<typeof createProductImportReader> | null>(null);
  const alive = useRef(true);
  const stop = useRef(false);
  const sessionId = useRef<string | null>(null);
  const validationRequest = useRef(0);
  const currentOrg = useRef(orgId);
  const contextVersion = useRef(0);
  if (currentOrg.current !== orgId) { currentOrg.current = orgId; contextVersion.current += 1; }
  const contextStamp = contextVersion.current;
  const canImport = !permissions.loading && permissions.canView && (activeRole === "owner" || activeRole === "admin");
  const rows = useMemo(() => workbook?.parsed.products || [], [workbook]);
  const migration = workbook?.parsed;
  const pageRows = useMemo(() => rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [rows, page]);
  const previews = useMemo(() => pageRows.map(row => previewProductImportRow(row, { exchangeRate, defaultMarginPercent: marginPercent, autoFillSalePrice: autoPrice })), [pageRows, exchangeRate, marginPercent, autoPrice]);
  const needsLocation = stockMode === "replace" && locations.length > 1 && rows.some(row => row.provided.includes("stock"));
  const validContext = (expectedOrg: string) => alive.current && currentOrg.current === expectedOrg && contextVersion.current === contextStamp;

  function reportError(cause: unknown, fallback: string) {
    console.error("[catalog-import]", cause);
    const message = catalogImportErrorMessage(cause, fallback);
    setError(message); toast.error(message);
  }
  async function loadHistory(expectedOrg: string) {
    const { data, error } = await supabase.from("catalog_import_sessions").select("id, filename, status, total, prepared, applied").eq("org_id", expectedOrg).neq("status", "cancelled").order("created_at", { ascending: false }).limit(20);
    if (error) throw error;
    if (validContext(expectedOrg)) setHistory(data || []);
  }
  async function loadContext(expectedOrg: string) {
    setContextError(""); setContextLoading(true);
    try {
      const [settings, locationResult, storeResult] = await Promise.all([
        supabase.from("settings").select("exchange_rate").eq("org_id", expectedOrg).maybeSingle(),
        supabase.from("locations").select("id, name").eq("org_id", expectedOrg).eq("active", true).order("name"),
        supabase.from("ecommerce_stores").select("id, name, is_primary").eq("org_id", expectedOrg).order("is_primary", { ascending: false }).order("name"),
      ]);
      if (!validContext(expectedOrg)) return;
      if (settings.error) console.error("[catalog-import:settings]", settings.error);
      else if (Number(settings.data?.exchange_rate) > 0) setExchangeRate(Number(settings.data?.exchange_rate));
      if (locationResult.error || storeResult.error) {
        console.error("[catalog-import:destinations]", locationResult.error || storeResult.error);
        setContextError("No pudimos cargar las sucursales y tiendas. Reintentá antes de preparar el archivo.");
      } else {
        setLocations(locationResult.data || []); setStores(storeResult.data || []);
        setLocationId(locationResult.data?.length === 1 ? locationResult.data[0].id : "");
        setDestinationStoreId("");
      }
    } catch (cause) {
      if (validContext(expectedOrg)) setContextError("No pudimos cargar las sucursales y tiendas. Reintentá antes de preparar el archivo.");
      throw cause;
    } finally {
      if (validContext(expectedOrg)) setContextLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true; stop.current = false;
    return () => { alive.current = false; stop.current = true; reader.current?.dispose(); reader.current = null; };
  }, []);
  useEffect(() => {
    stop.current = true; setStep("upload"); setStage(null); setWorkbook(null); setHistory([]); setFileName(""); setError(""); setBusy(false);
    setLocations([]); setStores([]); setLocationId(""); setDestinationStoreId(""); setExchangeRate(0); setContextError(""); setContextLoading(!!orgId && canImport);
    sessionId.current = null; validationRequest.current += 1;
    reader.current?.dispose(); reader.current = null;
    if (!orgId || !canImport) return;
    void loadContext(orgId).catch(cause => { if (validContext(orgId)) reportError(cause, "No pudimos cargar los destinos."); });
    void loadHistory(orgId).catch(cause => { if (validContext(orgId)) reportError(cause, "No pudimos cargar las importaciones pendientes. Reintentá."); });
    // Permissions and organization are the only owners of this context lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, canImport]);

  async function parseFile(file: File) {
    if (!orgId || !productImportFormat(file.name)) return void setError("Usá un archivo .xlsx, .xls o .csv.");
    if (file.size > PRODUCT_IMPORT_MAX_BYTES) return void setError("El archivo supera 50 MB.");
    setBusy(true); setError(""); const expectedOrg = orgId;
    try {
      reader.current?.dispose(); const currentReader = createProductImportReader(); reader.current = currentReader;
      const buffer = await file.arrayBuffer();
      if (!validContext(expectedOrg)) return;
      const next = await currentReader.read(buffer, file.name, stage?.status === "preparing" ? { mapping: stage.source_system === "shopify" || stage.source_system === "tiendanube" ? undefined : stage.options.mapping, costCurrency: stage.options.cost_currency, sheetName: stage.options.sheet_name, headerRow: stage.options.header_row } : undefined);
      if (!validContext(expectedOrg)) return;
      if (stage && (file.name !== stage.filename || next.fingerprint !== stage.options.fingerprint || next.parsed.products.length !== stage.total)) throw new Error("Seleccioná el mismo archivo original para reanudar esta importación.");
      setWorkbook(next); setCurrencyConfirmed(!next.costCurrencyAmbiguous); setFileName(file.name); setPage(0); setStep("preview");
    } catch (cause) { if (validContext(expectedOrg)) reportError(cause, "No pudimos leer el archivo. Revisá el formato y reintentá."); }
    finally { if (validContext(expectedOrg)) setBusy(false); }
  }
  async function remap(options: WorkbookImportOptions) {
    if (!reader.current || !workbook || stage || !orgId) return;
    const expectedOrg = orgId; setBusy(true); setError("");
    try {
      const next = await reader.current.read(undefined, undefined, options);
      if (validContext(expectedOrg)) { setWorkbook(next); setCurrencyConfirmed(!next.costCurrencyAmbiguous); setPage(0); }
    } catch (cause) { if (validContext(expectedOrg)) reportError(cause, "No pudimos aplicar el mapeo."); }
    finally { if (validContext(expectedOrg)) setBusy(false); }
  }
  async function loadStagedRows(session: CatalogImportSession, nextPage: number, filter: string) {
    const request = ++validationRequest.current;
    setRowLoading(true);
    try {
      let query = supabase.from("product_import_rows").select("id, session_position, action, normalized, validation_errors, validation_warnings, status").eq("session_id", session.id).eq("org_id", session.org_id);
      if (filter === "invalid") query = query.eq("action", "invalid");
      const { data, error } = await query.order("session_position").range(nextPage * PAGE_SIZE, (nextPage + 1) * PAGE_SIZE - 1);
      if (error) throw error;
      if (validContext(session.org_id) && request === validationRequest.current) setStagedRows((data || []) as StagedRow[]);
    } catch (cause) { if (validContext(session.org_id) && request === validationRequest.current) reportError(cause, "No pudimos cargar esta página de validaciones."); }
    finally { if (validContext(session.org_id) && request === validationRequest.current) setRowLoading(false); }
  }
  useEffect(() => {
    if (stage && step === "staged") void loadStagedRows(stage, page, validationFilter);
    // Rows belong to a session/page/filter; applying progress does not refetch them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage?.id, step, page, validationFilter]);

  async function prepare() {
    if (!orgId || !workbook || !canImport || busy || contextLoading || contextError) return;
    if (!currencyConfirmed) return void setError("Confirmá la moneda del costo antes de validar.");
    if (workbook.profile !== "platform" && !workbook.mapping.name) return void setError("Elegí la columna Nombre del producto antes de validar.");
    if (rows.some(row => row.provided.includes("cost_usd")) && exchangeRate <= 0) return void setError("Ingresá una cotización USD válida.");
    if (needsLocation && !locationId) return void setError("Elegí la sucursal del stock.");
    const expectedOrg = orgId; stop.current = false; setBusy(true); setError("");
    try {
      const chunks = catalogImportChunks(rows);
      sessionId.current ||= stage?.id || crypto.randomUUID();
      let next = await startCatalogImport(stage || { id: sessionId.current, org_id: orgId, filename: fileName, source_format: productImportFormat(fileName)!, source_system: workbook.parsed.source, total: rows.length, source_rows: workbook.parsed.sourceRows,
        options: { stock_mode: stockMode, location_id: locationId, destination_store_id: destinationStoreId, exchange_rate: exchangeRate, margin_percent: marginPercent, auto_price: autoPrice, mapping: workbook.mapping, cost_currency: workbook.costCurrency, sheet_name: workbook.sheetName, header_row: workbook.headerRow, fingerprint: workbook.fingerprint || "" } });
      if (!validContext(expectedOrg)) return;
      setStage(next);
      for (const chunk of chunks) {
        if (stop.current || !validContext(expectedOrg)) return;
        if (chunk.position < next.prepared) continue;
        next = await stageCatalogImportChunk(next.id, chunk.position, chunk.rows);
        if (validContext(expectedOrg)) setStage(next);
      }
      if (validContext(expectedOrg)) { setPage(0); setValidationFilter("all"); setStep("staged"); await loadHistory(expectedOrg); }
    } catch (cause) { if (validContext(expectedOrg)) reportError(cause, "La validación se interrumpió. Reintentá para retomar desde el último lote confirmado."); }
    finally { if (validContext(expectedOrg)) setBusy(false); }
  }
  async function apply() {
    if (!stage || !canImport || busy || (stage.creates > 0 && !permissions.canCreate) || (stage.updates > 0 && !permissions.canEdit)) return;
    const expectedOrg = stage.org_id; setBusy(true); setError(""); stop.current = false;
    try {
      let next = await approveCatalogImport(stage.id, skipInvalid);
      if (!validContext(expectedOrg)) return;
      setStage(next);
      while (next.status === "applying") {
        if (stop.current || !validContext(expectedOrg)) return;
        const previousApplied = next.applied;
        next = await applyCatalogImportChunk(next.id, previousApplied);
        if (next.applied <= previousApplied) throw new Error("El servidor no confirmó avance. Recuperá el estado antes de continuar.");
        if (validContext(expectedOrg)) setStage(next);
      }
      if (!next.reconciled) throw new Error("La importación no terminó de reconciliarse. Reanudá los lotes pendientes.");
      if (validContext(expectedOrg)) { setStep("done"); onImported(); toast.success("Catálogo importado y reconciliado"); await loadHistory(expectedOrg); }
    } catch (cause) { if (validContext(expectedOrg)) { onImported(); reportError(cause, "Este lote no pudo aplicarse. Los anteriores se conservan; reintentá para continuar sin duplicarlos."); } }
    finally { if (validContext(expectedOrg)) setBusy(false); }
  }
  async function resume(id: string) {
    if (!orgId || busy) return;
    setBusy(true); setError(""); const expectedOrg = orgId;
    try {
      const next = await getCatalogImportSession(id);
      if (!validContext(expectedOrg)) return;
      setStage(next); setFileName(next.filename); setPage(0); setSkipInvalid(next.skip_invalid); setValidationFilter("all");
      setStockMode(next.options.stock_mode); setLocationId(next.options.location_id); setDestinationStoreId(next.options.destination_store_id);
      setExchangeRate(next.options.exchange_rate); setMarginPercent(next.options.margin_percent); setAutoPrice(next.options.auto_price);
      setStep(next.status === "completed" ? "done" : next.status === "preparing" ? "upload" : "staged");
    } catch (cause) { if (validContext(expectedOrg)) reportError(cause, "No pudimos recuperar esta importación."); }
    finally { if (validContext(expectedOrg)) setBusy(false); }
  }
  function reset() {
    sessionId.current = null; validationRequest.current += 1;
    stop.current = true; setWorkbook(null); setFileName(""); setStage(null); setStagedRows([]); setSkipInvalid(false); setPage(0); setError(""); setStep("upload");
    reader.current?.dispose(); reader.current = null; setMirrorState({ busy: false, mirrored: 0, remaining: false, failed: 0, done: false });
  }
  async function discard() {
    if (!stage || busy) return;
    const expectedOrg = stage.org_id; setBusy(true); setError("");
    try { await cancelCatalogImport(stage.id); if (validContext(expectedOrg)) { reset(); await loadHistory(expectedOrg); } }
    catch (cause) { if (validContext(expectedOrg)) reportError(cause, "No pudimos cancelar la importación. Reintentá."); }
    finally { if (validContext(expectedOrg)) setBusy(false); }
  }
  async function mirrorImages() {
    if (!stage || mirrorState.busy || !orgId) return;
    const expectedOrg = orgId; setMirrorState(state => ({ ...state, busy: true })); setError("");
    try {
      const { data: chunks, error } = await supabase.from("catalog_import_chunks").select("batch_id").eq("session_id", stage.id).order("position");
      if (error) throw error;
      let mirrored = 0; let failed = 0; let remaining = false;
      for (const chunk of chunks || []) {
        if (!validContext(expectedOrg)) return;
        const { data, error: copyError } = await supabase.functions.invoke("copy-product-images", { body: { batch_id: chunk.batch_id } });
        if (copyError) throw copyError;
        const next = data as { done?: boolean; mirrored?: number; failed_count?: number };
        mirrored += next.mirrored || 0; failed += next.failed_count || 0; remaining ||= !next.done;
      }
      if (validContext(expectedOrg)) setMirrorState(state => ({ busy: false, mirrored: state.mirrored + mirrored, failed, remaining, done: !remaining && !failed }));
    } catch (cause) { if (validContext(expectedOrg)) { setMirrorState(state => ({ ...state, busy: false })); reportError(cause, "No pudimos copiar todas las imágenes. Reintentá."); } }
  }
  async function downloadTemplate() {
    const { utils, writeFile } = await import("xlsx");
    const sheet = utils.json_to_sheet([{ Nombre: "Producto de ejemplo", Marca: "Marca Ejemplo", Rubro: "Herramientas", SKU: "EJM-001", "Código de barras": "7891234567890", "Costo ARS": 10000, "Precio Venta ARS": 15000, Stock: 10, "Descripción adicional": "Descripción del producto" }]);
    const template = utils.book_new(); utils.book_append_sheet(template, sheet, "Productos"); writeFile(template, "plantilla_productos_nerqia.xlsx");
  }
  if (permissions.loading) return <div className="flex items-center gap-2 p-5"><Loader2 className="h-4 w-4 animate-spin" />Verificando permisos</div>;
  if (!canImport) return <div className="space-y-4 p-5"><Alert variant="warning"><ShieldCheck className="h-4 w-4" /><div><AlertTitle>Importación reservada a propietarios y administradores</AlertTitle><AlertDescription className="text-foreground opacity-100">Necesitás permiso para ver productos y para crear o editar las filas que se aplicarán.</AlertDescription></div></Alert><Button variant="outline" onClick={onClose}>Cerrar</Button></div>;

  return <div className="h-full overflow-y-auto overscroll-contain bg-card">
    <header className="sticky top-0 z-20 flex items-start justify-between gap-3 border-b border-border bg-card px-4 py-4 sm:px-7"><div className="flex items-center gap-3"><FileSpreadsheet className="h-6 w-6 shrink-0 text-primary" /><div><h3 className="font-semibold">Migrar catálogo</h3><p className="text-xs text-muted-foreground">{fileName || "Excel y CSV · hasta 50.000 productos · 50 MB"}</p></div></div><Button variant="ghost" size="icon" title="Cerrar" aria-label="Cerrar" onClick={() => { stop.current = true; onClose(); }}><X className="h-4 w-4" /></Button></header>
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-5 sm:px-7">
      <ol className="grid grid-cols-3 gap-2 border-b border-border pb-3 text-xs">{["Archivo y columnas", "Validación", "Resultado"].map((label, i) => <li key={label} className={i === (step === "done" ? 2 : step === "staged" ? 1 : 0) ? "font-semibold text-foreground" : "text-muted-foreground"}>{i + 1}. {label}</li>)}</ol>
      {error && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><div><AlertTitle>No pudimos completar este paso</AlertTitle><AlertDescription className="text-foreground opacity-100">{error}</AlertDescription><Button variant="outline" size="sm" className="mt-2" disabled={busy} onClick={() => { setError(""); if (stage) void resume(stage.id); else if (orgId) void loadHistory(orgId).catch(cause => reportError(cause, "No pudimos recuperar las importaciones.")); }}>Recuperar estado</Button></div></Alert>}
      {contextError && <Alert variant="warning"><AlertCircle className="h-4 w-4" /><div><AlertTitle>Destinos no disponibles</AlertTitle><AlertDescription className="text-foreground opacity-100">{contextError}</AlertDescription><Button variant="outline" size="sm" className="mt-2" onClick={() => orgId && void loadContext(orgId).catch(cause => reportError(cause, "No pudimos cargar los destinos."))}>Reintentar</Button></div></Alert>}
      {stage && stage.status !== "completed" && <div className="space-y-2 border-b border-border pb-3" aria-live="polite"><div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{statusLabels[stage.status]}</span><span>{stage.status === "applying" ? stage.applied : stage.prepared} / {stage.total.toLocaleString("es-AR")}</span></div><progress aria-label="Progreso de importación" className="h-2 w-full accent-primary" max={stage.total} value={stage.status === "applying" ? stage.applied : stage.prepared} />{busy && <Button variant="outline" size="sm" onClick={() => { stop.current = true; }}><Pause className="mr-2 h-4 w-4" />Pausar tras este lote</Button>}</div>}
      {step === "upload" && <section className="space-y-4">
        {stage?.status === "preparing" && <Alert variant="info"><FileCheck2 className="h-4 w-4" /><div><AlertTitle>Validación pendiente: {stage.filename}</AlertTitle><AlertDescription className="text-foreground opacity-100">Seleccioná el mismo archivo para continuar. Las opciones originales se conservan; todavía no se cambió el catálogo.</AlertDescription></div></Alert>}
        <FilePicker accept=".xlsx,.xls,.csv" title={stage ? "Seleccionar archivo original" : "Seleccionar exportación de productos"} description="Excel o CSV · hasta 50.000 productos y 50 MB" icon={FileSpreadsheet} busy={busy} busyLabel="Leyendo catálogo" onFile={parseFile} />
        <div className="flex flex-wrap justify-between gap-2"><Button variant="outline" size="sm" disabled={busy} onClick={() => void downloadTemplate().catch(cause => reportError(cause, "No pudimos generar la plantilla."))}><Download className="mr-2 h-4 w-4" />Plantilla</Button>{stage && <Button variant="outline" size="sm" disabled={busy} onClick={() => void discard()}>Cancelar importación pendiente</Button>}</div>
        {!stage && history.length > 0 && <section className="space-y-2"><h4 className="text-sm font-semibold">Importaciones recientes</h4>{history.map(item => <div key={item.id} className="flex items-center justify-between gap-3 border-b border-border py-3"><div className="min-w-0"><p className="break-words text-sm font-medium">{item.filename}</p><p className="text-xs text-muted-foreground">{statusLabels[item.status]} · {item.applied} / {item.total.toLocaleString("es-AR")}</p></div><Button variant="outline" size="sm" disabled={busy} onClick={() => void resume(item.id)}>{item.status === "completed" ? "Ver resultado" : "Retomar"}</Button></div>)}</section>}
      </section>}
      {step === "preview" && workbook && <section className="space-y-4">
        <p className="text-xs text-muted-foreground">{workbook.parsed.sourceRows.toLocaleString("es-AR")} filas de origen agrupadas</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><SummaryCard label="Productos" value={rows.length} /><SummaryCard label="Variantes" value={migration?.variantCount || 0} /><SummaryCard label="Stock negativo" value={workbook.negativeStock} /><SummaryCard label="Stock fraccionario" value={workbook.fractionalStock} /></div>
        <div className="flex flex-wrap items-center gap-2"><Badge variant="secondary" className="bg-muted text-foreground">{catalogMigrationSourceLabel(workbook.parsed.source)}</Badge>{workbook.duplicateCodes > 0 && <Badge variant="destructive">{workbook.duplicateCodes} códigos repetidos</Badge>}</div>
        {workbook.parsed.warnings.map(message => <Alert key={message} variant="warning"><AlertCircle className="h-4 w-4" /><div><AlertDescription className="text-foreground opacity-100">{message}</AlertDescription></div></Alert>)}
        {workbook.detectionWarnings.length > 0 && <Alert variant="warning"><AlertCircle className="h-4 w-4" /><div><AlertTitle>Revisá la detección del archivo</AlertTitle><AlertDescription className="text-foreground opacity-100">{workbook.detectionWarnings.map(message => <p key={message}>{message}</p>)}</AlertDescription></div></Alert>}
        <p className="text-xs text-muted-foreground">Encabezados en fila {workbook.headerRow}. La detección propone columnas; no guarda ni publica productos.</p>
        <div className="grid gap-3 sm:grid-cols-3"><SelectField label="Hoja del archivo" value={workbook.sheetName} options={workbook.sheetNames.map(name => ({ value: name, label: name }))} disabled={busy || !!stage} onChange={value => void remap({ sheetName: value })} /><SelectField label="Fila de encabezados" value={String(workbook.headerRow)} options={workbook.headerCandidates} disabled={busy || !!stage} onChange={value => void remap({ sheetName: workbook.sheetName, headerRow: Number(value) })} /><SelectField label="Moneda del costo de origen" value={currencyConfirmed ? workbook.costCurrency : ""} options={[...(!currencyConfirmed ? [{ value: "", label: "Confirmá la moneda del costo" }] : []), { value: "ARS", label: "Pesos argentinos (ARS)" }, { value: "USD", label: "Dólares estadounidenses (USD)" }]} disabled={busy || !!stage} onChange={value => value && void remap({ mapping: workbook.profile === "platform" ? undefined : workbook.mapping, costCurrency: value as "ARS" | "USD", sheetName: workbook.sheetName, headerRow: workbook.headerRow })} /></div>
        {workbook.profile !== "platform" && <details open={workbook.detectionWarnings.length > 0} className="border-y border-border py-3"><summary className="flex cursor-pointer items-center justify-between text-sm font-semibold">Columnas del archivo<ChevronDown className="h-4 w-4" /></summary><div className="grid gap-3 pt-3 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(IMPORT_MAPPING_FIELDS).map(([field, label]) => <SelectField key={field} label={label} value={workbook.mapping[field as keyof ImportMapping]} options={[{ value: "", label: "No importar esta columna" }, ...workbook.columns.map(column => ({ value: column.id, label: column.label }))]} disabled={busy || !!stage} onChange={value => void remap({ mapping: { ...workbook.mapping, [field]: value }, ...(currencyConfirmed ? { costCurrency: workbook.costCurrency } : {}), sheetName: workbook.sheetName, headerRow: workbook.headerRow })} />)}</div></details>}
        <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="import-rate" className="text-xs">Cotización USD a ARS {workbook.costCurrency === "ARS" ? "(opcional)" : "(obligatoria)"}</Label><Input id="import-rate" type="number" min="0" value={exchangeRate || ""} disabled={busy || !!stage} onChange={event => setExchangeRate(Number(event.target.value))} /></div><div><Label htmlFor="import-margin" className="text-xs">Margen sugerido (%)</Label><Input id="import-margin" type="number" min="-99" max="5000" value={marginPercent} disabled={busy || !!stage} onChange={event => setMarginPercent(Number(event.target.value))} /></div></div>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={autoPrice} disabled={busy || !!stage} onCheckedChange={value => setAutoPrice(value === true)} />Sugerir precio sólo cuando falta en el archivo</label>
        <SelectField label="Inventario" value={stockMode} options={[{ value: "replace", label: "Usar stock del archivo (ajuste en Kardex)" }, { value: "ignore", label: "Conservar stock actual (sin movimientos)" }]} disabled={busy || !!stage} onChange={value => setStockMode(value as "replace" | "ignore")} />
        {stockMode === "replace" && (workbook.negativeStock > 0 || workbook.fractionalStock > 0) && <Alert variant="warning"><AlertCircle className="h-4 w-4" /><div><AlertTitle>Inventario por revisar</AlertTitle><AlertDescription className="text-foreground opacity-100">Nerqia usa unidades enteras. Las filas con stock negativo o fraccionario serán inválidas; no se redondearán ni se convertirán a cero. Podés conservar el inventario actual e importar sólo catálogo y precios.</AlertDescription></div></Alert>}
        <div className="grid gap-3 sm:grid-cols-2"><SelectField label="Tienda de destino" value={destinationStoreId} options={[{ value: "", label: "Sólo catálogo, sin publicar en tiendas" }, ...stores.map(store => ({ value: store.id, label: store.name + (store.is_primary ? " · Principal" : "") }))]} disabled={busy || !!stage} onChange={setDestinationStoreId} />{stockMode === "replace" && locations.length > 0 && <SelectField label="Sucursal del stock" value={locationId} options={[{ value: "", label: locations.length > 1 ? "Elegí una sucursal" : "Stock general" }, ...locations.map(location => ({ value: location.id, label: location.name }))]} disabled={busy || !!stage} onChange={setLocationId} />}</div>
        {(migration?.redirectCount || 0) > 0 && !destinationStoreId && <Alert variant="warning"><AlertCircle className="h-4 w-4" /><div><AlertTitle>Sin tienda de destino</AlertTitle><AlertDescription className="text-foreground opacity-100">Las URLs antiguas no tendrán redirects en una tienda.</AlertDescription></div></Alert>}
        <div className="max-h-[420px] overflow-auto border-y border-border" tabIndex={0} aria-label="Vista previa de productos importados"><table className="w-full min-w-[780px] text-xs"><thead className="sticky top-0 bg-card text-muted-foreground"><tr>{["Fila", "Producto", "Código", "Costo", "Precio normal", "Stock de origen", "Revisión local"].map(label => <th key={label} className="p-2 text-left">{label}</th>)}</tr></thead><tbody>{pageRows.map((row, index) => <tr key={page * PAGE_SIZE + index} className="border-t border-border align-top"><td className="p-2">{row.source_row || page * PAGE_SIZE + index + 1}</td><td className="max-w-[250px] break-words p-2 font-medium">{row.name || "Sin nombre"}</td><td className="p-2 font-mono">{String(row.sku || "—")}</td><td className="whitespace-nowrap p-2">{row.cost_ars !== undefined ? ars(Number(row.cost_ars)) : row.cost_usd !== undefined ? `USD ${row.cost_usd}` : "Sin costo"}</td><td className="whitespace-nowrap p-2">{ars(previews[index].salePriceARS)}</td><td className="p-2">{String(row.stock ?? "—")}</td><td className="max-w-[240px] p-2">{previews[index].localIssues.filter(issue => stockMode !== "ignore" || issue !== "Stock inválido").join(" · ") || "Sin observaciones"}</td></tr>)}</tbody></table></div>
        <Pagination page={page} total={rows.length} onPage={setPage} disabled={busy} />
        <div className="flex flex-wrap justify-between gap-2"><Button variant="outline" disabled={busy} onClick={stage ? () => void discard() : reset}><ArrowLeft className="mr-2 h-4 w-4" />{stage ? "Descartar validación" : "Cambiar archivo"}</Button><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>Cancelar</Button><Button onClick={() => void prepare()} disabled={busy || contextLoading || !!contextError || !currencyConfirmed || (workbook.profile !== "platform" && !workbook.mapping.name) || (needsLocation && !locationId)}>{busy || contextLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileCheck2 className="mr-2 h-4 w-4" />}Preparar y validar</Button></div></div>
      </section>}
      {step === "staged" && stage && <section className="space-y-4">
        <Alert variant={stage.invalid ? "warning" : "success"}><FileCheck2 className="h-4 w-4" /><div><AlertTitle>{stage.status === "applying" ? "Importación aprobada, pendiente de completar" : stage.invalid ? "Hay filas que no se aplicarán" : "Validación completa"}</AlertTitle><AlertDescription className="text-foreground opacity-100">{stage.status === "applying" ? `${stage.created + stage.updated} productos ya guardados. Reanudar no los vuelve a aplicar.` : `El servidor revisó ${stage.total} productos. Todavía no se cambió ningún producto ni unidad.`}</AlertDescription></div></Alert>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><SummaryCard label="Válidos" value={stage.valid} /><SummaryCard label="Nuevos" value={stage.creates} /><SummaryCard label="Actualizan" value={stage.updates} /><SummaryCard label="Inválidos" value={stage.invalid} /></div>
        <SelectField label="Filas a revisar" value={validationFilter} options={[{ value: "all", label: "Todas las filas" }, { value: "invalid", label: "Sólo filas inválidas" }]} disabled={rowLoading || busy} onChange={value => { setValidationFilter(value); setPage(0); }} />
        <div className="max-h-[420px] overflow-auto border-y border-border" tabIndex={0} aria-label="Resultado de validación del servidor"><table className="w-full min-w-[720px] text-xs"><thead className="sticky top-0 bg-card text-muted-foreground"><tr>{["Fila", "Acción", "Producto", "Código", "Resultado del servidor"].map(label => <th key={label} className="p-2 text-left">{label}</th>)}</tr></thead><tbody>{!rowLoading && stagedRows.map(row => { const data = object(row.normalized); return <tr key={row.id} className="border-t border-border align-top"><td className="p-2">{String(data.source_row || row.session_position + 1)}</td><td className="p-2"><Badge className="text-foreground" variant={row.action === "invalid" ? "destructive" : "secondary"}>{row.action === "invalid" ? "Inválida" : row.action === "create" ? "Crear" : "Actualizar"}</Badge></td><td className="max-w-[240px] break-words p-2 font-medium">{String(data.name || "Sin nombre")}</td><td className="p-2 font-mono">{String(data.sku || "—")}</td><td className="max-w-[300px] p-2">{row.validation_errors.map(message => <p className="text-destructive" key={message}>{message}</p>)}{row.validation_warnings.map(message => <p className="text-amber-700 dark:text-amber-400" key={message}>{message}</p>)}{!row.validation_errors.length && !row.validation_warnings.length && (row.status === "applied" ? "Aplicada" : "Lista para aplicar")}</td></tr>; })}{rowLoading && <tr><td colSpan={5} className="p-4 text-center">Cargando validaciones</td></tr>}{!rowLoading && !stagedRows.length && <tr><td colSpan={5} className="p-4 text-center">No hay filas en esta página.</td></tr>}</tbody></table></div>
        <Pagination page={page} total={validationFilter === "invalid" ? stage.invalid : stage.total} onPage={setPage} disabled={rowLoading || busy} />
        {stage.invalid > 0 && <label className="flex items-start gap-2 text-sm"><Checkbox checked={skipInvalid} disabled={busy || stage.status === "applying"} onCheckedChange={value => setSkipInvalid(value === true)} /><span>Omitir {stage.invalid} filas inválidas y conservar el descarte en el historial</span></label>}
        <Alert variant="info"><ShieldCheck className="h-4 w-4" /><div><AlertTitle>Aplicación por lotes</AlertTitle><AlertDescription className="text-foreground opacity-100">Cada lote guarda todos sus cambios o ninguno. Si uno falla, los anteriores se conservan y podés reanudar. Cancelar no revierte lo ya aplicado.</AlertDescription></div></Alert>
        <div className="flex flex-wrap justify-between gap-2"><Button variant="outline" disabled={busy} onClick={() => void discard()}>Cancelar pendientes</Button><Button disabled={busy || !stage.valid || (stage.invalid > 0 && !skipInvalid) || (stage.creates > 0 && !permissions.canCreate) || (stage.updates > 0 && !permissions.canEdit)} onClick={() => void apply()}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : stage.status === "applying" ? <Play className="mr-2 h-4 w-4" /> : <ShieldCheck className="mr-2 h-4 w-4" />}{stage.status === "applying" ? "Reanudar aplicación" : `Aprobar ${stage.valid} filas`}</Button></div>
        {((stage.creates > 0 && !permissions.canCreate) || (stage.updates > 0 && !permissions.canEdit)) && <p role="status" className="text-sm text-destructive">Tu rol no puede crear o editar todos los productos de este archivo.</p>}
      </section>}
      {step === "done" && stage && <section className="space-y-4"><div className="flex items-center gap-3"><PackageCheck className="h-8 w-8 text-emerald-600" /><div><h4 className="text-lg font-semibold">Catálogo reconciliado</h4><p className="text-sm text-muted-foreground">{stage.total.toLocaleString("es-AR")} productos procesados · {stage.filename}</p></div></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><SummaryCard label="Creados" value={stage.created} /><SummaryCard label="Actualizados" value={stage.updated} /><SummaryCard label="Kardex" value={stage.stock_movements} /><SummaryCard label="Omitidos" value={stage.skipped} /><SummaryCard label="Variantes nuevas" value={stage.variants_created} /><SummaryCard label="Variantes actualizadas" value={stage.variants_updated} /><SummaryCard label="Redirects" value={stage.redirects} /></div><Alert variant="success"><CheckCircle2 className="h-4 w-4" /><div><AlertTitle>Todos los lotes confirmados</AlertTitle><AlertDescription className="text-foreground opacity-100">Reintentar esta sesión no duplica productos ni movimientos de stock.</AlertDescription></div></Alert>
        {stage.images > 0 && <Alert variant={mirrorState.done ? "success" : "info"}><Download className="h-4 w-4" /><div><AlertTitle>{mirrorState.done ? "Imágenes copiadas" : "Imágenes del origen"}</AlertTitle><AlertDescription className="text-foreground opacity-100">{mirrorState.done ? `${mirrorState.mirrored} copias confirmadas.` : `${mirrorState.mirrored} copias confirmadas. ${mirrorState.failed ? `${mirrorState.failed} con error. ` : ""}Las imágenes pendientes todavía dependen de las URLs del origen.`}</AlertDescription>{!mirrorState.done && <Button size="sm" disabled={mirrorState.busy} className="mt-2" onClick={() => void mirrorImages()}>{mirrorState.busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}Copiar imágenes</Button>}</div></Alert>}
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={mirrorState.busy} onClick={reset}><Upload className="mr-2 h-4 w-4" />Importar otro</Button><Button onClick={onClose}>Volver a Productos</Button></div>
      </section>}
    </div>
  </div>;
}
