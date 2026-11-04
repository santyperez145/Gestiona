/**
 * Textos y cuentas de la cola de pedidos online (`/pedidos-online`).
 *
 * 2026-11-04: el recorrido del primer pedido (captura 17) mostró que la cola
 * hablaba de estados internos y no del próximo paso del comercio: un pedido
 * impago decía «Para retirar», la ficha afirmaba que el checkout ya había
 * cobrado una transferencia pendiente y el diálogo de cobro no decía cuánto
 * ni de quién. Todo lo que depende de esas reglas vive acá para probarlo sin
 * montar la pantalla.
 */
import {
  canConfirmManualStorePayment,
  canFulfillStoreOrder,
  esPedidoACuentaCorriente,
  isStorePaymentReversed,
} from "@/lib/storeOrderPayment";
import {
  esPedidoRetiro,
  storeOrderFulfillmentActionLabel,
  storeOrderFulfillmentLabel,
  storeOrderFulfillmentTone,
  type StoreOrderQueueRow,
} from "@/lib/storeOrderQueue";

const ENTREGA_PENDIENTE = new Set(["pending", "unfulfilled", "processing"]);

const pesos = (n: number) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS" }).format(n);

/**
 * Total bruto del pedido con el mismo formato que el diálogo de cobro. 2026-11-04:
 * la franja «esperando el cobro» mostraba «$10.000» a secas al lado de un
 * diálogo que pedía otro importe (el total menos el saldo a favor); se rotula
 * «Total» para que no parezca lo que hay que cobrar.
 */
export function totalDelPedido(total: number | string | null | undefined): string {
  const t = Number(total ?? 0);
  return `Total ${pesos(Number.isFinite(t) ? t : 0)}`;
}

type PedidoConEntrega = {
  carrier?: string | null;
  shipping_service?: string | null;
  payment_status?: string | null;
};

/**
 * Estado de entrega que ve el comercio. 2026-11-04: `storeOrderFulfillmentLabel`
 * decía «Para retirar» en un retiro impago mientras la vista «Para retirar»
 * (que sí exige pago) contaba 0; el comercio entendía que podía entregar sin
 * haber cobrado. Primero manda el pago.
 */
export function estadoDeEntregaVisible(status: string, order?: PedidoConEntrega | null): string {
  const pago = order?.payment_status;
  if (pago != null && !canFulfillStoreOrder(pago) && ENTREGA_PENDIENTE.has(status)) {
    if (isStorePaymentReversed(pago)) return "No entregar";
    return esPedidoRetiro(order) ? "Retira cuando pague" : "Esperando el pago";
  }
  // Un retiro no sale en camino: si alguno quedó en 'shipped' (la base hoy lo
  // rechaza, 2026-11-04), se lee como listo y no como «Enviada».
  if (esPedidoRetiro(order) && status === "shipped") return "Listo para retirar";
  return storeOrderFulfillmentLabel(status, order ?? undefined);
}

export function tonoDeEntregaVisible(status: string, order?: PedidoConEntrega | null): string {
  const pago = order?.payment_status;
  if (pago != null && isStorePaymentReversed(pago) && ENTREGA_PENDIENTE.has(status)) {
    return "bg-destructive/15 text-destructive border-0";
  }
  return storeOrderFulfillmentTone(status);
}

/**
 * Próximo paso del cobro manual, debajo de «Pendiente de pago». 2026-11-04: la
 * columna Pago no decía que era una transferencia que tenía que verificar el
 * propio comercio. Nerqia Pay no lleva pista: lo acredita el aviso del cobro.
 */
export function pistaDeCobroManual(o: { payment_status?: string | null; payment_method?: string | null }): string {
  if (!canConfirmManualStorePayment(o)) return "";
  if (esPedidoACuentaCorriente(o.payment_method)) return "A cuenta corriente · aprobalo para anotar la deuda";
  const m = String(o.payment_method ?? "").toLowerCase().trim();
  if (m === "transferencia") return "Transferencia · fijate en tu banco si llegó y tocá Marcar cobrado";
  if (m === "efectivo") return "Efectivo · cobralo al entregar y tocá Marcar cobrado";
  return "";
}

