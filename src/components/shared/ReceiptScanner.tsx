/**
 * ReceiptScanner — Camera-based receipt capture with AI extraction.
 *
 * Captures a photo of a paper receipt via the device camera, uploads it to
 * Supabase Storage, then calls the AI chat endpoint to extract amount, vendor,
 * category, and date. Fills in the expense form automatically.
 *
 * Uses:
 *   - MediaDevices.getUserMedia() for camera access
 *   - HTMLCanvasElement for frame capture
 *   - Supabase Storage for image upload
 *   - Anthropic Claude via the existing AI endpoint for OCR+extraction
 *
 * Falls back to file upload if camera is unavailable.
 */
import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Camera, Upload, X, Loader2, CheckCircle2, RotateCcw, ScanLine } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

interface ExtractedReceipt {
  amount: number | null;
  vendor: string | null;
  date: string | null;
  category: string | null;
  description: string | null;
  imageUrl: string | null;
}

interface ReceiptScannerProps {
  onExtracted: (data: ExtractedReceipt) => void;
  onClose: () => void;
}

export default function ReceiptScanner({ onExtracted, onClose }: ReceiptScannerProps) {
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
    } catch (e: any) {
      setError("No se pudo acceder a la cámara. Probá subiendo una imagen.");
      console.error(e);
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
    startCamera();
  }, [startCamera]);

  // ── File upload fallback ─────────────────────────────────────────────────────

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Solo se aceptan imágenes");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      setCapturedDataUrl(e.target?.result as string);
    };
    reader.readAsDataURL(file);
    setCapturedBlob(file);
    setMode("preview");
  }, []);

  // ── AI extraction ────────────────────────────────────────────────────────────

  const processReceipt = useCallback(async () => {
    if (!capturedBlob || !user) return;
    setMode("processing");
    setError(null);

    try {
      // Upload to Supabase Storage
      const path = `receipts/${user.id}/${Date.now()}.jpg`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("expense-receipts")
        .upload(path, capturedBlob, { contentType: "image/jpeg", upsert: false });

      let imageUrl: string | null = null;
      if (!uploadError && uploadData) {
        const { data: urlData } = supabase.storage.from("expense-receipts").getPublicUrl(path);
        imageUrl = urlData.publicUrl;
      }

      // Call AI to extract receipt data
      const base64 = capturedDataUrl?.split(",")[1] ?? "";

      const { data: aiData, error: aiError } = await supabase.functions.invoke("ai-chat", {
        body: {
          messages: [{
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: "image/jpeg", data: base64 },
              },
              {
                type: "text",
                text: `Analizá este comprobante/ticket de caja y extraé la siguiente información en JSON:
{
  "amount": <número con el monto total en pesos, sin símbolo>,
  "vendor": "<nombre del comercio/proveedor>",
  "date": "<fecha en formato YYYY-MM-DD, o null si no se ve>",
  "category": "<una de: mercaderia, servicios, alquiler, transporte, sueldos, publicidad, impuestos, mantenimiento, otro>",
  "description": "<descripción breve de qué se compró>"
}
Respondé ÚNICAMENTE con el JSON, sin texto adicional.`,
              },
            ],
          }],
        },
      });

      let extracted: ExtractedReceipt = { amount: null, vendor: null, date: null, category: null, description: null, imageUrl };

      if (!aiError && aiData?.content) {
        try {
          const raw = typeof aiData.content === "string" ? aiData.content : JSON.stringify(aiData.content);
          const jsonMatch = raw.match(/\{[\s\S]+\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            extracted = {
              amount: parsed.amount ? Number(parsed.amount) : null,
              vendor: parsed.vendor || null,
              date: parsed.date || null,
              category: parsed.category || null,
              description: parsed.description || null,
              imageUrl,
            };
          }
        } catch {
          // JSON parse failed — return partial
        }
      }

      setResult(extracted);
      setMode("done");
    } catch (e: any) {
      setError("Error al procesar el comprobante. Podés ingresarlo manualmente.");
      setMode("preview");
    }
  }, [capturedBlob, capturedDataUrl, user]);

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

      {/* ── Idle: choose camera or upload ── */}
      {mode === "idle" && (
        <div className="space-y-3">
          {error && (
            <div className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</div>
          )}
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
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
          />
          <p className="text-[11px] text-muted-foreground/60 text-center">
            La IA extrae automáticamente monto, proveedor y categoría del ticket
          </p>
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
            Datos extraídos correctamente
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
            <Button variant="outline" size="sm" className="flex-1" onClick={() => { setMode("idle"); setResult(null); }}>
              <RotateCcw className="w-4 h-4 mr-1" />Reintentar
            </Button>
            <Button
              size="sm"
              className="flex-1 gradient-gold text-primary-foreground font-semibold"
              onClick={() => { onExtracted(result); handleClose(); }}
            >
              <CheckCircle2 className="w-4 h-4 mr-1" />Usar estos datos
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
