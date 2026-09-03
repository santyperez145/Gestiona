/**
 * Reseñas en la ficha de producto.
 *
 * Sólo reseña quien compró: el RPC lo revalida al guardar, así que este
 * componente sólo decide qué mostrar. Sin esa regla las reseñas se llenan de
 * spam y dejan de servir, que es peor que no tenerlas.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useStore } from "./storeContext";
import { useStoreAuth } from "./storeAuth";
import { Star, BadgeCheck, Loader2 } from "lucide-react";

export interface StoreReview {
  id: string;
  product_id: string;
  author_name: string;
  rating: number;
  title: string | null;
  body: string | null;
  verified: boolean;
  reply: string | null;
  created_at: string;
}

/** Estrellas de sólo lectura, o interactivas si se pasa `onPick`. */
export function Stars({
  value, size = 14, onPick,
}: { value: number; size?: number; onPick?: (n: number) => void }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(n => {
        const lleno = n <= Math.round(value);
        const estrella = (
          <Star
            className={lleno ? "fill-current" : ""}
            style={{ width: size, height: size, color: lleno ? "hsl(var(--st-accent))" : "hsl(var(--st-border))" }}
          />
        );
        return onPick ? (
          <button key={n} type="button" onClick={() => onPick(n)} aria-label={`${n} de 5`}>
            {estrella}
          </button>
        ) : (
          <span key={n}>{estrella}</span>
        );
      })}
    </span>
  );
}

