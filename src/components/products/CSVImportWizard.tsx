/**
 * CSVImportWizard — Full CSV import flow for products.
 *
 * Steps:
 *   1. Drop / select file
 *   2. Preview parsed rows, map columns, validate
 *   3. Import with progress + error summary
 *
 * Supported columns (auto-detected via fuzzy header matching):
 *   nombre/name, precio/price, costo/cost, stock, categoría/category,
 *   código/barcode/sku, descripción/description, género/gender, marca/brand,
 *   precio_descuento/discount_price, umbral_stock/low_stock_threshold
 */
import { useState, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Upload, FileSpreadsheet, CheckCircle2, XCircle, AlertTriangle,
  ArrowRight, RotateCcw, Download, ChevronDown, ChevronUp,
} from "lucide-react";
import { useCSVParser, findHeader } from "@/hooks/useCSVParser";
import { useAsyncAction } from "@/hooks/useAsyncAction";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";

// ─── Column definitions ──────────────────────────────────────────────────────

interface ColDef {
  key: string;
  label: string;
  required: boolean;
  hints: string[]; // header name candidates for auto-mapping
  transform?: (v: string) => any;
}

const COLUMNS: ColDef[] = [
  { key: "name", label: "Nombre *", required: true, hints: ["nombre", "name", "producto", "articulo", "descripcion", "description"] },
  { key: "sale_price_ars", label: "Precio venta (ARS)", required: false, hints: ["precio", "price", "precio_venta", "sale_price", "pvp", "venta"] },
  { key: "cost_usd", label: "Costo (USD)", required: false, hints: ["costo", "cost", "cost_usd", "costo_usd", "costo_dolar"] },
  { key: "stock", label: "Stock", required: false, hints: ["stock", "cantidad", "qty", "quantity", "existencia", "unidades"] },
  { key: "category", label: "Categoría", required: false, hints: ["categoria", "category", "tipo", "type", "rubro"] },
  { key: "barcode", label: "Código / SKU", required: false, hints: ["codigo", "code", "barcode", "sku", "ean", "upc", "referencia"] },
  { key: "brand", label: "Marca", required: false, hints: ["marca", "brand", "fabricante"] },
  { key: "gender", label: "Género", required: false, hints: ["genero", "gender", "sexo"] },
  { key: "discount_price_ars", label: "Precio oferta", required: false, hints: ["oferta", "descuento", "discount", "precio_descuento", "discount_price"] },
  { key: "low_stock_threshold", label: "Umbral stock bajo", required: false, hints: ["umbral", "threshold", "minimo", "min_stock", "low_stock"] },
  { key: "description", label: "Descripción", required: false, hints: ["descripcion_larga", "long_description", "detalle", "detail", "notes"] },
];

const NONE = "__none__";

type Step = "upload" | "map" | "import";

interface ImportResult {
  created: number;
  failed: number;
  errors: string[];
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

export default function CSVImportWizard({ open, onClose, onImported }: Props) {
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const { parse, parsing, headers, rows } = useCSVParser();
  const dropRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState("");
  // column mapping: colDef.key → CSV header (or NONE)
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [previewExpanded, setPreviewExpanded] = useState(false);

  // ── File handling ──────────────────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.match(/\.(csv|tsv|txt)$/i)) {
      toast.error("Formato no soportado. Usá un archivo .csv, .tsv o .txt");
      return;
    }
    setFileName(file.name);
    const result = await parse(file);
    if (!result || result.rows.length === 0) {
      toast.error("No se encontraron filas en el archivo");
      return;
    }

