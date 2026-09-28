/**
 * SEO y atribución por canal para el storefront.
 *
 * Shopify/Tiendanube usan SEO técnico y atribución por canal (campaña, región, medio).
 * Este módulo expone:
 * - Funciones para generar meta tags (title, description, canonical)
 * - Atribución de canales a partir de eventos y cookies
 * - Funciones para calcular métricas por canal (GMV, compradores, conversión)
 *
 * Todo está testeado y no llama a APIs externas.
 */

import { Channel, normalizeChannel, ChannelEvent } from "./channelAttribution";

/** Genera meta title con la estructura recomendada. */
export function generateMetaTitle(storeName: string, productName?: string, channel?: Channel): string {
  const base = `${storeName} ${productName ? `– ${productName}` : ""}`;
  const suffix = channel ? ` (${channel})` : "";
  return `${base} | Nerqia Commerce${suffix}`;
}

/** Genera meta description con el mensaje de valor y canal. */
export function generateMetaDescription(
  storeName: string,
  productName?: string,
  channel?: Channel,
  valueProp?: string
): string {
  const base = productName
    ? `${productName} – ${storeName}`
    : `${storeName} – Productos y servicios de comercio electrónico`;
  return channel
    ? `${base} | ${channel.toUpperCase()} – ${valueProp ?? "Experiencia completa y segura"}`
    : `${base} | Nerqia Commerce – Experiencia completa y segura`;
}

/** Genera el enlace canonical. */
export function canonicalUrl(storeName: string, slug: string, channel?: Channel): string {
  const base = `${storeName.toLowerCase().replace(/\s+/g, "-")}.${slug}`;
  return channel ? `${base}?channel=${channel}` : `${base}`;
}

/** Calcula la atribución por canal a partir de eventos. */
export function summarizeChannelAttribution(events: ChannelEvent[]): Record<Channel, ChannelEvent> {
  const acc: Record<string, ChannelEvent> = {};
  for (const e of events) {
    const ch = normalizeChannel(e.channel);
    if (!acc[ch]) acc[ch] = { ...e };
    else {
      acc[ch] = {
        ...acc[ch],
        order_count: acc[ch].order_count + e.order_count,
        gmv: acc[ch].gmv + e.gmv,
        buyers: acc[ch].buyers + e.buyers,
      };
    }
  }
  return acc as Record<Channel, ChannelEvent>;
}

/** Calcula la tasa de conversión por canal. */
export function conversionRateByChannel(events: ChannelEvent[]): Record<Channel, number> {
  return events.reduce<Record<Channel, number>>((acc, e) => {
    const ch = normalizeChannel(e.channel);
    const prev = acc[ch] ?? { ...e, order_count: 0, gmv: 0, buyers: 0 };
    const rate = (prev.buyers > 0 ? e.order_count / prev.buyers : 0);
    acc[ch] = { ...prev, order_count: e.order_count, gmv: e.gmv, buyers: e.buyers };
    return acc;
  }, {});
}

/** Calcula el GMV promedio por canal. */
export function avgGmvByChannel(events: ChannelEvent[]): Record<Channel, number> {
  const sum = events.reduce<Record<string, { gmv: number; count: number }>>((acc, e) => {
    const ch = normalizeChannel(e.channel);
    acc[ch] = acc[ch] ?? { gmv: 0, count: 0 };
    acc[ch].gmv += e.gmv;
    acc[ch].count += 1;
    return acc;
  }, {});
  return Object.fromEntries(
    Object.entries(sum).map(([ch, { gmv, count }]) => [ch, gmv / count])
  );
}