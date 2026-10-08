/**
 * El buscador del header, con sugerencias mientras se tipea.
 *
 * Antes había que escribir, apretar Enter y esperar el catálogo para saber si
 * existía lo que se buscaba. Ahora se ve al toque, y eso resuelve dos cosas: el
 * que no sabe cómo se escribe "Khamrah" lo encuentra igual, y el que buscó algo
 * que no está se entera antes de llegar a una página vacía.
 *
 * Las reglas compartidas con el catálogo viven en `searchSuggest.ts`. Acá está el
 * comportamiento del control: teclado, foco y cierre.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import {
  sugerenciasDeBusqueda, destinoSugerencia, moverSeleccion,
  type ProductoBuscable, type Sugerencia,
} from "@/lib/searchSuggest";
import { atributosDeImagenVitrina, mostrarImagenValida, ocultarImagenRota } from "./mediaFallback";

interface Props {
  base: string;
  productos: ProductoBuscable[];
  nombreCategoria: (slug: string) => string;
  className?: string;
  /** El header y el menú del celular lo pintan distinto. */
  variante?: "header" | "panel";
  onNavegar?: () => void;
}

const ETIQUETA_TIPO: Record<Sugerencia["tipo"], string> = {
  marca: "Marca",
  categoria: "Categoría",
  producto: "",
};

