import { supabase } from "@/integrations/supabase/client";
import { buscarLiteral, camposProducto, crearIndiceBusqueda } from "@/lib/catalogSearch";
import { productoPorCodigo } from "@/lib/presupuestos";
import { normalizeText } from "@/lib/searchText";

/**
 * Compras (rearmado 2026-10-14, pedido del dueño: «además de lo visual, tienen
 * funciones totalmente legacy o incoherentes»). Antes «Nueva compra» insertaba
 * columnas que no existen y fallaba siempre; era un producto por compra, con
 * costo en dólares más un «pasero» del importador original; las compras
 * «programadas» y «en camino» duplicaban las órdenes de compra, y borrar un
 * renglón dejaba la deuda con el proveedor y el egreso por el total.
 *
 * Ahora el ciclo es uno: lo que se pide va por Órdenes de compra; lo que entra
 * (por recepción de una orden o compra directa) queda acá como una compra
 * entera, con su comprobante, su pago o su cuenta a pagar, y se anula entera.
 * La base hace el trabajo: `registrar_compra` (stock, costo del producto,
 * cuenta del proveedor o egreso) y `anular_compra`.
 */

export type MonedaCompra = "ARS" | "USD";
export type MedioDePago = "efectivo" | "transferencia" | "tarjeta" | "mercado_pago" | "otro";

export const MEDIOS_DE_PAGO: Array<{ id: MedioDePago; label: string }> = [
  { id: "efectivo", label: "Efectivo" },
  { id: "transferencia", label: "Transferencia" },
  { id: "tarjeta", label: "Tarjeta" },
  { id: "mercado_pago", label: "Mercado Pago" },
  { id: "otro", label: "Otro" },
];

export interface RenglonCompra {
  clave: string;
  productId: string | null;
  nombre: string;
  unidad?: string | null;
  qty: number;
  /** Costo unitario en la moneda de la compra. */
  costo: number;
}

export interface FormularioCompra {
  proveedorId: string | null;
  proveedor: string;
  comprobante: string;
  fecha: string;
  moneda: MonedaCompra;
  cotizacion: number | null;
  renglones: RenglonCompra[];
  aPagar: boolean;
  vencimiento: string;
  medio: MedioDePago;
  nota: string;
  actualizarCostos: boolean;
}

export interface ProductoConCosto {
  cost_currency?: string | null;
  cost_ars?: number | null;
  cost_usd?: number | null;
  total_cost_usd?: number | null;
}

const ARGENTINA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" });

/** AAAA-MM-DD del día en Argentina (no el de UTC: después de las 21 h ya es «mañana»). */
export function fechaArgentina(d: Date | string = new Date()): string {
  const fecha = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(fecha.getTime()) ? "" : ARGENTINA.format(fecha);
}

/** El día en Argentina dentro de `dias` días. */
export function fechaArgentinaEnDias(dias: number, desde = new Date()): string {
  return fechaArgentina(new Date(desde.getTime() + dias * 86_400_000));
}

let contador = 0;
export function nuevaClaveCompra(): string {
  contador += 1;
  return `c${Date.now().toString(36)}${contador}`;
}

const redondear = (n: number, d = 2) => Math.round((Number(n) || 0) * 10 ** d) / 10 ** d;

export function totalDeRenglonCompra(r: Pick<RenglonCompra, "qty" | "costo">): number {
  return redondear(Number(r.qty) * Number(r.costo));
}

export function totalDeCompra(renglones: RenglonCompra[]): number {
  return redondear(renglones.filter(r => r.productId).reduce((s, r) => s + totalDeRenglonCompra(r), 0));
}

/** Total en pesos de lo cargado (para mostrar el equivalente de una compra en dólares). */
export function totalEnPesos(f: Pick<FormularioCompra, "moneda" | "cotizacion" | "renglones">): number | null {
  const total = totalDeCompra(f.renglones);
  if (f.moneda === "ARS") return total;
  return f.cotizacion && f.cotizacion > 0 ? redondear(total * f.cotizacion) : null;
}

/**
 * El costo actual del producto expresado en la moneda de la compra, para
 * precargar el renglón. Sigue la misma regla que `costo_unitario_ars` en la
 * base: manda la moneda declarada; si no hay, la de donde esté el número.
 */
