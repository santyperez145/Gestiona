/**
 * Shell de la tienda: header, drawer de carrito y footer.
 *
 * Todo el color sale de las variables CSS del tema (`--st-*`), inyectadas acá.
 * Las páginas nunca hardcodean un color, así que cambiar de tema en el panel
 * cambia la tienda entera sin tocar componentes.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useStore } from "./storeContext";
import { getCategoryLabel } from "@/lib/supabaseStore";
import { resolveTheme, resolveFont, googleFontHref } from "./theme";
import { ShoppingBag, Search, X, Plus, Minus, Trash2, Instagram, Menu, User } from "lucide-react";
import { useStoreAuth } from "./storeAuth";

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  const { store, products, pages, cart, cartCount, subtotal, promo2x, shippingCost, total, freeShippingGap, fmt, setQty, removeFromCart, lineKeyOf } = useStore();
  const [cartOpen, setCartOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { customer } = useStoreAuth();

  const theme = useMemo(
    () => resolveTheme(store?.theme, store?.primary_color),
    [store?.theme, store?.primary_color],
  );

  // Tipografía elegida por el comercio, o la del tema.
  const font = useMemo(() => resolveFont(store?.font), [store?.font]);

  /**
   * Se carga SÓLO la fuente elegida, y desde la tienda.
   *
   * El `@import` de `index.css` trae las tres del panel para toda la app; meter
   * seis más ahí haría que cada comprador descargue cinco que no va a ver. Con
   * el `<link>` acá, una tienda con la fuente del sistema no pide nada y una
   * con Playfair pide sólo Playfair.
   *
   * El `<link>` se saca al desmontar para no dejar hojas de estilo acumuladas
   * al cambiar de tienda.
   */
  useEffect(() => {
    const href = googleFontHref(font);
    if (!href) return;
    if (document.querySelector(`link[data-store-font="${href}"]`)) return;

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.storeFont = href;
    document.head.appendChild(link);
    return () => { link.remove(); };
  }, [font]);

  // Al navegar se cierran los paneles: dejarlos abiertos sobre otra página
  // desorienta, sobre todo en el celular.
  useEffect(() => { setCartOpen(false); setMenuOpen(false); }, [pathname]);

  const base = `/tienda/${store?.slug ?? ""}`;
  const social = store?.social_links ?? {};

  // El menú sale de las categorías que la tienda realmente tiene. Hardcodear
  // "Perfumes árabes" servía para este negocio pero rompía el resto: esto es
  // multi-negocio y cada tienda vende otra cosa.
  const nav = useMemo(() => {
    const cats = [...new Set(products.map(p => p.category).filter(Boolean))] as string[];
    return [
      { to: base, label: "Inicio" },
      { to: `${base}/productos`, label: "Productos" },
      ...cats.slice(0, 2).map(c => ({
        to: `${base}/productos?cat=${encodeURIComponent(c)}`,
        label: getCategoryLabel(c),
      })),
      { to: `${base}/productos?oferta=1`, label: "Ofertas" },
    ];
  }, [products, base]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(`${base}/productos${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
  };

  return (
    <div
      className={`min-h-screen ${font ? "" : theme.rootClass}`}
      style={{
        ...(theme.vars as React.CSSProperties),
        ["--st-radius" as string]: theme.radius,
        background: "hsl(var(--st-bg))",
        color: "hsl(var(--st-text))",
        // La elegida pisa la del tema. Sin fuente elegida se deja `rootClass`,
        // que es como se veían todas hasta ahora.
        ...(font ? { fontFamily: font.stack } : {}),
      }}
    >
      {/* ── Header ───────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-40 border-b backdrop-blur"
        style={{ borderColor: "hsl(var(--st-border))", background: "hsl(var(--st-header) / 0.95)" }}
      >
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center gap-3">
          <button
            className="lg:hidden p-2 -ml-2"
            onClick={() => setMenuOpen(v => !v)}
            aria-label="Menú"
            style={{ color: "hsl(var(--st-accent-fg))" }}
          >
            <Menu className="w-5 h-5" />
          </button>

          <Link to={base} className="flex items-center gap-2 min-w-0 shrink-0">
            {store?.logo_url
              ? <img src={store.logo_url} alt="" className="h-8 w-8 rounded object-cover" />
              : (
                <span
                  className="h-8 w-8 rounded grid place-items-center text-sm font-bold"
                  style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))" }}
                >
                  {(store?.name ?? "T").charAt(0).toUpperCase()}
                </span>
              )}
            <span
              className="font-semibold truncate max-w-[9rem] sm:max-w-none"
              style={{ color: "hsl(var(--st-accent-fg))" }}
            >
              {store?.name}
            </span>
          </Link>

          {/* Cinco links con `whitespace-nowrap` no entran abajo de 768 junto
              al logo, el buscador y los dos íconos, y con una categoría más se
              rompería igual en cualquier ancho fijo. Abajo de 1024 viven en el
              menú desplegable, que aguanta las que sean. */}
          <nav className="hidden lg:flex items-center gap-4 ml-4 text-sm">
            {nav.map(n => (
              <Link
                key={n.label}
                to={n.to}
                className="opacity-80 hover:opacity-100 transition-opacity whitespace-nowrap"
                style={{ color: "hsl(var(--st-accent-fg))" }}
              >
                {n.label}
              </Link>
            ))}
          </nav>

          {/* Desde `sm`: con `md` quedaba una franja entre 640 y 767px sin ningún
              buscador —el de arriba todavía oculto y el del menú ya escondido— y ahí
              caen las tablets y los teléfonos grandes acostados. */}
          <form onSubmit={onSearch} className="ml-auto hidden sm:flex items-center relative flex-1 min-w-0 max-w-[9rem] lg:max-w-[13rem]">
            <Search className="w-4 h-4 absolute left-2.5 opacity-50" style={{ color: "hsl(var(--st-accent-fg))" }} />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Buscar..."
              className="h-9 w-full rounded-full pl-8 pr-3 text-sm bg-white/15 placeholder:opacity-60 outline-none focus:bg-white/25 transition-colors"
              style={{ color: "hsl(var(--st-accent-fg))" }}
            />
          </form>

          <Link
            to={`${base}/cuenta`}
            // `ml-auto` sólo cuando no hay buscador: con los dos, ambos empujan y la
            // fila se pasa de ancho. El breakpoint acompaña al del buscador.
            className="p-2 ml-auto sm:ml-2"
            aria-label={customer ? "Mi cuenta" : "Iniciar sesión"}
            title={customer ? "Mi cuenta" : "Iniciar sesión"}
            style={{ color: "hsl(var(--st-accent-fg))" }}
          >
            <User className="w-5 h-5" />
          </Link>

          <button
            onClick={() => setCartOpen(true)}
            className="relative p-2"
            aria-label={`Carrito, ${cartCount} ${cartCount === 1 ? "artículo" : "artículos"}`}
            style={{ color: "hsl(var(--st-accent-fg))" }}
          >
            <ShoppingBag className="w-5 h-5" />
            {cartCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full text-[10px] font-bold grid place-items-center"
                style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", boxShadow: "0 0 0 2px hsl(var(--st-header))" }}
              >
                {cartCount}
              </span>
            )}
          </button>
        </div>

        {menuOpen && (
          <nav className="lg:hidden border-t px-4 py-2 space-y-1" style={{ borderColor: "hsl(var(--st-border))" }}>
            {nav.map(n => (
              <Link key={n.label} to={n.to} className="block py-2 text-sm" style={{ color: "hsl(var(--st-accent-fg))" }}>
                {n.label}
              </Link>
            ))}
            <form onSubmit={onSearch} className="pt-1 pb-2">
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Buscar productos..."
                className="w-full h-9 rounded-full px-3 text-sm bg-white/15 outline-none"
                style={{ color: "hsl(var(--st-accent-fg))" }}
              />
            </form>
          </nav>
        )}
      </header>

      <main>{children}</main>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="border-t mt-16" style={{ borderColor: "hsl(var(--st-border))", background: "hsl(var(--st-surface))" }}>
        <div className="max-w-6xl mx-auto px-4 py-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="font-semibold mb-2">{store?.name}</p>
            {store?.description && (
              <p className="text-sm" style={{ color: "hsl(var(--st-muted))" }}>{store.description}</p>
            )}
          </div>
          <div>
            <p className="text-sm font-semibold mb-2">Navegación</p>
            <ul className="space-y-1 text-sm" style={{ color: "hsl(var(--st-muted))" }}>
              {nav.map(n => (
                <li key={n.label}><Link to={n.to} className="hover:underline">{n.label}</Link></li>
              ))}
            </ul>
          </div>
          {/* Información: es lo que mira el comprador antes de decidir, y lo
              que MercadoPago pide ver publicado para aprobar la cuenta. */}
          {pages.some(pg => pg.show_in_footer) && (
            <div>
              <p className="text-sm font-semibold mb-2">Información</p>
              <ul className="space-y-1 text-sm" style={{ color: "hsl(var(--st-muted))" }}>
                {pages.filter(pg => pg.show_in_footer).map(pg => (
                  <li key={pg.id}>
                    <Link to={`${base}/pagina/${pg.slug}`} className="hover:underline">{pg.title}</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="text-sm font-semibold mb-2">Contacto</p>
            <div className="flex gap-3">
              {social.instagram && (
                <a href={social.instagram} target="_blank" rel="noopener noreferrer" aria-label="Instagram">
                  <Instagram className="w-5 h-5" style={{ color: "hsl(var(--st-muted))" }} />
                </a>
              )}
            </div>
            {(store?.free_shipping_above ?? 0) > 0 && (
              <p className="text-xs mt-3" style={{ color: "hsl(var(--st-muted))" }}>
                Envío gratis desde {fmt(Number(store?.free_shipping_above))}
              </p>
            )}
          </div>
        </div>
        <div className="border-t py-4 text-center text-xs" style={{ borderColor: "hsl(var(--st-border))", color: "hsl(var(--st-muted))" }}>
          © {new Date().getFullYear()} {store?.name}
        </div>
      </footer>

      {/* ── Drawer del carrito ───────────────────────────────────────── */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            className="absolute inset-0 bg-black/50"
            onClick={() => setCartOpen(false)}
            aria-label="Cerrar carrito"
          />
          <aside
            className="relative w-full max-w-sm h-full flex flex-col shadow-2xl"
            style={{ background: "hsl(var(--st-bg))" }}
          >
            <div className="flex items-center justify-between px-4 h-14 border-b" style={{ borderColor: "hsl(var(--st-border))" }}>
              <p className="font-semibold">Tu carrito ({cartCount})</p>
              <button onClick={() => setCartOpen(false)} aria-label="Cerrar"><X className="w-5 h-5" /></button>
            </div>

            {cart.length === 0 ? (
              <div className="flex-1 grid place-items-center px-6 text-center">
                <div>
                  <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm" style={{ color: "hsl(var(--st-muted))" }}>
                    Todavía no agregaste nada.
                  </p>
                  <Link
                    to={`${base}/productos`}
                    className="inline-block mt-4 px-4 py-2 text-sm font-medium"
                    style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
                  >
                    Ver productos
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {cart.map(l => (
                    <div key={lineKeyOf(l)} className="flex gap-3">
                      <div
                        className="w-16 h-16 shrink-0 overflow-hidden bg-black/5"
                        style={{ borderRadius: "var(--st-radius)" }}
                      >
                        {l.image && <img src={l.image} alt="" className="w-full h-full object-cover" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-tight line-clamp-2">{l.name}</p>
                        <p className="text-sm font-semibold mt-0.5">{fmt(l.price * l.qty)}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <div className="flex items-center border" style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}>
                            <button className="px-2 py-1" onClick={() => setQty(lineKeyOf(l), l.qty - 1)} aria-label="Restar">
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="px-2 text-sm tabular-nums">{l.qty}</span>
                            <button
                              className="px-2 py-1 disabled:opacity-30"
                              onClick={() => setQty(lineKeyOf(l), l.qty + 1)}
                              disabled={l.qty >= l.stock}
                              aria-label="Sumar"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                          <button onClick={() => removeFromCart(lineKeyOf(l))} aria-label="Quitar">
                            <Trash2 className="w-3.5 h-3.5" style={{ color: "hsl(var(--st-muted))" }} />
                          </button>
                        </div>
                        {l.qty >= l.stock && (
                          <p className="text-[11px] mt-1" style={{ color: "hsl(var(--st-muted))" }}>
                            Es todo el stock disponible
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="border-t p-4 space-y-2" style={{ borderColor: "hsl(var(--st-border))" }}>
                  {freeShippingGap !== null && freeShippingGap > 0 && (
                    <p className="text-xs text-center" style={{ color: "hsl(var(--st-muted))" }}>
                      Te faltan <strong>{fmt(freeShippingGap)}</strong> para el envío gratis
                    </p>
                  )}
                  <div className="flex justify-between text-sm">
                    <span style={{ color: "hsl(var(--st-muted))" }}>Subtotal</span>
                    <span>{fmt(subtotal)}</span>
                  </div>
                  {promo2x > 0 && (
                    <div className="flex justify-between text-sm" style={{ color: "hsl(var(--st-accent))" }}>
                      <span>Promo llevando 2</span>
                      <span>−{fmt(promo2x)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span style={{ color: "hsl(var(--st-muted))" }}>Envío</span>
                    <span>{shippingCost === 0 ? "Gratis" : fmt(shippingCost)}</span>
                  </div>
                  <div className="flex justify-between font-semibold pt-1 border-t" style={{ borderColor: "hsl(var(--st-border))" }}>
                    <span>Total</span>
                    <span>{fmt(total)}</span>
                  </div>
                  <Link
                    to={`${base}/checkout`}
                    className="block text-center py-2.5 font-medium mt-2"
                    style={{ background: "hsl(var(--st-accent))", color: "hsl(var(--st-accent-fg))", borderRadius: "var(--st-radius)" }}
                  >
                    Finalizar compra
                  </Link>
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
