import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useOrgCategories } from "@/components/products/CategorySelect";
import { slugDeNombre } from "@/lib/storeCategories";

export interface ProductSuggestion {
  category?: string;
  categoryLabel?: string;
  description?: string;
  tags?: string[];
  unit?: string;
  brand?: string;
}

function resolverCategoria(raw: unknown, slugs: string[]): string | undefined {
  if (typeof raw !== "string") return undefined;
  return slugs.find(slug => slug === raw.trim())
    ?? slugs.find(slug => slugDeNombre(slug) === slugDeNombre(raw));
}

function safeText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text && text.length <= max && !/[<>]/.test(text)
    && !Array.from(text).some(character => character.charCodeAt(0) <= 8) ? text : undefined;
}

export function useAIProductSuggest(orgId: string | undefined) {
  const { user } = useAuth();
  const { opciones, cargando: categoriesLoading, error: categoriesError } = useOrgCategories(orgId);
  const slugs = useMemo(() => opciones.map(o => o.slug), [opciones]);
  const scope = JSON.stringify({ orgId: orgId ?? "sin-org", userId: user?.id, login: user?.last_sign_in_at,
    categories: opciones, categoriesLoading, categoriesError });
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [snapshot, setSnapshot] = useState<{ scope: string; name: string; data: ProductSuggestion } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null);
  const cache = useRef(new Map<string, { data: ProductSuggestion; expires: number }>());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const cancel = useCallback(() => {
    generation.current += 1;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
  }, []);
  const clear = useCallback(() => {
    cancel();
    setSnapshot(null);
    setBusy(null);
    setFailure(null);
  }, [cancel]);

  useEffect(() => {
    clear();
    cache.current.clear();
    return cancel;
  }, [scope, clear, cancel]);

  const suggest = useCallback((name: string) => {
    clear();
    const trimmed = name.trim();
    if (!orgId || !user?.id || trimmed.length < 3 || trimmed.length > 200) return;
    if (categoriesLoading) return;
    if (categoriesError) {
      setFailure({ scope, message: "No pudimos verificar las categorías. Completá los datos manualmente o reintentá su carga." });
      return;
    }
    const cacheKey = JSON.stringify([scope, trimmed]);
    const cached = cache.current.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      setSnapshot({ scope, name: trimmed, data: cached.data });
      return;
    }
    const requestGeneration = generation.current;
    const current = () => scopeRef.current === scope && generation.current === requestGeneration;
    debounceRef.current = setTimeout(async () => {
      if (!current()) return;
      const controller = new AbortController();
      abortRef.current = controller;
      const timeout = setTimeout(() => controller.abort(), 20_000);
      setBusy(scope);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!current()) return;
        if (!session || session.user.id !== user.id) throw new Error("Session unavailable");
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
          body: JSON.stringify({ purpose: 'catalog-suggestion', productName: trimmed, orgId }),
        });
        if (!res.ok || !res.body) throw new Error("Suggestion unavailable");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";
        let buffer = "";
        let bytes = 0;
        const readLine = (line: string) => {
          if (!line.trim().startsWith("data:")) return;
          const value = line.trim().slice(5).trim();
          if (value === "[DONE]") return;
          const event = JSON.parse(value);
          if (event?.error) throw new Error('Suggestion stream failed');
          const delta = event?.delta ?? event?.choices?.[0]?.delta?.content ?? event?.content;
          if (typeof delta === "string") accumulated += delta;
        };
        try {
          while (current()) {
            const { done, value } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > 65_536) throw new Error("Suggestion too large");
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            lines.forEach(readLine);
          }
          buffer += decoder.decode();
          if (buffer.trim()) readLine(buffer);
        } finally {
          await reader.cancel();
        }
        if (!current()) return;
        const parsed = JSON.parse(accumulated.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, ""));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid suggestion");
        const category = resolverCategoria(parsed.category, slugs);
        const suggestion: ProductSuggestion = {
          category,
          categoryLabel: opciones.find(option => option.slug === category)?.label,
          description: safeText(parsed.description, 200),
          tags: Array.isArray(parsed.tags) ? [...new Set(parsed.tags.map((tag: unknown) => safeText(tag, 40)).filter(Boolean))].slice(0, 4) as string[] : undefined,
          unit: safeText(parsed.unit, 30),
          brand: safeText(parsed.brand, 80),
        };
        if (!Object.values(suggestion).some(value => typeof value === "string" && value)) throw new Error("Empty suggestion");
        // No hay precios en el contrato. La IA no es autoridad comercial.
        if (cache.current.size >= 20) cache.current.delete(cache.current.keys().next().value);
        cache.current.set(cacheKey, { data: suggestion, expires: Date.now() + 300_000 });
        setSnapshot({ scope, name: trimmed, data: suggestion });
      } catch {
        if (current()) {
          console.error('[CatalogSuggestion] request unavailable', { orgId });
          setFailure({ scope, message: "No pudimos preparar sugerencias. Reintentá o completá los datos manualmente." });
        }
      } finally {
        clearTimeout(timeout);
        if (current()) setBusy(null);
      }
    }, 800);
  }, [orgId, user?.id, scope, slugs, opciones, categoriesLoading, categoriesError, clear]);

  return {
    suggest,
    clear,
    result: snapshot?.scope === scope ? snapshot.data : null,
    query: snapshot?.scope === scope ? snapshot.name : "",
    loading: busy === scope,
    error: failure?.scope === scope ? failure.message : null,
  };
}
