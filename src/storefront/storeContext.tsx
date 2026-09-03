/**
 * Estado compartido de la tienda: datos del comercio, catálogo y carrito.
 *
 * El carrito responde primero desde memoria/localStorage y se reconcilia con
 * una sesión servidor por tienda. La base guarda sólo referencias saneadas y
 * vuelve a resolver precio y stock con el mismo Core que usa el checkout.
 */
import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { ahorroPorVolumen, type ReglaCantidad } from "@/lib/promo2x";
import { precioDeCatalogo } from "@/lib/storefrontSeo";
import type { CategoriaTienda } from "@/lib/storeCategories";
import {
  fetchStoreProducts,
  fetchStoreVariants,
  getActiveStoreCart,
  retryPublicRead,
  saveActiveStoreCart,
  type StoreVariant,
} from "@/lib/publicDataSource";
import { mediosDePagoOfrecibles } from "@/lib/gestionaPay";
import { cartShippingCellText, cartShippingDisplay } from "@/lib/storeCartShipping";
import { normalizarEmail } from "@/lib/couponRules";
import {
  mergeStoreCartReferences,
  parseStoreCartReferences,
  rebuildStoreCart,
  storeCartReferencesFromLines,
  type StoreCartReference,
} from "@/lib/storeCartSync";
import { useStoreAuth } from "./storeAuth";

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
  /** Horario u otras indicaciones. Vacío = no se inventa. */
  pickup_instructions: string | null;
  meta_title: string | null;
  meta_description: string | null;
  social_links: Record<string, string> | null;
  /** Menú armado por el comercio. Vacío = se arma solo. Ver `storeMenu.ts`. */
  nav_links: unknown;
  /** Portada: anuncio + bloques. Vacío = se arma sola. Ver `storeHomeLayout.ts`. */
  storefront_layout: unknown;
  /** Provincias con tarifa de domicilio. Vacío = no hay envío a domicilio. */
  shipping_provinces: string[] | null;
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

export type CartSyncStatus = "loading" | "syncing" | "synced" | "local" | "error";

interface Ctx {
  /** Vacío en slug.nerqia.app; /tienda/:slug en el host compartido. */
  basePath: string;
  loading: boolean;
  notFound: boolean;
  /** Red o catálogo fallaron: no es un 404. */
  loadError: boolean;
  reload: () => void;
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
  /** Estado real de la persistencia; `local` es el fallback durante el deploy. */
  cartSyncStatus: CartSyncStatus;
  /** Ajustes por precio/stock/catálogo al recuperar una sesión. */
  cartSyncNotice: string | null;
  /** Capacidad anónima del carrito actual; se enlaza atómicamente al pedido. */
  cartToken: string;
  /** Ahorro de la promo "llevando 2". Espejo de `store_promo_2x_discount`. */
  promo2x: number;
  /** Categorías que cargó el comercio. Vacío = todavía usa los nombres viejos. */
  categorias: CategoriaTienda[];
  addToCart: (p: StoreProduct, qty?: number, variant?: StoreVariant | null) => void;
  /**
   * Sube al agregar: el layout abre el drawer (mini-cart Shopify/Tiendanube).
   * 0 = todavía no hubo un alta en esta sesión de página.
   */
  cartRevealTick: number;
  setQty: (lineKey: string, qty: number) => void;
  removeFromCart: (lineKey: string) => void;
  /** Clave única de una línea: producto, o producto+variante. */
  lineKeyOf: (l: CartLine) => string;
  clearCart: () => void;
  /** Recompone varias líneas de una vez contra catálogo y variantes actuales. */
  restoreCart: (references: StoreCartReference[]) => {
    restoredCount: number;
    unavailableCount: number;
    adjustedCount: number;
  };
  /**
   * Email del checkout para recupero. La sesión se persiste aun sin email; el
   * cron sólo contacta cuando existe una dirección válida.
   */
  rememberCartEmail: (email: string | null | undefined) => void;
  cartCount: number;
  subtotal: number;
  /**
   * Monto de envío sumado al total del drawer.
   * En modo zones es 0 hasta cotizar en checkout (no inventa flat ni «Gratis»).
   */
  shippingCost: number;
  /** Celda Envío del carrito: plata formateada o «Se calcula con tu provincia». */
  shippingLabel: string;
  /** true cuando el flete todavía depende de la provincia (modo zones). */
  shippingPending: boolean;
  total: number;
  /** Cuánto falta para el envío gratis, o null si no aplica. */
  freeShippingGap: number | null;
  priceOf: (p: StoreProduct) => number;
  fmt: (n: number) => string;
}

