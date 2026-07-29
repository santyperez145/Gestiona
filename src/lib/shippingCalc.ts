/**
 * Cotización de envíos — lógica pura, sin red ni base de datos.
 *
 * Se usa en tres lugares que tienen que dar el mismo número: el checkout de la
 * tienda online, la Edge Function `shipping-quote` (cuando el transportista no
 * cotiza por API) y el panel de configuración cuando el comercio previsualiza
 * sus tarifas. Por eso vive acá y está testeado: es plata del cliente.
 */

// ── Provincias de Argentina (ISO 3166-2:AR) ─────────────────────────────────

export interface Province {
  /** Código ISO, p. ej. 'AR-C' */
  code: string;
  name: string;
}

export const AR_PROVINCES: Province[] = [
  { code: 'AR-C', name: 'Ciudad Autónoma de Buenos Aires' },
  { code: 'AR-B', name: 'Buenos Aires' },
  { code: 'AR-K', name: 'Catamarca' },
  { code: 'AR-H', name: 'Chaco' },
  { code: 'AR-U', name: 'Chubut' },
  { code: 'AR-X', name: 'Córdoba' },
  { code: 'AR-W', name: 'Corrientes' },
  { code: 'AR-E', name: 'Entre Ríos' },
  { code: 'AR-P', name: 'Formosa' },
  { code: 'AR-Y', name: 'Jujuy' },
  { code: 'AR-L', name: 'La Pampa' },
  { code: 'AR-F', name: 'La Rioja' },
  { code: 'AR-M', name: 'Mendoza' },
  { code: 'AR-N', name: 'Misiones' },
  { code: 'AR-Q', name: 'Neuquén' },
  { code: 'AR-R', name: 'Río Negro' },
  { code: 'AR-A', name: 'Salta' },
  { code: 'AR-J', name: 'San Juan' },
  { code: 'AR-D', name: 'San Luis' },
  { code: 'AR-Z', name: 'Santa Cruz' },
  { code: 'AR-S', name: 'Santa Fe' },
  { code: 'AR-G', name: 'Santiago del Estero' },
  { code: 'AR-V', name: 'Tierra del Fuego' },
  { code: 'AR-T', name: 'Tucumán' },
];

export const PROVINCE_NAME: Record<string, string> = Object.fromEntries(
  AR_PROVINCES.map(p => [p.code, p.name]),
);

// ── Tipos del dominio ───────────────────────────────────────────────────────

export type CarrierCode = 'correo_argentino' | 'andreani' | 'oca' | 'propio' | 'retiro';
export type ServiceCode = 'domicilio' | 'sucursal' | 'express' | 'prioritario';

export const CARRIER_LABEL: Record<CarrierCode, string> = {
  correo_argentino: 'Correo Argentino',
  andreani: 'Andreani',
  oca: 'OCA',
  propio: 'Envío propio',
  retiro: 'Retiro en tienda',
};

export const SERVICE_LABEL: Record<ServiceCode, string> = {
  domicilio: 'A domicilio',
  sucursal: 'Retiro en sucursal',
  express: 'Express',
  prioritario: 'Prioritario',
};

export interface ShippingZone {
  id: string;
  name: string;
  provinces: string[];
  is_active?: boolean;
}

export interface ShippingRate {
  id: string;
  zone_id: string;
  carrier: CarrierCode;
  service: ServiceCode;
  min_weight_kg: number;
  /** null = tramo sin techo */
  max_weight_kg: number | null;
  price: number;
  price_per_extra_kg?: number;
  delivery_days_min?: number | null;
  delivery_days_max?: number | null;
  /** Envío gratis en esta zona desde este subtotal; pisa el de la tienda */
  free_above?: number | null;
  is_active?: boolean;
}

export interface CarrierConfig {
  carrier: CarrierCode;
  is_enabled?: boolean;
  mode?: 'table' | 'api';
  markup_pct?: number;
  markup_fixed?: number;
}

export interface StoreShippingConfig {
  shipping_mode: 'flat' | 'zones' | 'free';
  /** Precio plano, usado cuando shipping_mode = 'flat' */
  shipping_cost?: number;
  free_shipping_above?: number | null;
  pickup_enabled?: boolean;
  pickup_address?: string | null;
  default_item_weight_kg?: number;
}

export interface QuoteItem {
  qty: number;
  weight_kg?: number | null;
}

