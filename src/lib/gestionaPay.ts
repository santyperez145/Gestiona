/**
 * Nerqia Pay — producto propio, rails de terceros.
 *
 * El dinero no lo custodia Nerqia. El producto sí: checkout, onboarding,
 * PaymentIntent, conciliación, reintegros, comisión y soporte.
 *
 * 📌 Nerqia Pay ≠ Mercado Pago. Pay es el producto (como Pago Nube).
 * Mercado Pago es el rail de procesamiento en Argentina (OAuth, split, QR).
 * En la tienda el medio canónico es `gestiona_pay`; `mercadopago` queda
 * sólo como alias de lectura por órdenes y configs viejas.
 * `payment_connections.provider` y el OAuth siguen siendo `mercadopago`.
 */

export type GestionaPayProvider = "mercadopago" | "stripe" | "payway" | "dlocal";

/** Medio de la tienda online: el producto, no el rail. */
export const MEDIO_GESTIONA_PAY = "gestiona_pay" as const;
/** Alias histórico: mismo cobro, otro nombre. */
export const MEDIO_GESTIONA_PAY_LEGACY = "mercadopago" as const;

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

/** ¿Este código de medio de tienda es Nerqia Pay (canónico o legacy)? */
export function esMedioGestionaPay(method: string | null | undefined): boolean {
  return method === MEDIO_GESTIONA_PAY || method === MEDIO_GESTIONA_PAY_LEGACY;
}

/** Etiqueta para comprador y panel: nunca «Mercado Pago (Nerqia Pay)». */
export function etiquetaMedioTienda(method: string | null | undefined): string {
  if (esMedioGestionaPay(method)) return "Nerqia Pay";
  if (method === "transferencia") return "Transferencia";
  if (method === "efectivo") return "Efectivo / retiro";
  return method ? String(method) : "—";
}

/**
 * Normaliza el array de medios de la tienda al canónico.
 * `mercadopago` → `gestiona_pay`; dedup; conserva el resto.
 */
export function normalizarMediosTienda(
  methods: Array<string | null | undefined> | null | undefined,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of methods ?? []) {
    if (!raw) continue;
    const m = esMedioGestionaPay(raw) ? MEDIO_GESTIONA_PAY : raw;
    if (seen.has(m)) continue;
    seen.add(m);
    out.push(m);
  }
  return out;
}

/** Descuentos por medio: la clave legacy `mercadopago` pasa a `gestiona_pay`. */
export function normalizarDescuentosMedios(
  discounts: Record<string, unknown> | null | undefined,
): Record<string, number> {
  if (!discounts || typeof discounts !== "object") return {};
  const out: Record<string, number> = {};
  for (const [raw, value] of Object.entries(discounts)) {
    const key = esMedioGestionaPay(raw) ? MEDIO_GESTIONA_PAY : raw;
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    out[key] = n;
  }
  return out;
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
        ? "Nerqia Pay activo: el rail de procesamiento es Mercado Pago y el dinero va a la cuenta del comercio."
        : "Activá Nerqia Pay. En Argentina el procesamiento corre por Mercado Pago (OAuth); Stripe no cobra acá.",
    };
  }

  if (stripeCubre(pais)) {
    return {
      provider: "stripe",
      listo: conectados.has("stripe"),
      motivo: conectados.has("stripe")
        ? "Nerqia Pay orquesta Stripe Connect en un mercado soportado."
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
 * Medios que el checkout y la vitrina pueden mostrar.
 *
 * Stripe y PayPal no tienen adapter de venta. Nerqia Pay lo filtra el
 * servidor cuando el rail no está listo; acá se normaliza el canónico y se
 * cubre un array viejo con `mercadopago`.
 */
const RAILES_SIN_ADAPTER = new Set(["stripe", "paypal"]);

export function mediosDePagoOfrecibles(methods: string[] | null | undefined): string[] {
  if (!methods?.length) return [];
  return normalizarMediosTienda(methods).filter((m) => !RAILES_SIN_ADAPTER.has(m));
}

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
