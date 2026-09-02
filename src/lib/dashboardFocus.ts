/**
 * Qué tiene que contestar el panel al abrirlo.
 *
 * ── El problema ───────────────────────────────────────────────────────────
 *
 * El dashboard son ~40 bloques en un scroll único: cotizaciones, accesos
 * rápidos, resumen mensual, comparativa semanal, flujo proyectado, punto de
 * equilibrio, simulador de tipo de cambio, objetivos por vendedor, doce
 * gráficos… Todo con el mismo peso y sin orden de importancia.
 *
 * Un panel así no contesta nada: obliga a leerlo entero para saber si el
 * negocio va bien. Y como leerlo entero cuesta, se deja de leer.
 *
 * ── Qué contesta ahora ────────────────────────────────────────────────────
 *
 * Tres preguntas, en este orden, porque es el orden en que le importan a quien
 * abre el sistema a la mañana:
 *
 *   1. ¿Cómo viene el mes?     → un número y una comparación
 *   2. ¿Qué tengo que hacer?   → una lista corta, accionable y ordenada
 *   3. ¿Algo está mal?         → sólo si lo hay
 *
 * El resto —los cuarenta bloques— sigue abajo, como detalle. No se borró nada.
 *
 * ── Reglas de la lista de pendientes ──────────────────────────────────────
 *
 * **Sólo aparece lo que requiere una acción.** Un pendiente en cero no se
 * muestra: una lista con "0 productos sin stock" enseña a saltear la lista.
 *
 * **Todo pendiente lleva a un lugar concreto.** Un renglón sin destino es
 * decoración; si no se puede hacer nada al respecto, no es un pendiente.
 *
 * **El orden es por costo de no hacerlo**, no por módulo: quedarse sin stock de
 * lo que se vende corta la venta hoy; una deuda vencida es plata que ya se
 * entregó. Eso va antes que un seguimiento.
 */

export type Urgencia = "critico" | "atencion" | "normal";

export interface Pendiente {
  id: string;
  /** Qué pasa, en una línea y con el número adelante. */
  texto: string;
  /** Qué hacer al respecto. Es el texto del enlace. */
  accion: string;
  /** A dónde lleva. Sin destino no es un pendiente. */
  destino: string;
  urgencia: Urgencia;
}

export interface DatosFoco {
  /** Productos en cero: cortan la venta hoy. */
  sinStock: number;
  /** Productos por debajo del umbral: cortan la venta esta semana. */
  stockBajo: number;
  /** Cantidad de deudas sin cobrar. */
  deudasPendientes: number;
  /** Monto total sin cobrar. */
  deudaTotalARS: number;
  /** Cuántas de esas pasaron los 30 días. */
  deudasVencidas30: number;
  /** Seguimientos agendados para hoy o vencidos. */
  seguimientosHoy: number;
  /** Órdenes de la tienda pagadas y sin despachar. */
  pedidosPorDespachar: number;
  /**
   * Días desde la última venta registrada, o `null` si nunca vendió.
   *
   * Se dice "registrada" a propósito: el sistema no puede saber si el comercio
   * vendió y no lo cargó. Las dos cosas son accionables, pero son distintas y
   * afirmar la equivocada suena a reproche.
   */
  diasSinRegistrarVenta?: number | null;
  /**
   * Los huecos en días entre ventas consecutivas, de la historia del comercio.
   * De acá sale el umbral: qué es raro depende de cada negocio.
   */
  huecosEntreVentas?: number[];
  /** true = no hay ninguna venta en el historial consultado (primera venta). */
  nuncaVendio?: boolean;
  /** true = nunca cerró una toma física (`stock_counts`). */
  sinConteoFisico?: boolean;
}

