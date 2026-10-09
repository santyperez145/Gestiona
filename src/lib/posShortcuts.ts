/**
 * Atajos de teclado del POS: una sola tabla para el manejador y la ayuda.
 *
 * Las teclas de función funcionan aunque el foco esté en un campo (el cajero
 * suele estar en el buscador); las teclas de texto (`+`, `-`, `?`, Supr) sólo
 * fuera de campos para no robarle caracteres a lo que se escribe. F12 queda
 * libre: el navegador la usa para herramientas de desarrollo.
 */

export type AccionPos =
  | "ayuda" | "buscar" | "cliente" | "medio_siguiente" | "pantalla_completa" | "cupon"
  | "guardar_ticket" | "tickets_guardados" | "cobrar" | "factura_arca"
  | "medio_1" | "medio_2" | "medio_3" | "medio_4"
  | "quitar_ultimo" | "vaciar_carrito" | "mas" | "menos" | "escape";

export const ATAJOS_POS: { teclas: string; accion: AccionPos; descripcion: string }[] = [
  { teclas: "F1 / ?", accion: "ayuda", descripcion: "Mostrar u ocultar esta ayuda" },
  { teclas: "F2", accion: "buscar", descripcion: "Buscar producto (nombre, código o escáner)" },
  { teclas: "F3", accion: "cliente", descripcion: "Elegir o dar de alta el cliente del ticket" },
  { teclas: "F4", accion: "medio_siguiente", descripcion: "Cambiar al siguiente medio de pago" },
  { teclas: "Alt+1…4", accion: "medio_1", descripcion: "Efectivo · Transferencia · Débito · Crédito" },
  { teclas: "F6", accion: "cupon", descripcion: "Ingresar cupón de descuento" },
  { teclas: "F7", accion: "guardar_ticket", descripcion: "Dejar el ticket en espera" },
  { teclas: "F8", accion: "tickets_guardados", descripcion: "Ver tickets en espera" },
  { teclas: "F9", accion: "cobrar", descripcion: "Cobrar y confirmar la venta" },
  { teclas: "F10", accion: "factura_arca", descripcion: "Pedir o no factura ARCA para este ticket" },
  { teclas: "F5 / F11", accion: "pantalla_completa", descripcion: "Pantalla completa (F5 no recarga y no pierde el carrito)" },
  { teclas: "+ / −", accion: "mas", descripcion: "Sumar o restar una unidad al último producto" },
  { teclas: "Supr", accion: "quitar_ultimo", descripcion: "Quitar el último producto del carrito" },
  { teclas: "Ctrl+Supr", accion: "vaciar_carrito", descripcion: "Vaciar el carrito (pide confirmación)" },
  { teclas: "Esc", accion: "escape", descripcion: "Cerrar ayuda o limpiar la búsqueda" },
];

const FUNCIONES: Record<string, AccionPos> = {
  F1: "ayuda", F2: "buscar", F3: "cliente", F4: "medio_siguiente", F5: "pantalla_completa",
  F6: "cupon", F7: "guardar_ticket", F8: "tickets_guardados", F9: "cobrar", F10: "factura_arca",
  F11: "pantalla_completa",
};

export function accionDeTecla(
  e: { key: string; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
  enCampo: boolean,
): AccionPos | null {
  if (FUNCIONES[e.key]) return FUNCIONES[e.key];
  if (e.altKey && !e.ctrlKey && /^[1-4]$/.test(e.key)) return `medio_${e.key}` as AccionPos;
  if (e.key === "Escape") return "escape";
  if (enCampo) return null;
  if ((e.ctrlKey || e.metaKey) && e.key === "Delete") return "vaciar_carrito";
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key === "Delete") return "quitar_ultimo";
  if (e.key === "?") return "ayuda";
  if (e.key === "+") return "mas";
  if (e.key === "-") return "menos";
  return null;
}

/** Medio de pago siguiente entre los que la caja muestra, en orden y circular. */
export function medioSiguiente<T extends string>(visibles: T[], actual: T): T {
  if (!visibles.length) return actual;
  const i = visibles.indexOf(actual);
  return visibles[(i + 1) % visibles.length];
}
