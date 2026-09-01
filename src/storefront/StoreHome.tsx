import { Link } from "react-router-dom";
import { useStore } from "./storeContext";
import ProductCard from "./ProductCard";
import StoreBanners from "./StoreBanners";
import { menuDeCategorias } from "@/lib/storeCategories";
import { ArrowRight, Truck, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import { mejorDescuento, nombreMedio } from "@/lib/paymentDiscount";
import { atributosDeImagenVitrina, mostrarImagenValida, ocultarImagenRota } from "./mediaFallback";

export default function StoreHome() {
  const { store, products, banners, categorias: cats2, priceOf, fmt } = useStore();

  // El mejor descuento que la tienda ofrece hoy, o null. Sólo cuenta los
  // medios que además están habilitados: anunciar uno que no se acepta sería
  // prometer algo que en el checkout no aparece.
  const descuentoPago = mejorDescuento(store?.payment_methods ?? null, store?.payment_discounts ?? null);
  const base = `/tienda/${store?.slug ?? ""}`;

  // Las vitrinas de la home son curadas: ofrecer un agotado en "Destacados"
  // es prometer algo que no se puede cumplir. En el listado completo sí
  // aparecen, con el aviso de reposición.
  const disponibles = products.filter(p => Number(p.stock) > 0);

  const destacados = disponibles.filter(p => p.featured).slice(0, 8);
  const ofertas = disponibles
    .filter(p => priceOf(p) < Number(p.sale_price_ars))
    .sort((a, b) => (1 - priceOf(b) / Number(b.sale_price_ars)) - (1 - priceOf(a) / Number(a.sale_price_ars)))
    .slice(0, 8);
  const nuevos = [...disponibles]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 8);

  const categorias = menuDeCategorias(
    cats2, products.map(p => p.category).filter(Boolean) as string[],
  );

  return (
    <div className="storefront-home">
      {/* ── Banners ──────────────────────────────────────────────────── */}
      {/* Si hay banners cargados reemplazan al hero: dos bloques grandes
          seguidos empujan los productos abajo del pliegue. */}
      <StoreBanners banners={banners} base={base} storeName={store?.name} />

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      {banners.length === 0 && (
      <section
        className="storefront-hero relative overflow-hidden"
        style={{ background: "hsl(var(--st-surface))", borderBottom: "1px solid hsl(var(--st-border))" }}
      >
        {store?.banner_url && (
          <img
            src={store.banner_url}
            alt=""
            {...atributosDeImagenVitrina("banner", { lcp: true })}
            onLoad={mostrarImagenValida}
            onError={ocultarImagenRota}
            className="storefront-hero__image absolute inset-0 w-full h-full object-cover"
          />
        )}
        <div className="storefront-hero__content relative max-w-6xl mx-auto px-4 py-16 sm:py-24">
          <div className="storefront-hero__copy">
            <span className="storefront-eyebrow">Catálogo oficial</span>
            <h1 className="storefront-hero__title text-3xl sm:text-5xl font-bold tracking-tight">{store?.name}</h1>
            {store?.description && (
              <p className="mt-3 text-base sm:text-lg max-w-2xl" style={{ color: "hsl(var(--st-muted))" }}>
                {store.description}
              </p>
            )}
            <Link
              to={`${base}/productos`}
              className="storefront-hero__cta inline-flex items-center gap-2 mt-7 px-6 py-3 font-medium transition-opacity hover:opacity-90"
              style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
            >
              Explorar catálogo <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <div className="storefront-hero__aside">
            <div className="storefront-hero__aside-head"><span>Compra con confianza</span><ShieldCheck /></div>
            <div className="storefront-hero__aside-stat"><strong>{disponibles.length}</strong><span>productos disponibles</span></div>
            <div className="storefront-hero__aside-row"><span><Truck /> Envíos coordinados</span><ArrowRight /></div>
            <div className="storefront-hero__aside-row"><span><Wallet /> Medios de pago seguros</span><ArrowRight /></div>
          </div>
        </div>
      </section>
      )}

      {/* ── Barra de confianza ───────────────────────────────────────── */}
      <section className="storefront-trust-bar border-b" style={{ borderColor: "hsl(var(--st-border))" }}>
        <div className={`storefront-trust-bar__inner max-w-6xl mx-auto px-4 py-5 grid grid-cols-1 gap-4 text-sm ${descuentoPago ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
          {[
            // El descuento por medio de pago va primero cuando existe: es la
            // razón más concreta para comprar acá y no en otro lado. Sale de
            // `mejorDescuento`, que sólo mira los medios que la tienda acepta.
            ...(descuentoPago ? [{
              icon: Wallet,
              t: `${descuentoPago.porcentaje}% OFF con ${nombreMedio(descuentoPago.metodo)}`,
              s: "Se aplica solo al elegir el medio de pago",
            }] : []),
            { icon: Truck, t: (store?.free_shipping_above ?? 0) > 0 ? `Envío gratis desde ${fmt(Number(store?.free_shipping_above))}` : "Envíos a todo el país", s: "Coordinamos la entrega con vos" },
            { icon: ShieldCheck, t: "Productos originales", s: "Importación propia, con garantía" },
            { icon: Sparkles, t: "Asesoramiento", s: "Te ayudamos a elegir tu fragancia" },
          ].map(({ icon: Icon, t, s }) => (
            <div key={t} className="storefront-trust-item flex items-start gap-3">
              <Icon className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "hsl(var(--st-accent))" }} />
              <div>
                <p className="font-medium">{t}</p>
                <p className="text-xs" style={{ color: "hsl(var(--st-muted))" }}>{s}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Categorías ───────────────────────────────────────────────── */}
      {categorias.length > 1 && (
        <section className="storefront-section storefront-categories max-w-6xl mx-auto px-4 py-10">
          <h2 className="storefront-section__title text-lg font-semibold mb-4">Categorías</h2>
          <div className="storefront-category-grid grid grid-cols-2 sm:grid-cols-4 gap-3">
            {categorias.map(c => {
              // La foto propia de la categoría manda; si no cargó ninguna, se
              // usa la del primer producto, que es como se veía antes.
              const propia = cats2.find(x => x.slug === c.slug)?.image_url;
              const cover = propia
                ? { image_url: propia }
                : products.find(p => p.category === c.slug && p.image_url);
              return (
                <Link
                  key={c.slug}
                  to={`${base}/productos?cat=${encodeURIComponent(c.slug)}`}
                  className="storefront-category-card group relative aspect-[4/3] overflow-hidden border"
                  style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
                >
                  {cover?.image_url && (
                    <img
                      src={cover.image_url}
                      alt=""
                      {...atributosDeImagenVitrina("categoria")}
                      onLoad={mostrarImagenValida}
                      onError={ocultarImagenRota}
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                  <span className="absolute bottom-2 left-3 right-3 text-white font-medium text-sm">
                    {c.label}
                    <span className="block text-[11px] opacity-75">
                      {/* ⚠️ Con una sola decía «Perfume Diseñador · 1 productos».
                          Se vio leyendo el nombre accesible del enlace, no
                          mirando el código. */}
                      {(() => {
                        const n = products.filter(p => p.category === c.slug).length;
                        return `${n} producto${n === 1 ? "" : "s"}`;
                      })()}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <Row title="Ofertas" items={ofertas} href={`${base}/productos?oferta=1`} />
      <Row title="Destacados" items={destacados} href={`${base}/productos`} />
      <Row title="Novedades" items={nuevos} href={`${base}/productos?orden=nuevo`} />

      {products.length === 0 && (
        <div className="max-w-6xl mx-auto px-4 py-20 text-center">
          <p style={{ color: "hsl(var(--st-muted))" }}>
            Todavía no hay productos publicados en esta tienda.
          </p>
        </div>
      )}
    </div>
  );
}

function Row({ title, items, href }: { title: string; items: ReturnType<typeof useStore>["products"]; href: string }) {
  if (!items.length) return null;
  return (
    <section className="storefront-section storefront-product-row max-w-6xl mx-auto px-4 py-8">
      <div className="storefront-section__heading flex items-center justify-between mb-4">
        <h2 className="storefront-section__title text-lg font-semibold">{title}</h2>
        <Link to={href} className="storefront-section__link text-sm hover:underline inline-flex items-center gap-1" style={{ color: "hsl(var(--st-accent))" }}>
          Ver todo <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        {items.map(p => <ProductCard key={p.id} p={p} />)}
      </div>
    </section>
  );
}
