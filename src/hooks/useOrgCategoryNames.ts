/**
 * Los nombres de las categorías de una organización.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * Porque el nombre legible de un slug hacía falta en pantallas que no eligen
 * ninguna categoría —la Toma Física lista y filtra, no asigna— y el único
 * lugar que sabía traducirlo era `useOrgCategories`, que además consulta
 * `products` para armar el desplegable. Pedir esa consulta de más en una
 * pantalla que ya trae los productos es duplicar una lectura por un rótulo.
 *
 * Lo que había en su lugar era un `Record` escrito a mano con cuatro entradas
 * de perfumería. Un comercio de otro rubro veía el slug crudo, o peor: el
 * rótulo de un rubro que no es el suyo.
 *
 * `useOrgCategories` se apoya en este hook y le suma los slugs en uso.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { nombreDeCategoria, type CategoriaTienda } from "@/lib/storeCategories";

/** Códigos que significan "la relación todavía no existe", único caso en que
 *  seguir sin categorías es correcto. Cualquier otro error se reporta: un
 *  "no tenés permiso" y un "no hay nada" son problemas opuestos. */
const RELACION_INEXISTENTE = new Set(["42P01", "42883", "PGRST205", "PGRST202"]);

export function useOrgCategoryNames(orgId: string | null | undefined) {
  const scope = orgId ?? null;
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const generation = useRef(0);
  const [snapshot, setSnapshot] = useState<{
    scope: string; categorias: CategoriaTienda[]; error: string | null;
  } | null>(null);

  const cargar = useCallback(async () => {
    const request = ++generation.current;
    setSnapshot(null);
    if (!orgId) return;
    try {
      const { data, error: err } = await supabase
        .from("ecommerce_categories")
        .select("id, name, slug, parent_id, sort_order, is_active")
        .eq("org_id", orgId).eq("is_active", true).order("sort_order");
      if (activeScope.current !== orgId || generation.current !== request) return;
      const failed = err && !RELACION_INEXISTENTE.has(err.code);
      if (failed) console.error('[OrgCategoryNames] lookup failed', { orgId, code: err.code });
      setSnapshot({ scope: orgId, categorias: failed ? [] : (data ?? []) as unknown as CategoriaTienda[],
        error: failed ? "No pudimos cargar las categorías. Reintentá para continuar." : null });
    } catch {
      if (activeScope.current === orgId && generation.current === request) {
        console.error('[OrgCategoryNames] lookup unavailable', { orgId });
        setSnapshot({ scope: orgId, categorias: [], error: "No pudimos cargar las categorías. Reintentá para continuar." });
      }
    }
  }, [orgId]);

  useEffect(() => { cargar(); return () => { generation.current += 1; }; }, [cargar]);
  const current = scope && snapshot?.scope === scope ? snapshot : null;
  const categorias = useMemo(() => current?.categorias ?? [], [current]);
  const cargando = Boolean(scope && !current);
  const error = current?.error ?? null;

  /**
   * Slug → nombre legible. Nunca devuelve vacío para un slug con contenido:
   * cae al nombre heredado y, si tampoco, al slug hecho legible. Un slug
   * ausente se rotula "Sin categoría", que desde 2026-08-25 es un estado real
   * —`products.category` dejó de tener default— y no un dato faltante.
   */
  const nombre = useCallback(
    (slug: string | null | undefined): string =>
      slug ? nombreDeCategoria(slug, categorias) : "Sin categoría",
    [categorias],
  );

  return useMemo(
    () => ({ categorias, nombre, cargando, error, recargar: cargar }),
    [categorias, nombre, cargando, error, cargar],
  );
}
