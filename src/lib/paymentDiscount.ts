/**
 * Descuento por medio de pago.
 *
 * En Argentina casi toda tienda cobra distinto según cómo se pague, y no es un
 * capricho: una transferencia le cuesta 0% al comercio y MercadoPago se lleva
 * alrededor del 6%. Trasladar parte de esa diferencia al comprador mueve las
 * ventas al carril barato, que es plata directa al margen. Tiendanube y
 * Empretienda lo traen de fábrica; acá los tres medios costaban lo mismo.
 *
 * ⚠️ **Esto es sólo para MOSTRAR.** El número que se cobra lo recalcula
 * `create_store_order` en la base, que es la autoridad. Estas funciones son el
 * espejo en el cliente para que el checkout pueda decir "pagando por
 * transferencia pagás $X" antes de crear la orden. Si las dos cuentas divergen,
 * el comprador ve un precio y se le cobra otro — por eso el redondeo es el
 * mismo (`Math.round` ↔ `round()`) y por eso las dos están comentadas como
 * espejos. Si se toca una, se toca la otra.
 */

/** `{ transferencia: 10, efectivo: 5 }` — el valor es el porcentaje de descuento. */
export type PaymentDiscounts = Record<string, number>;

/** Lo máximo que se acepta configurar. Un 100% sería regalar la mercadería. */
export const MAX_DESCUENTO_PORCENTAJE = 90;

/**
 * Porcentaje válido para un medio, o 0.
 *
 * Devuelve 0 —y no el valor crudo— ante cualquier cosa rara: negativo, mayor al
 * tope, `NaN`, o un medio que no está en el mapa. Un descuento inventado sale
 * más caro que uno que no se aplica.
 */
export function porcentajeDe(
  metodo: string | null | undefined,
  descuentos: PaymentDiscounts | null | undefined,
): number {
  if (!metodo || !descuentos) return 0;
  const crudo = Number(descuentos[metodo]);
  if (!Number.isFinite(crudo) || crudo <= 0) return 0;
  return Math.min(crudo, MAX_DESCUENTO_PORCENTAJE);
}

/**
 * Cuánto se descuenta sobre `base`.
 *
 * Espejo de `create_store_order`: `round(base * pct / 100.0)`. La base es el
 * subtotal de productos **ya con el cupón aplicado** — los dos descuentos se
 * acumulan, que es como lo lee cualquiera: "10% off por transferencia" se
 * entiende sobre lo que realmente se paga por la mercadería.
 *
 * El envío queda afuera a propósito: descontar sobre el costo de envío sería
 * regalar plata que se le paga al correo.
 */
export function montoDescuento(
  base: number,
  metodo: string | null | undefined,
  descuentos: PaymentDiscounts | null | undefined,
): number {
  const pct = porcentajeDe(metodo, descuentos);
  if (pct <= 0) return 0;
  const b = Number(base);
  if (!Number.isFinite(b) || b <= 0) return 0;
  return Math.min(Math.round((b * pct) / 100), Math.round(b));
}

/** Lo que termina pagando por la mercadería con ese medio. */
export function totalConDescuento(
  base: number,
  metodo: string | null | undefined,
  descuentos: PaymentDiscounts | null | undefined,
): number {
  const b = Number(base);
  if (!Number.isFinite(b) || b <= 0) return 0;
  return Math.max(0, Math.round(b) - montoDescuento(b, metodo, descuentos));
}

/**
 * El mejor descuento que ofrece la tienda, para el cartel de la vitrina
 * ("10% off pagando por transferencia").
 *
 * Sólo mira los medios que la tienda **acepta**: si alguien configuró un
 * descuento para efectivo y después dejó de aceptarlo, anunciarlo sería mentir.
 */
export function mejorDescuento(
  metodosAceptados: string[] | null | undefined,
  descuentos: PaymentDiscounts | null | undefined,
): { metodo: string; porcentaje: number } | null {
  if (!metodosAceptados?.length || !descuentos) return null;
  let mejor: { metodo: string; porcentaje: number } | null = null;
  for (const m of metodosAceptados) {
    const pct = porcentajeDe(m, descuentos);
    if (pct > 0 && (!mejor || pct > mejor.porcentaje)) mejor = { metodo: m, porcentaje: pct };
  }
  return mejor;
}

import { esMedioGestionaPay } from "@/lib/gestionaPay";

/** Cómo se llama cada medio en pantalla. */
export const NOMBRE_MEDIO: Record<string, string> = {
  gestiona_pay: "Gestiona Pay",
  mercadopago: "Gestiona Pay",
  transferencia: "transferencia",
  efectivo: "efectivo",
};

export function nombreMedio(metodo: string): string {
  if (esMedioGestionaPay(metodo)) return "Gestiona Pay";
  return NOMBRE_MEDIO[metodo] ?? metodo;
}

/**
 * Precio final de un producto pagando con un medio que tiene descuento.
 *
 * ⚠️ **Los dos descuentos NO se acumulan: se cobra el mejor, nunca la suma.**
 *
 * Espejo de `create_store_order` desde `20260806000001_descuento_no_acumula.sql`.
 * Antes el porcentaje del medio de pago se aplicaba sobre el precio de oferta,
 * así que un producto con 20% off pagado por transferencia con 20% terminaba
 * con 36% de descuento real, y el precio tachado no correspondía a nada.
 *
 * Ahora el descuento del medio se mide contra el precio de **lista**:
 *
 *   lista 38.640, oferta 30.912 (20%), transferencia 20% → 30.912
 *   lista 10.000, sin oferta,          transferencia 20% →  8.000
 *   lista 10.000, oferta 7.000 (30%),  transferencia 20% →  7.000  (gana la oferta)
 *   lista 10.000, oferta 9.000 (10%),  transferencia 20% →  8.000  (gana el medio)
 *
 * El último caso es el que obliga a que sea "el mejor" y no "sólo la oferta":
 * con "20% OFF con transferencia" publicado, cobrar el 10% de la oferta sería
 * romper esa promesa.
 */
export function precioConMedioDePago(
  precioLista: number,
  precioVigente: number,
  metodo: string | null | undefined,
  descuentos: PaymentDiscounts | null | undefined,
): number {
  const vigente = Number(precioVigente) || 0;
  const lista = Number(precioLista) || 0;
  const pct = porcentajeDe(metodo, descuentos);
  if (pct <= 0 || lista <= 0) return vigente;

  const conMedio = Math.round(lista * (100 - pct) / 100);
  return Math.min(vigente, conMedio);
}

/**
 * ¿Conviene mostrar el precio con este medio de pago?
 *
 * `false` cuando el descuento del medio no mejora lo que ya paga: anunciar
 * "20% OFF con transferencia" al lado de un precio idéntico al de arriba hace
 * dudar de los dos números.
 */
export function medioMejoraElPrecio(
  precioLista: number,
  precioVigente: number,
  metodo: string | null | undefined,
  descuentos: PaymentDiscounts | null | undefined,
): boolean {
  return precioConMedioDePago(precioLista, precioVigente, metodo, descuentos)
    < (Number(precioVigente) || 0);
}
