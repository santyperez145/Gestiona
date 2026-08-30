/**
 * El buscador del header, con sugerencias mientras se tipea.
 *
 * Antes había que escribir, apretar Enter y esperar el catálogo para saber si
 * existía lo que se buscaba. Ahora se ve al toque, y eso resuelve dos cosas: el
 * que no sabe cómo se escribe "Khamrah" lo encuentra igual, y el que buscó algo
 * que no está se entera antes de llegar a una página vacía.
 *
 * Las reglas viven en `searchSuggest.ts` (18 tests). Acá sólo está el
 * comportamiento del control: teclado, foco y cierre.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import {
  sugerenciasDeBusqueda, destinoSugerencia, moverSeleccion,
  type ProductoBuscable, type Sugerencia,
} from "@/lib/searchSuggest";
import { mostrarImagenValida, ocultarImagenRota } from "./mediaFallback";

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
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState(false);
  const [sel, setSel] = useState(-1);
  const caja = useRef<HTMLDivElement>(null);

  const sugerencias = useMemo(
    () => sugerenciasDeBusqueda(q, productos, { nombreCategoria }),
    [q, productos, nombreCategoria],
  );

  // Al cambiar lo escrito la selección vuelve a cero: si no, la flecha quedaba
  // apuntando a una fila que ya es otra cosa.
  useEffect(() => { setSel(-1); }, [q]);

  // Cerrar al tocar afuera. Sin esto el desplegable queda flotando sobre la
  // página después de navegar con el mouse a cualquier otro lado.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);

  const irA = (destino: string) => {
    setAbierto(false);
    setQ("");
    onNavegar?.();
    navigate(destino);
  };

  const buscarTexto = () => {
    const texto = q.trim();
    irA(`${base}/productos${texto ? `?q=${encodeURIComponent(texto)}` : ""}`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setAbierto(false); return; }
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
      if (sel >= 0 && sugerencias[sel]) irA(destinoSugerencia(sugerencias[sel], base));
      else buscarTexto();
    }
  };

  const enHeader = variante === "header";

  return (
    <div ref={caja} className={`relative ${className}`}>
      <form onSubmit={e => { e.preventDefault(); buscarTexto(); }} className="relative flex items-center">
        <Search
          className="w-4 h-4 absolute left-2.5 opacity-50 pointer-events-none"
          style={{ color: enHeader ? "hsl(var(--st-accent-fg))" : "inherit" }}
        />
        <input
          value={q}
          onChange={e => { setQ(e.target.value); setAbierto(true); }}
          onFocus={() => setAbierto(true)}
          onKeyDown={onKeyDown}
          placeholder="Buscar..."
          aria-label="Buscar productos"
          aria-expanded={abierto && sugerencias.length > 0}
          role="combobox"
          aria-controls="sugerencias-busqueda"
          className={
            enHeader
              ? "h-9 w-full rounded-full pl-8 pr-8 text-sm bg-white/15 placeholder:opacity-60 outline-none focus:bg-white/25 transition-colors"
              : "w-full h-9 rounded-full pl-8 pr-8 text-sm bg-white/15 outline-none"
          }
          style={{ color: "hsl(var(--st-accent-fg))" }}
        />
        {q && (
          <button
            type="button"
            onClick={() => { setQ(""); setAbierto(false); }}
            className="absolute right-2 opacity-60 hover:opacity-100"
            aria-label="Borrar la búsqueda"
            style={{ color: "hsl(var(--st-accent-fg))" }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </form>

      {abierto && sugerencias.length > 0 && (
        <div
          id="sugerencias-busqueda"
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 z-50 border shadow-lg overflow-hidden min-w-[16rem]"
          style={{
            background: "hsl(var(--st-bg))",
            borderColor: "hsl(var(--st-border))",
            borderRadius: "var(--st-radius)",
            color: "hsl(var(--st-text))",
          }}
        >
          {sugerencias.map((s, i) => (
            <button
              key={`${s.tipo}:${s.valor}`}
              type="button"
              role="option"
              aria-selected={i === sel}
              // `onMouseDown` y no `onClick`: el `blur` del input dispara antes
              // que el click y el desplegable se cierra sin navegar.
              onMouseDown={e => { e.preventDefault(); irA(destinoSugerencia(s, base)); }}
              onMouseEnter={() => setSel(i)}
              className="w-full min-h-11 flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors"
              style={{ background: i === sel ? "hsl(var(--st-accent) / 0.12)" : "transparent" }}
            >
              {s.tipo === "producto" ? (
                <span
                  className="w-8 h-8 shrink-0 overflow-hidden bg-black/5"
                  style={{ borderRadius: "var(--st-radius)" }}
                >
                  {s.imagen && <img src={s.imagen} alt="" onLoad={mostrarImagenValida} onError={ocultarImagenRota} className="w-full h-full object-cover" />}
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

          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); buscarTexto(); }}
            className="w-full min-h-11 px-3 py-2 text-left text-xs border-t hover:opacity-80"
            style={{ borderColor: "hsl(var(--st-border))", color: "hsl(var(--st-accent))" }}
          >
            Ver todo lo que coincide con "{q.trim()}"
          </button>
        </div>
      )}
    </div>
  );
}
