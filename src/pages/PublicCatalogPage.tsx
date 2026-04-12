import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { calculateDecantPrice, calculateWholesalePrice } from "@/lib/supabaseStore";
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
  Heart,
  Users,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

const CATEGORY_LABELS: Record<string, string> = {
  perfume_arabe: "Perfume Árabe",
  perfume_diseñador: "Perfume Diseñador",
  vaper: "Vaper",
  electronico: "Electrónico",
};

const GENDER_LABELS: Record<string, { icon: string; label: string }> = {
  masculino: { icon: "♂", label: "Masculino" },
  femenino: { icon: "♀", label: "Femenino" },
  unisex: { icon: "⚥", label: "Unisex" },
};

function fmtARS(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
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

function CountdownTimer({ expiresAt, primaryColor }: { expiresAt: string; primaryColor: string }) {
  const [timeLeft, setTimeLeft] = useState("");
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    const update = () => {
      const diff = new Date(expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        setExpired(true);
        setTimeLeft("");
        return;
      }
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
      className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold backdrop-blur-md animate-pulse"
      style={{ background: `${primaryColor}30`, color: primaryColor, border: `1px solid ${primaryColor}40` }}
    >
      <Clock className="w-2.5 h-2.5" />⏱ {timeLeft}
    </span>
  );
}

function ProductCardSkeleton() {
  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-2xl overflow-hidden">
      <Skeleton className="aspect-[4/5] bg-white/[0.04]" />
      <div className="p-3 space-y-2">
        <Skeleton className="h-3 w-3/4 bg-white/[0.06]" />
        <Skeleton className="h-2 w-1/2 bg-white/[0.04]" />
        <Skeleton className="h-8 w-full bg-white/[0.04] rounded-lg" />
      </div>
    </div>
  );
}

