/**
 * useClipboard — Clipboard write with async Clipboard API.
 *
 * Falls back to `document.execCommand("copy")` when the API is unavailable.
 * Fires a toast on success/failure.
 *
 * Usage:
 *   const { copy, copied } = useClipboard();
 *   <button onClick={() => copy("some text")}>Copiar</button>
 */
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

export function useClipboard(resetMs = 2000) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(async (text: string, label?: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for older browsers / HTTP
        const el = document.createElement("textarea");
        el.value = text;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setCopied(true);
      toast.success(label ? `"${label}" copiado` : "Copiado al portapapeles", { duration: 2000 });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), resetMs);
    } catch {
      toast.error("No se pudo copiar");
    }
  }, [resetMs]);

  return { copy, copied };
}