/** Lo que el comercio tiene que ver entrar: el total menos el saldo a favor que usó el comprador. */
export function montoACobrar(total: number | string | null | undefined, saldoAplicado: number): number {
  const t = Number(total ?? 0);
  const s = Number.isFinite(saldoAplicado) && saldoAplicado > 0 ? saldoAplicado : 0;
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.round((t - s) * 100) / 100);
}

/**
 * Diálogo «¿Marcar como cobrado?». 2026-11-04: decía «Confirmás que viste la
 * transferencia del pedido TN-…» sin importe ni comprador, y con saldo a favor
 * el importe real era menor que el total de la fila.
 */
export function dialogoMarcarCobrado(input: {
  orderNumber: string;
  paymentMethod?: string | null;
  total: number | string | null | undefined;
  customerName?: string | null;
  /**
   * null = no se pudo leer (2026-11-04): no se afirma un importe exacto, porque
   * con saldo a favor el total haría esperar plata que nunca va a entrar.
   */
  saldoAplicado: number | null;
}): { description: string; confirmText: string; aCobrar: number | null } {
  if (input.saldoAplicado === null) {
    const quien = input.customerName?.trim() ? ` de ${input.customerName.trim()}` : "";
    const medio = input.paymentMethod === "efectivo" ? "el efectivo" : "la transferencia";
    return {
      description: `Confirmás que recibiste ${medio}${quien} por el pedido ${input.orderNumber}. No pudimos leer si usó saldo a favor; revisá el importe en la ficha antes de confirmar. Se registra la venta y ya lo podés preparar.`,
      confirmText: "Marcar cobrado",
      aCobrar: null,
    };
  }
  const aCobrar = montoACobrar(input.total, input.saldoAplicado);
  const quien = input.customerName?.trim() ? ` de ${input.customerName.trim()}` : "";
  const extraSaldo = input.saldoAplicado > 0
    ? ` (el total es ${pesos(Number(input.total ?? 0))}; ${pesos(input.saldoAplicado)} se pagaron con saldo a favor)`
    : "";
  const description = input.paymentMethod === "efectivo"
    ? `Confirmás que recibiste ${pesos(aCobrar)} en efectivo${quien} por el pedido ${input.orderNumber}${extraSaldo}. Se registra la venta y ya lo podés preparar.`
    : `Confirmás que recibiste una transferencia de ${pesos(aCobrar)}${quien} por el pedido ${input.orderNumber}${extraSaldo}. Se registra la venta y ya lo podés preparar.`;
  return { description, confirmText: `Marcar cobrado (${pesos(aCobrar)})`, aCobrar };
}

/**
 * Texto del cobro en la ficha. 2026-11-04: decía siempre «El total lo cobró el
 * checkout», también en una transferencia que el comercio todavía no vio.
 */
export function textoDeCobroDeLaFicha(input: {
  payment_status?: string | null;
  payment_method?: string | null;
  customer_name?: string | null;
  aCobrar: number;
}): { texto: string; pendiente: boolean } {
  const quien = input.customer_name?.trim() || "el comprador";
  if (canConfirmManualStorePayment(input)) {
    if (esPedidoACuentaCorriente(input.payment_method)) {
      return { texto: `Todavía no lo aprobaste. Cuando lo apruebes, ${pesos(input.aCobrar)} pasan a la cuenta corriente de ${quien}.`, pendiente: true };
    }
    if (String(input.payment_method ?? "").toLowerCase().trim() === "efectivo") {
      return { texto: `Todavía no lo cobraste. Cuando recibas ${pesos(input.aCobrar)} en efectivo de ${quien}, tocá «Marcar como cobrado».`, pendiente: true };
    }
    return { texto: `Todavía no lo cobraste. Fijate en tu banco o billetera que haya entrado ${pesos(input.aCobrar)} de ${quien}. Cuando lo veas, tocá «Marcar como cobrado».`, pendiente: true };
  }
  const status = input.payment_status ?? "";
  if (isStorePaymentReversed(status)) {
    return { texto: "El pago se devolvió o lo desconocieron. No entregues este pedido.", pendiente: true };
  }
  if (status === "pending" || status === "failed" || status === "partial") {
    return { texto: "Esperando que se acredite el pago. Cuando entre, el pedido se marca solo como cobrado.", pendiente: false };
  }
  return { texto: "Cobrado. La ganancia de la venta aparece abajo cuando queda registrada.", pendiente: false };
}

