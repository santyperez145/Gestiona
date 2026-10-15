import { supabase } from "@/integrations/supabase/client";
import { cobrarCuentaCorrienteDB, type CobroCuentaCorriente } from "@/lib/supabaseStore";

/**
 * Cuenta corriente (fiado) del lado de la app. Todo cobro pasa por
 * `cobrar_cuenta_corriente` (migración 20261014000500), que en una transacción
 * aplica el pago, registra cada imputación, salda la venta y suma la caja.
 * Antes «Cobrar todo» y «Marcar como pagadas» escribían la deuda como pagada
 * sin dejar el pago ni el movimiento de caja: el cierre no cerraba.
 */

export interface DeudaPendiente {
  id: string;
  org_id: string;
  customer_id?: string | null;
  customer_name?: string | null;
  description?: string | null;
  remaining_ars: number | string;
}

export interface Deudor {
  nombre: string;
  /** El cliente, si todas sus deudas lo tienen; si no, se cobra por nombre. */
  customerId: string | null;
  deudas: DeudaPendiente[];
  total: number;
}

export const MEDIOS_DE_COBRO = [
  { value: "efectivo", label: "Efectivo" },
  { value: "transferencia", label: "Transferencia" },
  { value: "debito", label: "Tarjeta de débito" },
  { value: "credito", label: "Tarjeta de crédito" },
  { value: "mercadopago", label: "Mercado Pago" },
] as const;

/** El texto que manda la base (p. ej. «El pago supera lo que se debe»), sea Error u objeto. */
export function mensajeDeError(e: unknown, porDefecto = "No se pudo registrar el cobro"): string {
  if (e instanceof Error && e.message) return e.message;
  const m = (e as { message?: unknown } | null)?.message;
  return typeof m === "string" && m ? m : porDefecto;
}

const centavos = (n: number) => Math.round(n * 100) / 100;

/** Agrupa por nombre (sin espacios de más), de quien más debe a quien menos. */
export function agruparDeudores(deudas: DeudaPendiente[]): Deudor[] {
  const grupos = new Map<string, Deudor>();
  for (const d of deudas) {
    const nombre = (d.customer_name ?? "").trim();
    if (!nombre) continue; // Sin nombre no hay a quién imputarle un pago a cuenta.
    const g = grupos.get(nombre) ?? { nombre, customerId: d.customer_id ?? null, deudas: [], total: 0 };
    if (g.deudas.length > 0 && g.customerId !== (d.customer_id ?? null)) g.customerId = null;
    g.deudas.push(d);
    g.total = centavos(g.total + Number(d.remaining_ars));
    grupos.set(nombre, g);
  }
  return [...grupos.values()].sort((a, b) => b.total - a.total);
}

export function totalPendiente(deudas: DeudaPendiente[]): number {
  return deudas.reduce((s, d) => centavos(s + Number(d.remaining_ars)), 0);
}

/** Pago a cuenta de un cliente: se aplica de la deuda más vieja a la más nueva. */
export function cobrarADeudor(deudor: Deudor, args: { orgId: string; monto: number; medio: string; clave: string; nota?: string; excedenteAFavor?: boolean }) {
  return cobrarCuentaCorrienteDB({
    orgId: args.orgId,
    monto: centavos(args.monto),
    medio: args.medio,
    clave: args.clave,
    customerId: deudor.customerId,
    customerName: deudor.nombre,
    nota: args.nota?.trim() || null,
    excedenteAFavor: args.excedenteAFavor,
  });
}

/** Medio para pagar deudas con el saldo a favor del cliente (no mueve la caja). */
export const MEDIO_SALDO_A_FAVOR = "saldo_a_favor";

/** Saldo a favor de un cliente (anticipos y excedentes menos lo ya usado). */
export async function saldoAFavorDB(orgId: string, customerId: string): Promise<number> {
  const { data, error } = await supabase.rpc("saldo_a_favor" as never, { p_org: orgId, p_customer_id: customerId } as never);
  if (error) throw error;
  return Number(data ?? 0);
}

/** Cuánto queda a favor si el cliente paga `monto` contra `total` (al centavo). */
export function excedenteDe(monto: number, total: number): number {
  return Math.max(0, centavos(monto - total));
}

/**
 * Salda varias deudas elegidas, una por una y cada una con su clave derivada
 * de la del intento: si se corta a la mitad, repetir no cobra dos veces las
 * que ya entraron.
 */
export async function cobrarSeleccion(
  deudas: DeudaPendiente[],
  args: { medio: string; clave: string; nota?: string },
): Promise<{ cobradas: CobroCuentaCorriente[]; fallidas: Array<{ deuda: DeudaPendiente; error: string }> }> {
  const cobradas: CobroCuentaCorriente[] = [];
  const fallidas: Array<{ deuda: DeudaPendiente; error: string }> = [];
  for (const deuda of deudas) {
    try {
      cobradas.push(await cobrarCuentaCorrienteDB({
        orgId: deuda.org_id,
        monto: centavos(Number(deuda.remaining_ars)),
        medio: args.medio,
        clave: `${args.clave}:${deuda.id}`,
        debtId: deuda.id,
        customerName: deuda.customer_name ?? null,
        nota: args.nota?.trim() || null,
      }));
    } catch (e) {
      fallidas.push({ deuda, error: mensajeDeError(e) });
    }
  }
  return { cobradas, fallidas };
}

/**
 * Las deudas pendientes de un cliente elegido (por id, nunca por nombre
 * aproximado), listas para cobrar a cuenta. `null` si no debe nada.
 */
export async function deudorDelCliente(orgId: string, customerId: string, nombre: string): Promise<Deudor | null> {
  const { data, error } = await supabase
    .from("debts")
    .select("id, org_id, customer_id, customer_name, remaining_ars, description")
    .eq("org_id", orgId)
    .eq("customer_id", customerId)
    .in("status", ["pending", "partial"])
    .gt("remaining_ars", 0)
    .order("date", { ascending: true });
  if (error) throw error;
  const deudas = (data ?? []) as DeudaPendiente[];
  if (deudas.length === 0) return null;
  return { nombre, customerId, deudas, total: totalPendiente(deudas) };
}
