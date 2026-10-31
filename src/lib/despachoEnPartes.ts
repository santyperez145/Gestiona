import { supabase } from "@/integrations/supabase/client";
import { isMissingFunction } from "@/lib/publicDataSource";

/**
 * Despacho en partes de un pedido online (2026-10-31, migración
 * 20261031000200). Cada parte es una entrega con sus productos y su
 * seguimiento; la base valida que no salga más de lo que falta y deja el
 * pedido «en camino» con la última. Acá se sugiere qué mandar y se arma el
 * pedido a la base.
 */

export interface PendienteDeDespacho {
  linea: number;
  product_id: string | null;
  variant_id: string | null;
  nombre: string;
  pedida: number;
  despachada: number;
  falta: number;
}

export interface ParteDelPedido {
  id: string;
  parte: number;
  carrier: string | null;
  external_tracking: string | null;
  status: string;
  tracking_code: string | null;
  items: Array<{ linea: number; nombre: string; cantidad: number }>;
}

interface RenglonDelPedido {
  preventa?: { cantidad?: number | string | null; llega?: string | null } | null;
}

/**
 * Lo que se sugiere mandar ya: todo lo que falta, menos las unidades en
 * preventa cuya mercadería todavía no llegó (la fecha de llegada es posterior
 * a hoy). El comercio puede cambiar cualquier cantidad.
 */
export function cantidadesSugeridas(pendientes: PendienteDeDespacho[], renglones: unknown[] | null | undefined, hoy: string): Record<number, number> {
  const sugeridas: Record<number, number> = {};
  for (const p of pendientes) {
    const renglon = (Array.isArray(renglones) ? renglones[p.linea] : null) as RenglonDelPedido | null;
    const preventa = renglon?.preventa;
    const enCamino = preventa && (!preventa.llega || String(preventa.llega).slice(0, 10) > hoy) ? Number(preventa.cantidad) || 0 : 0;
    // Lo que ya salió se descuenta primero de lo que había en stock.
    const enStockSinMandar = Math.max(p.pedida - enCamino - p.despachada, 0);
    sugeridas[p.linea] = Math.min(p.falta, enStockSinMandar);
  }
  return sugeridas;
}

/** «2», «1,5» o «» → número; vacío o inválido → 0. */
function cantidad(texto: string | number): number {
  const n = Number(String(texto).trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function itemsDeLaParte(cantidades: Record<number, string | number>): Array<{ linea: number; cantidad: number }> {
  return Object.entries(cantidades)
    .map(([linea, valor]) => ({ linea: Number(linea), cantidad: cantidad(valor) }))
    .filter(i => i.cantidad > 0)
    .sort((a, b) => a.linea - b.linea);
}

/** Lo mismo que rechazaría la base, dicho antes de mandarlo. */
export function problemasDeLaParte(pendientes: PendienteDeDespacho[], cantidades: Record<number, string | number>): string[] {
  const problemas: string[] = [];
  for (const p of pendientes) {
    const texto = String(cantidades[p.linea] ?? "").trim();
    if (!texto) continue;
    const n = Number(texto.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) problemas.push(`La cantidad de «${p.nombre}» no es un número.`);
    else if (n > p.falta) problemas.push(`De «${p.nombre}» quedan ${p.falta} por despachar.`);
  }
  if (problemas.length === 0 && itemsDeLaParte(cantidades).length === 0) problemas.push("Elegí qué productos salen en esta parte.");
  return problemas;
}

/** El aviso al comprador: la última parte es «en camino»; las otras, «parte_N». */
export function eventoDelAviso(r: { completo?: boolean; parte?: number }): "shipped" | `parte_${number}` {
  return r.completo ? "shipped" : `parte_${Number(r.parte) || 1}`;
}

export function textoDeLaParte(r: { completo?: boolean; parte?: number; quedan?: number }): string {
  if (r.completo) return `Salió la parte ${r.parte}: con eso el pedido sale completo y queda en camino.`;
  const quedan = Number(r.quedan) || 0;
  return `Salió la parte ${r.parte}. ${quedan === 1 ? "Queda 1 unidad" : `Quedan ${quedan} unidades`} por despachar.`;
}

// ───────────────────────── base ─────────────────────────

/** `disponible: false` mientras la migración no esté aplicada: no se ofrece despachar en partes. */
export async function leerPendienteDB(orderId: string): Promise<{ disponible: boolean; pendientes: PendienteDeDespacho[] }> {
  const { data, error } = await supabase.rpc("pendiente_de_despacho" as never, { p_order_id: orderId } as never);
  if (error) {
    if (isMissingFunction(error)) return { disponible: false, pendientes: [] };
    throw error;
  }
  const filas = (data ?? []) as Array<Record<string, unknown>>;
  return {
    disponible: true,
    pendientes: filas.map(f => ({
      linea: Number(f.linea),
      product_id: (f.product_id as string | null) ?? null,
      variant_id: (f.variant_id as string | null) ?? null,
      nombre: String(f.nombre ?? "Producto"),
      pedida: Number(f.pedida) || 0,
      despachada: Number(f.despachada) || 0,
      falta: Number(f.falta) || 0,
    })),
  };
}

export async function despacharParteDB(orderId: string, items: Array<{ linea: number; cantidad: number }>, carrier: string, tracking: string):
  Promise<{ parte: number; completo: boolean; quedan: number; tracking_code: string }> {
  const { data, error } = await supabase.rpc("despachar_parte_del_pedido" as never, {
    p_order_id: orderId, p_items: items, p_carrier: carrier, p_tracking: tracking.trim() || null,
  } as never);
  if (error) throw error;
  return data as never;
}