export function costoSugerido(p: ProductoConCosto, moneda: MonedaCompra, cotizacion: number | null): number {
  const usd = Number(p.total_cost_usd) > 0 ? Number(p.total_cost_usd) : Number(p.cost_usd) || 0;
  const ars = Number(p.cost_ars) || 0;
  const monedaProducto = p.cost_currency ?? (ars > 0 ? "ARS" : "USD");
  const tc = cotizacion && cotizacion > 0 ? cotizacion : null;
  if (monedaProducto === "ARS") {
    if (moneda === "ARS") return redondear(ars);
    return tc ? redondear(ars / tc, 4) : 0;
  }
  if (moneda === "USD") return redondear(usd, 4);
  return tc ? redondear(usd * tc) : 0;
}

/** Lo que impide guardar, en el orden en que conviene resolverlo. */
export function problemasDeLaCompra(f: FormularioCompra): string[] {
  const problemas: string[] = [];
  const conProducto = f.renglones.filter(r => r.productId);
  if (conProducto.length === 0) problemas.push("Agregá al menos un producto del catálogo");
  if (f.renglones.some(r => !r.productId && (r.nombre.trim() || Number(r.costo) > 0))) {
    problemas.push("Hay un renglón sin producto: elegilo del catálogo o quitalo");
  }
  conProducto.forEach((r, i) => {
    if (!(Number(r.qty) > 0)) problemas.push(`Renglón ${i + 1}: la cantidad tiene que ser mayor a cero`);
    if (Number(r.costo) < 0) problemas.push(`Renglón ${i + 1}: el costo no puede ser negativo`);
  });
  if (f.moneda === "USD" && !(Number(f.cotizacion) > 0)) problemas.push("Para una compra en dólares cargá la cotización");
  if (f.aPagar && !f.proveedorId && !f.proveedor.trim()) problemas.push("Para dejarla a pagar, elegí el proveedor");
  if (conProducto.length > 300) problemas.push("Una compra puede tener hasta 300 renglones");
  return problemas;
}

/** El cuerpo de `registrar_compra`. */
export function aDatosDeCompra(f: FormularioCompra): Record<string, unknown> {
  return {
    proveedor_id: f.proveedorId,
    proveedor: f.proveedorId ? null : f.proveedor.trim() || null,
    comprobante: f.comprobante.trim() || null,
    fecha: f.fecha || null,
    moneda: f.moneda,
    cotizacion: f.cotizacion && f.cotizacion > 0 ? f.cotizacion : null,
    a_pagar: f.aPagar,
    vencimiento: f.aPagar ? f.vencimiento || null : null,
    medio: f.aPagar ? null : f.medio,
    nota: f.nota.trim() || null,
    actualizar_costos: f.actualizarCostos,
    items: f.renglones.filter(r => r.productId).map(r => ({
      producto_id: r.productId, cantidad: Number(r.qty), costo_unitario: Number(r.costo),
    })),
  };
}

// ───────────────────────── factura leída ─────────────────────────

/** Lo que devuelve la lectura de la factura del proveedor (extract-invoice). */
export interface FacturaLeida {
  proveedor: string | null;
  fecha: string | null;
  renglones: Array<{ nombre: string; marca: string | null; qty: number; costo: number; moneda: MonedaCompra }>;
}

type ProductoBuscable = { id: string; name: string; brand?: string | null; sku?: string | null; barcode?: string | null; barcode_aliases?: string[] | null; unidad_medida?: string | null };

/**
 * El producto del catálogo que corresponde a un renglón de la factura, sólo si
 * no hay dudas: el código exacto, el nombre exacto (sin tildes ni mayúsculas) o
 * un único resultado de la búsqueda. Si hay dudas, ninguno: elige la persona.
 */
export function productoDeLaFactura<P extends ProductoBuscable>(productos: P[], nombre: string, marca?: string | null): P | null {
  const texto = nombre.trim();
  if (!texto) return null;
  const porCodigo = productoPorCodigo(productos, texto);
  if (porCodigo) return porCodigo;
  const buscado = normalizeText(texto);
  const exactos = productos.filter(p => normalizeText(p.name) === buscado);
  if (exactos.length === 1) return exactos[0];
  const indice = crearIndiceBusqueda(productos, p => camposProducto(p));
  const candidatos = buscarLiteral(indice, [texto, marca].filter(Boolean).join(" "));
  return candidatos.length === 1 ? candidatos[0] : null;
}

/**
 * La compra precargada con lo que leyó la IA. Moneda: la de la mayoría de los
 * renglones (los de la otra se convierten si hay cotización). Los renglones sin
 * producto seguro quedan con el nombre de la factura para que se elija.
 */
