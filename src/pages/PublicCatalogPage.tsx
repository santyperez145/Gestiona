import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Package, Tag, Search, Share2, X, Filter, MessageCircle } from "lucide-react";

const CATEGORY_LABELS: Record<string, string> = {
  perfume_arabe: 'Perfume Árabe',
  'perfume_diseñador': 'Perfume Diseñador',
  vaper: 'Vaper',
  electronico: 'Electrónico',
};

const GENDER_LABELS: Record<string, { icon: string; label: string }> = {
  masculino: { icon: '♂', label: 'Masculino' },
  femenino: { icon: '♀', label: 'Femenino' },
  unisex: { icon: '⚥', label: 'Unisex' },
};

function fmtARS(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}

export default function PublicCatalogPage() {
  const { userId } = useParams<{ userId: string }>();
  const [products, setProducts] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [valid, setValid] = useState<boolean | null>(null);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [filterGender, setFilterGender] = useState('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);

  const fetchData = useCallback(async () => {
    if (!userId) { setValid(false); return; }
    const [pRes, sRes] = await Promise.all([
      supabase.from('products_public' as any).select('*').eq('user_id', userId).gt('stock', 0).order('category').order('name'),
      supabase.from('settings_public' as any).select('*').eq('user_id', userId).maybeSingle(),
    ]);
    if (!sRes.data) { setValid(false); return; }
    setProducts(pRes.data || []);
    setSettings(sRes.data);
    setValid(true);
  }, [userId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!userId || !valid) return;
    const channel = supabase
      .channel('public-catalog-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, valid, fetchData]);

  useEffect(() => {
    if (settings?.business_name) document.title = `${settings.business_name} — Catálogo`;
  }, [settings]);

  const categories = useMemo(() => {
    const cats = [...new Set(products.map(p => p.category))];
    return cats.map(c => ({ value: c, label: CATEGORY_LABELS[c] || c, count: products.filter(p => p.category === c).length }));
  }, [products]);

  const isPerfumeCategory = filterCat === 'perfume_arabe' || filterCat === 'perfume_diseñador';
  const hasPerfumes = products.some(p => p.category === 'perfume_arabe' || p.category === 'perfume_diseñador');

  const filtered = useMemo(() => products.filter(p => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.brand?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCat !== 'all' && p.category !== filterCat) return false;
    if (filterGender !== 'all' && p.gender !== filterGender) return false;
    return true;
  }), [products, search, filterCat, filterGender]);

  const primaryColor = settings?.primary_color || '#D4A843';
  const businessName = settings?.business_name || 'EXENTRY IMPORTS';
  const logoUrl = settings?.logo_url;
  const whatsappNumber = settings?.whatsapp_number;

  if (valid === null) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'linear-gradient(145deg, #0a0a14 0%, #111127 50%, #0a0a14 100%)' }}>
      <div className="w-12 h-12 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: `${primaryColor} transparent ${primaryColor} ${primaryColor}` }} />
    </div>
  );

  if (!valid) return (
    <div className="min-h-screen flex items-center justify-center text-white px-4" style={{ background: 'linear-gradient(145deg, #0a0a14 0%, #111127 50%, #0a0a14 100%)' }}>
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
      try { await navigator.share({ title: `${businessName} — Catálogo`, text: `${filtered.length} productos disponibles`, url }); } catch {}
    } else {
      await navigator.clipboard.writeText(url);
    }
  };

  return (
    <div className="min-h-screen text-white" style={{ background: 'linear-gradient(145deg, #0a0a14 0%, #111127 50%, #0a0a14 100%)' }}>
      {/* Sticky Header */}
      <header className="sticky top-0 z-50 backdrop-blur-2xl border-b border-white/[0.06] max-h-[45vh] overflow-hidden" style={{ background: 'rgba(10,10,20,0.85)' }}>
        <div className="max-w-7xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            {logoUrl ? (
              <img src={logoUrl} alt={businessName} className="w-10 h-10 rounded-xl object-cover shrink-0 border border-white/10" />
            ) : (
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-sm font-black tracking-wider" style={{ background: `linear-gradient(135deg, ${primaryColor}, ${primaryColor}dd)`, color: '#0D0D1A' }}>
                {businessName.charAt(0)}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="font-black text-sm sm:text-base tracking-wide truncate" style={{ color: primaryColor }}>{businessName}</h1>
              <p className="text-[10px] sm:text-xs text-white/35 font-medium">{filtered.length} productos disponibles</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setSearchOpen(!searchOpen)} className={`p-2.5 rounded-xl transition-all ${searchOpen ? 'bg-white/10' : 'hover:bg-white/5'}`}>
              {searchOpen ? <X className="w-4 h-4 text-white/70" /> : <Search className="w-4 h-4 text-white/50" />}
            </button>
            <button onClick={handleShare} className="p-2.5 rounded-xl hover:bg-white/5 transition-colors">
              <Share2 className="w-4 h-4 text-white/50" />
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className={`overflow-hidden transition-all duration-300 ${searchOpen ? 'max-h-16 pb-3' : 'max-h-0'}`}>
          <div className="px-4 max-w-7xl mx-auto">
            <input
              type="text"
              placeholder="Buscar producto o marca..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus={searchOpen}
              className="w-full bg-white/[0.06] border border-white/[0.08] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:ring-2 focus:border-transparent transition-all"
              style={{ ['--tw-ring-color' as any]: `${primaryColor}66` }}
            />
          </div>
        </div>

        {/* Category + Gender filters */}
        <div className="max-w-7xl mx-auto px-4 pb-3 space-y-2">
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
            <button
              onClick={() => { setFilterCat('all'); setFilterGender('all'); }}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-[11px] font-semibold transition-all ${filterCat === 'all' ? 'text-black shadow-lg' : 'bg-white/[0.04] text-white/50 hover:bg-white/[0.08] border border-white/[0.06]'}`}
              style={filterCat === 'all' ? { background: primaryColor, boxShadow: `0 4px 15px ${primaryColor}40` } : {}}
            >
              Todos ({products.length})
            </button>
            {categories.map(cat => (
              <button
                key={cat.value}
                onClick={() => { setFilterCat(filterCat === cat.value ? 'all' : cat.value); if (filterCat !== cat.value) setFilterGender('all'); }}
                className={`shrink-0 px-3.5 py-1.5 rounded-full text-[11px] font-semibold transition-all ${filterCat === cat.value ? 'text-black shadow-lg' : 'bg-white/[0.04] text-white/50 hover:bg-white/[0.08] border border-white/[0.06]'}`}
                style={filterCat === cat.value ? { background: primaryColor, boxShadow: `0 4px 15px ${primaryColor}40` } : {}}
              >
                {cat.label} ({cat.count})
              </button>
            ))}
          </div>

          {/* Gender filter - only for perfume categories */}
          {(isPerfumeCategory || (filterCat === 'all' && hasPerfumes)) && (
            <div className="flex gap-1.5">
              {['all', 'masculino', 'femenino', 'unisex'].map(g => (
                <button
                  key={g}
                  onClick={() => setFilterGender(filterGender === g ? 'all' : g)}
                  className={`shrink-0 px-3 py-1 rounded-full text-[10px] font-medium transition-all ${filterGender === g ? 'bg-white/15 text-white border border-white/20' : 'bg-white/[0.03] text-white/40 hover:bg-white/[0.06] border border-white/[0.04]'}`}
                >
                  {g === 'all' ? 'Todos' : `${GENDER_LABELS[g]?.icon} ${GENDER_LABELS[g]?.label}`}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* Products Grid */}
      <main className="max-w-7xl mx-auto px-3 sm:px-4 py-5 sm:py-8">
        {!filtered.length ? (
          <div className="text-center py-24">
            <div className="w-20 h-20 bg-white/[0.03] rounded-2xl flex items-center justify-center mx-auto mb-4 border border-white/[0.06]">
              <Package className="w-10 h-10 text-white/10" />
            </div>
            <p className="text-white/30 text-sm font-medium">No se encontraron productos</p>
            <p className="text-white/15 text-xs mt-1">Probá con otro filtro o buscá otro término</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
            {filtered.map(p => {
              const hasDiscount = p.discount_price_ars && p.discount_price_ars < p.sale_price_ars;
              const discountPct = hasDiscount ? Math.round((1 - p.discount_price_ars / p.sale_price_ars) * 100) : 0;
              const isPerfume = p.category === 'perfume_arabe' || p.category === 'perfume_diseñador';
              const genderInfo = GENDER_LABELS[p.gender];

              return (
                <div
                  key={p.id}
                  className="group relative bg-white/[0.02] border border-white/[0.06] rounded-2xl overflow-hidden hover:border-white/[0.12] hover:bg-white/[0.04] transition-all duration-400 cursor-pointer"
                  style={{ ['--hover-glow' as any]: `${primaryColor}15` }}
                  onClick={() => setSelectedProduct(selectedProduct?.id === p.id ? null : p)}
                >
                  {/* Image area */}
                  <div className="aspect-[4/5] bg-gradient-to-b from-white/[0.02] to-transparent relative overflow-hidden">
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

                    {/* Top badges row */}
                    <div className="absolute top-2 left-2 right-2 flex items-start justify-between">
                      {/* Discount badge */}
                      {hasDiscount ? (
                        <span className="px-2 py-1 rounded-lg text-[10px] sm:text-[11px] font-bold text-white flex items-center gap-0.5" style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)' }}>
                          <Tag className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                          -{discountPct}%
                        </span>
                      ) : <span />}

                      {/* Gender badge */}
                      {isPerfume && genderInfo && (
                        <span className="px-2 py-1 rounded-lg text-[10px] sm:text-[11px] font-semibold backdrop-blur-md border border-white/10"
                          style={{
                            background: p.gender === 'masculino' ? 'rgba(59,130,246,0.25)' :
                              p.gender === 'femenino' ? 'rgba(236,72,153,0.25)' : 'rgba(168,85,247,0.25)',
                            color: p.gender === 'masculino' ? '#93bbfd' :
                              p.gender === 'femenino' ? '#f9a8d4' : '#d8b4fe',
                          }}
                        >
                          {genderInfo.icon} {genderInfo.label}
                        </span>
                      )}
                    </div>

                    {/* Bottom gradient overlay with brand */}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent pt-10 pb-2.5 px-2.5">
                      <span className="text-[9px] sm:text-[10px] font-bold tracking-wider uppercase text-white/70">
                        {p.brand}
                      </span>
                    </div>
                  </div>

                  {/* Info */}
                  <div className="p-2.5 sm:p-3.5">
                    <h3 className="font-bold text-[11px] sm:text-[13px] text-white/90 leading-snug mb-0.5 line-clamp-2">{p.name}</h3>
                    <p className="text-[9px] sm:text-[10px] text-white/25 mb-2.5 font-medium">{CATEGORY_LABELS[p.category] || p.category}</p>

                    {/* Prices */}
                    <div className="space-y-1.5">
                      {hasDiscount ? (
                        <>
                          <div className="rounded-lg p-2" style={{ background: `${primaryColor}10`, border: `1px solid ${primaryColor}20` }}>
                            <p className="text-[13px] sm:text-lg font-black tracking-tight" style={{ color: primaryColor }}>{fmtARS(Number(p.discount_price_ars))}</p>
                            <p className="text-[8px] sm:text-[9px] font-semibold uppercase tracking-wider" style={{ color: `${primaryColor}99` }}>Efectivo / Transferencia</p>
                          </div>
                          <div className="px-2">
                            <p className="text-[10px] sm:text-[11px] text-white/45 font-medium">{fmtARS(Number(p.sale_price_ars))}</p>
                            <p className="text-[8px] sm:text-[9px] text-white/20 font-medium">Tarjeta · 3 cuotas s/interés</p>
                          </div>
                        </>
                      ) : (
                        <div className="rounded-lg p-2" style={{ background: `${primaryColor}10`, border: `1px solid ${primaryColor}20` }}>
                          <p className="text-[13px] sm:text-lg font-black tracking-tight" style={{ color: primaryColor }}>{fmtARS(Number(p.sale_price_ars))}</p>
                        </div>
                      )}
                    </div>

                    {/* Stock indicator */}
                    {p.stock <= 3 && (
                      <p className="text-[9px] text-amber-400/70 font-semibold mt-2 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400/70 animate-pulse" />
                        ¡Últimas {p.stock} unidades!
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/[0.04] mt-12">
        <div className="max-w-7xl mx-auto px-4 py-8 text-center">
          <div className="flex items-center justify-center gap-2.5 mb-3">
            {logoUrl ? (
              <img src={logoUrl} alt={businessName} className="w-7 h-7 rounded-lg object-cover border border-white/10" />
            ) : (
              <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black" style={{ background: primaryColor, color: '#0D0D1A' }}>
                {businessName.charAt(0)}
              </div>
            )}
            <span className="text-sm font-black tracking-wide" style={{ color: primaryColor }}>{businessName}</span>
          </div>
          <p className="text-[10px] text-white/20 leading-relaxed">Precios sujetos a cambios sin previo aviso · Stock al momento de consulta</p>
          <p className="text-[9px] text-white/10 mt-1.5 font-medium">Catálogo actualizado en tiempo real</p>
        </div>
      </footer>

      {/* WhatsApp FAB */}
      {whatsappNumber && (
        <a
          href={`https://wa.me/${whatsappNumber.replace(/[^0-9]/g, '')}?text=${encodeURIComponent('Hola! Vi tu catálogo y me interesa consultar sobre un producto 🛍️')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-5 py-3.5 rounded-full text-white font-bold text-sm shadow-2xl hover:scale-105 active:scale-95 transition-all duration-200"
          style={{ background: 'linear-gradient(135deg, #25D366, #128C7E)', boxShadow: '0 8px 30px rgba(37,211,102,0.4)' }}
        >
          <MessageCircle className="w-5 h-5" fill="white" />
          <span className="hidden sm:inline">Consultar</span>
        </a>
      )}
    </div>
  );
}
  );
}
