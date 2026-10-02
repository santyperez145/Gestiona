import { z } from "zod";
import { esMedioGestionaPay } from "@/lib/gestionaPay";

/**
 * Cuotas de MercadoPago, del lado del navegador.
 *
 * Los números **no se calculan acá**: vienen de `mp-installments`, que se los
 * pregunta a MercadoPago con la clave del comercio. Dividir el precio por N y
 * llamarlo "cuota" sería inventar: el recargo depende de las promociones que
 * cada comercio tenga contratadas, y si el comprador ve 6 sin interés en la
 * ficha y le aparecen con interés en el checkout, la venta se cae ahí.
 *
 * Este módulo sólo elige QUÉ mostrar de lo que MercadoPago devolvió y cómo
 * redactarlo.
 */

export interface OpcionCuota {
  cuotas: number;
  monto: number;
  total: number;
  sinInteres: boolean;
}

export interface RespuestaCuotas {
  opciones: OpcionCuota[];
  mejorSinInteres: OpcionCuota | null;
  maxCuotas: number;
  /** Por qué no hay cuotas, cuando no las hay. Sirve para diagnosticar. */
  motivo?: string;
}

const installmentOption = z.object({ cuotas: z.number().int().positive(), monto: z.number().finite().positive(),
  total: z.number().finite().positive(), sinInteres: z.boolean() });
export const installmentResponseSchema = z.object({ opciones: z.array(installmentOption).max(100),
  mejorSinInteres: installmentOption.nullable().default(null), maxCuotas: z.number().int().nonnegative().default(0), motivo: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.maxCuotas !== Math.max(0, ...data.opciones.map(option => option.cuotas))
    || (data.mejorSinInteres && (!data.mejorSinInteres.sinInteres || data.mejorSinInteres.cuotas <= 1
      || !data.opciones.some(option => option.cuotas === data.mejorSinInteres.cuotas && option.monto === data.mejorSinInteres.monto
        && option.total === data.mejorSinInteres.total && option.sinInteres)))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Inconsistent installment response" });
  }
});

export function canQueryStoreInstallments(store?: { payment_methods?: string[] | null; currency?: string | null } | null): boolean {
  return !!store?.payment_methods?.some(esMedioGestionaPay) && (store.currency || "ARS") === "ARS";
}

/**
 * La opción que se muestra en una sola línea.
 *
 * Gana la mejor sin interés: es el gancho real, y "12 cuotas con recargo" no
 * vende nada. Si no hay ninguna sin interés se muestra la de más cuotas, que
 * sigue siendo información útil para quien necesita financiar.
 */
export function opcionDestacada(r: RespuestaCuotas | null | undefined): OpcionCuota | null {
  if (!r?.opciones?.length) return null;
  if (r.mejorSinInteres && r.mejorSinInteres.cuotas > 1) return r.mejorSinInteres;

  const conVarias = r.opciones.filter(o => o.cuotas > 1);
  if (!conVarias.length) return null;
  return conVarias.reduce((a, b) => (b.cuotas > a.cuotas ? b : a));
}

/**
 * El texto de la ficha: "6 cuotas sin interés de $12.500".
 *
 * `fmt` es el formateador de moneda de la tienda, para que respete la que tenga
 * configurada en vez de asumir pesos.
 */
export function textoCuotas(
  o: OpcionCuota | null | undefined,
  fmt: (n: number) => string,
): string | null {
  if (!o || o.cuotas < 2) return null;
  return `${o.cuotas} cuotas ${o.sinInteres ? "sin interés " : ""}de ${fmt(o.monto)}`;
}

/**
 * ¿Vale la pena pedirle las cuotas a MercadoPago para este monto?
 *
 * Por debajo de cierto precio no hay financiación que ofrecer y la consulta es
 * una llamada de red al pedo en cada ficha. El umbral es deliberadamente bajo:
 * la respuesta real la da MercadoPago, esto sólo evita preguntar por un monto
 * que no puede tener cuotas.
 */
export const MONTO_MINIMO_CUOTAS = 1000;

export function convieneConsultar(monto: number | null | undefined): boolean {
  const n = Number(monto);
  return Number.isFinite(n) && n >= MONTO_MINIMO_CUOTAS;
}
