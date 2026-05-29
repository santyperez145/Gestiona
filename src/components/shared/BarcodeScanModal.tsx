/**
 * BarcodeScanModal — Camera barcode scanner modal.
 *
 * Uses useBarcodeScan (BarcodeDetector API). If unsupported, falls back to a
 * simple manual text input field.
 *
 * Props:
 *   open      — controlled open state
 *   onClose   — close handler
 *   onDetect  — called with the detected barcode string
 */
import { useEffect, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScanLine, Camera, CameraOff, Loader2, Keyboard } from "lucide-react";
import { useBarcodeScan, barcodeScanSupported } from "@/hooks/useBarcodeScan";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onClose: () => void;
  onDetect: (code: string) => void;
  title?: string;
}

export default function BarcodeScanModal({ open, onClose, onDetect, title = "Escanear código" }: Props) {
  const manualRef = useRef<HTMLInputElement>(null);

  const { videoRef, scanning, start, stop, error, supported } = useBarcodeScan({
    onDetect: (code) => {
      toast.success(`Código detectado: ${code}`, { duration: 2000 });
      onDetect(code);
      stop();
      onClose();
    },
  });

  // Start camera when modal opens (if supported)
  useEffect(() => {
    if (open && supported) {
      start();
    }
    return () => {
      if (supported) stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Focus manual input when modal opens (if not supported)
  useEffect(() => {
    if (open && !supported) {
      setTimeout(() => manualRef.current?.focus(), 100);
    }
  }, [open, supported]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const val = manualRef.current?.value.trim();
    if (val) {
      onDetect(val);
      onClose();
    }
  };

  const handleClose = () => {
    stop();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) handleClose(); }}>
      <DialogContent className="bg-card border-border/60 max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="w-5 h-5 text-primary" />
            {title}
          </DialogTitle>
        </DialogHeader>

        {supported ? (
          <div className="space-y-4">
            {/* Camera viewfinder */}
            <div className="relative aspect-video rounded-lg overflow-hidden bg-black/80 border border-border/40">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                autoPlay
                muted
                playsInline
              />
              {/* Scanning overlay */}
              {scanning && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-48 h-28 border-2 border-primary/70 rounded-lg relative">
                    {/* Corner decorations */}
                    <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-primary rounded-tl" />
                    <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-primary rounded-tr" />
                    <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-primary rounded-bl" />
                    <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-primary rounded-br" />
                    {/* Scan line animation */}
                    <div className="absolute inset-x-0 top-1/2 h-0.5 bg-primary/60 animate-[scan-line_2s_ease-in-out_infinite]" />
                  </div>
                </div>
              )}
              {!scanning && !error && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
                </div>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive">
                <CameraOff className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {scanning ? (
                <>
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  Escaneando — apunta la cámara al código de barras
                </>
              ) : (
                <>
                  <Camera className="w-3.5 h-3.5" /> Iniciando cámara...
                </>
              )}
            </div>

            {/* Also allow manual entry */}
            <div className="border-t border-border/40 pt-3">
              <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                <Keyboard className="w-3 h-3" /> O ingresá el código manualmente:
              </p>
              <form onSubmit={handleManualSubmit} className="flex gap-2">
                <Input ref={manualRef} placeholder="Código de barras..." className="h-8 text-sm" />
                <Button type="submit" size="sm" variant="secondary" className="h-8">OK</Button>
              </form>
            </div>
          </div>
        ) : (
          /* Fallback: no BarcodeDetector support */
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-sm text-yellow-400">
              <Camera className="w-4 h-4 shrink-0" />
              Tu navegador no soporta escaneo automático. Ingresá el código manualmente.
            </div>
            <Badge variant="outline" className="text-xs">
              Consejo: usar Chrome en Android para escaneo con cámara
            </Badge>
            <form onSubmit={handleManualSubmit} className="space-y-3">
              <Input
                ref={manualRef}
                placeholder="Código de barras o QR..."
                autoFocus
                className="text-center text-lg tracking-widest font-mono"
              />
              <div className="flex gap-2">
                <Button type="button" variant="ghost" className="flex-1" onClick={handleClose}>
                  Cancelar
                </Button>
                <Button type="submit" className="flex-1">
                  <ScanLine className="w-4 h-4 mr-2" /> Buscar
                </Button>
              </div>
            </form>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
