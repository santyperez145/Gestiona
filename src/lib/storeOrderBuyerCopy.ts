import { esMedioGestionaPay } from "@/lib/gestionaPay";
import { parseStoreSocial } from "@/lib/storeSocial";
import { fechaLocal } from "@/lib/fechaAR";

/**
 * Copy de confirmación: retiro ≠ envío.
 *
 * El recorte 126 separó la cola del comercio (plataformas de comercio: pickup no se
 * despacha). La página de gracias y el mail al comprador seguían diciendo
 * «preparando tu envío» con carrier=retiro. Estas frases son el espejo de
 * `esPedidoRetiro`: un solo criterio, dos superficies.
 */

/**
 * Hint del checkout según el medio elegido.
 * Las plataformas de comercio muestran instrucción de transferencia o efectivo;
 * no «te contactamos» cuando el comprador ya tiene CBU en la página de gracias.
 * Null = Nerqia Pay u otro medio que no necesita aviso offline.
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
  if (m === "cuenta_corriente") {
    return "El comercio aprueba el pedido y lo carga a tu cuenta corriente, dentro de tu crédito.";
  }
  if (m === "saldo_a_favor") {
    return "Se descuenta de tu saldo a favor al confirmar: el pedido queda pagado en el acto.";
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
  if (esMedioGestionaPay(m)) return "Nerqia Pay";
  if (m === "transferencia") return "Transferencia bancaria";
  if (m === "efectivo") return esRetiro ? "Efectivo al retirar" : "Efectivo al recibir";
  if (m === "cuenta_corriente") return "A cuenta corriente";
  if (m === "saldo_a_favor") return "Con mi saldo a favor";
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

/**
 * 2026-11-04: intro de un pedido sin pagar que no es transferencia ni pago
 * revertido. Si el pago se hace online en la misma página (Nerqia Pay,
 * pendiente o rechazado), se pide usar el botón: mandar a escribirle al
 * comercio era un paso de más. Para los medios manuales (efectivo, a
 * convenir) se manda al contacto del comercio, o a guardar el número si la
 * tienda no cargó ninguno. El mail del comprador se muestra aparte.
 */
