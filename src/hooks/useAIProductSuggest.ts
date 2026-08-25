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
import { useCallback, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrgCategories } from "@/components/products/CategorySelect";
import { slugDeNombre } from "@/lib/storeCategories";

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

/**
 * La categoría que propuso la IA, resuelta contra las de la organización.
 *
 * Hasta 2026-08-25 acá había un `CATEGORY_MAP` escrito a mano que traducía
 * "perfume" a `perfume_diseñador` y "perfume árabe" a `perfume_arabe`, y el
 * prompt le fijaba a la IA una lista de doce categorías del negocio original.
 * Una tienda de ropa recibía sugerencias de perfumería, y peor: `mapCategory`
 * devolvía el texto crudo cuando no encontraba nada, así que la sugerencia
 * podía ser una categoría que el comercio no tiene.
 *
 * Ahora sólo se devuelve algo si coincide con una categoría real de la
 * organización. Un slug que no está en su lista no se puede elegir en el
 * formulario: sugerirlo dejaría el selector en blanco.
 */
function resolverCategoria(raw: string | undefined, slugs: string[]): string | undefined {
  if (!raw) return undefined;
  const exacto = slugs.find(s => s === raw.trim());
  if (exacto) return exacto;
  // Por slug, que tolera acentos, mayúsculas y guión bajo contra guión medio.
  const propuesto = slugDeNombre(raw);
  return propuesto ? slugs.find(s => slugDeNombre(s) === propuesto) : undefined;
}

export function useAIProductSuggest(orgId: string | undefined) {
  const { opciones } = useOrgCategories(orgId);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ProductSuggestion | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const slugs = useMemo(() => opciones.map(o => o.slug), [opciones]);

  const suggest = useCallback((name: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = name.trim();
    if (!trimmed || trimmed.length < 3) { setResult(null); return; }

    // La caché es de módulo y sobrevive al cambio de organización, así que la
    // clave lleva el `orgId`: la categoría sugerida sale de las categorías de
    // un comercio y no vale para otro.
    const cacheKey = `${orgId ?? "sin-org"}|${trimmed.toLowerCase()}`;
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
- category: ${slugs.length > 0
  ? `elegí exactamente uno de estos códigos del comercio y devolvelo tal cual: ${slugs.join(", ")}`
  : `devolvé "" — este comercio todavía no tiene categorías cargadas y no hay que inventarle una`}
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
            category: resolverCategoria(parsed.category, slugs),
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
  }, [orgId, slugs]);

  const clear = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setResult(null);
    setLoading(false);
  }, []);

  return { suggest, loading, result, clear };
}
