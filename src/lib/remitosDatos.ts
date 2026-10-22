/**
 * Lectura y escritura de remitos. Tolera que la migración 20261022000400
 * todavía no esté aplicada: en ese caso devuelve «inactivo» y la pantalla lo
 * explica, en vez de romperse o mostrar un error técnico.
 *
 * Las lecturas reintentan lo pasajero (red, 5xx). Las escrituras no: emitir
 * dos veces por un reintento automático daría dos remitos con dos números.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { isMissingColumn, isMissingFunction, isMissingRelation } from "@/lib/publicDataSource";
import { isTransientReadError, retryRead } from "@/lib/transientRead";
import {
  codigoDeVenta, pendientesDeEntrega,
  type EmisorDelRemito, type EstadoRemito, type LineaPendiente, type LineaVendida, type Remito, type Talonario,
} from "@/lib/remitos";

type ErrorPg = { code?: string; message?: string; status?: number } | null;

export type Lectura<T> = { estado: "listo"; datos: T } | { estado: "inactivo" } | { estado: "error"; mensaje: string };

export const COLUMNAS_REMITO =
  "id, punto_venta, numero, letra, cai, cai_vence, fecha, sale_transaction_id, customer_id, cliente_nombre, cliente_cuit, cliente_domicilio, transportista, bultos, valor_declarado, observaciones, estado, entregado_at, recibio_nombre, recibio_dni, anulado_at, anulado_motivo, created_at, remito_items(id, sale_id, product_id, descripcion, cantidad, unidad)";

const esInactivo = (e: ErrorPg) => isMissingRelation(e) || isMissingFunction(e) || isMissingColumn(e);

/** ¿Se cortó la red o el servicio, y no es un error de datos o de permisos? */
export function esPasajero(e: ErrorPg): boolean {
  return isTransientReadError(e);
}

/** Reintenta una lectura si el error es pasajero (red, 5xx): tres intentos. */
export function leerConReintento<T>(leer: () => PromiseLike<{ data: T | null; error: ErrorPg; status?: number }>) {
  return retryRead(leer, { delaysMs: [400, 1200] });
}

function comoLectura<T>(r: { data: unknown; error: ErrorPg; status?: number }, que: string, mapear: (d: unknown) => T): Lectura<T> {
  if (r.error) {
    if (esInactivo(r.error)) return { estado: "inactivo" };
    console.error(`Remitos: no se pudo leer ${que}`, r.error);
    return { estado: "error", mensaje: esPasajero({ ...r.error, status: r.status }) ? "Sin conexión con Nerqia." : `No se pudo leer ${que}.` };
  }
  return { estado: "listo", datos: mapear(r.data) };
}

const normalizar = (d: unknown): Remito[] =>
  ((d ?? []) as Remito[]).map(r => ({
    ...r,
    numero: Number(r.numero),
    valor_declarado: r.valor_declarado === null ? null : Number(r.valor_declarado),
    remito_items: (r.remito_items ?? []).map(it => ({ ...it, cantidad: Number(it.cantidad) })),
  }));

export interface FiltroRemitos { desde?: string; hasta?: string; estado?: EstadoRemito | "todos"; limite?: number }

export async function leerRemitos(orgId: string, f: FiltroRemitos = {}): Promise<Lectura<Remito[]>> {
  const r = await leerConReintento(() => {
    let q = supabase.from("remitos").select(COLUMNAS_REMITO).eq("org_id", orgId);
    if (f.desde) q = q.gte("fecha", f.desde);
    if (f.hasta) q = q.lte("fecha", f.hasta);
    if (f.estado && f.estado !== "todos") q = q.eq("estado", f.estado);
    return q.order("fecha", { ascending: false }).order("numero", { ascending: false }).limit(f.limite ?? 500);
  });
  return comoLectura(r, "los remitos", normalizar);
}

/** Un remito por id, para abrirlo desde un enlace aunque no esté en el período de la lista. */
export async function leerRemito(orgId: string, id: string): Promise<Lectura<Remito | null>> {
  const r = await leerConReintento(() => supabase.from("remitos").select(COLUMNAS_REMITO).eq("org_id", orgId).eq("id", id).limit(1));
  return comoLectura(r, "el remito", d => normalizar(d)[0] ?? null);
}

