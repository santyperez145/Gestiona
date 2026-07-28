import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { useUserRole } from "@/lib/useUserRole";
import { toast } from "sonner";
import {
  Package, Plus, X, Save, Search, Trash2, Edit2, CheckCircle,
  DollarSign, ShoppingBag, TrendingUp, AlertTriangle, Layers,
  ChevronDown, ChevronUp, Star, Tag, RefreshCw, Info, Loader2
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast as toastFn } from "sonner";

interface Bundle {
  id: string;
  name: string;
  description: string | null;
  sale_price: number;
  active: boolean;
  featured: boolean;
  sold_count: number;
  created_at: string;
  items?: BundleItem[];
}

interface BundleItem {
  id: string;
  bundle_id: string;
  product_id: string;
  quantity: number;
  product?: {
    name: string;
    sale_price_ars: number;
    stock: number;
    image_url: string | null;
  };
}

interface Product {
  id: string;
  name: string;
  sale_price_ars: number;
  stock: number;
  image_url: string | null;
  category: string;
}

const emptyForm = () => ({
  name: '', description: '', sale_price: '', active: true, featured: false,
});

export default function ProductBundlesPage() {
  usePageTitle("Bundles / Kits");
  const { activeOrg } = useOrg();
  const { isAdmin } = useUserRole();
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Bundle | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  // Item management
  const [productSearch, setProductSearch] = useState('');
  const [addItemQty, setAddItemQty] = useState('1');
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [addingItemFor, setAddingItemFor] = useState<string | null>(null);

  const load = async () => {
    if (!activeOrg?.id) return;
    setLoading(true);
    try {
      const [bundlesRes, productsRes] = await Promise.all([
        supabase.from("product_bundles").select(`
          id, name, description, sale_price, active, featured, sold_count, created_at,
          product_bundle_items(id, bundle_id, product_id, quantity,
            products:product_id(name, sale_price_ars, stock, image_url))
        `).eq("org_id", activeOrg.id).order("created_at", { ascending: false }),
        supabase.from("products").select("id, name, sale_price_ars, stock, image_url, category")
          .eq("org_id", activeOrg.id).order("name"),
      ]);
      if (bundlesRes.error) throw bundlesRes.error;
      if (productsRes.error) throw productsRes.error;
      setBundles((bundlesRes.data ?? []).map((b: any) => ({
        ...b,
        items: (b.product_bundle_items ?? []).map((i: any) => ({
          ...i, product: i.products ?? undefined,
        })),
      })));
      setProducts(productsRes.data ?? []);
    } catch (e: any) {
      toast.error("Error: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [activeOrg?.id]);

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("El nombre es obligatorio"); return; }
    if (!form.sale_price || parseFloat(form.sale_price) <= 0) { toast.error("El precio de venta es obligatorio"); return; }
    if (!activeOrg?.id) return;
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        sale_price: parseFloat(form.sale_price),
        active: form.active,
        featured: form.featured,
      };
      if (editing) {
        const { error } = await supabase.from("product_bundles").update(payload).eq("id", editing.id);
        if (error) throw error;
        toast.success("Bundle actualizado");
      } else {
        const { error } = await supabase.from("product_bundles").insert({ ...payload, org_id: activeOrg.id });
        if (error) throw error;
        toast.success("Bundle creado");
      }
      setShowForm(false);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteBundle = async (id: string) => {
    if (!confirm("¿Eliminar este bundle?")) return;
    await supabase.from("product_bundles").delete().eq("id", id);
    load();
    toast.success("Bundle eliminado");
  };

  const addItem = async (bundleId: string) => {
    if (!selectedProduct) { toast.error("Seleccioná un producto"); return; }
    const qty = parseInt(addItemQty) || 1;
    const { error } = await supabase.from("product_bundle_items").upsert({
      bundle_id: bundleId, product_id: selectedProduct.id, quantity: qty,
    }, { onConflict: 'bundle_id,product_id' });
    if (error) { toast.error(error.message); return; }
    toast.success(`${selectedProduct.name} × ${qty} agregado`);
    setSelectedProduct(null); setAddItemQty('1'); setProductSearch('');
    load();
  };

  const removeItem = async (itemId: string) => {
    await supabase.from("product_bundle_items").delete().eq("id", itemId);
    load();
  };

  const toggleActive = async (b: Bundle) => {
    await supabase.from("product_bundles").update({ active: !b.active }).eq("id", b.id);
    load();
  };

  const filteredProducts = useMemo(() =>
    products.filter(p => p.name.toLowerCase().includes(productSearch.toLowerCase())).slice(0, 8),
    [products, productSearch]
  );

  const filteredBundles = useMemo(() =>
    bundles.filter(b => !search || b.name.toLowerCase().includes(search.toLowerCase())),
    [bundles, search]
  );

  // Compute bundle component cost from items
  const componentCost = (items: BundleItem[] = []) =>
    items.reduce((s, i) => s + (i.product?.sale_price_ars ?? 0) * i.quantity, 0);

  const hasStock = (items: BundleItem[] = []) =>
    items.every(i => (i.product?.stock ?? 0) >= i.quantity);

  const savings = (bundle: Bundle) => {
    const cost = componentCost(bundle.items);
    if (!cost) return 0;
    return Math.max(0, cost - bundle.sale_price);
  };

  const kpis = useMemo(() => {
    const active = bundles.filter(b => b.active).length;
    const totalSold = bundles.reduce((s, b) => s + b.sold_count, 0);
    const featured = bundles.filter(b => b.featured).length;
    const outStock = bundles.filter(b => !hasStock(b.items)).length;
    return { active, totalSold, featured, outStock };
  }, [bundles]);

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Layers}
        title="Bundles / Kits"
        description="Productos agrupados que se venden como uno · stock se deduce de cada componente"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            {isAdmin && (
              <Button className="gradient-gold text-primary-foreground gap-2"
                onClick={() => { setEditing(null); setForm(emptyForm()); setShowForm(true); }}>
                <Plus className="w-4 h-4" /> Nuevo bundle
              </Button>
            )}
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPICard label="Activos" value={kpis.active} icon={Layers} color="primary" />
        <KPICard label="Total Vendidos" value={kpis.totalSold} icon={ShoppingBag} color="success" />
        <KPICard label="Destacados" value={kpis.featured} icon={Star} color="warning" />
        <KPICard label="Sin stock" value={kpis.outStock} icon={AlertTriangle} color={kpis.outStock > 0 ? "destructive" : "success"} />
      </div>

      {/* Info */}
      <div className="flex items-start gap-3 p-3.5 rounded-xl bg-indigo-500/5 border border-indigo-500/15 text-sm">
        <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
        <p className="text-muted-foreground">
          Los bundles permiten vender múltiples productos como un solo ítem.
          Al vender un bundle, el stock de cada componente se descuenta automáticamente.
          Podés mostrar el ahorro respecto a comprar los productos individualmente.
        </p>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground/50" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar bundle..." className="pl-8 bg-muted" />
      </div>

      {/* Form dialog */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-card border border-border/60 rounded-xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="font-display font-bold">{editing ? 'Editar bundle' : 'Nuevo bundle'}</h2>
              <button onClick={() => setShowForm(false)}><X className="w-4 h-4 text-muted-foreground" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Nombre *</label>
                <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="bg-muted" placeholder="Ej: Kit de Bienvenida, Pack Premium..." autoFocus />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Descripción</label>
                <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="bg-muted resize-none" rows={2} placeholder="¿Qué incluye este bundle?" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Precio de venta *</label>
                <Input type="number" value={form.sale_price} onChange={e => setForm(f => ({ ...f, sale_price: e.target.value }))} className="bg-muted" placeholder="Precio final del bundle en ARS" />
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} className="w-4 h-4 accent-primary" />
                  Activo
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input type="checkbox" checked={form.featured} onChange={e => setForm(f => ({ ...f, featured: e.target.checked }))} className="w-4 h-4 accent-primary" />
                  <Star className="w-3.5 h-3.5 text-amber-400" /> Destacado
                </label>
              </div>
            </div>
            <div className="flex gap-2 px-5 pb-5">
              <Button variant="outline" className="flex-1" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button className="flex-1 gradient-gold text-primary-foreground gap-1.5" onClick={handleSave} disabled={saving}>
                {saving ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <Save className="w-4 h-4" />}
                {editing ? 'Guardar' : 'Crear bundle'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Bundle list */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-7 h-7 animate-spin text-primary" />
        </div>
      ) : filteredBundles.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No hay bundles creados.</p>
          <p className="text-sm mt-1">Creá tu primer kit o combo de productos.</p>
        </div>
      ) : (
        <div className="space-y-3 pb-12">
          {filteredBundles.map(bundle => {
            const isExpanded = expandedId === bundle.id;
            const compCost = componentCost(bundle.items);
            const saving = savings(bundle);
            const inStock = hasStock(bundle.items);
            const itemCount = bundle.items?.length ?? 0;
            return (
              <div key={bundle.id} className={`bg-card border rounded-xl overflow-hidden transition-all ${bundle.active ? 'border-border' : 'border-border/40 opacity-60'}`}>
                {/* Header row */}
                <div className="p-4 flex items-center gap-3">
                  {/* Expand */}
                  <button onClick={() => setExpandedId(isExpanded ? null : bundle.id)} className="flex-1 text-left">
                    <div className="flex items-center gap-2 mb-1">
                      {bundle.featured && <Star className="w-3.5 h-3.5 text-amber-400" />}
                      <p className="font-semibold text-sm">{bundle.name}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${inStock ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
                        {inStock ? '✓ Stock OK' : '⚠ Sin stock'}
                      </span>
                      {!bundle.active && <span className="text-[10px] text-muted-foreground">(inactivo)</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{itemCount} productos</span>
                      {compCost > 0 && (
                        <span className="text-emerald-400">Ahorro: ${saving.toLocaleString("es-AR")}</span>
                      )}
                      {bundle.sold_count > 0 && <span>{bundle.sold_count} vendidos</span>}
                    </div>
                  </button>

                  {/* Price */}
                  <div className="text-right shrink-0">
                    <p className="font-bold text-lg">${bundle.sale_price.toLocaleString("es-AR")}</p>
                    {compCost > 0 && (
                      <p className="text-xs text-muted-foreground line-through">${compCost.toLocaleString("es-AR")}</p>
                    )}
                  </div>

                  {/* Actions */}
                  {isAdmin && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => toggleActive(bundle)}
                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${bundle.active ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-muted-foreground hover:bg-muted/50'}`}
                        title={bundle.active ? 'Desactivar' : 'Activar'}
                      >
                        <CheckCircle className="w-4 h-4" />
                      </button>
                      <button onClick={() => { setEditing(bundle); setForm({ name: bundle.name, description: bundle.description ?? '', sale_price: bundle.sale_price.toString(), active: bundle.active, featured: bundle.featured }); setShowForm(true); }}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => deleteBundle(bundle.id)} className="w-8 h-8 rounded-lg flex items-center justify-center text-destructive/50 hover:text-destructive hover:bg-destructive/8">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  <button onClick={() => setExpandedId(isExpanded ? null : bundle.id)} className="text-muted-foreground/40 shrink-0">
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>

                {/* Expanded: component list + add */}
                {isExpanded && (
                  <div className="border-t border-border bg-muted/20 p-4 space-y-3">
                    {bundle.description && (
                      <p className="text-sm text-muted-foreground">{bundle.description}</p>
                    )}

                    {/* Components */}
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Componentes</p>
                      {(bundle.items ?? []).length === 0 ? (
                        <p className="text-xs text-muted-foreground/50 italic">Sin componentes. Agregá productos al bundle.</p>
                      ) : (
                        <div className="space-y-1.5">
                          {(bundle.items ?? []).map(item => (
                            <div key={item.id} className="flex items-center gap-3 bg-card rounded-lg px-3 py-2">
                              {item.product?.image_url && (
                                <img src={item.product.image_url} alt="" className="w-8 h-8 rounded object-cover" />
                              )}
                              <span className="flex-1 text-sm font-medium">{item.product?.name ?? item.product_id}</span>
                              <span className="text-xs text-muted-foreground">× {item.quantity}</span>
                              <span className="text-xs text-muted-foreground">Stock: {item.product?.stock ?? 0}</span>
                              <span className="text-sm font-semibold">${((item.product?.sale_price_ars ?? 0) * item.quantity).toLocaleString("es-AR")}</span>
                              {isAdmin && (
                                <button onClick={() => removeItem(item.id)} className="text-destructive/50 hover:text-destructive">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          ))}
                          <div className="flex justify-between text-sm font-bold pt-1 border-t border-border px-1">
                            <span>Precio individual total</span>
                            <span>${compCost.toLocaleString("es-AR")}</span>
                          </div>
                          {saving > 0 && (
                            <div className="flex justify-between text-sm text-emerald-400 font-semibold px-1">
                              <span>Ahorro en el bundle</span>
                              <span>-${saving.toLocaleString("es-AR")}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Add component */}
                    {isAdmin && (
                      <div className="border border-dashed border-border/50 rounded-lg p-3 space-y-2">
                        <p className="text-xs font-semibold text-muted-foreground">Agregar producto al bundle</p>
                        <div className="relative">
                          <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground/50" />
                          <Input
                            value={productSearch}
                            onChange={e => { setProductSearch(e.target.value); setSelectedProduct(null); }}
                            placeholder="Buscar producto..."
                            className="pl-8 bg-muted text-xs h-8"
                          />
                        </div>
                        {productSearch && !selectedProduct && (
                          <div className="bg-card border border-border rounded-lg overflow-hidden max-h-40 overflow-y-auto">
                            {filteredProducts.map(p => (
                              <button
                                key={p.id}
                                onClick={() => { setSelectedProduct(p); setProductSearch(p.name); }}
                                className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 text-left"
                              >
                                <span className="flex-1 text-xs">{p.name}</span>
                                <span className="text-xs text-muted-foreground">${p.sale_price_ars.toLocaleString("es-AR")}</span>
                                <span className="text-xs text-muted-foreground">Stock: {p.stock}</span>
                              </button>
                            ))}
                            {filteredProducts.length === 0 && (
                              <p className="text-xs text-muted-foreground/50 p-3">Sin resultados</p>
                            )}
                          </div>
                        )}
                        {selectedProduct && (
                          <div className="flex items-center gap-2">
                            <span className="flex-1 text-xs text-foreground truncate">
                              ✓ {selectedProduct.name} (${selectedProduct.sale_price_ars.toLocaleString("es-AR")})
                            </span>
                            <Input
                              type="number" min="1"
                              value={addItemQty}
                              onChange={e => setAddItemQty(e.target.value)}
                              className="w-16 bg-muted text-xs h-8"
                              placeholder="Cant."
                            />
                            <Button size="sm" className="h-8 gradient-gold text-primary-foreground text-xs" onClick={() => addItem(bundle.id)}>
                              Agregar
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
