/**
 * Ajustes de precio con historial y deshacer (2026-10-30, migración
 * 20261030000500). Los tres ajustes masivos pasan por
 * `aplicar_ajuste_de_precios`, que guarda antes y después de cada producto.
 * Sin la migración aplicada se usa la función de siempre: el ajuste funciona
 * igual, sólo que no se puede deshacer.
 */
import { supabase } from "@/integrations/supabase/client";
import { isMissingFunction } from "@/lib/publicDataSource";

export type OrigenAjuste = "porcentaje" | "cotizacion" | "costo_usd";

type Respuesta = { data: unknown; error: { code?: string; message: string } | null };

export async function aplicarAjusteRegistrado(
  org: string,
  origen: OrigenAjuste,
  parametros: Record<string, unknown>,
  deSiempre: () => PromiseLike<Respuesta>,
): Promise<Respuesta & { registrado: boolean }> {
  const { data, error } = await supabase.rpc("aplicar_ajuste_de_precios" as never, {
    p_org: org, p_origen: origen, p_parametros: parametros,
  } as never) as unknown as Respuesta;
  if (error && isMissingFunction(error)) {
    const r = await deSiempre();
    return { ...r, registrado: false };
  }
  return { data, error, registrado: !error };
}

export interface AjusteDePrecio {
  id: string; origen: OrigenAjuste; parametros: Record<string, unknown>; productos: number;
  created_at: string; deshecho_at: string | null;
}

/** Cómo se lee un ajuste en la lista: lo que se pidió, no el detalle técnico. */
export function describirAjuste(a: Pick<AjusteDePrecio, "origen" | "parametros">): string {
  const p = a.parametros ?? {};
  const cat = typeof p.categoria === "string" && p.categoria ? ` · ${p.categoria}` : "";
  if (a.origen === "porcentaje") {
    const pct = Number(p.porcentaje);
    const que = p.que === "costo" ? "costo" : p.que === "costo_y_precio" ? "costo y precio" : "precio";
    return `${pct > 0 ? "+" : ""}${pct}% al ${que}${cat}`;
  }
  if (a.origen === "cotizacion") {
    return `Cotización ${p.rate_before} → ${p.rate_after}${typeof p.nombre === "string" && p.nombre ? ` (${p.nombre})` : ""}${cat}`;
  }
  return `Desde costo U$S a $${p.tipo_cambio} con ${p.markup_pct}% de markup${cat}`;
}

export function textoDeshacerAjuste(r: { restaurados: number; con_cambios_posteriores: number }): string {
  const vuelta = r.restaurados === 1 ? "1 producto volvió a su precio anterior" : `${r.restaurados} productos volvieron a su precio anterior`;
  if (r.con_cambios_posteriores === 0) return `Ajuste deshecho: ${vuelta}.`;
  const resp = r.con_cambios_posteriores === 1
    ? "1 se había vuelto a editar y quedó como está"
    : `${r.con_cambios_posteriores} se habían vuelto a editar y quedaron como están`;
  return `Ajuste deshecho: ${vuelta}; ${resp}.`;
}
