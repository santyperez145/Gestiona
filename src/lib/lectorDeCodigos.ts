/**
 * Lector de códigos de barras para la cámara (2026-11-06).
 *
 * Una sola API (la Barcode Detection API del navegador) en todos lados:
 *  - Chrome en Android y macOS la traen nativa.
 *  - Safari (iPhone), Firefox y Chrome en Windows no: ahí se usa
 *    `barcode-detector`, que la implementa con ZXing-C++ compilado a
 *    WebAssembly. Lee varios códigos por imagen, con su recuadro, más rápido y
 *    con más formatos que ZXing en JavaScript.
 *
 * El `.wasm` se sirve desde nuestro dominio (no desde el CDN que la librería
 * usa por defecto): la CSP del sitio no deja cargar código de terceros y así
 * la cámara anda igual sin depender de otro servicio. Se carga sólo al abrir
 * la cámara.
 */
import lectorWasm from "zxing-wasm/reader/zxing_reader.wasm?url";

export type CodigoLeido = { rawValue: string; boundingBox: DOMRectReadOnly };
export type Lector = { detect: (fuente: ImageBitmapSource) => Promise<CodigoLeido[]> };

/** Los formatos de un comercio: productos (EAN/UPC), etiquetas propias (Code 128/39, ITF) y QR. */
export const FORMATOS = [
  "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "itf", "codabar", "qr_code", "data_matrix",
] as const;

type ConstructorDeLector = {
  new (opciones?: { formats?: string[] }): Lector;
  getSupportedFormats?: () => Promise<string[]>;
};

let lector: Promise<Lector> | null = null;

/** El lector, creado una sola vez por sesión. */
export function lectorDeCodigos(): Promise<Lector> {
  lector ??= crearLector().catch(error => { lector = null; throw error; });
  return lector;
}

async function crearLector(): Promise<Lector> {
  const Nativo = (globalThis as unknown as { BarcodeDetector?: ConstructorDeLector }).BarcodeDetector;
  if (Nativo?.getSupportedFormats) {
    try {
      const soportados = await Nativo.getSupportedFormats();
      const formatos = FORMATOS.filter(f => soportados.includes(f));
      if (formatos.includes("ean_13")) return new Nativo({ formats: formatos });
    } catch {
      // Un nativo roto no deja sin cámara: se usa el de WebAssembly.
    }
  }
  const { BarcodeDetector, prepareZXingModule } = await import("barcode-detector/ponyfill");
  prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? lectorWasm : prefix + path),
    },
  });
  return new BarcodeDetector({ formats: [...FORMATOS] }) as unknown as Lector;
}
