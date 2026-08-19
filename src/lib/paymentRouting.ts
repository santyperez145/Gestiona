/**
 * Orquestador de pagos — la parte que el panel necesita entender.
 *
 * El ruteo lo decide la base (`pago_proveedores_para`), que es la autoridad:
 * conoce las tarifas vigentes y los proveedores activos. Acá vive lo que la
 * pantalla necesita para **explicar** esa decisión, y el puente entre los dos
 * vocabularios de métodos de pago que conviven en el sistema.
 *
 * ── Por qué el costo importa más de lo que parece ─────────────────────────
 *
 * Es la tesis del producto aplicada al cobro: el margen real por canal necesita
 * cuatro datos a la vez, y la comisión del medio de pago es uno. Un comercio
 * que vende con 6 cuotas y no sabe que le cuestan 12,9% + IVA está mirando un
 * margen que no existe.
 *
 * ⚠️ Y la comisión **no es el único costo**: los días de acreditación también
 * cuestan. Cobrar 1% más barato para recibir la plata 20 días después puede ser
 * peor negocio, y por eso las dos cosas se muestran juntas.
 */

/** Los métodos con los que trabaja la tienda. */
export type MetodoPago =
  | "efectivo" | "transferencia" | "mercadopago" | "tarjeta" | "debito";

/**
 * Traduce al vocabulario de `payment_provider_fees`.
 *
 * ⚠️ Espejo exacto de `public.pago_metodo_de_tarifa`. Son **dos vocabularios
 * distintos** conviviendo: la tienda dice `mercadopago` y la tabla de tarifas
 * dice `wallet` o `credit`. No cruzarlos hizo que el ruteo por costo devolviera
 * **cero** para todo — y un proveedor que parece gratis gana cualquier
 * comparación de costo. Lo encontró la verificación, no la lectura del código.
 *
 * La distinción entre `wallet` y `credit` es plata real: un pago en una cuota
 * por la billetera cuesta 4,79% y el mismo monto en cuotas cuesta 12,9%.
 */
export function metodoDeTarifa(metodo: string, cuotas = 1): string {
  const m = String(metodo ?? "").toLowerCase();
  const n = Number(cuotas) || 1;
  switch (m) {
    case "efectivo":      return "cash";
    case "transferencia": return "transfer";
    case "mercadopago":   return n > 1 ? "credit" : "wallet";
    case "tarjeta":       return "credit";
    case "debito":        return "debit";
    default:              return "default";
  }
}

export interface OpcionDeCobro {
  provider: string;
  prioridad: number;
  /** Costo total en pesos, con IVA de la comisión. `null` = sin tarifa cargada. */
  costo: number | null;
  costo_pct: number | null;
  dias_acredita: number | null;
}

/**
 * Ordena las opciones como lo hace la base: prioridad, y a igual prioridad el
 * más barato — con lo desconocido último.
 *
 * ⚠️ **Costo desconocido no es costo cero.** Tratar `null` como 0 haría que el
 * proveedor del que menos sabemos gane siempre. Es el mismo error que devolver
 * `?? []` ante un error de permisos: convierte "no sé" en "nada".
 */
export function ordenarOpciones(opciones: OpcionDeCobro[]): OpcionDeCobro[] {
  return [...(opciones ?? [])].sort((a, b) => {
    if (a.prioridad !== b.prioridad) return a.prioridad - b.prioridad;
    const ca = a.costo, cb = b.costo;
    if (ca == null && cb == null) return 0;
    if (ca == null) return 1;   // lo desconocido, último
    if (cb == null) return -1;
    return ca - cb;
  });
}

/**
 * Cuánto se lleva el proveedor, en porcentaje efectivo sobre el monto.
 *
 * Sirve para comparar opciones cuyos montos difieren: el costo en pesos de una
 * venta de $500.000 no se compara con el de una de $5.000.
 */
export function costoEfectivoPct(opcion: OpcionDeCobro, monto: number): number | null {
  if (opcion?.costo == null) return null;
  const m = Number(monto);
  if (!Number.isFinite(m) || m <= 0) return null;
  return Math.round((opcion.costo / m) * 10000) / 100;
}

