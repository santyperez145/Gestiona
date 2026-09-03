/**
 * Copy de confirmación: retiro ≠ envío.
 *
 * El recorte 126 separó la cola del comercio (Square/Shopify: pickup no se
 * despacha). La página de gracias y el mail al comprador seguían diciendo
 * «preparando tu envío» con carrier=retiro. Estas frases son el espejo de
 * `esPedidoRetiro`: un solo criterio, dos superficies.
 */

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
