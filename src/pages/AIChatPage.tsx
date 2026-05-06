import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Brain, Send, Loader2, Trash2, Bot, User, Sparkles } from "lucide-react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: number;
};

const STARTER_QUESTIONS = [
  "¿Cuánto gané este mes?",
  "¿Qué producto tiene más margen?",
  "¿Cuáles son mis mejores clientes?",
  "¿Qué stock me está por quedar?",
  "¿Cómo va mi negocio comparado al mes pasado?",
  "¿Qué debería reponer urgente?",
];

function formatMessage(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    if (line.startsWith("•") || line.startsWith("-") || line.startsWith("*")) {
      return <li key={i} className="ml-3">{line.replace(/^[•\-*]\s*/, "")}</li>;
    }
    if (line.trim() === "") return <br key={i} />;
    return <p key={i} className="mb-1">{line}</p>;
  });
}

export default function AIChatPage() {
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading || !activeOrg) return;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: msg, ts: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const history = messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));
      const { data, error } = await supabase.functions.invoke("ai-chat", {
        body: { message: msg, history, orgId: activeOrg.id },
      });

      if (error || !data?.reply) throw new Error(data?.error || error?.message || "Error al consultar IA");

      const aiMsg: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content: data.reply, ts: Date.now() };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (e: any) {
      toast.error(e.message || "No se pudo consultar el asistente");
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
      setInput(msg);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [input, loading, activeOrg, messages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold flex items-center gap-2">
            <Brain className="w-7 h-7 text-primary" />Asistente IA
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Preguntá sobre tu negocio en lenguaje natural</p>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setMessages([])} className="text-muted-foreground">
            <Trash2 className="w-3.5 h-3.5 mr-1.5" />Limpiar
          </Button>
        )}
      </div>

      {/* Chat area */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center pb-8">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
              <Sparkles className="w-8 h-8 text-primary" />
            </div>
            <h2 className="font-display font-bold text-lg mb-1">¿En qué puedo ayudarte?</h2>
            <p className="text-muted-foreground text-sm mb-6 max-w-sm">
              Tengo acceso a tus datos de ventas, stock, gastos y clientes en tiempo real.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md">
              {STARTER_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="text-left text-sm px-3 py-2.5 rounded-lg bg-card border border-border hover:border-primary/40 hover:bg-primary/5 transition-colors text-muted-foreground hover:text-foreground"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
              msg.role === "user" ? "bg-primary/15" : "bg-card border border-border"
            }`}>
              {msg.role === "user"
                ? <User className="w-4 h-4 text-primary" />
                : <Bot className="w-4 h-4 text-primary" />}
            </div>
            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
              msg.role === "user"
                ? "bg-primary/15 text-foreground rounded-tr-sm"
                : "bg-card border border-border rounded-tl-sm"
            }`}>
              {msg.role === "assistant"
                ? <ul className="list-none space-y-0.5">{formatMessage(msg.content)}</ul>
                : msg.content}
              <span className="block mt-1.5 text-[10px] text-muted-foreground/60">
                {new Date(msg.ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-lg bg-card border border-border flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div className="bg-card border border-border rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1 items-center h-5">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="w-1.5 h-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="pt-4 shrink-0">
        <div className="flex gap-2 bg-card border border-border rounded-xl p-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Preguntá sobre tus ventas, stock, clientes…"
            className="border-0 bg-transparent shadow-none focus-visible:ring-0 text-sm"
            disabled={loading}
          />
          <Button
            onClick={() => send()}
            disabled={!input.trim() || loading || !activeOrg}
            className="gradient-gold text-primary-foreground shrink-0"
            size="sm"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground/50 text-center mt-2">
          Los datos se actualizan en tiempo real. Las respuestas pueden no ser perfectas.
        </p>
      </div>
    </div>
  );
}
