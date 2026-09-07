/**
 * Carritos abandonados — cola operativa al estilo Shopify Abandoned checkouts.
 *
 * El cron `recover-abandoned-carts` manda el email UNA vez. Acá el comercio ve
 * la población y el estado del aviso; no inventa un segundo canal de envío.
 *
 * La cola tiene que coincidir con `pending_abandoned_carts`: active + email +
 * ítems + idle ≥1 h. Filtrar sólo `status=abandoned` escondía los recuperables
 * (el RPC de save deja active; abandoned aparece al vaciar el carrito).
 */

export interface AbandonedCartItem {
  name?: string;
  quantity?: number;
  unit_price?: number;
}

export interface AbandonedCartRow {
  id: string;
  status: string;
  customer_email: string | null;
  items: AbandonedCartItem[] | unknown;
  subtotal: number;
  total: number;
  abandoned_email_sent: boolean;
  recovery_token?: string | null;
  expires_at: string;
  updated_at: string;
  created_at: string;
}

/** Listo = SMTP del comercio o correo de plataforma (RPC recovery_email_channel_ready). */
export interface AbandonedEmailChannel {
  ready: boolean;
  merchantSmtp: boolean;
  platformEmail: boolean;
}

export type AbandonedRecoveryState =
  | "enviado"
  | "pendiente"
  | "sin_email"
  | "canal_no_listo";

/** Misma espera que `pending_abandoned_carts(1)` — no avisar a quien todavía compra. */
export const ABANDONED_CART_IDLE_MS = 60 * 60 * 1000;

export function abandonedCartItemCount(items: unknown): number {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, row) => {
    const qty = Number((row as AbandonedCartItem)?.quantity);
    return sum + (Number.isFinite(qty) && qty > 0 ? qty : 1);
  }, 0);
}

/**
 * Estado del aviso automático. Si el canal no puede enviar, no se pinta
 * «Pendiente de aviso» (Shopify no promete email sin canal listo).
 */
export function abandonedCartRecoveryState(
  row: {
    customer_email?: string | null;
    abandoned_email_sent?: boolean | null;
  },
  channel?: Pick<AbandonedEmailChannel, "ready"> | null,
): AbandonedRecoveryState {
  if (row.abandoned_email_sent) return "enviado";
  const email = String(row.customer_email ?? "").trim();
  if (!email) return "sin_email";
  if (channel && channel.ready === false) return "canal_no_listo";
  return "pendiente";
}

export function abandonedCartRecoveryLabel(state: AbandonedRecoveryState): string {
  switch (state) {
    case "enviado":
      return "Aviso enviado";
    case "sin_email":
      return "Sin email";
    case "canal_no_listo":
      return "Email no configurado";
    case "pendiente":
      return "Pendiente de aviso";
  }
}

export function abandonedCartRecoveryTone(state: AbandonedRecoveryState): string {
  if (state === "enviado") return "bg-emerald-500/15 text-emerald-400 border-0";
  if (state === "sin_email" || state === "canal_no_listo") {
    return "bg-muted text-muted-foreground border-0";
  }
  return "bg-yellow-500/15 text-yellow-500 border-0";
}

export function isRecoverableAbandonedCart(
  row: Pick<AbandonedCartRow, "status" | "customer_email" | "items" | "expires_at" | "updated_at">,
  nowMs = Date.now(),
  idleMs = ABANDONED_CART_IDLE_MS,
): boolean {
  if (abandonedCartItemCount(row.items) <= 0) return false;
  if (row.status === "converted") return false;
  const expires = Date.parse(row.expires_at);
  if (!Number.isFinite(expires) || expires <= nowMs) return false;
  if (row.status === "abandoned") return true;
  if (row.status !== "active") return false;
  if (!String(row.customer_email ?? "").trim()) return false;
  const updated = Date.parse(row.updated_at);
  if (Number.isNaN(updated)) return true;
  return nowMs - updated >= idleMs;
}

/** Cola = mismos carritos que el cron puede recuperar (+ abandoned con ítems). */
export function filterAbandonedCartsForQueue(
  rows: AbandonedCartRow[],
  nowMs = Date.now(),
  idleMs = ABANDONED_CART_IDLE_MS,
): AbandonedCartRow[] {
  return rows
    .filter((row) => isRecoverableAbandonedCart(row, nowMs, idleMs))
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

export function abandonedCartsQueueHref(): string {
  return "/pedidos-online?cola=recuperacion";
}

/** Deep-link que el cron ya usa: /tienda/:slug/carrito/:token */
export function abandonedCartRecoveryHref(
  storeSlug: string | null | undefined,
  recoveryToken: string | null | undefined,
): string | null {
  const slug = String(storeSlug ?? "").trim();
  const token = String(recoveryToken ?? "").trim();
  if (!slug || !token) return null;
  return `/tienda/${slug}/carrito/${token}`;
}

export function parseRecoveryEmailChannel(raw: unknown): AbandonedEmailChannel {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const merchantSmtp = row.merchant_smtp === true;
  const platformEmail = row.platform_email === true;
  const ready = row.ready === true || merchantSmtp || platformEmail;
  return { ready, merchantSmtp, platformEmail };
}

/**
 * Honestidad de canal (Shopify Abandoned checkouts): el panel no miente
 * sobre el email automático. Los CTAs de link funcionan igual.
 */
export function abandonedCartRecoveryChannelCopy(input: {
  hasStoreSlug: boolean;
  channel?: AbandonedEmailChannel | null;
}): { title: string; body: string; href?: string } {
  if (!input.hasStoreSlug) {
    return {
      title: "Falta el slug de la tienda",
      body: "Sin tienda publicada no hay deep-link de recuperación. Completá Pagos y envíos y volvé.",
    };
  }
  const channel = input.channel;
  if (channel && !channel.ready) {
    return {
      title: "El aviso por email no puede salir todavía",
      body: "No hay SMTP del comercio ni correo de plataforma listo. Copiar / Abrir / WhatsApp siguen sirviendo. Conectá el correo en Ajustes → Mensajería.",
      href: "/ajustes#messaging",
    };
  }
  if (channel?.merchantSmtp) {
    return {
      title: "Email automático: una sola vez por carrito",
      body: "Sale por el SMTP de tu comercio. Si no llega, usá Copiar / Abrir / WhatsApp con el mismo link — no inventamos un segundo envío.",
    };
  }
  if (channel?.platformEmail) {
    return {
      title: "Email automático: una sola vez por carrito",
      body: "Sale por el correo de plataforma. Podés conectar tu propio SMTP en Ajustes. Si no llega mail, Copiar / Abrir / WhatsApp usan el mismo link.",
      href: "/ajustes#messaging",
    };
  }
  return {
    title: "Email automático: una sola vez por carrito",
    body: "El cron envía si hay canal de correo listo. Si no llega mail, Copiar / Abrir / WhatsApp usan el mismo link — no inventamos un segundo envío.",
  };
}