/** Los remitos que tocan alguno de estos renglones de venta (con todos sus renglones). */
export async function leerRemitosDeVenta(orgId: string, saleIds: string[]): Promise<Lectura<Remito[]>> {
  if (saleIds.length === 0) return { estado: "listo", datos: [] };
  const items = await leerConReintento(() =>
    supabase.from("remito_items").select("remito_id").eq("org_id", orgId).in("sale_id", saleIds).limit(1000));
  if (items.error) return comoLectura(items, "las entregas de la venta", () => []);
  const ids = [...new Set((items.data ?? []).map(i => i.remito_id))];
  if (ids.length === 0) return { estado: "listo", datos: [] };
  const r = await leerConReintento(() =>
    supabase.from("remitos").select(COLUMNAS_REMITO).eq("org_id", orgId).in("id", ids).order("numero", { ascending: true }));
  return comoLectura(r, "las entregas de la venta", normalizar);
}

export interface VentaPorEntregar {
  clave: string;
  saleTransactionId: string | null;
  codigo: string;
  cliente: string | null;
  fecha: string | null;
  lineas: LineaVendida[];
  pendientes: LineaPendiente[];
}

/**
 * Ventas que ya tienen algún remito y todavía no se entregaron completas: lo
 * que el depósito tiene que mandar. Una venta de mostrador sin remitos no
 * figura: se entregó en el momento y listarla sería ruido.
 */
export async function leerEntregasParciales(orgId: string): Promise<Lectura<VentaPorEntregar[]>> {
  const items = await leerConReintento(() => supabase.from("remito_items")
    .select("sale_id, cantidad, remitos!inner(estado)").eq("org_id", orgId).not("sale_id", "is", null)
    .neq("remitos.estado", "anulado").limit(5000));
  if (items.error) return comoLectura(items, "las entregas pendientes", () => []);
  const entregas = (items.data ?? []) as { sale_id: string; cantidad: number }[];
  const ids = [...new Set(entregas.map(i => i.sale_id))];
  if (ids.length === 0) return { estado: "listo", datos: [] };
  if (ids.length > 500) console.warn(`Remitos: ${ids.length} renglones de venta remitidos; se revisan los 500 primeros`);

  const columnas = "id, sale_transaction_id, product_name, quantity, returned_quantity, customer_name, date";
  const vendidas = await leerConReintento(() => supabase.from("sales").select(columnas).eq("org_id", orgId).in("id", ids.slice(0, 500)));
  if (vendidas.error) return comoLectura(vendidas, "las entregas pendientes", () => []);
  type Fila = LineaVendida & { sale_transaction_id: string | null; customer_name: string | null; date: string | null };
  const filas = (vendidas.data ?? []) as Fila[];
  const transacciones = [...new Set(filas.map(f => f.sale_transaction_id).filter(Boolean) as string[])];
  let hermanas: Fila[] = [];
  if (transacciones.length) {
    const r = await leerConReintento(() => supabase.from("sales").select(columnas).eq("org_id", orgId).in("sale_transaction_id", transacciones.slice(0, 300)));
    if (r.error) return comoLectura(r, "las entregas pendientes", () => []);
    hermanas = (r.data ?? []) as Fila[];
  }

  const grupos = new Map<string, Fila[]>();
  for (const f of [...filas, ...hermanas]) {
    const clave = f.sale_transaction_id ?? f.id;
    const g = grupos.get(clave) ?? [];
    if (!g.some(x => x.id === f.id)) g.push(f);
    grupos.set(clave, g);
  }
  const comoRemito = [{ estado: "emitido" as const, remito_items: entregas.map(e => ({ sale_id: e.sale_id, product_id: null, descripcion: "", cantidad: Number(e.cantidad), unidad: "un" })) }];
  const ventas: VentaPorEntregar[] = [];
  for (const [clave, lineas] of grupos) {
    const pendientes = pendientesDeEntrega(lineas, comoRemito);
    if (pendientes.every(p => p.pendiente <= 0)) continue;
    const primera = lineas[0];
    ventas.push({
      clave, saleTransactionId: primera.sale_transaction_id, codigo: codigoDeVenta(clave),
      cliente: primera.customer_name, fecha: primera.date, lineas, pendientes,
    });
  }
  ventas.sort((a, b) => String(a.fecha ?? "").localeCompare(String(b.fecha ?? "")));
  return { estado: "listo", datos: ventas };
}

