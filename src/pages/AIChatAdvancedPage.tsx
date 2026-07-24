import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Brain, Plus, Send, Trash2, Pin, Archive, BookOpen, Star,
  ChevronRight, Sparkles, MessageSquare, Clock, Zap, Copy, RefreshCcw,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";
import AIChatAssistantTab from "@/components/ai-chat/AIChatAssistantTab";

/* ─────────────────────────── types ─────────────────────────── */
interface ChatSession {
  id: string;
  title: string;
  model: string;
  message_count: number;
  total_tokens: number;
  is_pinned: boolean;
  is_archived: boolean;
  tags: string[];
  updated_at: string;
  created_at: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  tokens_used: number;
  is_error: boolean;
  created_at: string;
}

interface PromptItem {
  id: string;
  title: string;
  prompt: string;
  category: string;
  use_count: number;
}

/* ─────────────────────────── configs ─────────────────────────── */
const MODELS = [
  { value: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet", desc: "Rápido y preciso" },
  { value: "claude-opus-4-5",   label: "Claude Opus 4.5",   desc: "Máxima inteligencia" },
  { value: "claude-haiku-3-5",  label: "Claude Haiku 3.5",  desc: "Ultra rápido" },
];

const PROMPT_CATEGORIES: Record<string, { label: string; color: string }> = {
  sales:      { label: "Ventas",      color: "bg-green-500/15 text-green-400" },
  inventory:  { label: "Inventario",  color: "bg-blue-500/15 text-blue-400" },
  finance:    { label: "Finanzas",    color: "bg-yellow-500/15 text-yellow-400" },
  marketing:  { label: "Marketing",  color: "bg-pink-500/15 text-pink-400" },
  hr:         { label: "RRHH",        color: "bg-purple-500/15 text-purple-400" },
  general:    { label: "General",    color: "bg-muted/40 text-muted-foreground" },
  analysis:   { label: "Análisis",   color: "bg-indigo-500/15 text-indigo-400" },
  templates:  { label: "Templates",  color: "bg-orange-500/15 text-orange-400" },
};

const STARTER_PROMPTS = [
  { icon: "📊", text: "Analizá las ventas del último mes y dame un resumen ejecutivo con insights clave" },
  { icon: "📦", text: "¿Qué productos están en riesgo de quiebre de stock? Dame prioridades" },
  { icon: "💰", text: "Creá un forecast de cash flow para los próximos 3 meses basado en el historial" },
  { icon: "🎯", text: "Identificá los clientes de mayor valor (top 10) y sugería estrategias de retención" },
  { icon: "📈", text: "¿Cuáles son los productos con mayor margen y mayor potencial de crecimiento?" },
  { icon: "🔍", text: "Detectá patrones inusuales en los datos de ventas que merezcan atención" },
];

/* ─────────────────────────── message bubble ─────────────────────────── */
function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isUser ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}>
        {isUser ? "U" : <Brain className="w-4 h-4" />}
      </div>
      <div className={`max-w-[75%] ${isUser ? "items-end" : "items-start"} flex flex-col`}>
        <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${isUser ? "bg-primary text-primary-foreground rounded-tr-sm" : msg.is_error ? "bg-destructive/10 border border-destructive/30 text-destructive" : "bg-card border border-border text-foreground rounded-tl-sm shadow-sm"}`}>
          <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
        </div>
        <div className={`flex items-center gap-2 mt-1 ${isUser ? "flex-row-reverse" : ""}`}>
          <span className="text-xs text-muted-foreground">{new Date(msg.created_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</span>
          {msg.tokens_used > 0 && <span className="text-xs text-muted-foreground/50">{msg.tokens_used} tokens</span>}
          {!isUser && (
            <button onClick={() => { navigator.clipboard.writeText(msg.content); toast.success("Copiado"); }} className="text-muted-foreground/50 hover:text-muted-foreground">
              <Copy className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AIChatAdvancedPage() {
  usePageTitle("Chat IA");
  const [pageTab, setPageTab] = useState<"asistente" | "conversaciones">("asistente");
  const { orgId } = useOrganization();
  const { user } = useAuth();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useState("claude-3-5-sonnet");
  const [showPromptLib, setShowPromptLib] = useState(false);
  const [showNewPrompt, setShowNewPrompt] = useState(false);
  const [promptForm, setPromptForm] = useState({ title: "", prompt: "", category: "general" });
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!orgId || !user) return;
    setLoading(true);
    const [sr, pr] = await Promise.allSettled([
      supabase.from("ai_chat_sessions").select("*").eq("org_id", orgId).eq("is_archived", false).order("is_pinned", { ascending: false }).order("updated_at", { ascending: false }),
      supabase.from("ai_prompts_library").select("*").eq("org_id", orgId).order("use_count", { ascending: false }),
    ]);
    if (sr.status === "fulfilled" && sr.value.data) setSessions(sr.value.data as ChatSession[]);
    if (pr.status === "fulfilled" && pr.value.data) setPrompts(pr.value.data as PromptItem[]);
    setLoading(false);
  }, [orgId, user]);

  const kpis = useMemo(() => {
    const totalSessions = sessions.length;
    const pinnedSessions = sessions.filter(s => s.is_pinned).length;
    const totalMessages = sessions.reduce((sum, s) => sum + s.message_count, 0);
    const totalTokens = sessions.reduce((sum, s) => sum + s.total_tokens, 0);
    return { totalSessions, pinnedSessions, totalMessages, totalTokens };
  }, [sessions]);

  useEffect(() => { load(); }, [load]);

  async function loadMessages(sessionId: string) {
    const { data } = await supabase.from("ai_chat_messages").select("*").eq("session_id", sessionId).order("created_at");
    if (data) setMessages(data as ChatMessage[]);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }

  async function createSession() {
    if (!orgId || !user) return;
    const { data, error } = await supabase.from("ai_chat_sessions").insert({ org_id: orgId, user_id: user.id, title: "Nueva conversación", model: selectedModel }).select().single();
    if (error) { toast.error(error.message); return; }
    const session = data as ChatSession;
    setSessions(p => [session, ...p]);
    setActiveSession(session);
    setMessages([]);
  }

  async function sendMessage() {
    if (!input.trim() || !activeSession || !orgId || sending) return;
    const userContent = input.trim();
    setInput("");
    setSending(true);

    // Optimistic UI
    const tempUserMsg: ChatMessage = { id: "tmp-u", role: "user", content: userContent, tokens_used: 0, is_error: false, created_at: new Date().toISOString() };
    setMessages(p => [...p, tempUserMsg]);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

    // Persist user message
    const { data: savedMsg } = await supabase.from("ai_chat_messages").insert({ session_id: activeSession.id, org_id: orgId, role: "user", content: userContent }).select().single();

    // Update session title after first message
    if (activeSession.message_count === 0) {
      const title = userContent.slice(0, 60) + (userContent.length > 60 ? "…" : "");
      await supabase.from("ai_chat_sessions").update({ title }).eq("id", activeSession.id);
      setActiveSession(p => p ? { ...p, title } : p);
      setSessions(p => p.map(s => s.id === activeSession.id ? { ...s, title } : s));
    }

    // Replace temp with saved
    if (savedMsg) {
      setMessages(p => p.map(m => m.id === "tmp-u" ? savedMsg as ChatMessage : m));
    }

    // Simulate AI response (in production: call edge function / Anthropic API)
    await new Promise(r => setTimeout(r, 1200));
    const simulatedReply = `[Respuesta simulada de ${selectedModel}]\n\nRecibí tu consulta: "${userContent.slice(0, 80)}${userContent.length > 80 ? "…" : ""}"\n\nEn producción, este módulo se conecta al API de Anthropic para generar respuestas contextuales sobre tus datos de negocio en tiempo real.`;

    const { data: aiMsg } = await supabase.from("ai_chat_messages").insert({ session_id: activeSession.id, org_id: orgId, role: "assistant", content: simulatedReply, model: selectedModel, tokens_used: Math.floor(Math.random() * 500) + 100 }).select().single();
    if (aiMsg) {
      setMessages(p => [...p, aiMsg as ChatMessage]);
      setActiveSession(p => p ? { ...p, message_count: p.message_count + 2 } : p);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }

    setSending(false);
  }

  async function pinSession(s: ChatSession) {
    await supabase.from("ai_chat_sessions").update({ is_pinned: !s.is_pinned }).eq("id", s.id);
    setSessions(p => p.map(sess => sess.id === s.id ? { ...sess, is_pinned: !s.is_pinned } : sess));
  }

  async function archiveSession(id: string) {
    await supabase.from("ai_chat_sessions").update({ is_archived: true }).eq("id", id);
    setSessions(p => p.filter(s => s.id !== id));
    if (activeSession?.id === id) { setActiveSession(null); setMessages([]); }
    toast.success("Conversación archivada");
  }

  async function savePrompt() {
    if (!orgId || !user || !promptForm.title.trim() || !promptForm.prompt.trim()) return;
    const { error } = await supabase.from("ai_prompts_library").insert({ org_id: orgId, created_by: user.id, title: promptForm.title, prompt: promptForm.prompt, category: promptForm.category });
    if (error) { toast.error(error.message); return; }
    toast.success("Prompt guardado");
    setShowNewPrompt(false);
    load();
  }

  function applyPrompt(p: PromptItem) {
    setInput(p.prompt);
    supabase.from("ai_prompts_library").update({ use_count: p.use_count + 1 }).eq("id", p.id);
    setShowPromptLib(false);
  }

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Brain}
        title="Chat IA"
        description="Asistente de acciones y conversaciones con contexto de tu negocio"
        actions={
          pageTab === "conversaciones" ? (
            <Button size="sm" onClick={createSession}>
              <Plus className="w-3 h-3 mr-1" /> Nueva conversación
            </Button>
          ) : undefined
        }
      />

      {/* tabs */}
      <div className="flex gap-1 bg-muted/30 rounded-xl p-1 w-fit">
        {([
          { id: "asistente", label: "Asistente" },
          { id: "conversaciones", label: "Conversaciones" },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setPageTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${pageTab === t.id ? "bg-card border border-border/60 text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {pageTab === "asistente" && <AIChatAssistantTab />}

      {pageTab === "conversaciones" && (
      <>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Conversaciones" value={kpis.totalSessions} icon={MessageSquare} color="primary" sub="sesiones activas" />
        <KPICard label="Fijadas" value={kpis.pinnedSessions} icon={Pin} color="warning" sub="conversaciones pin" />
        <KPICard label="Mensajes totales" value={kpis.totalMessages} icon={Zap} color="success" sub="en todas las sesiones" />
        <KPICard label="Tokens usados" value={kpis.totalTokens.toLocaleString()} icon={Brain} color="blue" sub="uso de contexto" />
      </div>

      <div className="h-[calc(100vh-22rem)] flex gap-0 rounded-xl overflow-hidden border border-border/60">
      {/* ── Sidebar ── */}
      <div className="w-72 shrink-0 border-r bg-muted/30 flex flex-col">
        <div className="p-4 border-b space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2"><Brain className="w-4 h-4 text-primary" /> IA Chat</h2>
            <Button size="sm" onClick={createSession} className="h-8 px-3 text-xs"><Plus className="w-3 h-3 mr-1" /> Nueva</Button>
          </div>
          <Select value={selectedModel} onValueChange={setSelectedModel}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>{MODELS.map(m => <SelectItem key={m.value} value={m.value}><span>{m.label}</span></SelectItem>)}</SelectContent>
          </Select>
        </div>

        {/* Sessions list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loading ? <p className="text-center py-8 text-xs text-muted-foreground">Cargando…</p> : (
            <>
              {sessions.map(s => (
                <div key={s.id} onClick={() => { setActiveSession(s); loadMessages(s.id); }}
                  className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${activeSession?.id === s.id ? "bg-primary/10 text-primary" : "hover:bg-muted/50 text-foreground"}`}>
                  <MessageSquare className="w-4 h-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{s.title}</p>
                    <p className="text-xs text-muted-foreground">{s.message_count} msgs · {new Date(s.updated_at).toLocaleDateString("es-AR")}</p>
                  </div>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">
                    <button onClick={e => { e.stopPropagation(); pinSession(s); }} className={`p-0.5 rounded ${s.is_pinned ? "text-yellow-500" : "text-muted-foreground hover:text-yellow-500"}`}><Pin className="w-3 h-3" /></button>
                    <button onClick={e => { e.stopPropagation(); archiveSession(s.id); }} className="p-0.5 rounded text-muted-foreground hover:text-red-400"><Archive className="w-3 h-3" /></button>
                  </div>
                </div>
              ))}
              {sessions.length === 0 && <p className="text-center py-8 text-xs text-muted-foreground">Sin conversaciones. Creá una nueva.</p>}
            </>
          )}
        </div>

        {/* Prompt library button */}
        <div className="p-3 border-t">
          <button onClick={() => setShowPromptLib(true)} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-muted-foreground hover:bg-muted/50 transition-colors">
            <BookOpen className="w-4 h-4 text-primary" /> Biblioteca de Prompts
            <ChevronRight className="w-3 h-3 ml-auto" />
          </button>
        </div>
      </div>

      {/* ── Chat area ── */}
      <div className="flex-1 flex flex-col bg-card">
        {activeSession ? (
          <>
            {/* Header */}
            <div className="px-6 py-4 border-b flex items-center gap-3">
              <Brain className="w-5 h-5 text-primary" />
              <div className="flex-1">
                <p className="font-semibold text-foreground text-sm">{activeSession.title}</p>
                <p className="text-xs text-muted-foreground">{MODELS.find(m => m.value === activeSession.model)?.label} · {activeSession.total_tokens.toLocaleString()} tokens usados</p>
              </div>
              <Badge variant="outline" className="text-xs">{activeSession.message_count} mensajes</Badge>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages.length === 0 && (
                <div className="space-y-4 pb-12">
                  <p className="text-center text-muted-foreground text-sm pt-8">Empezá la conversación o usá un prompt sugerido:</p>
                  <div className="grid grid-cols-2 gap-2 max-w-2xl mx-auto">
                    {STARTER_PROMPTS.map((p, i) => (
                      <button key={i} onClick={() => setInput(p.text)}
                        className="flex items-start gap-2 p-3 text-left border rounded-xl text-xs text-foreground hover:border-primary/30 hover:bg-primary/5 transition-colors">
                        <span className="text-base">{p.icon}</span>
                        <span>{p.text.slice(0, 60)}…</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map(m => <MessageBubble key={m.id} msg={m} />)}
              {sending && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center"><Brain className="w-4 h-4 text-primary" /></div>
                  <div className="bg-card border rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                    <div className="flex gap-1"><div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" /><div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce delay-100" /><div className="w-2 h-2 bg-primary/60 rounded-full animate-bounce delay-200" /></div>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="px-6 py-4 border-t bg-muted/20">
              <div className="flex gap-3 items-end max-w-4xl mx-auto">
                <textarea
                  className="flex-1 resize-none border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[48px] max-h-32 bg-background text-foreground"
                  placeholder="Escribí tu consulta… (Enter para enviar, Shift+Enter para nueva línea)"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                  rows={1}
                />
                <Button onClick={sendMessage} disabled={sending || !input.trim()} className="h-12 px-5">
                  {sending ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-center text-xs text-muted-foreground mt-2">La IA tiene acceso a tu contexto de negocio. Sé específico para mejores respuestas.</p>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-4">
            <div className="w-20 h-20 bg-primary/10 rounded-3xl flex items-center justify-center">
              <Brain className="w-10 h-10 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">Chat IA</h2>
              <p className="text-muted-foreground text-sm mt-2 max-w-sm">Conversaciones con contexto de tu negocio: ventas, inventario, finanzas y más.</p>
            </div>
            <Button onClick={createSession} className="mt-2"><Sparkles className="w-4 h-4 mr-2" /> Nueva conversación</Button>
          </div>
        )}
      </div>
      </div>{/* end chat viewport */}
      </>
      )}

      {/* ── Prompt Library Dialog ── */}
      <Dialog open={showPromptLib} onOpenChange={setShowPromptLib}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><BookOpen className="w-5 h-5" /> Biblioteca de Prompts</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pb-12">
            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={() => { setPromptForm({ title: "", prompt: "", category: "general" }); setShowNewPrompt(true); }}>
                <Plus className="w-4 h-4 mr-1" /> Agregar prompt
              </Button>
            </div>
            {prompts.map(p => {
              const cat = PROMPT_CATEGORIES[p.category] ?? PROMPT_CATEGORIES.general;
              return (
                <div key={p.id} className="border rounded-xl p-4 space-y-2 hover:border-indigo-300 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-foreground text-sm">{p.title}</p>
                      <Badge className={`${cat.color} text-xs mt-1`}>{cat.label}</Badge>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground flex items-center gap-1"><Zap className="w-3 h-3" />{p.use_count}x</span>
                      <Button size="sm" variant="outline" onClick={() => applyPrompt(p)}>Usar</Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{p.prompt}</p>
                </div>
              );
            })}
            {prompts.length === 0 && <p className="text-center py-8 text-muted-foreground text-sm">Sin prompts guardados. Agregá tu primero.</p>}
          </div>
        </DialogContent>
      </Dialog>

      {/* New Prompt Dialog */}
      <Dialog open={showNewPrompt} onOpenChange={setShowNewPrompt}>
        <DialogContent>
          <DialogHeader><DialogTitle>Guardar Prompt</DialogTitle></DialogHeader>
          <div className="space-y-3 pb-12">
            <div><Label>Título *</Label><Input value={promptForm.title} onChange={e => setPromptForm(p => ({ ...p, title: e.target.value }))} /></div>
            <div>
              <Label>Categoría</Label>
              <Select value={promptForm.category} onValueChange={v => setPromptForm(p => ({ ...p, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(PROMPT_CATEGORIES).map(([k,v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Prompt *</Label><textarea rows={4} value={promptForm.prompt} onChange={e => setPromptForm(p => ({ ...p, prompt: e.target.value }))} className="w-full border rounded px-3 py-2 text-sm resize-none" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewPrompt(false)}>Cancelar</Button>
            <Button onClick={savePrompt}><Star className="w-4 h-4 mr-1" /> Guardar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
