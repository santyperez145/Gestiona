/**
 * Moderación de opiniones de la tienda.
 *
 * El comercio no puede editar lo que escribió el cliente — sólo ocultarlo o
 * responderle. Una respuesta pública a una queja suele valer más que la queja
 * misma, así que responder está a un clic.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Star, Eye, EyeOff, MessageSquare, Loader2, BadgeCheck } from "lucide-react";

interface ReviewRow {
  id: string;
  product_id: string;
  author_name: string;
  rating: number;
  title: string | null;
  body: string | null;
  status: string;
  reply: string | null;
  replied_at: string | null;
  order_id: string | null;
  created_at: string;
  products: { name: string } | null;
}

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star
          key={i}
          className={`w-3.5 h-3.5 ${i <= n ? "fill-amber-400 text-amber-400" : "text-muted-foreground/30"}`}
        />
      ))}
    </span>
  );
}

export default function ReviewsModeration() {
  const { orgId } = useOrganization();
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<"todas" | "published" | "hidden" | "sin_responder">("todas");
  const [respondiendo, setRespondiendo] = useState<string | null>(null);
  const [borrador, setBorrador] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("product_reviews")
      .select("id, product_id, author_name, rating, title, body, status, reply, replied_at, order_id, created_at, products(name)")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(300);
    setLoading(false);
    // No se traga el error con `?? []`: una lista vacía por permisos se ve
    // igual que una tienda sin opiniones, y son problemas muy distintos.
    if (error) { toast.error("No se pudieron cargar las opiniones"); return; }
    setReviews((data ?? []) as unknown as ReviewRow[]);
  }, [orgId]);

  useEffect(() => { cargar(); }, [cargar]);

  const cambiarEstado = async (r: ReviewRow) => {
    const nuevo = r.status === "published" ? "hidden" : "published";
    const { error } = await supabase
      .from("product_reviews").update({ status: nuevo }).eq("id", r.id);
    if (error) { toast.error("No se pudo actualizar"); return; }
    setReviews(prev => prev.map(x => (x.id === r.id ? { ...x, status: nuevo } : x)));
    toast.success(nuevo === "hidden" ? "Opinión oculta de la tienda" : "Opinión publicada");
  };

  const responder = async (r: ReviewRow) => {
    setGuardando(true);
    const texto = borrador.trim();
    const { error } = await supabase
      .from("product_reviews")
      .update({ reply: texto || null, replied_at: texto ? new Date().toISOString() : null })
      .eq("id", r.id);
    setGuardando(false);
    if (error) { toast.error("No se pudo guardar la respuesta"); return; }
    setReviews(prev => prev.map(x => (
      x.id === r.id ? { ...x, reply: texto || null, replied_at: texto ? new Date().toISOString() : null } : x
    )));
    setRespondiendo(null);
    setBorrador("");
    toast.success(texto ? "Respuesta publicada" : "Respuesta eliminada");
  };

  const visibles = useMemo(() => reviews.filter(r => {
    if (filtro === "todas") return true;
    if (filtro === "sin_responder") return !r.reply;
    return r.status === filtro;
  }), [reviews, filtro]);

  const promedio = reviews.length
    ? reviews.filter(r => r.status === "published").reduce((s, r) => s + r.rating, 0) /
      Math.max(1, reviews.filter(r => r.status === "published").length)
    : 0;

  const FILTROS = [
    { id: "todas" as const,         label: `Todas (${reviews.length})` },
    { id: "published" as const,     label: `Publicadas (${reviews.filter(r => r.status === "published").length})` },
    { id: "hidden" as const,        label: `Ocultas (${reviews.filter(r => r.status === "hidden").length})` },
    { id: "sin_responder" as const, label: `Sin responder (${reviews.filter(r => !r.reply).length})` },
  ];

  if (loading) {
    return <div className="py-12 grid place-items-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (reviews.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-10 text-center">
        <MessageSquare className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
        <p className="font-medium">Todavía no hay opiniones</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          Sólo puede opinar quien compró el producto y pagó la orden. Después de las
          primeras ventas empiezan a aparecer acá.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Stars n={Math.round(promedio)} />
          <span className="text-sm font-medium">{promedio.toFixed(1)}</span>
          <span className="text-sm text-muted-foreground">promedio de las publicadas</span>
        </div>
        <div className="flex gap-1 bg-muted/30 p-1 rounded-xl flex-wrap">
          {FILTROS.map(f => (
            <button
              key={f.id} onClick={() => setFiltro(f.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                filtro === f.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {visibles.map(r => (
          <div key={r.id} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Stars n={r.rating} />
                  <span className="text-sm font-medium">{r.author_name}</span>
                  {r.order_id && (
                    <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/20 gap-1 text-[11px]">
                      <BadgeCheck className="w-3 h-3" />Compra verificada
                    </Badge>
                  )}
                  {r.status === "hidden" && (
                    <Badge className="bg-zinc-500/15 text-zinc-400 border-zinc-500/20 text-[11px]">Oculta</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  {r.products?.name ?? "Producto"} · {new Date(r.created_at).toLocaleDateString("es-AR")}
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => cambiarEstado(r)}>
                  {r.status === "published"
                    ? <><EyeOff className="w-3 h-3" />Ocultar</>
                    : <><Eye className="w-3 h-3" />Publicar</>}
                </Button>
                <Button
                  size="sm" variant="outline" className="gap-1.5 text-xs"
                  onClick={() => { setRespondiendo(respondiendo === r.id ? null : r.id); setBorrador(r.reply ?? ""); }}
                >
                  <MessageSquare className="w-3 h-3" />{r.reply ? "Editar respuesta" : "Responder"}
                </Button>
              </div>
            </div>

            {r.title && <p className="text-sm font-medium mt-2">{r.title}</p>}
            {r.body && <p className="text-sm text-muted-foreground mt-1 whitespace-pre-line">{r.body}</p>}

            {r.reply && respondiendo !== r.id && (
              <div className="mt-3 ml-4 pl-3 border-l-2 border-primary/40">
                <p className="text-xs font-medium">Tu respuesta</p>
                <p className="text-sm text-muted-foreground whitespace-pre-line">{r.reply}</p>
              </div>
            )}

            {respondiendo === r.id && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={borrador}
                  onChange={e => setBorrador(e.target.value.slice(0, 1000))}
                  rows={3}
                  placeholder="Tu respuesta se ve pública, debajo de la opinión."
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg outline-none focus:ring-1 focus:ring-primary"
                />
                <div className="flex gap-2">
                  <Button size="sm" className="gap-1.5 text-xs" disabled={guardando} onClick={() => responder(r)}>
                    {guardando && <Loader2 className="w-3 h-3 animate-spin" />}
                    Guardar
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs" onClick={() => { setRespondiendo(null); setBorrador(""); }}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
