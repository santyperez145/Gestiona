/**
 * Métricas de inventario: rotación, cobertura, ABC/XYZ y punto de reposición.
 *
 * ── Por qué existe ────────────────────────────────────────────────────────
 *
 * `run_abc_analysis` ya calculaba algo, pero auditado contra los datos reales
 * daba números sin información:
 *
 * **1. División entera.** `total_units / p_period_days` con los dos `int`
 * trunca en Postgres. Todos los productos de esta organización venden entre
 * 0,011 y 0,022 por día, así que la cuenta daba **0 para todos** y los 16
 * quedaron clasificados `slow`. Una clasificación donde todo cae en la misma
 * clase no clasifica nada.
 *
 * **2. Seis columnas decorativas.** `reorder_point`, `safety_stock`, `eoq`,
 * `days_on_hand`, `stockout_risk` y `xyz_class` existen en la tabla y la función
 * **nunca las escribe**: NULL en las 16 filas.
 *
 * **3. Umbrales absolutos que no aplican.** "Rápido = 2 unidades por día" es
 * razonable en un kiosco y absurdo importando perfumes, donde un producto que
 * vende 20 por mes es un éxito. Por eso acá la velocidad se mide con **días de
 * cobertura**, que es adimensional: cuántos días aguanta el stock al ritmo
 * actual. Eso significa lo mismo para un kiosco que para una importadora.
 *
 * ── La regla que ordena todo el módulo ────────────────────────────────────
 *
 * **Lo que no se puede calcular devuelve `null`, no un número plausible.**
 * Sin lead time no hay punto de reposición; sin costo de pedido ni de
 * almacenamiento no hay lote óptimo; sin ventas no hay días de cobertura
 * (aguanta para siempre, y "para siempre" no es un número). Un dato faltante se
 * ve; un número inventado se usa para comprar.
 */

// ── Venta diaria ────────────────────────────────────────────────────────────

/**
 * Unidades por día en el período. División real, no entera — que es el bug que
 * originó este módulo.
 */
export function ventaDiaria(unidades: number, dias: number): number {
  const u = Number(unidades);
  const d = Number(dias);
  if (!Number.isFinite(u) || !Number.isFinite(d) || d <= 0 || u <= 0) return 0;
  return u / d;
}

/**
 * Cuántos días aguanta el stock al ritmo actual.
 *
 * `null` cuando no hubo ventas: el stock "alcanza para siempre", y eso no es un
 * número. Devolver `Infinity` o un 9999 se termina graficando.
 */
export function diasDeCobertura(stock: number, ventaPorDia: number): number | null {
  const s = Number(stock);
  const v = Number(ventaPorDia);
  if (!Number.isFinite(s) || s < 0) return null;
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.round((s / v) * 10) / 10;
}

/**
 * Rotación anualizada: cuántas veces se renueva el stock en un año.
 *
 * Se mide en unidades contra el stock promedio, no en plata: con inflación el
 * valorizado mezcla el efecto del precio con el del movimiento, y lo que se
 * quiere saber es si la mercadería se mueve.
 *
 * `null` sin stock promedio: dividir por cero da infinito, y un producto que
 * nunca tuvo stock no tiene rotación, tiene ausencia de dato.
 */
export function rotacionAnual(
  unidadesVendidas: number,
  diasDelPeriodo: number,
  stockPromedio: number,
): number | null {
  const u = Number(unidadesVendidas);
  const d = Number(diasDelPeriodo);
  const s = Number(stockPromedio);
  if (!Number.isFinite(u) || !Number.isFinite(d) || d <= 0) return null;
  if (!Number.isFinite(s) || s <= 0) return null;
  const anualizado = (u / d) * 365;
  return Math.round((anualizado / s) * 100) / 100;
}

// ── Clasificación ───────────────────────────────────────────────────────────

export type ClaseABC = "A" | "B" | "C";

/**
 * Pareto por facturación acumulada. A = el 80% de la facturación, B hasta el
 * 95%, C el resto. Es la única parte de la función original que estaba bien.
 */
export function clasificarABC(acumuladoPct: number): ClaseABC {
  const p = Number(acumuladoPct);
  if (!Number.isFinite(p)) return "C";
  if (p <= 80) return "A";
  if (p <= 95) return "B";
  return "C";
}

export type ClaseXYZ = "X" | "Y" | "Z";

/**
 * Variabilidad de la demanda por coeficiente de variación (σ/μ).
 *
 * X = demanda estable, se puede planificar. Y = variable, con estacionalidad.
 * Z = errática, no se puede pronosticar y conviene comprar contra pedido.
 *
 * Cruzar ABC con XYZ es lo que hace útil la clasificación: un producto AZ
 * —factura mucho y es impredecible— necesita más stock de seguridad que un AX
 * que factura igual pero se comporta.
 */
