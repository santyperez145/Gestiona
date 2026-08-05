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
