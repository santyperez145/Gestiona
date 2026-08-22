/**
 * useOrgPresence — Real-time presence via Supabase Realtime Presence channels.
 *
 * Shows which team members are currently online in the same org.
 * Uses WebSocket under the hood (Supabase Realtime = WebSocket).
 */
import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export interface OnlineUser {
  user_id: string;
  name: string;
  email: string;
  avatar_url?: string;
  online_at: string;
}

/**
 * Presence puede conservar más de una meta para la misma key durante una
 * reconexión o cuando el mismo usuario abre varias pestañas. La UI representa
 * personas, no sockets: conserva una fila por user_id y gana la más reciente.
 */
export function dedupeOnlineUsers(
  presences: Array<Partial<OnlineUser> | null | undefined>,
): OnlineUser[] {
  const byUser = new Map<string, OnlineUser>();
  for (const presence of presences) {
    if (!presence?.user_id || !presence.name || !presence.online_at) continue;
    const candidate = presence as OnlineUser;
    const current = byUser.get(candidate.user_id);
    const candidateAt = Date.parse(candidate.online_at);
    const currentAt = current ? Date.parse(current.online_at) : Number.NEGATIVE_INFINITY;
    if (!current || !Number.isFinite(currentAt)
      || (Number.isFinite(candidateAt) && candidateAt >= currentAt)) {
      byUser.set(candidate.user_id, candidate);
    }
  }
  return Array.from(byUser.values());
}

export function useOrgPresence(orgId: string | undefined) {
  const { user } = useAuth();
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!orgId || !user) return;

    const channelName = `presence-org-${orgId}`;

    // Remove stale channel
    const stale = supabase.getChannels().find(c => c.topic === `realtime:${channelName}`);
    if (stale) supabase.removeChannel(stale);

    const channel = supabase.channel(channelName, {
      config: { presence: { key: user.id } },
    });

    channelRef.current = channel;
    const currentPresence = () => dedupeOnlineUsers(
      Object.values(channel.presenceState<OnlineUser>()).flat(),
    );

    channel
      .on("presence", { event: "sync" }, () => {
        setOnlineUsers(currentPresence());
      })
      .on("presence", { event: "join" }, ({ newPresences }) => {
        setOnlineUsers(prev => dedupeOnlineUsers([
          ...prev,
          ...(newPresences as unknown as OnlineUser[]),
        ]));
      })
      .on("presence", { event: "leave" }, () => {
        // El estado del canal sabe si queda otra pestaña/socket para esa key;
        // remover por user_id desde leftPresences borraba usuarios aún online.
        setOnlineUsers(currentPresence());
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            user_id: user.id,
            name: user.user_metadata?.full_name || user.email?.split("@")[0] || "Usuario",
            email: user.email || "",
            avatar_url: user.user_metadata?.avatar_url || null,
            online_at: new Date().toISOString(),
          } satisfies OnlineUser);
        }
      });

    return () => {
      channel.untrack();
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [orgId, user]);

  // Filter out self from display (optional — pass includeSelf: true to show yourself)
  const others = dedupeOnlineUsers(onlineUsers).filter(u => u.user_id !== user?.id);

  return { onlineUsers, others, selfIncluded: onlineUsers };
}
