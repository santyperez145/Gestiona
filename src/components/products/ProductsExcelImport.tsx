import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useOrg } from "@/lib/orgContext";
import {
  PRODUCT_IMPORT_MAX_ROWS,
  buildProductImportRow,
  previewProductImportRow,
  productImportFormat,
  type ProductImportPayloadRow,
} from "@/lib/productImport";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  AlertCircle, ArrowLeft, CheckCircle2, ChevronDown, ChevronUp, Download,
  FileCheck2, FileSpreadsheet, Info, Loader2, PackageCheck, ShieldCheck,
  Upload, X,
} from "lucide-react";

type Step = "upload" | "preview" | "staged" | "done";
type Location = { id: string; name: string };
type StageSummary = {
  ok: boolean; reused?: boolean; batch_id: string; status: string;
  total: number; valid: number; invalid: number; creates: number; updates: number;
};
type ApplySummary = {
  ok: boolean; reused?: boolean; status?: string; created?: number; updated?: number;
  stock_movements?: number; skipped?: number; reconciled?: boolean; motivo?: string; error?: string;
};
type StagedRow = {
  id: string; row_number: number; action: "create" | "update" | "invalid";
  normalized: Json; validation_errors: string[]; validation_warnings: string[];
  status: "staged" | "applied" | "skipped";
};

function jsonObject(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Json | undefined>
    : {};
}

function ars(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency", currency: "ARS", maximumFractionDigits: 0,
  }).format(value || 0);
}