export default function ProductReviews({ productId }: { productId: string }) {
  const { store, basePath: base } = useStore();
  const { customer } = useStoreAuth();

  const [reviews, setReviews] = useState<StoreReview[]>([]);
  const [cargando, setCargando] = useState(true);
  const [permiso, setPermiso] = useState<{ can: boolean; reason?: string } | null>(null);

  const [abierto, setAbierto] = useState(false);
  const [rating, setRating] = useState(5);
  const [titulo, setTitulo] = useState("");
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!store?.slug) return;
    const { data } = await supabase.rpc("get_store_reviews", { p_slug: store.slug });
    const todas = (data ?? []) as unknown as StoreReview[];
    setReviews(todas.filter(r => r.product_id === productId));
    setCargando(false);
  }, [store?.slug, productId]);

  useEffect(() => { cargar(); }, [cargar]);

  // Se consulta sólo con sesión: sin cuenta la respuesta es siempre "login".
  useEffect(() => {
    if (!store?.slug || !customer) { setPermiso(null); return; }
    supabase
      .rpc("can_review_product", { p_slug: store.slug, p_product_id: productId })
      .then(({ data }) => setPermiso(data as unknown as { can: boolean; reason?: string }), () => {});
  }, [store?.slug, productId, customer]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!store?.slug) return;
    setGuardando(true);
    setError(null);
    const { error: rpcErr } = await supabase.rpc("upsert_product_review", {
      p_slug: store.slug, p_product_id: productId,
      p_rating: rating, p_title: titulo || null, p_body: texto || null,
    });
    setGuardando(false);
    if (rpcErr) { setError(rpcErr.message.replace(/^.*?:\s*/, "")); return; }
    setAbierto(false);
    setTitulo(""); setTexto("");
    cargar();
  };

  const promedio = reviews.length
    ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length
    : 0;

  const input = "w-full px-3 py-2 text-sm border bg-transparent outline-none";
  const inputStyle = {
    borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)",
  } as React.CSSProperties;

  if (cargando) return null;

  return (
    <section className="mt-14 pt-8 border-t" style={{ borderColor: "hsl(var(--st-border))" }}>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
        <div>
          <h2 className="text-lg font-semibold">Opiniones</h2>
          {reviews.length > 0 ? (
            <div className="flex items-center gap-2 mt-1">
              <Stars value={promedio} size={16} />
              <span className="text-sm font-medium">{promedio.toFixed(1)}</span>
              <span className="text-sm" style={{ color: "hsl(var(--st-muted))" }}>
                ({reviews.length} {reviews.length === 1 ? "opinión" : "opiniones"})
              </span>
            </div>
          ) : (
            <p className="text-sm mt-1" style={{ color: "hsl(var(--st-muted))" }}>
              Todavía nadie opinó sobre este producto.
            </p>
          )}
        </div>

        {permiso?.can && !abierto && (
          <button
            onClick={() => setAbierto(true)}
            className="min-h-11 px-4 py-2 text-sm font-medium"
            style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
          >
            {permiso && "existing" in permiso && (permiso as { existing?: string }).existing
              ? "Editar mi opinión"
              : "Dejar mi opinión"}
          </button>
        )}
      </div>

      {/* Por qué no puede opinar. Se explica en vez de esconder el botón sin más. */}
      {!abierto && customer && permiso && !permiso.can && permiso.reason === "sin_compra" && (
        <p className="text-xs mb-5" style={{ color: "hsl(var(--st-muted))" }}>
          Sólo pueden opinar quienes compraron este producto.
        </p>
      )}
      {!abierto && !customer && (
        <p className="text-xs mb-5" style={{ color: "hsl(var(--st-muted))" }}>
          <Link to={`${base}/cuenta`} className="hover:underline" style={{ color: "hsl(var(--st-accent))" }}>
            Iniciá sesión
          </Link>{" "}
          para dejar tu opinión si ya compraste este producto.
        </p>
      )}

      {abierto && (
        <form
          onSubmit={enviar}
          className="mb-6 border p-4 space-y-3"
          style={{ borderColor: "hsl(var(--st-border))", background: "hsl(var(--st-surface))", borderRadius: "var(--st-radius)" }}
        >
          <div>
            <p className="text-xs mb-1.5" style={{ color: "hsl(var(--st-muted))" }}>Tu puntuación</p>
            <Stars value={rating} size={22} onPick={setRating} />
          </div>
          <input
            value={titulo} onChange={e => setTitulo(e.target.value.slice(0, 80))}
            placeholder="Un título corto (opcional)" className={input} style={inputStyle}
          />
          <textarea
            value={texto} onChange={e => setTexto(e.target.value.slice(0, 1000))}
            rows={3} placeholder="¿Qué te pareció? ¿Cuánto te dura?"
            className={input} style={inputStyle}
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit" disabled={guardando}
              className="px-4 py-2 text-sm font-medium inline-flex items-center gap-2 disabled:opacity-60"
              style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
            >
              {guardando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Publicar
            </button>
            <button
              type="button" onClick={() => { setAbierto(false); setError(null); }}
              className="min-h-11 px-4 py-2 text-sm border"
              style={inputStyle}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="space-y-4">
        {reviews.map(r => (
          <div key={r.id} className="pb-4 border-b last:border-0" style={{ borderColor: "hsl(var(--st-border))" }}>
            <div className="flex items-center gap-2 flex-wrap">
              <Stars value={r.rating} />
              <span className="text-sm font-medium">{r.author_name}</span>
              {r.verified && (
                <span
                  className="inline-flex items-center gap-1 text-[11px]"
                  style={{ color: "hsl(var(--st-accent))" }}
                  title="Compró este producto en la tienda"
                >
                  <BadgeCheck className="w-3.5 h-3.5" /> Compra verificada
                </span>
              )}
              <span className="text-xs ml-auto" style={{ color: "hsl(var(--st-muted))" }}>
                {new Date(r.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" })}
              </span>
            </div>
            {r.title && <p className="text-sm font-medium mt-1.5">{r.title}</p>}
            {r.body && (
              <p className="text-sm mt-1 leading-relaxed whitespace-pre-line" style={{ color: "hsl(var(--st-muted))" }}>
                {r.body}
              </p>
            )}
            {r.reply && (
              <div
                className="mt-3 ml-4 pl-3 border-l text-sm"
                style={{ borderColor: "hsl(var(--st-accent))" }}
              >
                <p className="text-xs font-medium mb-0.5">Respuesta de {store?.name}</p>
                <p style={{ color: "hsl(var(--st-muted))" }}>{r.reply}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