export function compraDesdeFactura<P extends ProductoBuscable>(
  factura: FacturaLeida,
  productos: P[],
  proveedores: Array<{ id: string; name: string }>,
  cotizacion: number | null,
  hoy = fechaArgentina(),
): { cambios: Partial<FormularioCompra>; sinProducto: number; monedasMezcladas: boolean; proveedorSinCargar: string | null } {
  const usd = factura.renglones.filter(r => r.moneda === "USD").length;
  const moneda: MonedaCompra = usd > factura.renglones.length - usd ? "USD" : "ARS";
  const tc = cotizacion && cotizacion > 0 ? cotizacion : null;
  const renglones: RenglonCompra[] = factura.renglones.map(r => {
    const p = productoDeLaFactura(productos, r.nombre, r.marca);
    let costo = Number(r.costo) || 0;
    if (r.moneda !== moneda) costo = !tc ? 0 : moneda === "USD" ? redondear(costo / tc, 4) : redondear(costo * tc);
    return { clave: nuevaClaveCompra(), productId: p?.id ?? null, nombre: p?.name ?? r.nombre, unidad: p?.unidad_medida ?? null, qty: Number(r.qty) > 0 ? Number(r.qty) : 1, costo };
  });
  const nombreProveedor = (factura.proveedor ?? "").trim();
  const proveedor = nombreProveedor ? proveedores.find(p => normalizeText(p.name) === normalizeText(nombreProveedor)) ?? null : null;
  const fechaValida = factura.fecha && /^\d{4}-\d{2}-\d{2}$/.test(factura.fecha) && factura.fecha <= hoy ? factura.fecha : null;
  return {
    cambios: {
      moneda,
      renglones,
      ...(fechaValida ? { fecha: fechaValida } : {}),
      ...(proveedor ? { proveedorId: proveedor.id, proveedor: proveedor.name } : proveedores.length === 0 && nombreProveedor ? { proveedor: nombreProveedor } : {}),
    },
    sinProducto: renglones.filter(r => !r.productId).length,
    monedasMezcladas: usd > 0 && usd < factura.renglones.length,
    proveedorSinCargar: nombreProveedor && !proveedor && proveedores.length > 0 ? nombreProveedor : null,
  };
}

// ───────────────────────── listado ─────────────────────────

export interface FilaDeCompra {
  id: string;
  compra_id?: string | null;
  date: string;
  product_id?: string | null;
  product_name: string;
  quantity: number;
  total_ars: number;
  total_usd: number;
  exchange_rate?: number | null;
  supplier?: string | null;
  supplier_id?: string | null;
  batch_name?: string | null;
  is_scheduled?: boolean | null;
}

export interface DeudaDeCompra {
  id: string;
  purchase_id: string | null;
  amount_ars: number;
  paid_ars: number;
  remaining_ars: number | null;
  due_date: string | null;
  status: string;
}

export interface Compra {
  id: string;
  fecha: string;
  proveedor: string | null;
  proveedorId: string | null;
  comprobante: string | null;
  renglones: FilaDeCompra[];
  totalArs: number;
  totalUsd: number;
  /** Número de la orden de compra por la que entró, si entró por una. */
  orden: { id: string; numero: string } | null;
  deuda: DeudaDeCompra | null;
  estadoDePago: "pagada" | "a_pagar" | "pago_parcial" | "vencida" | "sin_registrar";
}

/**
 * Agrupa los renglones en compras: los que comparten `compra_id` son una sola;
 * los anteriores a esa columna, uno cada uno. Ordenadas de la más nueva.
 */
