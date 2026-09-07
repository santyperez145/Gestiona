/**
 * Avisos de reposición — demanda OOS al estilo Shopify / Klaviyo Back in stock.
 *
 * El comprador pide aviso en el storefront; el cron `notify-back-in-stock`
 * manda UNA vez con link al producto. Acá el comercio ve la cola: sin UI era
 * built-but-dark (demanda real invisible).
 *
 * El badge «aviso pendiente» sólo aplica si el canal de email puede enviar
 * (misma RPC que carritos: recovery_email_channel_ready).
 */

import type { AbandonedEmailChannel } from "@/lib/abandonedCarts";

export interface StockAlertRow {
  id: string;
  email: string;
  product_id: string;
  variant_id: string | null;
  notified_at: string | null;
  created_at: string;
  /** Join opcional para la cola. */
  product_name?: string | null;
  product_stock?: number | null;
}

export type StockAlertState =
  | "pendiente"
  | "listo_para_avisar"
  | "canal_no_listo"
  | "enviado";

export function stockAlertState(
  row: {
    notified_at?: string | null;
    product_stock?: number | null;
  },
  channel?: Pick<AbandonedEmailChannel, "ready"> | null,
): StockAlertState {
  if (row.notified_at) return "enviado";
  const stock = Number(row.product_stock);
  const hasStock = Number.isFinite(stock) && stock > 0;
  if (!hasStock) return "pendiente";
  if (channel && channel.ready === false) return "canal_no_listo";
  return "listo_para_avisar";
}

export function stockAlertStateLabel(state: StockAlertState): string {
  switch (state) {
    case "enviado":
      return "Aviso enviado";
    case "listo_para_avisar":
      return "Hay stock — aviso pendiente";
    case "canal_no_listo":
      return "Hay stock — email no configurado";
    case "pendiente":
      return "Esperando reposición";
  }
}

export function stockAlertStateTone(state: StockAlertState): string {
  if (state === "enviado") return "bg-emerald-500/15 text-emerald-400 border-0";
  if (state === "listo_para_avisar") return "bg-yellow-500/15 text-yellow-500 border-0";
  if (state === "canal_no_listo") return "bg-muted text-muted-foreground border-0";
  return "bg-muted text-muted-foreground border-0";
}

/** Cola operativa: todavía no avisados. */
export function filterPendingStockAlerts(rows: StockAlertRow[]): StockAlertRow[] {
  return rows
    .filter((row) => !row.notified_at)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

export function countPendingStockAlerts(rows: StockAlertRow[]): number {
  return filterPendingStockAlerts(rows).length;
}

/** Agrupa demanda por producto para el Pulse (≤5 oportunidades). */
export function stockAlertsByProduct(
  rows: StockAlertRow[],
  channel?: Pick<AbandonedEmailChannel, "ready"> | null,
): {
  productId: string;
  name: string;
  waiting: number;
  ready: number;
}[] {
  const map = new Map<string, { productId: string; name: string; waiting: number; ready: number }>();
  for (const row of filterPendingStockAlerts(rows)) {
    const key = row.product_id;
    const cur = map.get(key) ?? {
      productId: key,
      name: String(row.product_name ?? "Producto").trim() || "Producto",
      waiting: 0,
      ready: 0,
    };
    const state = stockAlertState(row, channel);
    if (state === "listo_para_avisar") cur.ready += 1;
    else cur.waiting += 1;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => (b.ready + b.waiting) - (a.ready + a.waiting));
}

export function stockAlertsQueueHref(): string {
  return "/pedidos-online?cola=recuperacion&vista=reposicion";
}

/**
 * Honestidad de canal: no prometer envío automático si SMTP/plataforma no están listos.
 */
export function stockAlertChannelCopy(input: {
  channel?: AbandonedEmailChannel | null;
}): { title: string; body: string; href?: string } {
  const channel = input.channel;
  if (channel && !channel.ready) {
    return {
      title: "El aviso por email no puede salir todavía",
      body: "Hay demanda de reposición, pero no hay SMTP del comercio ni correo de plataforma listo. Conectá el correo en Ajustes → Mensajería.",
      href: "/ajustes#messaging",
    };
  }
  if (channel?.merchantSmtp) {
    return {
      title: "Aviso automático: una sola vez por pedido",
      body: "Cuando vuelve el stock, el cron avisa por el SMTP de tu comercio. Abrí la ficha si querés revisar el producto.",
    };
  }
  if (channel?.platformEmail) {
    return {
      title: "Aviso automático: una sola vez por pedido",
      body: "Sale por el correo de plataforma cuando hay stock otra vez. Podés conectar tu propio SMTP en Ajustes.",
      href: "/ajustes#messaging",
    };
  }
  return {
    title: "Aviso automático: una sola vez por pedido",
    body: "El correo sale solo cuando hay unidades otra vez. Si el canal no está listo, el sistema no inventa un envío.",
  };
}
