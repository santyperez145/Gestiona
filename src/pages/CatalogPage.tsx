import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getProductsDB, getSettingsDB, formatARS, getCategoryLabel, getGenderLabel } from "@/lib/supabaseStore";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Package, Tag } from "lucide-react";
import EmptyState from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/PageSkeleton";

const GENDER_ICONS: Record<string, string> = { masculino: '♂', femenino: '♀', unisex: '⚥' };

export default function CatalogPage() {
  const { user } = useAuth();
  const [products, setProducts] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [p, s] = await Promise.all([getProductsDB(user.id), getSettingsDB(user.id)]);
      setProducts(p.filter(x => x.stock > 0));
      setSettings(s);
      setLoading(false);
    })();
  }, [user]);

  const filtered = products.filter(p => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.brand.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCat !== 'all' && p.category !== filterCat) return false;
    return true;
  });

  if (loading) return <TableSkeleton rows={6} cols={4} />;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl md:text-3xl font-display font-bold">Catálogo</h1>
        <p className="text-muted-foreground text-sm">{filtered.length} productos disponibles</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar producto o marca..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 bg-muted border-border" />
        </div>
        <Select value={filterCat} onValueChange={setFilterCat}>
          <SelectTrigger className="w-[160px] bg-muted border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las categorías</SelectItem>
            <SelectItem value="perfume_arabe">Perfume Árabe</SelectItem>
            <SelectItem value="perfume_diseñador">Perfume Diseñador</SelectItem>
            <SelectItem value="vaper">Vaper</SelectItem>
            <SelectItem value="electronico">Electrónico</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!filtered.length ? (
        <EmptyState icon={Package} title="No hay productos disponibles" description="No se encontraron productos con stock." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map(p => (
            <div key={p.id} className="bg-card border border-border rounded-xl overflow-hidden hover:shadow-lg transition-shadow group">
              <div className="aspect-square bg-muted flex items-center justify-center relative">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                ) : (
                  <Package className="w-12 h-12 text-muted-foreground/30" />
                )}
                <div className="absolute top-2 right-2 flex gap-1">
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-background/80 backdrop-blur-sm font-medium">
                    {getCategoryLabel(p.category)}
                  </span>
                </div>
                {p.discount_price_ars && (
                  <div className="absolute top-2 left-2">
                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-destructive text-destructive-foreground font-bold flex items-center gap-1">
                      <Tag className="w-3 h-3" />OFERTA
                    </span>
                  </div>
                )}
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between mb-1">
                  <h3 className="font-semibold text-sm leading-tight flex-1">{p.name}</h3>
                  <span className="text-xs text-muted-foreground ml-2">{GENDER_ICONS[p.gender]}</span>
                </div>
                <p className="text-xs text-muted-foreground mb-3">{p.brand}</p>
                <div className="space-y-1">
                  {p.discount_price_ars ? (
                    <>
                      <div className="flex items-baseline gap-2">
                        <span className="text-lg font-bold text-primary">{formatARS(Number(p.discount_price_ars))}</span>
                        <span className="text-xs text-muted-foreground line-through">{formatARS(Number(p.sale_price_ars))}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">Efectivo / Transferencia</p>
                    </>
                  ) : (
                    <span className="text-lg font-bold text-primary">{formatARS(Number(p.sale_price_ars))}</span>
                  )}
                  <div className="flex items-center justify-between pt-2 border-t border-border">
                    <span className="text-xs text-muted-foreground">Stock: {p.stock} uds</span>
                    {getGenderLabel(p.gender) && (
                      <span className="text-[10px] text-muted-foreground">{getGenderLabel(p.gender)}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
