/**
 * Hechos del hero de la home: sin promesas genéricas tipo «pagos seguros»
 * si no hay medios, y sin inventar cobertura nacional.
 */

import { nombreMedio } from "@/lib/paymentDiscount";

/**
 * Sin catálogo no hay vitrina de conversión.
 * ESTANDAR empty-first-use / plataformas de comercio: no trust bar ni «0 productos
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
  // 2026-11-04: el aside decía «transferencia» en minúscula, porque
  // NOMBRE_MEDIO está en minúscula para usarse dentro de frases («10% OFF con
  // transferencia»). Acá el texto va solo, como valor: se capitaliza el
  // comienzo sin tocar NOMBRE_MEDIO.
  if (list.length === 1) return capitalizar(list[0]!);
  if (list.length === 2) return capitalizar(`${list[0]} o ${list[1]}`);
  return capitalizar(`${list.slice(0, -1).join(", ")} o ${list[list.length - 1]}`);
}

function capitalizar(s: string): string {
  return s ? s.charAt(0).toLocaleUpperCase("es-AR") + s.slice(1) : s;
}
