// Ventas de un canje con influencer: medidas por atribución, o cargadas a mano.
//
// Creators y Commerce comparten el mismo registro: cuando una venta entra con
// el código de un creador, queda en `influencer_sales`. El canje, en cambio,
// guardaba «ventas generadas» como un número que alguien escribía. Si la
// plataforma ya midió las ventas, mostrar el número escrito a mano es ignorar
// el dato propio. Regla: lo medido manda; lo cargado sólo se usa si no hay
// ninguna venta atribuida, y se rotula como tal.

export interface CanjeParaVentas {
  id: string;
  influencer_id?: string | null;
  discount_code?: string | null;
  created_at: string;
  sales_generated_ars?: number | string | null;
}

export interface VentaAtribuida {
  influencer_id: string;
  referral_code?: string | null;
  sale_total_ars: number | string;
  created_at: string;
}

export type FuenteVentas = "medido" | "cargado" | "sin_dato";

export interface VentasDelCanje {
  monto: number;
  fuente: FuenteVentas;
}

const codigo = (c: string | null | undefined) => (c ?? "").trim().toUpperCase();

/**
 * Asigna cada venta atribuida a un solo canje: el más reciente del mismo
 * creador que empezó antes de la venta (y con el mismo código, si ambos lo
 * tienen). Así dos canjes del mismo creador no cuentan la misma venta.
 */
export function ventasMedidasPorCanje(
  canjes: CanjeParaVentas[],
  ventas: VentaAtribuida[],
): Map<string, number> {
  const porCreador = new Map<string, CanjeParaVentas[]>();
  for (const c of canjes) {
    if (!c.influencer_id) continue;
    const lista = porCreador.get(c.influencer_id) ?? [];
    lista.push(c);
    porCreador.set(c.influencer_id, lista);
  }
  for (const lista of porCreador.values()) {
    lista.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  const medidas = new Map<string, number>();
  for (const v of ventas) {
    const candidatos = porCreador.get(v.influencer_id);
    if (!candidatos) continue;
    const cod = codigo(v.referral_code);
    const canje = candidatos.find(c =>
      c.created_at <= v.created_at
      && (!cod || !codigo(c.discount_code) || codigo(c.discount_code) === cod));
    if (!canje) continue;
    medidas.set(canje.id, (medidas.get(canje.id) ?? 0) + (Number(v.sale_total_ars) || 0));
  }
  return medidas;
}

export function ventasDelCanje(canje: CanjeParaVentas, medidas: Map<string, number>): VentasDelCanje {
  const medido = medidas.get(canje.id);
  if (medido !== undefined && medido > 0) return { monto: medido, fuente: "medido" };
  const cargado = Number(canje.sales_generated_ars) || 0;
  return cargado > 0 ? { monto: cargado, fuente: "cargado" } : { monto: 0, fuente: "sin_dato" };
}
