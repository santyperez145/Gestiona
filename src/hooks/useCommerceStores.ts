import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { orgViewKey, usePersistedState } from "@/hooks/usePersistedState";

export type CommerceStore = Tables<"ecommerce_stores">;

export function chooseCommerceStoreId(
  stores: CommerceStore[],
  requestedId: string | null,
  persistedId: string | null,
): string | null {
  if (requestedId && stores.some(store => store.id === requestedId)) return requestedId;
  if (persistedId && stores.some(store => store.id === persistedId)) return persistedId;
  return stores.find(store => store.is_primary)?.id ?? stores[0]?.id ?? null;
}

/** Una sola selección compartida por Configuración, Pedidos y Recuperación. */
export function useCommerceStores(orgId: string | null, requestedId: string | null = null) {
  const [stores, setStores] = useState<CommerceStore[]>([]);
  const [loading, setLoading] = useState(Boolean(orgId));
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);
  const [persistedId, setPersistedId] = usePersistedState<string | null>(
    orgViewKey("commerce.store", orgId),
    null,
  );
  const persistedIdRef = useRef(persistedId);
  useEffect(() => {
    persistedIdRef.current = persistedId;
  }, [persistedId]);

  useEffect(() => {
    requestRef.current += 1;
    setStores([]);
    setError(null);
    setLoading(Boolean(orgId));
  }, [orgId]);

  const selectedStoreId = useMemo(
    () => chooseCommerceStoreId(stores, requestedId, persistedId),
    [persistedId, requestedId, stores],
  );
  const selectedStore = useMemo(
    () => stores.find(store => store.id === selectedStoreId) ?? null,
    [selectedStoreId, stores],
  );

  const reload = useCallback(async (preferredId?: string | null) => {
    const requestId = ++requestRef.current;
    if (!orgId) {
      setStores([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: queryError } = await supabase
      .from("ecommerce_stores")
      .select("*")
      .eq("org_id", orgId)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true });
    if (requestId !== requestRef.current) return;
    setLoading(false);
    if (queryError) {
      console.error("No se pudieron leer las tiendas de la organización", queryError);
      setError("No pudimos abrir las tiendas. Reintentá.");
      return;
    }
    const next = (data ?? []) as CommerceStore[];
    setStores(next);
    const nextId = chooseCommerceStoreId(next, preferredId ?? null, persistedIdRef.current);
    if (nextId !== persistedIdRef.current) setPersistedId(nextId);
  }, [orgId, setPersistedId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (selectedStoreId !== persistedId) setPersistedId(selectedStoreId);
  }, [persistedId, selectedStoreId, setPersistedId]);

  return {
    stores,
    selectedStore,
    selectedStoreId,
    selectStore: setPersistedId,
    loading,
    error,
    reload,
  };
}
