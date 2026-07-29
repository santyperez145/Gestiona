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
  meta_title: string | null;
  meta_description: string | null;
  social_links: Record<string, string> | null;
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
  cart: CartLine[];
  addToCart: (p: StoreProduct, qty?: number) => void;
  setQty: (productId: string, qty: number) => void;
  removeFromCart: (productId: string) => void;
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
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);

  // ── Carga de la tienda ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setNotFound(false);

    (async () => {
      const { data } = await supabase.rpc("get_store_by_slug", { p_slug: slug });
      const row = (Array.isArray(data) ? data[0] : data) as StoreInfo | undefined;
      if (cancelled) return;

      if (!row?.owner_user_id) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setStore(row);

      const [pRes, dRes] = await Promise.all([
        supabase
          .from("products")
          .select("id,name,brand,category,gender,description,sale_price_ars,discount_price_ars,stock,image_url,image_urls,content_ml,featured,total_sold,created_at")
          .eq("org_id", row.org_id)
          .gt("stock", 0)
          .order("featured", { ascending: false })
          .order("name"),
        supabase.rpc("get_store_perfume_details", { p_slug: slug }),
      ]);
      if (cancelled) return;

      setProducts((pRes.data ?? []) as StoreProduct[]);
      const map: Record<string, PerfumeDetail> = {};
      ((dRes.data ?? []) as PerfumeDetail[]).forEach(d => { map[d.product_id] = d; });
      setPerfumes(map);
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

  const priceOf = useCallback((p: StoreProduct) => {
    const d = Number(p.discount_price_ars) || 0;
    return d > 0 && d < Number(p.sale_price_ars) ? d : Number(p.sale_price_ars);
  }, []);

  const addToCart = useCallback((p: StoreProduct, qty = 1) => {
    const existing = cart.find(l => l.productId === p.id);
    // Nunca se deja superar el stock: si no, el checkout falla al final,
    // que es el peor momento para enterarse.
    const nextQty = Math.min(p.stock, (existing?.qty ?? 0) + qty);
    const line: CartLine = {
      productId: p.id, name: p.name, brand: p.brand,
      price: priceOf(p), qty: nextQty, image: p.image_url, stock: p.stock,
    };
    persist(existing
      ? cart.map(l => (l.productId === p.id ? line : l))
      : [...cart, line]);
  }, [cart, persist, priceOf]);

  const setQty = useCallback((productId: string, qty: number) => {
    if (qty <= 0) { persist(cart.filter(l => l.productId !== productId)); return; }
    persist(cart.map(l => (l.productId === productId ? { ...l, qty: Math.min(l.stock, qty) } : l)));
  }, [cart, persist]);

  const removeFromCart = useCallback((productId: string) => {
    persist(cart.filter(l => l.productId !== productId));
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
    const base = Number(store?.shipping_cost) || 0;
    const threshold = Number(store?.free_shipping_above) || 0;
    const freeShipping = threshold > 0 && subtotal >= threshold;
    const shippingCost = cart.length === 0 ? 0 : (freeShipping ? 0 : base);

    return {
      loading, notFound, store, products, perfumes, cart,
      addToCart, setQty, removeFromCart, clearCart,
      cartCount: cart.reduce((s, l) => s + l.qty, 0),
      subtotal,
      shippingCost,
      total: subtotal + shippingCost,
      freeShippingGap: threshold > 0 && !freeShipping && cart.length > 0
        ? threshold - subtotal
        : null,
      priceOf, fmt,
    };
  }, [loading, notFound, store, products, perfumes, cart, addToCart, setQty, removeFromCart, clearCart, priceOf, fmt]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Ctx {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore debe usarse dentro de StoreProvider");
  return ctx;
}