/**
 * Cuántos días de silencio son raros **para este comercio**.
 *
 * Un umbral fijo no sirve para las dos puntas: quien vende todos los días y
 * para dos merece saberlo; quien vende una vez por mes no tiene por qué
 * enterarse a los quince. Se deriva del percentil 90 de sus propios huecos —
 * el 90% de las veces vendió antes de eso.
 *
 * Medido en el comercio real (2026-08-26): mediana 2 días, p90 13,5, máximo 61.
 * Un umbral fijo de 15 lo habría callado durante el bache de junio y un fijo de
 * 7 lo habría molestado en operación normal.
 *
 * Devuelve `null` cuando no hay con qué decidir, que es distinto de "está
 * todo bien".
 */
export function umbralDeSilencio(huecos: number[]): number | null {
  const validos = huecos.filter(h => Number.isFinite(h) && h > 0).sort((a, b) => a - b);
  if (validos.length === 0) return null;

  // Piso de una semana. Por debajo, un fin de semana largo o un par de días
  // flojos dispararían el aviso, y un aviso que salta seguido enseña a
  // ignorar la lista entera.
  const PISO = 7;

  // Con pocos intervalos el p90 es ruido. Ahí se usa el hueco más largo que el
  // comercio ya vivió: se avisa recién cuando supera todo lo conocido.
  if (validos.length < 8) return Math.max(validos[validos.length - 1], PISO);

  const i = Math.ceil(validos.length * 0.9) - 1;
  return Math.max(validos[Math.min(i, validos.length - 1)], PISO);
}

/** La mediana de los huecos, para poder decir "vendés cada N días". */
export function ritmoHabitual(huecos: number[]): number | null {
  const validos = huecos.filter(h => Number.isFinite(h) && h > 0).sort((a, b) => a - b);
  if (validos.length === 0) return null;
  const m = Math.floor(validos.length / 2);
  return validos.length % 2 ? validos[m] : Math.round((validos[m - 1] + validos[m]) / 2);
}

const ORDEN_URGENCIA: Record<Urgencia, number> = {
  critico: 0, atencion: 1, normal: 2,
};

/**
 * La lista de pendientes, ya ordenada y sin ceros.
 *
 * Devolver `[]` es un resultado válido y significa "no hay nada que hacer" —
 * que es una respuesta útil, no un estado vacío que haya que disimular.
 */
