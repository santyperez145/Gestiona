/**
 * useBarcode — Generate SVG/canvas barcodes using JsBarcode.
 *
 * Supported formats: CODE128, EAN13, EAN8, UPC, CODE39, ITF14
 *
 * Usage:
 *   const { svgRef, dataUrl, generate } = useBarcode();
 *
 *   // Mount an SVG element and auto-generate:
 *   <svg ref={svgRef} />
 *
 *   // Or get a data URL for download/print:
 *   const url = await generate("7791234567890", { format: "EAN13" });
 */
import { useRef, useCallback, useState } from "react";
import JsBarcode from "jsbarcode";

export interface BarcodeOptions {
  /** JsBarcode format string. Default: "CODE128" */
  format?: string;
  /** Bar width (px). Default: 2 */
  width?: number;
  /** Bar height (px). Default: 80 */
  height?: number;
  /** Show human-readable text below bars. Default: true */
  displayValue?: boolean;
  /** Font size for text. Default: 14 */
  fontSize?: number;
  /** Margin around barcode (px). Default: 10 */
  margin?: number;
  /** Background color. Default: "#ffffff" */
  background?: string;
  /** Bar color. Default: "#000000" */
  lineColor?: string;
}

interface UseBarcodeReturn {
  /** Attach to an <svg> element to auto-render barcode */
  svgRef: React.RefObject<SVGSVGElement>;
  /** Render the barcode and return an SVG data URL for download/print */
  generate: (value: string, opts?: BarcodeOptions) => string | null;
  /** Last error message (e.g. invalid value for chosen format) */
  error: string | null;
}

const DEFAULT_OPTS: BarcodeOptions = {
  format: "CODE128",
  width: 2,
  height: 80,
  displayValue: true,
  fontSize: 14,
  margin: 10,
  background: "#ffffff",
  lineColor: "#000000",
};

export function useBarcode(): UseBarcodeReturn {
  const svgRef = useRef<SVGSVGElement>(null!);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback((value: string, opts: BarcodeOptions = {}): string | null => {
    if (!value.trim()) {
      setError("Valor vacío");
      return null;
    }
    const merged = { ...DEFAULT_OPTS, ...opts };
    try {
      // Render to in-memory SVG
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      JsBarcode(svg, value, merged);

      // Also render to svgRef if mounted
      if (svgRef.current) {
        JsBarcode(svgRef.current, value, merged);
      }

      const serializer = new XMLSerializer();
      const svgStr = serializer.serializeToString(svg);
      setError(null);
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgStr)}`;
    } catch (e: any) {
      const msg = e?.message ?? "Error generando código de barras";
      setError(msg);
      return null;
    }
  }, []);

  return { svgRef, generate, error };
}
