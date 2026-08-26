// Tipo de cambio y costo unitario en pesos — **espejo de `costo_unitario_ars`**
// (`supabase/migrations/20260826000060_costo_en_pesos.sql`). Si se toca una, se
// toca la otra.
//
// ── Por qué existe este archivo ────────────────────────────────────────────
//
// Había **22 lugares** en `src/` que hacían `Number(settings?.exchange_rate) ||
// 1695`. Ese 1695 era el dólar de algún día de 2026, escrito a mano cuando esto
// era la app de un solo negocio importador.
//
// ⚠️ El problema no es que el número esté viejo: es que **se inventa**. Un
// comercio sin cotización cargada veía costos, márgenes y precios sugeridos
// calculados contra una cotización que nunca eligió, sin ninguna señal de que
// el número no era suyo. Y desde que `settings.exchange_rate` dejó de tener
// DEFAULT (20260826000030), una organización nueva nace con NULL — así que el
// fallback pasó de casi nunca dispararse a dispararse siempre.
//
// Es el mismo error que `industry_code DEFAULT 'perfumes'`: un resto de la app
// de un solo negocio que etiqueta en silencio a todo comercio nuevo.
//
// La regla es la de la base: **sin cotización el costo no es cero ni 1695, es
// desconocido**. Un margen calculado sobre un costo inventado sale perfecto y
// falso, que es peor que no tener el dato.

export type Moneda = 'ARS' | 'USD';

export interface CostoDeProducto {
  /** `products.total_cost_usd` o `cost_usd`. */
  costUsd?: number | null;
  /** `products.cost_ars` — lo que se pagó en pesos, sin pasar por el dólar. */
  costArs?: number | null;
  /** `products.cost_currency`. NULL = se deduce de dónde está el número. */
  costCurrency?: string | null;
}

export interface CostoResuelto {
  /** `null` significa **desconocido**, nunca cero. */
  costoArs: number | null;
  moneda: Moneda;
  costoUsd?: number;
  tipoCambio: number | null;
  fuente: string;
  /** Presente sólo cuando no se pudo resolver. */
  motivo?: string;
}

/** Lo que se muestra donde iría un importe que no se puede calcular. */
export const SIN_COTIZACION = 'Sin cotización';

/**
 * La cotización configurada por el comercio, o `null`.
 *
 * ⚠️ Nunca devuelve un número inventado. Un `0`, un `NaN` o un negativo son
 * "no hay cotización", no una cotización de cero: convertir con cero haría que
 * todo costo en dólares valga $0 y que el margen dé 100%.
 */
export function cotizacionDe(
  settings: { exchange_rate?: number | string | null } | null | undefined,
): number | null {
  const crudo = settings?.exchange_rate;
  if (crudo === null || crudo === undefined || crudo === '') return null;
  const n = Number(crudo);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** `true` si el comercio todavía no cargó una cotización utilizable. */
export function faltaCotizacion(
  settings: { exchange_rate?: number | string | null } | null | undefined,
): boolean {
  return cotizacionDe(settings) === null;
}

/**
 * El costo unitario en pesos. Espejo de `costo_unitario_ars` en SQL.
 *
 * La moneda declarada manda; si no hay ninguna declarada se deduce de dónde
 * está el número, y **no se adivina**: si hay costo en pesos, es en pesos.
 */
export function costoUnitarioArs(
  producto: CostoDeProducto,
  cotizacion: number | null,
): CostoResuelto {
  const costArs = Number(producto.costArs) || 0;
  const declarada = producto.costCurrency === 'ARS' || producto.costCurrency === 'USD'
    ? (producto.costCurrency as Moneda)
    : null;
  const moneda: Moneda = declarada ?? (costArs > 0 ? 'ARS' : 'USD');

  if (moneda === 'ARS') {
    // ⚠️ Sin tipo de cambio de por medio. Ése es todo el punto: el costo en
    // pesos de quien compra en pesos no cambia porque se movió el dólar.
    return {
      costoArs: redondear(costArs),
      moneda: 'ARS',
      tipoCambio: null,
      fuente: 'costo en pesos del producto',
    };
  }

  const costoUsd = Number(producto.costUsd) || 0;

  if (cotizacion === null && costoUsd > 0) {
    return {
      costoArs: null,
      moneda: 'USD',
      costoUsd,
      tipoCambio: null,
      fuente: 'costo en dólares sin cotización cargada',
      motivo: 'falta el tipo de cambio para convertir el costo',
    };
  }

  return {
    costoArs: redondear(costoUsd * (cotizacion ?? 0)),
    moneda: 'USD',
    costoUsd,
    tipoCambio: cotizacion,
    fuente: 'costo en dólares convertido a la cotización vigente',
  };
}

/**
 * Atajo para ordenar y comparar: el costo en pesos, o `null` si no se sabe.
 *
 * ⚠️ Los llamadores tienen que decidir qué hacen con `null`. Convertirlo a 0
 * acá sería reintroducir el bug con otro disfraz: un producto sin costo
 * conocido quedaría primero en "más rentable".
 */
export function costoArsONull(
  producto: CostoDeProducto,
  cotizacion: number | null,
): number | null {
  return costoUnitarioArs(producto, cotizacion).costoArs;
}

// El dinero se redondea en un solo lugar (`rounding.ts`); acá sólo se replica el
// medio-arriba en valor absoluto que usa `redondear_moneda` para ARS.
function redondear(n: number): number {
  const signo = n < 0 ? -1 : 1;
  return signo * Math.round(Math.abs(n) * 100) / 100;
}

/**
 * La cotización a la que se calcularon los precios en pesos del catálogo de
 * ejemplo (`seedData.ts`).
 *
 * ⚠️ **No es una cotización vigente y no se usa para calcular nada del
 * comercio.** Está acá, con nombre, porque los precios en pesos de ese
 * catálogo se derivaron de ella y cambiarla los volvería incoherentes. Es lo
 * contrario de un fallback: un dato histórico congelado, en un solo lugar.
 */
export const COTIZACION_CATALOGO_SEMILLA = 1695;
