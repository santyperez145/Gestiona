/**
 * useAIProductSuggest — AI-powered product data auto-fill.
 *
 * Given a product name, calls the ai-chat edge function to suggest:
 *   - category (maps to app categories)
 *   - price range (min/max in ARS)
 *   - description (short marketing text)
 *   - tags (array of keywords)
 *   - unit (unidad, ml, g, etc.)
 *
 * Debounced 800ms so it doesn't fire on every keystroke.
 * Results are cached in-memory by product name (case-insensitive).
 *
 * Usage:
 *   const { suggest, loading, result, clear } = useAIProductSuggest(orgId);
 *   // call suggest(name) when the input changes
 *   // result contains the parsed suggestions
 */
import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ProductSuggestion {
  category?: string;
  priceMin?: number;
  priceMax?: number;
  description?: string;
  tags?: string[];
  unit?: string;
  brand?: string;
}

const cache = new Map<string, ProductSuggestion>();

const CATEGORY_MAP: Record<string, string> = {
  perfume: "perfume_diseñador",
  "perfume árabe": "perfume_arabe",
  vaper: "vaper",
  electrónico: "electronico",
  electronic: "electronico",
  ropa: "ropa",
  accesorio: "accesorios",
  calzado: "calzado",
  cosmético: "cosmeticos",
  cosmetic: "cosmeticos",
  alimento: "alimentos",
  food: "alimentos",
  bebida: "bebidas",
  tecnología: "tecnologia",
  technology: "tecnologia",
};

function mapCategory(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  for (const [key, val] of Object.entries(CATEGORY_MAP)) {
    if (lower.includes(key)) return val;
  }
  return raw;
}

export function useAIProductSuggest(orgId: string | undefined) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProductSuggestion | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const suggest = useCallback((name: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = name.trim();
    if (!trimmed || trimmed.length < 3) { setResult(null); return; }

    // Cache hit
    const cacheKey = trimmed.toLowerCase();
    if (cache.has(cacheKey)) {
      setResult(cache.get(cacheKey)!);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      if (!orgId) return;
      setLoading(true);
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
        const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
        const { data: { session } } = await supabase.auth.getSession();

        const prompt = `Sos un asistente de un ERP/POS para negocios en Argentina. El usuario está cargando un producto llamado: "${trimmed}". Respondé SOLO con un JSON válido (sin markdown, sin texto extra) con este esquema exacto:
{"category":"string","priceMin":number,"priceMax":number,"description":"string","tags":["string"],"unit":"string","brand":"string"}
- category: una de estas: perfume_diseñador, perfume_arabe, vaper, electronico, ropa, accesorios, calzado, cosmeticos, alimentos, bebidas, tecnologia, otros
- priceMin/priceMax: precio estimado en pesos argentinos (ARS) para un negocio minorista. Usá valores realistas para Argentina 2024-2025.
- description: descripción breve de marketing en español (máx 100 caracteres)
- tags: array de 2-4 keywords útiles
- unit: "unidad", "ml", "g", "kg", "litro", etc.
- brand: marca conocida si aplica, o "" si no
Solo JSON, sin texto adicional.`;

        const res = await fetch(`${supabaseUrl}/functions/v1/ai-chat`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${session?.access_token || anonKey}`,
            "apikey": anonKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: prompt,
            history: [],
            orgId,
          }),
        });

        if (!res.ok || !res.body) return;

        // Read SSE stream and collect all text
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split("\n");
          buf = parts.pop() ?? "";
          for (const line of parts) {
            const trimLine = line.trim();
            if (trimLine.startsWith("data:")) {
              const json = trimLine.slice(5).trim();
              if (json === "[DONE]") continue;
              try {
                const parsed = JSON.parse(json);
                const delta = parsed?.choices?.[0]?.delta?.content ?? parsed?.content ?? "";
                if (delta) accumulated += delta;
              } catch { /* partial chunk */ }
            }
          }
        }

        // Try to parse JSON from accumulated text
        const jsonMatch = accumulated.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const suggestion: ProductSuggestion = {
            category: mapCategory(parsed.category),
            priceMin: typeof parsed.priceMin === "number" ? parsed.priceMin : undefined,
            priceMax: typeof parsed.priceMax === "number" ? parsed.priceMax : undefined,
            description: typeof parsed.description === "string" ? parsed.description : undefined,
            tags: Array.isArray(parsed.tags) ? parsed.tags : undefined,
            unit: typeof parsed.unit === "string" ? parsed.unit : undefined,
            brand: typeof parsed.brand === "string" && parsed.brand ? parsed.brand : undefined,
          };
          cache.set(cacheKey, suggestion);
          setResult(suggestion);
        }
      } catch { /* non-critical */ } finally {
        setLoading(false);
      }
    }, 800);
  }, [orgId]);

  const clear = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setResult(null);
    setLoading(false);
  }, []);

  return { suggest, loading, result, clear };
}
