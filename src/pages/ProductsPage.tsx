import { useState, useEffect } from "react";
import { Product, ProductCategory, ProductGender } from "@/lib/types";
import { getProducts, addProduct, updateProduct, deleteProduct, formatARS, formatUSD, getSettings, getCategoryLabel, getGenderLabel, calculateProductProfits } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, Search, Filter, Package, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const CATEGORY_COLORS: Record<string, string> = {
  perfume_arabe: 'bg-primary/15 text-primary',
  'perfume_diseñador': 'bg-accent/20 text-accent',
  vaper: 'bg-success/15 text-success',
  electronico: 'bg-warning/15 text-warning',
};

const GENDER_ICONS: Record<string, string> = {
  masculino: '♂',
  femenino: '♀',
  unisex: '⚥',
};

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState<string>('all');
  const [filterGender, setFilterGender] = useState<string>('all');
  const [filterStock, setFilterStock] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table');

  const reload = () => setProducts(getProducts());
  useEffect(reload, []);

  const filtered = products.filter(p => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.brand.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCat !== 'all' && p.category !== filterCat) return false;
    if (filterGender !== 'all' && p.gender !== filterGender) return false;
    if (filterStock === 'instock' && p.stock <= 0) return false;
    if (filterStock === 'low' && (p.stock > 3 || p.stock <= 0)) return false;
    if (filterStock === 'out' && p.stock > 0) return false;
    return true;
  });

  const grouped = filtered.reduce<Record<string, Product[]>>((acc, p) => {
    const key = p.brand || 'Sin marca';
    (acc[key] = acc[key] || []).push(p);
    return acc;
  }, {});

  const totalStock = filtered.reduce((s, p) => s + p.stock, 0);
  const totalValue = filtered.reduce((s, p) => s + (p.totalCostUSD * p.stock), 0);
  const inStockCount = filtered.filter(p => p.stock > 0).length;

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold">Productos</h1>
          <p className="text-muted-foreground text-sm">
            {filtered.length} productos · {inStockCount} en stock · {totalStock} uds · Inversión: {formatUSD(totalValue)}
          </p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold"><Plus className="w-4 h-4 mr-2" />Nuevo Producto</Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle className="font-display">{editing ? 'Editar' : 'Nuevo'} Producto</DialogTitle></DialogHeader>
            <ProductForm product={editing} onSave={() => { setOpen(false); setEditing(null); reload(); }} />
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
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
        <Select value={filterGender} onValueChange={setFilterGender}>
          <SelectTrigger className="w-[120px] bg-muted border-border h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="masculino">♂ Masc.</SelectItem>
            <SelectItem value="femenino">♀ Fem.</SelectItem>
            <SelectItem value="unisex">⚥ Unisex</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStock} onValueChange={setFilterStock}>
          <SelectTrigger className="w-[130px] bg-muted border-border h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todo stock</SelectItem>
            <SelectItem value="instock">En stock</SelectItem>
            <SelectItem value="low">Stock bajo (≤3)</SelectItem>
            <SelectItem value="out">Sin stock</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!filtered.length ? (
        <div className="text-center py-20 text-muted-foreground">
          <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg">{products.length ? 'Sin resultados para estos filtros' : 'No hay productos aún'}</p>
          <p className="text-sm">Agregá tu primer producto para empezar</p>
        </div>
      ) : (
        Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([brand, items]) => (
          <div key={brand} className="mb-6">
            <h2 className="text-sm font-display font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              {brand} <span className="text-xs font-normal">({items.length} · {items.reduce((s, p) => s + p.stock, 0)} uds)</span>
            </h2>
            <div className="bg-card border border-border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="text-left p-3 font-medium">Nombre</th>
                    <th className="text-center p-3 font-medium hidden sm:table-cell">Gen.</th>
                    <th className="text-left p-3 font-medium hidden md:table-cell">Cat.</th>
                    <th className="text-right p-3 font-medium">Costo</th>
                    <th className="text-right p-3 font-medium hidden sm:table-cell">+Pasero</th>
                    <th className="text-right p-3 font-medium">Venta</th>
                    <th className="text-right p-3 font-medium hidden lg:table-cell">Desc.</th>
                    <th className="text-right p-3 font-medium">Ganancia</th>
                    <th className="text-right p-3 font-medium">Stock</th>
                    <th className="text-center p-3 font-medium">Acc.</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(p => (
                    <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="p-3 font-medium max-w-[200px] truncate">{p.name}</td>
                      <td className="p-3 text-center hidden sm:table-cell">{GENDER_ICONS[p.gender] || ''}</td>
                      <td className="p-3 hidden md:table-cell">
                        <span className={`px-2 py-0.5 rounded-full text-xs ${CATEGORY_COLORS[p.category] || ''}`}>
                          {getCategoryLabel(p.category)}
                        </span>
                      </td>
                      <td className="p-3 text-right text-xs">{formatUSD(p.costUSD)}</td>
                      <td className="p-3 text-right text-xs hidden sm:table-cell">{formatUSD(p.totalCostUSD)}</td>
                      <td className="p-3 text-right font-medium text-xs">{p.salePriceARS > 0 ? formatARS(p.salePriceARS) : <span className="text-muted-foreground">—</span>}</td>
                      <td className="p-3 text-right text-xs text-muted-foreground hidden lg:table-cell">{p.discountPriceARS ? formatARS(p.discountPriceARS) : '—'}</td>
                      <td className="p-3 text-right">
                        {p.salePriceARS > 0 ? (
                          <>
                            <span className={`text-xs ${p.profitPerUnitARS > 0 ? 'text-success' : 'text-destructive'}`}>
                              {formatARS(p.profitPerUnitARS)}
                            </span>
                            <span className="text-xs text-muted-foreground block">{formatUSD(p.profitPerUnitUSD)}</span>
                          </>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                      <td className="p-3 text-right">
                        {p.stock <= 0 ? (
                          <span className="text-xs text-muted-foreground">0</span>
                        ) : p.stock <= 3 ? (
                          <span className="text-destructive font-bold flex items-center justify-end gap-1">
                            <AlertTriangle className="w-3 h-3" />{p.stock}
                          </span>
                        ) : (
                          <span className="text-success font-medium">{p.stock}</span>
                        )}
                      </td>
                      <td className="p-3 text-center space-x-1">
                        <Button variant="ghost" size="sm" onClick={() => { setEditing(p); setOpen(true); }}>
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => { deleteProduct(p.id); reload(); toast.success("Eliminado"); }}>
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

function ProductForm({ product, onSave }: { product: Product | null; onSave: () => void }) {
  const settings = getSettings();
  const [name, setName] = useState(product?.name || '');
  const [brand, setBrand] = useState(product?.brand || '');
  const [category, setCategory] = useState<ProductCategory>(product?.category || 'perfume_arabe');
  const [gender, setGender] = useState<ProductGender>(product?.gender || 'masculino');
  const [costUSD, setCostUSD] = useState(product?.costUSD?.toString() || '');
  const [salePriceARS, setSalePriceARS] = useState(product?.salePriceARS?.toString() || '');
  const [discountPriceARS, setDiscountPriceARS] = useState(product?.discountPriceARS?.toString() || '');
  const [stock, setStock] = useState(product?.stock?.toString() || '0');

  const cost = parseFloat(costUSD) || 0;
  const salePrice = parseFloat(salePriceARS) || 0;
  const { customsFee, totalCostUSD, profitPerUnitARS, profitPerUnitUSD } = calculateProductProfits(
    cost, settings.customsPercent, salePrice, settings.exchangeRate
  );

  // Auto-suggest price when cost is entered
  const suggestPrice = () => {
    if (cost > 0 && salePrice === 0) {
      const suggested = Math.round(totalCostUSD * settings.exchangeRate * 1.95);
      setSalePriceARS(suggested.toString());
      setDiscountPriceARS(Math.round(suggested * 0.8).toString());
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !costUSD) { toast.error("Completá nombre y costo"); return; }
    const data: Product = {
      id: product?.id || crypto.randomUUID(),
      name: name.trim(),
      brand: brand.trim(),
      category,
      gender,
      costUSD: cost,
      customsFee,
      totalCostUSD,
      salePriceARS: salePrice,
      discountPriceARS: parseFloat(discountPriceARS) || undefined,
      profitPerUnitARS,
      profitPerUnitUSD,
      stock: parseInt(stock) || 0,
      createdAt: product?.createdAt || new Date().toISOString(),
    };
    if (product) updateProduct(data); else addProduct(data);
    toast.success(product ? "Producto actualizado" : "Producto agregado");
    onSave();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-sm text-muted-foreground">Nombre del Producto</label>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ej: LATTAFA KHAMRAH 100ML" className="bg-muted border-border" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm text-muted-foreground">Marca</label>
          <Input value={brand} onChange={e => setBrand(e.target.value)} placeholder="Ej: Lattafa" className="bg-muted border-border" />
        </div>
        <div>
          <label className="text-sm text-muted-foreground">Categoría</label>
          <Select value={category} onValueChange={(v: ProductCategory) => setCategory(v)}>
            <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="perfume_arabe">Perfume Árabe</SelectItem>
              <SelectItem value="perfume_diseñador">Perfume Diseñador</SelectItem>
              <SelectItem value="vaper">Vaper</SelectItem>
              <SelectItem value="electronico">Electrónico</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <label className="text-sm text-muted-foreground">Género</label>
        <Select value={gender} onValueChange={(v: ProductGender) => setGender(v)}>
          <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="masculino">♂ Masculino</SelectItem>
            <SelectItem value="femenino">♀ Femenino</SelectItem>
            <SelectItem value="unisex">⚥ Unisex</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm text-muted-foreground">Costo USD (sin pasero)</label>
          <Input type="number" step="0.01" value={costUSD} onChange={e => setCostUSD(e.target.value)} onBlur={suggestPrice} placeholder="0.00" className="bg-muted border-border" />
        </div>
        <div>
          <label className="text-sm text-muted-foreground">Costo + {settings.customsPercent}% Pasero</label>
          <div className="h-10 flex items-center px-3 rounded-md bg-muted border border-border text-sm">{formatUSD(totalCostUSD)}</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-sm text-muted-foreground">Precio Venta ARS</label>
          <Input type="number" step="1" value={salePriceARS} onChange={e => setSalePriceARS(e.target.value)} placeholder="0" className="bg-muted border-border" />
        </div>
        <div>
          <label className="text-sm text-muted-foreground">Precio c/Desc ARS</label>
          <Input type="number" step="1" value={discountPriceARS} onChange={e => setDiscountPriceARS(e.target.value)} placeholder="Opcional" className="bg-muted border-border" />
        </div>
        <div>
          <label className="text-sm text-muted-foreground">Stock</label>
          <Input type="number" value={stock} onChange={e => setStock(e.target.value)} placeholder="0" className="bg-muted border-border" />
        </div>
      </div>
      {cost > 0 && salePrice > 0 && (
        <div className="bg-muted rounded-lg p-4 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Costo total (con pasero):</span><span>{formatUSD(totalCostUSD)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Costo en pesos (TC: ${settings.exchangeRate}):</span><span>{formatARS(totalCostUSD * settings.exchangeRate)}</span></div>
          <div className="flex justify-between font-bold border-t border-border pt-1 mt-1">
            <span>Ganancia por unidad:</span>
            <span className={profitPerUnitARS > 0 ? 'text-success' : 'text-destructive'}>
              {formatARS(profitPerUnitARS)} ({formatUSD(profitPerUnitUSD)})
            </span>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Margen:</span>
            <span>{salePrice > 0 ? ((profitPerUnitARS / salePrice) * 100).toFixed(1) : 0}%</span>
          </div>
        </div>
      )}
      <Button type="submit" className="w-full gradient-gold text-primary-foreground font-semibold">
        {product ? 'Guardar Cambios' : 'Agregar Producto'}
      </Button>
    </form>
  );
}
