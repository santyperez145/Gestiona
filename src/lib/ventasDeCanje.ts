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
  sale_id?: string | null;
  commission_ars?: number | string | null;
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
export function asignarVentasACanjes(
  canjes: CanjeParaVentas[],
  ventas: VentaAtribuida[],
): Map<string, VentaAtribuida[]> {
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

  const asignadas = new Map<string, VentaAtribuida[]>();
  for (const v of ventas) {
    const candidatos = porCreador.get(v.influencer_id);
    if (!candidatos) continue;
    const cod = codigo(v.referral_code);
    const canje = candidatos.find(c =>
      c.created_at <= v.created_at
      && (!cod || !codigo(c.discount_code) || codigo(c.discount_code) === cod));
    if (!canje) continue;
    asignadas.set(canje.id, [...(asignadas.get(canje.id) ?? []), v]);
  }
  return asignadas;
}

export function ventasMedidasPorCanje(
  canjes: CanjeParaVentas[],
  ventas: VentaAtribuida[],
): Map<string, number> {
  const medidas = new Map<string, number>();
  for (const [id, lista] of asignarVentasACanjes(canjes, ventas)) {
    medidas.set(id, lista.reduce((s, v) => s + (Number(v.sale_total_ars) || 0), 0));
  }
  return medidas;
}

export function ventasDelCanje(canje: CanjeParaVentas, medidas: Map<string, number>): VentasDelCanje {
  const medido = medidas.get(canje.id);
  if (medido !== undefined && medido > 0) return { monto: medido, fuente: "medido" };
  const cargado = Number(canje.sales_generated_ars) || 0;
  return cargado > 0 ? { monto: cargado, fuente: "cargado" } : { monto: 0, fuente: "sin_dato" };
}

// ── Ganancia real: Creators conectado con Profit ──────────────────────────
//
// «Ventas generadas − inversión» no dice cuánto se ganó: una campaña puede
// vender más de lo invertido y perder plata después del costo de la
// mercadería. La ganancia real usa el margen de contribución de cada venta
// atribuida (`sale_margin_facts`, la misma fuente que Profit), menos la
// comisión del creador y la inversión del canje. Si a una venta le falta el
// margen (sin costo cargado o sin permiso para verlo), no hay número: se dice
// cuántas faltan. Nunca se completa con cero.

export interface GananciaReal {
  /** null si alguna venta medida no tiene margen conocido. */
  ganancia: number | null;
  margen: number;
  comisiones: number;
  inversion: number;
  canjesMedidos: number;
  ventasMedidas: number;
  ventasSinMargen: number;
}

export function gananciaRealDeCanjes(
  canjes: CanjeParaVentas[],
  ventas: VentaAtribuida[],
  margenPorVenta: Map<string, number | null>,
  inversionDe: (canje: CanjeParaVentas) => number,
): GananciaReal {
  const asignadas = asignarVentasACanjes(canjes, ventas);
  const redondear = (n: number) => Math.round(n * 100) / 100;
  let margen = 0;
  let comisiones = 0;
  let inversion = 0;
  let ventasMedidas = 0;
  let ventasSinMargen = 0;
  let canjesMedidos = 0;
  for (const canje of canjes) {
    const lista = asignadas.get(canje.id);
    if (!lista?.length) continue;
    canjesMedidos += 1;
    inversion += Number(inversionDe(canje)) || 0;
    for (const v of lista) {
      ventasMedidas += 1;
      comisiones += Number(v.commission_ars) || 0;
      const m = v.sale_id ? margenPorVenta.get(v.sale_id) : undefined;
      if (m === undefined || m === null || !Number.isFinite(m)) ventasSinMargen += 1;
      else margen += m;
    }
  }
  return {
    ganancia: canjesMedidos === 0 || ventasSinMargen > 0 ? null : redondear(margen - comisiones - inversion),
    margen: redondear(margen),
    comisiones: redondear(comisiones),
    inversion: redondear(inversion),
    canjesMedidos,
    ventasMedidas,
    ventasSinMargen,
  };
}