export function introPedidoSinPagar(opts: { pagoOnline: boolean; hayContacto: boolean; confirmando?: boolean }): string {
  // Mientras se confirma no hay botón abajo (2026-11-04): «con el botón de
  // abajo» empujaba a pagar otra vez justo cuando se pide que no lo haga.
  if (opts.confirmando) return "Estamos confirmando tu pago.";
  if (opts.pagoOnline) return "Completá el pago con el botón de abajo.";
  return opts.hayContacto
    ? "Para coordinar el pago y la entrega, escribile al comercio (contacto abajo)."
    : "Guardá este número de pedido para coordinar el pago y la entrega con el comercio.";
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
    // 2026-11-04: decía «Ya tengo los datos para transferir» y no mencionaba
    // el comprobante: el comercio no tenía cómo atar la transferencia al pedido.
    return `Hola! Hice el pedido ${n} por ${total} y lo pago por transferencia. Te mando el comprobante.`;
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

/**
 * Enlace de WhatsApp de la página de gracias, al número del comercio.
 *
 * 2026-11-04: el botón armaba `https://wa.me/?text=…` sin número: abría
 * WhatsApp y el comprador tenía que elegir a quién mandarle el mensaje (un
 * contacto propio). Sin WhatsApp cargado en la tienda devuelve null y la
 * página no muestra el botón: nunca se abre WhatsApp sin destino.
 */
export function enlaceWhatsAppPedido(socialLinks: unknown, texto: string): string | null {
  const base = parseStoreSocial(socialLinks).whatsapp; // https://wa.me/<dígitos>, sin query
  if (!base) return null;
  return `${base}?text=${encodeURIComponent(texto)}`;
}

// Sin espacios, comillas, «<>», «?», «&», «#», «%» ni saltos de línea: lo que
// pasa se puede pegar tal cual en un mailto sin que agregue destinatarios ni
// encabezados.
const EMAIL_CONTACTO = /^[A-Za-z0-9._+-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/**
 * Mail público del comercio, si lo cargó en `social_links.email`.
 *
 * 2026-11-04: sin WhatsApp, la página de gracias decía «el comercio te va a
 * escribir y se lo mandás respondiendo ese mail». Nada hace que el comercio
 * escriba, y el mail del pedido sale del remitente de la plataforma sin
 * reply_to: la respuesta no le llegaba. Ahora el comprobante va al mail del
 * comercio, y sólo si existe; si no, no se promete nada.
 */
export function emailContactoTienda(socialLinks: unknown): string | null {
  if (!socialLinks || typeof socialLinks !== "object" || Array.isArray(socialLinks)) return null;
  const raw = (socialLinks as Record<string, unknown>).email;
  if (typeof raw !== "string") return null;
  const t = raw.trim().replace(/^mailto:/i, "");
  if (t.length > 254 || !EMAIL_CONTACTO.test(t)) return null;
  return t;
}

/**
 * mailto al comercio con el número de pedido en el asunto, para que el
 * comprobante quede atado al pedido. null si el mail no es válido.
 */
export function enlaceMailComprobante(email: string | null | undefined, orderNumber: string): string | null {
  const destino = emailContactoTienda({ email });
  if (!destino) return null;
  const n = String(orderNumber ?? "").trim();
  const asunto = n ? `Comprobante del pedido ${n}` : "Comprobante de mi pedido";
  const cuerpo = n
    ? `Hola! Te mando el comprobante de la transferencia del pedido ${n}.`
    : "Hola! Te mando el comprobante de la transferencia.";
  return `mailto:${destino}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
}

/** mailto de consulta general por el pedido (sin hablar de comprobante). */
export function enlaceMailPedido(email: string | null | undefined, orderNumber: string): string | null {
  const destino = emailContactoTienda({ email });
  if (!destino) return null;
  const n = String(orderNumber ?? "").trim();
  return `mailto:${destino}?subject=${encodeURIComponent(n ? `Pedido ${n}` : "Mi pedido")}`;
}

/** Medios de contacto del comercio que se pueden mostrar. Nada se inventa. */
export type ContactoTienda = {
  whatsapp: string | null;
  email: string | null;
  instagram: string | null;
};

export function contactoDeLaTienda(socialLinks: unknown): ContactoTienda {
  const social = parseStoreSocial(socialLinks);
  return {
    whatsapp: social.whatsapp ?? null,
    email: emailContactoTienda(socialLinks),
    instagram: social.instagram ?? null,
  };
}

/**
 * Cómo le llega el comprobante al comercio, en orden de preferencia.
 * «guardar» = no hay canal: se le pide al comprador que lo guarde, sin
 * prometer que el comercio le va a escribir.
 */
export function canalComprobante(contacto: ContactoTienda): "whatsapp" | "email" | "guardar" {
  if (contacto.whatsapp) return "whatsapp";
  if (contacto.email) return "email";
  return "guardar";
}

/**
 * Importe para pegar en el campo de monto del banco o de la billetera.
 *
 * 2026-11-04: el botón copiaba «$ 12.500» (signo, espacio y punto de miles);
 * pegado en una app bancaria se rechazaba o se leía como 12,5. Va sin signo
 * ni separador de miles, con coma decimal sólo si hay centavos.
 */
export function importeParaCopiar(monto: number): string {
  const n = Number(monto);
  if (!Number.isFinite(n)) return "";
  const centavos = Math.round(Math.abs(n) * 100);
  const signo = n < 0 && centavos > 0 ? "-" : "";
  const enteros = Math.floor(centavos / 100);
  const resto = centavos % 100;
  return resto === 0
    ? `${signo}${enteros}`
    : `${signo}${enteros},${String(resto).padStart(2, "0")}`;
}

/**
 * Importe a la vista en «Datos para transferir». El formato general de la
 * tienda redondea a pesos; acá se pide el importe exacto, así que si hay
 * centavos se muestran (si no, lo que se ve y lo que se copia no coinciden).
 */
export function importeVisibleTransferencia(monto: number, currency?: string | null): string {
  const n = Number(monto);
  const centavos = Math.round(Math.abs(n) * 100) % 100;
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: currency || "ARS",
    minimumFractionDigits: centavos === 0 ? 0 : 2,
    maximumFractionDigits: centavos === 0 ? 0 : 2,
  }).format(Number.isFinite(n) ? Math.round(n * 100) / 100 : 0);
}

/** Id del paso de espera de la transferencia: no es un estado de fulfillment. */
export const PASO_ESPERANDO_PAGO = "awaiting_payment";

/**
 * Pasos del seguimiento público. Misma semántica de ids de fulfillment.
 *
 * 2026-11-04: con la transferencia pendiente se mostraba «Pedido recibido ✓»
 * y después «Preparando tu pedido»: el comprador no veía que el siguiente
 * paso dependía de él. Con `pagoPendiente` se intercala «Esperando tu
 * transferencia» después de «Pedido recibido».
 */
export function pasosSeguimiento(esRetiro: boolean, pagoPendiente = false): { id: string; label: string }[] {
  const base = esRetiro
    ? [
      { id: "pending", label: "Pedido recibido" },
      { id: "processing", label: "Preparando tu pedido" },
      { id: "shipped", label: "Listo para retirar" },
      { id: "delivered", label: "Retirado" },
    ]
    : [
      { id: "pending", label: "Pedido recibido" },
      { id: "processing", label: "Preparando el envío" },
      { id: "shipped", label: "En camino" },
      { id: "delivered", label: "Entregado" },
    ];
  if (!pagoPendiente) return base;
  return [base[0]!, { id: PASO_ESPERANDO_PAGO, label: "Esperando tu transferencia" }, ...base.slice(1)];
}

/** `unfulfilled` es el pendiente canónico de la cola; en la línea es «recibido». */
export function indicePasoSeguimiento(
  fulfillmentStatus: string | null | undefined,
  esRetiro: boolean,
  pagoPendiente = false,
): number {
  const pasos = pasosSeguimiento(esRetiro, pagoPendiente);
  const raw = String(fulfillmentStatus ?? "").toLowerCase().trim();
  const id = raw === "unfulfilled" ? "pending" : raw;
  return Math.max(0, pasos.findIndex((p) => p.id === id));
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/**
 * Fecha de un paso del seguimiento: «4 de noviembre».
 *
 * 2026-11-04: con toLocaleDateString({ day: "2-digit", month: "long" }) el
 * Chromium del CI devolvía «04-noviembre», porque el formato depende de los
 * datos ICU de cada navegador. Se arma a mano, con el mismo día que antes
 * (fechaLocal: una fecha sola AAAA-MM-DD no se corre de día).
 */
export function fechaSeguimiento(iso?: string | null): string | null {
  if (!iso) return null;
  const d = fechaLocal(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getDate()} de ${MESES[d.getMonth()]}`;
}
