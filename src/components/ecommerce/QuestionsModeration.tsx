/**
 * Preguntas de la tienda, del lado del comercio.
 *
 * Una pregunta sin contestar es una venta esperando: por eso el filtro arranca
 * en "Sin responder" y no en "Todas". El comercio no puede editar la pregunta
 * —sólo responderla u ocultarla—, igual que con las opiniones.
 *
 * Al guardar la respuesta la pregunta se vuelve pública: mientras no la tenga,
 * la ve sólo quien preguntó.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageCircleQuestion, Eye, EyeOff, Loader2, Clock } from "lucide-react";

interface QuestionRow {
  id: string;
  product_id: string;
  author_name: string;
  question: string;
  answer: string | null;
  answered_at: string | null;
  status: string;
  created_at: string;
  products: { name: string } | null;
}

type Filtro = "sin_responder" | "respondidas" | "hidden" | "todas";

export default function QuestionsModeration() {
  const { orgId } = useOrganization();
  const [rows, setRows] = useState<QuestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>("sin_responder");
  const [respondiendo, setRespondiendo] = useState<string | null>(null);
  const [borrador, setBorrador] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("product_questions")
      .select("id, product_id, author_name, question, answer, answered_at, status, created_at, products(name)")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(300);
    setLoading(false);
    // Sin `?? []`: una lista vacía por permisos y una tienda sin preguntas se
    // ven igual y son problemas opuestos.
    if (error) { toast.error("No se pudieron cargar las preguntas"); return; }
    setRows((data ?? []) as unknown as QuestionRow[]);
  }, [orgId]);

  useEffect(() => { cargar(); }, [cargar]);

  const responder = async (q: QuestionRow) => {
    const texto = borrador.trim();
    if (!texto) { toast.error("Escribí la respuesta"); return; }
    setGuardando(true);
    const ahora = new Date().toISOString();
    const { error } = await supabase
      .from("product_questions")
      .update({ answer: texto, answered_at: ahora })
      .eq("id", q.id);
    setGuardando(false);
    if (error) { toast.error("No se pudo guardar la respuesta"); return; }
    setRows(prev => prev.map(x => (x.id === q.id ? { ...x, answer: texto, answered_at: ahora } : x)));
    setRespondiendo(null);
    setBorrador("");
    toast.success("Respondida — ya se ve en la tienda");
  };

  const cambiarEstado = async (q: QuestionRow) => {
    const nuevo = q.status === "published" ? "hidden" : "published";
    const { error } = await supabase
      .from("product_questions").update({ status: nuevo }).eq("id", q.id);
    if (error) { toast.error("No se pudo actualizar"); return; }
    setRows(prev => prev.map(x => (x.id === q.id ? { ...x, status: nuevo } : x)));
    toast.success(nuevo === "hidden" ? "Pregunta oculta" : "Pregunta publicada");
  };

  const pendientes = rows.filter(q => !q.answer);

  const visibles = useMemo(() => rows.filter(q => {
    if (filtro === "todas") return true;
    if (filtro === "sin_responder") return !q.answer;
    if (filtro === "respondidas") return !!q.answer && q.status === "published";
    return q.status === "hidden";
  }), [rows, filtro]);

  const FILTROS: { id: Filtro; label: string }[] = [
    { id: "sin_responder", label: `Sin responder (${pendientes.length})` },
    { id: "respondidas",   label: `Respondidas (${rows.filter(q => q.answer && q.status === "published").length})` },
    { id: "hidden",        label: `Ocultas (${rows.filter(q => q.status === "hidden").length})` },
    { id: "todas",         label: `Todas (${rows.length})` },
  ];

  if (loading) {
    return <div className="py-12 grid place-items-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  if (rows.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl p-10 text-center">
        <MessageCircleQuestion className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
        <p className="font-medium">Todavía no hay preguntas</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
          Cualquiera con cuenta en la tienda puede preguntar sobre un producto. En la
          ficha se publican sólo las que ya respondiste — una lista de preguntas sin
          contestar espanta más de lo que ayuda.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-muted-foreground">
          {pendientes.length > 0
            ? <>Tenés <strong className="text-foreground">{pendientes.length}</strong> {pendientes.length === 1 ? "pregunta sin responder" : "preguntas sin responder"}. Cada una es una venta esperando.</>
            : "Todas las preguntas están respondidas."}
        </p>
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
        {visibles.map(q => (
          <div key={q.id} className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-medium">{q.question}</p>
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  {q.author_name} · {q.products?.name ?? "Producto"} · {new Date(q.created_at).toLocaleDateString("es-AR")}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {!q.answer && (
                  <Badge className="bg-amber-500/15 text-amber-500 border-amber-500/20 gap-1 text-[11px]">
                    <Clock className="w-3 h-3" />Sin responder
                  </Badge>
                )}
                {q.status === "hidden" && (
                  <Badge className="bg-zinc-500/15 text-zinc-400 border-zinc-500/20 text-[11px]">Oculta</Badge>
                )}
                <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => cambiarEstado(q)}>
                  {q.status === "published"
                    ? <><EyeOff className="w-3 h-3" />Ocultar</>
                    : <><Eye className="w-3 h-3" />Publicar</>}
                </Button>
                <Button
                  size="sm" variant={q.answer ? "outline" : "default"} className="gap-1.5 text-xs"
                  onClick={() => { setRespondiendo(respondiendo === q.id ? null : q.id); setBorrador(q.answer ?? ""); }}
                >
                  <MessageCircleQuestion className="w-3 h-3" />{q.answer ? "Editar" : "Responder"}
                </Button>
              </div>
            </div>

            {q.answer && respondiendo !== q.id && (
              <div className="mt-3 ml-4 pl-3 border-l-2 border-primary/40">
                <p className="text-xs font-medium">Tu respuesta</p>
                <p className="text-sm text-muted-foreground whitespace-pre-line">{q.answer}</p>
              </div>
            )}

            {respondiendo === q.id && (
              <div className="mt-3 space-y-2">
                <textarea
                  value={borrador}
                  onChange={e => setBorrador(e.target.value.slice(0, 1000))}
                  rows={3}
                  autoFocus
                  placeholder="La respuesta se publica en la ficha del producto, para todos."
                  className="w-full px-3 py-2 text-sm bg-background border border-border rounded-lg outline-none focus:ring-1 focus:ring-primary"
                />
                <div className="flex gap-2">
                  <Button size="sm" className="gap-1.5 text-xs" disabled={guardando} onClick={() => responder(q)}>
                    {guardando && <Loader2 className="w-3 h-3 animate-spin" />}
                    Publicar respuesta
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
