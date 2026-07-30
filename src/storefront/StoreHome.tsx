import { Link } from "react-router-dom";
import { useStore } from "./storeContext";
import ProductCard from "./ProductCard";
import StoreBanners from "./StoreBanners";
import { getCategoryLabel } from "@/lib/supabaseStore";
import { ArrowRight, Truck, ShieldCheck, Sparkles } from "lucide-react";

export default function StoreHome() {
  const { store, products, banners, priceOf, fmt } = useStore();
  const base = `/tienda/${store?.slug ?? ""}`;

  const destacados = products.filter(p => p.featured).slice(0, 8);
  const ofertas = products
    .filter(p => priceOf(p) < Number(p.sale_price_ars))
    .sort((a, b) => (1 - priceOf(b) / Number(b.sale_price_ars)) - (1 - priceOf(a) / Number(a.sale_price_ars)))
    .slice(0, 8);
  const nuevos = [...products]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 8);

  const categorias = [...new Set(products.map(p => p.category).filter(Boolean))] as string[];

  return (
    <>
      {/* ── Banners ──────────────────────────────────────────────────── */}
      {/* Si hay banners cargados reemplazan al hero: dos bloques grandes
          seguidos empujan los productos abajo del pliegue. */}
      <StoreBanners banners={banners} base={base} />

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      {banners.length === 0 && (
      <section
        className="relative overflow-hidden"
        style={{ background: "hsl(var(--st-surface))", borderBottom: "1px solid hsl(var(--st-border))" }}
      >
        {store?.banner_url && (
          <img src={store.banner_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-25" />
        )}
        <div className="relative max-w-6xl mx-auto px-4 py-16 sm:py-24 text-center">
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight">{store?.name}</h1>
          {store?.description && (
            <p className="mt-3 text-base sm:text-lg max-w-2xl mx-auto" style={{ color: "hsl(var(--st-muted))" }}>
              {store.description}
            </p>
          )}
          <Link
            to={`${base}/productos`}
            className="inline-flex items-center gap-2 mt-7 px-6 py-3 font-medium transition-opacity hover:opacity-90"
            style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
          >
            Ver todos los productos <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>
      )}

      {/* ── Barra de confianza ───────────────────────────────────────── */}
      <section className="border-b" style={{ borderColor: "hsl(var(--st-border))" }}>
        <div className="max-w-6xl mx-auto px-4 py-5 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          {[
            { icon: Truck, t: (store?.free_shipping_above ?? 0) > 0 ? `Envío gratis desde ${fmt(Number(store?.free_shipping_above))}` : "Envíos a todo el país", s: "Coordinamos la entrega con vos" },
            { icon: ShieldCheck, t: "Productos originales", s: "Importación propia, con garantía" },
            { icon: Sparkles, t: "Asesoramiento", s: "Te ayudamos a elegir tu fragancia" },
          ].map(({ icon: Icon, t, s }) => (
            <div key={t} className="flex items-start gap-3">
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
        <section className="max-w-6xl mx-auto px-4 py-10">
          <h2 className="text-lg font-semibold mb-4">Categorías</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {categorias.map(c => {
              const cover = products.find(p => p.category === c && p.image_url);
              return (
                <Link
                  key={c}
                  to={`${base}/productos?cat=${encodeURIComponent(c)}`}
                  className="group relative aspect-[4/3] overflow-hidden border"
                  style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
                >
                  {cover?.image_url && (
                    <img
                      src={cover.image_url}
                      alt=""
                      loading="lazy"
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                  <span className="absolute bottom-2 left-3 right-3 text-white font-medium text-sm">
                    {getCategoryLabel(c)}
                    <span className="block text-[11px] opacity-75">
                      {products.filter(p => p.category === c).length} productos
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
    </>
  );
}

function Row({ title, items, href }: { title: string; items: ReturnType<typeof useStore>["products"]; href: string }) {
  if (!items.length) return null;
  return (
    <section className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <Link to={href} className="text-sm hover:underline inline-flex items-center gap-1" style={{ color: "hsl(var(--st-accent))" }}>
          Ver todo <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        {items.map(p => <ProductCard key={p.id} p={p} />)}
      </div>
    </section>
  );
}
