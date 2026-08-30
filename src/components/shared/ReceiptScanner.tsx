/**
 * ReceiptScanner — captura un comprobante y propone datos para el gasto.
 *
 * La imagen se conserva local hasta que la persona confirma el formulario: si
 * cierra o la extracción falla, no quedan objetos huérfanos en Storage. Sólo al
 * tocar «Extraer datos» se envía a `extract-receipt`; monto, proveedor, fecha y
 * categoría siguen siendo sugerencias que se revisan antes de registrar.
 */
import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Camera, Upload, X, Loader2, CheckCircle2, RotateCcw, ScanLine, AlertTriangle, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { mensajeDeEdgeFunction } from "@/lib/edgeErrors";
import { comprimirImagen, validarImagen, PRESETS } from "@/lib/imageUpload";

interface ExtractedReceipt {
  amount: number | null;
  vendor: string | null;
  date: string | null;
  category: string | null;
  description: string | null;
  receiptFile: Blob | null;
}

interface ReceiptScannerProps {
  onExtracted: (data: ExtractedReceipt) => void;
  onClose: () => void;
  /** Organización contra la que el servidor valida membresía y plan. */
  orgId?: string;
  /** Slugs reales del comercio; el modelo no puede inventar una categoría. */
  categorias: string[];
}

const TIPOS_EXTRAIBLES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/** Base64 sin el prefijo `data:`. */
function leerBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("No se pudo leer el comprobante"));
    reader.readAsDataURL(blob);
  });
}

