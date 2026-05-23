/**
 * useWebShare — Native Web Share API wrapper.
 *
 * Uses the browser's native share sheet on mobile/desktop when supported.
 * Falls back to clipboard copy when unavailable.
 *
 * Usage:
 *   const { share, canShare } = useWebShare();
 *   share({ title: "Precio KHAMRAH", text: "$25.000", url: "https://..." });
 */
import { useCallback } from "react";
import { toast } from "sonner";

interface ShareData {
  title?: string;
  text?: string;
  url?: string;
}

export function useWebShare() {
  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  const share = useCallback(async (data: ShareData) => {
    if (canShare) {
      try {
        await navigator.share(data);
        return true;
      } catch (err: any) {
        // AbortError means user dismissed — not an error
        if (err?.name !== "AbortError") {
          toast.error("No se pudo compartir");
        }
        return false;
      }
    } else {
      // Fallback: copy to clipboard
      const text = [data.title, data.text, data.url].filter(Boolean).join("\n");
      try {
        await navigator.clipboard.writeText(text);
        toast.success("Copiado al portapapeles (compartir no soportado)", { duration: 3000 });
      } catch {
        toast.error("No se pudo copiar");
      }
      return false;
    }
  }, [canShare]);

  /** Share a product price list */
  const shareProduct = useCallback((product: {
    name: string;
    sale_price_ars?: number;
    stock?: number;
  }) => {
    const price = product.sale_price_ars
      ? new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(Number(product.sale_price_ars))
      : "";
    return share({
      title: product.name,
      text: `${product.name}${price ? ` — ${price}` : ""}${product.stock ? ` | Stock: ${product.stock} uds` : ""}`,
    });
  }, [share]);

  return { share, shareProduct, canShare };
}