export async function leerTalonario(orgId: string): Promise<Lectura<Talonario | null>> {
  const r = await leerConReintento(() =>
    supabase.from("remito_talonarios").select("punto_venta, proximo_numero, cai, cai_vence").eq("org_id", orgId).maybeSingle());
  return comoLectura(r, "el talonario", d => (d ? { ...(d as Talonario), proximo_numero: Number((d as Talonario).proximo_numero) } : null));
}

/**
 * Datos del emisor para el papel: lo fiscal sale de la conexión con ARCA
 * (razón social, domicilio, condición, IIBB, inicio). Si no se puede leer, el
 * remito sale con el nombre comercial: mejor un remito sin IIBB que ninguno.
 */
export async function leerEmisor(orgId: string, nombreDeRespaldo: string): Promise<EmisorDelRemito> {
  const [ajustes, fiscal] = await Promise.all([
    leerConReintento(() => supabase.from("settings").select("business_name, afip_cuit").eq("org_id", orgId).maybeSingle()),
    leerConReintento(() => supabase.from("afip_connection_status")
      .select("cuit, razon_social, domicilio, tipo_emisor, ingresos_brutos, inicio_actividades").eq("org_id", orgId).maybeSingle()),
  ]);
  if (ajustes.error) console.error("Remitos: no se pudieron leer los datos del negocio", ajustes.error);
  if (fiscal.error) console.error("Remitos: no se pudieron leer los datos fiscales", fiscal.error);
  const a = ajustes.data as { business_name?: string | null; afip_cuit?: string | null } | null;
  const f = fiscal.data as Record<string, string | null> | null;
  return {
    nombre: a?.business_name?.trim() || nombreDeRespaldo,
    razonSocial: f?.razon_social ?? null,
    cuit: f?.cuit ?? a?.afip_cuit ?? null,
    domicilio: f?.domicilio ?? null,
    tipoEmisor: f?.tipo_emisor ?? null,
    ingresosBrutos: f?.ingresos_brutos ?? null,
    inicioActividades: f?.inicio_actividades ?? null,
  };
}

/** Se distingue con `"error" in r`: sin strictNullChecks, `!r.ok` no estrecha el tipo. */
type Escritura<T> = { ok: true; datos: T } | { ok: false; error: ErrorPg; inactivo: boolean };

function comoEscritura<T>(r: { data: unknown; error: ErrorPg; status?: number }): Escritura<T> {
  // El estado HTTP viaja en el resultado, no en el error: se lo pega para saber si fue la red.
  if (r.error) return { ok: false, error: { ...r.error, status: r.status }, inactivo: esInactivo(r.error) };
  return { ok: true, datos: r.data as T };
}

export async function emitirRemito(orgId: string, datos: Record<string, unknown>): Promise<Escritura<Remito>> {
  return comoEscritura(await supabase.rpc("emitir_remito", { p_org: orgId, p_datos: datos as Json }));
}

export async function marcarEntregado(remitoId: string, nombre: string, dni: string): Promise<Escritura<Remito>> {
  return comoEscritura(await supabase.rpc("marcar_remito_entregado", { p_remito: remitoId, p_recibio_nombre: nombre, p_recibio_dni: dni || null }));
}

export async function anularRemito(remitoId: string, motivo: string): Promise<Escritura<Remito>> {
  return comoEscritura(await supabase.rpc("anular_remito", { p_remito: remitoId, p_motivo: motivo }));
}

export async function configurarTalonario(orgId: string, t: { puntoVenta: number; cai: string | null; caiVence: string | null; proximoNumero: number | null }): Promise<Escritura<Talonario>> {
  return comoEscritura(await supabase.rpc("configurar_talonario_remitos", {
    p_org: orgId, p_punto_venta: t.puntoVenta, p_cai: t.cai, p_cai_vence: t.caiVence, p_proximo_numero: t.proximoNumero,
  }));
}
