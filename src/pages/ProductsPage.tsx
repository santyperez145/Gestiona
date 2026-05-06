import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { useEntitlements } from "@/lib/useEntitlements";
import UpgradePrompt from "@/components/shared/UpgradePrompt";
import { getProductsDB, addProductDB, updateProductDB, deleteProductDB, getSettingsDB, formatARS, formatUSD, getCategoryLabel, calculateProductProfits, getVariantsDB, addVariantDB, updateVariantDB, deleteVariantDB, syncProductStockFromVariants, getVariantsByUserDB } from "@/lib/supabaseStore";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, Search, Package, AlertTriangle, ChevronLeft, ChevronRight, TrendingUp, Upload, X, FileSpreadsheet, Clock, Star, Sparkles, Droplets, Layers } from "lucide-react";
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

async function exportProductsXLSX(products: any[], settings: any) {
  const { utils, writeFile } = await import('xlsx');
  const categories = [...new Set(products.map((p: any) => p.category))];
  const wb = utils.book_new();
  
  for (const cat of categories) {
    const catProducts = products.filter((p: any) => p.category === cat);
    const rows = catProducts.map((p: any) => ({
      'Nombre': p.name,
      'Marca': p.brand,
      'Género': p.gender,
      'Costo USD': Number(p.cost_usd),
      'Pasero USD': Number(p.customs_fee),
      'Costo Total USD': Number(p.total_cost_usd),
      'Precio Venta ARS': Number(p.sale_price_ars),
      'Precio Desc. ARS': Number(p.discount_price_ars) || '',
      'Ganancia ARS': Number(p.profit_per_unit_ars),
      'Stock': p.stock,
      'Última Mod.': new Date(p.updated_at).toLocaleDateString('es-AR'),
    }));
    const ws = utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 14 }, { wch: 8 }, { wch: 12 }];
    utils.book_append_sheet(wb, ws, getCategoryLabel(cat).substring(0, 31));
  }
  
  // All products sheet
  const allRows = products.map((p: any) => ({
    'Nombre': p.name, 'Marca': p.brand, 'Categoría': getCategoryLabel(p.category),
    'Costo USD': Number(p.total_cost_usd), 'Venta ARS': Number(p.sale_price_ars),
    'Desc. ARS': Number(p.discount_price_ars) || '', 'Ganancia ARS': Number(p.profit_per_unit_ars),
    'Stock': p.stock, 'Última Mod.': new Date(p.updated_at).toLocaleDateString('es-AR'),
  }));
  const wsAll = utils.json_to_sheet(allRows);
  wsAll['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 18 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 12 }];
  utils.book_append_sheet(wb, wsAll, 'Todos');
  
  writeFile(wb, `productos_exentry_${new Date().toISOString().slice(0, 10)}.xlsx`);
  toast.success('Excel exportado con hojas por categoría');
}

