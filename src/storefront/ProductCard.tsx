import { Link } from "react-router-dom";
import { useStore, type StoreProduct } from "./storeContext";
import { Stars } from "./ProductReviews";
import { useWishlist } from "./wishlist";
import { ShoppingBag, Heart } from "lucide-react";

export default function ProductCard({ p }: { p: StoreProduct }) {
  const { store, priceOf, fmt, addToCart, reviewsByProduct } = useStore();
  const base = `/tienda/${store?.slug ?? ""}`;
  const opiniones = reviewsByProduct[p.id];
  const { has, toggle } = useWishlist();
  const deseado = has(p.id);
  const price = priceOf(p);
  const list = Number(p.sale_price_ars);
  const off = price < list ? Math.round((1 - price / list) * 100) : 0;

  return (
    <div
      className="storefront-product-card group flex flex-col overflow-hidden border transition-shadow hover:shadow-lg"
      style={{ borderColor: "hsl(var(--st-border))", background: "hsl(var(--st-surface))", borderRadius: "var(--st-radius)" }}
    >
      <Link to={`${base}/producto/${p.id}`} className="storefront-product-card__media relative block aspect-square overflow-hidden bg-black/5">
        {p.image_url
          ? (
            <img
              src={p.image_url}
              alt={p.name}
              loading="lazy"
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          )
          : <div className="w-full h-full grid place-items-center opacity-20"><ShoppingBag className="w-8 h-8" /></div>}

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

        {p.stock <= 0 ? (
          <span
            className="absolute top-2 right-2 px-2 py-0.5 text-[11px] font-medium bg-black/70 text-white"
            style={{ borderRadius: "var(--st-radius)" }}
          >
            Sin stock
          </span>
        ) : p.stock <= 3 ? (
          <span
            className="absolute top-2 right-2 px-2 py-0.5 text-[11px] font-medium bg-black/70 text-white"
            style={{ borderRadius: "var(--st-radius)" }}
          >
            {p.stock === 1 ? "¡Última!" : `¡Últimas ${p.stock}!`}
          </span>
        ) : null}
      </Link>

      <div className="storefront-product-card__content p-3 flex flex-col flex-1">
        {p.brand && (
          <p className="text-[11px] uppercase tracking-wide" style={{ color: "hsl(var(--st-muted))" }}>{p.brand}</p>
        )}
        <Link to={`${base}/producto/${p.id}`} className="text-sm font-medium leading-snug line-clamp-2 hover:underline">
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

        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-base font-bold">{fmt(price)}</span>
          {off > 0 && (
            <span className="text-xs line-through" style={{ color: "hsl(var(--st-muted))" }}>{fmt(list)}</span>
          )}
        </div>

        {p.stock > 0 ? (
          <button
            onClick={() => addToCart(p)}
            className="storefront-product-card__add mt-3 w-full min-h-11 py-2 text-sm font-medium transition-opacity hover:opacity-90"
            style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
          >
            Agregar
          </button>
        ) : (
          <Link
            to={`${base}/producto/${p.id}`}
            className="mt-3 w-full min-h-11 grid place-items-center py-2 text-sm font-medium text-center border"
            style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
          >
            Avisame cuando vuelva
          </Link>
        )}
      </div>
    </div>
  );
}
