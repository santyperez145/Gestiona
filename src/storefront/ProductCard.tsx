import { Link } from "react-router-dom";
import { useStore, type StoreProduct } from "./storeContext";
import { Stars } from "./ProductReviews";
import { useWishlist } from "./wishlist";
import { ShoppingBag, Heart } from "lucide-react";
import { atributosDeImagenVitrina, mostrarImagenValida, ocultarImagenRota } from "./mediaFallback";
import {
  resumenVariantesParaCard,
  textoCtaVariante,
} from "@/lib/storeProductVariant";

export default function ProductCard({ p }: { p: StoreProduct }) {
  const { priceOf, fmt, addToCart, reviewsByProduct, variantsByProduct, basePath: base } = useStore();
  const variantes = variantsByProduct[p.id] ?? [];
  const opiniones = reviewsByProduct[p.id];
  const { has, toggle } = useWishlist();
  const deseado = has(p.id);
  const precioProducto = priceOf(p);
  const resumenVariantes = resumenVariantesParaCard(variantes, precioProducto);
  const price = resumenVariantes.precio;
  const list = Number(p.sale_price_ars);
  const off = price < list ? Math.round((1 - price / list) * 100) : 0;
  const tieneVariantes = variantes.length > 0;
  const stockVisible = tieneVariantes ? resumenVariantes.stockDisponible : Number(p.stock);
  const sinStock = stockVisible <= 0;
  const tipoVariante = variantes[0]?.variant_type;
  const productUrl = `${base}/producto/${p.id}`;
  const imagen = p.image_url;

  return (
    <article
      className="storefront-product-card group flex flex-col overflow-hidden"
      data-has-sold-out-variants={resumenVariantes.agotadas > 0 ? "true" : undefined}
      data-variant-count={tieneVariantes ? variantes.length : undefined}
    >
      <div className="storefront-product-card__media relative">
        <Link to={productUrl} className="relative block aspect-[4/5] overflow-hidden" style={{ background: "hsl(var(--st-muted) / 0.08)" }}>
          <div aria-hidden="true" className="absolute inset-0 grid place-items-center opacity-10">
            <ShoppingBag className="w-7 h-7" />
          </div>
          {imagen && (
            <img
              src={imagen}
              alt={p.name}
              {...atributosDeImagenVitrina("tarjeta")}
              onLoad={mostrarImagenValida}
              onError={ocultarImagenRota}
              className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300 group-hover:opacity-[0.92]"
            />
          )}
        </Link>

        {off > 0 && (
          <span
            className="storefront-product-card__badge absolute top-2.5 left-2.5 px-2 py-0.5 text-[10px] font-bold tracking-wide"
            style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "calc(var(--st-radius) * 0.45)" }}
          >
            −{off}%
          </span>
        )}

        <button
          type="button"
          onClick={e => { e.preventDefault(); e.stopPropagation(); toggle(p.id); }}
          aria-label={deseado ? "Quitar de mis deseos" : "Guardar en mis deseos"}
          aria-pressed={deseado}
          className="absolute bottom-2.5 right-2.5 p-2 min-h-11 min-w-11 grid place-items-center bg-white/92 border hover:bg-white transition-colors"
          style={{ borderColor: "hsl(var(--st-border) / 0.55)", borderRadius: "var(--st-radius)" }}
        >
          <Heart
            className={`w-4 h-4 ${deseado ? "fill-current" : ""}`}
            style={{ color: deseado ? "hsl(var(--st-link))" : "#555" }}
          />
        </button>

        {sinStock ? (
          <span className="absolute top-2.5 right-2.5 px-2 py-0.5 text-[10px] font-semibold bg-black/75 text-white" style={{ borderRadius: "calc(var(--st-radius) * 0.45)" }}>
            Sin stock
          </span>
        ) : stockVisible <= 3 ? (
          <span className="absolute top-2.5 right-2.5 px-2 py-0.5 text-[10px] font-semibold bg-black/75 text-white" style={{ borderRadius: "calc(var(--st-radius) * 0.45)" }}>
            {stockVisible === 1 ? "Última" : `Últimas ${stockVisible}`}
          </span>
        ) : null}
      </div>

      <div className="storefront-product-card__content flex flex-col flex-1 px-0.5 pt-3.5 pb-1">
        {p.brand && (
          <p className="text-[10px] uppercase tracking-[0.14em] mb-1 font-semibold" style={{ color: "hsl(var(--st-muted))" }}>{p.brand}</p>
        )}
        <Link to={productUrl} className="storefront-product-card__name text-[0.95rem] font-semibold leading-snug line-clamp-2 hover:opacity-80 transition-opacity">
          {p.name}
        </Link>

        {opiniones && (
          <div className="mt-1.5 flex items-center gap-1">
            <Stars value={opiniones.avg} size={12} />
            <span className="text-[11px]" style={{ color: "hsl(var(--st-muted))" }}>
              ({opiniones.count})
            </span>
          </div>
        )}

        <div className="mt-2.5 flex items-baseline gap-2" aria-live="polite">
          <span className="storefront-product-card__price text-[1.08rem] font-bold tracking-tight">
            {resumenVariantes.desde && <span className="mr-1 text-[11px] font-medium opacity-70">Desde</span>}
            {fmt(price)}
          </span>
          {off > 0 && (
            <span className="text-xs line-through" style={{ color: "hsl(var(--st-muted))" }}>{fmt(list)}</span>
          )}
        </div>

        {!sinStock ? (
          <div className="mt-3.5 space-y-2">
            {tieneVariantes ? (
              <>
                <p className="text-[11px]" style={{ color: "hsl(var(--st-muted))" }}>
                  {resumenVariantes.disponibles.length} disponible{resumenVariantes.disponibles.length === 1 ? "" : "s"}
                  {resumenVariantes.agotadas > 0 ? ` · ${resumenVariantes.agotadas} agotada${resumenVariantes.agotadas === 1 ? "" : "s"}` : ""}
                </p>
                <Link
                  to={productUrl}
                  className="storefront-product-card__add grid min-h-11 w-full place-items-center py-2.5 text-center text-sm font-semibold transition-opacity hover:opacity-90"
                  style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
                >
                  {textoCtaVariante(tipoVariante).replace(/^Elegí/, "Elegir")}
                </Link>
              </>
            ) : (
              <button
                type="button"
                onClick={() => addToCart(p)}
                className="storefront-product-card__add w-full min-h-11 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90"
                style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
              >
                Agregar al carrito
              </button>
            )}
          </div>
        ) : (
          <Link
            to={productUrl}
            className="mt-3.5 w-full min-h-11 grid place-items-center py-2.5 text-sm font-semibold text-center border transition-colors"
            style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
          >
            {tieneVariantes ? "Ver opciones y avisos" : "Avisame cuando vuelva"}
          </Link>
        )}
      </div>
    </article>
  );
}