export default function ProductsPage() {
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const { productLimit, plan } = useEntitlements();
  const [products, setProducts] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [filterStock, setFilterStock] = useState('all');
  const [filterExpiry, setFilterExpiry] = useState('all');
  const [filterTag, setFilterTag] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [variantCounts, setVariantCounts] = useState<Record<string, number>>({});
  const [priceHistoryProduct, setPriceHistoryProduct] = useState<{ id: string; name: string } | null>(null);

  const reload = async () => {
    if (!user) return;
    const [p, s, allVariants] = await Promise.all([getProductsDB(user.id), getSettingsDB(user.id), getVariantsByUserDB(user.id)]);
    setProducts(p); setSettings(s); setLoading(false);
    const counts: Record<string, number> = {};
    allVariants.forEach((v: any) => { counts[v.product_id] = (counts[v.product_id] || 0) + 1; });
    setVariantCounts(counts);
  };
  useEffect(() => { reload(); }, [user]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const in30Days = new Date(today); in30Days.setDate(today.getDate() + 30);
  const in90Days = new Date(today); in90Days.setDate(today.getDate() + 90);

  const expiringSoon = products.filter(p => {
    if (!p.expiry_date) return false;
    const exp = new Date(p.expiry_date);
    return exp <= in30Days && p.stock > 0;
  });

  const filtered = products.filter(p => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.brand.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterCat !== 'all' && p.category !== filterCat) return false;
    if (filterStock === 'instock' && p.stock <= 0) return false;
    if (filterStock === 'low' && (p.stock > 3 || p.stock <= 0)) return false;
    if (filterStock === 'out' && p.stock > 0) return false;
    if (filterExpiry === 'expired') { if (!p.expiry_date || new Date(p.expiry_date) >= today) return false; }
    if (filterExpiry === 'soon30') { if (!p.expiry_date) return false; const exp = new Date(p.expiry_date); if (exp < today || exp > in30Days) return false; }
    if (filterExpiry === 'soon90') { if (!p.expiry_date) return false; const exp = new Date(p.expiry_date); if (exp < today || exp > in90Days) return false; }
    if (filterExpiry === 'has_expiry' && !p.expiry_date) return false;
    if (filterTag && !(p.tags || []).includes(filterTag)) return false;
    return true;
  });

  // Collect all unique tags from products for the filter dropdown
  const allTags = Array.from(new Set(products.flatMap((p: any) => p.tags || []))).sort();

  // Group first, then paginate by brand groups to avoid splitting a brand across pages
  const allGrouped = filtered.reduce<Record<string, any[]>>((acc, p) => {
    const rawKey = p.brand || 'Sin marca';
    const existingKey = Object.keys(acc).find(k => k.toLowerCase() === rawKey.toLowerCase());
    const key = existingKey || rawKey;
    (acc[key] = acc[key] || []).push(p);
    return acc;
  }, {});

  const brandKeys = Object.keys(allGrouped).sort((a, b) => a.localeCompare(b, 'es'));
  const totalPages = Math.ceil(brandKeys.length / PAGE_SIZE) || 1;
  const pagedBrandKeys = brandKeys.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const grouped = pagedBrandKeys.reduce<Record<string, any[]>>((acc, key) => {
    acc[key] = allGrouped[key];
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
           <p className="text-muted-foreground text-sm">
             {filtered.length} productos
             {productLimit !== null && <span className={`ml-1 font-medium ${products.length >= productLimit ? 'text-destructive' : products.length >= productLimit * 0.8 ? 'text-yellow-500' : ''}`}>({products.length}/{productLimit})</span>}
             {' '}· {totalStock} uds · Inversión: {formatUSD(totalValue)}
           </p>
         </div>
         <div className="flex gap-2">
           <Button variant="outline" size="sm" onClick={() => exportProductsXLSX(filtered, settings)}>
             <FileSpreadsheet className="w-4 h-4 mr-2" />Excel
           </Button>
           <Button variant="outline" onClick={() => setBulkOpen(true)}>
             <TrendingUp className="w-4 h-4 mr-2" />Ajuste masivo
           </Button>
           {productLimit !== null && products.length >= productLimit ? (
             <Button
               className="gradient-gold text-primary-foreground font-semibold shadow-gold"
               onClick={() => toast.error(`Límite de ${productLimit} productos alcanzado en el plan ${plan?.name}. Actualizá tu plan.`)}
             >
               <Plus className="w-4 h-4 mr-2" />Nuevo
             </Button>
           ) : (
             <Dialog open={open} onOpenChange={v => { setOpen(v); if (!v) setEditing(null); }}>
               <DialogTrigger asChild>
                 <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold"><Plus className="w-4 h-4 mr-2" />Nuevo</Button>
               </DialogTrigger>
               <DialogContent className="bg-card border-border max-h-[90vh] overflow-y-auto">
                 <DialogHeader><DialogTitle className="font-display">{editing ? 'Editar' : 'Nuevo'} Producto</DialogTitle></DialogHeader>
                 <ProductForm product={editing} settings={settings} userId={user!.id} orgId={activeOrg?.id} onSave={() => { setOpen(false); setEditing(null); reload(); }} />
               </DialogContent>
             </Dialog>
           )}
         </div>
      </div>

      {/* Bulk price adjustment modal */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="bg-card border-border max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="font-display">Ajuste Masivo de Precios</DialogTitle></DialogHeader>
          <BulkPriceAdjust userId={user!.id} settings={settings} onDone={() => { setBulkOpen(false); reload(); }} />
        </DialogContent>
      </Dialog>

      {/* Price history modal */}
      <PriceHistoryModal
        productId={priceHistoryProduct?.id || ""}
        productName={priceHistoryProduct?.name || ""}
        open={!!priceHistoryProduct}
        onClose={() => setPriceHistoryProduct(null)}
      />

      {expiringSoon.length > 0 && (
        <div className="mb-4 flex items-center gap-3 bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0" />
          <div className="flex-1 text-sm">
            <span className="font-semibold text-orange-400">{expiringSoon.length} producto{expiringSoon.length !== 1 ? 's' : ''} vence{expiringSoon.length !== 1 ? 'n' : ''} en menos de 30 días: </span>
            <span className="text-orange-300/80">{expiringSoon.slice(0, 3).map(p => p.name).join(', ')}{expiringSoon.length > 3 ? ` +${expiringSoon.length - 3}` : ''}</span>
          </div>
          <button onClick={() => setFilterExpiry('soon30')} className="text-xs text-orange-400 hover:underline shrink-0">Ver</button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2 mb-4 md:mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Buscar..." value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} className="pl-9 bg-muted border-border h-9 text-sm" />
        </div>
        <div className="flex gap-2 flex-wrap">
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
          <Select value={filterExpiry} onValueChange={v => { setFilterExpiry(v); setPage(0); }}>
            <SelectTrigger className="w-[130px] bg-muted border-border h-9 text-sm"><SelectValue placeholder="Vencimiento" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Venc.: Todos</SelectItem>
              <SelectItem value="has_expiry">Con vencimiento</SelectItem>
              <SelectItem value="soon30">Vence en 30 días</SelectItem>
              <SelectItem value="soon90">Vence en 90 días</SelectItem>
              <SelectItem value="expired">Vencidos</SelectItem>
            </SelectContent>
          </Select>
          {allTags.length > 0 && (
            <Select value={filterTag || '__all'} onValueChange={v => { setFilterTag(v === '__all' ? '' : v); setPage(0); }}>
              <SelectTrigger className="w-[120px] bg-muted border-border h-9 text-sm"><SelectValue placeholder="Etiqueta" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Etiquetas: todas</SelectItem>
                {allTags.map((t: string) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
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
                       <th className="text-center p-3 font-medium">Mod.</th>
                       <th className="text-center p-3 font-medium">Acc.</th>
                     </tr>
                  </thead>
                  <tbody>
                     {items.map((p: any) => (
                       <tr key={p.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                          <td className="p-3 font-medium max-w-[200px] truncate">
                            <div className="flex items-center gap-2">
                              {p.image_url && <img src={p.image_url} alt="" className="w-8 h-8 rounded object-cover" />}
                              <span className="truncate">{p.name}</span>
                              {p.featured && <Star className="w-3 h-3 text-primary shrink-0" fill="currentColor" />}
                              {variantCounts[p.id] > 0 && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-success/15 text-success shrink-0 flex items-center gap-0.5" title={`${variantCounts[p.id]} sabores/variantes`}>
                                  <Layers className="w-2.5 h-2.5" />{variantCounts[p.id]}
                                </span>
                              )}
                              {p.expiry_date && (() => {
                                const exp = new Date(p.expiry_date);
                                const isExpired = exp < today;
                                const isSoon = exp <= in30Days;
                                if (!isExpired && !isSoon) return null;
                                return (
                                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 ${isExpired ? 'bg-destructive/20 text-destructive' : 'bg-orange-500/20 text-orange-400'}`} title={`Vence: ${exp.toLocaleDateString('es-AR')}`}>
                                    {isExpired ? 'VENC.' : 'PROX.'}
                                  </span>
                                );
                              })()}
                              {(p.tags || []).slice(0, 2).map((t: string) => (
                                <span key={t} className="px-1.5 py-0.5 rounded-full text-[9px] bg-primary/10 text-primary shrink-0">{t}</span>
                              ))}
                            </div>
                          </td>
                         <td className="p-3 text-center">{GENDER_ICONS[p.gender] || ''}</td>
                         <td className="p-3"><span className={`px-2 py-0.5 rounded-full text-xs ${CATEGORY_COLORS[p.category] || ''}`}>{getCategoryLabel(p.category)}</span></td>
                         <td className="p-3 text-right text-xs">{formatUSD(Number(p.total_cost_usd))}</td>
                         <td className="p-3 text-right font-medium text-xs">{Number(p.sale_price_ars) > 0 ? formatARS(Number(p.sale_price_ars)) : '—'}</td>
                         <td className="p-3 text-right text-xs">{p.discount_price_ars ? <span className="text-warning">{formatARS(Number(p.discount_price_ars))}</span> : '—'}</td>
                         <td className="p-3 text-right">
                           {(() => {
                             const margin = Number(p.sale_price_ars) > 0 ? (Number(p.profit_per_unit_ars) / Number(p.sale_price_ars)) * 100 : 0;
                             const isLowMargin = margin < 30 && margin > 0;
                             return (
                               <span className={`text-xs flex items-center justify-end gap-1 ${Number(p.profit_per_unit_ars) > 0 ? (isLowMargin ? 'text-warning' : 'text-success') : 'text-destructive'}`}>
                                 {isLowMargin && <AlertTriangle className="w-3 h-3" />}
                                 {formatARS(Number(p.profit_per_unit_ars))}
                                 <span className="text-[10px] text-muted-foreground">({Math.round(margin)}%)</span>
                               </span>
                             );
                           })()}
                         </td>
                         <td className="p-3 text-right">
                           {p.stock <= 0 ? <span className="text-xs text-muted-foreground">0</span> : p.stock <= 3 ? (
                             <span className="text-destructive font-bold flex items-center justify-end gap-1"><AlertTriangle className="w-3 h-3" />{p.stock}</span>
                           ) : <span className="text-success font-medium">{p.stock}</span>}
                         </td>
                         <td className="p-3 text-center">
                           <span className="text-[10px] text-muted-foreground flex items-center justify-center gap-1" title={new Date(p.updated_at).toLocaleString('es-AR')}>
                             <Clock className="w-3 h-3" />
                             {new Date(p.updated_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}
                           </span>
                         </td>
                         <td className="p-3 text-center space-x-1">
                           <Button variant="ghost" size="sm" onClick={() => { setEditing(p); setOpen(true); }}><Pencil className="w-3.5 h-3.5" /></Button>
                           <Button variant="ghost" size="sm" title="Historial de precios" onClick={() => setPriceHistoryProduct({ id: p.id, name: p.name })}><Clock className="w-3.5 h-3.5 text-muted-foreground" /></Button>
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
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {p.image_url && <img src={p.image_url} alt="" className="w-10 h-10 rounded object-cover shrink-0" />}
                        <div className="min-w-0">
                          <p className="font-medium text-sm truncate">{p.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] ${CATEGORY_COLORS[p.category] || ''}`}>{getCategoryLabel(p.category)}</span>
                            <span className="text-xs text-muted-foreground">{GENDER_ICONS[p.gender]}</span>
                          </div>
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
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-muted-foreground">Stock:</span>
                        {p.stock <= 0 ? <span className="text-xs text-muted-foreground">Sin stock</span> : p.stock <= 3 ? (
                          <span className="text-destructive text-xs font-bold flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{p.stock}</span>
                        ) : <span className="text-success text-xs font-medium">{p.stock} uds</span>}
                      </div>
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(p.updated_at).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })}
                      </span>
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

function ProductForm({ product, settings, userId, orgId, onSave }: { product: any; settings: any; userId: string; orgId?: string; onSave: () => void }) {
  const [name, setName] = useState(product?.name || '');
  const [brand, setBrand] = useState(product?.brand || '');
  const [category, setCategory] = useState(product?.category || 'perfume_arabe');
  const [gender, setGender] = useState(product?.gender || 'masculino');
  const [costUSD, setCostUSD] = useState(product?.cost_usd?.toString() || '');
  const [salePriceARS, setSalePriceARS] = useState(product?.sale_price_ars?.toString() || '');
  const [discountPriceARS, setDiscountPriceARS] = useState(product?.discount_price_ars?.toString() || '');
  const [stock, setStock] = useState(product?.stock?.toString() || '0');
  const [description, setDescription] = useState(product?.description || '');
  const [featured, setFeatured] = useState(product?.featured || false);
  const [offerExpiresAt, setOfferExpiresAt] = useState(product?.offer_expires_at ? new Date(product.offer_expires_at).toISOString().slice(0, 16) : '');
  const [contentMl, setContentMl] = useState(product?.content_ml?.toString() || '100');
  const [barcode, setBarcode] = useState(product?.barcode || '');
  const [sku, setSku] = useState(product?.sku || '');
  const [lotNumber, setLotNumber] = useState(product?.lot_number || '');
  const [expiryDate, setExpiryDate] = useState(product?.expiry_date || '');
  const [tags, setTags] = useState<string[]>(product?.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [generatingDesc, setGeneratingDesc] = useState(false);
  const [manualSalePrice, setManualSalePrice] = useState(!!product);
  const [manualDiscountPrice, setManualDiscountPrice] = useState(!!product);
  // Multi-imagen: mezclar imagenes ya guardadas (urls) y archivos nuevos (File)
  const initialImages: string[] = (product?.image_urls && product.image_urls.length > 0)
    ? product.image_urls
    : (product?.image_url ? [product.image_url] : []);
  const [imageItems, setImageItems] = useState<Array<{ url: string; file?: File }>>(
    initialImages.map((u: string) => ({ url: u }))
  );
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Variants state
  const [variants, setVariants] = useState<any[]>([]);
  const [variantType, setVariantType] = useState(product?.variant_type || 'sabor');
  const [newVariantName, setNewVariantName] = useState('');
  const [newVariantStock, setNewVariantStock] = useState('0');
  const [bulkVariants, setBulkVariants] = useState('');
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showVariants, setShowVariants] = useState(false);

  const isVaper = category === 'vaper';
  const VARIANT_TYPE_LABELS: Record<string, string> = {
    sabor: 'Sabores', talle: 'Talles', color: 'Colores',
    medida: 'Medidas', otro: 'Variantes',
  };
  const variantLabel = VARIANT_TYPE_LABELS[variantType] || 'Variantes';

  useEffect(() => {
    if (product?.id) {
      getVariantsDB(product.id).then(v => {
        setVariants(v);
        if (v.length > 0) setShowVariants(true);
        if (v[0]?.variant_type) setVariantType(v[0].variant_type);
      });
    }
  }, [product?.id]);

  const cost = parseFloat(costUSD) || 0;
  const salePrice = parseFloat(salePriceARS) || 0;
  const customsPercent = Number(settings?.customs_percent || 15);
  const exchangeRate = Number(settings?.exchange_rate || 1695);
  const defaultDiscount = Number(settings?.default_discount_percent || 40);

  const autoSalePrice = cost > 0 ? Math.round((cost + cost * customsPercent / 100) * exchangeRate * 2) : 0;
  const currentSaleForDiscount = parseFloat(salePriceARS) || autoSalePrice;
  const autoDiscountPrice = currentSaleForDiscount > 0 ? Math.round(currentSaleForDiscount * (1 - defaultDiscount / 100)) : 0;

  useEffect(() => {
    if (cost <= 0) return;
    if (!manualSalePrice) setSalePriceARS(autoSalePrice.toString());
  }, [cost, customsPercent, exchangeRate, manualSalePrice, autoSalePrice]);

  useEffect(() => {
    if (currentSaleForDiscount <= 0) return;
    if (!manualDiscountPrice) setDiscountPriceARS(autoDiscountPrice.toString());
  }, [currentSaleForDiscount, defaultDiscount, manualDiscountPrice, autoDiscountPrice]);

  const { customsFee, totalCostUSD, totalCostARS, profitPerUnitARS, profitPerUnitUSD } = calculateProductProfits(cost, customsPercent, salePrice, exchangeRate);

  const addFiles = (files: File[]) => {
    const valid: Array<{ url: string; file: File }> = [];
    for (const f of files) {
      if (f.size > 10 * 1024 * 1024) { toast.error(`"${f.name}" supera 10MB`); continue; }
      if (!f.type.startsWith('image/')) continue;
      valid.push({ url: URL.createObjectURL(f), file: f });
    }
    if (valid.length === 0) return;
    setImageItems(prev => [...prev, ...valid].slice(0, 8));
  };
  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length === 0) return;
    addFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  const removeImageAt = (idx: number) => {
    setImageItems(prev => prev.filter((_, i) => i !== idx));
  };
  const moveImage = (from: number, to: number) => {
    setImageItems(prev => {
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      return next;
    });
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
      toast.success(`${files.length} imagen(es) pegada(s)`);
    }
  };

  const uploadAllImages = async (): Promise<string[]> => {
    if (imageItems.length === 0) return [];
    const toUpload = imageItems.filter(it => it.file);
    if (toUpload.length === 0) return imageItems.map(it => it.url);
    setUploading(true);
    try {
      const uploaded: Record<number, string> = {};
      await Promise.all(imageItems.map(async (it, idx) => {
        if (!it.file) { uploaded[idx] = it.url; return; }
        const ext = (it.file.name.split('.').pop() || 'jpg').toLowerCase();
        const path = `${userId}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage.from('product-images').upload(path, it.file, {
          cacheControl: '31536000',
          contentType: it.file.type || `image/${ext}`,
          upsert: false,
        });
        if (error) throw error;
        const { data: urlData } = supabase.storage.from('product-images').getPublicUrl(path);
        uploaded[idx] = urlData.publicUrl;
      }));
      return imageItems.map((_, i) => uploaded[i]);
    } catch (err: any) {
      toast.error('Error subiendo imagen: ' + err.message);
      return imageItems.map(it => it.url);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error("El nombre es obligatorio"); return; }
    if (cost <= 0) { toast.error("El costo debe ser mayor a 0"); return; }
    try {
      const urls = await uploadAllImages();
      const imageUrl = urls[0] || null;
      const variantTotal = showVariants && variants.length > 0
        ? variants.reduce((s, v) => s + (v.stock || 0), 0)
        : parseInt(stock) || 0;
      const data = {
        name: name.trim().toUpperCase(), brand: brand.trim().toUpperCase(), category, gender, description: description.trim() || null,
        cost_usd: cost, customs_fee: customsFee, total_cost_usd: totalCostUSD,
        sale_price_ars: salePrice, discount_price_ars: parseFloat(discountPriceARS) || null,
        profit_per_unit_ars: profitPerUnitARS, profit_per_unit_usd: profitPerUnitUSD,
        stock: variantTotal,
        image_url: imageUrl,
        image_urls: urls,
        featured,
        offer_expires_at: offerExpiresAt ? new Date(offerExpiresAt).toISOString() : null,
        content_ml: parseInt(contentMl) || 100,
      };
      let productId = product?.id;
      if (product) {
        await updateProductDB(product.id, data);
        await logAudit(userId, 'update', 'product', product.id, { name: data.name, changes: data });
      } else {
        productId = crypto.randomUUID();
        await addProductDB({ ...data, user_id: userId, id: productId });
        await logAudit(userId, 'create', 'product', productId, { name: data.name });
      }
      if (showVariants && productId) {
        const existingVariants = product?.id ? await getVariantsDB(product.id) : [];
        const existingIds = new Set(existingVariants.map((v: any) => v.id));
        const currentIds = new Set(variants.filter(v => v.id).map(v => v.id));
        for (const ev of existingVariants) {
          if (!currentIds.has(ev.id)) await deleteVariantDB(ev.id);
        }
        for (const v of variants) {
          if (v.id && existingIds.has(v.id)) {
            await updateVariantDB(v.id, { variant_name: v.variant_name, stock: v.stock, active: v.active !== false });
          } else if (v._new || !v.id) {
            await addVariantDB({ product_id: productId, user_id: userId, variant_name: v.variant_name, stock: v.stock, active: true, variant_type: variantType });
          }
        }
      }
      toast.success(product ? "Producto actualizado" : "Producto agregado");
      onSave();
    } catch (err: any) {
      console.error('Error guardando producto:', err);
      toast.error(err?.message || "Error al guardar el producto");
    }
  };

  return (
    <form onSubmit={handleSubmit} onPaste={handlePaste} className="space-y-4">
      {/* Image upload (multi) */}
      <div>
        <div className="flex items-center justify-between">
          <label className="text-sm text-muted-foreground">Imágenes del producto (HD, máx 8)</label>
          <span className="text-[10px] text-muted-foreground/60">La primera es la principal · arrastrá con ◀ ▶</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {imageItems.map((it, idx) => (
            <div key={idx} className="relative group">
              <img
                src={it.url}
                alt=""
                loading="lazy"
                decoding="async"
                className="w-20 h-20 rounded-lg object-cover border border-border"
              />
              {idx === 0 && (
                <span className="absolute -top-1.5 -left-1.5 px-1.5 rounded bg-primary text-[9px] font-bold text-primary-foreground">PPAL</span>
              )}
              <button type="button" onClick={() => removeImageAt(idx)} className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full w-5 h-5 flex items-center justify-center">
                <X className="w-3 h-3" />
              </button>
              <div className="absolute bottom-0 inset-x-0 flex justify-between px-1 opacity-0 group-hover:opacity-100 transition">
                <button type="button" onClick={() => moveImage(idx, idx - 1)} className="text-[10px] bg-black/60 text-white rounded px-1">◀</button>
                <button type="button" onClick={() => moveImage(idx, idx + 1)} className="text-[10px] bg-black/60 text-white rounded px-1">▶</button>
              </div>
            </div>
          ))}
          {imageItems.length < 8 && (
            <button type="button" onClick={() => fileInputRef.current?.click()} className="w-20 h-20 rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center text-muted-foreground hover:border-primary hover:text-primary transition-colors">
              <Upload className="w-5 h-5" />
              <span className="text-[10px] mt-0.5">Agregar</span>
            </button>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageSelect} className="hidden" />
        </div>
        <p className="text-[10px] text-muted-foreground/60 mt-1">Pegá imágenes con Ctrl+V · se mantienen en calidad original (sin recompresión).</p>
      </div>
      <div><label className="text-sm text-muted-foreground">Nombre *</label><Input value={name} onChange={e => setName(e.target.value.toUpperCase())} placeholder="Ej: LATTAFA KHAMRAH 100ML" className="bg-muted border-border uppercase" required /></div>
      <div className="grid grid-cols-2 gap-3">
        <div><label className="text-sm text-muted-foreground">Marca</label><Input value={brand} onChange={e => setBrand(e.target.value.toUpperCase())} className="bg-muted border-border uppercase" /></div>
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
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm text-muted-foreground">Descripción</label>
          <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Notas sobre el producto" className="bg-muted border-border" />
        </div>
        <div>
          <label className="text-sm text-muted-foreground">Contenido (ml)</label>
          <Input type="number" min="1" value={contentMl} onChange={e => setContentMl(e.target.value)} className="bg-muted border-border" />
        </div>
      </div>
      {/* Barcode & SKU */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm text-muted-foreground">Código de barras</label>
          <Input value={barcode} onChange={e => setBarcode(e.target.value)} placeholder="EAN-13, UPC..." className="bg-muted border-border font-mono text-sm" />
        </div>
        <div>
          <label className="text-sm text-muted-foreground">SKU interno</label>
          <Input value={sku} onChange={e => setSku(e.target.value)} placeholder="Ej: LAT-KHA-100" className="bg-muted border-border font-mono text-sm" />
        </div>
      </div>
      {/* Lot & Expiry */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm text-muted-foreground">N° de lote</label>
          <Input value={lotNumber} onChange={e => setLotNumber(e.target.value)} placeholder="Ej: LOT-2025-04" className="bg-muted border-border font-mono text-sm" />
        </div>
        <div>
          <label className="text-sm text-muted-foreground">Fecha de vencimiento</label>
          <Input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} className="bg-muted border-border text-sm" />
        </div>
      </div>
      {/* Tags */}
      <div>
        <label className="text-sm text-muted-foreground">Etiquetas</label>
        <div className="flex flex-wrap gap-1.5 mt-1 mb-2">
          {tags.map(t => (
            <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-primary/15 text-primary border border-primary/20">
              {t}
              <button type="button" onClick={() => setTags(tags.filter(x => x !== t))} className="hover:text-destructive ml-0.5">×</button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <Input
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => {
              if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
                e.preventDefault();
                const t = tagInput.trim().toLowerCase().replace(/[^a-z0-9áéíóúüñ-]/g, '');
                if (t && !tags.includes(t)) setTags([...tags, t]);
                setTagInput('');
              }
            }}
            placeholder="nuevo, importado, oferta... (Enter para agregar)"
            className="bg-muted border-border text-sm flex-1"
          />
          <Button type="button" variant="outline" size="sm" onClick={() => {
            const t = tagInput.trim().toLowerCase().replace(/[^a-z0-9áéíóúüñ-]/g, '');
            if (t && !tags.includes(t)) setTags([...tags, t]);
            setTagInput('');
          }}><Plus className="w-3.5 h-3.5" /></Button>
        </div>
        <div className="flex gap-1.5 mt-2 flex-wrap">
          {['nuevo', 'oferta', 'importado', 'exclusivo', 'temporada', 'agotándose'].filter(s => !tags.includes(s)).map(s => (
            <button key={s} type="button" onClick={() => setTags([...tags, s])}
              className="px-2 py-0.5 rounded-full text-[10px] bg-muted border border-border hover:border-primary/40 text-muted-foreground">
              + {s}
            </button>
          ))}
        </div>
      </div>

      {/* Variants — available for all categories */}
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={() => setShowVariants(!showVariants)}
          className="w-full flex items-center justify-between px-3 py-2.5 bg-muted/40 hover:bg-muted/70 transition-colors text-sm font-medium"
        >
          <span className="flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-success" />
            {variantLabel}
            {variants.length > 0 && <span className="text-xs text-success font-bold">({variants.length})</span>}
          </span>
          <span className="text-xs text-muted-foreground">{showVariants ? '▲' : '▼'}</span>
        </button>
      </div>
      {showVariants && (
        <div className="bg-muted/50 rounded-lg p-3 border border-border space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium flex items-center gap-1.5"><Layers className="w-3.5 h-3.5 text-success" />{variantLabel}</label>
              <select
                value={variantType}
                onChange={e => setVariantType(e.target.value)}
                className="text-[10px] bg-muted border border-border rounded px-1.5 py-0.5 text-muted-foreground"
              >
                <option value="sabor">Sabor</option>
                <option value="talle">Talle</option>
                <option value="color">Color</option>
                <option value="medida">Medida</option>
                <option value="otro">Otro</option>
              </select>
            </div>
            <button type="button" onClick={() => setShowBulkImport(!showBulkImport)} className="text-[10px] text-primary hover:underline">
              {showBulkImport ? 'Cerrar' : 'Importar lista'}
            </button>
          </div>
          {showBulkImport && (
            <div className="space-y-2">
              <Input value={bulkVariants} onChange={e => setBulkVariants(e.target.value)} placeholder="Menta, Frutilla, Uva Ice, Sandía..." className="bg-muted border-border text-xs" />
              <Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => {
                const names = bulkVariants.split(',').map(n => n.trim()).filter(Boolean);
                const existing = new Set(variants.map(v => v.variant_name.toLowerCase()));
                const newVars = names.filter(n => !existing.has(n.toLowerCase())).map(n => ({
                  variant_name: n, stock: 0, active: true, _new: true,
                }));
                setVariants([...variants, ...newVars]);
                setBulkVariants('');
                setShowBulkImport(false);
                if (newVars.length > 0) toast.success(`${newVars.length} sabores agregados`);
              }}>Agregar todos</Button>
            </div>
          )}
          <div className="flex gap-2">
            <Input value={newVariantName} onChange={e => setNewVariantName(e.target.value)} placeholder="Nombre del sabor" className="bg-muted border-border text-xs flex-1" />
            <Input type="number" min="0" value={newVariantStock} onChange={e => setNewVariantStock(e.target.value)} className="bg-muted border-border text-xs w-20" placeholder="Stock" />
            <Button type="button" variant="outline" size="sm" onClick={() => {
              if (!newVariantName.trim()) return;
              if (variants.some(v => v.variant_name.toLowerCase() === newVariantName.trim().toLowerCase())) {
                toast.error('Ese sabor ya existe'); return;
              }
              setVariants([...variants, { variant_name: newVariantName.trim(), stock: parseInt(newVariantStock) || 0, active: true, _new: true }]);
              setNewVariantName(''); setNewVariantStock('0');
            }}><Plus className="w-3 h-3" /></Button>
          </div>
          {variants.length > 0 && (
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {variants.map((v, i) => (
                <div key={v.id || `new-${i}`} className="flex items-center gap-2 bg-card rounded p-2 border border-border">
                  <span className="text-xs font-medium flex-1 truncate">{v.variant_name}</span>
                  <Input type="number" min="0" value={String(v.stock)} onChange={e => {
                    const updated = [...variants];
                    updated[i] = { ...updated[i], stock: parseInt(e.target.value) || 0 };
                    setVariants(updated);
                  }} className="bg-muted border-border text-xs w-16 h-7" />
                  <span className="text-[10px] text-muted-foreground">uds</span>
                  <Button type="button" variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => {
                    setVariants(variants.filter((_, j) => j !== i));
                  }}><Trash2 className="w-3 h-3 text-destructive" /></Button>
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground mt-1">
                Stock total (suma de variantes): <span className="font-bold text-success">{variants.reduce((s, v) => s + (v.stock || 0), 0)}</span>
              </p>
            </div>
          )}
        </div>
      )}
      {(category === 'perfume_arabe' || category === 'perfume_diseñador') && (
        <Button type="button" variant="outline" size="sm" disabled={generatingDesc || !name.trim()} className="text-xs"
          onClick={async () => {
            setGeneratingDesc(true);
            try {
              const { data, error } = await supabase.functions.invoke('generate-description', {
                body: { name: name.trim(), brand: brand.trim(), category, gender }
              });
              if (error) throw error;
              if (data?.description) { setDescription(data.description); toast.success('Descripción generada con IA'); }
            } catch (err: any) { toast.error('Error generando descripción: ' + (err.message || 'Error desconocido')); }
            finally { setGeneratingDesc(false); }
          }}>
          <Sparkles className="w-3 h-3 mr-1" />{generatingDesc ? 'Generando...' : 'Generar con IA'}
        </Button>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-center gap-2 bg-muted rounded-lg p-3 border border-border">
          <input type="checkbox" checked={featured} onChange={e => setFeatured(e.target.checked)} id="featured" className="rounded" />
          <label htmlFor="featured" className="text-sm flex items-center gap-1 cursor-pointer">
            <Star className="w-3.5 h-3.5 text-primary" />Destacado
          </label>
        </div>
        <div>
          <label className="text-sm text-muted-foreground">Oferta hasta</label>
          <Input type="datetime-local" value={offerExpiresAt} onChange={e => setOfferExpiresAt(e.target.value)} className="bg-muted border-border text-xs" />
        </div>
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
      <Button type="submit" disabled={uploading} className="w-full gradient-gold text-primary-foreground font-semibold">{uploading ? 'Subiendo imagen...' : product ? 'Guardar' : 'Agregar'}</Button>
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

// ─────────────────────────────────────────────────────────────
// Price History Modal
// ─────────────────────────────────────────────────────────────
export function PriceHistoryModal({ productId, productName, open, onClose }: {
  productId: string; productName: string; open: boolean; onClose: () => void;
}) {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !productId) return;
    setLoading(true);
    supabase
      .from("price_history" as any)
      .select("*")
      .eq("product_id", productId)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setHistory((data || []) as any[]);
        setLoading(false);
      });
  }, [open, productId]);

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="bg-card border-border max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-sm">Historial de precios — {productName}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-sm text-muted-foreground text-center py-6">Cargando…</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Sin cambios de precio registrados aún.<br />Los cambios futuros aparecerán acá automáticamente.</p>
        ) : (
          <div className="space-y-2">
            {history.map((h: any) => {
              const pct = Number(h.change_pct);
              const up = pct > 0;
              return (
                <div key={h.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border/40 text-xs">
                  <div className="flex-1 min-w-0">
                    <p className="text-muted-foreground">{new Date(h.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" })}</p>
                    <p className="font-medium">
                      {h.old_price_ars ? formatARS(Number(h.old_price_ars)) : "—"} → <span className="text-primary font-bold">{formatARS(Number(h.new_price_ars))}</span>
                    </p>
                  </div>
                  {h.change_pct != null && (
                    <span className={`font-bold shrink-0 ${up ? "text-success" : "text-destructive"}`}>
                      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
