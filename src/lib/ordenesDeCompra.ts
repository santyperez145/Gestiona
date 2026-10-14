import { supabase } from "@/integrations/supabase/client";
import { mensajeDeEdgeFunction } from "@/lib/edgeErrors";
import { hrefWhatsApp } from "@/lib/storeSocial";

/**
 * Enviar una orden de compra al proveedor (2026-10-14, funciones
 * incoherentes). «Enviar OC» sólo cambiaba el estado sin mandar nada, y el
 * modal de Proveedores mandaba un correo con un producto, un número inventado
 * y una cotización fija de $1.700. Ahora se envía la orden guardada, completa:
 * por correo lo arma y lo manda el servidor (`send-supplier-po`), y por
 * WhatsApp se abre el chat con el detalle. En los dos casos la orden queda
 * «enviada» con su fecha.
 */

export interface OrdenParaEnviar {
  order_number: string;
  supplier_name: string;
  currency: string;
  total_amount: number;
  expected_date?: string | null;
  notes?: string | null;
  items?: Array<{ product_name: string; sku?: string | null; quantity_ordered: number }>;
}

/** Para reponer: lleva el stock a tres veces el mínimo (como mínimo, una unidad). */
export function cantidadSugerida(p: { stock?: number | null; low_stock_threshold?: number | null }): number {
  const minimo = Number(p.low_stock_threshold ?? 3) || 3;
  return Math.max(1, Math.ceil(minimo * 3 - Number(p.stock ?? 0)));
}

const cantidad = (n: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(Number(n) || 0);
const importe = (n: number, moneda: string) =>
  `${moneda.toUpperCase() === "USD" ? "US$" : "$"} ${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0)}`;

/** El texto de la orden para mandar por WhatsApp. */
export function textoDeOrdenParaWhatsApp(o: OrdenParaEnviar, negocio: string): string {
  const renglones = (o.items ?? []).map(i => `• ${i.product_name}${i.sku ? ` (${i.sku})` : ""}: ${cantidad(i.quantity_ordered)}`);
  const entrega = o.expected_date
    ? `\nEntrega esperada: ${new Date(`${o.expected_date.slice(0, 10)}T12:00:00`).toLocaleDateString("es-AR")}`
    : "";
  return [
    `Hola${o.supplier_name ? ` ${o.supplier_name}` : ""}, te paso la orden de compra ${o.order_number} de ${negocio}:`,
    "",
    ...renglones,
    "",
    `Total: ${importe(o.total_amount, o.currency)}${entrega}`,
    ...(o.notes?.trim() ? ["", o.notes.trim()] : []),
    "",
    "¿Me confirmás? Gracias.",
  ].join("\n");
}

/** `https://wa.me/…?text=…` o null si el teléfono del proveedor no sirve. */
export function enlaceDeWhatsAppDeOrden(telefono: string | null | undefined, texto: string): string | null {
  const base = hrefWhatsApp(telefono);
  return base ? `${base}?text=${encodeURIComponent(texto)}` : null;
}

export async function enviarOrdenPorCorreoDB(orgId: string, orderId: string, to?: string | null): Promise<{ to: string; orderNumber: string; statusUpdated: boolean }> {
  const { data, error } = await supabase.functions.invoke("send-supplier-po", {
    body: { orgId, orderId, ...(to?.trim() ? { to: to.trim() } : {}) },
  });
  if (error || data?.error) throw new Error(await mensajeDeEdgeFunction(error, data) || "No se pudo enviar la orden");
  return data as { to: string; orderNumber: string; statusUpdated: boolean };
}

/** Marca la orden como enviada (cuando se mandó por WhatsApp u otro medio). */
export async function marcarOrdenEnviadaDB(orderId: string, estadoActual: string): Promise<void> {
  const cambios: Record<string, unknown> = { sent_at: new Date().toISOString() };
  if (estadoActual === "draft") cambios.status = "sent";
  const { error } = await supabase.from("purchase_orders").update(cambios as never).eq("id", orderId);
  if (error) throw error;
}
