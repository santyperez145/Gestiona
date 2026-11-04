/**
 * Un cobro, una venta.
 *
 * 2026-11-04: después de cobrar online el carrito no se vaciaba y F9 seguía
 * cobrando con el recibo abierto: la misma venta se registraba dos veces
 * (doble ingreso en Caja y doble descuento de stock). `confirmSale` no tenía
 * ninguna guarda propia y el estado `submitting` de React llega tarde: entre
 * que se pide el cambio y que se vuelve a pintar, una segunda tecla todavía
 * ve el carrito lleno. Estas piezas cortan el segundo cobro de forma
 * sincrónica, sin esperar a React.
 */
import type { AccionPos } from "./posShortcuts";

export interface EstadoDelCobro {
  /** Renglones en el carrito. */
  renglones: number;
  /** Ya hay una venta registrándose. */
  registrando: boolean;
  /** El recibo de la venta anterior sigue en pantalla. */
  reciboAbierto: boolean;
  /** Hay un cobro con QR esperando la acreditación. */
  cobroQrAbierto: boolean;
}

/** Con cualquiera de estas condiciones, cobrar crearía una venta repetida o vacía. */
export function cobroBloqueado(estado: EstadoDelCobro): boolean {
  return estado.renglones === 0 || estado.registrando || estado.reciboAbierto || estado.cobroQrAbierto;
}

export interface CandadoDeCobro {
  /** Devuelve `false` si ya hay un cobro en curso. */
  tomar(): boolean;
  soltar(): void;
  readonly tomado: boolean;
}

/** Candado sincrónico: lo que pasa entre dos teclas no depende de un render. */
export function crearCandadoDeCobro(): CandadoDeCobro {
  let tomado = false;
  return {
    tomar() {
      if (tomado) return false;
      tomado = true;
      return true;
    },
    soltar() {
      tomado = false;
    },
    get tomado() {
      return tomado;
    },
  };
}

/**
 * Corre `cobrar` sólo si no hay otro cobro en curso y `puedeCobrar()` lo
 * permite en ese mismo instante. Devuelve si el cobro se intentó.
 */
export async function cobrarUnaSolaVez(
  candado: CandadoDeCobro,
  puedeCobrar: () => boolean,
  cobrar: () => Promise<void>,
): Promise<boolean> {
  if (!puedeCobrar()) return false;
  if (!candado.tomar()) return false;
  try {
    await cobrar();
    return true;
  } finally {
    candado.soltar();
  }
}

/**
 * Cierre de un cobro QR acreditado.
 *
 * 2026-11-04: el candado de `cobrarUnaSolaVez` se suelta en cuanto el QR
 * queda esperando el pago, y al acreditarse el diálogo se cerraba antes de
 * registrar la venta (auditoría, factura en ARCA, refresco del catálogo). En
 * ese tramo el carrito seguía lleno, no había diálogo ni recibo y F9 armaba un
 * segundo QR con el mismo carrito: si se pagaba, era otra venta. El ciclo QR
 * (`cicloQr`) se toma al pedir el QR y recién se suelta acá, cuando la venta
 * quedó registrada (o falló), o cuando el cajero cancela el QR.
 *
 * El cierre no depende de poder tomar nada: la plata ya entró y el recibo se
 * muestra igual.
 */
export async function cerrarCobroQrAcreditado(
  cicloQr: CandadoDeCobro,
  cerrarDialogo: () => void,
  registrarVenta: () => Promise<void>,
): Promise<void> {
  // Por si el QR llegó acá sin haber pasado por el pedido (no debería).
  cicloQr.tomar();
  cerrarDialogo();
  try {
    await registrarVenta();
  } finally {
    cicloQr.soltar();
  }
}

/**
 * Contexto con el que se retoma un cobro QR.
 *
 * 2026-11-04: «Consultar el mismo cobro» de un QR en vivo en revisión manual
 * lo convertía en recuperado (sin carrito ni ids). Ningún cierre soltaba
 * después el ciclo QR y la caja quedaba trabada hasta recargar; si se
 * acreditaba, el carrito quedaba lleno y listo para cobrarse otra vez. El QR
 * del ciclo en vivo sigue siendo en vivo: conserva carrito, ids y ciclo.
 */
