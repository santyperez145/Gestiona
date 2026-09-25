import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, Send } from 'lucide-react';
import { campaignChatErrorMessage, listCampaignChat, sendCampaignChatMessage, type CampaignChatMessage } from '@/lib/campaignChatDB';
import WorkspaceState from '@/components/shared/WorkspaceState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const MAX_BODY = 2000;

const fmtHora = (iso: string) =>
  new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Hilo de chat de una colaboración campaña+creador, lado marca.
 * El RPC resuelve permisos server-side: si la org no tiene permiso de
 * influencers view, la lectura falla honesta.
 */
export default function CampaignChatPanel({ campaignId, influencerId, creatorName }: {
  campaignId: string;
  influencerId: string;
  creatorName: string;
}) {
  const client = useQueryClient();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const lock = useRef(false);

  const query = useQuery({
    queryKey: ['campaign-chat', campaignId, influencerId],
    queryFn: () => listCampaignChat(campaignId, influencerId),
    refetchOnWindowFocus: false,
  });

  const messages: CampaignChatMessage[] = query.data ?? [];

  // El hilo arranca abajo: lo último visible sin scroll manual.
  useEffect(() => {
    if (query.data && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [query.data]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = body.trim();
    if (!text || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await sendCampaignChatMessage(campaignId, influencerId, text);
      setBody('');
      await client.invalidateQueries({ queryKey: ['campaign-chat', campaignId, influencerId] });
    } catch (cause) {
      setError(campaignChatErrorMessage(cause));
    } finally {
      lock.current = false; setBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-border/60 bg-card p-4" aria-label={`Chat con ${creatorName}`}>
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Chat con {creatorName}</h3>
        <span className="text-xs text-muted-foreground">coordinación de la colaboración</span>
      </div>

      {query.isPending ? (
        <WorkspaceState kind="initial-loading" title="Cargando conversación" />
      ) : query.isError ? (
        <WorkspaceState kind="error-recoverable" title="No pudimos cargar la conversación" actionLabel="Reintentar" onAction={() => void query.refetch()} />
      ) : messages.length === 0 ? (
        <p className="rounded-lg bg-muted/40 px-3 py-4 text-center text-xs text-muted-foreground">
          Todavía no hay mensajes. Escribile a {creatorName} para coordinar la entrega.
        </p>
      ) : (
        <div ref={listRef} className="max-h-72 space-y-2 overflow-y-auto pr-1" aria-live="polite">
          {messages.map(m => (
            <div
              key={m.id}
              className={cn(
                'max-w-[85%] rounded-xl px-3 py-2 text-sm',
                m.author_role === 'brand'
                  ? 'ml-auto bg-primary/10 text-foreground'
                  : 'mr-auto bg-muted/60 text-foreground',
              )}
            >
              <p className="whitespace-pre-wrap break-words leading-relaxed">{m.body}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {m.author_role === 'brand' ? 'La marca' : creatorName} · {fmtHora(m.created_at)}
              </p>
            </div>
          ))}
        </div>
      )}

      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

      <form onSubmit={send} className="flex items-center gap-2">
        <Input
          value={body}
          maxLength={MAX_BODY}
          placeholder={`Mensaje para ${creatorName}`}
          aria-label={`Mensaje para ${creatorName}`}
          onChange={e => setBody(e.target.value)}
          className="h-9"
        />
        <Button type="submit" size="icon" className="h-9 w-9 shrink-0" disabled={busy || !body.trim()} aria-label="Enviar mensaje">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </section>
  );
}
