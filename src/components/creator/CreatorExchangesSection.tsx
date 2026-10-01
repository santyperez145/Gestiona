import { useState } from "react";
import { ExternalLink, Gift, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { useCreator, type CreatorExchange } from "@/lib/creatorContext";
import { creatorOperationError } from "@/lib/creatorOperationError";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const closedStatuses = new Set(["cumplido", "cancelado", "rechazado", "completado", "finalizado", "completed", "cancelled"]);
const statusLabels: Record<string, string> = {
  pendiente: "Pendiente", enviado: "Enviado", entregado: "Entregado", publicado: "Publicado",
  cumplido: "Cumplido", cancelado: "Cancelado", rechazado: "Rechazado", completado: "Cumplido", finalizado: "Finalizado", completed: "Cumplido", cancelled: "Cancelado",
};

function ExchangeItem({ exchange }: { exchange: CreatorExchange }) {
  const { submitExchangeContent } = useCreator();
  const [url, setUrl] = useState(exchange.content_url ?? "");
  const [posts, setPosts] = useState(String(exchange.actual_posts || 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closed = closedStatuses.has(exchange.status);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    let parsed: URL;
    try { parsed = new URL(url.trim()); } catch { setError("Ingresá el enlace HTTPS de tu publicación."); return; }
    const count = Number(posts);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || url.length > 2048
      || !Number.isInteger(count) || count < 1 || count > 1000) {
      setError("Usá un enlace HTTPS válido y una cantidad de publicaciones entre 1 y 1000."); return;
    }
    setBusy(true); setError(null);
    try {
      await submitExchangeContent(exchange.id, url.trim(), count);
      toast.success("Contenido enviado para revisión de la marca");
    } catch (cause) {
      console.error("[creator] enviar contenido de canje", cause);
      setError(creatorOperationError(cause, "No pudimos enviar el contenido. Conservamos tus datos para que puedas reintentar."));
    } finally { setBusy(false); }
  };

  return (
    <article className="border-b border-border py-5 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-semibold">{exchange.product_name}</h3>
          <p className="text-xs text-muted-foreground">{exchange.org_name} · {exchange.quantity} unidades · {exchange.expected_posts ?? 0} publicaciones acordadas</p>
        </div>
        <Badge variant="outline">{statusLabels[exchange.status] ?? "En seguimiento"}</Badge>
      </div>
      {exchange.goal_notes && <p className="mt-3 whitespace-pre-wrap break-words text-sm">{exchange.goal_notes}</p>}
      {exchange.content_submitted_at && (
        <p className="mt-3 text-xs text-muted-foreground">Contenido enviado el {new Date(exchange.content_submitted_at).toLocaleDateString("es-AR")}. {closed ? "Canje cerrado." : "Pendiente de revisión de la marca."}</p>
      )}
      {exchange.content_url?.startsWith("https://") && <a className="mt-2 inline-flex items-center gap-1 text-sm text-primary underline" href={exchange.content_url} target="_blank" rel="noopener noreferrer">Ver contenido <ExternalLink className="h-3.5 w-3.5" /></a>}
      {!closed && (
        <form onSubmit={submit} className="mt-4 grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_120px_auto]">
          <div className="space-y-1.5"><Label htmlFor={`exchange-url-${exchange.id}`}>Enlace de la publicación</Label><Input id={`exchange-url-${exchange.id}`} type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://" required maxLength={2048} disabled={busy} /></div>
          <div className="space-y-1.5"><Label htmlFor={`exchange-posts-${exchange.id}`}>Publicaciones</Label><Input id={`exchange-posts-${exchange.id}`} type="number" min={1} max={1000} step={1} value={posts} onChange={event => setPosts(event.target.value)} required disabled={busy} /></div>
          <Button type="submit" disabled={busy} className="gap-2">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{exchange.content_submitted_at ? "Actualizar entrega" : "Enviar contenido"}</Button>
          {error && <p role="alert" className="text-sm text-destructive sm:col-span-3">{error}</p>}
        </form>
      )}
    </article>
  );
}

export default function CreatorExchangesSection() {
  const { exchanges } = useCreator();
  return (
    <section aria-label="Tus canjes">
      <h2 className="flex items-center gap-2 text-base font-semibold"><Gift className="h-4 w-4 text-primary" /> Tus canjes</h2>
      {exchanges.length ? exchanges.map(exchange => <ExchangeItem key={exchange.id} exchange={exchange} />)
        : <p className="py-8 text-sm text-muted-foreground">Todavía no tenés canjes vinculados. La marca debe asignarlos al perfil con el email de tu cuenta.</p>}
    </section>
  );
}