    // Auto-map columns
    const autoMap: Record<string, string> = {};
    for (const col of COLUMNS) {
      const found = findHeader(result.headers, col.hints);
      autoMap[col.key] = found ?? NONE;
    }
    setMapping(autoMap);
    setStep("map");
    toast.success(`${result.rows.length} filas detectadas · ${result.headers.length} columnas`);
  }, [parse]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // ── Import ─────────────────────────────────────────────────────────────────

  function getMappedValue(row: Record<string, string>, key: string): string {
    const header = mapping[key];
    if (!header || header === NONE) return "";
    return (row[header] ?? "").trim();
  }

  const [runImport, importing] = useAsyncAction(async () => {
    if (!user || !activeOrg) throw new Error("No hay sesión activa");

    const result: ImportResult = { created: 0, failed: 0, errors: [] };
    const BATCH = 20;
    setProgress(0);

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const records = batch.map((row, idx) => {
        const name = getMappedValue(row, "name");
        if (!name) return null;

        const salePrice = getMappedValue(row, "sale_price_ars");
        const cost = getMappedValue(row, "cost_usd");
        const stock = getMappedValue(row, "stock");
        const discountPrice = getMappedValue(row, "discount_price_ars");
        const lowStock = getMappedValue(row, "low_stock_threshold");

        return {
          user_id: user.id,
          org_id: activeOrg.id,
          name: name.slice(0, 200),
          sale_price_ars: salePrice ? parseFloat(salePrice.replace(/[^\d.,-]/g, "").replace(",", ".")) || null : null,
          cost_usd: cost ? parseFloat(cost.replace(/[^\d.,-]/g, "").replace(",", ".")) || null : null,
          stock: stock ? parseInt(stock) || 0 : 0,
          category: getMappedValue(row, "category") || "otro",
          barcode: getMappedValue(row, "barcode") || null,
          brand: getMappedValue(row, "brand") || null,
          gender: getMappedValue(row, "gender") || null,
          discount_price_ars: discountPrice ? parseFloat(discountPrice.replace(/[^\d.,-]/g, "").replace(",", ".")) || null : null,
          low_stock_threshold: lowStock ? parseInt(lowStock) || 5 : 5,
          description: getMappedValue(row, "description") || null,
        };
      }).filter(Boolean);

      if (records.length > 0) {
        const { error } = await supabase.from("products").insert(records as any[]);
        if (error) {
          result.failed += records.length;
          result.errors.push(`Filas ${i + 1}-${i + records.length}: ${error.message}`);
        } else {
          result.created += records.length;
        }
      }

      setProgress(Math.round(((i + BATCH) / rows.length) * 100));
    }

    setImportResult(result);
    setStep("import");

    if (result.created > 0) {
      toast.success(`✅ ${result.created} productos importados`);
      onImported();
    }
    if (result.failed > 0) {
      toast.error(`⚠️ ${result.failed} filas fallaron`);
    }
  }, {
    onError: (e) => toast.error(`Error de importación: ${e.message}`),
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  const nameCol = mapping["name"];
  const hasNameCol = !!nameCol && nameCol !== NONE;
  const mappedCount = Object.values(mapping).filter(v => v !== NONE).length;

  // ── Reset ─────────────────────────────────────────────────────────────────

  function handleClose() {
    setStep("upload");
    setFileName("");
    setImportResult(null);
    setProgress(0);
    setPreviewExpanded(false);
    onClose();
  }

  // ── Template download ─────────────────────────────────────────────────────

  function downloadTemplate() {
    const headers = ["Nombre", "Precio", "Costo USD", "Stock", "Categoría", "Código", "Marca", "Género", "Precio Oferta", "Umbral Stock", "Descripción"];
    const example = ["Lattafa Ameer Al Oud", "35000", "15", "10", "perfume_arabe", "7500123456789", "Lattafa", "unisex", "28000", "3", "Perfume árabe 100ml"];
    const csv = `\uFEFF${headers.join(",")}\n${example.join(",")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "plantilla_productos.csv";
    a.click();
    toast.success("Plantilla descargada");
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="bg-card border-border/60 max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-primary" />
            Importar productos desde CSV
          </DialogTitle>
        </DialogHeader>

        {/* ── Step indicator ── */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground/60 mb-2">
          {(["upload", "map", "import"] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${step === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{i + 1}</span>
              <span className={step === s ? "text-foreground" : ""}>{s === "upload" ? "Archivo" : s === "map" ? "Columnas" : "Resultado"}</span>
              {i < 2 && <ArrowRight className="w-3 h-3" />}
            </div>
          ))}
        </div>

        {/* ── Step 1: Upload ── */}
        {step === "upload" && (
          <div className="space-y-4">
            <div
              ref={dropRef}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all duration-200 ${
                dragOver ? "border-primary bg-primary/10" : "border-border/40 hover:border-primary/50 hover:bg-primary/5"
              }`}
            >
              <Upload className={`w-10 h-10 mx-auto mb-3 ${dragOver ? "text-primary" : "text-muted-foreground/40"}`} />
              <p className="font-medium text-foreground/80">Arrastrá tu archivo CSV aquí</p>
              <p className="text-sm text-muted-foreground/60 mt-1">o hacé clic para seleccionar</p>
              <p className="text-xs text-muted-foreground/40 mt-2">.csv · .tsv · .txt — delimitadores auto-detectados</p>
              {parsing && <p className="text-xs text-primary mt-3 animate-pulse">Procesando…</p>}
            </div>

            <input
              ref={inputRef}
              type="file"
              accept=".csv,.tsv,.txt"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
            />

            <Button variant="outline" size="sm" onClick={downloadTemplate} className="w-full gap-2 border-dashed">
              <Download className="w-3.5 h-3.5" />
              Descargar plantilla de ejemplo
            </Button>

            <div className="rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground/70 space-y-1">
              <p className="font-semibold text-foreground/60 mb-1">Columnas reconocidas automáticamente:</p>
              <div className="flex flex-wrap gap-1">
                {["Nombre", "Precio", "Costo", "Stock", "Categoría", "Código", "Marca", "Género"].map(c => (
                  <Badge key={c} variant="outline" className="text-[10px] px-1.5 py-0">{c}</Badge>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Step 2: Column mapping ── */}
        {step === "map" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{fileName}</p>
                <p className="text-xs text-muted-foreground/60">{rows.length} filas · {headers.length} columnas detectadas · {mappedCount} mapeadas</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setStep("upload")}>
                <RotateCcw className="w-3.5 h-3.5 mr-1" />Cambiar
              </Button>
            </div>

            {!hasNameCol && (
              <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                La columna <strong>Nombre</strong> es obligatoria para importar.
              </div>
            )}

            <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
              {COLUMNS.map(col => (
                <div key={col.key} className="flex items-center gap-3 p-2 rounded-lg bg-muted/20 hover:bg-muted/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{col.label}</p>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/40 shrink-0" />
                  <div className="w-44 shrink-0">
                    <Select
                      value={mapping[col.key] ?? NONE}
                      onValueChange={v => setMapping(prev => ({ ...prev, [col.key]: v }))}
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}><span className="text-muted-foreground/60">— sin mapear —</span></SelectItem>
                        {headers.map(h => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {mapping[col.key] && mapping[col.key] !== NONE
                    ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    : <div className="w-4 h-4 shrink-0" />
                  }
                </div>
              ))}
            </div>

            {/* Preview */}
            <div className="rounded-lg border border-border/40 overflow-hidden">
              <button
                className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium bg-muted/30 hover:bg-muted/50 transition-colors"
                onClick={() => setPreviewExpanded(p => !p)}
              >
                <span>Vista previa ({Math.min(rows.length, 3)} de {rows.length} filas)</span>
                {previewExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {previewExpanded && (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead className="bg-muted/20">
                      <tr>
                        {COLUMNS.filter(c => mapping[c.key] && mapping[c.key] !== NONE).map(c => (
                          <th key={c.key} className="px-2 py-1 text-left font-medium text-muted-foreground/70 whitespace-nowrap">
                            {c.label.replace(" *", "")}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 3).map((row, i) => (
                        <tr key={i} className="border-t border-border/20 hover:bg-muted/10">
                          {COLUMNS.filter(c => mapping[c.key] && mapping[c.key] !== NONE).map(c => (
                            <td key={c.key} className="px-2 py-1 max-w-[150px] truncate text-muted-foreground/80">
                              {row[mapping[c.key]] ?? ""}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <Button
              className="w-full gradient-gold text-primary-foreground font-semibold"
              disabled={!hasNameCol || importing}
              onClick={() => runImport()}
            >
              {importing ? "Importando…" : `Importar ${rows.length} productos`}
            </Button>

            {importing && (
              <div className="space-y-1.5">
                <Progress value={progress} className="h-1.5" />
                <p className="text-center text-xs text-muted-foreground/60">{progress}% completado</p>
              </div>
            )}
          </div>
        )}

        {/* ── Step 3: Result ── */}
        {step === "import" && importResult && (
          <div className="space-y-4 text-center py-4">
            {importResult.created > 0 ? (
              <CheckCircle2 className="w-14 h-14 text-emerald-400 mx-auto" />
            ) : (
              <XCircle className="w-14 h-14 text-destructive mx-auto" />
            )}
            <div>
              <p className="text-lg font-display font-bold">
                {importResult.created > 0 ? "¡Importación completada!" : "Importación fallida"}
              </p>
              <p className="text-sm text-muted-foreground/70 mt-1">
                {importResult.created} productos creados · {importResult.failed} fallidos
              </p>
            </div>

            {importResult.errors.length > 0 && (
              <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-left text-xs space-y-1 max-h-40 overflow-y-auto">
                <p className="font-semibold text-destructive mb-1">Errores:</p>
                {importResult.errors.map((e, i) => (
                  <p key={i} className="text-destructive/80">{e}</p>
                ))}
              </div>
            )}

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => { setStep("upload"); setImportResult(null); }}>
                <Upload className="w-4 h-4 mr-2" />Importar otro
              </Button>
              <Button className="flex-1 gradient-gold text-primary-foreground" onClick={handleClose}>
                Cerrar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
