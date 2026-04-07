import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getProductsDB, addProductDB, updateProductDB, deleteProductDB, getSettingsDB, formatARS, formatUSD, getCategoryLabel, calculateProductProfits } from "@/lib/supabaseStore";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, Search, Package, AlertTriangle, ChevronLeft, ChevronRight, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import EmptyState from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/PageSkeleton";
import { logAudit } from "@/lib/auditLog";

const CATEGORY_COLORS: Record<string, string> = {
  perfume_arabe: 'bg-primary/15 text-primary',
  'perfume_diseñador': 'bg-accent/20 text-accent',
  vaper: 'bg-success/15 text-success',
  electronico: 'bg-warning/15 text-warning',
};
const GENDER_ICONS: Record<string, string> = { masculino: '♂', femenino: '♀', unisex: '⚥' };
const PAGE_SIZE = 30;

export default function ProductsPage() {
  const { user } = useAuth();
  const [products, setProducts] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [filterStock, setFilterStock] = useState('all');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [bulkOpen, setBulkOpen] = useState(false);

  const reload = async () => {
    if (!user) return;
    const [p, s] = await Promise.all([getProductsDB(user.id), getSettingsDB(user.id)]);
    setProducts(p); setSettings(s); setLoading(false);
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

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const grouped = paged.reduce<Record<string, any[]>>((acc, p) => {
    const key = p.brand || 'Sin marca';
    (acc[key] = acc[key] || []).push(p);
    return acc;
  }, {});

  const totalStock = filtered.reduce((s, p) => s + p.stock, 0);
  const totalValue = filtered.reduce((s, p) => s + (Number(p.total_cost_usd) * p.stock), 0);

  const handleDelete = async (p: any) => {
    await deleteProductDB(p.id);
    if (user) await logAudit(user.id, 'delete', 'product', p.id, { name: p.name });
    reload();
    toast.success("Producto eliminado");
  };

  if (loading) return <TableSkeleton rows={8} cols={8} />;

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 md:mb-6 gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-display font-bold">Productos</h1>
          <p className="text-muted-foreground text-sm">{filtered.length} productos · {totalStock} uds · Inversión: {formatUSD(totalValue)}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setBulkOpen(true)}>
            <TrendingUp className="w-4 h-4 mr-2" />Ajuste masivo
          </Button>
          <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) setEditing(null); }}>
            <DialogTrigger asChild>
              <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold"><Plus className="w-4 h-4 mr-2" />Nuevo</Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle className="font-display">{editing ? 'Editar' : 'Nuevo'} Producto</DialogTitle></DialogHeader>
              <ProductForm product={editing} settings={settings} userId={user!.id} onSave={() => { setOpen(false); setEditing(null); reload(); }} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Bulk price adjustment modal */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle className="font-display">Ajuste Masivo de Precios</DialogTitle></DialogHeader>
          <BulkPriceAdjust userId={user!.id} settings={settings} onDone={() => { setBulkOpen(false); reload(); }} />
        </DialogContent>
      </Dialog>

      <div className="flex flex-col sm:flex-row gap-2 mb-4 md:mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar..." value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} className="pl-9 bg-muted border-border h-9 text-sm" />
        </div>
        <div className="flex gap-2">
          <Select value={filterCat} onValueChange={v => { setFilterCat(v); setPage(0); }}>
            <SelectTrigger className="w-[130px] bg-muted border-border h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas cat.</SelectItem>
              <SelectItem value="perfume_arabe">Árabe</SelectItem>
              <SelectItem value="perfume_diseñador">Diseñador</SelectItem>
              <SelectItem value="vaper">Vaper</SelectItem>
              <SelectItem value="electronico">Electrónico</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterStock} onValueChange={v => { setFilterStock(v); setPage(0); }}>
            <SelectTrigger className="w-[120px] bg-muted border-border h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todo</SelectItem>
              <SelectItem value="instock">En stock</SelectItem>
              <SelectItem value="low">Stock bajo</SelectItem>
              <SelectItem value="out">Sin stock</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {!filtered.length ? (
        <EmptyState icon={Package} title={products.length ? 'Sin resultados' : 'No hay productos aún'} description="Agregá tu primer producto para empezar." actionLabel="Nuevo Producto" onAction={() => setOpen(true)} />
      ) : (
        <>
          {Object.entries(grouped).sort(([a],[b]) => a.localeCompare(b)).map(([brand, items]) => (
            <div key={brand} className="mb-6">
              <h2 className="text-sm font-display font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {brand} <span className="text-xs font-normal">({items.length} · {items.reduce((s: number, p: any) => s + p.stock, 0)} uds)</span>
              </h2>
              <div className="hidden md:block bg-card border border-border rounded-lg overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left p-3 font-medium">Nombre</th>
                      <th className="text-center p-3 font-medium">Gen.</th>
                      <th className="text-left p-3 font-medium">Cat.</th>
                      <th className="text-right p-3 font-medium">Costo</th>
                      <th className="text-right p-3 font-medium">Venta</th>
                      <th className="text-right p-3 font-medium">Oferta</th>
                      <th className="text-right p-3 font-medium">Ganancia</th>
                      <th className="text-right p-3 font-medium">Stock</th>
                      <th className="text-center p-3 font-medium">Acc.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((p: any) => (
                      <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="p-3 font-medium max-w-[200px] truncate">{p.name}</td>
                        <td className="p-3 text-center">{GENDER_ICONS[p.gender] || ''}</td>
                        <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-xs ${CATEGORY_COLORS[p.category] || ''}`}>{getCategoryLabel(p.category)}</span></td>
                        <td className="p-3 text-right text-xs">{formatUSD(Number(p.total_cost_usd))}</td>
                        <td className="p-3 text-right font-medium text-xs">{Number(p.sale_price_ars) > 0 ? formatARS(Number(p.sale_price_ars)) : '—'}</td>
                        <td className="p-3 text-right text-xs">{p.discount_price_ars ? <span className="text-warning">{formatARS(Number(p.discount_price_ars))}</span> : '—'}</td>
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
                          <ConfirmDialog
                            trigger={<Button variant="ghost" size="sm"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                            title="¿Eliminar producto?"
                            description={`Se eliminará "${p.name}" y no se podrá recuperar.`}
                            confirmText="Eliminar"
                            onConfirm={() => handleDelete(p)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="md:hidden space-y-2">
                {items.map((p: any) => (
                  <div key={p.id} className="bg-card border border-border rounded-lg p-3">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{p.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${CATEGORY_COLORS[p.category] || ''}`}>{getCategoryLabel(p.category)}</span>
                          <span className="text-xs text-muted-foreground">{GENDER_ICONS[p.gender]}</span>
                        </div>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditing(p); setOpen(true); }}><Pencil className="w-3 h-3" /></Button>
                        <ConfirmDialog
                          trigger={<Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Trash2 className="w-3 h-3 text-destructive" /></Button>}
                          title="¿Eliminar producto?"
                          confirmText="Eliminar"
                          onConfirm={() => handleDelete(p)}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div><span className="text-muted-foreground block">Costo</span><span>{formatUSD(Number(p.total_cost_usd))}</span></div>
                      <div><span className="text-muted-foreground block">Venta</span><span>{formatARS(Number(p.sale_price_ars))}</span></div>
                      <div><span className="text-muted-foreground block">Ganancia</span>
                        <span className={Number(p.profit_per_unit_ars) > 0 ? 'text-success' : 'text-destructive'}>{formatARS(Number(p.profit_per_unit_ars))}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
                      <span className="text-xs text-muted-foreground">Stock:</span>
                      {p.stock <= 0 ? <span className="text-xs text-muted-foreground">Sin stock</span> : p.stock <= 3 ? (
                        <span className="text-destructive text-xs font-bold flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{p.stock}</span>
                      ) : <span className="text-success text-xs font-medium">{p.stock} uds</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm text-muted-foreground">{page + 1} / {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </>
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
  const [description, setDescription] = useState(product?.description || '');
  const [manualSalePrice, setManualSalePrice] = useState(!!product);
  const [manualDiscountPrice, setManualDiscountPrice] = useState(!!product);

  const cost = parseFloat(costUSD) || 0;
  const salePrice = parseFloat(salePriceARS) || 0;
  const customsPercent = Number(settings?.customs_percent || 15);
  const exchangeRate = Number(settings?.exchange_rate || 1695);
  const defaultDiscount = Number(settings?.default_discount_percent || 40);

  // Computed auto values (always available for display)
  const autoSalePrice = cost > 0 ? Math.round((cost + cost * customsPercent / 100) * exchangeRate * 2) : 0;
  const currentSaleForDiscount = parseFloat(salePriceARS) || autoSalePrice;
  const autoDiscountPrice = currentSaleForDiscount > 0 ? Math.round(currentSaleForDiscount * (1 - defaultDiscount / 100)) : 0;

  // Auto-calculate sale price when cost changes (real-time)
  useEffect(() => {
    if (cost <= 0) return;
    if (!manualSalePrice) {
      setSalePriceARS(autoSalePrice.toString());
    }
  }, [cost, customsPercent, exchangeRate, manualSalePrice, autoSalePrice]);

  // Auto-calculate discount price when sale price changes (real-time)
  useEffect(() => {
    if (currentSaleForDiscount <= 0) return;
    if (!manualDiscountPrice) {
      setDiscountPriceARS(autoDiscountPrice.toString());
    }
  }, [currentSaleForDiscount, defaultDiscount, manualDiscountPrice, autoDiscountPrice]);

  const { customsFee, totalCostUSD, totalCostARS, profitPerUnitARS, profitPerUnitUSD } = calculateProductProfits(cost, customsPercent, salePrice, exchangeRate);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error("El nombre es obligatorio"); return; }
    if (cost <= 0) { toast.error("El costo debe ser mayor a 0"); return; }
    const data = {
      name: name.trim(), brand: brand.trim(), category, gender, description: description.trim() || null,
      cost_usd: cost, customs_fee: customsFee, total_cost_usd: totalCostUSD,
      sale_price_ars: salePrice, discount_price_ars: parseFloat(discountPriceARS) || null,
      profit_per_unit_ars: profitPerUnitARS, profit_per_unit_usd: profitPerUnitUSD,
      stock: parseInt(stock) || 0,
    };
    if (product) {
      await updateProductDB(product.id, data);
      await logAudit(userId, 'update', 'product', product.id, { name: name.trim(), changes: data });
    } else {
      await addProductDB({ ...data, user_id: userId });
      await logAudit(userId, 'create', 'product', undefined, { name: name.trim() });
    }
    toast.success(product ? "Producto actualizado" : "Producto agregado");
    onSave();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div><label className="text-sm text-muted-foreground">Nombre *</label><Input value={name} onChange={e => setName(e.target.value)} placeholder="Ej: LATTAFA KHAMRAH 100ML" className="bg-muted border-border" required /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-sm text-muted-foreground">Marca</label><Input value={brand} onChange={e => setBrand(e.target.value)} className="bg-muted border-border" /></div>
        <div><label className="text-sm text-muted-foreground">Categoría</label>
          <Select value={category} onValueChange={setCategory}><SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="perfume_arabe">Perfume Árabe</SelectItem><SelectItem value="perfume_diseñador">Perfume Diseñador</SelectItem><SelectItem value="vaper">Vaper</SelectItem><SelectItem value="electronico">Electrónico</SelectItem></SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-sm text-muted-foreground">Género</label>
          <Select value={gender} onValueChange={setGender}><SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="masculino">Masculino</SelectItem><SelectItem value="femenino">Femenino</SelectItem><SelectItem value="unisex">Unisex</SelectItem></SelectContent>
          </Select>
        </div>
        <div><label className="text-sm text-muted-foreground">Stock</label><Input type="number" min="0" value={stock} onChange={e => setStock(e.target.value)} className="bg-muted border-border" /></div>
      </div>
      <div>
        <label className="text-sm text-muted-foreground">Costo USD *</label>
        <Input type="number" step="0.01" min="0" value={costUSD} onChange={e => { setCostUSD(e.target.value); setManualSalePrice(false); setManualDiscountPrice(false); }} className="bg-muted border-border" required />
        {cost > 0 && (
          <p className="text-[10px] text-muted-foreground mt-1">
            Fórmula: [(${cost}+{customsPercent}%) × ${exchangeRate}] × 2 = {formatARS(autoSalePrice)} · -{defaultDiscount}% = {formatARS(autoDiscountPrice)}
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm text-muted-foreground">Precio Venta ARS</label>
            {manualSalePrice && cost > 0 && (
              <button type="button" onClick={() => setManualSalePrice(false)} className="text-[10px] text-primary hover:underline">Auto</button>
            )}
          </div>
          <Input type="number" min="0" value={salePriceARS} onChange={e => { setSalePriceARS(e.target.value); setManualSalePrice(true); }} className="bg-muted border-border" />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="text-sm text-muted-foreground">Precio c/Desc. ARS</label>
            {manualDiscountPrice && currentSaleForDiscount > 0 && (
              <button type="button" onClick={() => setManualDiscountPrice(false)} className="text-[10px] text-primary hover:underline">Auto</button>
            )}
          </div>
          <Input type="number" min="0" value={discountPriceARS} onChange={e => { setDiscountPriceARS(e.target.value); setManualDiscountPrice(true); }} placeholder="Auto-calculado" className="bg-muted border-border" />
        </div>
      </div>
      <div>
        <label className="text-sm text-muted-foreground">Descripción (opcional)</label>
        <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Notas sobre el producto" className="bg-muted border-border" />
      </div>
      {cost > 0 && salePrice > 0 && (
        <div className="bg-muted rounded-lg p-4 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Costo base:</span><span>{formatUSD(cost)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">+{customsPercent}% Pasero:</span><span className="text-warning">{formatUSD(customsFee)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Costo total:</span><span>{formatUSD(totalCostUSD)} = {formatARS(totalCostARS)}</span></div>
          <div className="flex justify-between font-bold border-t border-border pt-1"><span>Ganancia/u:</span>
            <span className={profitPerUnitARS > 0 ? 'text-success' : 'text-destructive'}>{formatARS(profitPerUnitARS)} ({formatUSD(profitPerUnitUSD)})</span>
          </div>
          {parseFloat(discountPriceARS) > 0 && (
            <div className="flex justify-between text-xs border-t border-border pt-1">
              <span className="text-muted-foreground">Ganancia c/desc:</span>
              <span className={parseFloat(discountPriceARS) - totalCostARS > 0 ? 'text-success' : 'text-destructive'}>
                {formatARS(parseFloat(discountPriceARS) - totalCostARS)}
              </span>
            </div>
          )}
        </div>
      )}
      <Button type="submit" className="w-full gradient-gold text-primary-foreground font-semibold">{product ? 'Guardar' : 'Agregar'}</Button>
    </form>
  );
}

function BulkPriceAdjust({ userId, settings, onDone }: { userId: string; settings: any; onDone: () => void }) {
  const [category, setCategory] = useState('all');
  const [percent, setPercent] = useState('');
  const [field, setField] = useState('both');
  const [loading, setLoading] = useState(false);

  const handleApply = async () => {
    const pct = parseFloat(percent);
    if (!pct || pct === 0) { toast.error("Ingresá un porcentaje válido"); return; }
    setLoading(true);
    try {
      const products = await getProductsDB(userId);
      const toUpdate = category === 'all' ? products : products.filter(p => p.category === category);
      let count = 0;
      for (const p of toUpdate) {
        const updates: any = {};
        if ((field === 'sale' || field === 'both') && Number(p.sale_price_ars) > 0) {
          updates.sale_price_ars = Math.round(Number(p.sale_price_ars) * (1 + pct / 100));
        }
        if ((field === 'discount' || field === 'both') && Number(p.discount_price_ars) > 0) {
          updates.discount_price_ars = Math.round(Number(p.discount_price_ars) * (1 + pct / 100));
        }
        // Recalculate profits
        if (updates.sale_price_ars !== undefined) {
          const exchangeRate = Number(settings?.exchange_rate || 1695);
          const { profitPerUnitARS, profitPerUnitUSD } = calculateProductProfits(
            Number(p.cost_usd), Number(settings?.customs_percent || 15), updates.sale_price_ars, exchangeRate
          );
          updates.profit_per_unit_ars = profitPerUnitARS;
          updates.profit_per_unit_usd = profitPerUnitUSD;
        }
        if (Object.keys(updates).length > 0) {
          await updateProductDB(p.id, updates);
          count++;
        }
      }
      toast.success(`${count} productos actualizados (${pct > 0 ? '+' : ''}${pct}%)`);
      onDone();
    } catch (err: any) {
      toast.error("Error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">Aplicar un porcentaje de aumento o descuento a los precios de venta.</p>
      <div>
        <label className="text-sm text-muted-foreground">Categoría</label>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las categorías</SelectItem>
            <SelectItem value="perfume_arabe">Perfume Árabe</SelectItem>
            <SelectItem value="perfume_diseñador">Perfume Diseñador</SelectItem>
            <SelectItem value="vaper">Vaper</SelectItem>
            <SelectItem value="electronico">Electrónico</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-sm text-muted-foreground">Campo a modificar</label>
        <Select value={field} onValueChange={setField}>
          <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="both">Venta + Descuento</SelectItem>
            <SelectItem value="sale">Solo Precio Venta</SelectItem>
            <SelectItem value="discount">Solo Precio Descuento</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-sm text-muted-foreground">Porcentaje (+ para subir, - para bajar)</label>
        <Input type="number" value={percent} onChange={e => setPercent(e.target.value)} placeholder="Ej: 10 o -15" className="bg-muted border-border" />
      </div>
      <Button onClick={handleApply} disabled={loading} className="w-full gradient-gold text-primary-foreground font-semibold">
        {loading ? 'Aplicando...' : 'Aplicar Ajuste'}
      </Button>
    </div>
  );
}