function SummaryCard({ label, value, tone = "text-foreground" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold ${tone}`}>{value.toLocaleString("es-AR")}</p>
    </div>
  );
}

export default function ProductsExcelImport({ onClose, onImported }: {
  onClose: () => void;
  onImported: () => void;
}) {
  const { activeOrg, activeRole } = useOrg();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ProductImportPayloadRow[]>([]);
  const [stage, setStage] = useState<StageSummary | null>(null);
  const [stagedRows, setStagedRows] = useState<StagedRow[]>([]);
  const [result, setResult] = useState<ApplySummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [stockMode, setStockMode] = useState<"replace" | "ignore">("replace");
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [exchangeRate, setExchangeRate] = useState(1695);
  const [customsPercent, setCustomsPercent] = useState(15);
  const [marginPercent, setMarginPercent] = useState(80);
  const [autoPrice, setAutoPrice] = useState(true);
  const canImport = activeRole === "owner" || activeRole === "admin";

  useEffect(() => {
    if (!activeOrg?.id) return;
    let mounted = true;
    Promise.all([
      supabase.from("settings").select("exchange_rate, customs_percent").eq("org_id", activeOrg.id).maybeSingle(),
      supabase.from("locations").select("id, name").eq("org_id", activeOrg.id).eq("active", true).order("name"),
    ]).then(([settings, locationResult]) => {
      if (!mounted) return;
      if (settings.error) toast.error("No pudimos cargar la cotización del negocio");
      else {
        const rate = Number(settings.data?.exchange_rate);
        const customs = Number(settings.data?.customs_percent);
        if (rate > 0) setExchangeRate(rate);
        if (customs >= 0) setCustomsPercent(customs);
      }
      if (locationResult.error) toast.error("No pudimos cargar las sucursales");
      else {
        const next = locationResult.data || [];
        setLocations(next);
        if (next.length === 1) setLocationId(next[0].id);
      }
    });
    return () => { mounted = false; };
  }, [activeOrg?.id]);

  const params = useMemo(() => ({
    exchangeRate, customsPercent, defaultMarginPercent: marginPercent, autoFillSalePrice: autoPrice,
  }), [exchangeRate, customsPercent, marginPercent, autoPrice]);
  const previews = useMemo(() => rows.map(row => previewProductImportRow(row, params)), [rows, params]);
  const localStats = useMemo(() => ({
    issues: previews.filter(row => row.localIssues.length).length,
    withStock: rows.filter(row => row.provided.includes("stock")).length,
    revenue: previews.reduce((sum, row) => sum + row.salePriceARS * (row.stock || 0), 0),
  }), [rows, previews]);
  const needsLocation = stockMode === "replace" && locations.length > 1
    && rows.some(row => row.provided.includes("stock"));

  async function parseFile(file: File) {
    if (!productImportFormat(file.name)) return void toast.error("Usá un archivo .xlsx, .xls o .csv");
    setBusy(true);
    try {
      const { read, utils } = await import("xlsx");
      const workbook = read(await file.arrayBuffer(), { type: "array" });
      const raw = utils.sheet_to_json<Record<string, unknown>>(
        workbook.Sheets[workbook.SheetNames[0]], { defval: "" },
      );
      if (!raw.length) throw new Error("El archivo está vacío");
      if (raw.length > PRODUCT_IMPORT_MAX_ROWS) throw new Error(`El máximo por lote es ${PRODUCT_IMPORT_MAX_ROWS.toLocaleString("es-AR")} filas`);
      setRows(raw.map(buildProductImportRow));
      setFileName(file.name);
      setStage(null); setStagedRows([]); setResult(null); setSkipInvalid(false);
      setStep("preview");
      toast.success(`${raw.length.toLocaleString("es-AR")} filas listas para revisar`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No pudimos leer el archivo");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function loadStagedRows(batchId: string) {
    const { data, error } = await supabase.from("product_import_rows")
      .select("id, row_number, action, normalized, validation_errors, validation_warnings, status")
      .eq("batch_id", batchId).order("row_number");
    if (error) throw error;
    setStagedRows((data || []) as StagedRow[]);
  }

  async function prepare() {
    if (!activeOrg?.id || !fileName || !canImport) return;
    const format = productImportFormat(fileName);
    if (!format) return;
    if (exchangeRate <= 0) return void toast.error("Ingresá una cotización USD válida");
    if (needsLocation && !locationId) return void toast.error("Elegí la sucursal del stock");
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("stage_product_import", {
        p_org_id: activeOrg.id,
        p_filename: fileName,
        p_source_format: format,
        p_rows: rows as unknown as Json,
        p_stock_mode: stockMode,
        p_location_id: locationId || undefined,
        p_exchange_rate: exchangeRate,
        p_customs_percent: customsPercent,
        p_default_margin_percent: marginPercent,
        p_auto_fill_sale_price: autoPrice,
      });
      if (error) throw error;
      const next = data as unknown as StageSummary;
      if (!next?.ok || !next.batch_id) throw new Error("El servidor no pudo preparar el lote");
      await loadStagedRows(next.batch_id);
      setStage(next); setStep("staged");
      toast.success(next.invalid ? `${next.valid} filas válidas y ${next.invalid} para corregir` : `${next.valid} filas listas`);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "No pudimos preparar la importación");
    } finally { setBusy(false); }
  }

  async function apply() {
    if (!stage?.batch_id || !canImport) return;
    if (stage.invalid && !skipInvalid) return void toast.error("Confirmá si querés omitir las filas inválidas");
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("apply_product_import", {
        p_batch_id: stage.batch_id, p_skip_invalid: skipInvalid,
      });
      if (error) throw error;
      const next = data as unknown as ApplySummary;
      if (!next?.ok) throw new Error(next?.error || "El lote no pudo aplicarse");
      if (!next.reconciled) throw new Error("El servidor no pudo reconciliar todas las filas válidas");
      setResult(next); setStep("done"); onImported();
      toast.success("Catálogo importado y reconciliado");
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "No pudimos aplicar la importación");
    } finally { setBusy(false); }
  }

  function reset() {
    setRows([]); setFileName(""); setStage(null); setStagedRows([]); setResult(null);
    setSkipInvalid(false); setStep("upload");
  }

  async function downloadTemplate() {
    const { utils, writeFile } = await import("xlsx");
    const sheet = utils.json_to_sheet([{
      Nombre: "Eau de Parfum Floral 100ml", Marca: "Marca Ejemplo", Categoría: "Perfume",
      Género: "Femenino", SKU: "EJM-001", "Código de barras": "7891234567890",
      "Costo USD": 25.5, "Precio Venta ARS": 65000, "Precio Oferta": 55000,
      Stock: 10, "Contenido ml": 100, Descripción: "Fragancia floral con notas de jazmín",
    }]);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, sheet, "Productos");
    writeFile(workbook, "plantilla_productos_gestiona.xlsx");
  }

  if (!canImport) return (
    <div className="space-y-4 py-2">
      <Alert variant="warning"><ShieldCheck className="h-4 w-4 shrink-0" /><div>
        <AlertTitle>Importación reservada a owner o admin</AlertTitle>
        <AlertDescription>El lote puede cambiar costos, precios y stock. Pedile a un administrador que lo revise y apruebe.</AlertDescription>
      </div></Alert>
      <Button variant="outline" onClick={onClose}>Cerrar</Button>
    </div>
  );

  return (
    <div className="max-h-[86vh] space-y-4 overflow-y-auto pr-1">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <FileSpreadsheet className="h-5 w-5 text-primary" />
        </div><div><h3 className="font-semibold">Importar catálogo</h3><p className="text-xs text-muted-foreground">Excel o CSV · validación · aprobación · Kardex y reconciliación</p></div></div>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Cerrar"><X className="h-4 w-4" /></Button>
      </div>

      <div className="grid grid-cols-3 gap-2 text-[11px]">
        {[["1", "Archivo", step !== "upload"], ["2", "Validación", ["staged", "done"].includes(step)], ["3", "Aplicación", step === "done"]].map(([number, label, done]) => (
          <div key={String(number)} className={`rounded-lg border px-3 py-2 ${done ? "border-emerald-500/30 bg-emerald-500/5" : "border-border"}`}>
            <b className="mr-1.5">{done ? "✓" : number}.</b>{label}
          </div>
        ))}
      </div>

      {step === "upload" && <div className="space-y-3">
        <button type="button" onClick={() => fileRef.current?.click()} onDragOver={event => event.preventDefault()}
          onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void parseFile(file); }}
          className="w-full rounded-xl border-2 border-dashed border-border p-10 text-center transition hover:border-primary/50 hover:bg-primary/5">
          {busy ? <Loader2 className="mx-auto mb-3 h-9 w-9 animate-spin text-primary" /> : <Upload className="mx-auto mb-3 h-9 w-9 text-primary/70" />}
          <p className="text-sm font-medium">Seleccioná o arrastrá tu Excel/CSV</p><p className="mt-1 text-xs text-muted-foreground">Hasta 5.000 productos por lote</p>
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) void parseFile(file); }} />
        <div className="flex items-center justify-between gap-3"><p className="text-xs text-muted-foreground">Las columnas desconocidas se ignoran.</p>
          <Button variant="outline" size="sm" onClick={() => void downloadTemplate()}><Download className="mr-2 h-4 w-4" />Plantilla</Button></div>
        <Alert variant="info"><ShieldCheck className="h-4 w-4 shrink-0" /><div><AlertTitle>Nada cambia al subir</AlertTitle>
          <AlertDescription>Primero el servidor detecta altas, actualizaciones, duplicados y errores. El catálogo cambia recién con tu aprobación.</AlertDescription></div></Alert>
      </div>}

      {step === "preview" && <div className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2"><div className="min-w-0">
          <p className="truncate text-sm font-medium">{fileName}</p><p className="text-xs text-muted-foreground">{rows.length.toLocaleString("es-AR")} filas</p></div>
          <Button variant="ghost" size="sm" onClick={reset}><ArrowLeft className="mr-2 h-4 w-4" />Cambiar</Button></div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><SummaryCard label="Filas" value={rows.length} />
          <SummaryCard label="A revisar" value={localStats.issues} tone={localStats.issues ? "text-amber-500" : "text-emerald-500"} />
          <SummaryCard label="Con stock" value={localStats.withStock} /><SummaryCard label="Venta potencial (mil ARS)" value={Math.round(localStats.revenue / 1000)} /></div>
        <div className="overflow-hidden rounded-lg border border-border">
          <button type="button" className="flex w-full items-center gap-2 bg-muted/30 px-4 py-2.5 text-left" onClick={() => setExpanded(value => !value)}>
            <Info className="h-4 w-4 text-primary" /><span className="flex-1 text-sm font-medium">Reglas de costo y margen</span>
            <span className="hidden text-xs text-muted-foreground sm:inline">USD {exchangeRate} · aduana {customsPercent}%</span>{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {expanded && <div className="grid gap-3 p-4 sm:grid-cols-3">
            <div><Label className="text-xs">Cotización USD → ARS</Label><Input type="number" min="1" value={exchangeRate} onChange={event => setExchangeRate(Number(event.target.value))} className="mt-1 h-9" /></div>
            <div><Label className="text-xs">Aduana / pasero (%)</Label><Input type="number" min="0" max="500" value={customsPercent} onChange={event => setCustomsPercent(Number(event.target.value))} className="mt-1 h-9" /></div>
            <div><Label className="text-xs">Margen sugerido (%)</Label><Input type="number" min="-99" max="5000" value={marginPercent} onChange={event => setMarginPercent(Number(event.target.value))} className="mt-1 h-9" /></div>
            <label className="flex items-center gap-2 text-xs sm:col-span-3"><Checkbox checked={autoPrice} onCheckedChange={value => setAutoPrice(value === true)} />Sugerir precio cuando hay costo pero falta precio</label>
          </div>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={`cursor-pointer rounded-lg border p-3 ${stockMode === "replace" ? "border-primary bg-primary/5" : "border-border"}`}><input type="radio" name="stock-mode" className="mr-2" checked={stockMode === "replace"} onChange={() => setStockMode("replace")} /><b className="text-sm">Usar stock del archivo</b><p className="ml-5 mt-1 text-xs text-muted-foreground">Ajusta la diferencia y deja asiento en Kardex.</p></label>
          <label className={`cursor-pointer rounded-lg border p-3 ${stockMode === "ignore" ? "border-primary bg-primary/5" : "border-border"}`}><input type="radio" name="stock-mode" className="mr-2" checked={stockMode === "ignore"} onChange={() => setStockMode("ignore")} /><b className="text-sm">Conservar stock actual</b><p className="ml-5 mt-1 text-xs text-muted-foreground">Importa catálogo y precios sin mover unidades.</p></label>
        </div>
        {stockMode === "replace" && locations.length > 0 && <div><Label className="text-xs">Sucursal del stock {needsLocation && "(obligatoria)"}</Label>
          <select value={locationId} onChange={event => setLocationId(event.target.value)} disabled={locations.length === 1} className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
            <option value="">{locations.length > 1 ? "Elegí una sucursal" : "Stock general"}</option>{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select></div>}
        <div className="overflow-x-auto rounded-lg border border-border"><table className="w-full min-w-[760px] text-xs">
          <thead className="bg-muted/40 text-muted-foreground"><tr><th className="p-2 text-left">Fila</th><th className="p-2 text-left">Producto</th><th className="p-2 text-left">SKU</th><th className="p-2 text-right">Costo total</th><th className="p-2 text-right">Venta</th><th className="p-2 text-right">Stock</th><th className="p-2 text-left">Vista local</th></tr></thead>
          <tbody>{rows.slice(0, 100).map((row, index) => { const preview = previews[index]; return <tr key={`${index}-${row.name}`} className="border-t border-border/60">
            <td className="p-2 text-muted-foreground">{index + 1}</td><td className="max-w-[220px] truncate p-2 font-medium">{row.name || "Sin nombre"}</td><td className="p-2 font-mono">{String(row.sku || "—")}</td>
            <td className="p-2 text-right">USD {preview.totalCostUSD.toFixed(2)}</td><td className="p-2 text-right">{ars(preview.salePriceARS)}</td><td className="p-2 text-right">{preview.stock ?? "—"}</td>
            <td className="p-2">{preview.localIssues.length ? <span className="text-amber-500">{preview.localIssues.join(" · ")}</span> : <span className="text-emerald-500">Lista</span>}</td>
          </tr>; })}</tbody></table>{rows.length > 100 && <p className="border-t border-border p-2 text-center text-xs text-muted-foreground">Mostrando 100; el servidor validará las {rows.length}.</p>}</div>
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={() => void prepare()} disabled={busy || (needsLocation && !locationId)}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileCheck2 className="mr-2 h-4 w-4" />}Preparar y validar</Button></div>
      </div>}

      {step === "staged" && stage && <div className="space-y-4">
        <Alert variant={stage.invalid ? "warning" : "success"}>{stage.invalid ? <AlertCircle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}<div>
          <AlertTitle>{stage.invalid ? "Hay filas que no se aplicarán" : "Validación completa"}</AlertTitle><AlertDescription>El servidor revisó {stage.total} filas. Todavía no cambió ningún producto ni unidad.</AlertDescription></div></Alert>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5"><SummaryCard label="Total" value={stage.total} /><SummaryCard label="Válidas" value={stage.valid} tone="text-emerald-500" /><SummaryCard label="Nuevas" value={stage.creates} /><SummaryCard label="Actualizan" value={stage.updates} /><SummaryCard label="Inválidas" value={stage.invalid} tone={stage.invalid ? "text-destructive" : "text-emerald-500"} /></div>
        <div className="max-h-[360px] overflow-auto rounded-lg border border-border"><table className="w-full min-w-[720px] text-xs"><thead className="sticky top-0 bg-muted text-muted-foreground"><tr><th className="p-2 text-left">Fila</th><th className="p-2 text-left">Acción</th><th className="p-2 text-left">Producto</th><th className="p-2 text-left">SKU</th><th className="p-2 text-left">Resultado del servidor</th></tr></thead>
          <tbody>{stagedRows.slice(0, 200).map(row => { const normalized = jsonObject(row.normalized); return <tr key={row.id} className="border-t border-border/60 align-top"><td className="p-2">{row.row_number}</td>
            <td className="p-2"><Badge variant={row.action === "invalid" ? "destructive" : row.action === "create" ? "default" : "secondary"}>{row.action === "create" ? "Crear" : row.action === "update" ? "Actualizar" : "Inválida"}</Badge></td>
            <td className="max-w-[220px] p-2 font-medium">{String(normalized.name || "Sin nombre")}</td><td className="p-2 font-mono">{String(normalized.sku || "—")}</td><td className="p-2">
              {row.validation_errors.map(message => <p key={message} className="text-destructive">{message}</p>)}{row.validation_warnings.map(message => <p key={message} className="text-amber-500">{message}</p>)}
              {!row.validation_errors.length && !row.validation_warnings.length && <span className="text-emerald-500">Lista para aplicar</span>}</td></tr>; })}</tbody></table>
          {stagedRows.length > 200 && <p className="border-t border-border p-2 text-center text-xs text-muted-foreground">Mostrando 200 de {stagedRows.length}; el lote completo quedó validado.</p>}</div>
        {stage.invalid > 0 && <label className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm"><Checkbox className="mt-0.5" checked={skipInvalid} onCheckedChange={value => setSkipInvalid(value === true)} /><span><b>Omitir {stage.invalid} filas inválidas</b><span className="mt-1 block text-xs text-muted-foreground">Se aplicarán sólo las {stage.valid} válidas y el descarte quedará registrado.</span></span></label>}
        <div className="flex flex-wrap justify-between gap-2"><Button variant="outline" onClick={reset}><ArrowLeft className="mr-2 h-4 w-4" />Corregir archivo</Button><Button onClick={() => void apply()} disabled={busy || !stage.valid || (stage.invalid > 0 && !skipInvalid)}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}Aprobar {stage.valid} filas</Button></div>
      </div>}

      {step === "done" && result && <div className="space-y-5 py-4 text-center"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10"><PackageCheck className="h-9 w-9 text-emerald-500" /></div>
        <div><h4 className="text-xl font-semibold">Catálogo reconciliado</h4><p className="mt-1 text-sm text-muted-foreground">Cada fila válida terminó exactamente una vez.</p></div>
        <div className="mx-auto grid max-w-xl grid-cols-2 gap-2 sm:grid-cols-4"><SummaryCard label="Creados" value={result.created || 0} tone="text-emerald-500" /><SummaryCard label="Actualizados" value={result.updated || 0} /><SummaryCard label="Movimientos Kardex" value={result.stock_movements || 0} /><SummaryCard label="Omitidos" value={result.skipped || 0} tone={result.skipped ? "text-amber-500" : "text-foreground"} /></div>
        <Alert variant="success" className="text-left"><ShieldCheck className="h-4 w-4 shrink-0" /><div><AlertTitle>Aplicación atómica e idempotente</AlertTitle><AlertDescription>Reintentar el mismo lote no duplica productos ni movimientos de stock.</AlertDescription></div></Alert>
        <div className="flex justify-center gap-2"><Button variant="outline" onClick={reset}><Upload className="mr-2 h-4 w-4" />Importar otro</Button><Button onClick={onClose}>Volver a Productos</Button></div>
      </div>}
    </div>
  );
}