export function clasificarXYZ(coeficienteVariacion: number | null): ClaseXYZ | null {
  if (coeficienteVariacion === null) return null;
  const cv = Number(coeficienteVariacion);
  if (!Number.isFinite(cv) || cv < 0) return null;
  if (cv <= 0.5) return "X";
  if (cv <= 1.0) return "Y";
  return "Z";
}

/**
 * Coeficiente de variación de una serie de demanda.
 *
 * `null` con menos de tres períodos: con dos puntos el desvío no significa
 * nada, y clasificar a un producto de errático porque vendió 1 y después 3
 * sería ruido disfrazado de dato.
 */
export function coeficienteVariacion(serie: number[]): number | null {
  const xs = (serie ?? []).map(Number).filter(Number.isFinite);
  if (xs.length < 3) return null;
  const media = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (media <= 0) return null;
  const varianza = xs.reduce((a, b) => a + (b - media) ** 2, 0) / xs.length;
  return Math.round((Math.sqrt(varianza) / media) * 1000) / 1000;
}

export type Velocidad = "rapido" | "normal" | "lento" | "muerto";

/**
 * Velocidad medida por cobertura, no por unidades por día.
 *
 * Un umbral absoluto de "2 por día" clasifica de lento a todo el catálogo de una
 * importadora de perfumes, que es exactamente lo que pasaba. La cobertura es
 * adimensional y significa lo mismo en cualquier rubro:
 *
 *   menos de 30 días  → rápido, se está por acabar
 *   30 a 90           → normal
 *   90 a 365          → lento, hay plata quieta
 *   más de 365        → muerto, no se va a vender
 *
 * Sin ventas en el período es `muerto` sólo si además hay stock: un producto sin
 * stock y sin ventas no es lento, es un producto que no se tiene.
 */
export function clasificarVelocidad(
  cobertura: number | null,
  stock: number,
): Velocidad | null {
  const s = Number(stock);
  if (!Number.isFinite(s) || s <= 0) return null;
  if (cobertura === null) return "muerto";
  if (cobertura < 30) return "rapido";
  if (cobertura < 90) return "normal";
  if (cobertura < 365) return "lento";
  return "muerto";
}

// ── Reposición ──────────────────────────────────────────────────────────────

/** Z de la normal para los niveles de servicio que se usan en la práctica. */
const Z_POR_SERVICIO: Record<number, number> = {
  90: 1.28,
  95: 1.65,
  98: 2.05,
  99: 2.33,
};

export const NIVELES_DE_SERVICIO = Object.keys(Z_POR_SERVICIO).map(Number);

/**
 * Stock de seguridad: Z × σ_diaria × √(lead time).
 *
 * La raíz del lead time no es un detalle: el desvío de la demanda acumulada en
 * L días crece con √L, no con L. Usar L de frente sobredimensiona el stock de
 * seguridad y es plata quieta.
 *
 * `null` sin desvío conocido o sin lead time. No hay un valor por defecto
 * razonable: comprar de más cuesta caja, comprar de menos cuesta la venta.
 */
export function stockDeSeguridad(
  desvioDiario: number | null,
  leadTimeDias: number | null,
  nivelServicio = 95,
): number | null {
  if (desvioDiario === null || leadTimeDias === null) return null;
  const sigma = Number(desvioDiario);
  const L = Number(leadTimeDias);
  const z = Z_POR_SERVICIO[nivelServicio];
  if (!z || !Number.isFinite(sigma) || sigma < 0) return null;
  if (!Number.isFinite(L) || L <= 0) return null;
  return Math.ceil(z * sigma * Math.sqrt(L));
}

/**
 * Punto de reposición: lo que se vende durante el lead time, más el colchón.
 *
 * `null` sin lead time. Es la diferencia entre "reponé cuando llegues a 12" y
 * "reponé cuando te parezca": sin saber cuánto tarda el proveedor, el número no
 * existe. Inventar 7 días es la clase de dato que después se usa para comprar.
 */
export function puntoDeReposicion(
  ventaPorDia: number,
  leadTimeDias: number | null,
  stockSeguridad: number | null,
): number | null {
  if (leadTimeDias === null) return null;
  const v = Number(ventaPorDia);
  const L = Number(leadTimeDias);
  if (!Number.isFinite(v) || v < 0) return null;
  if (!Number.isFinite(L) || L <= 0) return null;
  return Math.ceil(v * L + (stockSeguridad ?? 0));
}

/**
 * Lote óptimo de compra (Wilson): √(2 × D × S / H).
 *
 * D = demanda anual en unidades, S = costo de emitir un pedido, H = costo de
 * mantener una unidad un año.
 *
 * `null` sin S y H configurados, que es el caso hoy. La fórmula es simple y la
 * tentación de completarla con constantes inventadas es grande: con S y H
 * puestos a ojo, el EOQ sale un número redondo, se ve serio y manda a comprar
 * la cantidad equivocada. Mejor que falte.
 */