export function construirPendientes(d: DatosFoco): Pendiente[] {
  const lista: Pendiente[] = [];

  // Un pedido pagado y sin despachar es alguien que ya pagó y está esperando.
  // Va primero: es lo único de la lista donde el que espera es un cliente.
  if (d.pedidosPorDespachar > 0) {
    lista.push({
      id: "despachar",
      texto: `${d.pedidosPorDespachar} ${d.pedidosPorDespachar === 1 ? "pedido pagado sin despachar" : "pedidos pagados sin despachar"}`,
      accion: "Despachar",
      destino: "/tienda-online?tab=orders&vista=despachar",
      urgencia: "critico",
    });
  }

  // Un comercio que dejó de registrar ventas es el hecho más importante de la
  // pantalla, y hasta ahora no aparecía en ninguna parte: `platform_org_health`
  // lo sabía —la plataforma veía la organización dormida— pero el comercio no.
  const silencio = d.diasSinRegistrarVenta;
  const umbral = umbralDeSilencio(d.huecosEntreVentas ?? []);
  if (silencio != null && umbral != null && silencio > umbral) {
    const ritmo = ritmoHabitual(d.huecosEntreVentas ?? []);
    lista.push({
      id: "sin-ventas",
      texto: ritmo != null
        // La comparación es lo que lo hace creíble: sin ella son 26 días
        // sueltos que el comercio no sabe si están bien o mal.
        ? `${silencio} días sin registrar una venta (solés vender cada ${ritmo})`
        : `${silencio} días sin registrar una venta`,
      accion: "Registrar una venta",
      destino: "/caja",
      urgencia: "critico",
    });
  }

  if (d.sinStock > 0) {
    lista.push({
      id: "sin-stock",
      texto: `${d.sinStock} ${d.sinStock === 1 ? "producto sin stock" : "productos sin stock"}`,
      accion: "Reponer",
      destino: "/planificacion?vista=reposicion",
      urgencia: "critico",
    });
  }

  // Sólo se avisa de lo vencido, no del total adeudado: una deuda al día no es
  // un pendiente, es el negocio funcionando.
  if (d.deudasVencidas30 > 0) {
    lista.push({
      id: "deuda-vencida",
      texto: `${d.deudasVencidas30} ${d.deudasVencidas30 === 1 ? "deuda vencida hace más de 30 días" : "deudas vencidas hace más de 30 días"}`,
      accion: "Cobrar",
      destino: "/deudas",
      urgencia: "critico",
    });
  } else if (d.deudasPendientes > 0 && d.deudaTotalARS > 0) {
    lista.push({
      id: "deuda",
      texto: `${d.deudasPendientes} ${d.deudasPendientes === 1 ? "deuda por cobrar" : "deudas por cobrar"}`,
      accion: "Ver",
      destino: "/deudas",
      urgencia: "normal",
    });
  }

  if (d.stockBajo > 0) {
    lista.push({
      id: "stock-bajo",
      texto: `${d.stockBajo} ${d.stockBajo === 1 ? "producto por debajo del mínimo" : "productos por debajo del mínimo"}`,
      accion: "Revisar",
      destino: "/productos",
      urgencia: "atencion",
    });
  }

  if (d.seguimientosHoy > 0) {
    lista.push({
      id: "seguimientos",
      texto: `${d.seguimientosHoy} ${d.seguimientosHoy === 1 ? "seguimiento para hoy" : "seguimientos para hoy"}`,
      accion: "Ver",
      destino: "/clientes?vista=seguimientos",
      urgencia: "atencion",
    });
  }

  // Comercio nuevo: sin ruido operativo, el foco es la primera venta y el
  // conteo que deja el stock creíble. Sólo cuando la lista quedó vacía.
  if (lista.length === 0) {
    if (d.nuncaVendio) {
      lista.push({
        id: "primera-venta",
        texto: "Todavía no registraste una venta",
        accion: "Abrir el POS",
        destino: "/caja",
        urgencia: "atencion",
      });
    }
    if (d.sinConteoFisico) {
      lista.push({
        id: "toma-fisica",
        texto: "Todavía no hay una toma física cerrada",
        accion: "Abrir conteo",
        destino: "/kardex",
        urgencia: "normal",
      });
    }
  }

  return lista.sort((a, b) => ORDEN_URGENCIA[a.urgencia] - ORDEN_URGENCIA[b.urgencia]);
}

/**
 * Cómo se lee una variación contra el período anterior.
 *
 * Sin período anterior no se inventa un porcentaje: "sin comparación" es
 * honesto y "+100%" es mentira. Es el mismo error que muestra crecimientos
 * infinitos el primer mes de uso.
 */
export function leerVariacion(
  actual: number,
  anterior: number,
): { pct: number | null; sentido: "sube" | "baja" | "igual" } {
  const a = Number(actual);
  const b = Number(anterior);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) {
    return { pct: null, sentido: "igual" };
  }
  const pct = ((a - b) / b) * 100;
  // Medio punto de diferencia no es una tendencia: mostrarlo como flecha hace
  // que el panel parezca volátil cuando en realidad no pasó nada.
  if (Math.abs(pct) < 0.5) return { pct: 0, sentido: "igual" };
  return { pct: Math.round(pct * 10) / 10, sentido: pct > 0 ? "sube" : "baja" };
}

/** Cuántos pendientes críticos hay, para el color del bloque. */
export function nivelDelDia(pendientes: Pendiente[]): Urgencia {
  if (pendientes.some(p => p.urgencia === "critico")) return "critico";
  if (pendientes.some(p => p.urgencia === "atencion")) return "atencion";
  return "normal";
}
