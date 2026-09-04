import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useStore } from "./storeContext";
import ProductCard from "./ProductCard";
import {
  menuDeCategorias, nombreDeCategoria, arbolDeCategorias, slugsDeRama,
} from "@/lib/storeCategories";
import { normalizeText, queryTokens, matchesAllTokens } from "@/lib/searchText";
import { FAMILIAS_OLFATIVAS, taxLabel } from "@/lib/scentTaxonomy";
import { SlidersHorizontal, X } from "lucide-react";
import { storeCatalogEmptyKind } from "@/lib/storeCatalogEmpty";
import { storeCatalogPage } from "@/lib/storeCatalogPagination";

const ORDENES = [
  { v: "relevancia", l: "Relevancia" },
  { v: "precio_asc", l: "Precio: menor a mayor" },
  { v: "precio_desc", l: "Precio: mayor a menor" },
  { v: "nuevo", l: "Más nuevos" },
  { v: "vendidos", l: "Más vendidos" },
];

export default function StoreProducts() {
  const { products, perfumes, categorias: cats2, priceOf, fmt } = useStore();
  const [params, setParams] = useSearchParams();
  const [showFilters, setShowFilters] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const q = params.get("q") ?? "";
  const cat = params.get("cat") ?? "";
  const genero = params.get("genero") ?? "";
  const familia = params.get("familia") ?? "";
  const soloOferta = params.get("oferta") === "1";
  // Los límites viven en la URL como el resto de los filtros, así que un
  // enlace compartido conserva el rango. Un valor basura se ignora en vez de
  // vaciar la grilla sin explicación.
  const precioMin = Number(params.get("min")) || 0;
  const precioMax = Number(params.get("max")) || 0;
  const orden = params.get("orden") ?? "relevancia";

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    // Un filtro nuevo puede tener menos páginas. Mantener `page=3` haría que
    // el comprador aterrice al final de una lista que acaba de cambiar.
    next.delete("page");
    setParams(next, { replace: true });
  };

  // Nombre y orden de las categorías del comercio; si no cargó ninguna, los
  // slugs de los productos, como antes.
  const categorias = useMemo(
    () => menuDeCategorias(
      cats2, products.map(p => p.category).filter(Boolean) as string[],
    ),
    [cats2, products],
  );
  // Familia olfativa y género sólo aparecen si el catálogo los usa: un
  // comercio de otro rubro no debe ver filtros de perfumería vacíos.
  const familias = useMemo(
    () => [...new Set(Object.values(perfumes).map(d => d.familia_olfativa).filter(Boolean))] as string[],
    [perfumes],
  );
  const generosUsados = useMemo(
    () => [...new Set(products.map(p => p.gender).filter(Boolean))] as string[],
    [products],
  );

  // Los slugs que cuentan cuando se filtra: el elegido más su descendencia.
  const slugsFiltro = useMemo(
    () => (cat ? new Set(slugsDeRama(cat, cats2)) : null),
    [cat, cats2],
  );

  const arbolCats = useMemo(() => {
    const conProductos = new Set(products.map(p => p.category).filter(Boolean) as string[]);
    const visible = (n: { slug: string; productosEnRama: number }) =>
      n.productosEnRama > 0 || conProductos.has(n.slug);

    if (cats2.length === 0) {
      // Sin categorías propias no hay jerarquía que mostrar: la lista plana de
      // siempre, armada con los slugs de los productos.
      return categorias.map(c => ({ ...c, hijos: [] as { slug: string; label: string }[] }));
    }
    return arbolDeCategorias(cats2)
      .filter(visible)
      .map(n => ({
        slug: n.slug,
        label: nombreDeCategoria(n.slug, cats2),
        hijos: n.hijos.filter(visible).map(h => ({
          slug: h.slug, label: nombreDeCategoria(h.slug, cats2),
        })),
      }));
  }, [cats2, categorias, products]);

  const filtrados = useMemo(() => {
    const tokens = queryTokens(q);
    let out = products.filter(p => {
      if (tokens.length) {
        const hay = normalizeText(`${p.name} ${p.brand ?? ""} ${p.description ?? ""}`);
        if (!matchesAllTokens(hay, tokens)) return false;
      }
      if (slugsFiltro && !slugsFiltro.has(p.category ?? "")) return false;
      if (genero && p.gender !== genero) return false;
      if (soloOferta && priceOf(p) >= Number(p.sale_price_ars)) return false;
      if (precioMin > 0 && priceOf(p) < precioMin) return false;
      if (precioMax > 0 && priceOf(p) > precioMax) return false;
      if (familia && perfumes[p.id]?.familia_olfativa !== familia) return false;
      return true;
    });

    out = [...out];
    if (orden === "precio_asc") out.sort((a, b) => priceOf(a) - priceOf(b));
    else if (orden === "precio_desc") out.sort((a, b) => priceOf(b) - priceOf(a));
    else if (orden === "nuevo") out.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    else if (orden === "vendidos") out.sort((a, b) => (Number(b.total_sold) || 0) - (Number(a.total_sold) || 0));
    return out;
  }, [products, perfumes, q, cat, genero, familia, soloOferta, precioMin, precioMax, orden, priceOf]);

  const activos = [q, cat, genero, familia, soloOferta ? "1" : "",
    precioMin > 0 ? "min" : "", precioMax > 0 ? "max" : ""].filter(Boolean).length;

  // Rango real del catálogo, para que los placeholders digan algo útil en vez
  // de un 0 y un 999999 que no existen en la tienda.
  const [rangoMin, rangoMax] = useMemo(() => {
    if (products.length === 0) return [0, 0];
    const precios = products.map(priceOf);
    return [Math.floor(Math.min(...precios)), Math.ceil(Math.max(...precios))];
  }, [products, priceOf]);

  const limpiar = () => {
    // Incluye la búsqueda: dejar `q` hacía que «Limpiar» no limpiara nada.
    setParams(new URLSearchParams(), { replace: true });
  };

  const emptyKind = storeCatalogEmptyKind({
    catalogCount: products.length,
    filteredCount: filtrados.length,
    hasActiveFilters: activos > 0,
  });
  const pagina = storeCatalogPage(filtrados.length, params.get("page"));
  const productosVisibles = filtrados.slice(pagina.start, pagina.end);

  // Una URL pedida fuera de rango tiene una sola identidad canónica. Si el
  // catálogo quedó con dos páginas y alguien abre `page=9`, mostramos y
  // dejamos escrita la página 2; no exponemos dos URL para el mismo contenido.
  useEffect(() => {
    const requested = params.get("page");
    const normalized = pagina.page > 1 ? String(pagina.page) : null;
    if (requested === normalized) return;
    const next = new URLSearchParams(params);
    if (normalized) next.set("page", normalized); else next.delete("page");
    setParams(next, { replace: true });
  }, [pagina.page, params, setParams]);

  const hrefDePagina = (nextPage: number) => {
    const next = new URLSearchParams(params);
    if (nextPage <= 1) next.delete("page"); else next.set("page", String(nextPage));
    const query = next.toString();
    return query ? `?${query}` : "?";
  };

  const irAPagina = (nextPage: number) => {
    const next = new URLSearchParams(params);
    if (nextPage <= 1) next.delete("page"); else next.set("page", String(nextPage));
    // La página queda en la URL: volver desde una ficha conserva la posición
    // lógica del catálogo en vez de reconstruir siempre la primera tanda.
    setParams(next);
    requestAnimationFrame(() => {
      headingRef.current?.focus({ preventScroll: true });
      headingRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  };

  return (
    <div className="storefront-products max-w-6xl mx-auto px-4 py-8">
      <div className="storefront-products__toolbar flex items-baseline justify-between gap-3 flex-wrap mb-5">
        <div>
          <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold outline-none">
            {q ? `Resultados para "${q}"` : cat ? nombreDeCategoria(cat, cats2) : soloOferta ? "Ofertas" : "Todos los productos"}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "hsl(var(--st-muted))" }}>
            {filtrados.length} {filtrados.length === 1 ? "producto" : "productos"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(v => !v)}
            className="sm:hidden inline-flex min-h-11 items-center gap-1.5 px-3 py-2 text-sm border"
            style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Filtros{activos > 0 && ` (${activos})`}
          </button>
          <select
            aria-label="Ordenar productos"
            value={orden}
            onChange={e => setParam("orden", e.target.value === "relevancia" ? "" : e.target.value)}
            className="min-h-11 px-3 py-2 text-sm border bg-transparent"
            style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
          >
            {ORDENES.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </div>
      </div>

      <div className="storefront-products__layout grid sm:grid-cols-[13rem_1fr] gap-6">
        {/* ── Filtros ─────────────────────────────────────────────── */}
        <aside className={`storefront-filter-panel ${showFilters ? "block" : "hidden"} sm:block space-y-5`}>
          {activos > 0 && (
            <button onClick={limpiar} className="text-xs inline-flex items-center gap-1 hover:underline" style={{ color: "hsl(var(--st-link))" }}>
              <X className="w-3 h-3" /> Limpiar filtros
            </button>
          )}

          <Grupo titulo="Categoría">
            <Opcion activo={!cat} onClick={() => setParam("cat", "")}>Todas</Opcion>
            {arbolCats.map(n => (
              <div key={n.slug}>
                <Opcion activo={cat === n.slug} onClick={() => setParam("cat", n.slug)}>
                  {n.label}
                </Opcion>
                {/* Las subcategorías van indentadas debajo del padre: una lista
                    plana de ocho no deja ver qué está adentro de qué. */}
                {n.hijos.map(h => (
                  <div key={h.slug} className="pl-3">
                    <Opcion activo={cat === h.slug} onClick={() => setParam("cat", h.slug)}>
                      {h.label}
                    </Opcion>
                  </div>
                ))}
              </div>
            ))}
          </Grupo>

          {generosUsados.length > 0 && (
            <Grupo titulo="Género">
              <Opcion activo={!genero} onClick={() => setParam("genero", "")}>Todos</Opcion>
              {["masculino", "femenino", "unisex"].filter(g => generosUsados.includes(g)).map(g => (
                <Opcion key={g} activo={genero === g} onClick={() => setParam("genero", g)}>
                  <span className="capitalize">{g}</span>
                </Opcion>
              ))}
            </Grupo>
          )}

          {familias.length > 0 && (
            <Grupo titulo="Familia olfativa">
              <Opcion activo={!familia} onClick={() => setParam("familia", "")}>Todas</Opcion>
              {familias.map(f => (
                <Opcion key={f} activo={familia === f} onClick={() => setParam("familia", f)}>
                  {taxLabel(FAMILIAS_OLFATIVAS, f)}
                </Opcion>
              ))}
            </Grupo>
          )}

          <Grupo titulo="Precio">
            <div className="flex items-center gap-2">
              <input
                type="number" inputMode="numeric" min={0}
                value={precioMin || ""}
                onChange={e => setParam("min", e.target.value)}
                placeholder={rangoMin ? String(rangoMin) : "Desde"}
                aria-label="Precio mínimo"
                className="w-full min-w-0 px-2 py-1.5 text-sm border bg-transparent outline-none"
                style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
              />
              <span className="text-xs shrink-0" style={{ color: "hsl(var(--st-muted))" }}>a</span>
              <input
                type="number" inputMode="numeric" min={0}
                value={precioMax || ""}
                onChange={e => setParam("max", e.target.value)}
                placeholder={rangoMax ? String(rangoMax) : "Hasta"}
                aria-label="Precio máximo"
                className="w-full min-w-0 px-2 py-1.5 text-sm border bg-transparent outline-none"
                style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
              />
            </div>
            {/* Un rango invertido devuelve cero productos sin motivo aparente:
                se avisa antes de que el comprador crea que no hay stock. */}
            {precioMin > 0 && precioMax > 0 && precioMax < precioMin && (
              <p className="text-xs mt-1.5" style={{ color: "hsl(var(--st-muted))" }}>
                El máximo es menor que el mínimo.
              </p>
            )}

            <label className="flex items-center gap-2 text-sm cursor-pointer mt-3">
              <input
                type="checkbox"
                checked={soloOferta}
                onChange={e => setParam("oferta", e.target.checked ? "1" : "")}
              />
              Solo ofertas
            </label>
          </Grupo>
        </aside>

        {/* ── Grilla ──────────────────────────────────────────────── */}
        <div>
          {emptyKind === "first_use" ? (
            <div className="py-20 text-center space-y-2">
              <p className="font-medium">Todavía no hay productos publicados</p>
              <p className="text-sm max-w-sm mx-auto" style={{ color: "hsl(var(--st-muted))" }}>
                Esta tienda todavía está preparando su catálogo. Volvé pronto para ver productos disponibles.
              </p>
            </div>
          ) : emptyKind === "filtered" ? (
            <div className="py-20 text-center">
              <p className="font-medium">No encontramos productos con esos filtros</p>
              {/* El aviso del rango invertido también vive en la barra de
                  filtros, pero en el teléfono esa barra arranca colapsada: el
                  comprador veía la grilla vacía y ninguna explicación. Acá está
                  donde efectivamente mira. */}
              {precioMin > 0 && precioMax > 0 && precioMax < precioMin ? (
                <p className="text-sm mt-1" style={{ color: "hsl(var(--st-muted))" }}>
                  El máximo es menor que el mínimo.
                </p>
              ) : (
                <p className="text-sm mt-1" style={{ color: "hsl(var(--st-muted))" }}>
                  Probá quitando alguno o buscando otra cosa.
                </p>
              )}
              {activos > 0 && (
                <button
                  onClick={limpiar}
                  className="mt-4 min-h-11 px-4 py-2 text-sm font-medium"
                  style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
                >
                  Limpiar filtros
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="storefront-products__grid grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                {productosVisibles.map(p => <ProductCard key={p.id} p={p} />)}
              </div>

              {pagina.pageCount > 1 && (
                <nav
                  aria-label="Páginas del catálogo"
                  className="mt-8 flex flex-wrap items-center justify-center gap-3"
                >
                  {pagina.hasPrevious ? (
                    <a
                      href={hrefDePagina(pagina.page - 1)}
                      onClick={event => {
                        event.preventDefault();
                        irAPagina(pagina.page - 1);
                      }}
                      rel="prev"
                      className="inline-flex min-h-11 min-w-11 items-center px-4 py-2 text-sm font-medium border"
                      style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
                    >
                      Anterior
                    </a>
                  ) : (
                    <span
                      aria-disabled="true"
                      className="inline-flex min-h-11 min-w-11 items-center px-4 py-2 text-sm font-medium border opacity-40"
                      style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
                    >
                      Anterior
                    </span>
                  )}
                  <span className="min-w-28 text-center text-sm" aria-live="polite">
                    Página {pagina.page} de {pagina.pageCount}
                    <span className="block text-xs" style={{ color: "hsl(var(--st-muted))" }}>
                      {pagina.start + 1}–{pagina.end} de {filtrados.length}
                    </span>
                  </span>
                  {pagina.hasNext ? (
                    <a
                      href={hrefDePagina(pagina.page + 1)}
                      onClick={event => {
                        event.preventDefault();
                        irAPagina(pagina.page + 1);
                      }}
                      rel="next"
                      className="inline-flex min-h-11 min-w-11 items-center px-4 py-2 text-sm font-medium border"
                      style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
                    >
                      Siguiente
                    </a>
                  ) : (
                    <span
                      aria-disabled="true"
                      className="inline-flex min-h-11 min-w-11 items-center px-4 py-2 text-sm font-medium border opacity-40"
                      style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
                    >
                      Siguiente
                    </span>
                  )}
                </nav>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="storefront-filter-group">
      <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "hsl(var(--st-muted))" }}>
        {titulo}
      </p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Opcion({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`block w-full min-h-11 text-left text-sm py-2.5 transition-opacity ${activo ? "font-semibold" : "opacity-70 hover:opacity-100"}`}
      style={activo ? { color: "hsl(var(--st-link))" } : undefined}
    >
      {children}
    </button>
  );
}
