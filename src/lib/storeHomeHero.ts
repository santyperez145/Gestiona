/**
 * Hechos del hero de la home: sin promesas genéricas tipo «pagos seguros»
 * si no hay medios, y sin inventar cobertura nacional.
 */

import { nombreMedio } from "@/lib/paymentDiscount";

/**
 * Sin catálogo no hay vitrina de conversión.
 * ESTANDAR empty-first-use / Shopify-Tiendanube: no trust bar ni «0 productos
 * disponibles» encima del vacío real.
 */
export function storeHomeShowsCommerceChrome(catalogCount: number): boolean {
  return Number(catalogCount) > 0;
}

/** Rótulo honesto de medios aceptados para el aside del hero. */
export function textoMediosHero(methods: string[] | null | undefined): string {
  const list = Array.from(
    new Set(
      (Array.isArray(methods) ? methods : [])
        .map((m) => String(m ?? "").trim())
        .filter(Boolean)
        .map((m) => nombreMedio(m)),
    ),
  ).filter(Boolean);

  if (list.length === 0) return "Elegí el medio en el checkout";
  if (list.length === 1) return list[0]!;
  if (list.length === 2) return `${list[0]} o ${list[1]}`;
  return `${list.slice(0, -1).join(", ")} o ${list[list.length - 1]}`;
}
