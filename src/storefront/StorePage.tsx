/**
 * Página de contenido de la tienda: /tienda/:slug/pagina/:pageSlug
 *
 * El contenido ya viene cargado en el contexto — son cuatro filas cortas y se
 * necesitan igual para armar el footer, así que un fetch por página sería una
 * ida al servidor de más.
 */
import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { useStore } from "./storeContext";
import { FileText } from "lucide-react";
import { renderMarkdown } from "./miniMarkdown";

export default function StorePage() {
  const { pageSlug } = useParams();
  const { store, pages, loading } = useStore();
  const base = `/tienda/${store?.slug ?? ""}`;
  const page = pages.find(p => p.slug === pageSlug);

  useEffect(() => {
    if (!page || !store) return;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", page.meta_description || page.title);
  }, [page, store]);

  if (loading) return <div className="max-w-3xl mx-auto px-4 py-16" />;

  if (!page) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-20 text-center">
        <FileText className="w-8 h-8 mx-auto mb-3 opacity-30" />
        <h1 className="text-lg font-semibold">Página no encontrada</h1>
        <p className="text-sm mt-1" style={{ color: "hsl(var(--st-muted))" }}>
          Puede que todavía no esté publicada.
        </p>
        <Link
          to={base}
          className="inline-block mt-5 px-4 py-2 text-sm font-medium"
          style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
        >
          Volver a la tienda
        </Link>
      </div>
    );
  }

  return (
    <article className="max-w-3xl mx-auto px-4 py-10">
      <nav className="text-xs mb-4" style={{ color: "hsl(var(--st-muted))" }}>
        <Link to={base} className="hover:underline">Inicio</Link> / {page.title}
      </nav>
      <h1 className="text-2xl font-semibold">{page.title}</h1>
      <div className="mt-6">{renderMarkdown(page.content)}</div>
      <p className="text-xs mt-10 pt-4 border-t" style={{ borderColor: "hsl(var(--st-border))", color: "hsl(var(--st-muted))" }}>
        Última actualización: {new Date(page.updated_at).toLocaleDateString("es-AR", { day: "2-digit", month: "long", year: "numeric" })}
      </p>
    </article>
  );
}
