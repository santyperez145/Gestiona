import { supabase } from "@/integrations/supabase/client";

/**
 * Creates a Supabase realtime channel with a unique name to avoid the
 * "cannot add postgres_changes callbacks after subscribe()" crash that
 * happens when React remounts a component before the previous channel
 * cleanup completes.
 *
 * Usage: replace  supabase.channel("my-name")
 *        with     safeChannel("my-name", scopeId)
 */
export function safeChannel(baseName: string, scopeId: string) {
  const channelName = `${baseName}-${scopeId}`;
  const stale = supabase.getChannels().find(c => c.topic === `realtime:${channelName}`);
  if (stale) supabase.removeChannel(stale);
  return supabase.channel(channelName);
}
