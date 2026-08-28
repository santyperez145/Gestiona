import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useCuotasDelComercio, textoDeCuotas, type CuotaOfrecida } from "@/lib/cuotasDelComercio";
import { supabase } from "@/integrations/supabase/client";
import { safeChannel } from "@/lib/realtimeChannel";
import { loadPublicPromotions, bestPromoPrice } from "@/lib/promotions";
import { nombreDeCategoria } from "@/lib/storeCategories";
import {
  fetchCatalogProducts, fetchCatalogSettings, fetchCatalogVariants,
} from "@/lib/publicDataSource";
import {
  Package,
  Tag,
  Search,
  Share2,
  X,
  MessageCircle,
  Star,
  Clock,
  Copy,
  Flame,
  Eye,
  ShoppingBag,
  Droplets,
  Zap,
  Users,
  Plus,
  Minus,
  ShoppingCart,
  Trash2,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

import { plural } from "@/lib/plural";
// ─── Constants ────────────────────────────────────────────────────────────────

// El rótulo de una categoría sale de `nombreDeCategoria`, no de un mapa propio.
// Acá vivía la cuarta copia de los mismos cuatro nombres de perfumería, y era
// la peor de las cuatro: un comercio de otro rubro publicaba su catálogo por
// WhatsApp con los slugs crudos —"ropa_interior"— a la vista del comprador.
//
// ⚠️ Esta página es pública y anónima, así que no puede leer
// `ecommerce_categories` con el contexto del comercio: `nombreDeCategoria` sin
// categorías es el fallback legible, no el nombre que el comercio editó. Para
// eso está la tienda de `/tienda/:slug`, que sí lo resuelve por RPC.

const GENDER_LABELS: Record<string, { icon: string; label: string }> = {
  masculino: { icon: "♂", label: "Masculino" },
  femenino: { icon: "♀", label: "Femenino" },
  unisex: { icon: "⚥", label: "Unisex" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtARS(n: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(n);
}

function pseudoRandom(seed: string, min: number, max: number) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h << 5) - h + seed.charCodeAt(i);
    h |= 0;
  }
  const hour = new Date().getHours();
  return min + Math.abs((h + hour) % (max - min + 1));
}

// ─── CountdownTimer ───────────────────────────────────────────────────────────

