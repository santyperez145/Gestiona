/**
 * Preventa en la tienda (2026-10-30, migración 20261030001900).
 *
 * Un producto sin variantes se vende sin stock hasta un cupo y llega en una
 * fecha; con stock se vende primero lo que hay. La base decide
 * (`resolve_store_line`, `get_store_preventas`); esto es el espejo para la
 * pantalla: cuánto se puede comprar, cuántas unidades son de preventa y cómo
 * se le dice al comprador.
 */
import { fechaLocal } from "@/lib/fechaAR";

export interface Preventa {
  /** Cuándo llega la mercadería, AAAA-MM-DD. */
  llega: string;
  /** Unidades que se pueden comprar ahora: el stock más lo que queda del cupo. */
  vendible: number;
}

/** Lo que guarda una línea del carrito para decir qué parte es de preventa. */
export interface PreventaDeLinea {
  llega: string;
  /** Unidades en stock cuando se agregó: las demás son de preventa. */
  enStock: number;
}

const entero = (n: unknown) => Math.max(0, Number(n) || 0);

/** Lo máximo que se puede comprar: con preventa vigente, lo vendible. */
export function topeDeCompra(stock: number, preventa?: Preventa | null): number {
  return preventa ? entero(preventa.vendible) : entero(stock);
}

/** Si el producto se puede comprar ahora en preventa. */
export function enPreventa(preventa?: Preventa | null): preventa is Preventa {
  return Boolean(preventa && entero(preventa.vendible) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(preventa.llega));
}

/** Cuántas de `cantidad` unidades son de preventa: las que superan el stock. */
export function unidadesEnPreventa(cantidad: number, stock: number): number {
  return Math.max(0, entero(cantidad) - entero(stock));
}

/** «20/11», el día de llegada como lo lee el comprador. */
export function fechaDeLlegada(llega: string): string {
  return fechaLocal(llega).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });
}

/** Lo que se le dice al comprador de la parte en preventa de una compra. */
export function textoPreventa(cantidad: number, llega: string): string {
  const fecha = fechaDeLlegada(llega);
  if (cantidad <= 0) return `Preventa: llega aprox. el ${fecha}.`;
  const una = cantidad === 1;
  return `${cantidad} ${una ? "unidad es" : "unidades son"} de preventa: se despacha${una ? "" : "n"} cuando llegue la mercadería (aprox. el ${fecha}).`;
}
