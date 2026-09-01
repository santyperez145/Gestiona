/**
 * Gestiona Pay — producto propio, rails de terceros.
 *
 * El dinero no lo custodia Gestiona. El producto sí: checkout, onboarding,
 * PaymentIntent, conciliación, reintegros, comisión y soporte. El procesador
 * de Argentina es Mercado Pago (OAuth, split, QR, Point). Stripe no es rail
 * doméstico a 2026-09-01; el adapter existe para mercados donde Connect esté
 * contratado. Payway y dLocal esperan contrato. No hay PSP ni wallet propia.
 */

export type GestionaPayProvider = "mercadopago" | "stripe" | "payway" | "dlocal";

export type GestionaPayEvent =
  | "payment.created"
  | "payment.authorized"
  | "payment.succeeded"
  | "payment.failed"
  | "payment.refunded"
  | "payment.disputed"
  | "payout.created"
  | "payout.paid"
  | "payout.failed"
  | "merchant.requirements_updated";

export interface DecisionDeRail {
  provider: GestionaPayProvider;
  /** false = hay que activar ese rail; no se cobra todavía. */
  listo: boolean;
  motivo: string;
}

const STRIPE_MARKETS = new Set([
  "US", "GB", "CA", "AU", "NZ", "IE", "FR", "DE", "ES", "IT", "NL", "PT", "BE", "AT", "CH", "SE", "NO", "DK", "FI",
]);

export function mercadoPagoCubre(pais: string): boolean {
  return ["AR", "BR", "MX", "CL", "CO", "PE", "UY"].includes(String(pais ?? "").toUpperCase());
}

export function stripeCubre(pais: string): boolean {
  return STRIPE_MARKETS.has(String(pais ?? "").toUpperCase());
}

/**
 * Elige el procesador. En Argentina Stripe conectado no gana: no hay cuenta
 * estándar confirmada como rail doméstico y el split de MP ya cobra comisión.
 */
export function decidirRailGestionaPay(input: {
  pais: string;
  conectados: GestionaPayProvider[];
}): DecisionDeRail {
  const pais = String(input.pais ?? "").toUpperCase();
  const conectados = new Set(input.conectados ?? []);

  if (mercadoPagoCubre(pais)) {
    return {
      provider: "mercadopago",
      listo: conectados.has("mercadopago"),
      motivo: conectados.has("mercadopago")
        ? "Gestiona Pay orquesta Mercado Pago: el dinero va a la cuenta del comercio."
        : "En este mercado Gestiona Pay se activa con Mercado Pago. Stripe no cobra acá.",
    };
  }

  if (stripeCubre(pais)) {
    return {
      provider: "stripe",
      listo: conectados.has("stripe"),
      motivo: conectados.has("stripe")
        ? "Gestiona Pay orquesta Stripe Connect en un mercado soportado."
        : "Este mercado usa Stripe Connect cuando haya contrato. No se pegan claves.",
    };
  }

  return {
    provider: "dlocal",
    listo: conectados.has("dlocal"),
    motivo: "Sin rail doméstico propio. dLocal es la opción regional, no el piloto argentino.",
  };
}

export function eventoCanonicoMercadoPago(status: string | null | undefined): GestionaPayEvent | null {
  switch (String(status ?? "").toLowerCase()) {
    case "approved":
    case "accredited":
      return "payment.succeeded";
    case "authorized":
      return "payment.authorized";
    case "pending":
    case "in_process":
    case "in_mediation":
      return "payment.created";
    case "rejected":
    case "cancelled":
      return "payment.failed";
    case "refunded":
    case "partially_refunded":
      return "payment.refunded";
    case "charged_back":
      return "payment.disputed";
    default:
      return null;
  }
}

export function eventoCanonicoStripe(type: string | null | undefined): GestionaPayEvent | null {
  switch (String(type ?? "")) {
    case "payment_intent.succeeded":
    case "checkout.session.completed":
    case "charge.succeeded":
      return "payment.succeeded";
    case "payment_intent.amount_capturable_updated":
      return "payment.authorized";
    case "payment_intent.created":
      return "payment.created";
    case "payment_intent.payment_failed":
    case "charge.failed":
      return "payment.failed";
    case "charge.refunded":
    case "refund.created":
      return "payment.refunded";
    case "charge.dispute.created":
      return "payment.disputed";
    case "payout.created":
      return "payout.created";
    case "payout.paid":
      return "payout.paid";
    case "payout.failed":
      return "payout.failed";
    case "account.updated":
      return "merchant.requirements_updated";
    default:
      return null;
  }
}

/**
 * Tras el OAuth, Mercado Pago siempre vuelve a `MP_OAUTH_REDIRECT_URI`.
 * El destino real (tienda o integraciones) viaja en `oauth_states.redirect_to`.
 * Sólo se aceptan rutas propias: un returnUrl absoluto a otro origen sería
 * un open redirect.
 */
export function destinoOAuthPermitido(url: string | null | undefined, origin: string): string | null {
  if (!url || !origin) return null;
  try {
    const parsed = new URL(url, origin);
    if (parsed.origin !== origin) return null;
    const path = parsed.pathname;
    if (path === "/integraciones" || path === "/tienda-online" || path.startsWith("/tienda-online/")) {
      return `${parsed.pathname}${parsed.search}`;
    }
    return null;
  } catch {
    return null;
  }
}
