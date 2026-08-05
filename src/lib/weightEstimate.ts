/**
 * Peso estimado de un producto, para dejar de cobrar el envío de menos.
 *
 * El problema medido: 59 de 60 productos activos tienen el peso en cero, así
 * que `quote_store_shipping` cotiza todo con `default_item_weight_kg` (0,5 kg)
 * y `prepare_order_shipment` declara ese mismo 0,5 en la etiqueta.
 *
 * ⚠️ **La dirección del error es la contraria de la que parece.** Se verificó
 * contra la base: los 55 perfumes del catálogo estiman **0,40 kg**, y ninguno
 * pasa de 0,5. O sea que hoy la tienda **cotiza de más**, no de menos: un
 * carrito de cinco unidades se cobra como 2,5 kg cuando pesa 2,0. Eso no le
 * cuesta margen al comercio — le cuesta ventas, porque el envío caro es de las
 * primeras razones por las que se abandona un carrito. Y en la etiqueta, un
 * peso declarado que no es el real es lo que después el correo redetermina.
 *
 * (En el catálogo de hoy el efecto sobre el precio queda además tapado por el
 * envío gratis desde $150.000, que se alcanza a las 3 unidades. Empieza a
 * verse en cuanto haya tarifas con kg extra en el resto de las zonas.)
 *
 * Lo que sí tienen los 60 es `content_ml`. De ahí sale la estimación.
 *
 * ⚠️ **Es una estimación, no una balanza.** Sirve para que la cotización deje
 * de ser 0,5 kg para todo; el número exacto se corrige pesando una caja. Por
 * eso se redondea a 50 g: fingir precisión de gramos sobre un modelo sería
 * mentir con más decimales.
 *
 * El modelo sale de pesar el producto real: frasco de vidrio + tapa + caja.
 * Un perfume de 100 ml da ~0,40 kg; uno de 50, ~0,24; uno de 30, ~0,18.
 */

export type CategoriaPeso = "perfume_arabe" | "perfume_diseñador" | "vaper" | "electronico" | string;

interface ModeloPeso {
  /** Caja, tapa y embalaje: no depende del contenido. */
  base: number;
  /** Kg por ml de contenido: incluye el líquido y el vidrio que lo sostiene. */
  porMl: number;
}

export const MODELOS: Record<string, ModeloPeso> = {
  // Frasco de vidrio grueso: el envase pesa más que el líquido.
  perfume_arabe:     { base: 0.08, porMl: 0.0032 },
  "perfume_diseñador": { base: 0.08, porMl: 0.0032 },
  // Plástico y batería: casi todo el peso es fijo y el líquido casi no suma.
  vaper:             { base: 0.05, porMl: 0.0006 },
};

/** Redondeo a 50 g: el modelo no da para más precisión que eso. */
export function redondearPeso(kg: number): number {
  return Math.round(kg * 20) / 20;
}

/**
 * Devuelve el peso estimado en kg, o `null` si no hay con qué estimarlo.
 *
 * `null` no es un error: es la respuesta honesta para una categoría sin modelo
 * o un producto sin contenido cargado. Inventar un número ahí sería volver al
 * problema de origen —un peso que nadie verificó— con otra cara.
 */
export function pesoEstimadoKg(
  categoria: CategoriaPeso | null | undefined,
  contentMl: number | null | undefined,
): number | null {
  const modelo = MODELOS[String(categoria ?? "")];
  if (!modelo) return null;

  const ml = Number(contentMl);
  if (!Number.isFinite(ml) || ml <= 0) return null;

  return redondearPeso(modelo.base + ml * modelo.porMl);
}

export interface ProductoParaPesar {
  id: string;
  name?: string | null;
  category?: string | null;
  content_ml?: number | null;
  weight_kg?: number | null;
}

export interface PesoPropuesto {
  id: string;
  name: string;
  actual: number;
  estimado: number;
}

export interface PlanDePesos {
  /** Los que se van a actualizar. */
  aplicar: PesoPropuesto[];
  /** Los que quedan afuera y por qué — se muestran, no se esconden. */
  sinModelo: ProductoParaPesar[];
  yaTenian: ProductoParaPesar[];
}

/**
 * Arma el plan sin escribir nada, para poder mostrarlo antes de aplicarlo.
 *
 * Por defecto **no pisa** un peso ya cargado: si alguien lo puso a mano, lo
 * puso pesando la caja y vale más que cualquier estimación.
 */
export function planDePesos(
  productos: ProductoParaPesar[],
  opciones: { pisarExistentes?: boolean } = {},
): PlanDePesos {
  const { pisarExistentes = false } = opciones;
  const plan: PlanDePesos = { aplicar: [], sinModelo: [], yaTenian: [] };

  for (const p of productos) {
    const actual = Number(p.weight_kg) || 0;
    if (actual > 0 && !pisarExistentes) { plan.yaTenian.push(p); continue; }

    const estimado = pesoEstimadoKg(p.category, p.content_ml);
    if (estimado === null) { plan.sinModelo.push(p); continue; }
    // Un cambio que no cambia nada no se manda a la base.
    if (estimado === actual) { plan.yaTenian.push(p); continue; }

    plan.aplicar.push({ id: p.id, name: p.name ?? "", actual, estimado });
  }

  return plan;
}

export interface DiferenciaPeso {
  /** Kilos que la cotización cuenta de más hoy (peso real menor que el default). */
  deMas: number;
  /** Kilos que cuenta de menos (peso real mayor que el default). */
  deMenos: number;
}

/**
 * Cuánto se aparta el peso real del que se está usando hoy, en las dos
 * direcciones.
 *
 * Se devuelven separadas a propósito, porque **no son el mismo problema**:
 * cotizar de más le cuesta ventas al comercio (el envío caro es de las
 * primeras razones por las que se abandona un carrito) y cotizar de menos le
 * cuesta margen. Sumarlas en un neto escondería cuál de las dos está pasando,
 * y en este catálogo está pasando la primera: los 55 perfumes estiman 0,40 kg
 * contra un default de 0,50.
 */
export function diferenciaContraDefault(
  plan: PesoPropuesto[],
  pesoPorDefecto = 0.5,
): DiferenciaPeso {
  const redondear = (n: number) => Math.round(n * 100) / 100;
  return {
    deMas:   redondear(plan.reduce((s, p) => s + Math.max(0, pesoPorDefecto - p.estimado), 0)),
    deMenos: redondear(plan.reduce((s, p) => s + Math.max(0, p.estimado - pesoPorDefecto), 0)),
  };
}