export default function SearchBox({
  base, productos, nombreCategoria, className = "", variante = "header", onNavegar,
}: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const [q, setQ] = useState(() => new URLSearchParams(location.search).get("q") ?? "");
  const [abierto, setAbierto] = useState(false);
  const [sel, setSel] = useState(-1);
  const caja = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = `sugerencias-busqueda-${useId()}`;

  const sugerencias = useMemo(
    () => sugerenciasDeBusqueda(q, productos, { nombreCategoria }),
    [q, productos, nombreCategoria],
  );

  // Back/forward and external navigation must close stale suggestions too.
  useEffect(() => {
    setQ(new URLSearchParams(location.search).get("q") ?? "");
    setAbierto(false);
    setSel(-1);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (abierto && sel >= 0) document.getElementById(`${listId}-${sel}`)?.scrollIntoView({ block: "nearest" });
  }, [abierto, sel, listId]);

  // Cerrar al tocar afuera. Sin esto el desplegable queda flotando sobre la
  // página después de navegar con el mouse a cualquier otro lado.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) {
        setAbierto(false);
        setSel(-1);
      }
    };
    document.addEventListener("pointerdown", fuera);
    return () => document.removeEventListener("pointerdown", fuera);
  }, [abierto]);

  const irA = (destino: string) => {
    setAbierto(false);
    setSel(-1);
    setQ("");
    onNavegar?.();
    navigate(destino);
  };

  const buscarTexto = () => {
    const texto = q.trim();
    irA(`${base}/productos${texto ? `?q=${encodeURIComponent(texto)}` : ""}`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setAbierto(false); setSel(-1); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (sugerencias.length === 0) return;
      e.preventDefault();   // que no mueva el cursor dentro del input
      setAbierto(true);
      setSel(s => moverSeleccion(s, e.key === "ArrowDown" ? 1 : -1, sugerencias.length));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      // Con una sugerencia marcada gana ésa; si no, se busca lo escrito. El
      // orden importa: al revés, quien escribe y aprieta Enter termina en un
      // producto que no eligió.
      if (abierto && sel >= 0 && sugerencias[sel]) irA(destinoSugerencia(sugerencias[sel], base));
      else buscarTexto();
    }
  };

  const enHeader = variante === "header";

  return (
    <div ref={caja} className={`relative ${className}`} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setAbierto(false);
        setSel(-1);
      }
    }}>
      <form onSubmit={e => { e.preventDefault(); buscarTexto(); }} className="relative flex items-center">
        <Search
          className="w-4 h-4 absolute left-2.5 opacity-50 pointer-events-none"
          style={{ color: enHeader ? "hsl(var(--st-header-fg))" : "inherit" }}
        />
        <input
          ref={inputRef}
          value={q}
          onChange={e => { setQ(e.target.value); setAbierto(true); setSel(-1); }}
          onFocus={() => setAbierto(true)}
          onClick={() => setAbierto(true)}
          onKeyDown={onKeyDown}
          placeholder="Buscar..."
          aria-label="Buscar productos"
          aria-expanded={abierto && sugerencias.length > 0}
          role="combobox"
          aria-autocomplete="list"
          aria-controls={abierto && sugerencias.length > 0 ? listId : undefined}
          aria-activedescendant={abierto && sugerencias[sel] ? `${listId}-${sel}` : undefined}
          autoComplete="off"
          className={
            enHeader
              ? "min-h-11 w-full pl-8 pr-11 text-sm bg-white/15 placeholder:opacity-60 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-current transition-colors"
              : "w-full min-h-11 pl-8 pr-11 text-sm bg-white/15 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-current"
          }
          style={{
            color: enHeader ? "hsl(var(--st-header-fg))" : "hsl(var(--st-text))",
            background: enHeader ? "hsl(var(--st-header))" : "hsl(var(--st-bg))",
            border: enHeader ? "1px solid hsl(var(--st-header-fg) / 0.28)" : "1px solid hsl(var(--st-border))",
            borderRadius: "var(--st-radius)",
          }}
        />
        {q && (
          <button
            type="button"
            onClick={() => { setQ(""); setAbierto(false); setSel(-1); inputRef.current?.focus(); }}
            className="absolute right-0 min-h-11 min-w-11 grid place-items-center opacity-60 hover:opacity-100 focus-visible:outline focus-visible:outline-2"
            aria-label="Borrar la búsqueda"
            style={{ color: enHeader ? "hsl(var(--st-header-fg))" : "hsl(var(--st-text))" }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </form>

      {abierto && sugerencias.length > 0 && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-50 border shadow-lg overflow-hidden min-w-[16rem] max-w-[calc(100vw-2rem)]"
          onKeyDown={event => {
            if (event.key === "Escape") {
              event.preventDefault(); inputRef.current?.focus(); setAbierto(false); setSel(-1);
            }
          }}
          style={{
            background: "hsl(var(--st-bg))",
            borderColor: "hsl(var(--st-border))",
            borderRadius: "var(--st-radius)",
            color: "hsl(var(--st-text))",
          }}
        >
          <div id={listId} role="listbox" aria-label="Sugerencias de productos" className="max-h-[min(24rem,50dvh)] overflow-y-auto overscroll-contain">
          {sugerencias.map((s, i) => (
            <button
              id={`${listId}-${i}`}
              key={`${s.tipo}:${s.valor}`}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={i === sel}
              // Keep focus in the combobox; click works for touch and activation too.
              onMouseDown={e => e.preventDefault()}
              onClick={() => irA(destinoSugerencia(s, base))}
              onMouseEnter={() => setSel(i)}
              className="w-full min-h-11 flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors"
              style={{ background: i === sel ? "hsl(var(--st-accent) / 0.12)" : "transparent" }}
            >
              {s.tipo === "producto" ? (
                <span
                  className="w-8 h-8 shrink-0 overflow-hidden bg-black/5"
                  style={{ borderRadius: "var(--st-radius)" }}
                >
                  {s.imagen && (
                    <img
                      src={s.imagen}
                      alt=""
                      {...atributosDeImagenVitrina("miniatura")}
                      onLoad={mostrarImagenValida}
                      onError={ocultarImagenRota}
                      className="w-full h-full object-cover"
                    />
                  )}
                </span>
              ) : (
                <Search className="w-4 h-4 shrink-0 opacity-40" />
              )}

              <span className="min-w-0 flex-1">
                <span className="block truncate">{s.label}</span>
                <span className="block text-[11px]" style={{ color: "hsl(var(--st-muted))" }}>
                  {s.tipo === "producto"
                    ? (s.detalle ?? "")
                    : `${ETIQUETA_TIPO[s.tipo]} · ${s.cantidad} ${s.cantidad === 1 ? "producto" : "productos"}`}
                </span>
              </span>
            </button>
          ))}
          </div>

          <button
            type="button"
            onClick={buscarTexto}
            className="w-full min-h-11 px-3 py-2 text-left text-xs border-t hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
            style={{ borderColor: "hsl(var(--st-border))", color: "hsl(var(--st-link))" }}
          >
            Ver todo lo que coincide con "{q.trim()}"
          </button>
        </div>
      )}
    </div>
  );
}
