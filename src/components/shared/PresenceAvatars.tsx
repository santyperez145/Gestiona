/**
 * PresenceAvatars — Shows online team members as stacked avatar circles.
 * Uses useOrgPresence hook (WebSocket via Supabase Realtime Presence).
 */
import { useOrgPresence, type OnlineUser } from "@/hooks/useOrgPresence";
import { useOrg } from "@/lib/orgContext";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

function Avatar({ user, size = 24 }: { user: OnlineUser; size?: number }) {
  const initials = user.name
    .split(" ")
    .map(w => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div
      className="relative rounded-full border-2 border-background bg-primary/20 flex items-center justify-center overflow-hidden flex-shrink-0"
      style={{ width: size, height: size }}
    >
      {user.avatar_url ? (
        <img src={user.avatar_url} alt={user.name} className="w-full h-full object-cover" />
      ) : (
        <span className="text-[9px] font-bold text-primary leading-none">{initials}</span>
      )}
      {/* Green online dot */}
      <span
        className="absolute bottom-0 right-0 rounded-full bg-emerald-400 border border-background"
        style={{ width: size * 0.3, height: size * 0.3 }}
      />
    </div>
  );
}

interface PresenceAvatarsProps {
  maxVisible?: number;
  size?: number;
  className?: string;
}

export default function PresenceAvatars({ maxVisible = 4, size = 26, className = "" }: PresenceAvatarsProps) {
  const { activeOrg } = useOrg();
  const { others } = useOrgPresence(activeOrg?.id);

  if (others.length === 0) return null;

  const visible = others.slice(0, maxVisible);
  const overflow = others.length - maxVisible;

  return (
    <TooltipProvider delayDuration={200}>
      <div className={`flex items-center ${className}`}>
        {/* Stacked avatars */}
        <div className="flex" style={{ gap: -size * 0.3 }}>
          {visible.map((u, i) => (
            <Tooltip key={u.user_id}>
              <TooltipTrigger asChild>
                <div style={{ marginLeft: i > 0 ? -size * 0.3 : 0, zIndex: visible.length - i }}>
                  <Avatar user={u} size={size} />
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                <span className="font-medium">{u.name}</span>
                <span className="text-muted-foreground ml-1">en línea</span>
              </TooltipContent>
            </Tooltip>
          ))}

          {overflow > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className="rounded-full border-2 border-background bg-muted flex items-center justify-center text-[9px] font-bold text-muted-foreground flex-shrink-0"
                  style={{ width: size, height: size, marginLeft: -size * 0.3 }}
                >
                  +{overflow}
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {overflow} más en línea
              </TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Label */}
        <span className="ml-2 text-[10px] text-emerald-400 font-medium hidden sm:block">
          {others.length} en línea
        </span>
      </div>
    </TooltipProvider>
  );
}
