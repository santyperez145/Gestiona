/**
 * Estado compartido de la tienda: datos del comercio, catálogo y carrito.
 *
 * El carrito se guarda en localStorage por slug de tienda, así que sobrevive a
 * recargas y a cerrar la pestaña — que es cuando la mayoría de los carritos se
 * pierden y con ellos la venta.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { ahorroPorVolumen, type ReglaCantidad } from "@/lib/promo2x";
import type { CategoriaTienda } from "@/lib/storeCategories";
import {
  fetchStoreProducts,
  fetchStoreVariants,
  retryPublicRead,
  type StoreVariant,
} from "@/lib/publicDataSource";

export interface StoreInfo {
  org_id: string;
  owner_user_id: string | null;
  name: string;
  description: string | null;
  slug: string;
  theme: string | null;
  primary_color: string | null;
  logo_url: string | null;
  banner_url: string | null;
  currency: string | null;
  payment_methods: string[] | null;
  shipping_cost: number | null;
  free_shipping_above: number | null;
  /** `{"transferencia": 10}` — porcentaje de descuento por medio de pago. */
  payment_discounts: Record<string, number> | null;
  /** Id de la tipografía elegida. null = la que trae el tema. */
  font: string | null;
  /** 'flat' | 'zones' | 'free' — decide si el checkout cotiza por zona y peso */
  shipping_mode: string | null;
  pickup_enabled: boolean | null;
  pickup_address: string | null;
  meta_title: string | null;
  meta_description: string | null;
  social_links: Record<string, string> | null;
  /** Menú armado por el comercio. Vacío = se arma solo. Ver `storeMenu.ts`. */
  nav_links: unknown;
  meta_pixel_id: string | null;
  ga_measurement_id: string | null;
  tiktok_pixel_id: string | null;
}

export interface StoreBanner {
  id: string;
  image_url: string;
  image_url_mobile: string | null;
  title: string | null;
  subtitle: string | null;
  link_url: string | null;
  cta_label: string | null;
  alt_text: string | null;
  sort_order: number;
}

export interface StorePage {
  id: string;
  slug: string;
  title: string;
  content: string;
  show_in_footer: boolean;
  sort_order: number;
  meta_description: string | null;
  updated_at: string;
}

export interface StoreProduct {
  id: string;
  name: string;
  brand: string | null;
  category: string | null;
  gender: string | null;
  description: string | null;
  sale_price_ars: number;
  discount_price_ars: number | null;
  /** Precio total llevando 2. Llega desde `publicDataSource` y hasta la
   *  sesión 94 no lo miraba nadie en la tienda, aunque el catálogo por
   *  WhatsApp ya lo mostraba. */
  price_2x_ars: number | null;
  /** Precio sobre el que se aplica el descuento por medio de pago. Lo resuelve
   *  la vista cruzando la política de la tienda con el override del producto. */
  payment_base_price: number | null;
  /** Precio de la mejor promocion auto-aplicable, o null si ninguna aplica. */
  promo_price: number | null;
  stock: number;
  image_url: string | null;
  image_urls: string[] | null;
  content_ml: number | null;
  featured: boolean | null;
  total_sold: number | null;
  created_at: string;
}

export interface PerfumeDetail {
  product_id: string;
  familia_olfativa: string | null;
  duracion: string | null;
  proyeccion: string | null;
  notas_salida: string[] | null;
  notas_corazon: string[] | null;
  notas_fondo: string[] | null;
  estacion: string[] | null;
  ocasion: string[] | null;
  inspiracion: string | null;
  modelo: string | null;
  edad_recomendada: string | null;
}

export interface CartLine {
  productId: string;
  /** Variante elegida, si el producto tiene. El precio y el stock son suyos. */
  variantId?: string | null;
  name: string;
  brand: string | null;
  price: number;
  qty: number;
  image: string | null;
  stock: number;
}