export function agruparCompras(
  filas: FilaDeCompra[],
  recepciones: Map<string, { id: string; numero: string }>,
  deudas: DeudaDeCompra[],
  hoy = fechaArgentina(),
): Compra[] {
  const deudaPorCompra = new Map<string, DeudaDeCompra>();
  for (const d of deudas) if (d.purchase_id) deudaPorCompra.set(d.purchase_id, d);
  const grupos = new Map<string, FilaDeCompra[]>();
  for (const f of filas) {
    if (f.is_scheduled) continue;
    const clave = f.compra_id || f.id;
    (grupos.get(clave) ?? grupos.set(clave, []).get(clave)!).push(f);
  }
  const compras: Compra[] = [];
  for (const [id, renglones] of grupos) {
    const primera = renglones[0];
    const deuda = renglones.map(r => deudaPorCompra.get(r.id)).find(Boolean) ?? null;
    const orden = renglones.map(r => recepciones.get(r.id)).find(Boolean) ?? null;
    const restante = deuda ? Number(deuda.remaining_ars ?? Number(deuda.amount_ars) - Number(deuda.paid_ars)) : 0;
    const estadoDePago: Compra["estadoDePago"] = !deuda
      ? (orden ? "sin_registrar" : "pagada")
      : restante <= 0.009 ? "pagada"
        : deuda.due_date && deuda.due_date < hoy ? "vencida"
          : Number(deuda.paid_ars) > 0 ? "pago_parcial" : "a_pagar";
    compras.push({
      id,
      fecha: fechaArgentina(String(primera.date ?? "")),
      proveedor: primera.supplier ?? null,
      proveedorId: primera.supplier_id ?? null,
      comprobante: primera.batch_name ?? null,
      renglones,
      totalArs: redondear(renglones.reduce((s, r) => s + Number(r.total_ars || 0), 0)),
      totalUsd: redondear(renglones.reduce((s, r) => s + Number(r.total_usd || 0), 0)),
      orden,
      deuda,
      estadoDePago,
    });
  }
  return compras.sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id.localeCompare(a.id));
}

export const ETIQUETA_DE_PAGO: Record<Compra["estadoDePago"], string> = {
  pagada: "Pagada",
  a_pagar: "A pagar",
  pago_parcial: "Pago parcial",
  vencida: "Vencida",
  sin_registrar: "Pago sin registrar",
};

/** Busca en producto, proveedor, comprobante y número de orden. */
export function compraCoincide(c: Compra, texto: string): boolean {
  const t = texto.trim().toLowerCase();
  if (!t) return true;
  return [c.proveedor, c.comprobante, c.orden?.numero, ...c.renglones.map(r => r.product_name)]
    .some(v => (v ?? "").toLowerCase().includes(t));
}

// ───────────────────────── base ─────────────────────────

export async function registrarCompraDB(orgId: string, f: FormularioCompra): Promise<{ compra_id: string; renglones: number; total_ars: number; costos_actualizados: number; deuda_id: string | null }> {
  const { data, error } = await supabase.rpc("registrar_compra" as never, { p_org: orgId, p_datos: aDatosDeCompra(f) } as never);
  if (error) throw error;
  return data as never;
}

export async function anularCompraDB(orgId: string, compraId: string): Promise<{ renglones: number; total_ars: number }> {
  const { data, error } = await supabase.rpc("anular_compra" as never, { p_org: orgId, p_compra: compraId } as never);
  if (error) throw error;
  return data as never;
}

const PAGINA = 1000;

/** Todas las filas, de a 1.000 (el tope de la API), ordenadas por id. */
async function todasLasFilas<T>(consulta: (desde: number, hasta: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += PAGINA) {
    const { data, error } = await consulta(desde, desde + PAGINA - 1);
    if (error) throw error;
    filas.push(...((data ?? []) as T[]));
    if ((data ?? []).length < PAGINA) return filas;
  }
}

/** Recepciones de órdenes (renglón de compra → orden) y cuentas a pagar ligadas a compras. */
export async function contextoDeComprasDB(orgId: string): Promise<{ recepciones: Map<string, { id: string; numero: string }>; deudas: DeudaDeCompra[] }> {
  type Recepcion = { purchase_id: string; order_id: string; purchase_orders: { order_number: string } | null };
  const [rec, deudas] = await Promise.all([
    todasLasFilas<Recepcion>((desde, hasta) => supabase.from("purchase_order_receipts")
      .select("purchase_id, order_id, purchase_orders(order_number)").eq("org_id", orgId).not("purchase_id", "is", null)
      .order("id").range(desde, hasta)),
    todasLasFilas<DeudaDeCompra>((desde, hasta) => supabase.from("supplier_debts")
      .select("id, purchase_id, amount_ars, paid_ars, remaining_ars, due_date, status").eq("org_id", orgId).not("purchase_id", "is", null)
      .order("id").range(desde, hasta)),
  ]);
  const recepciones = new Map<string, { id: string; numero: string }>();
  for (const r of rec) recepciones.set(r.purchase_id, { id: r.order_id, numero: r.purchase_orders?.order_number ?? "orden de compra" });
  return { recepciones, deudas };
}
