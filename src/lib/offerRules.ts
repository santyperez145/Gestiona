/**
 * Motor propio de propuestas de oferta.
 *
 * Vive en el cliente (tests) y se espeja en `ai-offer-recommender` cuando no
 * hay Anthropic o la llamada falla. Misma forma que persiste
 * `ai_offer_recommendations` para que `apply_ai_offer_recommendation` sirva
 * igual. No inventa ventas: sólo ordena stock dormido, sobrestock y margen.
 */

export type OfferProductInput = {
  id: string;
  name: string;
  brand?: string | null;
  stock: number;
  sale_price_ars: number;
  cost_usd?: number | null;
  profit_per_unit_ars?: number | null;
  discount_price_ars?: number | null;
  units_sold_90d?: number;
  days_since_last_sale?: number | null;
};

export type OfferRulesSettings = {
  stock_dormido_days?: number;
  max_overstock_units?: number;
  max_ai_discount_percent?: number;
  margin_alert_percent?: number;
};

export type OfferProposal = {
  product_id: string;
  product_name: string;
  tipo: 'liquidacion' | 'flash' | 'destacado' | 'mayorista';
  razon: string;
  descuento_sugerido_percent: number;
  precio_sugerido_ars: number;
  duracion_horas: number;
  margen_resultante_percent: number;
  probabilidad_venta: 'alta' | 'media' | 'baja';
  canal_recomendado: 'instagram_story' | 'whatsapp_status' | 'catalogo_destacado' | 'email_vip';
  source: 'rules';
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function redondearArs(n: number) {
  return Math.round(n);
}

function margenPct(p: OfferProductInput, precio: number): number {
  const profit = Number(p.profit_per_unit_ars ?? 0);
  const list = Number(p.sale_price_ars) || 0;
  if (list <= 0 || precio <= 0) return 0;
  // Si hay profit por unidad al precio de lista, se escala al precio nuevo.
  if (profit > 0 && list > 0) {
    const costImplied = list - profit;
    return Math.round(((precio - costImplied) / precio) * 100);
  }
  return 0;
}

/**
 * Propone hasta `limit` ofertas a partir de señales del Business Graph.
 * Sin LLM: determinístico y testeable.
 */
export function proposeOffersFromRules(
  products: OfferProductInput[],
  settings: OfferRulesSettings = {},
  limit = 6,
): OfferProposal[] {
  const dormidoDays = settings.stock_dormido_days ?? 30;
  const maxOverstock = settings.max_overstock_units ?? 10;
  const maxDiscount = settings.max_ai_discount_percent ?? 35;
  const marginFloor = settings.margin_alert_percent ?? 30;

  const scored = products
    .filter((p) => Number(p.stock) > 0 && Number(p.sale_price_ars) > 0)
    .filter((p) => !p.discount_price_ars || Number(p.discount_price_ars) <= 0)
    .map((p) => {
      const days = p.days_since_last_sale;
      const isDormido = days == null || days > dormidoDays;
      const isOverstock = Number(p.stock) > maxOverstock;
      const sold = Number(p.units_sold_90d ?? 0);
      const list = Number(p.sale_price_ars);
      const margenLista = margenPct(p, list);

      let tipo: OfferProposal['tipo'] = 'destacado';
      let discount = 10;
      let probabilidad: OfferProposal['probabilidad_venta'] = 'media';
      let canal: OfferProposal['canal_recomendado'] = 'catalogo_destacado';
      let score = 0;
      const razones: string[] = [];

      if (isOverstock && isDormido) {
        tipo = 'liquidacion';
        discount = clamp(Math.round(18 + Math.min(12, Number(p.stock) / 2)), 15, maxDiscount);
        probabilidad = 'alta';
        canal = 'whatsapp_status';
        score += 100;
        razones.push(`stock ${p.stock} y ${days == null ? 'sin ventas' : `${days} días sin venta`}`);
      } else if (isDormido) {
        tipo = 'flash';
        discount = clamp(15, 10, maxDiscount);
        probabilidad = sold > 0 ? 'media' : 'baja';
        canal = 'instagram_story';
        score += 70;
        razones.push(days == null ? 'sin ventas recientes' : `${days} días sin venta`);
      } else if (isOverstock) {
        tipo = 'mayorista';
        discount = clamp(12, 8, maxDiscount);
        probabilidad = 'media';
        canal = 'email_vip';
        score += 55;
        razones.push(`sobrestock (${p.stock} u.)`);
      } else if (margenLista >= marginFloor + 15 && sold >= 3) {
        tipo = 'destacado';
        discount = clamp(8, 5, Math.min(15, maxDiscount));
        probabilidad = 'alta';
        canal = 'catalogo_destacado';
        score += 40;
        razones.push(`margen ${margenLista}% y ${sold} u. en 90 días`);
      } else {
        return null;
      }

      // No bajar por debajo del piso de margen si se puede medir.
      let precio = redondearArs(list * (1 - discount / 100));
      let margenRes = margenPct(p, precio);
      while (margenRes > 0 && margenRes < marginFloor && discount > 5) {
        discount -= 1;
        precio = redondearArs(list * (1 - discount / 100));
        margenRes = margenPct(p, precio);
      }
      if (margenRes > 0 && margenRes < marginFloor) return null;

      score += Math.min(20, Number(p.stock));

      return {
        score,
        offer: {
          product_id: p.id,
          product_name: p.name,
          tipo,
          razon: razones.join('; '),
          descuento_sugerido_percent: discount,
          precio_sugerido_ars: precio,
          duracion_horas: tipo === 'flash' ? 48 : tipo === 'liquidacion' ? 168 : 72,
          margen_resultante_percent: margenRes,
          probabilidad_venta: probabilidad,
          canal_recomendado: canal,
          source: 'rules' as const,
        },
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((s) => s.offer);
}
