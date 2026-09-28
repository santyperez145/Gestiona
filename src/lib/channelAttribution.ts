/**
 * Atribución por canal de origen.
 *
 * Shopify / Tiendanube / Meta / WhatsApp / email cada uno aporta
 * compradores diferentes. Este módulo normaliza el canal y entrega
 * un resumen testeable sin llamar a nada externo.
 */

export type Channel = "shopify" | "tiendanube" | "meta" | "whatsapp" | "email" | "pos" | "organic" | "referral" | "direct";

export interface ChannelEvent {
  channel: Channel;
  order_count: number;
  gmv: number;
  buyers: number;
}

export function normalizeChannel(value: string | null | undefined): Channel {
  const v = (value ?? "").toLowerCase().trim();
  if (["shopify", "tiendanube", "meta", "whatsapp", "email", "pos", "organic", "referral", "direct"].includes(v)) {
    return v as Channel;
  }
  return "direct";
}

export function summarizeByChannel(events: ChannelEvent[]): Record<Channel, ChannelEvent> {
  const acc: Record<string, ChannelEvent> = {};
  for (const e of events) {
    const existing = acc[e.channel];
    if (!existing) {
      acc[e.channel] = { ...e };
    } else {
      existing.order_count += e.order_count;
      existing.gmv += e.gmv;
      existing.buyers += e.buyers;
    }
  }
  return acc as Record<Channel, ChannelEvent>;
}