export interface ShippingOption {
  /** Identificador estable para que el checkout recuerde la elección */
  id: string;
  carrier: CarrierCode;
  service: ServiceCode;
  label: string;
  price: number;
  isFree: boolean;
  /** Por qué salió gratis, para poder mostrarlo en el checkout */
  freeReason?: 'threshold' | 'store_policy' | 'pickup';
  deliveryDaysMin: number | null;
  deliveryDaysMax: number | null;
  zoneId: string | null;
}

export interface ShippingQuote {
  options: ShippingOption[];
  zone: ShippingZone | null;
  /** Poblado cuando no hay ninguna opción: el checkout tiene que explicar por qué */
  unavailableReason: string | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Redondeo a 2 decimales sin arrastrar error de punto flotante. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Peso total del carrito. Un producto sin peso declarado usa el default de la
 * tienda — preferimos cotizar con una estimación que no cotizar nada.
 */
export function cartWeightKg(items: QuoteItem[], defaultItemWeightKg = 0.5): number {
  const total = items.reduce((sum, it) => {
    const w = it.weight_kg == null || it.weight_kg <= 0 ? defaultItemWeightKg : it.weight_kg;
    return sum + w * Math.max(0, it.qty);
  }, 0);
  return Math.round(total * 1000) / 1000;
}

/** Primera zona activa que cubre la provincia. */
export function resolveZone(provinceCode: string, zones: ShippingZone[]): ShippingZone | null {
  return zones.find(z => z.is_active !== false && z.provinces.includes(provinceCode)) || null;
}

/**
 * Tramo de peso aplicable dentro de un conjunto de tarifas del mismo
 * (zona, transportista, servicio).
 *
 * Los tramos son `[min, max)`. Si el peso supera todos los techos se usa el
 * tramo más alto y el excedente se cobra con `price_per_extra_kg` — así es como
 * cobran los correos, por kg o fracción.
 */
export function pickRateBracket(rates: ShippingRate[], weightKg: number): ShippingRate | null {
  const active = rates.filter(r => r.is_active !== false);
  if (active.length === 0) return null;

  const exact = active.find(r =>
    weightKg >= r.min_weight_kg &&
    (r.max_weight_kg == null || weightKg < r.max_weight_kg));
  if (exact) return exact;

  // Por encima de todos los techos: el tramo más pesado
  return active.reduce((best, r) =>
    (r.max_weight_kg ?? Infinity) > (best.max_weight_kg ?? Infinity) ? r : best, active[0]);
}

/** Precio de un tramo para un peso dado, incluyendo kilos excedentes. */
export function priceForWeight(rate: ShippingRate, weightKg: number): number {
  const ceiling = rate.max_weight_kg;
  if (ceiling == null || weightKg <= ceiling) return round2(rate.price);
  const extraKg = Math.ceil(weightKg - ceiling);
  return round2(rate.price + extraKg * (rate.price_per_extra_kg || 0));
}

/** Markup del comercio sobre la tarifa del correo (packaging, manipuleo). */
export function applyMarkup(price: number, carrier?: CarrierConfig): number {
  if (!carrier) return round2(price);
  const pct = carrier.markup_pct || 0;
  const fixed = carrier.markup_fixed || 0;
  return round2(price * (1 + pct / 100) + fixed);
}

// ── Cotizador ───────────────────────────────────────────────────────────────

export interface QuoteInput {
  /** Subtotal de productos, para evaluar el umbral de envío gratis */
  subtotal: number;
  items: QuoteItem[];
  provinceCode: string;
  store: StoreShippingConfig;
  zones?: ShippingZone[];
  rates?: ShippingRate[];
  carriers?: CarrierConfig[];
}

/**
 * Devuelve las opciones de envío que el comprador puede elegir, ordenadas de
 * más barata a más cara (el retiro en tienda va siempre primero porque es
 * gratis y es lo que más conviene a ambos lados).
 */
export function quoteShipping(input: QuoteInput): ShippingQuote {
  const { subtotal, items, provinceCode, store } = input;
  const zones = input.zones || [];
  const rates = input.rates || [];
  const carriers = input.carriers || [];

  const options: ShippingOption[] = [];

  // Retiro en tienda: no depende de zona ni de peso
  if (store.pickup_enabled) {
    options.push({
      id: 'retiro',
      carrier: 'retiro',
      service: 'sucursal',
      label: 'Retiro en tienda',
      price: 0,
      isFree: true,
      freeReason: 'pickup',
      deliveryDaysMin: 0,
      deliveryDaysMax: 0,
      zoneId: null,
    });
  }

  // Envío gratis como política de la tienda
  if (store.shipping_mode === 'free') {
    options.push({
      id: 'gratis',
      carrier: 'propio',
      service: 'domicilio',
      label: 'Envío gratis',
      price: 0,
      isFree: true,
      freeReason: 'store_policy',
      deliveryDaysMin: null,
      deliveryDaysMax: null,
      zoneId: null,
    });
    return { options, zone: null, unavailableReason: null };
  }

  // Precio plano
  if (store.shipping_mode === 'flat') {
    const threshold = store.free_shipping_above;
    const free = threshold != null && threshold > 0 && subtotal >= threshold;
    options.push({
      id: 'flat',
      carrier: 'propio',
      service: 'domicilio',
      label: 'Envío a domicilio',
      price: free ? 0 : round2(store.shipping_cost || 0),
      isFree: free,
      freeReason: free ? 'threshold' : undefined,
      deliveryDaysMin: null,
      deliveryDaysMax: null,
      zoneId: null,
    });
    return { options, zone: null, unavailableReason: null };
  }

  // Por zonas
  const zone = resolveZone(provinceCode, zones);
  if (!zone) {
    return {
      options,
      zone: null,
      unavailableReason: options.length > 0
        ? 'No hacemos envíos a esa provincia, pero podés retirar en la tienda.'
        : 'Todavía no hacemos envíos a esa provincia.',
    };
  }

  const weightKg = cartWeightKg(items, store.default_item_weight_kg ?? 0.5);
  const carrierByCode = new Map(carriers.map(c => [c.carrier, c]));
  const zoneRates = rates.filter(r => r.zone_id === zone.id && r.is_active !== false);

  // Un grupo por (transportista, servicio): cada uno es una opción para el comprador
  const groups = new Map<string, ShippingRate[]>();
  for (const r of zoneRates) {
    const cfg = carrierByCode.get(r.carrier);
    // Si el transportista está configurado y deshabilitado, no se ofrece.
    // Si no está configurado, se ofrece igual: el tarifario alcanza.
    if (cfg && cfg.is_enabled === false) continue;
    const key = `${r.carrier}:${r.service}`;
    const list = groups.get(key);
    if (list) list.push(r); else groups.set(key, [r]);
  }

  for (const [key, groupRates] of groups) {
    const rate = pickRateBracket(groupRates, weightKg);
    if (!rate) continue;

    const cfg = carrierByCode.get(rate.carrier);
    const base = priceForWeight(rate, weightKg);
    const withMarkup = applyMarkup(base, cfg);

    const threshold = rate.free_above ?? store.free_shipping_above ?? null;
    const free = threshold != null && threshold > 0 && subtotal >= threshold;

    options.push({
      id: key,
      carrier: rate.carrier,
      service: rate.service,
      label: `${CARRIER_LABEL[rate.carrier]} · ${SERVICE_LABEL[rate.service]}`,
      price: free ? 0 : withMarkup,
      isFree: free,
      freeReason: free ? 'threshold' : undefined,
      deliveryDaysMin: rate.delivery_days_min ?? null,
      deliveryDaysMax: rate.delivery_days_max ?? null,
      zoneId: zone.id,
    });
  }

  const shipped = options.filter(o => o.carrier !== 'retiro');
  if (shipped.length === 0) {
    return {
      options,
      zone,
      unavailableReason: options.length > 0
        ? `Todavía no cargamos tarifas para ${zone.name}, pero podés retirar en la tienda.`
        : `Todavía no cargamos tarifas para ${zone.name}.`,
    };
  }

  // Retiro primero, después de más barato a más caro
  options.sort((a, b) => {
    if (a.carrier === 'retiro') return -1;
    if (b.carrier === 'retiro') return 1;
    return a.price - b.price;
  });

  return { options, zone, unavailableReason: null };
}

/**
 * Cuánto le falta al carrito para llegar al envío gratis. Devuelve null si no
 * hay umbral o si ya llegó — sirve para el clásico "te faltan $X para envío
 * gratis", que sube el ticket promedio.
 */
export function amountToFreeShipping(
  subtotal: number,
  store: StoreShippingConfig,
  zoneRates: ShippingRate[] = [],
): number | null {
  const rateThreshold = zoneRates
    .map(r => r.free_above)
    .filter((v): v is number => v != null && v > 0)
    .sort((a, b) => a - b)[0];
  const threshold = rateThreshold ?? store.free_shipping_above ?? null;
  if (threshold == null || threshold <= 0) return null;
  const missing = threshold - subtotal;
  return missing > 0 ? round2(missing) : null;
}
