/**
 * BarcodeLabel — Render, download and print barcodes for products.
 *
 * Features:
 * - Generate CODE128, EAN-13, EAN-8, UPC barcodes from any string
 * - Download as SVG
 * - Print a sheet of labels (up to 40 products, 4-per-row)
 * - Customisable size, format and display name
 *
 * Usage:
 *   <BarcodeLabel value="7791234567890" label="Perfume Ambar" format="EAN13" />
 */
import { useEffect, useRef, useState, useCallback } from "react";
import JsBarcode from "jsbarcode";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Download, Printer } from "lucide-react";
import { toast } from "sonner";

interface BarcodeLabelProps {
  value: string;
  label?: string;
  format?: "CODE128" | "EAN13" | "EAN8" | "UPC" | "CODE39";
  showControls?: boolean;
}

const FORMATS = [
  { value: "CODE128", label: "Code 128 (universal)" },
  { value: "EAN13", label: "EAN-13 (13 dígitos)" },
  { value: "EAN8", label: "EAN-8 (8 dígitos)" },
  { value: "UPC", label: "UPC-A (12 dígitos)" },
  { value: "CODE39", label: "Code 39" },
];

export default function BarcodeLabel({ value, label, format: initialFormat = "CODE128", showControls = true }: BarcodeLabelProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [format, setFormat] = useState(initialFormat);
  const [currentValue, setCurrentValue] = useState(value);
  const [error, setError] = useState<string | null>(null);

  const render = useCallback((val: string, fmt: string) => {
    if (!svgRef.current || !val.trim()) return;
    try {
      JsBarcode(svgRef.current, val, {
        format: fmt,
        width: 2,
        height: 70,
        displayValue: true,
        fontSize: 12,
        margin: 8,
        background: "#ffffff",
        lineColor: "#000000",
      });
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Formato inválido para este valor");
    }
  }, []);

  useEffect(() => { render(currentValue, format); }, [currentValue, format, render]);

  const handleDownload = () => {
    if (!svgRef.current) return;
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgRef.current);
    const blob = new Blob([svgStr], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `barcode-${currentValue}.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("Código de barras descargado");
  };

  const handlePrint = () => {
    if (!svgRef.current) return;
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svgRef.current);
    const displayLabel = label || currentValue;
    const w = window.open("", "_blank", "width=800,height=600");
    if (!w) { toast.error("Bloqueó ventana emergente"); return; }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Etiqueta — ${displayLabel}</title>
<style>
  @page { margin: 8mm; }
  body { font-family: Arial, sans-serif; display: flex; flex-wrap: wrap; gap: 6mm; padding: 4mm; background: #fff; }
  .label { text-align: center; break-inside: avoid; width: 60mm; border: 0.4px solid #ddd; padding: 3mm; border-radius: 2px; }
  .name { font-size: 8px; font-weight: bold; color: #111; margin-bottom: 2mm; word-break: break-word; }
  svg { max-width: 56mm; display: block; margin: 0 auto; }
</style></head><body>
${Array.from({ length: 20 }, () => `<div class="label"><div class="name">${displayLabel}</div>${svgStr}</div>`).join("")}
</body></html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 600);
  };

  return (
    <div className="space-y-3">
      {showControls && (
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={format} onValueChange={v => setFormat(v as typeof format)}>
            <SelectTrigger className="w-48 h-8 text-xs bg-muted border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FORMATS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            value={currentValue}
            onChange={e => setCurrentValue(e.target.value)}
            className="flex-1 h-8 text-xs bg-muted border-border font-mono"
            placeholder="Valor del código..."
          />
        </div>
      )}

      <div className={`bg-white rounded-lg p-3 flex justify-center items-center min-h-[100px] border ${error ? "border-red-400" : "border-border/30"}`}>
        {error ? (
          <p className="text-xs text-red-400 text-center max-w-[200px]">{error}</p>
        ) : (
          <svg ref={svgRef} className="max-w-full" />
        )}
      </div>

      {showControls && !error && (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1 gap-1.5 h-8 text-xs" onClick={handleDownload}>
            <Download className="w-3.5 h-3.5" />SVG
          </Button>
          <Button variant="outline" size="sm" className="flex-1 gap-1.5 h-8 text-xs" onClick={handlePrint}>
            <Printer className="w-3.5 h-3.5" />20 etiquetas
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Multi-product barcode print sheet ────────────────────────────────────────

interface BarcodePrintSheetProps {
  products: { id: string; name: string; sku?: string; barcode?: string }[];
  onClose?: () => void;
}

export function BarcodePrintSheet({ products, onClose }: BarcodePrintSheetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [format, setFormat] = useState("CODE128");
  const [rendered, setRendered] = useState(false);

  // Generate all barcodes when format changes or on mount
  useEffect(() => {
    if (!containerRef.current) return;
    const svgs = containerRef.current.querySelectorAll<SVGSVGElement>("svg[data-barcode]");
    svgs.forEach(svg => {
      const val = svg.getAttribute("data-barcode") || "";
      if (!val) return;
      try {
        JsBarcode(svg, val, { format, width: 1.5, height: 55, fontSize: 10, margin: 6, background: "#fff", lineColor: "#000", displayValue: true });
      } catch {
        /* ignore invalid format for this value */
      }
    });
    setRendered(true);
  }, [format, products]);

  const handlePrint = () => {
    if (!containerRef.current) return;
    const html = containerRef.current.innerHTML;
    const w = window.open("", "_blank");
    if (!w) { toast.error("Bloqueó ventana emergente"); return; }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Etiquetas de código de barras</title>
<style>
  @page { margin: 8mm; }
  body { font-family: Arial, sans-serif; margin: 0; background: #fff; }
  .grid { display: flex; flex-wrap: wrap; gap: 3mm; }
  .label { text-align: center; break-inside: avoid; width: 50mm; border: 0.4px solid #ccc; padding: 2mm; border-radius: 2px; }
  .name { font-size: 7px; font-weight: bold; color: #111; margin-bottom: 1mm; word-break: break-word; line-height: 1.2; }
  svg { max-width: 48mm; display: block; margin: 0 auto; }
</style></head><body><div class="grid">${html}</div></body></html>`);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 700);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={format} onValueChange={setFormat}>
          <SelectTrigger className="w-48 h-8 text-xs bg-muted border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FORMATS.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{products.length} productos</span>
        <Button onClick={handlePrint} size="sm" className="gradient-gold text-primary-foreground gap-1.5 ml-auto">
          <Printer className="w-4 h-4" />Imprimir hoja
        </Button>
      </div>

      {/* Hidden render area */}
      <div ref={containerRef} className="hidden">
        {products.slice(0, 40).map(p => {
          const code = p.barcode || p.sku || p.id.slice(0, 12);
          return (
            <div key={p.id} className="label">
              <div className="name">{p.name.slice(0, 30)}{p.name.length > 30 ? "…" : ""}</div>
              <svg data-barcode={code} />
            </div>
          );
        })}
      </div>

      {/* Preview grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-80 overflow-y-auto">
        {products.slice(0, 12).map(p => {
          const code = p.barcode || p.sku || p.id.slice(0, 12);
          return (
            <div key={p.id} className="bg-white rounded border border-border/30 p-2 text-center">
              <p className="text-[9px] font-medium text-gray-700 mb-1 truncate">{p.name}</p>
              <BarcodeSVG value={code} format={format} />
            </div>
          );
        })}
        {products.length > 12 && (
          <div className="bg-muted/20 rounded border border-border/20 p-4 flex items-center justify-center">
            <p className="text-xs text-muted-foreground text-center">+{products.length - 12} más en impresión</p>
          </div>
        )}
      </div>
    </div>
  );
}

function BarcodeSVG({ value, format }: { value: string; format: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, value, { format, width: 1.5, height: 40, fontSize: 9, margin: 4, background: "#fff", lineColor: "#000", displayValue: true });
    } catch { /* ignore */ }
  }, [value, format]);
  return <svg ref={ref} className="max-w-full" />;
}
