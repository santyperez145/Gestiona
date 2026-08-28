/**
 * «1 producto», «3 productos».
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * ⚠️ Medido en producción el 2026-08-28 recorriendo el panel con la sesión
 * real: el Dashboard decía **«1 productos con margen < 30%»** y Gastos, **«1
 * gastos»** debajo del total del período. En la tienda pública ya se habían
 * corregido tres iguales, entre ellos «¡Últimas 1 unidades!» — el cartel que
 * más empuja a comprar.
 *
 * Un barrido del panel encontró **49 lugares** con el mismo patrón. A esa
 * escala el ternario inline que usan otros archivos deja de ser lo correcto:
 * son 49 oportunidades de olvidarse.
 *
 * ── El plural se pasa, no se adivina ──────────────────────────────────────
 *
 * 📌 En castellano no alcanza con agregar «s»: es *categoría → categorías*
 * pero *orden → órdenes*, *mes → meses*, *día → días*. Adivinarlo produce
 * «ordens» y «mess», que es peor que el bug original.
 *
 * Por eso el plural es un argumento. Cuando es el caso regular —agregar «s»—
 * se puede omitir, que cubre la mayoría sin abrir la puerta a inventar formas.
 */

/**
 * Devuelve `«n sustantivo»` con el número adelante.
 *
 *     plural(1, "producto")            // «1 producto»
 *     plural(3, "producto")            // «3 productos»
 *     plural(1, "orden", "órdenes")    // «1 orden»
 *     plural(0, "gasto")               // «0 gastos»
 *
 * ⚠️ El cero va en plural, que es lo correcto en castellano: «0 productos».
 */
export function plural(n: number, singular: string, formaPlural?: string): string {
  return `${n} ${palabra(n, singular, formaPlural)}`;
}

/**
 * Sólo la palabra, sin el número. Sirve cuando el número se muestra aparte —
 * por ejemplo una tarjeta de KPI con el valor grande arriba y la etiqueta
 * debajo.
 *
 *     palabra(1, "venta")   // «venta»
 *     palabra(9, "venta")   // «ventas»
 */
export function palabra(n: number, singular: string, formaPlural?: string): string {
  return Math.abs(n) === 1 ? singular : (formaPlural ?? `${singular}s`);
}
