/**
 * TeamChatPage — Real-time team chat using Supabase Realtime Postgres Changes.
 *
 * Messages are stored in the `team_messages` table (persistent history).
 * New messages appear live via WebSocket subscription — no polling.
 * Presence avatars show who else is in the chat right now.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { Send, Trash2, Users, Wifi } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { useOrgPresence } from "@/hooks/useOrgPresence";
import { safeChannel } from "@/lib/realtimeChannel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import PageHeader from "@/components/shared/PageHeader";
import { usePageTitle } from "@/hooks/usePageTitle";

interface TeamMessage {
  id: string;
  org_id: string;
  user_id: string;
  sender_name: string;
  content: string;
  created_at: string;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  if (sameDay) return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" }) +
    " " + d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

function getInitials(name: string) {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

const COLORS = [
  "bg-violet-500/20 text-violet-300",
  "bg-blue-500/20 text-blue-300",
  "bg-emerald-500/20 text-emerald-300",
  "bg-amber-500/20 text-amber-300",
  "bg-rose-500/20 text-rose-300",
  "bg-cyan-500/20 text-cyan-300",
];

function avatarColor(userId: string) {
  let hash = 0;
  for (const c of userId) hash = (hash * 31 + c.charCodeAt(0)) & 0xffffff;
  return COLORS[hash % COLORS.length];
}

const PAGE_SIZE = 50;

export default function TeamChatPage() {
  usePageTitle("Chat de Equipo");
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { others } = useOrgPresence(activeOrg?.id);

  // ── Load history ─────────────────────────────────────────────────────────
  const loadMessages = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("team_messages" as any)
      .select("*")
      .eq("org_id", activeOrg.id)
      .order("created_at", { ascending: true })
      .limit(PAGE_SIZE);

    if (!error && data) setMessages(data as TeamMessage[]);
    setLoading(false);
  }, [activeOrg]);

  useEffect(() => { loadMessages(); }, [loadMessages]);

  // ── Real-time subscription (WebSocket via Postgres Changes) ──────────────
  useEffect(() => {
    if (!activeOrg) return;

    const channel = safeChannel("team-chat", activeOrg.id)
      .on(
        "postgres_changes" as any,
        {
          event: "INSERT",
          schema: "public",
          table: "team_messages",
          filter: `org_id=eq.${activeOrg.id}`,
        },
        (payload: any) => {
          const msg = payload.new as TeamMessage;
          setMessages(prev => {
            // Avoid duplicates (if sender's optimistic update is already there)
            if (prev.some(m => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
        }
      )
      .on(
        "postgres_changes" as any,
        {
          event: "DELETE",
          schema: "public",
          table: "team_messages",
          filter: `org_id=eq.${activeOrg.id}`,
        },
        (payload: any) => {
          setMessages(prev => prev.filter(m => m.id !== (payload.old as any).id));
        }
      )
      .subscribe((status) => {
        setConnected(status === "SUBSCRIBED");
      });

    return () => { supabase.removeChannel(channel); };
  }, [activeOrg]);

  // ── Auto-scroll ───────────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Send message ──────────────────────────────────────────────────────────
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || !user || !activeOrg || sending) return;

    setInput("");
    setSending(true);
    try {
      const senderName =
        user.user_metadata?.full_name || user.email?.split("@")[0] || "Usuario";

      const { error } = await supabase
        .from("team_messages" as any)
        .insert({
          org_id: activeOrg.id,
          user_id: user.id,
          sender_name: senderName,
          content: text,
        });

      if (error) throw error;
    } catch (err: any) {
      toast.error("Error al enviar: " + err.message);
      setInput(text); // restore
    } finally {
      setSending(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleDelete = async (msgId: string) => {
    await supabase.from("team_messages" as any).delete().eq("id", msgId);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(e as any);
    }
  };

  // Group consecutive messages by same sender
  const grouped = messages.reduce<Array<{ senderId: string; senderName: string; msgs: TeamMessage[] }>>(
    (acc, msg) => {
      const last = acc[acc.length - 1];
      if (last && last.senderId === msg.user_id) {
        last.msgs.push(msg);
      } else {
        acc.push({ senderId: msg.user_id, senderName: msg.sender_name, msgs: [msg] });
      }
      return acc;
    },
    []
  );

  const isSelf = (userId: string) => userId === user?.id;

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Chat de Equipo"
        description="Mensajes en tiempo real entre miembros del negocio"
        icon={Users}
      />

      {/* Online users + status */}
      <div className="flex items-center gap-3 px-4 pb-3 border-b border-border/30">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-400" : "bg-amber-400"} ${connected ? "animate-pulse" : ""}`} />
          <span className="text-xs text-muted-foreground">
            {connected ? "Conectado en tiempo real" : "Conectando..."}
          </span>
        </div>

        {others.length > 0 && (
          <div className="flex items-center gap-1.5 ml-auto">
            <Wifi className="w-3 h-3 text-emerald-400" />
            <span className="text-xs text-emerald-400 font-medium">{others.length} leyendo ahora</span>
          </div>
        )}
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Users className="w-7 h-7 text-primary/50" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">Aún no hay mensajes</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              Escribí algo para iniciar la conversación con tu equipo.
            </p>
          </div>
        ) : (
          grouped.map((group, gi) => {
            const self = isSelf(group.senderId);
            const colorClass = avatarColor(group.senderId);

            return (
              <div
                key={gi}
                className={`flex gap-2.5 ${self ? "flex-row-reverse" : "flex-row"}`}
              >
                {/* Avatar */}
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 mt-0.5 ${colorClass}`}
                >
                  {getInitials(group.senderName)}
                </div>

                {/* Bubble group */}
                <div className={`flex flex-col gap-1 max-w-[70%] ${self ? "items-end" : "items-start"}`}>
                  {!self && (
                    <span className="text-[11px] text-muted-foreground font-medium px-1">
                      {group.senderName}
                    </span>
                  )}

                  {group.msgs.map((msg, mi) => (
                    <div key={msg.id} className="group relative">
                      <div
                        className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed break-words ${
                          self
                            ? "bg-primary text-primary-foreground rounded-br-sm"
                            : "bg-card border border-border/40 text-foreground rounded-bl-sm"
                        }`}
                      >
                        {msg.content}
                      </div>

                      {/* Timestamp + delete on hover */}
                      <div className={`flex items-center gap-1.5 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${self ? "justify-end" : "justify-start"}`}>
                        <span className="text-[10px] text-muted-foreground">
                          {formatTime(msg.created_at)}
                        </span>
                        {self && (
                          <button
                            onClick={() => handleDelete(msg.id)}
                            className="text-muted-foreground/50 hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={handleSend}
        className="flex items-center gap-2 p-4 border-t border-border/30 bg-card/30"
      >
        <Input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Escribí un mensaje... (Enter para enviar)"
          className="flex-1 bg-muted border-border/50 text-sm"
          maxLength={2000}
          disabled={sending}
        />
        <Button
          type="submit"
          size="icon"
          disabled={!input.trim() || sending}
          className="gradient-gold text-primary-foreground flex-shrink-0"
        >
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </div>
  );
}
