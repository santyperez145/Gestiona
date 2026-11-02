/**
 * broadcastSync — singleton BroadcastChannel sender.
 *
 * Allows non-React code (e.g. store functions) to notify other tabs
 * about data changes without hooks.
 *
 * Usage:
 *   import { broadcastSync } from "@/lib/broadcastSync";
 *   broadcastSync({ type: "product_saved", name: product.name });
 */

const CHANNEL_NAME = "gestiona-sync";

/**
 * Identidad de esta pestaña (2026-11-02). BroadcastChannel entrega el mensaje
 * a todas las otras instancias del canal, también a las de la misma pestaña:
 * guardar un producto mostraba «Producto actualizado en otra pestaña» en la
 * pestaña que lo había guardado. Cada mensaje lleva su origen y quien escucha
 * descarta los propios.
 */
export const ESTA_PESTANA = typeof crypto !== "undefined" && "randomUUID" in crypto
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random()}`;

/** ¿El mensaje vino de esta misma pestaña? */
export function esDeEstaPestana(msg: unknown): boolean {
  return typeof msg === "object" && msg !== null && (msg as { pestana?: unknown }).pestana === ESTA_PESTANA;
}

let _channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!_channel) _channel = new BroadcastChannel(CHANNEL_NAME);
  return _channel;
}

export function broadcastSync(msg: Record<string, unknown>) {
  try {
    getChannel()?.postMessage({ ...msg, pestana: ESTA_PESTANA });
  } catch { /* ignore */ }
}
