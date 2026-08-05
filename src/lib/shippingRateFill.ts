/**
 * Completar el tarifario de envíos de una sola vez.
 *
 * Esto no es una comodidad: es lo que más plata cuesta hoy. Hay 6 zonas
 * activas y tarifas cargadas en **una sola** —CABA—, así que un comprador de
 * cualquier otra provincia recibe "No hay envío disponible" en el checkout y
 * se va. Cargarlas a mano son 6 zonas × 2 servicios × 2 rangos de peso = 24
 * formularios de ocho campos cada uno, y por eso hace meses que no se hace.
 *
 * La idea es tomar **una** tarifa de referencia —la de CABA, que ya está— y
 * derivar el resto por distancia. No pretende ser el precio exacto del correo:
 * pretende que la tienda pueda vender mañana con un número razonable, que se
 * corrige después zona por zona. Un precio aproximado vende; "No hay envío
 * disponible" no vende nunca.
 *
 * Los multiplicadores salen de la banda de distancia de cada provincia, no del
 * nombre de la zona: una zona se llama como el comercio quiera, pero las
 * provincias que contiene son un dato. Así funciona igual con las zonas por
 * defecto y con las que arme cualquiera.
 */

/**
 * Banda de distancia desde Buenos Aires, que es de donde despacha la tienda.
 * 0 = CABA, 4 = Patagonia profunda. Es el criterio con el que los correos
 * arman sus propias tablas.
 */
export const BANDA_POR_PROVINCIA: Record<string, number> = {
  "AR-C": 0,                                    // CABA
  "AR-B": 1,                                    // Buenos Aires
  "AR-E": 2, "AR-S": 2, "AR-X": 2, "AR-L": 2,   // litoral y centro
  "AR-D": 2,
  "AR-M": 3, "AR-J": 3, "AR-F": 3, "AR-K": 3,   // Cuyo y NOA
  "AR-T": 3, "AR-G": 3, "AR-A": 3, "AR-Y": 3,
  "AR-H": 3, "AR-W": 3, "AR-N": 3, "AR-P": 3,   // NEA
  "AR-Q": 3, "AR-R": 3,                         // norte patagónico
  "AR-U": 4, "AR-Z": 4, "AR-V": 4,              // Chubut, Santa Cruz, TdF
};

/** Cuánto más caro que la zona base es cada banda. */
export const MULTIPLICADOR_BANDA: Record<number, number> = {
  0: 1, 1: 1.15, 2: 1.4, 3: 1.65, 4: 2.1,
};

/** Días de entrega estimados por banda, mínimo y máximo. */
export const DIAS_BANDA: Record<number, [number, number]> = {
  0: [1, 2], 1: [2, 4], 2: [3, 6], 3: [4, 8], 4: [6, 12],
};

export interface ZonaParaCompletar {
  id: string;
  name: string;
  provinces: string[];
}

export interface TarifaBase {
  carrier: string;
  service: string;
  min_weight_kg: number;
  max_weight_kg: number | null;
  price: number;
  price_per_extra_kg: number;
  free_above: number | null;
}

export interface FilaGenerada {
  zone_id: string;
  zone_name: string;
  carrier: string;
  service: string;
  min_weight_kg: number;
  max_weight_kg: number | null;
  price: number;
  price_per_extra_kg: number;
  delivery_days_min: number;
  delivery_days_max: number;
  free_above: number | null;
  /** Para mostrar en la vista previa: de dónde salió el número. */
  multiplicador: number;
  banda: number;
}

/**
 * Banda de una zona: la **más lejana** de sus provincias, no el promedio.
 * Cotizar Tierra del Fuego al precio promedio de una zona que también tiene
 * Neuquén es vender a pérdida en el envío más caro, y ese error se paga con
 * plata real en cada despacho.
 */
export function bandaDeZona(provincias: string[]): number {
  const bandas = provincias
    .map(p => BANDA_POR_PROVINCIA[p])
    .filter(b => b !== undefined);
  // Una zona sin provincias conocidas no se puede estimar; se la trata como la
  // más cara para no perder plata por omisión.
  if (bandas.length === 0) return 4;
  return Math.max(...bandas);
}

/** Redondea a múltiplos de 100: un envío de $8.437 no lo cobra nadie. */
export function redondearPrecio(n: number): number {
  return Math.max(0, Math.round(n / 100) * 100);
}

export interface OpcionesCompletar {
  /** Zonas que ya tienen tarifa: se saltean, nunca se pisan. */
  zonasConTarifa?: Set<string>;
  /** Si es false, incluye también las que ya tienen (para recotizar). */
  saltearConTarifa?: boolean;
}

/**
 * Genera las filas del tarifario a partir de una tarifa de referencia.
 *
 * No escribe nada: devuelve exactamente lo que se va a insertar para poder
 * mostrarlo antes. Un botón que crea 20 filas sin decir cuáles no se usa dos
 * veces.
 */
export function completarTarifario(
  zonas: ZonaParaCompletar[],
  base: TarifaBase,
  opciones: OpcionesCompletar = {},
): FilaGenerada[] {
  const { zonasConTarifa = new Set<string>(), saltearConTarifa = true } = opciones;

  return zonas
    .filter(z => !(saltearConTarifa && zonasConTarifa.has(z.id)))
    .map(z => {
      const banda = bandaDeZona(z.provinces ?? []);
      const mult = MULTIPLICADOR_BANDA[banda] ?? 1;
      const [dmin, dmax] = DIAS_BANDA[banda] ?? [3, 7];
      return {
        zone_id: z.id,
        zone_name: z.name,
        carrier: base.carrier,
        service: base.service,
        min_weight_kg: base.min_weight_kg,
        max_weight_kg: base.max_weight_kg,
        price: redondearPrecio(base.price * mult),
        // El kilo extra también se encarece con la distancia: es el mismo
        // camión el que lo lleva.
        price_per_extra_kg: redondearPrecio(base.price_per_extra_kg * mult),
        delivery_days_min: dmin,
        delivery_days_max: dmax,
        // El envío gratis es una decisión comercial de la tienda, no algo que
        // dependa de la distancia: se copia igual a todas.
        free_above: base.free_above,
        multiplicador: mult,
        banda,
      };
    });
}

/**
 * Provincias que hoy no puede comprar nadie: no están en ninguna zona, o su
 * zona no tiene tarifa. Es la lista que responde "¿a quién no le puedo vender?"
 * sin tener que abrir el checkout provincia por provincia.
 */
export function provinciasSinCobertura(
  zonas: ZonaParaCompletar[],
  zonasConTarifa: Set<string>,
  todasLasProvincias: string[],
): string[] {
  const cubiertas = new Set<string>();
  for (const z of zonas) {
    if (!zonasConTarifa.has(z.id)) continue;
    for (const p of z.provinces ?? []) cubiertas.add(p);
  }
  return todasLasProvincias.filter(p => !cubiertas.has(p));
}
