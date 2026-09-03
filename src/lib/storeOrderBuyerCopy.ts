import { esMedioGestionaPay } from "@/lib/gestionaPay";

/**
 * Copy de confirmación: retiro ≠ envío.
 *
 * El recorte 126 separó la cola del comercio (Square/Shopify: pickup no se
 * despacha). La página de gracias y el mail al comprador seguían diciendo
 * «preparando tu envío» con carrier=retiro. Estas frases son el espejo de
 * `esPedidoRetiro`: un solo criterio, dos superficies.
 */

/**
 * Hint del checkout según el medio elegido.
 * Tiendanube/Shopify muestran instrucción de transferencia o efectivo;
 * no «te contactamos» cuando el comprador ya tiene CBU en la página de gracias.
 * Null = Gestiona Pay u otro medio que no necesita aviso offline.
 */
export function avisoCheckoutMedioPago(opts: {
  metodo: string | null | undefined;
  esRetiro: boolean;
}): string | null {
  const m = String(opts.metodo ?? "").toLowerCase().trim();
  if (!m || esMedioGestionaPay(m)) return null;
  if (m === "transferencia") {
    return opts.esRetiro
      ? "Al confirmar vas a ver los datos para transferir. Cuando acredite, te avisamos para retirar."
      : "Al confirmar vas a ver los datos para transferir. Cuando acredite, preparamos el envío.";
  }
  if (m === "efectivo") {
    return opts.esRetiro
      ? "Pagás en efectivo al retirar el pedido."
      : "Pagás en efectivo al recibir el pedido.";
  }
  return opts.esRetiro
    ? "Te contactamos para coordinar el pago y el retiro."
    : "Te contactamos para coordinar el pago y la entrega.";
}

export function etiquetaMedioCheckout(metodo: string, esRetiro: boolean): string {
  const m = String(metodo ?? "").toLowerCase().trim();
  if (esMedioGestionaPay(m)) return "Gestiona Pay";
  if (m === "transferencia") return "Transferencia bancaria";
  if (m === "efectivo") return esRetiro ? "Efectivo al retirar" : "Efectivo al recibir";
  return metodo;
}

export function introPedidoPagado(esRetiro: boolean): string {
  return esRetiro
    ? "Te avisamos cuando el pedido esté listo para retirar."
    : "Ya estamos preparando tu envío. Te avisamos cuando salga.";
}

export function etiquetaCostoEntrega(esRetiro: boolean): string {
  return esRetiro ? "Retiro" : "Envío";
}

export function etiquetaDireccionEntrega(esRetiro: boolean): string {
  return esRetiro ? "Retiro en" : "Envío a";
}

export function introPagoRevertido(esRetiro: boolean): string {
  return esRetiro
    ? "El retiro queda en pausa mientras gestionamos esta reversión."
    : "El pedido no se enviará mientras gestionamos esta reversión.";
}

/** Asunto + cuerpo del aviso de estado. No inventa un evento nuevo. */
export function copyEstadoPedido(
  event: "shipped" | "delivered",
  esRetiro: boolean,
): { subject: string; title: string; intro: string } {
  if (esRetiro) {
    if (event === "delivered") {
      return {
        subject: "Tu pedido fue retirado",
        title: "¡Pedido retirado!",
        intro: "Registramos que retiraste tu compra. Si necesitás ayuda, escribinos.",
      };
    }
    return {
      subject: "Tu pedido está listo para retirar",
      title: "Tu pedido está listo para retirar",
      intro: "Ya podés pasar a buscarlo. Si necesitás ayuda, escribinos.",
    };
  }
  if (event === "shipped") {
    return {
      subject: "Tu pedido está en camino",
      title: "Tu pedido ya está en camino",
      intro: "Ya entregamos tu compra al transporte. Podés seguir su estado desde tu pedido.",
    };
  }
  return {
    subject: "Tu pedido fue entregado",
    title: "¡Tu pedido fue entregado!",
    intro: "Tu compra figura como entregada. Si necesitás ayuda, escribinos y lo resolvemos.",
  };
}

export function textoWhatsAppPedido(opts: {
  orderNumber: string;
  totalFmt: string;
  esRetiro: boolean;
  pagado: boolean;
  pagoRevertido: boolean;
  transferenciaPendiente: boolean;
  chargedBack?: boolean;
}): string {
  const n = opts.orderNumber;
  const total = opts.totalFmt;
  if (opts.pagoRevertido) {
    return opts.chargedBack
      ? `Hola! El pago del pedido ${n} fue desconocido. Quiero coordinar cómo seguimos.`
      : `Hola! El pago del pedido ${n} fue devuelto. Quiero coordinar cómo seguimos.`;
  }
  if (opts.transferenciaPendiente) {
    return `Hola! Acabo de hacer el pedido ${n} por ${total}. Ya tengo los datos para transferir.`;
  }
  if (opts.pagado) {
    return opts.esRetiro
      ? `Hola! Sobre el pedido ${n} por ${total}: es retiro en tienda.`
      : `Hola! Sobre el pedido ${n} por ${total}: quiero consultar el envío.`;
  }
  return `Hola! Acabo de hacer el pedido ${n} por ${total}. Quedo atento para coordinar el pago.`;
}

export function etiquetaWhatsAppPedido(pagado: boolean): string {
  return pagado ? "Consultar por WhatsApp" : "Coordinar por WhatsApp";
}

/** Pasos del seguimiento público. Misma semántica de ids de fulfillment. */
export function pasosSeguimiento(esRetiro: boolean): { id: string; label: string }[] {
  if (esRetiro) {
    return [
      { id: "pending", label: "Pedido recibido" },
      { id: "processing", label: "Preparando tu pedido" },
      { id: "shipped", label: "Listo para retirar" },
      { id: "delivered", label: "Retirado" },
    ];
  }
  return [
    { id: "pending", label: "Pedido recibido" },
    { id: "processing", label: "Preparando el envío" },
    { id: "shipped", label: "En camino" },
    { id: "delivered", label: "Entregado" },
  ];
}

/** `unfulfilled` es el pendiente canónico de la cola; en la línea es «recibido». */
export function indicePasoSeguimiento(
  fulfillmentStatus: string | null | undefined,
  esRetiro: boolean,
): number {
  const pasos = pasosSeguimiento(esRetiro);
  const raw = String(fulfillmentStatus ?? "").toLowerCase().trim();
  const id = raw === "unfulfilled" ? "pending" : raw;
  return Math.max(0, pasos.findIndex((p) => p.id === id));
}