/** «1 pedido», «2 pedidos»: la cola decía «1 pedidos» (2026-11-04). */
export function cantidadDePedidos(n: number | null | undefined): string {
  const total = Number.isFinite(Number(n)) ? Number(n) : 0;
  return `${total} ${total === 1 ? "pedido" : "pedidos"}`;
}

/**
 * Botón de entrega de la fila. 2026-11-04: se probó un paso «Avisar que está
 * listo» que pasaba el retiro a 'shipped', pero `update_store_order_fulfillment`
 * rechaza ese cambio y el primer toque terminaba siempre en un aviso de error.
 * Queda el flujo que la base acepta («Marcar retiro» / «Ver retiro»); el aviso
 * al comprador va por WhatsApp o teléfono desde el diálogo, sin cambiar el estado.
 */
export function accionDeEntregaDeLaFila(order: StoreOrderQueueRow): string {
  return storeOrderFulfillmentActionLabel(order);
}

/**
 * Celular argentino para wa.me (549 + área + número). El comprador lo escribe
 * como le sale: «11 5555-1234», «011 15 5555 1234», «+54 9 11…». Si no se
 * puede leer sin adivinar, null: queda el enlace tel: y no un chat equivocado.
 */
export function celularParaWhatsApp(raw: string | null | undefined): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  // 2026-11-04: primero se saca la parte nacional (sin 54/549 ni el 0) y recién
  // después se valida; antes «+54 15 5555-1234» y «+54 9 15 5555 1234» salían
  // por los atajos de 54/549 sin pasar por el control del «15» sin área.
  let conPais = false;
  if (d.startsWith("549") && d.length === 13) { d = d.slice(3); conPais = true; }
  else if (d.startsWith("54") && d.length === 12) { d = d.slice(2); conPais = true; }
  else if (d.startsWith("0")) d = d.slice(1);
  // «15 5555-1234» sin área (2026-11-04): no hay área «15»; armarlo así abría
  // el chat de un desconocido.
  if (d.length === 10 && d.startsWith("15")) return null;
  if (d.length === 10) return `549${d}`;
  if (conPais) return null;
  // «11 15 5555-1234»: el 15 va después del área (2 a 4 cifras) y sobra.
  if (d.length === 12) {
    for (const area of [2, 3, 4]) {
      if (d.slice(area, area + 2) === "15") return `549${d.slice(0, area)}${d.slice(area + 2)}`;
    }
  }
  return null;
}

export function enlaceAvisoDeRetiro(order: {
  customer_phone?: string | null;
  customer_name?: string | null;
  order_number: string;
}): string | null {
  const numero = celularParaWhatsApp(order.customer_phone);
  if (!numero) return null;
  const nombre = order.customer_name?.trim() ? ` ${order.customer_name.trim()}` : "";
  const texto = `Hola${nombre}, tu pedido ${order.order_number} ya está listo para retirar.`;
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}

/**
 * Vistas de la cola que se muestran. 2026-11-04: a 1280×720 nueve vistas casi
 * todas en 0 empujaban el primer pedido debajo del pliegue. Se ven «Todas»,
 * «Pendientes de pago», la vista abierta y las que tienen pedidos; mientras
 * carga o con error se ven todas, así no salta el layout.
 */
export function vistaVisible(
  id: string,
  ctx: { view: string; loading: boolean; error: string | null; counts?: Partial<Record<string, number>> | null },
): boolean {
  if (id === "todas" || id === "pago" || id === ctx.view) return true;
  if (ctx.loading || ctx.error || !ctx.counts) return true;
  return (ctx.counts[id] ?? 0) > 0;
}
