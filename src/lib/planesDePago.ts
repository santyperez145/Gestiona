import { supabase } from "@/integrations/supabase/client";

/**
 * Planes de pago de deudas (2026-10-14, migración 20261014001300). Antes vivían
 * en el navegador y «cuota pagada» era un tilde sin cobro. Ahora el plan está
 * en la base y el estado de cada cuota sale de lo cobrado a la deuda desde que
 * se armó el plan (`paid_ars - pagado_al_crear`): una cuota está pagada cuando
 * los cobros la cubren.
 */

export type FrecuenciaDePlan = "semanal" | "quincenal" | "mensual";

export interface PlanDePago {
  id: string;
  debt_id: string;
  frecuencia: FrecuenciaDePlan;
  cuotas: Array<{ fecha: string; monto: number }>;
  pagado_al_crear: number;
}

export type EstadoDeCuota = "pagada" | "parcial" | "vencida" | "pendiente";

export interface CuotaConEstado {
  numero: number;
  fecha: string;
  monto: number;
  cobrado: number;
  falta: number;
  estado: EstadoDeCuota;
}

const centavos = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Cuotas con su estado según lo cobrado a la deuda. `hoy` en formato AAAA-MM-DD. */
export function estadoDelPlan(plan: PlanDePago, pagadoDeLaDeuda: number, hoy: string) {
  let disponible = Math.max(0, centavos(Number(pagadoDeLaDeuda) - Number(plan.pagado_al_crear)));
  const cuotas: CuotaConEstado[] = plan.cuotas.map((c, i) => {
    const monto = Number(c.monto);
    const cobrado = centavos(Math.min(monto, disponible));
    disponible = centavos(disponible - cobrado);
    const falta = centavos(monto - cobrado);
    const estado: EstadoDeCuota = falta <= 0.009 ? "pagada" : c.fecha < hoy ? "vencida" : cobrado > 0 ? "parcial" : "pendiente";
    return { numero: i + 1, fecha: c.fecha, monto, cobrado, falta, estado };
  });
  const pagadas = cuotas.filter(c => c.estado === "pagada").length;
  const vencidas = cuotas.filter(c => c.estado === "vencida").length;
  const proxima = cuotas.find(c => c.estado !== "pagada") ?? null;
  return { cuotas, pagadas, vencidas, proxima };
}

/** Vista previa idéntica a la base: cuotas iguales al centavo, la última absorbe la diferencia. */
export function previsualizarCuotas(saldo: number, cantidad: number, frecuencia: FrecuenciaDePlan, desde: string) {
  const n = Math.max(1, Math.min(36, Math.trunc(cantidad) || 1));
  const total = centavos(Number(saldo));
  const base = Math.floor((total * 100) / n) / 100;
  return Array.from({ length: n }, (_, i) => ({
    fecha: sumarPeriodos(desde, frecuencia, i),
    monto: i === n - 1 ? centavos(total - base * (n - 1)) : base,
  }));
}

/** Igual que la base: los meses se ajustan al último día (31/01 + 1 mes = 28/02). */
export function sumarPeriodos(desde: string, frecuencia: FrecuenciaDePlan, veces: number): string {
  const [a, m, d] = desde.split("-").map(Number);
  if (frecuencia !== "mensual") {
    const f = new Date(Date.UTC(a, m - 1, d + veces * (frecuencia === "semanal" ? 7 : 14)));
    return f.toISOString().slice(0, 10);
  }
  const mesDestino = m - 1 + veces;
  const ultimoDia = new Date(Date.UTC(a, mesDestino + 1, 0)).getUTCDate();
  return new Date(Date.UTC(a, mesDestino, Math.min(d, ultimoDia))).toISOString().slice(0, 10);
}

/** Frecuencia de un plan viejo del navegador, por la distancia entre cuotas. */
export function frecuenciaDeFechas(fechas: string[]): FrecuenciaDePlan {
  if (fechas.length < 2) return "mensual";
  const dias = (Date.parse(fechas[1]) - Date.parse(fechas[0])) / 86_400_000;
  return dias <= 8 ? "semanal" : dias <= 16 ? "quincenal" : "mensual";
}

export async function leerPlanesDB(orgId: string): Promise<Record<string, PlanDePago>> {
  const { data, error } = await supabase.from("planes_de_pago" as never)
    .select("id, debt_id, frecuencia, cuotas, pagado_al_crear").eq("org_id", orgId);
  if (error) throw error;
  return Object.fromEntries(((data ?? []) as unknown as PlanDePago[]).map(p => [p.debt_id, p]));
}

export async function guardarPlanDB(debtId: string, cantidad: number, frecuencia: FrecuenciaDePlan, desde: string): Promise<PlanDePago> {
  const { data, error } = await supabase.rpc("guardar_plan_de_pago" as never, {
    p_debt_id: debtId, p_cantidad: cantidad, p_frecuencia: frecuencia, p_desde: desde,
  } as never);
  if (error) throw error;
  return data as unknown as PlanDePago;
}

export async function borrarPlanDB(debtId: string): Promise<void> {
  const { error } = await supabase.from("planes_de_pago" as never).delete().eq("debt_id", debtId);
  if (error) throw error;
}
