import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useStore } from "./storeContext";
import ProductCard from "./ProductCard";
import { getCategoryLabel } from "@/lib/supabaseStore";
import { normalizeText, queryTokens, matchesAllTokens } from "@/lib/searchText";
import { FAMILIAS_OLFATIVAS, taxLabel } from "@/lib/scentTaxonomy";
import { SlidersHorizontal, X } from "lucide-react";

const ORDENES = [
  { v: "relevancia", l: "Relevancia" },
  { v: "precio_asc", l: "Precio: menor a mayor" },
  { v: "precio_desc", l: "Precio: mayor a menor" },
  { v: "nuevo", l: "Más nuevos" },
  { v: "vendidos", l: "Más vendidos" },
];

export default function StoreProducts() {
  const { products, perfumes, priceOf, fmt } = useStore();
  const [params, setParams] = useSearchParams();
  const [showFilters, setShowFilters] = useState(false);

  const q = params.get("q") ?? "";
  const cat = params.get("cat") ?? "";
  const genero = params.get("genero") ?? "";
  const familia = params.get("familia") ?? "";
  const soloOferta = params.get("oferta") === "1";
  const orden = params.get("orden") ?? "relevancia";

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  const categorias = useMemo(
    () => [...new Set(products.map(p => p.category).filter(Boolean))] as string[],
    [products],
  );
  const familias = useMemo(
    () => [...new Set(Object.values(perfumes).map(d => d.familia_olfativa).filter(Boolean))] as string[],
    [perfumes],
  );

  const filtrados = useMemo(() => {
    const tokens = queryTokens(q);
    let out = products.filter(p => {
      if (tokens.length) {
        const hay = normalizeText(`${p.name} ${p.brand ?? ""} ${p.description ?? ""}`);
        if (!matchesAllTokens(hay, tokens)) return false;
      }
      if (cat && p.category !== cat) return false;
      if (genero && p.gender !== genero) return false;
      if (soloOferta && priceOf(p) >= Number(p.sale_price_ars)) return false;
      if (familia && perfumes[p.id]?.familia_olfativa !== familia) return false;
      return true;
    });

    out = [...out];
    if (orden === "precio_asc") out.sort((a, b) => priceOf(a) - priceOf(b));
    else if (orden === "precio_desc") out.sort((a, b) => priceOf(b) - priceOf(a));
    else if (orden === "nuevo") out.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    else if (orden === "vendidos") out.sort((a, b) => (Number(b.total_sold) || 0) - (Number(a.total_sold) || 0));
    return out;
  }, [products, perfumes, q, cat, genero, familia, soloOferta, orden, priceOf]);

  const activos = [cat, genero, familia, soloOferta ? "1" : ""].filter(Boolean).length;

  const limpiar = () => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    setParams(next, { replace: true });
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-5">
        <div>
          <h1 className="text-2xl font-bold">
            {q ? `Resultados para "${q}"` : cat ? getCategoryLabel(cat) : soloOferta ? "Ofertas" : "Todos los productos"}
          </h1>
          <p className="text-sm mt-0.5" style={{ color: "hsl(var(--st-muted))" }}>
            {filtrados.length} {filtrados.length === 1 ? "producto" : "productos"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(v => !v)}
            className="sm:hidden inline-flex items-center gap-1.5 px-3 py-2 text-sm border"
            style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Filtros{activos > 0 && ` (${activos})`}
          </button>
          <select
            value={orden}
            onChange={e => setParam("orden", e.target.value === "relevancia" ? "" : e.target.value)}
            className="px-3 py-2 text-sm border bg-transparent"
            style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
          >
            {ORDENES.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </div>
      </div>

      <div className="grid sm:grid-cols-[13rem_1fr] gap-6">
        {/* ── Filtros ─────────────────────────────────────────────── */}
        <aside className={`${showFilters ? "block" : "hidden"} sm:block space-y-5`}>
          {activos > 0 && (
            <button onClick={limpiar} className="text-xs inline-flex items-center gap-1 hover:underline" style={{ color: "hsl(var(--st-accent))" }}>
              <X className="w-3 h-3" /> Limpiar filtros
            </button>
          )}

          <Grupo titulo="Categoría">
            <Opcion activo={!cat} onClick={() => setParam("cat", "")}>Todas</Opcion>
            {categorias.map(c => (
              <Opcion key={c} activo={cat === c} onClick={() => setParam("cat", c)}>
                {getCategoryLabel(c)}
              </Opcion>
            ))}
          </Grupo>

          <Grupo titulo="Género">
            <Opcion activo={!genero} onClick={() => setParam("genero", "")}>Todos</Opcion>
            {["masculino", "femenino", "unisex"].map(g => (
              <Opcion key={g} activo={genero === g} onClick={() => setParam("genero", g)}>
                <span className="capitalize">{g}</span>
              </Opcion>
            ))}
          </Grupo>

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
            <label className="flex items-center gap-2 text-sm cursor-pointer">
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
          {filtrados.length === 0 ? (
            <div className="py-20 text-center">
              <p className="font-medium">No encontramos productos con esos filtros</p>
              <p className="text-sm mt-1" style={{ color: "hsl(var(--st-muted))" }}>
                Probá quitando alguno o buscando otra cosa.
              </p>
              {activos > 0 && (
                <button
                  onClick={limpiar}
                  className="mt-4 px-4 py-2 text-sm font-medium"
                  style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
                >
                  Limpiar filtros
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {filtrados.map(p => <ProductCard key={p.id} p={p} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
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
      className={`block w-full text-left text-sm py-1 transition-opacity ${activo ? "font-semibold" : "opacity-70 hover:opacity-100"}`}
      style={activo ? { color: "hsl(var(--st-accent))" } : undefined}
    >
      {children}
    </button>
  );
}