export default function PublicCatalogPage() {
  const { userId } = useParams<{ userId: string }>();
  const [products, setProducts] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [valid, setValid] = useState<boolean | null>(null);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [filterGender, setFilterGender] = useState("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailProduct, setDetailProduct] = useState<any>(null);

  const [fullSettings, setFullSettings] = useState<any>(null);

  const fetchData = useCallback(async () => {
    if (!userId) {
      setValid(false);
      return;
    }
    const [pRes, sRes, fsRes] = await Promise.all([
      supabase
        .from("products_public" as any)
        .select("*")
        .eq("user_id", userId)
        .gt("stock", 0)
        .order("category")
        .order("name"),
      supabase
        .from("settings_public" as any)
        .select("*")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("settings")
        .select("exchange_rate, customs_percent, volume_discount_threshold, volume_discount_percent, decant_margin_10ml, decant_margin_5ml, decant_margin_2_5ml")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
    if (!sRes.data) {
      setValid(false);
      return;
    }
    setProducts(pRes.data || []);
    setSettings(sRes.data);
    setFullSettings(fsRes.data || null);
    setValid(true);
  }, [userId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!userId || !valid) return;
    const channel = supabase
      .channel("public-catalog-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, () => fetchData())
      .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, () => fetchData())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, valid, fetchData]);

  useEffect(() => {
    if (settings?.business_name) document.title = `${settings.business_name} — Catálogo`;
  }, [settings]);

  const categories = useMemo(() => {
    const cats = [...new Set(products.map((p) => p.category))];
    return cats.map((c) => ({
      value: c,
      label: CATEGORY_LABELS[c] || c,
      count: products.filter((p) => p.category === c).length,
    }));
  }, [products]);

  const isPerfumeCategory = filterCat === "perfume_arabe" || filterCat === "perfume_diseñador";
  const hasPerfumes = products.some((p) => p.category === "perfume_arabe" || p.category === "perfume_diseñador");

  const filtered = useMemo(
    () =>
      products.filter((p) => {
        if (
          search &&
          !p.name.toLowerCase().includes(search.toLowerCase()) &&
          !p.brand?.toLowerCase().includes(search.toLowerCase())
        )
          return false;
        if (filterCat !== "all" && p.category !== filterCat) return false;
        if (filterGender !== "all" && p.gender !== filterGender) return false;
        return true;
      }),
    [products, search, filterCat, filterGender],
  );

  const featuredProducts = useMemo(() => {
    return filtered.filter((p) => p.featured && (!p.offer_expires_at || new Date(p.offer_expires_at) > new Date()));
  }, [filtered]);

  const topSellers = useMemo(() => {
    return [...filtered]
      .filter((p) => Number(p.total_sold || 0) > 0)
      .sort((a, b) => Number(b.total_sold || 0) - Number(a.total_sold || 0))
      .slice(0, 8);
  }, [filtered]);

  const regularProducts = useMemo(() => {
    const featuredIds = new Set(featuredProducts.map((p) => p.id));
    return filtered.filter((p) => !featuredIds.has(p.id));
  }, [filtered, featuredProducts]);

  const perfumes = useMemo(
    () => filtered.filter((p) => p.category === "perfume_arabe" || p.category === "perfume_diseñador"),
    [filtered],
  );
  const vapers = useMemo(() => filtered.filter((p) => p.category === "vaper"), [filtered]);

  const primaryColor = settings?.primary_color || "#D4A843";
  const businessName = settings?.business_name || "EXENTRY IMPORTS";
  const logoUrl = settings?.logo_url;
  const whatsappNumber = settings?.whatsapp_number;

  if (valid === null)
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: "linear-gradient(145deg, #0a0a14 0%, #111127 50%, #0a0a14 100%)" }}
      >
        <div
          className="w-12 h-12 border-2 border-t-transparent rounded-full animate-spin"
          style={{ borderColor: `${primaryColor} transparent ${primaryColor} ${primaryColor}` }}
        />
      </div>
    );

  if (!valid)
    return (
      <div
        className="min-h-screen flex items-center justify-center text-white px-4"
        style={{ background: "linear-gradient(145deg, #0a0a14 0%, #111127 50%, #0a0a14 100%)" }}
      >
        <div className="text-center">
          <div className="w-20 h-20 bg-white/5 rounded-2xl flex items-center justify-center mx-auto mb-4 backdrop-blur-sm border border-white/10">
            <Package className="w-10 h-10 text-white/20" />
          </div>
          <h1 className="text-xl font-bold mb-2">Catálogo no encontrado</h1>
          <p className="text-white/40 text-sm">El enlace no es válido o el negocio no existe.</p>
        </div>
      </div>
    );

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${businessName} — Catálogo`,
          text: `${filtered.length} productos disponibles`,
          url,
        });
      } catch {}
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

  const showAllView = filterCat === "all" && !search;

  return (
    <div
      className="min-h-screen text-white"
      style={{ background: "linear-gradient(145deg, #0a0a14 0%, #111127 50%, #0a0a14 100%)" }}
    >
      {/* Sticky Header */}
      <header
        className="sticky top-0 z-50 backdrop-blur-2xl border-b border-white/[0.06] max-h-[45vh] overflow-hidden"
        style={{ background: "rgba(10,10,20,0.85)" }}
      >
        <div className="max-w-7xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={businessName}
                className="w-10 h-10 rounded-xl object-cover shrink-0 border border-white/10"
              />
            ) : (
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-sm font-black tracking-wider"
                style={{ background: `linear-gradient(135deg, ${primaryColor}, ${primaryColor}dd)`, color: "#0D0D1A" }}
              >
                {businessName.charAt(0)}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="font-black text-sm sm:text-base tracking-wide truncate" style={{ color: primaryColor }}>
                {businessName}
              </h1>
              <p className="text-[10px] sm:text-xs text-white/35 font-medium">
                {filtered.length} productos disponibles
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setSearchOpen(!searchOpen)}
              className={`p-2.5 rounded-xl transition-all ${searchOpen ? "bg-white/10" : "hover:bg-white/5"}`}
            >
              {searchOpen ? <X className="w-4 h-4 text-white/70" /> : <Search className="w-4 h-4 text-white/50" />}
            </button>
            <button onClick={handleShare} className="p-2.5 rounded-xl hover:bg-white/5 transition-colors">
              <Share2 className="w-4 h-4 text-white/50" />
            </button>
          </div>
        </div>

        <div className={`overflow-hidden transition-all duration-300 ${searchOpen ? "max-h-16 pb-3" : "max-h-0"}`}>
          <div className="px-4 max-w-7xl mx-auto">
            <input
              type="text"
              placeholder="Buscar producto o marca..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus={searchOpen}
              className="w-full bg-white/[0.06] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-2 focus:border-transparent transition-all"
              style={{ ["--tw-ring-color" as any]: `${primaryColor}66` }}
            />
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 pb-3 space-y-2">
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
            <button
              onClick={() => {
                setFilterCat("all");
                setFilterGender("all");
              }}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-[11px] font-semibold transition-all ${filterCat === "all" ? "text-black shadow-lg" : "bg-white/[0.04] text-white/50 hover:bg-white/[0.08] border border-white/[0.06]"}`}
              style={filterCat === "all" ? { background: primaryColor, boxShadow: `0 4px 15px ${primaryColor}40` } : {}}
            >
              Todos ({products.length})
            </button>
            {categories.map((cat) => (
              <button
                key={cat.value}
                onClick={() => {
                  setFilterCat(filterCat === cat.value ? "all" : cat.value);
                  if (filterCat !== cat.value) setFilterGender("all");
                }}
                className={`shrink-0 px-3.5 py-1.5 rounded-full text-[11px] font-semibold transition-all ${filterCat === cat.value ? "text-black shadow-lg" : "bg-white/[0.04] text-white/50 hover:bg-white/[0.08] border border-white/[0.06]"}`}
                style={
                  filterCat === cat.value ? { background: primaryColor, boxShadow: `0 4px 15px ${primaryColor}40` } : {}
                }
              >
                {cat.label} ({cat.count})
              </button>
            ))}
          </div>
          {(isPerfumeCategory || (filterCat === "all" && hasPerfumes)) && (
            <div className="flex gap-1.5">
              {["all", "masculino", "femenino", "unisex"].map((g) => (
                <button
                  key={g}
                  onClick={() => setFilterGender(filterGender === g ? "all" : g)}
                  className={`shrink-0 px-3 py-1 rounded-full text-[10px] font-medium transition-all ${filterGender === g ? "bg-white/15 text-white border border-white/20" : "bg-white/[0.03] text-white/40 hover:bg-white/[0.06] border border-white/[0.04]"}`}
                >
                  {g === "all" ? "Todos" : `${GENDER_LABELS[g]?.icon} ${GENDER_LABELS[g]?.label}`}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-4 py-5 sm:py-8">
        {/* Hero Banner (only on "all" view) */}
        {showAllView && (
          <div
            className="relative rounded-2xl overflow-hidden mb-8 p-6 sm:p-10"
            style={{
              background: `linear-gradient(135deg, ${primaryColor}20, ${primaryColor}08)`,
              border: `1px solid ${primaryColor}25`,
            }}
          >
            <div className="relative z-10">
              <p className="text-3xl sm:text-4xl font-black leading-tight mb-2">
                Perfumes que duran
                <br />
                todo el día <span className="text-2xl">🔥</span>
              </p>
              <p className="text-sm sm:text-base text-white/50 font-medium mb-4">Fragancias que llaman la atención</p>
              <button
                onClick={() => setFilterCat("perfume_arabe")}
                className="px-5 py-2.5 rounded-xl font-bold text-sm text-black transition-all hover:scale-105"
                style={{ background: primaryColor }}
              >
                Ver perfumes
              </button>
            </div>
          </div>
        )}

        {/* Featured Section */}
        {featuredProducts.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Star className="w-5 h-5" style={{ color: primaryColor }} fill={primaryColor} />
              <h2 className="text-lg font-black tracking-wide" style={{ color: primaryColor }}>
                Destacados
              </h2>
            </div>
            <div className="grid grid-cols-1 min-[400px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {featuredProducts.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  primaryColor={primaryColor}
                  onClick={() => setDetailProduct(p)}
                  featured
                  settings={settings}
                  fullSettings={fullSettings}
                />
              ))}
            </div>
          </section>
        )}

        {/* Top Sellers */}
        {showAllView && topSellers.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Flame className="w-5 h-5 text-orange-400" />
              <h2 className="text-lg font-black tracking-wide text-orange-400">Más Vendidos</h2>
            </div>
            <div className="grid grid-cols-1 min-[400px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
              {topSellers.slice(0, 4).map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  primaryColor={primaryColor}
                  onClick={() => setDetailProduct(p)}
                  badge="Más vendido"
                  settings={settings}
                  fullSettings={fullSettings}
                />
              ))}
            </div>
          </section>
        )}

        {/* Cross-sell: If viewing vapers, show perfume suggestions */}
        {filterCat === "vaper" && perfumes.length > 0 && (
          <section
            className="mb-8 rounded-2xl p-4 sm:p-6"
            style={{
              background: `linear-gradient(135deg, ${primaryColor}12, transparent)`,
              border: `1px solid ${primaryColor}15`,
            }}
          >
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-5 h-5" style={{ color: primaryColor }} />
              <h3 className="font-black text-sm" style={{ color: primaryColor }}>
                Si te gusta oler bien, esto es para vos 🔥
              </h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {perfumes.slice(0, 4).map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  primaryColor={primaryColor}
                  onClick={() => setDetailProduct(p)}
                  compact
                  settings={settings}
                  fullSettings={fullSettings}
                />
              ))}
            </div>
          </section>
        )}

        {/* Main Grid */}
        {!filtered.length ? (
          <div className="text-center py-24">
            <div className="w-20 h-20 bg-white/[0.03] rounded-2xl flex items-center justify-center mx-auto mb-4 border border-white/[0.06]">
              <Package className="w-10 h-10 text-white/10" />
            </div>
            <p className="text-white/30 text-sm font-medium">No se encontraron productos</p>
          </div>
        ) : (
          <>
            {(featuredProducts.length > 0 || topSellers.length > 0) && regularProducts.length > 0 && showAllView && (
              <h2 className="text-sm font-semibold text-white/30 uppercase tracking-widest mb-4">
                Todos los productos
              </h2>
            )}
            <div className="grid grid-cols-1 min-[400px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
              {(showAllView && (featuredProducts.length > 0 || topSellers.length > 0) ? regularProducts : filtered).map(
                (p) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    primaryColor={primaryColor}
                    onClick={() => setDetailProduct(p)}
                    settings={settings}
                    fullSettings={fullSettings}
                  />
                ),
              )}
            </div>
          </>
        )}
      </main>

      {/* Product Detail Modal */}
      <Dialog
        open={!!detailProduct}
        onOpenChange={(open) => {
          if (!open) setDetailProduct(null);
        }}
      >
        <DialogContent className="p-0 border-0 bg-transparent shadow-none max-w-lg sm:max-w-xl max-h-[90vh] overflow-y-auto [&>button]:hidden">
          {detailProduct && (
            <ProductDetailModal
              product={detailProduct}
              primaryColor={primaryColor}
              whatsappNumber={whatsappNumber}
              buildWhatsAppUrl={buildWhatsAppUrl}
              catalogUrl={window.location.href}
              onClose={() => setDetailProduct(null)}
              settings={settings}
              fullSettings={fullSettings}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Footer */}
      <footer className="border-t border-white/[0.04] mt-12">
        <div className="max-w-7xl mx-auto px-4 py-8 text-center">
          <div className="flex items-center justify-center gap-2.5 mb-3">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={businessName}
                className="w-7 h-7 rounded-lg object-cover border border-white/10"
              />
            ) : (
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black"
                style={{ background: primaryColor, color: "#0D0D1A" }}
              >
                {businessName.charAt(0)}
              </div>
            )}
            <span className="text-sm font-black tracking-wide" style={{ color: primaryColor }}>
              {businessName}
            </span>
          </div>
          <p className="text-[10px] text-white/20 leading-relaxed">
            Precios sujetos a cambios sin previo aviso · Stock al momento de consulta
          </p>
        </div>
      </footer>

      {/* WhatsApp FAB */}
      {whatsappNumber && (
        <a
          href={buildWhatsAppUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-5 py-3.5 sm:px-6 sm:py-4 rounded-full text-white font-bold text-sm shadow-2xl hover:scale-105 active:scale-95 transition-all duration-200 animate-pulse"
          style={{
            background: "linear-gradient(135deg, #25D366, #128C7E)",
            boxShadow: "0 8px 30px rgba(37,211,102,0.4)",
          }}
        >
          <MessageCircle className="w-5 h-5 sm:w-6 sm:h-6" fill="white" />
          <span className="hidden sm:inline">Consultar</span>
        </a>
      )}
    </div>
  );
}

