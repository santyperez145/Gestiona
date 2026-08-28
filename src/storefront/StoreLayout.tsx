/**
 * Shell de la tienda: header, drawer de carrito y footer.
 *
 * Todo el color sale de las variables CSS del tema (`--st-*`), inyectadas acá.
 * Las páginas nunca hardcodean un color, así que cambiar de tema en el panel
 * cambia la tienda entera sin tocar componentes.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useStore } from "./storeContext";
import {
  menuDeCategorias, arbolDeCategorias, nombreDeCategoria,
} from "@/lib/storeCategories";
import { menuEfectivo, menuConSubmenus } from "@/lib/storeMenu";
import { sugerenciasParaElCarrito, TEXTO_MOTIVO } from "@/lib/crossSell";
import SearchBox from "./SearchBox";
import { resolveTheme, resolveFont, googleFontHref } from "./theme";
import { ShoppingBag, X, Plus, Minus, Trash2, Instagram, Menu, User, ChevronDown } from "lucide-react";
import { useStoreAuth } from "./storeAuth";

/**
 * Un link del menú. Los externos salen del router: con `<Link>` un
 * "https://instagram.com/x" se interpreta como ruta interna y da 404.
 */
function LinkDeMenu({
  item, className, style,
}: {
  item: { label: string; to: string; externo?: boolean };
  className?: string;
  style?: React.CSSProperties;
}) {
  if (item.externo) {
    return (
      <a href={item.to} target="_blank" rel="noopener noreferrer" className={className} style={style}>
        {item.label}
      </a>
    );
  }
  return <Link to={item.to} className={className} style={style}>{item.label}</Link>;
}

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  const { store, products, categorias, variantsByProduct, pages, cart, cartCount, subtotal, promo2x, shippingCost, total, freeShippingGap, fmt, priceOf, addToCart, setQty, removeFromCart, lineKeyOf } = useStore();
  const [cartOpen, setCartOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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
  //
  // Desde la sesión 94 el nombre y el orden salen de `ecommerce_categories`
  // cuando el comercio las cargó; si no, de los slugs de los productos, que es
  // como venía funcionando.
  // Y desde la sesión 95 el comercio puede armar el suyo: si cargó links, se
  // usan ésos; si no —o si todos quedaron rotos— se arma el de siempre.
  const nav = useMemo(() => {
    const cats = menuDeCategorias(
      categorias,
      products.map(p => p.category).filter(Boolean) as string[],
    );
    const items = menuEfectivo(store?.nav_links, { base, categorias: cats });

    // Las hijas de cada categoría, para el despliegue. Sólo las que tienen
    // algo: una subcategoría vacía en el desplegable es un callejón sin salida
    // igual que una categoría vacía en el menú.
    const hijas = new Map<string, { slug: string; label: string }[]>();
    for (const nodo of arbolDeCategorias(categorias)) {
      const conProductos = nodo.hijos.filter(h => h.productosEnRama > 0);
      if (conProductos.length > 0) {
        hijas.set(nodo.slug, conProductos.map(h => ({
          slug: h.slug, label: nombreDeCategoria(h.slug, categorias),
        })));
      }
    }
    return menuConSubmenus(items, hijas, base);
  }, [products, categorias, base, store?.nav_links]);

  // "Completá tu compra". Se recalcula con el carrito: al agregar una, la
  // siguiente ya sabe que esa está adentro y que el faltante para el envío
  // gratis bajó.
  const sugerencias = useMemo(
    () => sugerenciasParaElCarrito({
      cart: cart.map(l => ({ productId: l.productId, price: l.price, qty: l.qty })),
      productos: products,
      precioDe: priceOf,
      faltaEnvioGratis: freeShippingGap,
      limite: 3,
    }),
    [cart, products, priceOf, freeShippingGap],
  );

  const nombreCat = useCallback(
    (slug: string) => nombreDeCategoria(slug, categorias),
    [categorias],
  );

  return (
    <div
      className={`storefront-shell min-h-screen ${font ? "" : theme.rootClass}`}
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
      {/* ── Barra legal ──────────────────────────────────────────────────
          La Res. 424/2020 no pide que el botón de arrepentimiento sea
          "accesible": pide que esté **en la primera pantalla**. Por eso va
          acá arriba y no en el pie, que es donde la intuición lo pondría y
          donde lo tiene la mayoría de las tiendas —incumpliendo—. Ocupa una
          línea de 24px y es lo que Defensa del Consumidor mira primero. */}
      <div
        className="storefront-legal-bar text-[11px] border-b"
        style={{ borderColor: "hsl(var(--st-border))", background: "hsl(var(--st-surface))" }}
      >
        <div className="max-w-6xl mx-auto px-4 py-1 flex justify-end">
          <Link
            to={`${base}/arrepentimiento`}
            className="hover:underline"
            style={{ color: "hsl(var(--st-muted))" }}
          >
            Botón de arrepentimiento
          </Link>
        </div>
      </div>

      {/* ── Header ───────────────────────────────────────────────────── */}
      <header
        className="storefront-header sticky top-0 z-40 border-b backdrop-blur"
        style={{ borderColor: "hsl(var(--st-border))", background: "hsl(var(--st-header) / 0.95)" }}
      >
        <div className="storefront-header__inner max-w-6xl mx-auto px-4 h-16 flex items-center gap-3">
          <button
            className="lg:hidden p-2 -ml-2 min-h-11 min-w-11 grid place-items-center"
            onClick={() => setMenuOpen(v => !v)}
            aria-label="Menú"
            style={{ color: "hsl(var(--st-accent-fg))" }}
          >
            <Menu className="w-5 h-5" />
          </button>

          <Link to={base} className="storefront-brand flex items-center gap-2 min-w-0 shrink-0">
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
          <nav className="storefront-nav hidden lg:flex items-center gap-4 ml-4 text-sm">
            {nav.map(n => n.hijos.length === 0 ? (
              <LinkDeMenu
                key={n.label}
                item={n}
                className="opacity-80 hover:opacity-100 transition-opacity whitespace-nowrap"
                style={{ color: "hsl(var(--st-accent-fg))" }}
              />
            ) : (
              // El padre sigue siendo un link: entrar a "Perfumes" muestra todo
              // lo de la rama. El desplegable es un atajo, no la única forma de
              // llegar — con `onClick` que sólo abre, el que toca el nombre no
              // llega a ningún lado.
              <div key={n.label} className="relative group">
                <LinkDeMenu
                  item={n}
                  className="inline-flex items-center gap-1 opacity-80 hover:opacity-100 transition-opacity whitespace-nowrap"
                  style={{ color: "hsl(var(--st-accent-fg))" }}
                />
                <ChevronDown
                  className="w-3 h-3 inline-block ml-0.5 opacity-60 pointer-events-none"
                  style={{ color: "hsl(var(--st-accent-fg))" }}
                />
                {/* `focus-within` además de `hover` para que se pueda recorrer
                    con el teclado. El `pt-2` es el puente: sin él, el mouse
                    cruza un hueco y el menú se cierra a mitad de camino. */}
                <div className="absolute left-0 top-full pt-2 hidden group-hover:block group-focus-within:block z-50">
                  <div
                    className="min-w-[11rem] py-1 border shadow-lg"
                    style={{
                      background: "hsl(var(--st-bg))",
                      borderColor: "hsl(var(--st-border))",
                      borderRadius: "var(--st-radius)",
                    }}
                  >
                    {n.hijos.map(h => (
                      <Link
                        key={h.to}
                        to={h.to}
                        className="block px-3 py-1.5 text-sm hover:opacity-70 transition-opacity whitespace-nowrap"
                      >
                        {h.label}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </nav>

          {/* Desde `sm`: con `md` quedaba una franja entre 640 y 767px sin ningún
              buscador —el de arriba todavía oculto y el del menú ya escondido— y ahí
              caen las tablets y los teléfonos grandes acostados. */}
          <SearchBox
            base={base}
            productos={products}
            nombreCategoria={nombreCat}
            className="ml-auto hidden sm:block flex-1 min-w-0 max-w-[9rem] lg:max-w-[13rem]"
          />

          <Link
            to={`${base}/cuenta`}
            // `ml-auto` sólo cuando no hay buscador: con los dos, ambos empujan y la
            // fila se pasa de ancho. El breakpoint acompaña al del buscador.
            className="p-2 ml-auto sm:ml-2 min-h-11 min-w-11 grid place-items-center"
            aria-label={customer ? "Mi cuenta" : "Iniciar sesión"}
            title={customer ? "Mi cuenta" : "Iniciar sesión"}
            style={{ color: "hsl(var(--st-accent-fg))" }}
          >
            <User className="w-5 h-5" />
          </Link>

          <button
            onClick={() => setCartOpen(true)}
            className="relative p-2 min-h-11 min-w-11 grid place-items-center"
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
          <nav className="storefront-mobile-nav lg:hidden border-t px-4 py-2 space-y-1" style={{ borderColor: "hsl(var(--st-border))" }}>
            {nav.map(n => (
              <div key={n.label}>
                <LinkDeMenu
                  item={n}
                  className="block py-2 text-sm"
                  style={{ color: "hsl(var(--st-accent-fg))" }}
                />
                {/* En el celular no hay hover: las hijas van indentadas y
                    siempre visibles. Un desplegable que necesita otro toque
                    esconde justo lo que el comprador vino a buscar. */}
                {n.hijos.map(h => (
                  <Link
                    key={h.to} to={h.to}
                    className="block py-1.5 pl-4 text-sm opacity-70"
                    style={{ color: "hsl(var(--st-accent-fg))" }}
                  >
                    {h.label}
                  </Link>
                ))}
              </div>
            ))}
            <div className="pt-1 pb-2">
              <SearchBox
                base={base}
                productos={products}
                nombreCategoria={nombreCat}
                variante="panel"
                onNavegar={() => setMenuOpen(false)}
              />
            </div>
          </nav>
        )}
      </header>

      <main className="storefront-main">{children}</main>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer className="storefront-footer border-t mt-16" style={{ borderColor: "hsl(var(--st-border))", background: "hsl(var(--st-surface))" }}>
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
                <li key={n.label}><LinkDeMenu item={n} className="hover:underline" /></li>
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
        {/* Defensa del Consumidor exige que el comprador sepa dónde reclamar
            si el comercio no le responde. Va acá abajo, junto al copyright,
            porque es información de cierre y no una acción — a diferencia del
            botón de arrepentimiento, que sí tiene que estar arriba. */}
        <div className="border-t py-4 text-center text-xs space-y-2" style={{ borderColor: "hsl(var(--st-border))", color: "hsl(var(--st-muted))" }}>
          <p className="flex flex-wrap justify-center gap-x-3 gap-y-1">
            <Link to={`${base}/arrepentimiento`} className="hover:underline">
              Botón de arrepentimiento
            </Link>
            <span aria-hidden>·</span>
            <a
              href="https://autogestion.produccion.gob.ar/consumidores"
              target="_blank" rel="noopener noreferrer" className="hover:underline"
            >
              Defensa del Consumidor
            </a>
          </p>
          <p>© {new Date().getFullYear()} {store?.name}</p>
        </div>
      </footer>

      {/* ── Drawer del carrito ───────────────────────────────────────── */}
      {cartOpen && (
        <div className="storefront-cart-overlay fixed inset-0 z-50 flex justify-end">
          <button
            className="absolute inset-0 bg-black/50"
            onClick={() => setCartOpen(false)}
            aria-label="Cerrar carrito"
          />
          <aside
            className="storefront-cart relative w-full max-w-sm h-full flex flex-col shadow-2xl"
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
                            <button className="px-2 py-1 min-h-11 min-w-11 grid place-items-center" onClick={() => setQty(lineKeyOf(l), l.qty - 1)} aria-label="Restar">
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="px-2 text-sm tabular-nums">{l.qty}</span>
                            <button
                              className="px-2 py-1 min-h-11 min-w-11 grid place-items-center disabled:opacity-30"
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

                {sugerencias.length > 0 && (
                  <div className="border-t p-4" style={{ borderColor: "hsl(var(--st-border))" }}>
                    <p className="text-xs font-medium mb-2">Completá tu compra</p>
                    <div className="space-y-2">
                      {sugerencias.map(sg => (
                        <div key={sg.producto.id} className="flex items-center gap-2">
                          <Link
                            to={`${base}/producto/${sg.producto.id}`}
                            className="w-10 h-10 shrink-0 overflow-hidden bg-black/5"
                            style={{ borderRadius: "var(--st-radius)" }}
                          >
                            {sg.producto.image_url && (
                              <img src={sg.producto.image_url} alt="" className="w-full h-full object-cover" />
                            )}
                          </Link>
                          <div className="min-w-0 flex-1">
                            <Link
                              to={`${base}/producto/${sg.producto.id}`}
                              className="block text-xs font-medium leading-tight line-clamp-1 hover:underline"
                            >
                              {sg.producto.name}
                            </Link>
                            <p
                              className="text-[11px]"
                              style={{
                                color: sg.motivo === "envio_gratis"
                                  ? "hsl(var(--st-accent))"
                                  : "hsl(var(--st-muted))",
                              }}
                            >
                              {fmt(sg.precio)} · {TEXTO_MOTIVO[sg.motivo]}
                            </p>
                          </div>
                          {/* Agrega una unidad sin variante. Un producto con
                              variantes necesita que el comprador elija sabor o
                              tamaño, así que ése abre la ficha. */}
                          {(variantsByProduct[sg.producto.id]?.length ?? 0) > 0 ? (
                            <Link
                              to={`${base}/producto/${sg.producto.id}`}
                              className="px-2 py-1 text-[11px] font-medium border shrink-0"
                              style={{ borderColor: "hsl(var(--st-border))", borderRadius: "var(--st-radius)" }}
                            >
                              Elegir
                            </Link>
                          ) : (
                            <button
                              onClick={() => addToCart(sg.producto, 1, null)}
                              className="px-2 py-1 min-h-11 text-[11px] font-medium shrink-0"
                              style={{
                                background: "hsl(var(--st-accent))",
                                color: "hsl(var(--st-accent-fg))",
                                borderRadius: "var(--st-radius)",
                              }}
                            >
                              Agregar
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

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