interface Ctx {
  loading: boolean;
  notFound: boolean;
  store: StoreInfo | null;
  products: StoreProduct[];
  perfumes: Record<string, PerfumeDetail>;
  /** Variantes con stock, agrupadas por producto. */
  variantsByProduct: Record<string, StoreVariant[]>;
  /** Promedio y cantidad de reseñas publicadas, por producto. */
  reviewsByProduct: Record<string, { avg: number; count: number }>;
  /** Páginas de contenido publicadas (sobre nosotros, devoluciones, …). */
  pages: StorePage[];
  /** Banners vigentes de la home, ya filtrados por fecha en el servidor. */
  banners: StoreBanner[];
  cart: CartLine[];
  /** Ahorro de la promo "llevando 2". Espejo de `store_promo_2x_discount`. */
  promo2x: number;
  /** Categorías que cargó el comercio. Vacío = todavía usa los nombres viejos. */
  categorias: CategoriaTienda[];
  addToCart: (p: StoreProduct, qty?: number, variant?: StoreVariant | null) => void;
  setQty: (lineKey: string, qty: number) => void;
  removeFromCart: (lineKey: string) => void;
  /** Clave única de una línea: producto, o producto+variante. */
  lineKeyOf: (l: CartLine) => string;
  clearCart: () => void;
  cartCount: number;
  subtotal: number;
  shippingCost: number;
  total: number;
  /** Cuánto falta para el envío gratis, o null si no aplica. */
  freeShippingGap: number | null;
  priceOf: (p: StoreProduct) => number;
  fmt: (n: number) => string;
}

const StoreContext = createContext<Ctx | null>(null);

const cartKey = (slug: string) => `gestiona.store.cart.${slug}`;