export interface ComparacionCobro {
  mejor: OpcionDeCobro | null;
  /** Cuánto se ahorra contra la opción más cara, en pesos. */
  ahorro: number;
  /** Qué se resigna en días de acreditación por elegir la más barata. */
  diasExtra: number;
  /** `true` si hay alguna opción sin tarifa cargada. */
  hayDesconocidos: boolean;
}

/**
 * Compara las opciones para poder mostrar la decisión, no sólo el resultado.
 *
 * El comercio tiene que poder ver **por qué** se eligió un proveedor: si es más
 * barato pero acredita 20 días después, esa es su decisión y no del sistema.
 */
export function compararCobro(opciones: OpcionDeCobro[]): ComparacionCobro {
  const conCosto = (opciones ?? []).filter(o => o.costo != null);
  const hayDesconocidos = (opciones ?? []).some(o => o.costo == null);

  if (conCosto.length === 0) {
    return { mejor: null, ahorro: 0, diasExtra: 0, hayDesconocidos };
  }

  const orden = [...conCosto].sort((a, b) => (a.costo ?? 0) - (b.costo ?? 0));
  const mejor = orden[0];
  const peor = orden[orden.length - 1];

  return {
    mejor,
    ahorro: Math.round(((peor.costo ?? 0) - (mejor.costo ?? 0)) * 100) / 100,
    // Positivo = la más barata tarda más. Es la contra de elegir por precio.
    diasExtra: (mejor.dias_acredita ?? 0) - (peor.dias_acredita ?? 0),
    hayDesconocidos,
  };
}

export type EstadoIntent =
  | "pendiente" | "procesando" | "acreditado" | "rechazado" | "expirado" | "cancelado";

export const ESTADO_INTENT: Record<EstadoIntent, { label: string; tono: "amber" | "blue" | "green" | "red" | "neutral" }> = {
  pendiente:  { label: "Esperando pago", tono: "amber" },
  procesando: { label: "Procesando",     tono: "blue" },
  acreditado: { label: "Acreditado",     tono: "green" },
  rechazado:  { label: "Rechazado",      tono: "red" },
  expirado:   { label: "Vencido",        tono: "neutral" },
  cancelado:  { label: "Cancelado",      tono: "neutral" },
};

/**
 * ¿Se puede reintentar el cobro con otro proveedor?
 *
 * ⚠️ Nunca sobre algo ya acreditado: sería cobrar dos veces. Y nunca automático
 * — un reintento sin que el comprador lo pida puede duplicar un cobro que en
 * realidad salió y cuyo aviso se perdió. Esta función dice si la puerta está
 * abierta, no que haya que cruzarla.
 */
export function puedeReintentar(
  estado: string,
  proveedoresProbados: string[],
  proveedoresDisponibles: string[],
): { puede: boolean; motivo?: string } {
  if (estado === "acreditado") {
    return { puede: false, motivo: "Esa orden ya está paga" };
  }
  if (estado === "cancelado") {
    return { puede: false, motivo: "El cobro fue cancelado" };
  }

  const quedan = (proveedoresDisponibles ?? [])
    .filter(p => !(proveedoresProbados ?? []).includes(p));

  if (quedan.length === 0) {
    return { puede: false, motivo: "No quedan medios de pago para intentar" };
  }
  return { puede: true };
}

/**
 * La tasa de aprobación por proveedor, que es EL número de un orquestador.
 *
 * Un proveedor que cobra 1% menos pero aprueba el 70% de las compras sale
 * carísimo: cada rechazo es una venta perdida, no un descuento. Por eso esto se
 * muestra al lado del costo y no en otra pantalla.
 */
export function costoRealPorVentaLograda(
  costoPct: number | null,
  aprobacionPct: number | null,
): number | null {
  // ⚠️ `Number(null)` es 0, que es finito. Sin este chequeo explícito, un costo
  // desconocido devolvía 0 — el mismo error de "no sé" convertido en "nada" que
  // este archivo evita en el ordenamiento. Lo agarró el test.
  if (costoPct == null || aprobacionPct == null) return null;

  const c = Number(costoPct);
  const a = Number(aprobacionPct);
  if (!Number.isFinite(c) || !Number.isFinite(a) || a <= 0) return null;
  // Si aprueba el 70%, cada venta lograda "carga" con el costo de 1/0,7 intentos.
  return Math.round((c / (a / 100)) * 100) / 100;
}