export function contextoParaReanudarQr<C extends { recovered?: boolean }>(
  delCicloEnVivo: C | null | undefined,
  recuperado: C,
): C {
  return delCicloEnVivo && !delCicloEnVivo.recovered ? delCicloEnVivo : recuperado;
}

/**
 * Atajos que tocan el ticket. Con un diálogo abierto (recibo, QR, confirmar)
 * no se ejecutan: el cajero no ve el carrito y no puede saber qué cambió.
 */
const ACCIONES_DEL_TICKET: ReadonlySet<AccionPos> = new Set<AccionPos>([
  "cobrar",
  "vaciar_carrito",
  "quitar_ultimo",
  "mas",
  "menos",
]);

export function atajoBloqueadoPorDialogo(accion: AccionPos, hayDialogoAbierto: boolean): boolean {
  return hayDialogoAbierto && ACCIONES_DEL_TICKET.has(accion);
}

const DIALOGO_MODAL_ABIERTO = '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

export function hayDialogoModalAbierto(raiz: Pick<ParentNode, "querySelector"> | null | undefined): boolean {
  return Boolean(raiz?.querySelector(DIALOGO_MODAL_ABIERTO));
}

/**
 * Ventas que cerró esta pestaña. El aviso en tiempo real de «Nueva venta»
 * repetía el de la propia caja y tapaba el recibo; quien escucha el canal de
 * la organización consulta este registro para no avisar dos veces.
 */
// 2026-11-04: guarda el vencimiento de cada id en vez de un temporizador por
// marca. La caja marca los ids ANTES de crear la venta (el aviso del trigger
// llega antes de que termine el cobro) y el QR vuelve a marcar en cada
// sondeo: volver a marcar extiende la vigencia, nunca la acorta.
const ventasPropias = new Map<string, number>();

/** Vigencia de la marca de un cobro QR: cubre la espera del pago. */
export const VIGENCIA_MARCA_QR_MS = 30 * 60_000;

export function marcarVentasPropias(ids: readonly string[], vigenciaMs = 60_000): void {
  const ahora = Date.now();
  for (const [id, vence] of ventasPropias) {
    if (vence <= ahora) ventasPropias.delete(id);
  }
  const vence = ahora + vigenciaMs;
  ids.filter(Boolean).forEach((id) => {
    ventasPropias.set(id, Math.max(ventasPropias.get(id) ?? 0, vence));
  });
}

export function esVentaPropia(id: string | null | undefined): boolean {
  if (!id) return false;
  const vence = ventasPropias.get(id);
  return vence !== undefined && vence > Date.now();
}

export interface VentaDelAviso {
  id: string;
  product_name: string | null;
  customer_name: string | null;
}

/**
 * Texto del aviso «Nueva venta» que llega por tiempo real, o `null` si no hay
 * que mostrarlo.
 *
 * 2026-11-04 (#29): el comerciante que acaba de cobrar ya ve el recibo; el eco
 * de su propia venta lo tapaba. Si todos los renglones son de esta pestaña, no
 * se avisa (los contadores se actualizan igual: eso lo decide quien llama).
 * Sin cliente cargado no se escribe «· Cliente».
 */
export function avisoDeNuevaVenta(
  ventas: readonly VentaDelAviso[],
  total: number,
): { titulo: string; descripcion: string } | null {
  if (ventas.length > 0 && ventas.every((v) => esVentaPropia(v.id))) return null;
  const primera = ventas[0];
  const producto = primera?.product_name || "Venta";
  const cliente = primera?.customer_name?.trim() || "";
  const quePaso = ventas.length > 1 ? `${ventas.length} productos` : producto;
  return {
    titulo: `💰 Nueva venta: $${Math.round(total).toLocaleString("es-AR")}`,
    descripcion: cliente ? `${quePaso} · ${cliente}` : quePaso,
  };
}
