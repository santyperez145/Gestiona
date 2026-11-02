/**
 * useBroadcastChannel — Sync state across multiple browser tabs via BroadcastChannel API.
 *
 * Emits a message to all other tabs when `send()` is called.
 * Calls `onMessage` when a message arrives from another tab.
 *
 * Usage:
 *   const { send } = useBroadcastChannel("gestiona-sync", (msg) => {
 *     if (msg.type === "product_updated") refetch();
 *   });
 *   send({ type: "product_updated", id: product.id });
 */
import { useCallback, useEffect, useRef } from "react";
import { ESTA_PESTANA, esDeEstaPestana } from "@/lib/broadcastSync";

type Message = Record<string, unknown>;

export function useBroadcastChannel(
  channelName: string,
  onMessage?: (msg: Message) => void
) {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;

    const channel = new BroadcastChannel(channelName);
    channelRef.current = channel;

    channel.onmessage = (event: MessageEvent) => {
      // Lo que mandó esta misma pestaña no es noticia de «otra pestaña».
      if (esDeEstaPestana(event.data)) return;
      try {
        onMessageRef.current?.(event.data as Message);
      } catch { /* ignore */ }
    };

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [channelName]);

  const send = useCallback((msg: Message) => {
    channelRef.current?.postMessage({ ...msg, pestana: ESTA_PESTANA });
  }, []);

  const supported = typeof BroadcastChannel !== "undefined";

  return { send, supported };
}
