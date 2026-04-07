import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Package, Tag, Search, ChevronDown, Share2 } from "lucide-react";

const CATEGORY_LABELS: Record<string, string> = {
  perfume_arabe: 'Perfume Árabe',
  'perfume_diseñador': 'Perfume Diseñador',
  vaper: 'Vaper',
  electronico: 'Electrónico',
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
  const [searchOpen, setSearchOpen] = useState(false);

  const fetchData = useCallback(async () => {
    if (!userId) { setValid(false); return; }
    const [pRes, sRes] = await Promise.all([
      supabase.from('products').select('*').eq('user_id', userId).gt('stock', 0).order('category').order('name'),
      supabase.from('settings').select('*').eq('user_id', userId).maybeSingle(),
    ]);
    if (!sRes.data) { setValid(false); return; }
    setProducts(pRes.data || []);
    setSettings(sRes.data);
    setValid(true);
  }, [userId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Realtime
  useEffect(() => {
    if (!userId || !valid) return;
    const channel = supabase
      .channel('public-catalog-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, valid, fetchData]);

  // Update document title
  useEffect(() => {
    if (settings?.business_name) {
      document.title = `${settings.business_name} — Catálogo`;
    }
  }, [settings]);

  const categories = useMemo(() => {
    const cats = [...new Set(products.map(p => p.category))];
    return cats.map(c => ({ value: c, label: CATEGORY_LABELS[c] || c, count: products.filter(p => p.category === c).length }));
  }, [products]);

  const filtered = useMemo(() => products.filter(p => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.brand.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCat !== 'all' && p.category !== filterCat) return false;
    return true;
  }), [products, search, filterCat]);

  const primaryColor = settings?.primary_color || '#D4A843';
  const businessName = settings?.business_name || 'Exentry Imports';
  const logoUrl = settings?.logo_url;

  if (valid === null) return (
    <div className="min-h-screen flex items-center justify-center bg-[#0D0D1A]">
      <div className="w-10 h-10 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: `${primaryColor} transparent ${primaryColor} ${primaryColor}` }} />
    </div>
  );

  if (!valid) return (
    <div className="min-h-screen flex items-center justify-center bg-[#0D0D1A] text-white px-4">
      <div className="text-center">
        <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-4">
          <Package className="w-8 h-8 text-white/30" />
        </div>
        <h1 className="text-xl font-bold mb-2">Catálogo no encontrado</h1>
        <p className="text-white/50 text-sm">El enlace no es válido o el negocio no existe.</p>
      </div>
    </div>
  );

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: `${businessName} — Catálogo`, text: `${filtered.length} productos disponibles`, url });
      } catch { /* cancelled */ }
    } else {
      await navigator.clipboard.writeText(url);
    }
  };

  return (
    <div className="min-h-screen bg-[#0D0D1A] text-white">
      {/* Sticky Header */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-[#0D0D1A]/90 border-b border-white/5">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            {logoUrl ? (
              <img src={logoUrl} alt={businessName} className="w-9 h-9 rounded-lg object-cover shrink-0" />
            ) : (
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-sm font-bold" style={{ background: primaryColor, color: '#0D0D1A' }}>
                {businessName.charAt(0)}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="font-bold text-sm sm:text-base truncate" style={{ color: primaryColor }}>{businessName}</h1>
              <p className="text-[10px] sm:text-xs text-white/40">{filtered.length} productos disponibles</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setSearchOpen(!searchOpen)} className="p-2 rounded-lg hover:bg-white/5 transition-colors">
              <Search className="w-4 h-4 text-white/60" />
            </button>
            <button onClick={handleShare} className="p-2 rounded-lg hover:bg-white/5 transition-colors">
              <Share2 className="w-4 h-4 text-white/60" />
            </button>
          </div>
        </div>

        {/* Search bar */}
        {searchOpen && (
          <div className="px-4 pb-3 max-w-6xl mx-auto">
            <input
              type="text"
              placeholder="Buscar producto o marca..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:border-transparent"
              style={{ ['--tw-ring-color' as any]: primaryColor }}
            />
          </div>
        )}

        {/* Category chips */}
        <div className="max-w-6xl mx-auto px-4 pb-3 flex gap-2 overflow-x-auto scrollbar-hide">
          <button
            onClick={() => setFilterCat('all')}
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
              filterCat === 'all' ? 'text-[#0D0D1A]' : 'bg-white/5 text-white/60 hover:bg-white/10'
            }`}
            style={filterCat === 'all' ? { background: primaryColor } : {}}
          >
            Todos ({products.length})
          </button>
          {categories.map(cat => (
            <button
              key={cat.value}
              onClick={() => setFilterCat(filterCat === cat.value ? 'all' : cat.value)}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
                filterCat === cat.value ? 'text-[#0D0D1A]' : 'bg-white/5 text-white/60 hover:bg-white/10'
              }`}
              style={filterCat === cat.value ? { background: primaryColor } : {}}
            >
              {cat.label} ({cat.count})
            </button>
          ))}
        </div>
      </header>

      {/* Products Grid */}
      <main className="max-w-6xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        {!filtered.length ? (
          <div className="text-center py-20">
            <Package className="w-12 h-12 mx-auto mb-3 text-white/15" />
            <p className="text-white/40 text-sm">No se encontraron productos</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-4">
            {filtered.map(p => {
              const hasDiscount = p.discount_price_ars && p.discount_price_ars < p.sale_price_ars;
              const discountPct = hasDiscount ? Math.round((1 - p.discount_price_ars / p.sale_price_ars) * 100) : 0;

              return (
                <div key={p.id} className="group bg-white/[0.03] border border-white/[0.06] rounded-2xl overflow-hidden hover:border-white/10 transition-all duration-300">
                  {/* Image */}
                  <div className="aspect-square bg-white/[0.02] relative overflow-hidden">
                    {p.image_url ? (
                      <img
                        src={p.image_url}
                        alt={p.name}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package className="w-10 h-10 text-white/10" />
                      </div>
                    )}

                    {/* Discount badge */}
                    {hasDiscount && (
                      <div className="absolute top-2 left-2">
                        <span className="px-2 py-1 rounded-lg text-[10px] sm:text-xs font-bold bg-red-500 text-white flex items-center gap-0.5">
                          <Tag className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                          -{discountPct}%
                        </span>
                      </div>
                    )}

                    {/* Brand pill */}
                    <div className="absolute bottom-2 left-2 right-2">
                      <span className="px-2 py-0.5 rounded-md text-[9px] sm:text-[10px] font-medium bg-black/60 backdrop-blur-sm text-white/80 truncate block w-fit max-w-full">
                        {p.brand}
                      </span>
                    </div>
                  </div>

                  {/* Info */}
                  <div className="p-2.5 sm:p-3.5">
                    <h3 className="font-semibold text-xs sm:text-sm text-white/90 leading-tight mb-1 line-clamp-2">{p.name}</h3>
                    <p className="text-[10px] text-white/30 mb-2 sm:mb-3">{CATEGORY_LABELS[p.category] || p.category}</p>

                    {/* Prices */}
                    <div className="space-y-1.5">
                      {hasDiscount ? (
                        <>
                          <div>
                            <p className="text-sm sm:text-lg font-bold" style={{ color: primaryColor }}>{fmtARS(Number(p.discount_price_ars))}</p>
                            <p className="text-[9px] sm:text-[10px] text-white/35">Efectivo / Transferencia</p>
                          </div>
                          <div className="pt-1 border-t border-white/5">
                            <p className="text-[11px] sm:text-xs text-white/50">{fmtARS(Number(p.sale_price_ars))}</p>
                            <p className="text-[9px] sm:text-[10px] text-white/25">Tarjeta hasta 3 cuotas s/interés</p>
                          </div>
                        </>
                      ) : (
                        <p className="text-sm sm:text-lg font-bold" style={{ color: primaryColor }}>{fmtARS(Number(p.sale_price_ars))}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 mt-8">
        <div className="max-w-6xl mx-auto px-4 py-6 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            {logoUrl ? (
              <img src={logoUrl} alt={businessName} className="w-6 h-6 rounded object-cover" />
            ) : (
              <div className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold" style={{ background: primaryColor, color: '#0D0D1A' }}>
                {businessName.charAt(0)}
              </div>
            )}
            <span className="text-sm font-semibold" style={{ color: primaryColor }}>{businessName}</span>
          </div>
          <p className="text-[10px] text-white/25">Precios sujetos a cambios sin previo aviso · Stock disponible al momento de consulta</p>
          <p className="text-[10px] text-white/15 mt-1">Catálogo actualizado en tiempo real</p>
        </div>
      </footer>
    </div>
  );
}
