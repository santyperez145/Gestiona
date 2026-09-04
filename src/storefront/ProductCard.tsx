import { useState } from "react";
import { Link } from "react-router-dom";
import { useStore, type StoreProduct } from "./storeContext";
import { Stars } from "./ProductReviews";
import { useWishlist } from "./wishlist";
import { ShoppingBag, Heart } from "lucide-react";
import { atributosDeImagenVitrina, mostrarImagenValida, ocultarImagenRota } from "./mediaFallback";
import {
  etiquetaTipoVariante,
  resumenVariantesParaCard,
  textoCtaVariante,
} from "@/lib/storeProductVariant";

export default function ProductCard({ p }: { p: StoreProduct }) {
  const { priceOf, fmt, addToCart, reviewsByProduct, variantsByProduct, basePath: base } = useStore();
  const variantes = variantsByProduct[p.id] ?? [];
  const [varianteId, setVarianteId] = useState<string | null>(null);
  const [avisoOpcion, setAvisoOpcion] = useState(false);
  const opiniones = reviewsByProduct[p.id];
  const { has, toggle } = useWishlist();
  const deseado = has(p.id);
  const precioProducto = priceOf(p);
  const resumenVariantes = resumenVariantesParaCard(variantes, precioProducto, varianteId);
  const variante = resumenVariantes.elegida;
  const price = resumenVariantes.precio;
  const list = Number(p.sale_price_ars);
  const off = price < list ? Math.round((1 - price / list) * 100) : 0;
  const tieneVariantes = variantes.length > 0;
  const stockVisible = tieneVariantes ? resumenVariantes.stockDisponible : Number(p.stock);
  const sinStock = stockVisible <= 0;
  const tipoVariante = variantes[0]?.variant_type;
  const etiquetaVariante = etiquetaTipoVariante(tipoVariante);
  const productUrl = `${base}/producto/${p.id}`;
  const imagen = variante?.image_url ?? p.image_url;

  return (
    <div
      className="storefront-product-card group flex flex-col overflow-hidden border transition-shadow hover:shadow-lg"
      data-has-sold-out-variants={resumenVariantes.agotadas > 0 ? "true" : undefined}
      data-variant-count={tieneVariantes ? variantes.length : undefined}
      style={{ borderColor: "hsl(var(--st-border))", background: "hsl(var(--st-surface))", borderRadius: "var(--st-radius)" }}
    >
      <Link to={productUrl} className="storefront-product-card__media relative block aspect-square overflow-hidden bg-black/5">
        <div aria-hidden="true" className="absolute inset-0 grid place-items-center opacity-20">
          <ShoppingBag className="w-8 h-8" />
        </div>
        {imagen && (
            <img
              src={imagen}
              alt={variante ? `${p.name} — ${variante.variant_name}` : p.name}
              {...atributosDeImagenVitrina("tarjeta")}
              onLoad={mostrarImagenValida}
              onError={ocultarImagenRota}
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          )}

        {off > 0 && (
          <span
            className="absolute top-2 left-2 px-2 py-0.5 text-[11px] font-bold"
            style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
          >
            −{off}%
          </span>
        )}
        {/* El corazón va sobre la imagen pero fuera del <Link>: adentro,
            cada clic navegaría a la ficha además de guardar. */}
        <button
          onClick={e => { e.preventDefault(); e.stopPropagation(); toggle(p.id); }}
          aria-label={deseado ? "Quitar de mis deseos" : "Guardar en mis deseos"}
          aria-pressed={deseado}
          className="absolute bottom-2 right-2 p-2 min-h-11 min-w-11 grid place-items-center rounded-full bg-white/85 hover:bg-white transition-colors"
        >
          <Heart
            className={`w-4 h-4 ${deseado ? "fill-current" : ""}`}
            style={{ color: deseado ? "hsl(var(--st-accent))" : "#555" }}
          />
        </button>

        {sinStock ? (
          <span
            className="absolute top-2 right-2 px-2 py-0.5 text-[11px] font-medium bg-black/70 text-white"
            style={{ borderRadius: "var(--st-radius)" }}
          >
            Sin stock
          </span>
        ) : stockVisible <= 3 ? (
          <span
            className="absolute top-2 right-2 px-2 py-0.5 text-[11px] font-medium bg-black/70 text-white"
            style={{ borderRadius: "var(--st-radius)" }}
          >
            {stockVisible === 1 ? "¡Última!" : `¡Últimas ${stockVisible}!`}
          </span>
        ) : null}
      </Link>

      <div className="storefront-product-card__content p-3 flex flex-col flex-1">
        {p.brand && (
          <p className="text-[11px] uppercase tracking-wide" style={{ color: "hsl(var(--st-muted))" }}>{p.brand}</p>
        )}
        <Link to={productUrl} className="text-sm font-medium leading-snug line-clamp-2 hover:underline">
          {p.name}
        </Link>

        {/* Sólo si hay opiniones: cinco estrellas vacías en un producto nuevo
            transmiten lo contrario de lo que se busca. */}
        {opiniones && (
          <div className="mt-1 flex items-center gap-1">
            <Stars value={opiniones.avg} size={12} />
            <span className="text-[11px]" style={{ color: "hsl(var(--st-muted))" }}>
              ({opiniones.count})
            </span>
          </div>
        )}

        <div className="mt-2 flex items-baseline gap-2" aria-live="polite">
          <span className="text-base font-bold">
            {resumenVariantes.desde && <span className="mr-1 text-xs font-medium">Desde</span>}
            {fmt(price)}
          </span>
          {off > 0 && (
            <span className="text-xs line-through" style={{ color: "hsl(var(--st-muted))" }}>{fmt(list)}</span>
          )}
        </div>

        {!sinStock ? (
          <div className="mt-3 space-y-2">
            {tieneVariantes && (
              <fieldset>
                <legend className="mb-1.5 text-[11px] font-medium" style={{ color: "hsl(var(--st-muted))" }}>
                  {textoCtaVariante(tipoVariante)}
                </legend>
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={etiquetaVariante}>
                {resumenVariantes.rapidas.map(v => {
                  const sel = v.id === varianteId;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      role="radio"
                      aria-checked={sel}
                      onClick={() => { setVarianteId(v.id); setAvisoOpcion(false); }}
                      className="min-h-11 max-w-full px-2.5 text-xs border truncate"
                      style={{
                        borderColor: sel ? "hsl(var(--st-accent))" : "hsl(var(--st-border))",
                        background: sel ? "hsl(var(--st-accent) / 0.12)" : "transparent",
                        borderRadius: "var(--st-radius)",
                      }}
                    >
                      {v.variant_name}
                    </button>
                  );
                })}
                </div>
              </fieldset>
            )}
            {resumenVariantes.requiereDetalle && (
              <Link
                to={productUrl}
                className="inline-flex min-h-11 items-center text-xs font-semibold underline underline-offset-4"
                style={{ color: "hsl(var(--st-accent))" }}
              >
                Ver {variantes.length === 1 ? "la opción" : `las ${variantes.length} opciones`}
                {resumenVariantes.agotadas > 0 ? ` · ${resumenVariantes.agotadas} agotada${resumenVariantes.agotadas === 1 ? "" : "s"}` : ""}
              </Link>
            )}
            {avisoOpcion && (
              <p className="text-[11px]" style={{ color: "hsl(var(--st-muted))" }}>
                elegí una opción
              </p>
            )}
            <button
              onClick={() => {
                if (tieneVariantes) {
                  if (!variante) { setAvisoOpcion(true); return; }
                  addToCart(p, 1, variante);
                  return;
                }
                addToCart(p);
              }}
              className="storefront-product-card__add w-full min-h-11 py-2 text-sm font-medium transition-opacity hover:opacity-90"
              style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
            >
              {tieneVariantes && !variante ? textoCtaVariante(tipoVariante) : "Agregar"}
            </button>
          </div>
        ) : (
          <Link
            to={productUrl}
            className="mt-3 w-full min-h-11 grid place-items-center py-2 text-sm font-medium text-center border"
            style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
          >
            {tieneVariantes ? "Ver opciones y avisos" : "Avisame cuando vuelva"}
          </Link>
        )}
      </div>
    </div>
  );
}