export default function ReceiptScanner({ onExtracted, onClose, orgId, categorias }: ReceiptScannerProps) {
  const { user } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<"idle" | "camera" | "preview" | "processing" | "done">("idle");
  const [capturedDataUrl, setCapturedDataUrl] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [result, setResult] = useState<ExtractedReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Camera ──────────────────────────────────────────────────────────────────

  const startCamera = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setMode("camera");
    } catch (e) {
      setError("No se pudo acceder a la cámara. Probá subiendo una imagen.");
      console.error("ReceiptScanner.startCamera:", e);
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const capture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")!.drawImage(video, 0, 0);

    canvas.toBlob(blob => {
      if (!blob) return;
      setCapturedBlob(blob);
      setCapturedDataUrl(canvas.toDataURL("image/jpeg", 0.92));
      stopCamera();
      setMode("preview");
    }, "image/jpeg", 0.92);
  }, [stopCamera]);

  const retake = useCallback(() => {
    setCapturedDataUrl(null);
    setCapturedBlob(null);
    setResult(null);
    setError(null);
    void startCamera();
  }, [startCamera]);

  // ── File upload fallback ─────────────────────────────────────────────────────

  const handleFile = useCallback(async (file: File) => {
    const check = validarImagen(file);
    if (!check.ok) {
      toast.error(check.motivo);
      return;
    }
    setError(null);

    // La documentación oficial recomienda reducir imágenes grandes antes de
    // visión: baja latencia y costo sin mejorar menos la lectura del ticket.
    const comprimida = await comprimirImagen(file, PRESETS.producto);
    if (!TIPOS_EXTRAIBLES.has(comprimida.type)) {
      toast.error("La extracción admite JPG, PNG, WebP o GIF. Podés adjuntar este archivo y completar el gasto manualmente.");
      return;
    }

    setCapturedBlob(comprimida);
    setCapturedDataUrl(`data:${comprimida.type};base64,${await leerBase64(comprimida)}`);
    setMode("preview");
  }, []);

  // ── AI extraction ────────────────────────────────────────────────────────────

  const processReceipt = useCallback(async () => {
    if (!capturedBlob) return;
    if (!user) {
      setError("Necesitás iniciar sesión para extraer datos del comprobante.");
      return;
    }
    if (!orgId) {
      setError("No hay una organización activa para registrar este gasto.");
      return;
    }
    setMode("processing");
    setError(null);

    try {
      const mediaType = capturedBlob.type || "image/jpeg";
      const fileBase64 = await leerBase64(capturedBlob);
      const { data, error: invokeError } = await supabase.functions.invoke("extract-receipt", {
        body: { fileBase64, mediaType, orgId, categorias },
      });

      const motivo = await mensajeDeEdgeFunction(invokeError, data);
      if (motivo) {
        console.error("ReceiptScanner.extract-receipt:", motivo, invokeError);
        setError(motivo);
        setMode("preview");
        return;
      }

      const extracted: ExtractedReceipt = {
        amount: typeof data?.amount === "number" ? data.amount : null,
        vendor: typeof data?.vendor === "string" ? data.vendor : null,
        date: typeof data?.date === "string" ? data.date : null,
        category: typeof data?.category === "string" ? data.category : null,
        description: typeof data?.description === "string" ? data.description : null,
        receiptFile: capturedBlob,
      };
      if (extracted.amount == null && !extracted.vendor && !extracted.date && !extracted.description) {
        setError("No se pudo leer ningún dato. Probá con más luz, sin reflejos y más cerca.");
        setMode("preview");
        return;
      }
      setResult(extracted);
      setMode("done");
    } catch (e) {
      console.error("ReceiptScanner.processReceipt:", e);
      setError(e instanceof Error ? e.message : "No se pudo procesar el comprobante. Podés ingresarlo manualmente.");
      setMode("preview");
    }
  }, [capturedBlob, user, orgId, categorias]);

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    stopCamera();
    onClose();
  }, [stopCamera, onClose]);

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} className="hidden" />

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Idle: choose camera or upload ── */}
      {mode === "idle" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="outline"
              className="h-20 flex-col gap-2 border-dashed hover:border-primary/50 hover:bg-primary/5"
              onClick={startCamera}
            >
              <Camera className="w-6 h-6 text-primary" />
              <span className="text-xs">Usar cámara</span>
            </Button>
            <Button
              variant="outline"
              className="h-20 flex-col gap-2 border-dashed hover:border-primary/50 hover:bg-primary/5"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-6 h-6 text-muted-foreground" />
              <span className="text-xs">Subir imagen</span>
            </Button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ""; }}
          />
          <div className="flex items-start gap-2 rounded-lg bg-muted/45 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <p>Al extraer, la imagen se envía a Anthropic para sugerir datos. No se guarda hasta registrar el gasto y siempre tenés que revisarlos.</p>
          </div>
        </div>
      )}

      {/* ── Camera view ── */}
      {mode === "camera" && (
        <div className="space-y-3">
          <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
            <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
            {/* Viewfinder overlay */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-64 h-40 border-2 border-white/60 rounded-lg shadow-[0_0_0_1000px_rgba(0,0,0,0.35)]" />
            </div>
            <p className="absolute bottom-3 left-0 right-0 text-center text-white/70 text-xs">
              Centrá el ticket en el recuadro
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => { stopCamera(); setMode("idle"); }}>
              <X className="w-4 h-4 mr-1" />Cancelar
            </Button>
            <Button size="sm" className="flex-1 gradient-gold text-primary-foreground font-semibold" onClick={capture}>
              <ScanLine className="w-4 h-4 mr-1" />Capturar
            </Button>
          </div>
        </div>
      )}

      {/* ── Preview captured image ── */}
      {mode === "preview" && capturedDataUrl && (
        <div className="space-y-3">
          <div className="rounded-xl overflow-hidden border border-border/40 max-h-60 flex items-center justify-center bg-black">
            <img src={capturedDataUrl} alt="Ticket" className="max-w-full max-h-60 object-contain" />
          </div>
          <div className="flex gap-3">
            <Button variant="outline" size="sm" className="flex-1" onClick={retake}>
              <RotateCcw className="w-4 h-4 mr-1" />Volver a tomar
            </Button>
            <Button size="sm" className="flex-1 gradient-gold text-primary-foreground font-semibold" onClick={processReceipt}>
              <ScanLine className="w-4 h-4 mr-1" />Extraer datos
            </Button>
          </div>
        </div>
      )}

      {/* ── Processing ── */}
      {mode === "processing" && (
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground/80">Analizando con IA…</p>
          <p className="text-xs text-muted-foreground/50">Reconociendo monto, proveedor y categoría</p>
        </div>
      )}

      {/* ── Done: show extracted data ── */}
      {mode === "done" && result && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
            <CheckCircle2 className="w-4 h-4" />
            Sugerencias listas para revisar
          </div>

          <div className="rounded-lg bg-muted/30 border border-border/40 divide-y divide-border/30">
            {[
              { label: "Monto", value: result.amount != null ? `$${result.amount.toLocaleString("es-AR")}` : null },
              { label: "Proveedor", value: result.vendor },
              { label: "Fecha", value: result.date },
              { label: "Categoría", value: result.category },
              { label: "Descripción", value: result.description },
            ].map(({ label, value }) => value && (
              <div key={label} className="flex items-center justify-between px-3 py-2 text-xs">
                <span className="text-muted-foreground/70">{label}</span>
                <span className="font-medium text-right max-w-[60%]">{value}</span>
              </div>
            ))}
          </div>

          <div className="flex gap-3">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => { setMode("idle"); setResult(null); setError(null); }}>
              <RotateCcw className="w-4 h-4 mr-1" />Reintentar
            </Button>
            <Button
              size="sm"
              className="flex-1 gradient-gold text-primary-foreground font-semibold"
              onClick={() => { onExtracted(result); handleClose(); }}
            >
              <CheckCircle2 className="w-4 h-4 mr-1" />Aplicar sugerencias
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
