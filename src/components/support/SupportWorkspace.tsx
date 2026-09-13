import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, Building2, CheckCircle2, Clock3, ExternalLink,
  Headphones, Loader2, MessageSquare, Plus, RefreshCw, Search, Send, UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { safeChannel } from "@/lib/realtimeChannel";
import { supabase } from "@/integrations/supabase/client";
import {
  createPlatformSupportThread, listPlatformSupportMessages, listPlatformSupportThreads,
  markPlatformSupportThreadRead, sendPlatformSupportMessage, updatePlatformSupportThread,
  type PlatformSupportMessage, type PlatformSupportThread, type SupportCategory,
  type SupportPriority, type SupportStatus,
} from "@/lib/platformSupport";

const STATUS: Record<SupportStatus, { label: string; className: string }> = {
  open: { label: "Abierta", className: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300" },
  in_progress: { label: "En curso", className: "border-primary/30 bg-muted/10 text-primary dark:text-muted-foreground" },
  waiting_customer: { label: "Esperando respuesta", className: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  resolved: { label: "Resuelta", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  closed: { label: "Cerrada", className: "border-border bg-muted text-muted-foreground" },
};

const CATEGORY: Record<SupportCategory, string> = {
  general: "Consulta general",
  technical: "Problema técnico",
  billing: "Plan o facturación",
  account: "Cuenta y acceso",
  integration: "Integración",
};

const PRIORITY: Record<SupportPriority, string> = {
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};

function relativeTime(value: string) {
  const delta = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(delta / 60_000));
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return new Date(value).toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}

interface SupportWorkspaceProps {
  audience: "merchant" | "platform";
  orgId?: string;
}

export default function SupportWorkspace({ audience, orgId }: SupportWorkspaceProps) {
  const isPlatform = audience === "platform";
  const [threads, setThreads] = useState<PlatformSupportThread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<PlatformSupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [reply, setReply] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [newOpen, setNewOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState({
    subject: "", category: "technical" as SupportCategory,
    priority: "normal" as SupportPriority, message: "",
  });

  const selected = threads.find(thread => thread.id === selectedId) ?? null;

  const loadThreads = useCallback(async (preferId?: string) => {
    if (!isPlatform && !orgId) return;
    try {
      const rows = await listPlatformSupportThreads(isPlatform ? null : orgId!);
      setThreads(rows);
      setSelectedId(current => {
        const wanted = preferId ?? current;
        if (wanted && rows.some(row => row.id === wanted)) return wanted;
        return rows[0]?.id ?? null;
      });
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [isPlatform, orgId]);

  const loadMessages = useCallback(async (threadId: string) => {
    setLoadingMessages(true);
    try {
      const rows = await listPlatformSupportMessages(threadId);
      setMessages(rows);
      await markPlatformSupportThreadRead(threadId);
      setThreads(current => current.map(thread => thread.id === threadId ? { ...thread, unread_count: 0 } : thread));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  useEffect(() => { void loadThreads(); }, [loadThreads]);
  useEffect(() => {
    if (selectedId) void loadMessages(selectedId);
    else setMessages([]);
  }, [selectedId, loadMessages]);

  useEffect(() => {
    const scope = isPlatform ? "platform" : orgId;
    if (!scope) return;
    const channel = safeChannel("platform-support", scope)
      .on("postgres_changes", { event: "*", schema: "public", table: "platform_support_threads" }, () => {
        void loadThreads();
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "platform_support_messages" }, payload => {
        const message = payload.new as { thread_id?: string };
        if (message.thread_id === selectedId) void loadMessages(selectedId);
        void loadThreads();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [isPlatform, orgId, loadMessages, loadThreads, selectedId]);

  const filtered = useMemo(() => threads.filter(thread => {
    const matchesStatus = statusFilter === "all"
      || (statusFilter === "active" && !["resolved", "closed"].includes(thread.status))
      || thread.status === statusFilter;
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [thread.subject, thread.org_name, thread.requester_name, thread.latest_message]
      .some(value => value?.toLowerCase().includes(query));
    return matchesStatus && matchesSearch;
  }), [threads, search, statusFilter]);

  useEffect(() => {
    if (filtered.some(thread => thread.id === selectedId)) return;
    setSelectedId(filtered[0]?.id ?? null);
  }, [filtered, selectedId]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  async function createThread() {
    if (!orgId || creating) return;
    setCreating(true);
    try {
      const id = await createPlatformSupportThread({ orgId, ...form });
      setNewOpen(false);
      setForm({ subject: "", category: "technical", priority: "normal", message: "" });
      await loadThreads(id);
      toast.success("Consulta enviada. Ya podés seguirla desde este chat.");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setCreating(false);
    }
  }

  async function sendReply() {
    if (!selected || !reply.trim() || sending) return;
    const body = reply.trim();
    setSending(true);
    setReply("");
    try {
      await sendPlatformSupportMessage(selected.id, body);
      await Promise.all([loadMessages(selected.id), loadThreads(selected.id)]);
    } catch (error) {
      setReply(body);
      toast.error((error as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function changeStatus(status: SupportStatus, assignToMe = false) {
    if (!selected) return;
    try {
      await updatePlatformSupportThread(selected.id, status, assignToMe);
      await loadThreads(selected.id);
      toast.success(assignToMe ? "Conversación asignada" : "Estado actualizado");
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <section className="support-workspace overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm">
      <div className="grid min-h-[620px] lg:grid-cols-[330px_minmax(0,1fr)]">
        <aside className="flex min-h-0 max-h-[320px] flex-col border-b border-border/70 bg-muted/15 lg:max-h-none lg:border-b-0 lg:border-r">
          <div className="space-y-3 border-b border-border/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{isPlatform ? "Bandeja de soporte" : "Tus conversaciones"}</p>
                <p className="text-xs text-muted-foreground">{threads.filter(t => t.unread_count > 0).length} con novedades</p>
              </div>
              {isPlatform ? (
                <Button variant="ghost" size="icon" onClick={() => void loadThreads()} aria-label="Actualizar soporte">
                  <RefreshCw className="h-4 w-4" />
                </Button>
              ) : (
                <Button size="sm" onClick={() => setNewOpen(true)}><Plus className="mr-1.5 h-4 w-4" />Nueva</Button>
              )}
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar conversación..." className="pl-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger aria-label="Filtrar conversaciones"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Pendientes</SelectItem>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="resolved">Resueltas</SelectItem>
                <SelectItem value="closed">Cerradas</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            {loading ? (
              <div className="flex items-center justify-center p-10 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Cargando</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center">
                <MessageSquare className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm font-medium">Sin conversaciones</p>
                <p className="mt-1 text-xs text-muted-foreground">{isPlatform ? "La cola está al día." : "Creá una consulta y seguí la respuesta desde acá."}</p>
              </div>
            ) : filtered.map(thread => {
              const status = STATUS[thread.status];
              return (
                <button key={thread.id} type="button" onClick={() => setSelectedId(thread.id)}
                  className={`w-full border-b border-border/50 p-4 text-left transition-colors hover:bg-muted/40 ${selectedId === thread.id ? "bg-primary/5" : ""}`}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold">{thread.subject}</p>
                        {thread.unread_count > 0 && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-label={`${thread.unread_count} mensajes sin leer`} />}
                      </div>
                      {isPlatform && <p className="mt-0.5 truncate text-[11px] font-medium text-primary">{thread.org_name}</p>}
                      <p className="mt-1 truncate text-xs text-muted-foreground">{thread.latest_message}</p>
                    </div>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{relativeTime(thread.last_message_at)}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Badge variant="outline" className={`text-[10px] ${status.className}`}>{status.label}</Badge>
                    {thread.priority !== "normal" && <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-[10px] text-rose-600 dark:text-rose-300">{PRIORITY[thread.priority]}</Badge>}
                  </div>
                </button>
              );
            })}
          </ScrollArea>
        </aside>

        <div className="flex min-h-0 flex-col">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center p-8 text-center">
              <div className="max-w-sm">
                <Headphones className="mx-auto mb-4 h-10 w-10 text-primary/60" />
                <h3 className="font-semibold">{isPlatform ? "Elegí una conversación" : "Soporte conectado con tu negocio"}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{isPlatform ? "Vas a ver el contexto, historial y responsable sin entrar como el comercio." : "Las respuestas quedan asociadas a tu organización y visibles para tu equipo autorizado."}</p>
                {!isPlatform && <Button className="mt-5" onClick={() => setNewOpen(true)}><Plus className="mr-2 h-4 w-4" />Crear consulta</Button>}
              </div>
            </div>
          ) : (
            <>
              <header className="flex flex-col gap-3 border-b border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate font-semibold">{selected.subject}</h3>
                    <Badge variant="outline" className={STATUS[selected.status].className}>{STATUS[selected.status].label}</Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    {isPlatform && <span className="inline-flex items-center gap-1"><Building2 className="h-3 w-3" />{selected.org_name}</span>}
                    <span>{CATEGORY[selected.category]}</span><span>{PRIORITY[selected.priority]}</span>
                    <span className="inline-flex items-center gap-1"><UserRound className="h-3 w-3" />{selected.assigned_name || "Sin asignar"}</span>
                  </div>
                </div>
                {isPlatform && (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => void changeStatus("in_progress", true)}>Tomar caso</Button>
                    <Select value={selected.status} onValueChange={value => void changeStatus(value as SupportStatus)}>
                      <SelectTrigger className="w-[165px]" aria-label="Estado de la conversación"><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(STATUS).map(([value, config]) => <SelectItem key={value} value={value}>{config.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button asChild variant="ghost" size="icon"><Link to={`/platform/orgs/${selected.org_id}`} aria-label="Abrir organización"><ExternalLink className="h-4 w-4" /></Link></Button>
                  </div>
                )}
              </header>

              <ScrollArea className="min-h-0 flex-1 bg-muted/10 p-4">
                <div className="mx-auto max-w-3xl space-y-4 pr-4">
                  {loadingMessages ? (
                    <div className="flex justify-center p-8 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Cargando conversación</div>
                  ) : messages.map(message => {
                    const ownSide = isPlatform ? message.sender_kind === "support" : message.sender_kind === "merchant";
                    return (
                      <article key={message.id} className={`flex ${ownSide ? "justify-end" : "justify-start"}`}>
                        <div className={`max-w-[85%] rounded-2xl px-4 py-3 shadow-sm ${ownSide ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md border border-border/60 bg-card"}`}>
                          <div className={`mb-1 flex items-center gap-2 text-[10px] ${ownSide ? "text-primary-foreground/75" : "text-muted-foreground"}`}>
                            <span className="font-semibold">{message.sender_name}</span><span>{relativeTime(message.created_at)}</span>
                          </div>
                          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.body}</p>
                        </div>
                      </article>
                    );
                  })}
                  <div ref={messageEndRef} aria-hidden="true" />
                </div>
              </ScrollArea>

              <footer className="border-t border-border/70 p-4">
                {["resolved", "closed"].includes(selected.status) && !isPlatform ? (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm">
                    <span className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" />Esta consulta está cerrada.</span>
                    <Button variant="outline" size="sm" onClick={() => setNewOpen(true)}>Nueva consulta</Button>
                  </div>
                ) : (
                  <div className="flex items-end gap-2">
                    <Textarea value={reply} onChange={event => setReply(event.target.value)} maxLength={4000}
                      placeholder={isPlatform ? "Responder al comercio..." : "Escribí tu respuesta..."} className="min-h-[76px] resize-none"
                      onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendReply(); } }} />
                    <Button size="icon" className="h-11 w-11 shrink-0" disabled={!reply.trim() || sending} onClick={() => void sendReply()} aria-label="Enviar mensaje">
                      {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </div>
                )}
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground"><Clock3 className="h-3 w-3" />El historial queda guardado en la organización. No compartas contraseñas ni claves privadas.</p>
              </footer>
            </>
          )}
        </div>
      </div>

      {!isPlatform && (
        <Dialog open={newOpen} onOpenChange={setNewOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader><DialogTitle className="flex items-center gap-2"><MessageSquare className="h-5 w-5 text-primary" />Nueva consulta</DialogTitle></DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2"><Label htmlFor="support-subject">Asunto</Label><Input id="support-subject" value={form.subject} maxLength={120} onChange={event => setForm(current => ({ ...current, subject: event.target.value }))} placeholder="Ej. No puedo sincronizar Mercado Pago" /></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>Categoría</Label><Select value={form.category} onValueChange={value => setForm(current => ({ ...current, category: value as SupportCategory }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(CATEGORY).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label>Prioridad</Label><Select value={form.priority} onValueChange={value => setForm(current => ({ ...current, priority: value as SupportPriority }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(PRIORITY).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
              </div>
              <div className="space-y-2"><Label htmlFor="support-message">¿Qué necesitás resolver?</Label><Textarea id="support-message" value={form.message} maxLength={4000} onChange={event => setForm(current => ({ ...current, message: event.target.value }))} className="min-h-32" placeholder="Contanos qué estabas haciendo, qué esperabas y qué ocurrió. No incluyas contraseñas." /></div>
              {form.priority === "urgent" && <div className="flex gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200"><AlertTriangle className="h-4 w-4 shrink-0" />Urgente es para una operación detenida o riesgo activo. Priorizaremos el caso según impacto real.</div>}
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setNewOpen(false)}>Cancelar</Button><Button disabled={creating || form.subject.trim().length < 5 || form.message.trim().length < 2} onClick={() => void createThread()}>{creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}Enviar consulta</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
