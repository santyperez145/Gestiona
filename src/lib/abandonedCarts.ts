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

export interface RecoverySummary {
  /** Carritos recuperables hoy (misma población que el cron puede avisar). */
  pendientes: number;
  /** Carritos recuperables cuyo aviso automático ya salió. */
  avisosEnviados: number;
  /** Carritos que terminaron en compra (resultado observable del canal). */
  convertidos: number;
  /** GMV recuperado: suma de `total` de los convertidos visibles. */
  convertidoTotal: number;
  /** El aviso automático está listo (SMTP comercio o plataforma). */
  canalListo: boolean;
  /** La corrida automática reciente no registra fallas. */
  automaticoSano: boolean;
  /** Fecha de la última invocación registrada del cron (null si nunca). */
  ultimaCorridaAt: string | null;
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

/** Agrega sólo lo necesario para entender si la recuperación está rindiendo. */
export function summarizeRecovery(
  rows: AbandonedCartRow[],
  channel: Pick<AbandonedEmailChannel, "ready"> | null,
  health?: { failures_7d?: number; last_invoked_at?: string | null } | null,
  nowMs = Date.now(),
): RecoverySummary {
  const queue = filterAbandonedCartsForQueue(rows, nowMs);
  /** Carritos que terminaron en compra dentro de la población leída (incluye convertidos). */
  const convertidosRows = rows.filter((row) => row.status === "converted");
  const convertidoTotal = convertidosRows.reduce((sum, row) => sum + (Number(row.total) || Number(row.subtotal) || 0), 0);
  const avisosEnviados = queue.filter((row) => row.abandoned_email_sent).length;
  const canalListo = channel?.ready === true;
  const failures = Number(health?.failures_7d);
  const hasSignal = health != null && Number.isFinite(failures);
  // Sin señal del cron no declaramos salud propia: la del canal ya es el mínimo honesto.
  return {
    pendientes: queue.length,
    avisosEnviados,
    convertidos: convertidosRows.length,
    convertidoTotal,
    canalListo,
    automaticoSano: hasSignal ? failures === 0 : canalListo,
    ultimaCorridaAt: typeof health?.last_invoked_at === "string" ? health.last_invoked_at : null,
  };
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