export function loteOptimo(
  demandaAnual: number,
  costoPorPedido: number | null,
  costoAlmacenamientoAnualPorUnidad: number | null,
): number | null {
  if (costoPorPedido === null || costoAlmacenamientoAnualPorUnidad === null) return null;
  const D = Number(demandaAnual);
  const S = Number(costoPorPedido);
  const H = Number(costoAlmacenamientoAnualPorUnidad);
  if (!Number.isFinite(D) || D <= 0) return null;
  if (!Number.isFinite(S) || S <= 0) return null;
  if (!Number.isFinite(H) || H <= 0) return null;
  return Math.ceil(Math.sqrt((2 * D * S) / H));
}

export type RiesgoQuiebre = "quebrado" | "critico" | "atencion" | "ok";

/**
 * Riesgo de quedarse sin stock, comparando contra el punto de reposición.
 *
 * Sin punto de reposición se cae a la cobertura, que no necesita lead time: es
 * menos preciso pero sigue siendo verdadero. Lo que no se hace es inventar el
 * lead time para poder mostrar el número "bueno".
 */
export function riesgoDeQuiebre(
  stock: number,
  puntoRepo: number | null,
  cobertura: number | null,
): RiesgoQuiebre {
  const s = Number(stock);
  if (!Number.isFinite(s) || s <= 0) return "quebrado";

  if (puntoRepo !== null) {
    if (s <= puntoRepo) return "critico";
    if (s <= puntoRepo * 1.5) return "atencion";
    return "ok";
  }

  if (cobertura === null) return "ok";   // no vende: no se va a quebrar
  if (cobertura < 15) return "critico";
  if (cobertura < 30) return "atencion";
  return "ok";
}

// ── Todo junto ──────────────────────────────────────────────────────────────

export interface EntradaMetricas {
  stockActual: number;
  unidadesVendidas: number;
  diasDelPeriodo: number;
  /** Unidades por sub-período (semana, mes) para medir la variabilidad. */
  serieDemanda?: number[];
  stockPromedio?: number;
  leadTimeDias?: number | null;
  acumuladoPct?: number;
  costoPorPedido?: number | null;
  costoAlmacenamientoAnual?: number | null;
  nivelServicio?: number;
}

export interface MetricasStock {
  ventaDiaria: number;
  cobertura: number | null;
  rotacion: number | null;
  abc: ClaseABC;
  xyz: ClaseXYZ | null;
  velocidad: Velocidad | null;
  stockSeguridad: number | null;
  puntoReposicion: number | null;
  loteOptimo: number | null;
  riesgo: RiesgoQuiebre;
  /** Cuánto comprar para volver a cubrir el lead time. `null` si no aplica. */
  sugerenciaCompra: number | null;
}

export function calcularMetricas(e: EntradaMetricas): MetricasStock {
  const vd = ventaDiaria(e.unidadesVendidas, e.diasDelPeriodo);
  const cobertura = diasDeCobertura(e.stockActual, vd);
  const rot = rotacionAnual(e.unidadesVendidas, e.diasDelPeriodo, e.stockPromedio ?? e.stockActual);

  const cv = e.serieDemanda ? coeficienteVariacion(e.serieDemanda) : null;
  const xyz = clasificarXYZ(cv);

  // El desvío diario sale de la serie, no del promedio: sin serie no hay
  // variabilidad conocida y el stock de seguridad queda en null.
  const desvioDiario = (cv !== null && vd > 0) ? cv * vd : null;

  const lead = e.leadTimeDias ?? null;
  const ss = stockDeSeguridad(desvioDiario, lead, e.nivelServicio ?? 95);
  const pr = puntoDeReposicion(vd, lead, ss);

  const eoq = loteOptimo(
    vd * 365,
    e.costoPorPedido ?? null,
    e.costoAlmacenamientoAnual ?? null,
  );

  const riesgo = riesgoDeQuiebre(e.stockActual, pr, cobertura);

  // Cuánto falta para llegar al punto de reposición. Se sugiere sólo cuando hay
  // punto de reposición: sin lead time, "comprá 20" es una opinión.
  const sugerencia = pr !== null && e.stockActual < pr
    ? Math.ceil(pr - e.stockActual + (eoq ?? 0))
    : null;

  return {
    ventaDiaria: Math.round(vd * 1000) / 1000,
    cobertura,
    rotacion: rot,
    abc: clasificarABC(e.acumuladoPct ?? 100),
    xyz,
    velocidad: clasificarVelocidad(cobertura, e.stockActual),
    stockSeguridad: ss,
    puntoReposicion: pr,
    loteOptimo: eoq,
    riesgo,
    sugerenciaCompra: sugerencia,
  };
}
