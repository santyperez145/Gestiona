/**
 * Lista de deseos del comprador.
 *
 * Vive en su propio contexto y no dentro de `storeContext` porque depende de la
 * sesión: se carga cuando hay cuenta y se vacía cuando se cierra sesión. Si
 * viviera con el catálogo habría que recargar la tienda entera al entrar.
 *
 * El alternado es optimista: el corazón se pinta al instante y se revierte si
 * el servidor rechaza. Esperar 300ms por un corazón se siente roto.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStoreAuth } from "./storeAuth";

interface Ctx {
  /** Ids de producto en la lista. */
  ids: Set<string>;
  count: number;
  has: (productId: string) => boolean;
  /** Devuelve el estado final, o null si hace falta iniciar sesión. */
  toggle: (productId: string) => Promise<boolean | null>;
}

const WishlistContext = createContext<Ctx | null>(null);

export function WishlistProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const { customer } = useStoreAuth();
  const [ids, setIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!customer) { setIds(new Set()); return; }
    let cancelled = false;
    supabase.rpc("get_my_wishlist", { p_slug: slug }).then(({ data }) => {
      if (cancelled) return;
      setIds(new Set(((data ?? []) as { product_id: string }[]).map(r => r.product_id)));
    }, () => {});
    return () => { cancelled = true; };
  }, [customer, slug]);

  const toggle = useCallback(async (productId: string) => {
    if (!customer) return null;
    const estaba = ids.has(productId);
    const optimista = new Set(ids);
    if (estaba) optimista.delete(productId); else optimista.add(productId);
    setIds(optimista);

    const { data, error } = await supabase.rpc("toggle_wishlist", {
      p_slug: slug, p_product_id: productId,
    });
    if (error) { setIds(new Set(ids)); return estaba; }

    // La verdad la tiene el servidor: si por lo que sea difiere, gana él.
    const final = !!(data as unknown as { in_wishlist?: boolean })?.in_wishlist;
    setIds(prev => {
      const next = new Set(prev);
      if (final) next.add(productId); else next.delete(productId);
      return next;
    });
    return final;
  }, [customer, ids, slug]);

  const value = useMemo<Ctx>(() => ({
    ids,
    count: ids.size,
    has: (id: string) => ids.has(id),
    toggle,
  }), [ids, toggle]);

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

export function useWishlist(): Ctx {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error("useWishlist debe usarse dentro de WishlistProvider");
  return ctx;
}
