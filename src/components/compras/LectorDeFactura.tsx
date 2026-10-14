import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertCircle, FileText, Loader2, Sparkles, Upload, X } from "lucide-react";
import { llamarIA } from "@/lib/ia";
import type { FacturaLeida } from "@/lib/compras";

/**
 * Leer la factura del proveedor con IA (2026-10-14). Antes «Cargar factura con
 * IA» guardaba cada renglón como una compra suelta con columnas que no existen
 * (fallaba siempre), sin producto del catálogo y con un 15 % agregado. Ahora
 * sólo lee: lo leído precarga el editor de compra, donde se revisa, se elige el
 * producto de cada renglón dudoso y se registra como cualquier compra.
 */

const TIPOS = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp", "application/pdf"];
const EXTENSIONES = ".jpg,.jpeg,.png,.gif,.webp,.pdf";
const MAXIMO = 20 * 1024 * 1024;

type Respuesta = {
  supplier?: string | null;
  invoice_date?: string | null;
  items?: Array<{ name?: string; brand?: string | null; qty?: number; unit_price?: number; currency?: string }>;
};

function aBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(",")[1] ?? "");
    lector.onerror = () => reject(new Error("No se pudo leer el archivo"));
    lector.readAsDataURL(file);
  });
}

export default function LectorDeFactura({ open, onOpenChange, orgId, onLeida }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  onLeida: (factura: FacturaLeida) => void;
}) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const elegir = (f: File | undefined) => {
    if (!f) return;
    setError(null);
    if (!TIPOS.includes(f.type)) { setError("Usá una foto (JPG, PNG, WebP) o un PDF."); return; }
    if (f.size > MAXIMO) { setError("El archivo pesa más de 20 MB."); return; }
    setArchivo(f);
  };

  const leer = async () => {
    if (!archivo) return;
    setLeyendo(true);
    setError(null);
    try {
      const fileBase64 = await aBase64(archivo);
      const mediaType = archivo.type === "image/jpg" ? "image/jpeg" : archivo.type;
      const r = await llamarIA<Respuesta>("extract-invoice", { body: { fileBase64, mediaType, orgId } }, "No se pudo leer la factura");
      const renglones = (r?.items ?? [])
        .map(it => ({
          nombre: String(it.name ?? "").trim(),
          marca: it.brand ?? null,
          qty: Number(it.qty) > 0 ? Number(it.qty) : 1,
          costo: Number(it.unit_price) > 0 ? Number(it.unit_price) : 0,
          moneda: (it.currency === "USD" ? "USD" : "ARS") as "USD" | "ARS",
        }))
        .filter(it => it.nombre);
      if (renglones.length === 0) {
        setError("No se encontraron productos en la factura. Probá con una foto más nítida o un PDF con texto.");
        return;
      }
      onLeida({ proveedor: r?.supplier ?? null, fecha: r?.invoice_date ?? null, renglones });
      setArchivo(null);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer la factura");
    } finally {
      setLeyendo(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!leyendo) { onOpenChange(v); if (!v) { setArchivo(null); setError(null); } } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" />Leer factura del proveedor</DialogTitle>
          <DialogDescription>La IA lee proveedor, fecha, productos, cantidades y costos. Después revisás todo antes de registrar la compra.</DialogDescription>
        </DialogHeader>

        <div
          role="button"
          tabIndex={0}
          aria-label="Elegir la factura"
          className={`rounded-lg border-2 border-dashed p-6 text-center transition-colors ${arrastrando ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"}`}
          onClick={() => !archivo && input.current?.click()}
          onKeyDown={e => { if ((e.key === "Enter" || e.key === " ") && !archivo) { e.preventDefault(); input.current?.click(); } }}
          onDragOver={e => { e.preventDefault(); setArrastrando(true); }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={e => { e.preventDefault(); setArrastrando(false); elegir(e.dataTransfer.files[0]); }}
        >
          <input ref={input} type="file" accept={EXTENSIONES} className="hidden" onChange={e => { elegir(e.target.files?.[0]); e.target.value = ""; }} />
          {archivo ? (
            <div className="flex items-center gap-3 text-left">
              <FileText className="h-8 w-8 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{archivo.name}</p>
                <p className="text-xs text-muted-foreground">{archivo.type === "application/pdf" ? "PDF" : "Imagen"} · {(archivo.size / 1024).toFixed(0)} KB</p>
              </div>
              <button type="button" aria-label="Quitar el archivo" className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={e => { e.stopPropagation(); setArchivo(null); setError(null); }} disabled={leyendo}>
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
              <Upload className="h-7 w-7 opacity-60" />
              <p className="text-sm font-medium text-foreground">Arrastrá la factura o hacé clic</p>
              <p className="text-xs">Foto o PDF, hasta 20 MB</p>
            </div>
          )}
        </div>

        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={leyendo}>Cancelar</Button>
          <Button type="button" onClick={() => void leer()} disabled={!archivo || leyendo}>
            {leyendo ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Leyendo… (15–30 s)</> : <><Sparkles className="mr-2 h-4 w-4" />Leer factura</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