function CountdownTimer({ expiresAt, primaryColor }: { expiresAt: string; primaryColor: string }) {
  const [timeLeft, setTimeLeft] = useState("");
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const update = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) { setExpired(true); setTimeLeft(""); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(h > 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${m}m ${s}s`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  if (expired) return null;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold"
      style={{ background: `${primaryColor}25`, color: primaryColor, border: `1px solid ${primaryColor}40` }}
    >
      <Clock className="w-2.5 h-2.5" />
      {timeLeft}
    </span>
  );
}

// ─── Skeleton card ────────────────────────────────────────────────────────────

function ProductCardSkeleton() {
  return (
    <div className="rounded-[14px] overflow-hidden bg-white/[0.025] border border-white/[0.06]">
      <Skeleton className="aspect-[3/4] bg-white/[0.04]" />
      <div className="p-3 space-y-2">
        <Skeleton className="h-3 w-3/4 bg-white/[0.05]" />
        <Skeleton className="h-3 w-1/2 bg-white/[0.04]" />
        <Skeleton className="h-9 w-full bg-white/[0.04] rounded-[8px]" />
      </div>
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({
  icon,
  label,
  color,
  count,
  action,
}: {
  icon: React.ReactNode;
  label: string;
  color: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2.5">
        <div
          className="w-0.5 h-5 rounded-full shrink-0"
          style={{ background: `linear-gradient(to bottom, ${color}, ${color}44)` }}
        />
        <span className="flex items-center gap-1.5" style={{ color }}>
          {icon}
          <span className="text-[11px] font-bold uppercase tracking-[0.1em]">{label}</span>
        </span>
        {count !== undefined && (
          <span
            className="px-1.5 py-0.5 rounded-full text-[9px] font-bold"
            style={{ background: `${color}18`, color }}
          >
            {count}
          </span>
        )}
      </div>
      {action}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

interface PublicCatalogProps {
  /**
   * Permite reusar la vitrina desde /tienda/:slug, que resuelve al dueño por
   * el slug de la tienda en vez de tomarlo de la URL.
   */
  overrideUserId?: string;
  /** Marca de la tienda (nombre, color, logo) cuando se entra por /tienda. */
  storeBranding?: { name?: string | null; primary_color?: string | null; logo_url?: string | null } | null;
}

export default function PublicCatalogPage({ overrideUserId, storeBranding }: PublicCatalogProps = {}) {
  const { userId: routeUserId } = useParams<{ userId: string }>();
  const userId = overrideUserId ?? routeUserId;
  const [products, setProducts] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [valid, setValid] = useState<boolean | null>(null);
  const [orgIdCuotas, setOrgIdCuotas] = useState<string | null>(null);
  const cuotasOfrecidas = useCuotasDelComercio(orgIdCuotas);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [filterGender, setFilterGender] = useState("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailProduct, setDetailProduct] = useState<any>(null);
  const [fullSettings, setFullSettings] = useState<any>(null);

  // Cart
  const [cart, setCart] = useState<{ id: string; name: string; price: number; qty: number; size?: string }[]>([]);
  const [cartOpen, setCartOpen] = useState(false);

  const addToCart = (product: any, size?: string) => {
    const price = Number(product.discount_price_ars || product.sale_price_ars);
    const key = size ? `${product.id}__${size}` : product.id;
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.id === key);
      if (idx >= 0) return prev.map((i, ix) => (ix === idx ? { ...i, qty: i.qty + 1 } : i));
      return [...prev, { id: key, name: product.name + (size ? ` (${size}ml)` : ""), price, qty: 1, size }];
    });
  };

  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const cartCount = cart.reduce((s, i) => s + i.qty, 0);

  const fetchData = useCallback(async () => {
    if (!userId) { setValid(false); return; }
    const [pRes, sRes, fsRes] = await Promise.all([
      // Vistas públicas saneadas: sin costos, sin márgenes, sin credenciales.
      // Los precios de decant vienen ya calculados desde la base.
      fetchCatalogProducts(userId),
      // ⚠️ `.order().limit(1)` porque `settings.user_id` dejó de ser único el
      // 2026-08-26: un dueño con dos comercios tiene dos filas, y sin esto
      // `.maybeSingle()` fallaría con "multiple rows" y el catálogo diría
      // "no encontrado". Se toma la del comercio original.
      supabase.from("settings_public").select("*").eq("user_id", userId)
        .order("org_id", { ascending: true }).limit(1).maybeSingle(),
      fetchCatalogSettings(userId),
    ]);
    if (!sRes.data) { setValid(false); return; }

    // Promociones vigentes: sin esto la vidriera mostraba un precio y el POS
    // cobraba otro. Se leen por RPC (la RLS de `promotions` exige auth) y se
    // vuelcan sobre `discount_price_ars`, que es el campo que usa toda la
    // página para badges, % OFF, combos y el mensaje de WhatsApp.
    const rows = pRes || [];
    const orgId = (rows[0] as any)?.org_id as string | undefined;
    // Las cuotas que se muestran salen de lo que el comercio configuró.
    setOrgIdCuotas(orgId ?? null);
    let priced = rows;
    if (orgId) {
      const promos = await loadPublicPromotions(orgId);
      if (promos.length) {
        priced = rows.map((p: any) => {
          const best = bestPromoPrice(p, promos);
          if (!best) return p;
          const current = p.discount_price_ars != null ? Number(p.discount_price_ars) : Number(p.sale_price_ars);
          return best.price < current ? { ...p, discount_price_ars: best.price } : p;
        });
      }
    }
    setProducts(priced);
    setSettings(sRes.data);
    setFullSettings(fsRes || null);
    setValid(true);
  }, [userId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!userId || !valid) return;
    const channel = safeChannel("public-catalog-rt", userId)
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, () => fetchData())
      .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, valid, fetchData]);

  useEffect(() => {
    const title = storeBranding?.name || settings?.business_name;
    if (title) document.title = `${title} — Catálogo`;
  }, [settings, storeBranding]);

  // Derived data
  const categories = useMemo(() => {
    const cats = [...new Set(products.map((p) => p.category))];
    return cats.map((c) => ({ value: c, label: nombreDeCategoria(c), count: products.filter((p) => p.category === c).length }));
  }, [products]);

  const isPerfumeCategory = filterCat === "perfume_arabe" || filterCat === "perfume_diseñador";
  const hasPerfumes = products.some((p) => p.category === "perfume_arabe" || p.category === "perfume_diseñador");

  const filtered = useMemo(
    () =>
      products.filter((p) => {
        if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.brand?.toLowerCase().includes(search.toLowerCase())) return false;
        if (filterCat !== "all" && p.category !== filterCat) return false;
        if (filterGender !== "all" && p.gender !== filterGender) return false;
        return true;
      }),
    [products, search, filterCat, filterGender],
  );

  const featuredProducts = useMemo(() => filtered.filter((p) => p.featured && (!p.offer_expires_at || new Date(p.offer_expires_at) > new Date())), [filtered]);
  const topSellers = useMemo(() => [...filtered].filter((p) => Number(p.total_sold || 0) > 0).sort((a, b) => Number(b.total_sold || 0) - Number(a.total_sold || 0)).slice(0, 8), [filtered]);
  const regularProducts = useMemo(() => { const ids = new Set(featuredProducts.map((p) => p.id)); return filtered.filter((p) => !ids.has(p.id)); }, [filtered, featuredProducts]);
  const perfumes = useMemo(() => filtered.filter((p) => p.category === "perfume_arabe" || p.category === "perfume_diseñador"), [filtered]);
  const novedades = useMemo(() => {
    const shownIds = new Set([...featuredProducts, ...topSellers].map((p) => p.id));
    return [...products].filter((p) => !shownIds.has(p.id)).sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()).slice(0, 6);
  }, [products, featuredProducts, topSellers]);
  const ofertasEspeciales = useMemo(() =>
    products
      .filter((p) => p.discount_price_ars && Number(p.discount_price_ars) < Number(p.sale_price_ars))
      .sort((a, b) => (1 - Number(b.discount_price_ars) / Number(b.sale_price_ars)) - (1 - Number(a.discount_price_ars) / Number(a.sale_price_ars)))
      .slice(0, 4),
    [products]);

  // La marca de la tienda (si se entra por /tienda/:slug) pisa la del negocio.
  const primaryColor = storeBranding?.primary_color || settings?.primary_color || "#D4A843";
  const accentColor = settings?.catalog_accent_color || primaryColor;
  const businessName = storeBranding?.name || settings?.business_name || "EXENTRY IMPORTS";
  const logoUrl = storeBranding?.logo_url || settings?.logo_url || "/exentry-logo.png";
  const whatsappNumber = settings?.whatsapp_number;

  const heroConfig = useMemo(() => {
    const sorted = [...categories].sort((a, b) => b.count - a.count);
    const top = sorted[0]?.value || "all";
    const cfgs: Record<string, { headline: string; sub: string; cta: string; emoji: string; cat: string }> = {
      perfume_arabe: { headline: "Fragancias de Oriente", sub: "Perfumes árabes de larga duración con las mejores esencias", cta: "Ver perfumes árabes", emoji: "🌸", cat: "perfume_arabe" },
      perfume_diseñador: { headline: "Perfumes de Diseñador", sub: "Las mejores marcas internacionales al mejor precio", cta: "Ver perfumes", emoji: "✨", cat: "perfume_diseñador" },
      vaper: { headline: "Vapers & Sabores", sub: "La selección más completa con los mejores sabores", cta: "Ver vapers", emoji: "💨", cat: "vaper" },
      electronico: { headline: "Tech & Electrónica", sub: "Los últimos gadgets al mejor precio del mercado", cta: "Ver electrónica", emoji: "⚡", cat: "electronico" },
    };
    return cfgs[top] || { headline: businessName, sub: `${plural(products.length, "producto")} disponibles`, cta: "Ver catálogo", emoji: "🛍️", cat: "all" };
  }, [categories, businessName, products.length]);

  const showAllView = filterCat === "all" && !search;

  // ── Loading / Error ───────────────────────────────────────────────────────

  if (valid === null)
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#080812]">
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-10 h-10 border-2 border-t-transparent rounded-full animate-spin"
            style={{ borderColor: `${primaryColor} transparent ${primaryColor} ${primaryColor}` }}
          />
          <p className="text-white/20 text-xs tracking-widest uppercase">Cargando catálogo…</p>
        </div>
      </div>
    );

  if (!valid)
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#080812] text-white px-4">
        <div className="text-center">
          <div className="w-20 h-20 bg-white/5 rounded-[14px] flex items-center justify-center mx-auto mb-5 border border-white/10">
            <Package className="w-9 h-9 text-white/20" />
          </div>
          <h1 className="text-xl font-bold mb-2">Catálogo no encontrado</h1>
          <p className="text-white/35 text-sm">El enlace no es válido o el negocio no existe.</p>
        </div>
      </div>
    );

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try { await navigator.share({ title: `${businessName} — Catálogo`, url }); } catch { return; }
    } else {
      await navigator.clipboard.writeText(url);
    }
  };

  const buildWhatsAppUrl = (product?: any, size?: string) => {
    if (!whatsappNumber) return "";
    const num = whatsappNumber.replace(/[^0-9]/g, "");
    const sizeLabel = size && size !== "full" ? ` (${size}ml)` : "";
    const msg = product
      ? `Hola! Me interesa: *${product.name}${sizeLabel}* — ${fmtARS(Number(product.discount_price_ars || product.sale_price_ars))} 🛍️`
      : "Hola! Vi tu catálogo y me interesa consultar sobre un producto 🛍️";
    return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
  };

  const buildCartWhatsAppUrl = () => {
    if (!whatsappNumber || !cart.length) return "";
    const num = whatsappNumber.replace(/[^0-9]/g, "");
    const lines = cart.map((i) => `• ${i.qty}x *${i.name}* — ${fmtARS(i.price * i.qty)}`).join("\n");
    const msg = `Hola! Quiero hacer el siguiente pedido desde el catálogo 🛍️\n\n${lines}\n\n*Total: ${fmtARS(cartTotal)}*\n¿Pueden confirmarlo?`;
    return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen text-white" style={{ background: "linear-gradient(160deg, #06060f 0%, #0c0c1c 40%, #080814 100%)" }}>

      {/* Subtle dot-grid texture overlay */}
      <div
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.018]"
        style={{
          backgroundImage: `radial-gradient(circle, #ffffff 1px, transparent 1px)`,
          backgroundSize: "28px 28px",
        }}
      />

      {/* ── Header ── */}
      <header className="sticky top-0 z-50" style={{ background: "rgba(6,6,15,0.88)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        {/* Top row */}
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          {/* Logo + name */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <img
              src={logoUrl}
              alt={businessName}
              className="h-9 w-auto max-w-[100px] object-contain shrink-0 rounded-[8px]"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <div className="min-w-0">
              <h1
                className="font-black text-sm sm:text-[15px] tracking-wide leading-none truncate"
                style={{ color: primaryColor }}
              >
                {businessName}
              </h1>
              <p className="text-[10px] text-white/30 mt-0.5 font-medium">
                {filtered.length} productos
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setSearchOpen(!searchOpen)}
              className={`w-9 h-9 rounded-[8px] flex items-center justify-center transition-all ${searchOpen ? "bg-white/10 text-white" : "text-white/40 hover:bg-white/[0.06] hover:text-white/70"}`}
            >
              {searchOpen ? <X className="w-4 h-4" /> : <Search className="w-4 h-4" />}
            </button>
            <button
              onClick={handleShare}
              className="w-9 h-9 rounded-[8px] flex items-center justify-center text-white/40 hover:bg-white/[0.06] hover:text-white/70 transition-all"
            >
              <Share2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search input (expandable) */}
        <div className={`overflow-hidden transition-all duration-250 ${searchOpen ? "max-h-14 pb-2.5" : "max-h-0"}`}>
          <div className="px-4 max-w-7xl mx-auto">
            <input
              type="text"
              placeholder="Buscar producto o marca…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus={searchOpen}
              className="w-full bg-white/[0.05] border border-white/[0.08] rounded-[9px] px-4 py-2.5 text-[13px] text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-all"
            />
          </div>
        </div>

        {/* Category + gender filters */}
        <div className="max-w-7xl mx-auto px-4 pb-3 space-y-2">
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
            {[{ value: "all", label: "Todos", count: products.length }, ...categories].map((cat) => {
              const active = filterCat === cat.value;
              return (
                <button
                  key={cat.value}
                  onClick={() => { setFilterCat(cat.value === filterCat ? "all" : cat.value); if (cat.value !== filterCat) setFilterGender("all"); }}
                  className={`shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-[6px] font-semibold text-[11px] transition-all ${active ? "text-black" : "bg-white/[0.04] text-white/45 hover:bg-white/[0.07] border border-white/[0.06]"}`}
                  style={active ? { background: accentColor, boxShadow: `0 3px 12px ${accentColor}45` } : {}}
                >
                  {cat.label}
                  <span className={`text-[9px] font-bold px-1 py-0.5 rounded-[3px] ${active ? "bg-black/20 text-black/70" : "bg-white/[0.06] text-white/30"}`}>
                    {cat.count}
                  </span>
                </button>
              );
            })}
          </div>

          {(isPerfumeCategory || (filterCat === "all" && hasPerfumes)) && (
            <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
              {["all", "masculino", "femenino", "unisex"].map((g) => {
                const active = filterGender === g;
                return (
                  <button
                    key={g}
                    onClick={() => setFilterGender(filterGender === g ? "all" : g)}
                    className={`shrink-0 px-3 py-1 rounded-[5px] text-[10px] font-semibold transition-all ${active ? "bg-white/[0.12] text-white border border-white/[0.18]" : "bg-white/[0.03] text-white/35 hover:bg-white/[0.06] border border-white/[0.04]"}`}
                  >
                    {g === "all" ? "Todos" : `${GENDER_LABELS[g]?.icon} ${GENDER_LABELS[g]?.label}`}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-3 sm:px-5 py-5 sm:py-8 space-y-10">

        {/* ── Hero ── */}
        {showAllView && (
          <div
            className="relative rounded-[16px] overflow-hidden p-6 sm:p-10"
            style={{
              background: `linear-gradient(135deg, ${primaryColor}18 0%, ${primaryColor}06 50%, transparent 100%)`,
              border: `1px solid ${primaryColor}22`,
            }}
          >
            {/* Decorative blobs */}
            <div className="absolute -right-20 -top-20 w-72 h-72 rounded-full opacity-[0.08] blur-3xl pointer-events-none" style={{ background: primaryColor }} />
            <div className="absolute -left-10 -bottom-10 w-48 h-48 rounded-full opacity-[0.05] blur-2xl pointer-events-none" style={{ background: primaryColor }} />
            <div className="absolute right-1/4 top-1/2 -translate-y-1/2 w-px h-3/4 opacity-10 pointer-events-none" style={{ background: `linear-gradient(to bottom, transparent, ${primaryColor}, transparent)` }} />

            <div className="relative z-10 max-w-xl">
              <div
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold mb-4"
                style={{ background: `${primaryColor}18`, color: primaryColor, border: `1px solid ${primaryColor}30` }}
              >
                <Sparkles className="w-3 h-3" />
                Catálogo oficial
              </div>

              <h2 className="text-3xl sm:text-5xl font-black leading-[1.05] tracking-tight mb-3">
                {heroConfig.headline}
                <span className="ml-2 text-2xl sm:text-4xl">{heroConfig.emoji}</span>
              </h2>
              <p className="text-sm sm:text-base text-white/45 font-medium mb-6 leading-relaxed">{heroConfig.sub}</p>

              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={() => setFilterCat(heroConfig.cat)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-[10px] font-bold text-sm text-black transition-all hover:scale-[1.03] active:scale-[0.97]"
                  style={{ background: accentColor, boxShadow: `0 6px 24px ${accentColor}50` }}
                >
                  {heroConfig.cta}
                  <ChevronRight className="w-4 h-4" />
                </button>
                {whatsappNumber && (
                  <a
                    href={buildWhatsAppUrl()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-[10px] font-semibold text-sm text-white/60 border border-white/10 hover:bg-white/[0.04] transition-all"
                  >
                    <MessageCircle className="w-4 h-4" />
                    Consultar
                  </a>
                )}
              </div>

              {/* Stats bar */}
              <div className="flex items-center gap-5 mt-7 flex-wrap">
                <div>
                  <p className="text-2xl font-black font-mono tracking-tight" style={{ color: primaryColor }}>{products.length}</p>
                  <p className="text-[9px] text-white/30 uppercase tracking-widest">productos</p>
                </div>
                {categories.length > 1 && (
                  <div>
                    <p className="text-2xl font-black font-mono tracking-tight" style={{ color: primaryColor }}>{categories.length}</p>
                    <p className="text-[9px] text-white/30 uppercase tracking-widest">categorías</p>
                  </div>
                )}
                {ofertasEspeciales.length > 0 && (
                  <div>
                    <p className="text-2xl font-black font-mono tracking-tight text-rose-400">{ofertasEspeciales.length}</p>
                    <p className="text-[9px] text-white/30 uppercase tracking-widest">en oferta</p>
                  </div>
                )}
                {whatsappNumber && (
                  <div>
                    <p className="text-2xl font-black font-mono tracking-tight text-emerald-400">✓</p>
                    <p className="text-[9px] text-white/30 uppercase tracking-widest">WhatsApp</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Ofertas Especiales ── */}
        {ofertasEspeciales.length > 0 && showAllView && (
          <section>
            <SectionHeader
              icon={<Tag className="w-4 h-4" />}
              label="Ofertas Especiales"
              color="#f87171"
              count={ofertasEspeciales.length}
              action={
                <span className="px-2 py-1 rounded-[4px] text-[9px] font-black uppercase tracking-widest bg-rose-500/15 text-rose-400 border border-rose-500/20">
                  DESCUENTOS
                </span>
              }
            />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {ofertasEspeciales.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  primaryColor={primaryColor}
                  cuotas={cuotasOfrecidas}
                  onClick={() => setDetailProduct(p)}
                  badge={`-${Math.round((1 - Number(p.discount_price_ars) / Number(p.sale_price_ars)) * 100)}% OFF`}
                  settings={settings}
                  fullSettings={fullSettings}
                  onAddToCart={whatsappNumber ? addToCart : undefined}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Destacados ── */}
        {featuredProducts.length > 0 && (
          <section>
            <SectionHeader
              icon={<Star className="w-4 h-4" fill={primaryColor} />}
              label="Destacados"
              color={primaryColor}
              count={featuredProducts.length}
            />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {featuredProducts.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  primaryColor={primaryColor}
                  cuotas={cuotasOfrecidas}
                  onClick={() => setDetailProduct(p)}
                  featured
                  settings={settings}
                  fullSettings={fullSettings}
                  onAddToCart={whatsappNumber ? addToCart : undefined}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Más Vendidos ── */}
        {showAllView && topSellers.length > 0 && (
          <section>
            <SectionHeader
              icon={<Flame className="w-4 h-4" />}
              label="Más Vendidos"
              color="#fb923c"
              count={topSellers.length}
            />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {topSellers.slice(0, 4).map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  primaryColor={primaryColor}
                  cuotas={cuotasOfrecidas}
                  onClick={() => setDetailProduct(p)}
                  badge="Más vendido"
                  settings={settings}
                  fullSettings={fullSettings}
                  onAddToCart={whatsappNumber ? addToCart : undefined}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Novedades ── */}
        {showAllView && novedades.length > 0 && (
          <section>
            <SectionHeader
              icon={<Zap className="w-4 h-4" />}
              label="Novedades"
              color="#60a5fa"
              count={novedades.length}
            />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {novedades.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  primaryColor={primaryColor}
                  cuotas={cuotasOfrecidas}
                  onClick={() => setDetailProduct(p)}
                  compact
                  settings={settings}
                  fullSettings={fullSettings}
                  onAddToCart={whatsappNumber ? addToCart : undefined}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Cross-sell: vapers → perfumes ── */}
        {filterCat === "vaper" && perfumes.length > 0 && (
          <section
            className="rounded-[14px] p-4 sm:p-6"
            style={{ background: `linear-gradient(135deg, ${primaryColor}10, transparent)`, border: `1px solid ${primaryColor}15` }}
          >
            <SectionHeader
              icon={<Zap className="w-4 h-4" />}
              label="Si te gusta oler bien, esto es para vos"
              color={primaryColor}
            />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {perfumes.slice(0, 4).map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  primaryColor={primaryColor}
                  cuotas={cuotasOfrecidas}
                  onClick={() => setDetailProduct(p)}
                  compact
                  settings={settings}
                  fullSettings={fullSettings}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Main product grid ── */}
        {!filtered.length ? (
          <div className="text-center py-24">
            <div className="w-20 h-20 bg-white/[0.03] rounded-[14px] flex items-center justify-center mx-auto mb-4 border border-white/[0.06]">
              <Package className="w-9 h-9 text-white/10" />
            </div>
            <p className="text-white/25 text-sm font-medium">No se encontraron productos</p>
            {search && (
              <button onClick={() => setSearch("")} className="mt-3 text-xs underline underline-offset-2 text-white/30 hover:text-white/50 transition-colors">
                Limpiar búsqueda
              </button>
            )}
          </div>
        ) : (
          <>
            {(featuredProducts.length > 0 || topSellers.length > 0) && regularProducts.length > 0 && showAllView && (
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-white/[0.05]" />
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/20">Todos los productos</span>
                <div className="h-px flex-1 bg-white/[0.05]" />
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
              {(showAllView && (featuredProducts.length > 0 || topSellers.length > 0) ? regularProducts : filtered).map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  primaryColor={primaryColor}
                  cuotas={cuotasOfrecidas}
                  onClick={() => setDetailProduct(p)}
                  settings={settings}
                  fullSettings={fullSettings}
                  onAddToCart={whatsappNumber ? addToCart : undefined}
                />
              ))}
            </div>
          </>
        )}

        {/* ── Wholesale ── */}
        {fullSettings && Number(fullSettings.volume_discount_threshold) > 0 && Number(fullSettings.volume_discount_percent) > 0 && (
          <section>
            <div
              className="rounded-[14px] p-5 sm:p-8"
              style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.09), rgba(139,92,246,0.03))", border: "1px solid rgba(139,92,246,0.18)" }}
            >
              <SectionHeader
                icon={<Users className="w-4 h-4" />}
                label="Precios Mayoristas"
                color="#a78bfa"
              />
              <p className="text-sm text-white/45 mb-5 leading-relaxed">
                Llevá <span className="font-bold text-violet-300">{fullSettings.volume_discount_threshold}+ unidades</span> y obtené{" "}
                <span className="font-bold text-violet-300">{fullSettings.volume_discount_percent}% OFF</span> sobre el precio de contado
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {products.filter((pr) => Number(pr.discount_price_ars || pr.sale_price_ars) > 0).slice(0, 9).map((pr) => {
                  const base = Number(pr.discount_price_ars || pr.sale_price_ars);
                  const wholesale = Math.round(base * (1 - Number(fullSettings.volume_discount_percent) / 100));
                  return (
                    <div key={pr.id} className="flex items-center gap-3 p-3 rounded-[9px] bg-white/[0.03] border border-white/[0.06]">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-white/75 truncate">{pr.name}</p>
                        <div className="flex items-baseline gap-2 mt-0.5">
                          <span className="text-[10px] text-white/30 line-through">{fmtARS(base)}</span>
                          <span className="text-sm font-black text-violet-300">{fmtARS(wholesale)}</span>
                        </div>
                        <p className="text-[9px] font-semibold text-emerald-400 mt-0.5">Ahorrás {fmtARS(base - wholesale)}/u</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              {whatsappNumber && (
                <a
                  href={`https://wa.me/${whatsappNumber.replace(/[^0-9]/g, "")}?text=${encodeURIComponent("Hola! Me interesa consultar precios mayoristas 📦")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-[10px] text-white font-bold text-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
                  style={{ background: "linear-gradient(135deg,#25D366,#128C7E)", boxShadow: "0 6px 20px rgba(37,211,102,0.28)" }}
                >
                  <MessageCircle className="w-5 h-5" fill="white" />
                  Consultar por mayor
                </a>
              )}
            </div>
          </section>
        )}
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-white/[0.04] mt-8 pb-28">
        <div className="max-w-7xl mx-auto px-4 py-8 text-center">
          <div className="flex items-center justify-center gap-2.5 mb-3">
            <img
              src={logoUrl}
              alt={businessName}
              className="w-7 h-7 rounded-[7px] object-cover border border-white/10"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <span className="text-sm font-black tracking-wide" style={{ color: primaryColor }}>{businessName}</span>
          </div>
          <p className="text-[10px] text-white/20">Precios sujetos a cambios · Stock al momento de consulta</p>
        </div>
      </footer>

      {/* ── Product Detail Modal ── */}
      <Dialog open={!!detailProduct} onOpenChange={(open) => { if (!open) setDetailProduct(null); }}>
        <DialogContent className="p-0 border-0 bg-transparent shadow-none max-w-lg sm:max-w-xl max-h-[92vh] overflow-y-auto [&>button]:hidden">
          <DialogTitle className="sr-only">
            {detailProduct?.name ?? "Detalle del producto"}
          </DialogTitle>
          {detailProduct && (
            <ProductDetailModal
              product={detailProduct}
              cuotas={cuotasOfrecidas}
              primaryColor={primaryColor}
              whatsappNumber={whatsappNumber}
              buildWhatsAppUrl={buildWhatsAppUrl}
              catalogUrl={window.location.href}
              onClose={() => setDetailProduct(null)}
              settings={settings}
              fullSettings={fullSettings}
              onAddToCart={
                whatsappNumber
                  ? (product, size) => { addToCart(product, size); setDetailProduct(null); }
                  : undefined
              }
            />
          )}
        </DialogContent>
      </Dialog>

      {/* ── FABs (non-overlapping) ── */}
      {/* WhatsApp: bottom-right */}
      {whatsappNumber && (
        <a
          href={buildWhatsAppUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className="fixed bottom-5 right-4 z-40 flex items-center gap-2 px-4 py-3 rounded-full text-white font-bold text-sm shadow-2xl hover:scale-105 active:scale-95 transition-all duration-200"
          style={{ background: "linear-gradient(135deg,#25D366,#128C7E)", boxShadow: "0 6px 24px rgba(37,211,102,0.45)" }}
        >
          <MessageCircle className="w-5 h-5" fill="white" />
          <span className="hidden sm:inline">Consultar</span>
        </a>
      )}

      {/* Cart: bottom-left */}
      {whatsappNumber && cartCount > 0 && (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed bottom-5 left-4 z-40 flex items-center gap-2 px-4 py-3 rounded-full font-bold text-sm shadow-2xl transition-all active:scale-95 hover:scale-105"
          style={{ background: primaryColor, color: "#000", boxShadow: `0 6px 24px ${primaryColor}55` }}
        >
          <ShoppingCart className="w-5 h-5" />
          <span className="font-black">{cartCount}</span>
          <span className="hidden sm:inline">· {fmtARS(cartTotal)}</span>
        </button>
      )}

      {/* ── Cart Slide Panel ── */}
      {cartOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/65 backdrop-blur-sm" onClick={() => setCartOpen(false)} />
          <div
            className="w-full max-w-sm flex flex-col h-full overflow-hidden"
            style={{ background: "#0a0a18", borderLeft: "1px solid rgba(255,255,255,0.07)" }}
          >
            <div className="flex items-center justify-between px-4 py-4 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-4 h-4" style={{ color: primaryColor }} />
                <span className="font-bold text-sm">Tu carrito</span>
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black" style={{ background: `${primaryColor}20`, color: primaryColor }}>
                  {cartCount}
                </span>
              </div>
              <button onClick={() => setCartOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-[7px] hover:bg-white/[0.06] transition-colors">
                <X className="w-4 h-4 text-white/50" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
              {cart.map((item) => (
                <div key={item.id} className="flex items-center gap-3 bg-white/[0.03] border border-white/[0.06] rounded-[10px] p-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold truncate">{item.name}</p>
                    <p className="text-[11px] text-white/35 mt-0.5">{fmtARS(item.price)} c/u</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setCart((prev) => prev.map((i) => i.id === item.id ? { ...i, qty: Math.max(1, i.qty - 1) } : i))}
                      className="w-7 h-7 rounded-[6px] bg-white/[0.07] hover:bg-white/[0.12] flex items-center justify-center"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="text-sm font-bold w-5 text-center">{item.qty}</span>
                    <button
                      onClick={() => setCart((prev) => prev.map((i) => i.id === item.id ? { ...i, qty: i.qty + 1 } : i))}
                      className="w-7 h-7 rounded-[6px] bg-white/[0.07] hover:bg-white/[0.12] flex items-center justify-center"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setCart((prev) => prev.filter((i) => i.id !== item.id))}
                      className="w-7 h-7 rounded-[6px] hover:bg-rose-500/20 flex items-center justify-center ml-1"
                    >
                      <Trash2 className="w-3 h-3 text-rose-400" />
                    </button>
                  </div>
                  <p className="text-[13px] font-black shrink-0" style={{ color: primaryColor }}>{fmtARS(item.price * item.qty)}</p>
                </div>
              ))}
            </div>

            <div className="border-t border-white/[0.06] px-4 py-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-white/50 font-semibold">Total</span>
                <span className="text-lg font-black" style={{ color: primaryColor }}>{fmtARS(cartTotal)}</span>
              </div>
              <a
                href={buildCartWhatsAppUrl()}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setCartOpen(false)}
                className="flex items-center justify-center gap-2 w-full py-3.5 rounded-[11px] text-sm font-bold text-white transition-all active:scale-[0.98]"
                style={{ background: "linear-gradient(135deg,#25D366,#128C7E)", boxShadow: "0 4px 16px rgba(37,211,102,0.32)" }}
              >
                <MessageCircle className="w-5 h-5" fill="white" />
                Pedir por WhatsApp 🛍️
              </a>
              <button
                onClick={() => { setCart([]); setCartOpen(false); }}
                className="w-full text-[11px] text-white/25 hover:text-white/45 transition-colors py-1"
              >
                Vaciar carrito
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ProductCard ──────────────────────────────────────────────────────────────

function ProductCard({
  product: p,
  primaryColor,
  onClick,
  featured,
  badge,
  compact,
  settings,
  fullSettings,
  onAddToCart,
  cuotas = [],
}: {
  product: any;
  /** Las que el comercio ofrece de verdad. Vacío = no se muestra ninguna. */
  cuotas?: CuotaOfrecida[];
  primaryColor: string;
  onClick: () => void;
  featured?: boolean;
  badge?: string;
  compact?: boolean;
  settings?: any;
  fullSettings?: any;
  onAddToCart?: (product: any) => void;
}) {
  const hasDiscount = p.discount_price_ars && p.discount_price_ars < p.sale_price_ars;
  const discountPct = hasDiscount ? Math.round((1 - p.discount_price_ars / p.sale_price_ars) * 100) : 0;
  const savings = hasDiscount ? Number(p.sale_price_ars) - Number(p.discount_price_ars) : 0;
  const isPerfume = p.category === "perfume_arabe" || p.category === "perfume_diseñador";
  const genderInfo = GENDER_LABELS[p.gender];
  const hasCountdown = p.offer_expires_at && new Date(p.offer_expires_at) > new Date();
  const viewers = pseudoRandom(p.id || p.name, 2, 8);
  const volThreshold = Number(fullSettings?.volume_discount_threshold || 0);
  const volPercent = Number(fullSettings?.volume_discount_percent || 0);
  const displayPrice = Number(p.discount_price_ars || p.sale_price_ars);

  return (
    <div
      className={`group relative flex flex-col rounded-[14px] overflow-hidden cursor-pointer transition-all duration-300 hover:-translate-y-0.5 ${
        featured
          ? "border border-white/[0.12]"
          : "border border-white/[0.07] hover:border-white/[0.13]"
      }`}
      style={{
        background: featured
          ? `linear-gradient(160deg, ${primaryColor}0a, rgba(255,255,255,0.015))`
          : "rgba(255,255,255,0.018)",
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = `0 8px 32px -4px ${primaryColor}28`; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.boxShadow = "none"; }}
      onClick={onClick}
    >
      {/* Image */}
      <div className={`relative overflow-hidden ${compact ? "aspect-square" : "aspect-[3/4]"} bg-white/[0.02]`}>
        {p.image_url ? (
          <img
            src={p.image_url}
            alt={p.name}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-700 ease-out"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package className="w-8 h-8 text-white/[0.07]" />
          </div>
        )}

        {/* Bottom gradient for brand name */}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/80 to-transparent" />
        <p className="absolute bottom-2 left-2.5 text-[9px] font-bold tracking-wider uppercase text-white/60">{p.brand}</p>

        {/* Top badges */}
        <div className="absolute top-2 left-2 right-2 flex items-start justify-between">
          <div className="flex flex-col gap-1">
            {badge && (
              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-orange-500/30 text-orange-300 border border-orange-500/30 backdrop-blur-md flex items-center gap-0.5">
                <Flame className="w-2.5 h-2.5" />{badge}
              </span>
            )}
            {featured && !badge && (
              <span
                className="px-2 py-0.5 rounded-full text-[9px] font-bold backdrop-blur-md flex items-center gap-0.5"
                style={{ background: `${primaryColor}28`, color: primaryColor, border: `1px solid ${primaryColor}35` }}
              >
                <Star className="w-2.5 h-2.5" fill={primaryColor} />Destacado
              </span>
            )}
            {hasDiscount && (
              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold text-white bg-rose-600/80 backdrop-blur-md flex items-center gap-0.5">
                <Tag className="w-2.5 h-2.5" />-{discountPct}%
              </span>
            )}
            {hasCountdown && <CountdownTimer expiresAt={p.offer_expires_at} primaryColor={primaryColor} />}
          </div>
          {isPerfume && genderInfo && !compact && (
            <span
              className="px-2 py-0.5 rounded-full text-[9px] font-semibold backdrop-blur-md border border-white/10 text-nowrap"
              style={{
                background: p.gender === "masculino" ? "rgba(59,130,246,0.22)" : p.gender === "femenino" ? "rgba(236,72,153,0.22)" : "rgba(168,85,247,0.22)",
                color: p.gender === "masculino" ? "#93bbfd" : p.gender === "femenino" ? "#f9a8d4" : "#d8b4fe",
              }}
            >
              {genderInfo.icon}
            </span>
          )}
        </div>
      </div>

      {/* Card body */}
      <div className="flex flex-col flex-1 p-2.5 sm:p-3">
        <h3 className="font-bold text-[11px] sm:text-[12px] text-white/90 leading-snug line-clamp-2 mb-1.5">
          {p.name}
        </h3>

        {/* Price */}
        <div className="mt-auto">
          {hasDiscount ? (
            <div className="space-y-0.5">
              <p
                className="text-[13px] sm:text-[15px] font-black tracking-tight"
                style={{ color: primaryColor }}
              >
                {fmtARS(Number(p.discount_price_ars))}
              </p>
              <p className="text-[10px] text-white/35 line-through decoration-rose-500/50">
                {fmtARS(Number(p.sale_price_ars))}
              </p>
              {!compact && (
                <p className="text-[9px] font-bold text-emerald-400">
                  Ahorrás {fmtARS(savings)}
                </p>
              )}
            </div>
          ) : (
            <p
              className="text-[13px] sm:text-[15px] font-black tracking-tight"
              style={{ color: primaryColor }}
            >
              {fmtARS(Number(p.sale_price_ars))}
            </p>
          )}

          {/* Vaper hint */}
          {p.category === "vaper" && !compact && (
            <p className="text-[9px] font-semibold mt-1.5 flex items-center gap-1" style={{ color: `${primaryColor}99` }}>
              <Zap className="w-2.5 h-2.5" />Ver sabores
            </p>
          )}

          {/* Scarcity / social proof */}
          {!compact && (
            <div className="mt-1.5 space-y-0.5">
              {p.stock <= 5 && (
                <p className="text-[9px] font-semibold flex items-center gap-1" style={{ color: p.stock <= 3 ? "#fbbf24" : "#737373" }}>
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.stock <= 3 ? "bg-amber-400 animate-pulse" : "bg-white/25"}`} />
                  {p.stock <= 3 ? `¡Últimas ${p.stock}!` : "Quedan pocas"}
                </p>
              )}
              {volThreshold > 0 && volPercent > 0 && (
                <p className="text-[9px] font-semibold text-violet-400 flex items-center gap-0.5">
                  <Users className="w-2.5 h-2.5" />{volThreshold}+ = -{volPercent}% OFF
                </p>
              )}
              <p className="text-[9px] text-white/20 flex items-center gap-0.5">
                <Eye className="w-2.5 h-2.5" />{viewers} viendo
              </p>
            </div>
          )}
        </div>

        {/* Add to cart */}
        {onAddToCart && !compact && (
          <button
            onClick={(e) => { e.stopPropagation(); onAddToCart(p); }}
            className="mt-2.5 w-full flex items-center justify-center gap-1.5 py-2 rounded-[8px] text-[11px] font-bold transition-all active:scale-95 hover:brightness-110"
            style={{ background: `${primaryColor}22`, color: primaryColor, border: `1px solid ${primaryColor}30` }}
          >
            <Plus className="w-3 h-3" />Agregar
          </button>
        )}
      </div>
    </div>
  );
}

// ─── ProductDetailModal ───────────────────────────────────────────────────────

function ProductDetailModal({
  product: p,
  primaryColor,
  whatsappNumber,
  buildWhatsAppUrl,
  catalogUrl,
  onClose,
  settings,
  fullSettings,
  onAddToCart,
  cuotas = [],
}: {
  product: any;
  /** Las que el comercio ofrece de verdad. Vacío = no se muestra ninguna. */
  cuotas?: CuotaOfrecida[];
  primaryColor: string;
  whatsappNumber: string | null;
  buildWhatsAppUrl: (p?: any, size?: string) => string;
  catalogUrl: string;
  onClose: () => void;
  settings: any;
  fullSettings?: any;
  onAddToCart?: (product: any, size?: string) => void;
}) {
  const [selectedSize, setSelectedSize] = useState<string>("full");
  const isVaper = p.category === "vaper";
  const [variants, setVariants] = useState<{ id: string; variant_name: string; stock: number; image_url?: string | null }[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [selectedFlavor, setSelectedFlavor] = useState<string | null>(null);

  useEffect(() => {
    if (!isVaper) return;
    setVariantsLoading(true);
    fetchCatalogVariants(p.id)
      .then(rows => { setVariants(rows || []); setVariantsLoading(false); });
  }, [p.id, isVaper]);

  const hasDiscount = p.discount_price_ars && p.discount_price_ars < p.sale_price_ars;
  const discountPct = hasDiscount ? Math.round((1 - p.discount_price_ars / p.sale_price_ars) * 100) : 0;
  const savings = hasDiscount ? Number(p.sale_price_ars) - Number(p.discount_price_ars) : 0;
  const isPerfume = p.category === "perfume_arabe" || p.category === "perfume_diseñador";
  const genderInfo = GENDER_LABELS[p.gender];
  // ⚠️ Acá se dividía por 3 fijo. El monto de la cuota depende de cuántas
  // ofrece el comercio, y eso lo dice la configuración, no el código.
  const textoCuota = textoDeCuotas(cuotas, Number(p.sale_price_ars), fmtARS);
  const hasCountdown = p.offer_expires_at && new Date(p.offer_expires_at) > new Date();
  const contentMl = Number(p.content_ml || 100);
  const viewers = pseudoRandom(p.id || p.name, 3, 12);
  // Los precios de decant llegan ya calculados desde `catalog_products`.
  // Antes se calculaban acá, lo que obligaba a bajar al navegador el costo del
  // producto y los márgenes de fraccionado — o sea, publicarlos.
  const decantSizes = isPerfume
    ? [
        { value: "full", label: `${contentMl}ml`, sublabel: "Completo", price: Number(p.discount_price_ars || p.sale_price_ars) },
        { value: "10",  label: "10ml",  sublabel: "Decant", price: Number(p.decant_price_10ml || 0) },
        { value: "5",   label: "5ml",   sublabel: "Decant", price: Number(p.decant_price_5ml || 0) },
        { value: "2.5", label: "2.5ml", sublabel: "Decant", price: Number(p.decant_price_2_5ml || 0) },
      ].filter(s => s.value === "full" || s.price > 0)
    : [];

  const currentPrice =
    selectedSize === "full"
      ? Number(p.discount_price_ars || p.sale_price_ars)
      : decantSizes.find((s) => s.value === selectedSize)?.price || Number(p.discount_price_ars || p.sale_price_ars);

  const handleShareProduct = async () => {
    const sizeLabel = selectedSize !== "full" ? ` (${selectedSize}ml)` : "";
    const text = `${p.name}${sizeLabel} — ${fmtARS(currentPrice)} 🛍️\n${catalogUrl}`;
    if (navigator.share) { try { await navigator.share({ title: p.name, text }); } catch { return; } }
    else { await navigator.clipboard.writeText(text); }
  };

  const waUrl = (() => {
    if (!whatsappNumber) return "";
    const num = whatsappNumber.replace(/[^0-9]/g, "");
    let msg = `Hola! Me interesa: *${p.name}*`;
    if (isVaper && selectedFlavor) msg += ` — sabor *${selectedFlavor}*`;
    if (!isVaper && selectedSize !== "full") msg += ` (${selectedSize}ml)`;
    msg += ` — ${fmtARS(currentPrice)} 🛍️`;
    return `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
  })();

  return (
    <div
      className="relative rounded-[16px] overflow-hidden text-white"
      style={{
        background: "linear-gradient(160deg, #111126 0%, #0a0a18 100%)",
        border: "1px solid rgba(255,255,255,0.09)",
        boxShadow: "0 32px 80px -8px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04) inset",
      }}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-3 right-3 z-20 w-8 h-8 flex items-center justify-center rounded-full bg-black/60 backdrop-blur-sm hover:bg-black/80 transition-colors"
      >
        <X className="w-4 h-4 text-white/70" />
      </button>

      {/* Image */}
      <div className="relative bg-black/20 overflow-hidden" style={{ maxHeight: "45vh", minHeight: "200px" }}>
        {p.image_url ? (
          <img
            src={p.image_url}
            alt={p.name}
            className="w-full h-full object-contain"
            style={{ maxHeight: "45vh", width: "100%", display: "block" }}
          />
        ) : (
          <div className="flex items-center justify-center" style={{ height: "200px" }}>
            <Package className="w-16 h-16 text-white/[0.05]" />
          </div>
        )}

        {/* Bottom gradient */}
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#111126] to-transparent pointer-events-none" />

        {/* Badges */}
        <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
          {p.featured && (
            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold backdrop-blur-md flex items-center gap-1" style={{ background: `${primaryColor}28`, color: primaryColor }}>
              <Star className="w-3 h-3" fill={primaryColor} />Destacado
            </span>
          )}
          {hasDiscount && (
            <span className="px-2.5 py-1 rounded-full text-[10px] font-bold text-white bg-rose-600/80 backdrop-blur-md">
              -{discountPct}% OFF
            </span>
          )}
          {hasCountdown && <CountdownTimer expiresAt={p.offer_expires_at} primaryColor={primaryColor} />}
          {isPerfume && genderInfo && (
            <span
              className="px-2.5 py-1 rounded-full text-[10px] font-semibold backdrop-blur-md border border-white/10"
              style={{
                background: p.gender === "masculino" ? "rgba(59,130,246,0.28)" : p.gender === "femenino" ? "rgba(236,72,153,0.28)" : "rgba(168,85,247,0.28)",
                color: p.gender === "masculino" ? "#93bbfd" : p.gender === "femenino" ? "#f9a8d4" : "#d8b4fe",
              }}
            >
              {genderInfo.icon} {genderInfo.label}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-5 space-y-4">
        {/* Name + brand */}
        <div>
          <p className="text-[10px] font-bold tracking-widest uppercase mb-1" style={{ color: `${primaryColor}70` }}>{p.brand}</p>
          <h2 className="text-lg sm:text-xl font-black leading-tight">{p.name}</h2>
          <p className="text-[11px] text-white/30 mt-0.5">{nombreDeCategoria(p.category)}</p>
        </div>

        {p.description && (
          <p className="text-[13px] text-white/45 leading-relaxed">{p.description}</p>
        )}

        {/* Vaper flavor grid */}
        {isVaper && (
          <div>
            <p className="text-[10px] font-bold text-white/35 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
              <Zap className="w-3 h-3" style={{ color: primaryColor }} />
              Sabores disponibles
              {variants.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-white/[0.06] text-white/40">
                  {variants.filter((v) => (v.stock ?? 0) > 0).length}/{variants.length}
                </span>
              )}
            </p>
            {variantsLoading ? (
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-8 w-20 rounded-xl bg-white/[0.04]" />)}
              </div>
            ) : variants.length === 0 ? (
              <p className="text-xs text-white/30 italic">Consultá sabores disponibles por WhatsApp</p>
            ) : (
              <div className="flex flex-wrap gap-1.5 max-h-52 overflow-y-auto pr-1">
                {variants.map((v) => {
                  const inStock = (v.stock ?? 0) > 0;
                  const scarce = inStock && v.stock <= 3;
                  const isSelected = selectedFlavor === v.variant_name;
                  const hasImg = !!v.image_url;
                  return (
                    <button
                      key={v.id}
                      disabled={!inStock}
                      onClick={() => setSelectedFlavor(isSelected ? null : v.variant_name)}
                      className={`flex items-center gap-1.5 transition-all border font-semibold rounded-[8px] ${
                        hasImg ? "flex-col p-1.5 text-[10px] w-[72px]" : "px-3 py-1.5 text-[11px]"
                      } ${
                        !inStock
                          ? "opacity-30 cursor-not-allowed bg-white/[0.02] border-white/[0.04] text-white/25 line-through"
                          : isSelected
                            ? "text-black border-transparent scale-105 shadow-lg"
                            : "bg-white/[0.05] border-white/[0.08] text-white/65 hover:bg-white/[0.10] hover:text-white"
                      }`}
                      style={isSelected ? { background: primaryColor, boxShadow: `0 4px 14px ${primaryColor}50` } : {}}
                    >
                      {hasImg && (
                        <img src={v.image_url!} alt={v.variant_name} className="w-full h-14 object-cover rounded-[6px] shrink-0" loading="lazy" />
                      )}
                      <span className={hasImg ? "text-center leading-tight truncate w-full text-[10px]" : ""}>{v.variant_name}</span>
                      {scarce && !isSelected && <span className="text-[9px] text-amber-400 font-bold">{hasImg ? `·${v.stock}` : ` ·${v.stock}`}</span>}
                    </button>
                  );
                })}
              </div>
            )}
            {selectedFlavor && (
              <p className="mt-2 text-[10px] font-semibold flex items-center gap-1.5" style={{ color: primaryColor }}>
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: primaryColor }} />
                Sabor: <span className="font-black">{selectedFlavor}</span>
              </p>
            )}
          </div>
        )}

        {/* Decant size selector */}
        {isPerfume && decantSizes.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-white/35 uppercase tracking-wider mb-2.5 flex items-center gap-1">
              <Droplets className="w-3 h-3" />Tamaño
            </p>
            <div className="flex gap-2 flex-wrap">
              {decantSizes.map((s) => (
                <button
                  key={s.value}
                  onClick={() => setSelectedSize(s.value)}
                  className={`flex flex-col items-center px-3.5 py-2 rounded-[9px] text-[11px] font-bold transition-all border ${
                    selectedSize === s.value
                      ? "text-black border-transparent scale-105 shadow-lg"
                      : "bg-white/[0.05] text-white/55 hover:bg-white/[0.09] border-white/[0.07]"
                  }`}
                  style={selectedSize === s.value ? { background: primaryColor, boxShadow: `0 4px 14px ${primaryColor}45` } : {}}
                >
                  <span className="font-black">{s.label}</span>
                  <span className={`text-[9px] font-medium ${selectedSize === s.value ? "text-black/60" : "text-white/30"}`}>{s.sublabel}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Price block */}
        <div
          className="rounded-[12px] p-4"
          style={{ background: `${primaryColor}0e`, border: `1px solid ${primaryColor}22` }}
        >
          {selectedSize !== "full" ? (
            <>
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: `${primaryColor}80` }}>
                Decant {selectedSize}ml
              </p>
              {currentPrice > 0 ? (
                <p className="text-2xl font-black tracking-tight" style={{ color: primaryColor }}>{fmtARS(currentPrice)}</p>
              ) : (
                <p className="text-sm text-white/35">Consultá el precio por WhatsApp</p>
              )}
            </>
          ) : hasDiscount ? (
            <>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider" style={{ background: `${primaryColor}25`, color: primaryColor }}>
                  Mejor precio
                </span>
                <span className="text-[10px] text-white/30 line-through">{fmtARS(Number(p.sale_price_ars))}</span>
              </div>
              <p className="text-2xl sm:text-3xl font-black tracking-tight" style={{ color: primaryColor }}>
                {fmtARS(Number(p.discount_price_ars))}
              </p>
              <div className="flex items-center gap-3 mt-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: `${primaryColor}75` }}>
                  Efectivo / Transferencia
                </p>
                <p className="text-[10px] font-bold text-emerald-400">Ahorrás {fmtARS(savings)}</p>
              </div>
              {/* ⚠️ Acá decía «3 cuotas» fijo, sin mirar lo que el comercio ofrece.
                  Prometía financiación a quien no la da, y subestimaba a quien
                  da más. Ahora sale de la configuración; si no hay ninguna que
                  aplique, no se muestra nada. */}
              {textoCuota && (
                <p className="text-[10px] text-white/25 mt-1">Tarjeta · {textoCuota}</p>
              )}
            </>
          ) : (
            <>
              <p className="text-2xl sm:text-3xl font-black tracking-tight" style={{ color: primaryColor }}>
                {fmtARS(Number(p.sale_price_ars))}
              </p>
              {textoCuota && (
                <p className="text-[10px] text-white/25 mt-1">{textoCuota}</p>
              )}
            </>
          )}
        </div>

        {/* Vaper 2X pack */}
        {isVaper && p.price_2x_ars && (
          <div
            className="rounded-[10px] p-3.5 flex items-center justify-between gap-3"
            style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <div>
              <p className="text-[10px] text-white/35 font-semibold uppercase tracking-wider">Pack 2 unidades</p>
              <p className="text-xl font-black mt-0.5" style={{ color: primaryColor }}>
                2× {fmtARS(Number(p.price_2x_ars))}
              </p>
              <p className="text-[9px] text-white/30 mt-0.5">
                {fmtARS(Math.round(Number(p.price_2x_ars) / 2))} c/u · ahorrás {fmtARS(Number(p.sale_price_ars) * 2 - Number(p.price_2x_ars))}
              </p>
            </div>
            <span className="shrink-0 px-2.5 py-1 rounded-[6px] text-[10px] font-black bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">PROMO</span>
          </div>
        )}

        {/* Social proof */}
        <div className="space-y-1.5">
          {p.stock <= 5 && (
            <p className="text-[11px] font-semibold flex items-center gap-1.5" style={{ color: p.stock <= 3 ? "#fbbf24" : "#737373" }}>
              <span className={`w-2 h-2 rounded-full shrink-0 ${p.stock <= 3 ? "bg-amber-400 animate-pulse" : "bg-white/25"}`} />
              {p.stock <= 3 ? `¡Últimas ${plural(p.stock, "unidad", "unidades")} disponibles!` : "Quedan pocas unidades"}
            </p>
          )}
          <p className="text-[10px] text-white/20 flex items-center gap-1">
            <Eye className="w-3 h-3" />{viewers} personas viendo este producto ahora
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 pt-1">
          {whatsappNumber && onAddToCart && (
            <button
              onClick={() => { onAddToCart(p, selectedSize !== "full" ? selectedSize : undefined); onClose(); }}
              className="flex items-center justify-center gap-1.5 px-4 py-3.5 rounded-[11px] font-bold text-sm transition-all active:scale-95 shrink-0"
              style={{ background: `${primaryColor}20`, color: primaryColor, border: `1px solid ${primaryColor}30` }}
            >
              <ShoppingCart className="w-4 h-4" />
            </button>
          )}
          {whatsappNumber && (
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-[11px] text-white font-bold text-sm transition-all hover:scale-[1.01] active:scale-[0.98]"
              style={{ background: "linear-gradient(135deg,#25D366,#128C7E)", boxShadow: "0 6px 20px rgba(37,211,102,0.3)" }}
            >
              <MessageCircle className="w-5 h-5" fill="white" />
              {isVaper
                ? selectedFlavor ? `Pedir: ${selectedFlavor}` : "Consultar"
                : selectedSize !== "full" ? `Decant ${selectedSize}ml` : "Consultar"}
            </a>
          )}
          <button
            onClick={handleShareProduct}
            className="flex items-center justify-center p-3.5 rounded-[11px] bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.07] transition-colors shrink-0"
            title="Compartir"
          >
            <Copy className="w-4 h-4 text-white/45" />
          </button>
        </div>
      </div>
    </div>
  );
}
