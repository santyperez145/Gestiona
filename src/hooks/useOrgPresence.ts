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

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<OnlineUser>();
        const users = Object.values(state)
          .flat()
          .filter((u): u is OnlineUser => !!u.user_id);
        setOnlineUsers(users);
      })
      .on("presence", { event: "join" }, ({ newPresences }) => {
        setOnlineUsers(prev => {
          const joined = (newPresences as OnlineUser[]).filter(
            np => !prev.some(u => u.user_id === np.user_id)
          );
          return [...prev, ...joined];
        });
      })
      .on("presence", { event: "leave" }, ({ leftPresences }) => {
        const leftIds = new Set((leftPresences as OnlineUser[]).map(u => u.user_id));
        setOnlineUsers(prev => prev.filter(u => !leftIds.has(u.user_id)));
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
  const others = onlineUsers.filter(u => u.user_id !== user?.id);

  return { onlineUsers, others, selfIncluded: onlineUsers };
}
