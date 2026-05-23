/**
 * useBarcodeScan — Native BarcodeDetector API + fallback to manual input.
 *
 * Uses the browser's built-in BarcodeDetector (Chrome 83+, Edge, Android Chrome)
 * to scan barcodes from a live camera stream. Falls back gracefully to a manual
 * text input when the API is unavailable.
 *
 * Usage:
 *   const { start, stop, scanning, lastCode, supported, videoRef } = useBarcodeScan({ onDetect });
 *   <video ref={videoRef} autoPlay muted playsInline />
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface UseBarcodeOptions {
  /** Called each time a new unique barcode is detected */
  onDetect: (code: string) => void;
  /** How long (ms) to suppress re-alerts for the same code. Default 2000ms */
  debounceMs?: number;
  /** Barcode formats to detect. Default: common retail formats */
  formats?: BarcodeFormat[];
}

type BarcodeFormat =
  | "aztec" | "code_128" | "code_39" | "code_93" | "codabar"
  | "data_matrix" | "ean_13" | "ean_8" | "itf" | "pdf417"
  | "qr_code" | "upc_a" | "upc_e" | "unknown";

const DEFAULT_FORMATS: BarcodeFormat[] = ["ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e", "qr_code"];

/** True when BarcodeDetector is available in this browser */
export const barcodeScanSupported = typeof window !== "undefined" && "BarcodeDetector" in window;

export function useBarcodeScan({
  onDetect,
  debounceMs = 2000,
  formats = DEFAULT_FORMATS,
}: UseBarcodeOptions) {
  const [scanning, setScanning] = useState(false);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<any>(null);
  const animFrameRef = useRef<number>(0);
  const lastDetectedRef = useRef<Map<string, number>>(new Map());
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;

  /** Create or reuse the BarcodeDetector instance */
  const getDetector = useCallback(async () => {
    if (detectorRef.current) return detectorRef.current;
    try {
      // Check supported formats
      const supported: BarcodeFormat[] = await (window as any).BarcodeDetector.getSupportedFormats();
      const usable = formats.filter(f => supported.includes(f));
      detectorRef.current = new (window as any).BarcodeDetector({
        formats: usable.length > 0 ? usable : supported,
      });
    } catch {
      detectorRef.current = new (window as any).BarcodeDetector({ formats });
    }
    return detectorRef.current;
  }, [formats]);

  /** Scan loop — runs every animation frame while scanning */
  const loop = useCallback(async (detector: any) => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      animFrameRef.current = requestAnimationFrame(() => loop(detector));
      return;
    }
    try {
      const barcodes: Array<{ rawValue: string }> = await detector.detect(video);
      if (barcodes.length > 0) {
        const code = barcodes[0].rawValue.trim();
        const now = Date.now();
        const last = lastDetectedRef.current.get(code) ?? 0;
        if (now - last > debounceMs) {
          lastDetectedRef.current.set(code, now);
          setLastCode(code);
          onDetectRef.current(code);
        }
      }
    } catch { /* frame failure — ignore */ }
    animFrameRef.current = requestAnimationFrame(() => loop(detector));
  }, [debounceMs]);

  /** Start camera + detector */
  const start = useCallback(async () => {
    if (!barcodeScanSupported) {
      setError("BarcodeDetector no disponible en este navegador");
      return;
    }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      const detector = await getDetector();
      setScanning(true);
      animFrameRef.current = requestAnimationFrame(() => loop(detector));
    } catch (err: any) {
      setError(err?.message ?? "No se pudo acceder a la cámara");
    }
  }, [getDetector, loop]);

  /** Stop camera + detector */
  const stop = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
  }, []);

  /** Cleanup on unmount */
  useEffect(() => () => stop(), [stop]);

  return {
    /** Ref to attach to a <video> element */
    videoRef,
    /** Whether the camera is actively scanning */
    scanning,
    /** Last detected barcode value */
    lastCode,
    /** Error message (e.g. camera denied) */
    error,
    /** Whether BarcodeDetector API is available */
    supported: barcodeScanSupported,
    /** Start scanning */
    start,
    /** Stop scanning */
    stop,
  };
}
