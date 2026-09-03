/**
 * Tarifario por provincia (patrón Tiendanube, no copia).
 *
 * El schema sigue siendo zona + tarifas: la cotización ya mira
 * `shipping_zones.provinces`. Lo que faltaba era la superficie: el comercio
 * tipaba zona → carrier → peso (24 formularios) y Exentry quedó con 1/6.
 * Acá el comercio ve 24 provincias y un precio; al guardar partimos la zona
 * si hace falta para no cobrarle a Santa Fe el precio de Córdoba.
 */

import { BANDA_POR_PROVINCIA, DIAS_BANDA, type ZonaParaCompletar } from "@/lib/shippingRateFill";
import { PROVINCE_NAME } from "@/lib/shippingCalc";

export const CARRIER_PROVINCIA = "propio";
export const SERVICE_PROVINCIA = "domicilio";

export interface ZonaProvincia extends ZonaParaCompletar {
  sort_order?: number;
}

export interface TarifaProvincia {
  id?: string;
  zone_id: string;
  carrier: string;
  service: string;
  min_weight_kg: number;
  max_weight_kg: number | null;
  price: number;
  is_active?: boolean;
}

export interface PrecioProvinciaVista {
  code: string;
  name: string;
  zoneId: string | null;
  zoneName: string | null;
  /** Precio vigente (mínimo de tarifas activas de la zona), o null. */
  price: number | null;
  compartida: boolean;
}

export function zonaDeProvincia(
  zones: ZonaProvincia[],
  code: string,
): ZonaProvincia | null {
  return zones.find((z) => (z.provinces ?? []).includes(code)) ?? null;
}

/** Precio que ve el comercio para esa provincia hoy. */
export function precioActualProvincia(
  zones: ZonaProvincia[],
  rates: TarifaProvincia[],
  code: string,
): number | null {
  const z = zonaDeProvincia(zones, code);
  if (!z) return null;
  const vivos = rates.filter(
    (r) => r.zone_id === z.id && r.is_active !== false && Number(r.price) > 0,
  );
  if (vivos.length === 0) return null;
  return Math.min(...vivos.map((r) => Number(r.price)));
}

export function filasProvinciaVista(
  zones: ZonaProvincia[],
  rates: TarifaProvincia[],
  provincias: { code: string; name: string }[],
): PrecioProvinciaVista[] {
  return provincias.map((p) => {
    const z = zonaDeProvincia(zones, p.code);
    return {
      code: p.code,
      name: p.name,
      zoneId: z?.id ?? null,
      zoneName: z?.name ?? null,
      price: precioActualProvincia(zones, rates, p.code),
      compartida: (z?.provinces?.length ?? 0) > 1,
    };
  });
}

export interface PlanPrecioProvincia {
  /** Quitar la provincia de una zona compartida. */
  quitarDeZona: { zoneId: string; provinces: string[] } | null;
  /** Zona nueva de una sola provincia (si había que partir). */
  zonaNueva: { name: string; provinces: string[]; sort_order: number } | null;
  /** zone_id conocido o null → usar el id de la zona recién creada. */
  rate: {
    zoneIdExistente: string | null;
    price: number;
    delivery_days_min: number;
    delivery_days_max: number;
    rateIdToUpdate: string | null;
  };
}

/**
 * Plan para fijar el precio de UNA provincia.
 * No inventa montos: el precio lo tipeó el comercio. price <= 0 = no plan.
 */
export function planificarPrecioProvincia(opts: {
  zones: ZonaProvincia[];
  rates: TarifaProvincia[];
  code: string;
  price: number;
  nextSortOrder: number;
}): PlanPrecioProvincia | null {
  const price = Number(opts.price);
  if (!(price > 0) || !Number.isFinite(price)) return null;

  const z = zonaDeProvincia(opts.zones, opts.code);
  if (!z) return null;

  const banda = BANDA_POR_PROVINCIA[opts.code] ?? 3;
  const [dmin, dmax] = DIAS_BANDA[banda] ?? [3, 7];
  const nombre = PROVINCE_NAME[opts.code] || opts.code;

  const ratePropio = opts.rates.find(
    (r) =>
      r.zone_id === z.id
      && r.carrier === CARRIER_PROVINCIA
      && r.service === SERVICE_PROVINCIA
      && Number(r.min_weight_kg) === 0
      && (r.max_weight_kg == null || r.max_weight_kg === null),
  );

  // Zona de una sola provincia: actualizar o crear tarifa ahí.
  if ((z.provinces ?? []).length <= 1) {
    return {
      quitarDeZona: null,
      zonaNueva: null,
      rate: {
        zoneIdExistente: z.id,
        price,
        delivery_days_min: dmin,
        delivery_days_max: dmax,
        rateIdToUpdate: ratePropio?.id ?? null,
      },
    };
  }

  // Zona compartida: partir para no aplicar el precio a hermanas.
  const restantes = (z.provinces ?? []).filter((p) => p !== opts.code);
  return {
    quitarDeZona: { zoneId: z.id, provinces: restantes },
    zonaNueva: {
      name: nombre,
      provinces: [opts.code],
      sort_order: opts.nextSortOrder,
    },
    rate: {
      zoneIdExistente: null,
      price,
      delivery_days_min: dmin,
      delivery_days_max: dmax,
      rateIdToUpdate: null,
    },
  };
}

/** Texto corto para el panel: no inventa cobertura. */
export function resumenCoberturaProvincias(
  filas: PrecioProvinciaVista[],
): { conPrecio: number; sinPrecio: number } {
  const conPrecio = filas.filter((f) => f.price != null && f.price > 0).length;
  return { conPrecio, sinPrecio: filas.length - conPrecio };
}
