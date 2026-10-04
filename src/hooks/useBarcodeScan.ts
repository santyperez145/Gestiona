/**
 * useBarcodeScan — escáner nativo móvil + BarcodeDetector web + entrada manual.
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
import { isNativeRuntime } from "@/lib/nativeRuntime";

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

type BrowserBarcode = { rawValue: string };
type BrowserDetector = { detect: (source: HTMLVideoElement) => Promise<BrowserBarcode[]> };
type BrowserDetectorConstructor = {
  new(options: { formats: BarcodeFormat[] }): BrowserDetector;
  getSupportedFormats: () => Promise<BarcodeFormat[]>;
};

function browserDetectorConstructor(): BrowserDetectorConstructor | null {
  if (typeof window === "undefined" || !("BarcodeDetector" in window)) return null;
  return (window as Window & { BarcodeDetector: BrowserDetectorConstructor }).BarcodeDetector;
}

export function isNativeMobilePlatform(platform: string | null): boolean {
  return platform === "android" || platform === "ios";
}

export function isNativeMobileBarcodeRuntime(): boolean {
  return isNativeRuntime() && isNativeMobilePlatform(__NERQIA_NATIVE_PLATFORM__);
}

/** True when a native mobile scanner or the browser detector is available. */
export function barcodeScanSupported(): boolean {
  return isNativeMobileBarcodeRuntime() || browserDetectorConstructor() !== null;
}

export function useBarcodeScan({
  onDetect,
  debounceMs = 2000,
  formats = DEFAULT_FORMATS,
}: UseBarcodeOptions) {
  const supported = barcodeScanSupported();
  const [scanning, setScanning] = useState(false);
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BrowserDetector | null>(null);
  const animFrameRef = useRef<number>(0);
  const nativeScanActiveRef = useRef(false);
  const lastDetectedRef = useRef<Map<string, number>>(new Map());
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;

  /** Create or reuse the BarcodeDetector instance */
  const getDetector = useCallback(async () => {
    if (detectorRef.current) return detectorRef.current;
    const Detector = browserDetectorConstructor();
    if (!Detector) throw new Error("BarcodeDetector no disponible");
    try {
      // Check supported formats
      const supported = await Detector.getSupportedFormats();
      const usable = formats.filter(f => supported.includes(f));
      detectorRef.current = new Detector({
        formats: usable.length > 0 ? usable : supported,
      });
    } catch {
      detectorRef.current = new Detector({ formats });
    }
    return detectorRef.current;
  }, [formats]);

  /** Scan loop — runs every animation frame while scanning */
  const loop = useCallback(async (detector: BrowserDetector) => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      animFrameRef.current = requestAnimationFrame(() => loop(detector));
      return;
    }
    try {
      const barcodes = await detector.detect(video);
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
    if (!supported) {
      setError("El escáner automático no está disponible en este dispositivo");
      return;
    }
    setError(null);
    if (isNativeMobileBarcodeRuntime()) {
      setScanning(true);
      nativeScanActiveRef.current = true;
      try {
        const scanner = await import("@tauri-apps/plugin-barcode-scanner");
        let permission = await scanner.checkPermissions();
        if (permission !== "granted") permission = await scanner.requestPermissions();
        if (permission !== "granted") {
          setError("Para escanear, habilitá la cámara de Nerqia en los ajustes del dispositivo");
          return;
        }
        const nativeFormats = {
          aztec: scanner.Format.Aztec,
          code_128: scanner.Format.Code128,
          code_39: scanner.Format.Code39,
          code_93: scanner.Format.Code93,
          codabar: scanner.Format.Codabar,
          data_matrix: scanner.Format.DataMatrix,
          ean_13: scanner.Format.EAN13,
          ean_8: scanner.Format.EAN8,
          itf: scanner.Format.ITF,
          pdf417: scanner.Format.PDF417,
          qr_code: scanner.Format.QRCode,
          upc_a: scanner.Format.UPC_A,
          upc_e: scanner.Format.UPC_E,
        } satisfies Partial<Record<BarcodeFormat, import("@tauri-apps/plugin-barcode-scanner").Format>>;
        const result = await scanner.scan({
          cameraDirection: "back",
          formats: formats.flatMap((format) => nativeFormats[format] ? [nativeFormats[format]] : []),
        });
        const code = result.content.trim();
        if (code) {
          nativeScanActiveRef.current = false;
          setLastCode(code);
          onDetectRef.current(code);
        }
      } catch (scanError) {
        const message = scanError instanceof Error ? scanError.message : String(scanError);
        if (!/cancel|cancelado|cancelled/i.test(message)) {
          setError("No pudimos iniciar la cámara. Revisá el permiso e intentá nuevamente.");
        }
      } finally {
        nativeScanActiveRef.current = false;
        setScanning(false);
      }
      return;
    }
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
    } catch (cameraError) {
      setError(cameraError instanceof Error ? cameraError.message : "No se pudo acceder a la cámara");
    }
  }, [formats, getDetector, loop, supported]);

  /** Stop camera + detector */
  const stop = useCallback(() => {
    if (nativeScanActiveRef.current) {
      nativeScanActiveRef.current = false;
      void import("@tauri-apps/plugin-barcode-scanner")
        .then(({ cancel }) => cancel())
        .catch(() => undefined);
    }
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
    supported,
    /** Whether the OS owns the camera surface (Android/iOS). */
    native: isNativeMobileBarcodeRuntime(),
    /** Start scanning */
    start,
    /** Stop scanning */
    stop,
  };
}