export function StoreProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [perfumes, setPerfumes] = useState<Record<string, PerfumeDetail>>({});
  const [categorias, setCategorias] = useState<CategoriaTienda[]>([]);
  const [reglasCantidad, setReglasCantidad] = useState<ReglaCantidad[]>([]);
  const [variantsByProduct, setVariantsByProduct] = useState<Record<string, StoreVariant[]>>({});
  const [reviewsByProduct, setReviewsByProduct] = useState<Record<string, { avg: number; count: number }>>({});
  const [pages, setPages] = useState<StorePage[]>([]);
  const [banners, setBanners] = useState<StoreBanner[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);

  // ── Carga de la tienda ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);

    (async () => {
      const storeResponse = await retryPublicRead(() =>
        supabase.rpc("get_store_by_slug", { p_slug: slug }));
      if (storeResponse.error) {
        console.error("[tienda] error leyendo la tienda:", storeResponse.error.message);
        if (!cancelled) { setNotFound(true); setLoading(false); }
        return;
      }
      const { data } = storeResponse;
      const row = (Array.isArray(data) ? data[0] : data) as StoreInfo | undefined;
      if (cancelled) return;

      if (!row?.owner_user_id) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setStore(row);

      const [pRes, dRes, vRes, rRes, gRes, bRes, cRes, qRes] = await Promise.all([
        // Lee la vista pública saneada (sin costos ni márgenes) y tolera que la
        // migración todavía no esté aplicada — si no, la tienda se muestra
        // vacía aunque haya productos cargados.
        fetchStoreProducts(row.org_id),
        retryPublicRead(() => supabase.rpc("get_store_perfume_details", { p_slug: slug })),
        fetchStoreVariants(slug),
        retryPublicRead(() => supabase.rpc("get_store_reviews", { p_slug: slug })),
        retryPublicRead(() => supabase.rpc("get_store_pages", { p_slug: slug })),
        retryPublicRead(() => supabase.rpc("get_store_banners", { p_slug: slug })),
        retryPublicRead(() => supabase.rpc("get_store_categories", { p_slug: slug })),
        retryPublicRead(() => supabase.rpc("get_store_quantity_discounts", { p_slug: slug })),
      ]);
      if (cancelled) return;

      // Los agotados se muestran, pero últimos: la tienda tiene que verse
      // llena de lo que sí se puede comprar.
      const lista = (pRes ?? []) as unknown as StoreProduct[];
      setProducts([
        ...lista.filter(x => Number(x.stock) > 0),
        ...lista.filter(x => Number(x.stock) <= 0),
      ]);
      const map: Record<string, PerfumeDetail> = {};
      ((dRes.data ?? []) as PerfumeDetail[]).forEach(d => { map[d.product_id] = d; });
      setPerfumes(map);

      // Variantes agrupadas por producto. Si el RPC todavía no existe llega
      // vacío y la tienda sigue andando sin selector, como antes.
      const vmap: Record<string, StoreVariant[]> = {};
      (vRes ?? []).forEach(v => { (vmap[v.product_id] ??= []).push(v); });
      setVariantsByProduct(vmap);

      // Promedio por producto, para la estrella de la grilla. Se calcula acá
      // una vez en vez de por tarjeta.
      const acum: Record<string, { suma: number; n: number }> = {};
      ((rRes?.data ?? []) as { product_id: string; rating: number }[]).forEach(r => {
        const a = (acum[r.product_id] ??= { suma: 0, n: 0 });
        a.suma += Number(r.rating) || 0;
        a.n += 1;
      });
      const rmap: Record<string, { avg: number; count: number }> = {};
      Object.entries(acum).forEach(([id, a]) => { rmap[id] = { avg: a.suma / a.n, count: a.n }; });
      setReviewsByProduct(rmap);

      setPages((gRes?.data ?? []) as unknown as StorePage[]);
      setBanners((bRes?.data ?? []) as unknown as StoreBanner[]);
      // Si el comercio todavía no creó las suyas, esto queda vacío y el menú
      // sigue saliendo de los slugs de los productos, como antes. No se
      // reporta como error: no tener categorías propias es un estado válido.
      setCategorias((cRes?.data ?? []) as unknown as CategoriaTienda[]);
      // Sin reglas cargadas esto queda vacío y el ahorro sale sólo del 2x, que
      // es como venía funcionando. No tener reglas es un estado válido.
      setReglasCantidad((qRes?.data ?? []) as unknown as ReglaCantidad[]);
      setLoading(false);
    })().catch(() => {
      if (!cancelled) { setNotFound(true); setLoading(false); }
    });

    return () => { cancelled = true; };
  }, [slug]);

  // ── Carrito persistido ──────────────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = localStorage.getItem(cartKey(slug));
      setCart(raw ? JSON.parse(raw) : []);
    } catch { setCart([]); }
  }, [slug]);

  const persist = useCallback((next: CartLine[]) => {
    setCart(next);
    try { localStorage.setItem(cartKey(slug), JSON.stringify(next)); } catch { /* cuota */ }
  }, [slug]);

  // ── Sesión de carrito, para poder recuperarlo si lo abandonan ───────────
  // Se guarda del lado del servidor con un token estable por navegador. Solo
  // sirve de algo si además hay email, cosa que valida el propio RPC.
  useEffect(() => {
    if (loading || !store) return;
    const key = `gestiona.store.session.${slug}`;
    let token = "";
    try {
      token = localStorage.getItem(key) ?? "";
      if (!token) {
        token = crypto.randomUUID();
        localStorage.setItem(key, token);
      }
    } catch { return; }

    // Con debounce: si no, cada clic en "+" dispararía una escritura.
    const t = setTimeout(() => {
      supabase.rpc("save_store_cart", {
        p_slug: slug,
        p_token: token,
        p_items: cart.map(l => ({
          product_id: l.productId, name: l.name, quantity: l.qty,
          unit_price: l.price, image_url: l.image,
        })),
        p_email: null,
        p_subtotal: cart.reduce((s, l) => s + l.price * l.qty, 0),
      }).then(undefined, () => {});
    }, 2500);

    return () => clearTimeout(t);
  }, [cart, slug, loading, store]);

  /**
   * Clave de línea del carrito. Dos variantes del mismo producto son dos
   * líneas distintas, así que el id del producto solo no alcanza.
   * Definida fuera de los callbacks para que todos usen la misma regla.
   */
  const lineKeyOf = useCallback(
    (l: CartLine) => (l.variantId ? `${l.productId}::${l.variantId}` : l.productId),
    [],
  );

  // El precio que ve el comprador: el menor entre la oferta manual y la mejor
  // promocion. Espejo de `resolve_store_line`, que es la que cobra: si
  // divergieran, la tienda mostraria un precio y el checkout cobraria otro.
  const priceOf = useCallback((p: StoreProduct) => {
    const lista = Number(p.sale_price_ars) || 0;
    const oferta = Number(p.discount_price_ars) || 0;
    const vigente = oferta > 0 && oferta < lista ? oferta : lista;
    const promo = Number(p.promo_price) || 0;
    return promo > 0 && promo < vigente ? promo : vigente;
  }, []);

  const addToCart = useCallback((p: StoreProduct, qty = 1, variant?: StoreVariant | null) => {
    // Cada variante es una línea propia: 50ml y 100ml son productos
    // distintos con su precio y su stock.
    const key = variant ? `${p.id}::${variant.id}` : p.id;
    const existing = cart.find(l => lineKeyOf(l) === key);
    const stock = variant ? variant.stock : p.stock;
    const precio = variant && Number(variant.price_override) > 0
      ? Number(variant.price_override)
      : priceOf(p);
    // Nunca se deja superar el stock: si no, el checkout falla al final,
    // que es el peor momento para enterarse.
    const nextQty = Math.min(stock, (existing?.qty ?? 0) + qty);
    const line: CartLine = {
      productId: p.id,
      variantId: variant?.id ?? null,
      name: variant ? `${p.name} — ${variant.variant_name}` : p.name,
      brand: p.brand,
      price: precio, qty: nextQty,
      image: variant?.image_url ?? p.image_url,
      stock,
    };
    persist(existing
      ? cart.map(l => (lineKeyOf(l) === key ? line : l))
      : [...cart, line]);
  }, [cart, persist, priceOf]);

  const setQty = useCallback((lineKey: string, qty: number) => {
    if (qty <= 0) { persist(cart.filter(l => lineKeyOf(l) !== lineKey)); return; }
    persist(cart.map(l => (lineKeyOf(l) === lineKey ? { ...l, qty: Math.min(l.stock, qty) } : l)));
  }, [cart, persist]);

  const removeFromCart = useCallback((lineKey: string) => {
    persist(cart.filter(l => lineKeyOf(l) !== lineKey));
  }, [cart, persist]);

  const clearCart = useCallback(() => persist([]), [persist]);

  const fmt = useCallback((n: number) =>
    new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: store?.currency || "ARS",
      maximumFractionDigits: 0,
    }).format(n), [store?.currency]);

  const value = useMemo<Ctx>(() => {
    const subtotal = cart.reduce((s, l) => s + l.price * l.qty, 0);

    // El servidor recalcula esto en `create_store_order`; acá se muestra para
    // que el carrito diga el mismo número que se va a cobrar.
    // Por producto gana el mejor entre el 2x y la mejor regla de cantidad,
    // nunca la suma. Espejo de `store_volume_discount`.
    const promo2x = ahorroPorVolumen(
      cart.map(l => ({
        productId: l.productId,
        qty: l.qty,
        price: l.price,
        category: products.find(pr => pr.id === l.productId)?.category ?? null,
      })),
      Object.fromEntries(products.map(pr => [pr.id, pr.price_2x_ars])),
      reglasCantidad,
    ).total;
    const base = Number(store?.shipping_cost) || 0;
    const threshold = Number(store?.free_shipping_above) || 0;
    const neto = Math.max(0, subtotal - promo2x);
    const freeShipping = threshold > 0 && neto >= threshold;
    const shippingCost = cart.length === 0 ? 0 : (freeShipping ? 0 : base);

    return {
      loading, notFound, store, products, perfumes, variantsByProduct, reviewsByProduct, pages, banners, cart, categorias,
      addToCart, setQty, removeFromCart, clearCart, lineKeyOf,
      cartCount: cart.reduce((s, l) => s + l.qty, 0),
      subtotal,
      promo2x,
      shippingCost,
      total: neto + shippingCost,
      freeShippingGap: threshold > 0 && !freeShipping && cart.length > 0
        ? threshold - neto
        : null,
      priceOf, fmt,
    };
  }, [loading, notFound, store, products, perfumes, variantsByProduct, reviewsByProduct, pages, banners, cart, categorias, reglasCantidad, addToCart, setQty, removeFromCart, clearCart, lineKeyOf, priceOf, fmt]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Ctx {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore debe usarse dentro de StoreProvider");
  return ctx;
}
