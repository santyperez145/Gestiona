import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getProductsDB, addProductDB, updateProductDB, deleteProductDB, getSettingsDB, formatARS, formatUSD, getCategoryLabel, getGenderLabel, calculateProductProfits } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, Search, Package, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const CATEGORY_COLORS: Record<string, string> = {
  perfume_arabe: 'bg-primary/15 text-primary',
  'perfume_diseñador': 'bg-accent/20 text-accent',
  vaper: 'bg-success/15 text-success',
  electronico: 'bg-warning/15 text-warning',
};
const GENDER_ICONS: Record<string, string> = { masculino: '♂', femenino: '♀', unisex: '⚥' };

export default function ProductsPage() {
  const { user } = useAuth();
  const [products, setProducts] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [filterStock, setFilterStock] = useState('all');

  const reload = async () => {
    if (!user) return;
    const [p, s] = await Promise.all([getProductsDB(user.id), getSettingsDB(user.id)]);
    setProducts(p);
    setSettings(s);
  };
  useEffect(() => { reload(); }, [user]);

  const filtered = products.filter(p => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.brand.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCat !== 'all' && p.category !== filterCat) return false;
    if (filterStock === 'instock' && p.stock <= 0) return false;
    if (filterStock === 'low' && (p.stock > 3 || p.stock <= 0)) return false;
    if (filterStock === 'out' && p.stock > 0) return false;
    return true;
  });

  const grouped = filtered.reduce<Record<string, any[]>>((acc, p) => {
    const key = p.brand || 'Sin marca';
    (acc[key] = acc[key] || []).push(p);
    return acc;
  }, {});

  const totalStock = filtered.reduce((s, p) => s + p.stock, 0);
  const totalValue = filtered.reduce((s, p) => s + (Number(p.total_cost_usd) * p.stock), 0);

  if (!settings) return <div className="flex justify-center py-20"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold">Productos</h1>
          <p className="text-muted-foreground text-sm">{filtered.length} productos · {totalStock} uds · Inversión: {formatUSD(totalValue)}</p>
        </div>
        <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold"><Plus className="w-4 h-4 mr-2" />Nuevo Producto</Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="font-display">{editing ? 'Editar' : 'Nuevo'} Producto</DialogTitle></DialogHeader>
            <ProductForm product={editing} settings={settings} userId={user!.id} onSave={() => { setOpen(false); setEditing(null); reload(); }} />
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 bg-muted border-border h-9 text-sm" />
        </div>
        <Select value={filterCat} onValueChange={setFilterCat}>
          <SelectTrigger className="w-[150px] bg-muted border-border h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas cat.</SelectItem>
            <SelectItem value="perfume_arabe">Árabe</SelectItem>
            <SelectItem value="perfume_diseñador">Diseñador</SelectItem>
            <SelectItem value="vaper">Vaper</SelectItem>
            <SelectItem value="electronico">Electrónico</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStock} onValueChange={setFilterStock}>
          <SelectTrigger className="w-[130px] bg-muted border-border h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todo stock</SelectItem>
            <SelectItem value="instock">En stock</SelectItem>
            <SelectItem value="low">Stock bajo</SelectItem>
            <SelectItem value="out">Sin stock</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!filtered.length ? (
        <div className="text-center py-20 text-muted-foreground">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg">{products.length ? 'Sin resultados' : 'No hay productos aún'}</p>
        </div>
      ) : (
        Object.entries(grouped).sort(([a],[b]) => a.localeCompare(b)).map(([brand, items]) => (
          <div key={brand} className="mb-6">
            <h2 className="text-sm font-display font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {brand} <span className="text-xs font-normal">({items.length} · {items.reduce((s: number, p: any) => s + p.stock, 0)} uds)</span>
            </h2>
            <div className="bg-card border border-border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left p-3 font-medium">Nombre</th>
                    <th className="text-center p-3 font-medium hidden sm:table-cell">Gen.</th>
                    <th className="text-left p-3 font-medium hidden md:table-cell">Cat.</th>
                    <th className="text-right p-3 font-medium">Costo</th>
                    <th className="text-right p-3 font-medium">Venta</th>
                    <th className="text-right p-3 font-medium">Ganancia</th>
                    <th className="text-right p-3 font-medium">Stock</th>
                    <th className="text-center p-3 font-medium">Acc.</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p: any) => (
                    <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="p-3 font-medium max-w-[200px] truncate">{p.name}</td>
                      <td className="p-3 text-center hidden sm:table-cell">{GENDER_ICONS[p.gender] || ''}</td>
                      <td className="p-3 hidden md:table-cell">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${CATEGORY_COLORS[p.category] || ''}`}>{getCategoryLabel(p.category)}</span>
                      </td>
                      <td className="p-3 text-right text-xs">{formatUSD(Number(p.cost_usd))}</td>
                      <td className="p-3 text-right font-medium text-xs">{Number(p.sale_price_ars) > 0 ? formatARS(Number(p.sale_price_ars)) : '—'}</td>
                      <td className="p-3 text-right">
                        <span className={`text-xs ${Number(p.profit_per_unit_ars) > 0 ? 'text-success' : 'text-destructive'}`}>{formatARS(Number(p.profit_per_unit_ars))}</span>
                      </td>
                      <td className="p-3 text-right">
                        {p.stock <= 0 ? <span className="text-xs text-muted-foreground">0</span> : p.stock <= 3 ? (
                          <span className="text-destructive font-bold flex items-center justify-end gap-1"><AlertTriangle className="w-3 h-3" />{p.stock}</span>
                        ) : <span className="text-success font-medium">{p.stock}</span>}
                      </td>
                      <td className="p-3 text-center space-x-1">
                        <Button variant="ghost" size="sm" onClick={() => { setEditing(p); setOpen(true); }}><Pencil className="w-3.5 h-3.5" /></Button>
                        <Button variant="ghost" size="sm" onClick={async () => { await deleteProductDB(p.id); reload(); toast.success("Eliminado"); }}>
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function ProductForm({ product, settings, userId, onSave }: { product: any; settings: any; userId: string; onSave: () => void }) {
  const [name, setName] = useState(product?.name || '');
  const [brand, setBrand] = useState(product?.brand || '');
  const [category, setCategory] = useState(product?.category || 'perfume_arabe');
  const [gender, setGender] = useState(product?.gender || 'masculino');
  const [costUSD, setCostUSD] = useState(product?.cost_usd?.toString() || '');
  const [salePriceARS, setSalePriceARS] = useState(product?.sale_price_ars?.toString() || '');
  const [discountPriceARS, setDiscountPriceARS] = useState(product?.discount_price_ars?.toString() || '');
  const [stock, setStock] = useState(product?.stock?.toString() || '0');

  const cost = parseFloat(costUSD) || 0;
  const salePrice = parseFloat(salePriceARS) || 0;
  const customsPercent = Number(settings?.customs_percent || settings?.customsPercent || 15);
  const exchangeRate = Number(settings?.exchange_rate || settings?.exchangeRate || 1695);
  const { customsFee, totalCostUSD, profitPerUnitARS, profitPerUnitUSD } = calculateProductProfits(cost, customsPercent, salePrice, exchangeRate);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !costUSD) { toast.error("Completá nombre y costo"); return; }
    const data = {
      name: name.trim(), brand: brand.trim(), category, gender,
      cost_usd: cost, customs_fee: customsFee, total_cost_usd: totalCostUSD,
      sale_price_ars: salePrice, discount_price_ars: parseFloat(discountPriceARS) || null,
      profit_per_unit_ars: profitPerUnitARS, profit_per_unit_usd: profitPerUnitUSD,
      stock: parseInt(stock) || 0,
    };
    if (product) {
      await updateProductDB(product.id, data);
    } else {
      await addProductDB({ ...data, user_id: userId });
    }
    toast.success(product ? "Producto actualizado" : "Producto agregado");
    onSave();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div><label className="text-sm text-muted-foreground">Nombre</label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Ej: LATTAFA KHAMRAH 100ML" className="bg-muted border-border" /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-sm text-muted-foreground">Marca</label><Input value={brand} onChange={e => setBrand(e.target.value)} className="bg-muted border-border" /></div>
        <div><label className="text-sm text-muted-foreground">Categoría</label>
          <Select value={category} onValueChange={setCategory}><SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="perfume_arabe">Perfume Árabe</SelectItem><SelectItem value="perfume_diseñador">Perfume Diseñador</SelectItem><SelectItem value="vaper">Vaper</SelectItem><SelectItem value="electronico">Electrónico</SelectItem></SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-sm text-muted-foreground">Costo USD</label><Input type="number" step="0.01" value={costUSD} onChange={e => setCostUSD(e.target.value)} className="bg-muted border-border" /></div>
        <div><label className="text-sm text-muted-foreground">Precio Venta ARS</label><Input type="number" value={salePriceARS} onChange={e => setSalePriceARS(e.target.value)} className="bg-muted border-border" /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-sm text-muted-foreground">Precio c/Desc ARS</label><Input type="number" value={discountPriceARS} onChange={e => setDiscountPriceARS(e.target.value)} placeholder="Opcional" className="bg-muted border-border" /></div>
        <div><label className="text-sm text-muted-foreground">Stock</label><Input type="number" value={stock} onChange={e => setStock(e.target.value)} className="bg-muted border-border" /></div>
      </div>
      {cost > 0 && salePrice > 0 && (
        <div className="bg-muted rounded-lg p-4 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Costo+Pasero:</span><span>{formatUSD(totalCostUSD)}</span></div>
          <div className="flex justify-between font-bold border-t border-border pt-1"><span>Ganancia/u:</span>
            <span className={profitPerUnitARS > 0 ? 'text-success' : 'text-destructive'}>{formatARS(profitPerUnitARS)} ({formatUSD(profitPerUnitUSD)})</span>
          </div>
        </div>
      )}
      <Button type="submit" className="w-full gradient-gold text-primary-foreground font-semibold">{product ? 'Guardar' : 'Agregar'}</Button>
    </form>
  );
}
