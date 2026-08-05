/**
 * Preguntas sobre el producto, en la ficha.
 *
 * Es lo que tiene MercadoLibre y no tiene Tiendanube. La diferencia con las
 * reseñas es quién puede escribir: para opinar hay que haber comprado, para
 * preguntar alcanza con tener cuenta — quien pregunta todavía no compró, esa
 * es toda la idea.
 *
 * Sólo se listan las respondidas. Una tira de preguntas sin contestar le dice
 * al comprador que acá no atiende nadie, y eso frena más ventas de las que
 * destraba. La propia queda visible para quien la hizo mientras espera.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "./storeContext";
import { useStoreAuth } from "./storeAuth";
import { MessageCircleQuestion, Loader2, Clock } from "lucide-react";

export interface StoreQuestion {
  id: string;
  product_id: string;
  author_name: string;
  question: string;
  answer: string | null;
  created_at: string;
  answered_at: string | null;
}

interface MiPregunta {
  id: string;
  question: string;
  answer: string | null;
  created_at: string;
}

const fecha = (iso: string) =>
  new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" });

export default function ProductQuestions({ productId }: { productId: string }) {
  const { store } = useStore();
  const { customer } = useStoreAuth();
  const base = `/tienda/${store?.slug ?? ""}`;

  const [preguntas, setPreguntas] = useState<StoreQuestion[]>([]);
  const [mias, setMias] = useState<MiPregunta[]>([]);
  const [cargando, setCargando] = useState(true);

  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState(false);

  const cargar = useCallback(async () => {
    if (!store?.slug) return;
    const { data } = await supabase.rpc("get_store_questions", { p_slug: store.slug });
    const todas = (data ?? []) as unknown as StoreQuestion[];
    setPreguntas(todas.filter(q => q.product_id === productId));
    setCargando(false);
  }, [store?.slug, productId]);

  const cargarMias = useCallback(async () => {
    if (!store?.slug || !customer) { setMias([]); return; }
    const { data } = await supabase.rpc("get_my_questions", {
      p_slug: store.slug, p_product_id: productId,
    });
    setMias((data ?? []) as unknown as MiPregunta[]);
  }, [store?.slug, productId, customer]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { cargarMias(); }, [cargarMias]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!store?.slug || !texto.trim()) return;
    setEnviando(true);
    setError(null);
    const { error: rpcErr } = await supabase.rpc("ask_product_question", {
      p_slug: store.slug, p_product_id: productId, p_question: texto.trim(),
    });
    setEnviando(false);
    // El mensaje del RPC ya viene escrito para el comprador; el prefijo que le
    // agrega Postgres no.
    if (rpcErr) { setError(rpcErr.message.replace(/^.*?:\s*/, "")); return; }
    setTexto("");
    setListo(true);
    cargarMias();
  };

  const inputStyle = {
    borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)",
  } as React.CSSProperties;

  if (cargando) return null;

  // Las propias que ya se contestaron aparecen en la lista pública: no se
  // repiten acá abajo.
  const pendientesMias = mias.filter(m => !m.answer);

  return (
    <section className="mt-14 pt-8 border-t" style={{ borderColor: "hsl(var(--st-border))" }}>
      <div className="flex items-center gap-2 mb-5">
        <MessageCircleQuestion className="w-5 h-5" style={{ color: "hsl(var(--st-accent))" }} />
        <h2 className="text-lg font-semibold">Preguntas y respuestas</h2>
        {preguntas.length > 0 && (
          <span className="text-sm" style={{ color: "hsl(var(--st-muted))" }}>
            ({preguntas.length})
          </span>
        )}
      </div>

      {customer ? (
        <form onSubmit={enviar} className="mb-6">
          <textarea
            value={texto}
            onChange={e => { setTexto(e.target.value.slice(0, 500)); setListo(false); }}
            rows={2}
            placeholder="¿Qué querés saber de este producto?"
            className="w-full px-3 py-2 text-sm border bg-transparent outline-none resize-y"
            style={inputStyle}
          />
          {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
          {listo && !error && (
            <p className="text-xs mt-1.5" style={{ color: "hsl(var(--st-accent))" }}>
              Listo, la enviamos. Te avisamos por mail cuando la contesten.
            </p>
          )}
          <div className="flex items-center gap-3 mt-2">
            <button
              type="submit"
              disabled={enviando || texto.trim().length < 3}
              className="px-4 py-2 text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50"
              style={{
                background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))",
                borderRadius: "var(--st-radius)",
              }}
            >
              {enviando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Preguntar
            </button>
            <span className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>
              {texto.length}/500
            </span>
          </div>
        </form>
      ) : (
        <p className="text-sm mb-6" style={{ color: "hsl(var(--st-muted))" }}>
          <Link to={`${base}/cuenta`} className="hover:underline" style={{ color: "hsl(var(--st-accent))" }}>
            Iniciá sesión
          </Link>{" "}
          para preguntar sobre este producto.
        </p>
      )}

      {/* Las propias sin contestar: sólo las ve quien preguntó. */}
      {pendientesMias.length > 0 && (
        <div className="space-y-3 mb-6">
          {pendientesMias.map(m => (
            <div
              key={m.id}
              className="border border-dashed p-3 text-sm"
              style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
            >
              <p>{m.question}</p>
              <p className="text-xs mt-1.5 inline-flex items-center gap-1" style={{ color: "hsl(var(--st-muted))" }}>
                <Clock className="w-3 h-3" /> Esperando respuesta — sólo la ves vos
              </p>
            </div>
          ))}
        </div>
      )}

      {preguntas.length === 0 ? (
        <p className="text-sm" style={{ color: "hsl(var(--st-muted))" }}>
          Todavía no hay preguntas respondidas sobre este producto.
        </p>
      ) : (
        <div className="space-y-5">
          {preguntas.map(q => (
            <div key={q.id} className="pb-5 border-b last:border-0" style={{ borderColor: "hsl(var(--st-border))" }}>
              <div className="flex items-baseline gap-2 flex-wrap">
                <p className="text-sm font-medium flex-1 min-w-0">{q.question}</p>
                <span className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>
                  {fecha(q.created_at)}
                </span>
              </div>
              <p className="text-xs mt-0.5" style={{ color: "hsl(var(--st-muted))" }}>
                {q.author_name}
              </p>
              {q.answer && (
                <div className="mt-3 ml-4 pl-3 border-l text-sm" style={{ borderColor: "hsl(var(--st-accent))" }}>
                  <p className="text-xs font-medium mb-0.5">Respuesta de {store?.name}</p>
                  <p className="whitespace-pre-line" style={{ color: "hsl(var(--st-muted))" }}>{q.answer}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
