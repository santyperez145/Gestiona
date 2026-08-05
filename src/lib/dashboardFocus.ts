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
      destino: "/tienda-online",
      urgencia: "critico",
    });
  }

  if (d.sinStock > 0) {
    lista.push({
      id: "sin-stock",
      texto: `${d.sinStock} ${d.sinStock === 1 ? "producto sin stock" : "productos sin stock"}`,
      accion: "Reponer",
      destino: "/restock",
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
      destino: "/seguimiento",
      urgencia: "atencion",
    });
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
