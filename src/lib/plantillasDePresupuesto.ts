import { supabase } from "@/integrations/supabase/client";
import type { ItemGuardado } from "@/lib/presupuestos";

/**
 * Plantillas de presupuesto en la base (2026-10-14). Antes vivían en el
 * localStorage de cada navegador: no se veían desde otro equipo ni las
 * compartía el negocio. Las que hubiera en el navegador se suben una vez y
 * después se borran de ahí (sólo si se subieron).
 */
export type Plantilla = { name: string; items: Array<Partial<ItemGuardado>>; notes?: string };

const CLAVE_VIEJA = (orgId: string) => `gestiona_quote_templates_${orgId}`;

/** Las plantillas del navegador que todavía no están en la base (por nombre). */
export function plantillasParaSubir(locales: unknown, enLaBase: Plantilla[]): Plantilla[] {
  if (!Array.isArray(locales)) return [];
  const nombres = new Set(enLaBase.map(p => p.name.trim().toLowerCase()));
  return locales
    .filter((p): p is Plantilla => !!p && typeof p === "object" && typeof (p as Plantilla).name === "string" && Array.isArray((p as Plantilla).items))
    .map(p => ({ name: p.name.trim().slice(0, 80), items: p.items.slice(0, 200), notes: typeof p.notes === "string" ? p.notes.slice(0, 2000) : undefined }))
    .filter(p => p.name && !nombres.has(p.name.toLowerCase()));
}

async function leer(orgId: string): Promise<Plantilla[]> {
  const { data, error } = await supabase.from("plantillas_de_presupuesto" as never)
    .select("nombre, items, notas").eq("org_id", orgId).order("nombre");
  if (error) throw error;
  return ((data ?? []) as Array<{ nombre: string; items: Array<Partial<ItemGuardado>>; notas: string | null }>)
    .map(p => ({ name: p.nombre, items: p.items ?? [], notes: p.notas ?? undefined }));
}

export async function cargarPlantillasDB(orgId: string): Promise<Plantilla[]> {
  const enLaBase = await leer(orgId);
  let locales: unknown = null;
  try { locales = JSON.parse(localStorage.getItem(CLAVE_VIEJA(orgId)) || "null"); } catch { locales = null; }
  const subir = plantillasParaSubir(locales, enLaBase);
  if (subir.length > 0) {
    const { error } = await supabase.from("plantillas_de_presupuesto" as never)
      .upsert(subir.map(p => ({ org_id: orgId, nombre: p.name, items: p.items, notas: p.notes ?? null })) as never, { onConflict: "org_id,nombre", ignoreDuplicates: true });
    if (error) { console.warn("[plantillas] no se pudieron subir las del navegador", error); return enLaBase; }
    try { localStorage.removeItem(CLAVE_VIEJA(orgId)); } catch { /* el navegador no deja: se reintenta la próxima vez sin duplicar */ }
    return leer(orgId);
  }
  if (locales !== null) { try { localStorage.removeItem(CLAVE_VIEJA(orgId)); } catch { /* idem */ } }
  return enLaBase;
}

export async function guardarPlantillaDB(orgId: string, p: Plantilla): Promise<void> {
  const { error } = await supabase.from("plantillas_de_presupuesto" as never)
    .upsert({ org_id: orgId, nombre: p.name.trim(), items: p.items, notas: p.notes?.trim() || null, updated_at: new Date().toISOString() } as never, { onConflict: "org_id,nombre" });
  if (error) throw error;
}
