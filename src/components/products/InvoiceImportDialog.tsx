import { useState, useCallback, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { addProductDB, addPurchaseDB, getSettingsDB } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Upload, FileText, Loader2, Sparkles, CheckCircle2, AlertCircle,
  Trash2, X, ChevronDown, ChevronUp, Plus,
} from "lucide-react";

/**
 * InvoiceImportDialog — AI-powered invoice importer using Claude Vision.
 *
 * mode="products"   → each extracted line item is saved as a new product via addProductDB
 * mode="purchases"  → each extracted line item is saved as a purchase record via addPurchaseDB
 *
 * Props:
 *   mode       — "products" | "purchases"
 *   onClose    — called when the user wants to close
 *   onImported — called after successful import (reload parent)
 */

type Mode = "products" | "purchases";

interface ExtractedItem {
  name: string;
  brand: string | null;
  qty: number;
  unit_price: number;
  currency: "USD" | "ARS";
  notes: string | null;
  // UI state
  _selected: boolean;
  _saved: boolean;
  _error: string | null;
}

interface InvoiceImportDialogProps {
  mode: Mode;
  onClose: () => void;
  onImported: () => void;
}

const CATEGORY_HINTS: Array<[RegExp, string]> = [
  [/perfum|fragran|eau de/i, "perfume_diseñador"],
  [/arab|oud|attar|musk/i, "perfume_arabe"],
  [/vaper|vape|pod|liquid|e-?cig|salt nic/i, "vaper"],
  [/electronic|cable|cargad|auricular/i, "electronico"],
];
function guessCategory(name: string): string {
  for (const [re, cat] of CATEGORY_HINTS) if (re.test(name)) return cat;
  return "perfume_diseñador";
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URL prefix ("data:image/jpeg;base64,") — Claude expects raw base64
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const SUPPORTED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp", "application/pdf"];
const SUPPORTED_EXT = ".jpg,.jpeg,.png,.gif,.webp,.pdf";

export default function InvoiceImportDialog({ mode, onClose, onImported }: InvoiceImportDialogProps) {
  const { user } = useAuth();

  // ── Upload / extraction state ──────────────────────────────────────
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Extracted data ─────────────────────────────────────────────────
  const [supplier, setSupplier] = useState<string>("");
  const [invoiceDate, setInvoiceDate] = useState<string>("");
  const [items, setItems] = useState<ExtractedItem[]>([]);
  const [extracted, setExtracted] = useState(false);

  // ── Saving state ───────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ── File handling ──────────────────────────────────────────────────
  const handleFile = useCallback((f: File) => {
    if (!SUPPORTED_TYPES.includes(f.type)) {
      toast.error(`Tipo no soportado: ${f.type}. Usá JPG, PNG, WebP, GIF o PDF.`);
      return;
    }
    if (f.size > 20 * 1024 * 1024) {
      toast.error("El archivo es demasiado grande (máx 20 MB)");
      return;
    }
    setFile(f);
    setExtracted(false);
    setItems([]);
    setExtractError(null);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  // ── Extract via Claude Vision ──────────────────────────────────────
  const handleExtract = async () => {
    if (!file || !user) return;
    setExtracting(true);
    setExtractError(null);

    try {
      const fileBase64 = await fileToBase64(file);
      const mediaType = file.type === "image/jpg" ? "image/jpeg" : file.type;

      const { data, error } = await supabase.functions.invoke("extract-invoice", {
        body: { fileBase64, mediaType },
      });

      if (error) throw new Error(error.message || "Error al llamar la función");
      if (data?.error) throw new Error(data.error);

      const rawItems: any[] = data?.items || [];
      if (!rawItems.length) {
        setExtractError("Claude no encontró productos en esta imagen. Intentá con otra foto más clara o un PDF con texto seleccionable.");
        return;
      }

      setSupplier(data?.supplier || "");
      setInvoiceDate(data?.invoice_date || new Date().toISOString().slice(0, 10));
      setItems(rawItems.map((it: any) => ({
        name: String(it.name || ""),
        brand: it.brand || null,
        qty: Number(it.qty) || 1,
        unit_price: Number(it.unit_price) || 0,
        currency: it.currency === "ARS" ? "ARS" : "USD",
        notes: it.notes || null,
        _selected: true,
        _saved: false,
        _error: null,
      })));
      setExtracted(true);
    } catch (err: any) {
      console.error("extract-invoice error:", err);
      setExtractError(err.message || "Error desconocido");
    } finally {
      setExtracting(false);
    }
  };

  // ── Item editing helpers ───────────────────────────────────────────
  const updateItem = (i: number, patch: Partial<ExtractedItem>) => {
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it));
  };
  const toggleAll = (val: boolean) => setItems(prev => prev.map(it => it._saved ? it : { ...it, _selected: val }));
  const removeItem = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i));

  const selectedItems = items.filter(it => it._selected && !it._saved);

  // ── Save ───────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!user || !selectedItems.length) return;
    setSaving(true);

    let settings: any = null;
    try {
      settings = await getSettingsDB(user.id);
    } catch { /* ignore — use defaults */ }

    const exchangeRate = Number(settings?.exchange_rate) || 1695;
    const customsPct = Number(settings?.customs_percent) || 15;

    let saved = 0;
    const updated = [...items];

    for (let i = 0; i < updated.length; i++) {
      const it = updated[i];
      if (!it._selected || it._saved) continue;

      try {
        if (mode === "products") {
          // Build a product record — cost_usd comes from unit_price (if USD)
          const costUSD = it.currency === "USD" ? it.unit_price : it.unit_price / exchangeRate;
          const customsFee = costUSD * (customsPct / 100);
          const totalCostUSD = costUSD + customsFee;
          const salePrice = Math.round(totalCostUSD * exchangeRate * 2); // default 2× margin

          await addProductDB({
            name: it.name,
            brand: it.brand || "",
            category: guessCategory(`${it.name} ${it.brand || ""}`),
            cost_usd: parseFloat(costUSD.toFixed(4)),
            customs_fee: parseFloat(customsFee.toFixed(4)),
            total_cost_usd: parseFloat(totalCostUSD.toFixed(4)),
            sale_price_ars: salePrice,
            stock: it.qty,
            description: [it.notes, supplier ? `Proveedor: ${supplier}` : null].filter(Boolean).join(" | ") || null,
            exchange_rate: exchangeRate,
          });
        } else {
          // Build a purchase record
          const costUSD = it.currency === "USD" ? it.unit_price : it.unit_price / exchangeRate;
          const totalUSD = costUSD * it.qty;
          const totalARS = it.currency === "ARS" ? it.unit_price * it.qty : totalUSD * exchangeRate;

          await addPurchaseDB({
            product_name: it.name,
            supplier: supplier || null,
            quantity: it.qty,
            cost_usd: parseFloat(costUSD.toFixed(4)),
            total_usd: parseFloat(totalUSD.toFixed(4)),
            total_ars: parseFloat(totalARS.toFixed(2)),
            date: invoiceDate || new Date().toISOString().slice(0, 10),
            notes: it.notes || null,
            is_scheduled: false,
          });
        }

        updated[i] = { ...updated[i], _saved: true, _error: null };
        saved++;
      } catch (err: any) {
        updated[i] = { ...updated[i], _error: err.message || "Error al guardar" };
      }
    }

    setItems(updated);
    setSaving(false);

    if (saved > 0) {
      toast.success(
        mode === "products"
          ? `${saved} producto${saved !== 1 ? "s" : ""} importado${saved !== 1 ? "s" : ""} correctamente`
          : `${saved} compra${saved !== 1 ? "s" : ""} registrada${saved !== 1 ? "s" : ""} correctamente`
      );
      onImported();
    }

    const errors = updated.filter(it => it._error);
    if (errors.length) toast.error(`${errors.length} ítem${errors.length !== 1 ? "s" : ""} no se pudieron guardar`);

    // If all saved, auto-close
    if (updated.every(it => it._saved || !it._selected)) {
      setTimeout(onClose, 900);
    }
  };

  const allSaved = items.length > 0 && items.every(it => it._saved);

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 min-h-0">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
          <Sparkles className="w-4 h-4 text-primary" />
        </div>
        <div>
          <h2 className="font-display font-semibold text-base leading-tight">
            Importar desde Factura IA
          </h2>
          <p className="text-xs text-muted-foreground">
            {mode === "products"
              ? "Claude detecta los productos y los agrega al inventario"
              : "Claude detecta los ítems y los registra como compras"}
          </p>
        </div>
        <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Step 1 — Upload */}
      {!extracted && (
        <div className="flex flex-col gap-3">
          {/* Drop zone */}
          <div
            className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer
              ${dragOver ? "border-primary bg-primary/5 scale-[1.01]" : "border-border hover:border-primary/50 hover:bg-muted/30"}
              ${file ? "border-primary/40 bg-primary/5" : ""}
            `}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => !file && inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept={SUPPORTED_EXT}
              className="hidden"
              onChange={onInputChange}
            />

            {file ? (
              <div className="flex items-center justify-center gap-3">
                <FileText className="w-8 h-8 text-primary shrink-0" />
                <div className="text-left min-w-0">
                  <p className="font-medium text-sm truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {file.type === "application/pdf" ? "PDF" : "Imagen"} · {(file.size / 1024).toFixed(0)} KB
                  </p>
                </div>
                <button
                  className="ml-auto p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                  onClick={(e) => { e.stopPropagation(); setFile(null); setExtractError(null); }}
                  title="Quitar archivo"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Upload className="w-8 h-8 opacity-50" />
                <div>
                  <p className="font-medium text-sm">Arrastrá tu factura aquí</p>
                  <p className="text-xs mt-0.5">o hacé clic para seleccionar</p>
                </div>
                <div className="flex gap-1.5 mt-1">
                  {["JPG", "PNG", "WebP", "PDF"].map(t => (
                    <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground font-mono">{t}</span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Extract error */}
          {extractError && (
            <div className="flex items-start gap-2 text-sm bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2.5 text-destructive">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{extractError}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">
              Usá fotos claras o PDFs con texto. Máx 20 MB.
            </p>
            <Button
              onClick={handleExtract}
              disabled={!file || extracting}
              className="gradient-gold text-primary-foreground font-semibold shadow-gold min-w-[140px]"
            >
              {extracting ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Analizando…</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" />Analizar con IA</>
              )}
            </Button>
          </div>

          {/* Processing hint */}
          {extracting && (
            <div className="text-center py-4">
              <div className="inline-flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-full px-4 py-2">
                <Loader2 className="w-3 h-3 animate-spin text-primary" />
                Claude está leyendo la factura… puede tardar 15-30 segundos
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 2 — Review & Edit */}
      {extracted && items.length > 0 && (
        <div className="flex flex-col gap-3 min-h-0">
          {/* Invoice meta */}
          <div className="flex flex-wrap items-center gap-3 p-3 bg-muted/30 rounded-xl border border-border/50">
            <div className="flex-1 min-w-[180px]">
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Proveedor</label>
              <Input
                value={supplier}
                onChange={e => setSupplier(e.target.value)}
                placeholder="Nombre del proveedor"
                className="h-7 text-sm mt-0.5 bg-transparent border-none shadow-none px-0 focus-visible:ring-0"
              />
            </div>
            {mode === "purchases" && (
              <div className="min-w-[140px]">
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Fecha factura</label>
                <Input
                  type="date"
                  value={invoiceDate}
                  onChange={e => setInvoiceDate(e.target.value)}
                  className="h-7 text-sm mt-0.5 bg-transparent border-none shadow-none px-0 focus-visible:ring-0"
                />
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">
                <Sparkles className="w-3 h-3 mr-1 text-primary" />
                {items.length} ítem{items.length !== 1 ? "s" : ""} detectado{items.length !== 1 ? "s" : ""}
              </Badge>
              <button
                className="text-xs text-muted-foreground hover:text-foreground underline"
                onClick={() => { setExtracted(false); setFile(null); setItems([]); setExtractError(null); }}
              >
                Cambiar archivo
              </button>
            </div>
          </div>

          {/* Advanced toggle */}
          <button
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground w-fit"
            onClick={() => setShowAdvanced(v => !v)}
          >
            {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {showAdvanced ? "Ocultar" : "Mostrar"} columnas extra
          </button>

          {/* Select all / deselect */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              id="sel-all"
              className="accent-primary"
              checked={selectedItems.length === items.filter(it => !it._saved).length && items.filter(it => !it._saved).length > 0}
              onChange={e => toggleAll(e.target.checked)}
            />
            <label htmlFor="sel-all" className="cursor-pointer select-none">
              Seleccionar todos ({selectedItems.length}/{items.filter(it => !it._saved).length})
            </label>
          </div>

          {/* Items table */}
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 text-xs text-muted-foreground">
                  <th className="px-2 py-2 text-center w-8"></th>
                  <th className="px-3 py-2 text-left font-medium">Nombre</th>
                  {showAdvanced && <th className="px-3 py-2 text-left font-medium">Marca</th>}
                  <th className="px-2 py-2 text-center font-medium w-16">Cant.</th>
                  <th className="px-2 py-2 text-right font-medium w-28">Precio unit.</th>
                  <th className="px-2 py-2 text-center font-medium w-20">Moneda</th>
                  {showAdvanced && <th className="px-3 py-2 text-left font-medium">Notas</th>}
                  <th className="px-2 py-2 text-center w-8"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr
                    key={i}
                    className={`border-t border-border/50 transition-colors
                      ${it._saved ? "opacity-50 bg-emerald-500/5" : ""}
                      ${it._error ? "bg-destructive/5" : ""}
                      ${it._selected && !it._saved ? "bg-primary/3" : ""}
                    `}
                  >
                    {/* Checkbox */}
                    <td className="px-2 py-1.5 text-center">
                      {it._saved ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 mx-auto" />
                      ) : (
                        <input
                          type="checkbox"
                          className="accent-primary"
                          checked={it._selected}
                          onChange={e => updateItem(i, { _selected: e.target.checked })}
                        />
                      )}
                    </td>

                    {/* Name */}
                    <td className="px-3 py-1.5">
                      <input
                        className="w-full bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 rounded px-1 -mx-1"
                        value={it.name}
                        onChange={e => updateItem(i, { name: e.target.value })}
                        disabled={it._saved}
                      />
                      {it._error && <p className="text-[10px] text-destructive mt-0.5">{it._error}</p>}
                    </td>

                    {/* Brand (advanced) */}
                    {showAdvanced && (
                      <td className="px-3 py-1.5">
                        <input
                          className="w-full bg-transparent text-sm text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 rounded px-1 -mx-1"
                          value={it.brand || ""}
                          placeholder="—"
                          onChange={e => updateItem(i, { brand: e.target.value || null })}
                          disabled={it._saved}
                        />
                      </td>
                    )}

                    {/* Qty */}
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min="1"
                        className="w-full text-center bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 rounded px-1"
                        value={it.qty}
                        onChange={e => updateItem(i, { qty: Math.max(1, parseInt(e.target.value) || 1) })}
                        disabled={it._saved}
                      />
                    </td>

                    {/* Unit price */}
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="w-full text-right bg-transparent text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 rounded px-1"
                        value={it.unit_price}
                        onChange={e => updateItem(i, { unit_price: parseFloat(e.target.value) || 0 })}
                        disabled={it._saved}
                      />
                    </td>

                    {/* Currency */}
                    <td className="px-2 py-1.5 text-center">
                      {it._saved ? (
                        <span className="text-xs font-mono text-muted-foreground">{it.currency}</span>
                      ) : (
                        <Select
                          value={it.currency}
                          onValueChange={(v) => updateItem(i, { currency: v as "USD" | "ARS" })}
                        >
                          <SelectTrigger className="h-7 text-xs px-2 bg-transparent border-border/50">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="USD">USD</SelectItem>
                            <SelectItem value="ARS">ARS</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </td>

                    {/* Notes (advanced) */}
                    {showAdvanced && (
                      <td className="px-3 py-1.5">
                        <input
                          className="w-full bg-transparent text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 rounded px-1 -mx-1"
                          value={it.notes || ""}
                          placeholder="—"
                          onChange={e => updateItem(i, { notes: e.target.value || null })}
                          disabled={it._saved}
                        />
                      </td>
                    )}

                    {/* Remove */}
                    <td className="px-2 py-1.5 text-center">
                      {!it._saved && (
                        <button
                          onClick={() => removeItem(i)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          title="Quitar ítem"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Add row manually */}
          <button
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
            onClick={() => setItems(prev => [...prev, {
              name: "", brand: null, qty: 1, unit_price: 0, currency: "USD",
              notes: null, _selected: true, _saved: false, _error: null,
            }])}
          >
            <Plus className="w-3.5 h-3.5" />
            Agregar ítem manualmente
          </button>

          {/* Footer actions */}
          <div className="flex items-center justify-between gap-3 pt-1 border-t border-border/50">
            <div className="text-xs text-muted-foreground">
              {allSaved ? (
                <span className="flex items-center gap-1.5 text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" />
                  Todo importado correctamente
                </span>
              ) : (
                <>
                  {selectedItems.length} ítem{selectedItems.length !== 1 ? "s" : ""} seleccionado{selectedItems.length !== 1 ? "s" : ""}
                  {mode === "products" ? " → se agregarán al inventario" : " → se registrarán como compras"}
                </>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                {allSaved ? "Cerrar" : "Cancelar"}
              </Button>
              {!allSaved && (
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={saving || selectedItems.length === 0}
                  className="gradient-gold text-primary-foreground font-semibold shadow-gold min-w-[120px]"
                >
                  {saving ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando…</>
                  ) : (
                    mode === "products"
                      ? `Guardar ${selectedItems.length} producto${selectedItems.length !== 1 ? "s" : ""}`
                      : `Registrar ${selectedItems.length} compra${selectedItems.length !== 1 ? "s" : ""}`
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