function ProductCard({
  product: p,
  primaryColor,
  onClick,
  featured,
  badge,
  compact,
  settings,
  fullSettings,
}: {
  product: any;
  primaryColor: string;
  onClick: () => void;
  featured?: boolean;
  badge?: string;
  compact?: boolean;
  settings?: any;
  fullSettings?: any;
}) {
  const hasDiscount = p.discount_price_ars && p.discount_price_ars < p.sale_price_ars;
  const discountPct = hasDiscount ? Math.round((1 - p.discount_price_ars / p.sale_price_ars) * 100) : 0;
  const savings = hasDiscount ? Number(p.sale_price_ars) - Number(p.discount_price_ars) : 0;
  const isPerfume = p.category === "perfume_arabe" || p.category === "perfume_diseñador";
  const genderInfo = GENDER_LABELS[p.gender];
  const installment = Math.round(Number(p.sale_price_ars) / 3);
  const hasCountdown = p.offer_expires_at && new Date(p.offer_expires_at) > new Date();
  const viewers = pseudoRandom(p.id || p.name, 2, 8);
  const volThreshold = Number(fullSettings?.volume_discount_threshold || 0);
  const volPercent = Number(fullSettings?.volume_discount_percent || 0);

  return (
    <div
      className={`group relative bg-white/[0.02] border rounded-2xl overflow-hidden hover:bg-white/[0.04] transition-all duration-400 cursor-pointer hover:-translate-y-1 hover:shadow-xl ${featured ? "border-white/[0.12] ring-1 ring-white/10" : "border-white/[0.06] hover:border-white/[0.12]"}`}
      onClick={onClick}
    >
      <div
        className={`${compact ? "aspect-square" : "aspect-[4/5]"} bg-gradient-to-b from-white/[0.02] to-transparent relative overflow-hidden`}
      >
        {p.image_url ? (
          <img
            src={p.image_url}
            alt={p.name}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-700 ease-out"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2">
            <Package className="w-8 h-8 sm:w-10 sm:h-10 text-white/[0.06]" />
          </div>
        )}

        <div className="absolute top-2 left-2 right-2 flex items-start justify-between">
          <div className="flex flex-col gap-1">
            {badge && (
              <span className="px-2 py-1 rounded-lg text-[10px] font-bold backdrop-blur-md flex items-center gap-0.5 bg-orange-500/30 text-orange-300 border border-orange-500/40">
                <Flame className="w-2.5 h-2.5" />
                {badge}
              </span>
            )}
            {featured && !badge && (
              <span
                className="px-2 py-1 rounded-lg text-[10px] font-bold backdrop-blur-md flex items-center gap-0.5"
                style={{ background: `${primaryColor}30`, color: primaryColor, border: `1px solid ${primaryColor}40` }}
              >
                <Star className="w-2.5 h-2.5" fill={primaryColor} />
                Destacado
              </span>
            )}
            {hasDiscount && (
              <span
                className="px-2 py-1 rounded-lg text-[10px] sm:text-[11px] font-bold text-white flex items-center gap-0.5"
                style={{ background: "linear-gradient(135deg, #ef4444, #dc2626)" }}
              >
                <Tag className="w-2.5 h-2.5 sm:w-3 sm:h-3" />-{discountPct}%
              </span>
            )}
            {hasCountdown && <CountdownTimer expiresAt={p.offer_expires_at} primaryColor={primaryColor} />}
          </div>
          {isPerfume && genderInfo && !compact && (
            <span
              className="px-2 py-1 rounded-lg text-[10px] sm:text-[11px] font-semibold backdrop-blur-md border border-white/10"
              style={{
                background:
                  p.gender === "masculino"
                    ? "rgba(59,130,246,0.25)"
                    : p.gender === "femenino"
                      ? "rgba(236,72,153,0.25)"
                      : "rgba(168,85,247,0.25)",
                color: p.gender === "masculino" ? "#93bbfd" : p.gender === "femenino" ? "#f9a8d4" : "#d8b4fe",
              }}
            >
              {genderInfo.icon} {genderInfo.label}
            </span>
          )}
        </div>

        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent pt-10 pb-2.5 px-2.5">
          <span className="text-[9px] sm:text-[10px] font-bold tracking-wider uppercase text-white/70">{p.brand}</span>
        </div>
      </div>

      <div className="p-2.5 sm:p-3.5">
        <h3 className="font-bold text-[11px] sm:text-[13px] text-white/90 leading-snug mb-0.5 line-clamp-2">
          {p.name}
        </h3>
        {!compact && (
          <p className="text-[9px] sm:text-[10px] text-white/25 mb-2.5 font-medium">
            {CATEGORY_LABELS[p.category] || p.category}
          </p>
        )}

        <div className="space-y-1.5">
          {hasDiscount ? (
            <>
              <div
                className="rounded-lg p-2"
                style={{ background: `${primaryColor}10`, border: `1px solid ${primaryColor}20` }}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="px-1.5 py-0.5 rounded text-[8px] font-bold"
                    style={{ background: `${primaryColor}25`, color: primaryColor }}
                  >
                    MEJOR PRECIO
                  </span>
                </div>
                <p className="text-[13px] sm:text-lg font-black tracking-tight mt-1" style={{ color: primaryColor }}>
                  {fmtARS(Number(p.discount_price_ars))}
                </p>
                <p
                  className="text-[8px] sm:text-[9px] font-semibold uppercase tracking-wider"
                  style={{ color: `${primaryColor}99` }}
                >
                  Efectivo / Transferencia
                </p>
                <p className="text-[9px] font-bold mt-0.5" style={{ color: "#4ade80" }}>
                  Ahorrás {fmtARS(savings)}
                </p>
              </div>
              <div className="px-2">
                <p className="text-[10px] sm:text-[11px] text-white/45 font-medium line-through decoration-red-500/60 decoration-2">
                  {fmtARS(Number(p.sale_price_ars))}
                </p>
                {!compact && (
                  <p className="text-[8px] sm:text-[9px] text-white/30 font-medium">
                    3 cuotas de {fmtARS(installment)} s/interés
                  </p>
                )}
              </div>
            </>
          ) : (
            <div
              className="rounded-lg p-2"
              style={{ background: `${primaryColor}10`, border: `1px solid ${primaryColor}20` }}
            >
              <p className="text-[13px] sm:text-lg font-black tracking-tight" style={{ color: primaryColor }}>
                {fmtARS(Number(p.sale_price_ars))}
              </p>
              {!compact && (
                <p className="text-[8px] sm:text-[9px] text-white/30 font-medium">
                  3 cuotas de {fmtARS(installment)} s/interés
                </p>
              )}
            </div>
          )}
        </div>

        {/* Scarcity + Social proof + Volume badge */}
        {!compact && (
          <div className="mt-2 space-y-1">
            {p.stock <= 5 && (
              <p
                className="text-[9px] font-semibold flex items-center gap-1"
                style={{ color: p.stock <= 3 ? "#f59e0b" : "#a3a3a3" }}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${p.stock <= 3 ? "bg-amber-400 animate-pulse" : "bg-white/30"}`}
                />
                {p.stock <= 3 ? `¡Últimas ${p.stock} unidades!` : `Quedan pocas unidades`}
              </p>
            )}
            {volThreshold > 0 && volPercent > 0 && (
              <p className="text-[8px] font-semibold flex items-center gap-1" style={{ color: "#a78bfa" }}>
                <Users className="w-2.5 h-2.5" />
                Llevá {volThreshold}+ = -{volPercent}% OFF
              </p>
            )}
            <p className="text-[8px] text-white/25 flex items-center gap-1">
              <Eye className="w-2.5 h-2.5" />
              {viewers} personas viendo esto
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ProductDetailModal({
  product: p,
  primaryColor,
  whatsappNumber,
  buildWhatsAppUrl,
  catalogUrl,
  onClose,
  settings,
  fullSettings,
}: {
  product: any;
  primaryColor: string;
  whatsappNumber: string | null;
  buildWhatsAppUrl: (p?: any, size?: string) => string;
  catalogUrl: string;
  onClose: () => void;
  settings: any;
  fullSettings?: any;
}) {
  const [selectedSize, setSelectedSize] = useState<string>("full");
  const hasDiscount = p.discount_price_ars && p.discount_price_ars < p.sale_price_ars;
  const discountPct = hasDiscount ? Math.round((1 - p.discount_price_ars / p.sale_price_ars) * 100) : 0;
  const savings = hasDiscount ? Number(p.sale_price_ars) - Number(p.discount_price_ars) : 0;
  const isPerfume = p.category === "perfume_arabe" || p.category === "perfume_diseñador";
  const genderInfo = GENDER_LABELS[p.gender];
  const installment = Math.round(Number(p.sale_price_ars) / 3);
  const hasCountdown = p.offer_expires_at && new Date(p.offer_expires_at) > new Date();
  const contentMl = Number(p.content_ml || 100);
  const viewers = pseudoRandom(p.id || p.name, 3, 12);
  const exchangeRate = Number(fullSettings?.exchange_rate || 1695);
  const totalCostUSD = Number(p.total_cost_usd || p.cost_usd || 0);

  const decantSizes = isPerfume
    ? [
        { value: "full", label: `Completo (${contentMl}ml)`, price: Number(p.discount_price_ars || p.sale_price_ars) },
        { value: "10", label: "10ml", price: calculateDecantPrice(totalCostUSD, contentMl, 10, Number(fullSettings?.decant_margin_10ml || 250), exchangeRate) },
        { value: "5", label: "5ml", price: calculateDecantPrice(totalCostUSD, contentMl, 5, Number(fullSettings?.decant_margin_5ml || 350), exchangeRate) },
        { value: "2.5", label: "2.5ml", price: calculateDecantPrice(totalCostUSD, contentMl, 2.5, Number(fullSettings?.decant_margin_2_5ml || 500), exchangeRate) },
      ]
    : [];

  const currentPrice =
    selectedSize === "full"
      ? Number(p.discount_price_ars || p.sale_price_ars)
      : decantSizes.find((s) => s.value === selectedSize)?.price || Number(p.discount_price_ars || p.sale_price_ars);

  const handleShareProduct = async () => {
    const sizeLabel = selectedSize !== "full" ? ` (${selectedSize}ml)` : "";
    const text = `${p.name}${sizeLabel} — ${fmtARS(currentPrice)} 🛍️\n${catalogUrl}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: p.name, text });
      } catch {}
    } else {
      await navigator.clipboard.writeText(text);
    }
  };

  return (
    <div
      className="rounded-2xl overflow-hidden text-white animate-in fade-in zoom-in-95 duration-300"
      style={{
        background: "linear-gradient(160deg, #13132a 0%, #0d0d1a 100%)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <button
        onClick={onClose}
        className="absolute top-3 right-3 z-10 p-2 rounded-full bg-black/50 backdrop-blur-sm hover:bg-black/70 transition-colors"
      >
        <X className="w-4 h-4 text-white/70" />
      </button>

      <div className="relative aspect-square max-h-[50vh] bg-black/30 overflow-hidden">
        {p.image_url ? (
          <img src={p.image_url} alt={p.name} className="w-full h-full object-contain" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Package className="w-16 h-16 text-white/[0.06]" />
          </div>
        )}
        <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
          {p.featured && (
            <span
              className="px-2.5 py-1 rounded-lg text-xs font-bold backdrop-blur-md flex items-center gap-1"
              style={{ background: `${primaryColor}30`, color: primaryColor }}
            >
              <Star className="w-3 h-3" fill={primaryColor} />
              Destacado
            </span>
          )}
          {hasDiscount && (
            <span
              className="px-2.5 py-1 rounded-lg text-xs font-bold text-white"
              style={{ background: "linear-gradient(135deg, #ef4444, #dc2626)" }}
            >
              -{discountPct}% OFF
            </span>
          )}
          {hasCountdown && <CountdownTimer expiresAt={p.offer_expires_at} primaryColor={primaryColor} />}
          {isPerfume && genderInfo && (
            <span
              className="px-2.5 py-1 rounded-lg text-xs font-semibold backdrop-blur-md border border-white/10"
              style={{
                background:
                  p.gender === "masculino"
                    ? "rgba(59,130,246,0.3)"
                    : p.gender === "femenino"
                      ? "rgba(236,72,153,0.3)"
                      : "rgba(168,85,247,0.3)",
                color: p.gender === "masculino" ? "#93bbfd" : p.gender === "femenino" ? "#f9a8d4" : "#d8b4fe",
              }}
            >
              {genderInfo.icon} {genderInfo.label}
            </span>
          )}
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div>
          <p className="text-[10px] font-bold tracking-widest uppercase text-white/40 mb-1">{p.brand}</p>
          <h2 className="text-lg sm:text-xl font-black leading-tight">{p.name}</h2>
          <p className="text-xs text-white/30 mt-1">{CATEGORY_LABELS[p.category] || p.category}</p>
        </div>

        {p.description && <p className="text-sm text-white/50 leading-relaxed">{p.description}</p>}

        {/* Decant size selector for perfumes */}
        {isPerfume && decantSizes.length > 0 && (
          <div>
            <p className="text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Droplets className="w-3 h-3" />
              Tamaño
            </p>
            <div className="flex gap-2">
              {decantSizes.map((s) => (
                <button
                  key={s.value}
                  className={`px-3 py-2 rounded-xl text-xs font-bold transition-all ${selectedSize === s.value ? "text-black scale-105" : "bg-white/[0.06] text-white/60 hover:bg-white/[0.1] border border-white/[0.08]"}`}
                  style={selectedSize === s.value ? { background: primaryColor } : {}}
                  onClick={() => setSelectedSize(s.value)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {selectedSize !== "full" && currentPrice > 0 && (
              <p className="text-[10px] text-white/40 mt-2">
                Precio calculado para decant de {selectedSize}ml
              </p>
            )}
            {selectedSize !== "full" && currentPrice === 0 && (
              <p className="text-[10px] text-white/30 mt-2 flex items-center gap-1">
                <MessageCircle className="w-3 h-3" />
                Consultá precio y disponibilidad del decant por WhatsApp
              </p>
            )}
          </div>
        )}

        <div className="space-y-2">
          {selectedSize === "full" ? (
            hasDiscount ? (
              <>
                <div
                  className="rounded-xl p-3.5"
                  style={{ background: `${primaryColor}12`, border: `1px solid ${primaryColor}25` }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="px-2 py-0.5 rounded text-[9px] font-bold"
                      style={{ background: `${primaryColor}25`, color: primaryColor }}
                    >
                      MEJOR PRECIO
                    </span>
                  </div>
                  <p className="text-2xl font-black tracking-tight" style={{ color: primaryColor }}>
                    {fmtARS(Number(p.discount_price_ars))}
                  </p>
                  <p
                    className="text-[10px] font-semibold uppercase tracking-widest mt-0.5"
                    style={{ color: `${primaryColor}90` }}
                  >
                    Efectivo / Transferencia
                  </p>
                  <p className="text-xs font-bold mt-1" style={{ color: "#4ade80" }}>
                    Ahorrás {fmtARS(savings)}
                  </p>
                </div>
                <div className="px-1">
                  <p className="text-sm text-white/50 font-medium line-through decoration-red-500/60 decoration-2">
                    {fmtARS(Number(p.sale_price_ars))}
                  </p>
                  <p className="text-[10px] text-white/25 font-medium">
                    Tarjeta · 3 cuotas de {fmtARS(installment)} sin interés
                  </p>
                </div>
              </>
            ) : (
              <div
                className="rounded-xl p-3.5"
                style={{ background: `${primaryColor}12`, border: `1px solid ${primaryColor}25` }}
              >
                <p className="text-2xl font-black tracking-tight" style={{ color: primaryColor }}>
                  {fmtARS(Number(p.sale_price_ars))}
                </p>
                <p className="text-[10px] text-white/30 font-medium mt-1">
                  3 cuotas de {fmtARS(installment)} sin interés
                </p>
              </div>
            )
          ) : (
            <div
              className="rounded-xl p-3.5"
              style={{ background: `${primaryColor}12`, border: `1px solid ${primaryColor}25` }}
            >
              <p className="text-lg font-black" style={{ color: primaryColor }}>
                Decant {selectedSize}ml
              </p>
              <p className="text-xs text-white/40 mt-1">Consultá el precio por WhatsApp</p>
            </div>
          )}
        </div>

        {/* Social proof */}
        <div className="space-y-1.5">
          {p.stock <= 5 && (
            <p
              className="text-xs font-semibold flex items-center gap-1.5"
              style={{ color: p.stock <= 3 ? "#f59e0b" : "#a3a3a3" }}
            >
              <span className={`w-2 h-2 rounded-full ${p.stock <= 3 ? "bg-amber-400 animate-pulse" : "bg-white/30"}`} />
              {p.stock <= 3 ? `¡Últimas ${p.stock} unidades disponibles!` : "Quedan pocas unidades"}
            </p>
          )}
          <p className="text-[10px] text-white/25 flex items-center gap-1">
            <Eye className="w-3 h-3" />
            {viewers} personas viendo este producto ahora
          </p>
        </div>

        <div className="flex gap-2">
          {whatsappNumber && (
            <a
              href={buildWhatsAppUrl(p, selectedSize)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2.5 py-3.5 rounded-xl text-white font-bold text-sm hover:scale-[1.02] active:scale-[0.98] transition-all"
              style={{
                background: "linear-gradient(135deg, #25D366, #128C7E)",
                boxShadow: "0 6px 20px rgba(37,211,102,0.35)",
              }}
            >
              <MessageCircle className="w-5 h-5" fill="white" />
              {selectedSize !== "full" ? `Consultar decant ${selectedSize}ml` : "Consultar por WhatsApp"}
            </a>
          )}
          <button
            onClick={handleShareProduct}
            className="p-3.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] transition-colors"
            title="Compartir producto"
          >
            <Copy className="w-5 h-5 text-white/50" />
          </button>
        </div>
      </div>
    </div>
  );
}