const StoreContext = createContext<Ctx | null>(null);

const cartKey = (slug: string) => `gestiona.store.cart.${slug}`;
const cartUpdatedKey = (slug: string) => `gestiona.store.cart.updated.${slug}`;
const cartSessionKey = (slug: string) => `gestiona.store.session.${slug}`;

export function StoreProvider({
  slug,
  basePath = `/tienda/${encodeURIComponent(slug)}`,
  children,
}: {
  slug: string;
  basePath?: string;
  children: ReactNode;
}) {
  const {
    loading: buyerIdentityLoading,
    session: buyerSession,
    customer: buyerCustomer,
  } = useStoreAuth();
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
  const [loadError, setLoadError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartRevealTick, setCartRevealTick] = useState(0);
  const [cartToken, setCartToken] = useState("");
  const [cartHydrated, setCartHydrated] = useState(false);
  const [cartSyncStatus, setCartSyncStatus] = useState<CartSyncStatus>("loading");
  const [cartSyncNotice, setCartSyncNotice] = useState<string | null>(null);
  const cartRef = useRef<CartLine[]>([]);
  const cartLocalUpdatedAtRef = useRef(0);
  const previousBuyerUserRef = useRef<string | null>(null);
  /** Email tipado en checkout → recovery. Null = persiste sin contacto. */
  const [cartEmail, setCartEmail] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoadError(false);
    setNotFound(false);
    setReloadTick(n => n + 1);
  }, []);

  // ── Carga de la tienda ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setLoadError(false);

    (async () => {
      const storeResponse = await retryPublicRead(() =>
        supabase.rpc("get_store_by_slug", { p_slug: slug }));
      if (storeResponse.error) {
        console.error("[tienda] error leyendo la tienda:", storeResponse.error.message);
        if (!cancelled) { setLoadError(true); setLoading(false); }
        return;
      }
      const { data } = storeResponse;
      const row = (Array.isArray(data) ? data[0] : data) as StoreInfo | undefined;
      if (cancelled) return;

      if (!row?.owner_user_id) {
        setNotFound(true);
        setStore(null);
        setLoading(false);
        return;
      }
      setStore({
        ...row,
        payment_methods: mediosDePagoOfrecibles(row.payment_methods),
      });

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

      if (!pRes.ok) {
        setLoadError(true);
        setLoading(false);
        return;
      }

      // Los agotados se muestran, pero últimos: la tienda tiene que verse
      // llena de lo que sí se puede comprar.
      const lista = pRes.data as unknown as StoreProduct[];
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
      if (!cancelled) { setLoadError(true); setLoading(false); }
    });

    return () => { cancelled = true; };
  }, [slug, reloadTick]);

  // ── Carrito persistido ──────────────────────────────────────────────────
  useEffect(() => {
    setCartHydrated(false);
    setCartSyncStatus("loading");
    setCartSyncNotice(null);
    try {
      const raw = localStorage.getItem(cartKey(slug));
      const parsed = raw ? JSON.parse(raw) : [];
      const initial = Array.isArray(parsed) ? parsed as CartLine[] : [];
      cartRef.current = initial;
      setCart(initial);
      cartLocalUpdatedAtRef.current = Number(localStorage.getItem(cartUpdatedKey(slug))) || 0;

      let token = localStorage.getItem(cartSessionKey(slug)) ?? "";
      if (!token) {
        token = crypto.randomUUID();
        localStorage.setItem(cartSessionKey(slug), token);
      }
      setCartToken(token);
    } catch {
      cartRef.current = [];
      setCart([]);
      setCartToken(crypto.randomUUID());
      cartLocalUpdatedAtRef.current = 0;
    }
  }, [slug]);

  const persist = useCallback((next: CartLine[]) => {
    cartRef.current = next;
    setCart(next);
    const updatedAt = Date.now();
    cartLocalUpdatedAtRef.current = updatedAt;
    try {
      localStorage.setItem(cartKey(slug), JSON.stringify(next));
      localStorage.setItem(cartUpdatedKey(slug), String(updatedAt));
    } catch { /* cuota */ }
  }, [slug]);

  const rememberCartEmail = useCallback((raw: string | null | undefined) => {
    setCartEmail(normalizarEmail(raw));
  }, []);

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
  // promocion. Vive en `precioDeCatalogo` para que el JSON-LD del borde
  // declare el mismo número que cobra `resolve_store_line`.
  const priceOf = useCallback((p: StoreProduct) => precioDeCatalogo(p), []);

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
    // Mini-cart: sin esto la cotización y el cross-sell del drawer quedan
    // detrás del ícono (medido sesión 143).
    setCartRevealTick((t) => t + 1);
  }, [cart, persist, priceOf, lineKeyOf]);

  const setQty = useCallback((lineKey: string, qty: number) => {
    if (qty <= 0) { persist(cart.filter(l => lineKeyOf(l) !== lineKey)); return; }
    persist(cart.map(l => (lineKeyOf(l) === lineKey ? { ...l, qty: Math.min(l.stock, qty) } : l)));
  }, [cart, persist, lineKeyOf]);

  const removeFromCart = useCallback((lineKey: string) => {
    persist(cart.filter(l => lineKeyOf(l) !== lineKey));
  }, [cart, persist, lineKeyOf]);

  const clearCart = useCallback(() => persist([]), [persist]);

  const restoreCart = useCallback((references: StoreCartReference[]) => {
    const rebuilt = rebuildStoreCart(references, products, variantsByProduct, priceOf);
    persist(rebuilt.lines as CartLine[]);

    const changes: string[] = [];
    if (rebuilt.unavailableCount > 0) {
      changes.push(`${rebuilt.unavailableCount} ${rebuilt.unavailableCount === 1 ? "producto ya no está disponible" : "productos ya no están disponibles"}`);
    }
    if (rebuilt.adjustedCount > 0) {
      changes.push("ajustamos cantidades al stock actual");
    }
    setCartSyncNotice(changes.length > 0 ? changes.join(" y ") : null);

    return {
      restoredCount: rebuilt.lines.length,
      unavailableCount: rebuilt.unavailableCount,
      adjustedCount: rebuilt.adjustedCount,
    };
  }, [products, variantsByProduct, priceOf, persist]);

  // Al cerrar sesión se rota la capacidad local: una PC compartida no puede
  // seguir mutando el carrito ligado a la cuenta anterior. La hidratación de
  // login depende de `buyerCustomer`, ya resuelto para este slug.
  useEffect(() => {
    const currentUser = buyerSession?.user.id ?? null;
    if (previousBuyerUserRef.current && !currentUser) {
      const nextToken = crypto.randomUUID();
      setCartToken(nextToken);
      try { localStorage.setItem(cartSessionKey(slug), nextToken); } catch { /* privacidad */ }
    }
    previousBuyerUserRef.current = currentUser;
  }, [buyerSession?.user.id, slug]);

  // El servidor decide qué sesión corresponde. Si al iniciar sesión existen
  // una del dispositivo y otra de la cuenta, devuelve ambas consolidadas. La
  // vista se rearma siempre con catálogo actual para no revivir precio/stock.
  useEffect(() => {
    if (loading || buyerIdentityLoading || !store || !cartToken) return;
    let cancelled = false;
    setCartHydrated(false);
    setCartSyncStatus("loading");

    void getActiveStoreCart({ slug, token: cartToken }).then((result) => {
      if (cancelled) return;
      if (result.error) {
        setCartSyncStatus("error");
        return;
      }

      const localReferences = storeCartReferencesFromLines(cartRef.current);
      const serverReferences = parseStoreCartReferences(result.data?.items);
      const serverUpdatedAt = Date.parse(result.data?.updated_at ?? "") || 0;
      let references = localReferences;

      if (result.data?.found) {
        // Primera carga después de migrar desde el formato sólo-local: esa
        // instalación todavía no tiene timestamp. Unir evita pisar un carrito
        // reciente con el snapshot de recovery que hubiese quedado en base.
        const legacyLocalNeedsMerge = cartLocalUpdatedAtRef.current === 0
          && localReferences.length > 0;
        if (result.data.merged || legacyLocalNeedsMerge) {
          references = mergeStoreCartReferences(localReferences, serverReferences);
        } else if (serverUpdatedAt >= cartLocalUpdatedAtRef.current) {
          references = serverReferences;
        }
      }

      const rebuilt = rebuildStoreCart(references, products, variantsByProduct, priceOf);
      persist(rebuilt.lines as CartLine[]);

      const changes: string[] = [];
      if (result.data?.source === "account" || result.data?.merged) {
        changes.push("recuperamos el carrito de tu cuenta");
      }
      if (rebuilt.unavailableCount > 0) {
        changes.push(`${rebuilt.unavailableCount} ${rebuilt.unavailableCount === 1 ? "producto dejó de estar disponible" : "productos dejaron de estar disponibles"}`);
      }
      if (rebuilt.adjustedCount > 0) changes.push("ajustamos cantidades al stock actual");
      setCartSyncNotice(changes.length > 0 ? changes.join("; ") : null);
      setCartSyncStatus(result.supported ? "synced" : "local");
      setCartHydrated(true);
    });

    return () => { cancelled = true; };
  }, [loading, buyerIdentityLoading, buyerSession?.user.id, buyerCustomer?.id, store, slug, cartToken, products, variantsByProduct, priceOf, persist]);

  // Debounce corto: el carrito sigue respondiendo en memoria, y una ráfaga de
  // clics en + termina en una sola escritura. Los errores quedan visibles en
  // consola y en la UI; no se convierten en un falso “carrito vacío”.
  useEffect(() => {
    if (!cartHydrated || loading || !store || !cartToken) return;
    let cancelled = false;
    setCartSyncStatus("syncing");
    const timeout = window.setTimeout(() => {
      void saveActiveStoreCart({
        slug,
        token: cartToken,
        lines: cart,
        email: cartEmail,
      }).then((result) => {
        if (cancelled) return;
        setCartSyncStatus(result.error ? "error" : result.supported ? "synced" : "local");
      });
    }, 1200);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [cart, cartEmail, cartHydrated, cartToken, loading, slug, store]);

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
    // zones: no usar shipping_cost ni decir Gratis — el checkout cotiza por provincia.
    const ship = cartShippingDisplay({
      shippingMode: store?.shipping_mode,
      cartEmpty: cart.length === 0,
      flatShippingCost: base,
      freeShippingUnlocked: freeShipping,
    });
    const shippingCost = ship.amount ?? 0;
    const shippingPending = ship.amount === null;
    const shippingLabel = cartShippingCellText(ship, fmt);

    return {
      basePath,
      loading, notFound, loadError, reload, store, products, perfumes, variantsByProduct, reviewsByProduct, pages, banners, cart, categorias,
      addToCart, setQty, removeFromCart, clearCart, restoreCart, rememberCartEmail, lineKeyOf,
      cartSyncStatus, cartSyncNotice, cartToken,
      cartRevealTick,
      cartCount: cart.reduce((s, l) => s + l.qty, 0),
      subtotal,
      promo2x,
      shippingCost,
      shippingLabel,
      shippingPending,
      total: neto + shippingCost,
      freeShippingGap: threshold > 0 && !freeShipping && cart.length > 0
        ? threshold - neto
        : null,
      priceOf, fmt,
    };
  }, [basePath, loading, notFound, loadError, reload, store, products, perfumes, variantsByProduct, reviewsByProduct, pages, banners, cart, categorias, reglasCantidad, addToCart, setQty, removeFromCart, clearCart, restoreCart, rememberCartEmail, lineKeyOf, cartRevealTick, cartSyncStatus, cartSyncNotice, cartToken, priceOf, fmt]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Ctx {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore debe usarse dentro de StoreProvider");
  return ctx;
}
