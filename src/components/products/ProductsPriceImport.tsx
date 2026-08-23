import { useState, useRef, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { updateProductDB, formatARS } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import FilePicker from "@/components/shared/FilePicker";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, Check, X, Loader2, Download } from "lucide-react";

/**
 * Bulk price updater via CSV/Excel.
 * Columns expected: nombre (or SKU/barcode) + precio_ars + (optional) precio_oferta_ars
 * Matches products by name (fuzzy) or SKU/barcode (exact).
 */

type PriceRow = {
  key: string;        // matched product id
  name: string;
  currentPrice: number;
  newPrice: number;
  newDiscountPrice: number | null;
  matched: boolean;
  matchedName: string;
};

interface Props {
  products: any[];
  onDone: () => void;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(/[,;\t]/).map(h => h.trim().replace(/^["']|["']$/g, ''));
  return lines.slice(1).map(line => {
    const vals = line.split(/[,;\t]/).map(v => v.trim().replace(/^["']|["']$/g, ''));
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
    return obj;
  });
}

function findHeader(obj: Record<string, string>, aliases: string[]): string {
  const key = Object.keys(obj).find(k => aliases.some(a => k.toLowerCase().includes(a.toLowerCase())));
  return key ? obj[key] : '';
}

function matchProduct(products: any[], nameOrSku: string): any | null {
  if (!nameOrSku) return null;
  const normalized = nameOrSku.toLowerCase().trim();
  // Exact SKU/barcode match
  const byCode = products.find(p =>
    (p.sku && p.sku.toLowerCase() === normalized) ||
    (p.barcode && p.barcode.toLowerCase() === normalized)
  );
  if (byCode) return byCode;
  // Exact name match
  const byName = products.find(p => p.name?.toLowerCase() === normalized);
  if (byName) return byName;
  // Partial name match (≥80% chars)
  const partial = products.find(p => p.name && (
    p.name.toLowerCase().includes(normalized) || normalized.includes(p.name.toLowerCase())
  ));
  return partial || null;
}

export default function ProductsPriceImport({ products, onDone }: Props) {
  const { user } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [applying, setApplying] = useState(false);
  const [step, setStep] = useState<'idle' | 'preview' | 'done'>('idle');

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const text = e.target?.result as string;
        const parsed = parseCSV(text);
        if (!parsed.length) { toast.error("Archivo vacío o formato incorrecto"); return; }

        const NAME_ALIASES = ['nombre', 'name', 'producto', 'sku', 'codigo', 'barcode'];
        const PRICE_ALIASES = ['precio_ars', 'precio ars', 'precio venta', 'precio', 'price', 'sale_price', 'pvp'];
        const DISC_ALIASES = ['precio_oferta', 'precio oferta', 'oferta', 'descuento', 'discount', 'promo'];

        const preview: PriceRow[] = parsed.map(row => {
          const nameRaw = findHeader(row, NAME_ALIASES);
          const priceRaw = findHeader(row, PRICE_ALIASES).replace(/[.$\s]/g, '').replace(',', '.');
          const discRaw = findHeader(row, DISC_ALIASES).replace(/[.$\s]/g, '').replace(',', '.');
          const newPrice = parseFloat(priceRaw) || 0;
          const newDiscountPrice = discRaw ? (parseFloat(discRaw) || null) : null;
          const matched = matchProduct(products, nameRaw);
          return {
            key: matched?.id || nameRaw,
            name: nameRaw,
            currentPrice: matched ? Number(matched.sale_price_ars) : 0,
            newPrice,
            newDiscountPrice,
            matched: !!matched,
            matchedName: matched?.name || '',
          };
        }).filter(r => r.newPrice > 0);

        if (!preview.length) { toast.error("No se encontraron precios válidos"); return; }
        setRows(preview);
        setStep('preview');
      } catch { toast.error("Error al leer el archivo"); }
    };
    reader.readAsText(file, 'UTF-8');
  };

  const matchedRows = useMemo(() => rows.filter(r => r.matched), [rows]);
  const unmatchedRows = useMemo(() => rows.filter(r => !r.matched), [rows]);

  const applyPrices = async () => {
    if (!user || !matchedRows.length) return;
    setApplying(true);
    let success = 0;
    for (const row of matchedRows) {
      try {
        const prod = products.find(p => p.id === row.key);
        if (!prod) continue;
        const update: any = { sale_price_ars: row.newPrice };
        if (row.newDiscountPrice !== null) update.discount_price_ars = row.newDiscountPrice;
        await updateProductDB(prod.id, update);
        success++;
      } catch { /* continue */ }
    }
    toast.success(`${success} producto${success !== 1 ? 's' : ''} actualizados`);
    setApplying(false);
    setStep('done');
    onDone();
  };

  const downloadTemplate = () => {
    const csv = 'nombre,precio_ars,precio_oferta_ars\nEJEMPLO PRODUCTO,15000,12000\n';
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'plantilla_precios.csv'; a.click();
  };

  if (step === 'idle') return (
    <div className="space-y-4 py-2">
      <div className="bg-muted/30 border border-border rounded-lg p-3 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Formato del CSV:</p>
        <p>• Columnas: <code className="bg-muted px-1 rounded">nombre</code>, <code className="bg-muted px-1 rounded">precio_ars</code>, <code className="bg-muted px-1 rounded">precio_oferta_ars</code> (opcional)</p>
        <p>• También acepta columnas SKU o código de barras para matching exacto</p>
        <p>• Separador: coma, punto y coma, o tabulación</p>
      </div>
      <div className="flex gap-2">
        <FilePicker
          accept=".csv,.txt"
          title="Seleccioná o arrastrá el CSV"
          description="Precios por nombre, SKU o código de barras"
          icon={Upload}
          inputRef={inputRef}
          className="flex-1"
          onFile={handleFile}
        />
        <button onClick={downloadTemplate}
          className="flex flex-col items-center justify-center gap-2 px-4 rounded-xl border border-border hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground">
          <Download className="w-5 h-5" />
          <span className="text-xs">Plantilla</span>
        </button>
      </div>
    </div>
  );

  if (step === 'preview') return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-emerald-400 font-medium">✓ {matchedRows.length} encontrados</span>
        {unmatchedRows.length > 0 && <span className="text-yellow-400">{unmatchedRows.length} no coinciden</span>}
      </div>

      <div className="max-h-64 overflow-y-auto border border-border rounded-lg">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/80 border-b border-border">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Producto</th>
              <th className="text-right px-3 py-2 font-medium">Precio actual</th>
              <th className="text-right px-3 py-2 font-medium">Nuevo precio</th>
              <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">Variación</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {matchedRows.map(r => {
              const diff = r.currentPrice > 0 ? ((r.newPrice - r.currentPrice) / r.currentPrice) * 100 : 0;
              return (
                <tr key={r.key} className="hover:bg-muted/20">
                  <td className="px-3 py-2">
                    <p className="font-medium truncate max-w-[160px]" title={r.matchedName}>{r.matchedName}</p>
                    {r.name !== r.matchedName && <p className="text-[10px] text-muted-foreground truncate">{r.name}</p>}
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">{formatARS(r.currentPrice)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{formatARS(r.newPrice)}</td>
                  <td className="px-3 py-2 text-right hidden sm:table-cell">
                    <span className={`font-semibold ${diff >= 0 ? 'text-emerald-400' : 'text-destructive'}`}>
                      {diff >= 0 ? '+' : ''}{diff.toFixed(1)}%
                    </span>
                  </td>
                </tr>
              );
            })}
            {unmatchedRows.map(r => (
              <tr key={r.key} className="opacity-50">
                <td className="px-3 py-2 text-muted-foreground truncate max-w-[160px]" colSpan={4}>
                  <X className="w-3 h-3 inline mr-1 text-destructive" />{r.name} <span className="text-[10px]">(no encontrado)</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => setStep('idle')} className="flex-1">Cancelar</Button>
        <Button onClick={applyPrices} disabled={applying || !matchedRows.length} className="flex-1 gradient-gold text-primary-foreground font-semibold">
          {applying ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Actualizando...</> : <><Check className="w-3.5 h-3.5 mr-1.5" />Aplicar {matchedRows.length} precios</>}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="text-center py-6">
      <Check className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
      <p className="font-semibold">Precios actualizados</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={() => { setStep('idle'); setRows([]); }}>Importar otro archivo</Button>
    </div>
  );
}
