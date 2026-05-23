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

let _channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  if (!_channel) _channel = new BroadcastChannel(CHANNEL_NAME);
  return _channel;
}

export function broadcastSync(msg: Record<string, unknown>) {
  try {
    getChannel()?.postMessage(msg);
  } catch { /* ignore */ }
}
