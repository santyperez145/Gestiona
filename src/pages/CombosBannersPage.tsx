import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { listCombos, createCombo, updateCombo, deleteCombo, listBanners, createBanner, updateBanner, deleteBanner } from "@/lib/marketingExtraDB";
import { getProductsDB, formatARS } from "@/lib/supabaseStore";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Package, Image as ImageIcon, Plus, Edit, Trash2, Sparkles, Layers, Minus, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import PageHeader from "@/components/shared/PageHeader";
import { usePageTitle } from "@/hooks/usePageTitle";

export default function CombosBannersPage() {
  usePageTitle("Combos & Banners");
  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Sparkles}
        title="Combos & Banners"
        description="Crea combos promocionales, kits ERP y banners para tu catálogo"
      />
      <Tabs defaultValue="kits">
        <TabsList className="mb-4">
          <TabsTrigger value="kits"><Layers className="w-4 h-4 mr-2" />Kits ERP</TabsTrigger>
          <TabsTrigger value="combos"><Package className="w-4 h-4 mr-2" />Combos</TabsTrigger>
          <TabsTrigger value="banners"><ImageIcon className="w-4 h-4 mr-2" />Banners</TabsTrigger>
        </TabsList>
        <TabsContent value="kits"><BundlesTab /></TabsContent>
        <TabsContent value="combos"><CombosTab /></TabsContent>
        <TabsContent value="banners"><BannersTab /></TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Kits ERP (product_bundles) ───────────────────────────────────────────────

interface BundleItem {
  product_id: string;
  quantity: number;
}

interface Bundle {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  price_ars: number;
  is_active: boolean;
  created_at: string;
  bundle_items?: { product_id: string; quantity: number }[];
}

function BundlesTab() {
  const { activeOrg } = useOrg();
  const { user } = useAuth();
  const orgId = activeOrg?.id;
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    if (!orgId || !user) return;
    setLoading(true);
    const [{ data: bl }, prods] = await Promise.all([
      supabase
        .from("product_bundles")
        .select("*, bundle_items(product_id, quantity)")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false }),
      getProductsDB(user.id),
    ]);
    setBundles((bl as Bundle[]) ?? []);
    setProducts(prods);
    setLoading(false);
  };

  useEffect(() => { reload(); }, [orgId, user]);

  const toggleActive = async (b: Bundle) => {
    await supabase.from("product_bundles").update({ is_active: !b.is_active }).eq("id", b.id);
    setBundles(prev => prev.map(x => x.id === b.id ? { ...x, is_active: !b.is_active } : x));
  };

  const handleDelete = async (id: string) => {
    await supabase.from("product_bundles").delete().eq("id", id);
    toast.success("Kit eliminado");
    reload();
  };

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-4 pb-12">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {bundles.length} kit{bundles.length !== 1 ? "s" : ""} · Los kits agrupan productos para venderlos como una sola SKU
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button className="gradient-gold text-primary-foreground font-semibold">
              <Plus className="w-4 h-4 mr-2" />Nuevo kit
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border/60 max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{editing ? "Editar kit" : "Crear kit"}</DialogTitle>
            </DialogHeader>
            <BundleForm
              orgId={orgId!}
              products={products}
              editItem={editing}
              onSave={() => { setOpen(false); setEditing(null); reload(); }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {bundles.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-xl">
          <Layers className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Sin kits creados</p>
          <p className="text-xs mt-1 max-w-xs mx-auto">
            Agrupá productos en kits (ej. "Set regalo 3 perfumes") para venderlos juntos a un precio especial.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {bundles.map(b => {
            const items = b.bundle_items ?? [];
            const sumParts = items.reduce((s, it) => {
              const p = products.find(x => x.id === it.product_id);
              return s + (p ? Number(p.sale_price_ars) * it.quantity : 0);
            }, 0);
            const savings = Math.max(0, sumParts - b.price_ars);
            return (
              <div key={b.id} className={`bg-card border rounded-xl p-4 transition-opacity ${b.is_active ? "border-border/60" : "border-border/30 opacity-60"}`}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-sm">{b.name}</h3>
                      {!b.is_active && <Badge variant="secondary" className="text-[10px]">Pausado</Badge>}
                    </div>
                    {b.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{b.description}</p>}
                  </div>
                  <Switch checked={b.is_active} onCheckedChange={() => toggleActive(b)} />
                </div>

                {/* Components */}
                <div className="flex flex-wrap gap-1 mb-3 mt-2">
                  {items.map(it => {
                    const p = products.find(x => x.id === it.product_id);
                    return (
                      <span key={it.product_id} className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded-full">
                        {it.quantity > 1 && <span className="text-primary font-bold">{it.quantity}×</span>}
                        {p?.name ?? it.product_id.slice(0, 8)}
                      </span>
                    );
                  })}
                  {items.length === 0 && <span className="text-xs text-muted-foreground italic">Sin componentes</span>}
                </div>

                {/* Price row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-wrap">
                    {sumParts > 0 && sumParts !== b.price_ars && (
                      <span className="text-xs text-muted-foreground line-through">{formatARS(sumParts)}</span>
                    )}
                    <span className="font-bold text-primary">{formatARS(b.price_ars)}</span>
                    {savings > 0 && (
                      <span className="text-xs text-green-400 font-medium">
                        Ahorro {formatARS(savings)} ({((savings / sumParts) * 100).toFixed(0)}%)
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditing(b); setOpen(true); }}>
                      <Edit className="w-3.5 h-3.5" />
                    </Button>
                    <ConfirmDialog
                      trigger={<Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                      title="¿Eliminar kit?" confirmText="Eliminar" onConfirm={() => handleDelete(b.id)}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BundleForm({ orgId, products, editItem, onSave }: {
  orgId: string;
  products: any[];
  editItem: Bundle | null;
  onSave: () => void;
}) {
  const [name, setName] = useState(editItem?.name ?? "");
  const [description, setDescription] = useState(editItem?.description ?? "");
  const [priceArs, setPriceArs] = useState(String(editItem?.price_ars ?? ""));
  const [items, setItems] = useState<BundleItem[]>(editItem?.bundle_items ?? []);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const filteredProducts = useMemo(() => {
    const q = search.toLowerCase();
    return products.filter(p => !q || p.name.toLowerCase().includes(q) || p.brand?.toLowerCase().includes(q));
  }, [products, search]);

  const addItem = (productId: string) => {
    setItems(prev => {
      const existing = prev.find(i => i.product_id === productId);
      if (existing) return prev.map(i => i.product_id === productId ? { ...i, quantity: i.quantity + 1 } : i);
      return [...prev, { product_id: productId, quantity: 1 }];
    });
  };

  const removeItem = (productId: string) => {
    setItems(prev => {
      const existing = prev.find(i => i.product_id === productId);
      if (!existing) return prev;
      if (existing.quantity <= 1) return prev.filter(i => i.product_id !== productId);
      return prev.map(i => i.product_id === productId ? { ...i, quantity: i.quantity - 1 } : i);
    });
  };

  const sumParts = useMemo(() =>
    items.reduce((s, it) => {
      const p = products.find(x => x.id === it.product_id);
      return s + (p ? Number(p.sale_price_ars) * it.quantity : 0);
    }, 0),
  [items, products]);

  const savings = Math.max(0, sumParts - (parseFloat(priceArs) || 0));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("Nombre requerido");
    if (items.length === 0) return toast.error("Agregá al menos 1 producto al kit");
    const price = parseFloat(priceArs);
    if (!price || price <= 0) return toast.error("Definí el precio del kit");
    setSaving(true);
    try {
      let bundleId = editItem?.id;
      if (editItem) {
        await supabase.from("product_bundles").update({
          name: name.trim(), description: description.trim() || null,
          price_ars: price, updated_at: new Date().toISOString(),
        }).eq("id", editItem.id);
        // Rebuild items
        await supabase.from("bundle_items").delete().eq("bundle_id", editItem.id);
      } else {
        const { data, error } = await supabase.from("product_bundles").insert({
          org_id: orgId, name: name.trim(), description: description.trim() || null,
          price_ars: price, is_active: true,
        }).select("id").single();
        if (error) throw error;
        bundleId = data.id;
      }
      // Insert items
      await supabase.from("bundle_items").insert(
        items.map(it => ({ bundle_id: bundleId!, product_id: it.product_id, quantity: it.quantity }))
      );
      toast.success(editItem ? "Kit actualizado" : "Kit creado");
      onSave();
    } catch (err: any) {
      toast.error(err.message ?? "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 pb-12">
      <div className="grid grid-cols-1 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Nombre del kit *</label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder='Ej: "Set regalo 3 perfumes"' className="bg-muted border-border mt-1" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Descripción (opcional)</label>
          <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="bg-muted border-border mt-1" />
        </div>
      </div>

      {/* Product selector */}
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Productos del kit *</label>
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar producto..."
          className="bg-muted border-border mb-2"
        />
        <div className="max-h-40 overflow-y-auto border border-border rounded-lg divide-y divide-border/40">
          {filteredProducts.slice(0, 30).map(p => {
            const inKit = items.find(i => i.product_id === p.id);
            return (
              <div key={p.id} className="flex items-center justify-between px-3 py-1.5 hover:bg-muted/20">
                <div className="flex items-center gap-2 min-w-0">
                  {inKit && <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />}
                  <span className="text-xs truncate">{p.name}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{formatARS(Number(p.sale_price_ars))}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {inKit && (
                    <>
                      <button type="button" onClick={() => removeItem(p.id)} className="w-6 h-6 rounded flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground">
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="text-xs font-bold w-5 text-center">{inKit.quantity}</span>
                    </>
                  )}
                  <button type="button" onClick={() => addItem(p.id)} className="w-6 h-6 rounded flex items-center justify-center hover:bg-muted text-muted-foreground hover:text-foreground">
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected items summary */}
      {items.length > 0 && (
        <div className="bg-muted/30 rounded-lg p-3 space-y-1">
          <p className="text-xs font-semibold text-muted-foreground mb-1.5">Componentes del kit</p>
          {items.map(it => {
            const p = products.find(x => x.id === it.product_id);
            return (
              <div key={it.product_id} className="flex items-center justify-between text-xs">
                <span>{it.quantity}× {p?.name ?? "—"}</span>
                <span className="text-muted-foreground">{formatARS(Number(p?.sale_price_ars ?? 0) * it.quantity)}</span>
              </div>
            );
          })}
          <div className="border-t border-border/40 pt-1 mt-1 flex justify-between text-xs font-semibold">
            <span>Suma de partes</span>
            <span>{formatARS(sumParts)}</span>
          </div>
        </div>
      )}

      {/* Price */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Precio del kit (ARS) *</label>
          <Input type="number" min={0} step={0.01} value={priceArs} onChange={e => setPriceArs(e.target.value)} className="bg-muted border-border mt-1" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Ahorro para el cliente</label>
          <Input
            value={savings > 0 ? `${formatARS(savings)} (${((savings / sumParts) * 100).toFixed(0)}%)` : "—"}
            disabled className="bg-muted border-border mt-1 text-green-400"
          />
        </div>
      </div>

      <Button type="submit" disabled={saving} className="w-full gradient-gold text-primary-foreground font-semibold">
        {saving ? "Guardando..." : editItem ? "Actualizar kit" : "Crear kit"}
      </Button>
    </form>
  );
}

// ─── Combos (legacy marketing) ────────────────────────────────────────────────
function CombosTab() {
  const { user } = useAuth();
  const [combos, setCombos] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);

  const reload = async () => {
    if (!user) return;
    const [c, p] = await Promise.all([listCombos(), getProductsDB(user.id)]);
    setCombos(c); setProducts(p);
  };
  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [user]);

  const handleDelete = async (id: string) => { await deleteCombo(id); toast.success("Combo eliminado"); reload(); };
  const toggleActive = async (c: any) => { await updateCombo(c.id, { active: !c.active }); reload(); };

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditItem(null); }}>
          <DialogTrigger asChild>
            <Button className="gradient-gold text-primary-foreground font-semibold"><Plus className="w-4 h-4 mr-2" />Nuevo combo</Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border/60 max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editItem ? 'Editar combo' : 'Crear combo'}</DialogTitle></DialogHeader>
            <ComboForm products={products} editItem={editItem} userId={user?.id || ''} onSave={() => { setOpen(false); setEditItem(null); reload(); }} />
          </DialogContent>
        </Dialog>
      </div>
      {combos.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground"><Package className="w-12 h-12 mx-auto mb-2 opacity-30" /><p>Sin combos cargados</p></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {combos.map(c => (
            <div key={c.id} className="bg-card border border-border/60 rounded-lg p-4">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-semibold">{c.name}</h3>
                  <p className="text-xs text-muted-foreground">{c.description || '—'}</p>
                </div>
                <Switch checked={c.active} onCheckedChange={() => toggleActive(c)} />
              </div>
              <div className="flex flex-wrap gap-1 mb-3">
                {c.product_ids?.map((pid: string) => {
                  const p = products.find(x => x.id === pid);
                  return <span key={pid} className="text-xs bg-muted px-2 py-0.5 rounded">{p?.name || '—'}</span>;
                })}
              </div>
              <div className="flex items-center justify-between text-sm">
                <div>
                  <span className="text-muted-foreground line-through text-xs">{formatARS(Number(c.original_price_ars))}</span>
                  <span className="ml-2 font-bold text-primary">{formatARS(Number(c.combo_price_ars))}</span>
                  <span className="ml-2 text-xs text-emerald-400">Ahorro {formatARS(Number(c.savings_ars))}</span>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditItem(c); setOpen(true); }}><Edit className="w-3.5 h-3.5" /></Button>
                  <ConfirmDialog
                    trigger={<Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                    title="Eliminar combo?" confirmText="Eliminar" onConfirm={() => handleDelete(c.id)}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ComboForm({ products, editItem, userId, onSave }: { products: any[]; editItem?: any; userId: string; onSave: () => void }) {
  const [name, setName] = useState(editItem?.name || '');
  const [description, setDescription] = useState(editItem?.description || '');
  const [selected, setSelected] = useState<string[]>(editItem?.product_ids || []);
  const [comboPrice, setComboPrice] = useState(String(editItem?.combo_price_ars || ''));
  const [saving, setSaving] = useState(false);

  const original = selected.reduce((s, id) => s + Number(products.find(p => p.id === id)?.sale_price_ars || 0), 0);
  const combo = parseFloat(comboPrice) || 0;
  const savings = Math.max(0, original - combo);

  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast.error("Nombre requerido");
    if (selected.length < 2) return toast.error("Elegí al menos 2 productos");
    if (combo <= 0) return toast.error("Definí el precio del combo");
    setSaving(true);
    try {
      const payload = {
        name: name.trim(), description: description.trim() || null,
        product_ids: selected, original_price_ars: original,
        combo_price_ars: combo, savings_ars: savings,
      };
      if (editItem) await updateCombo(editItem.id, payload);
      else await createCombo({ ...payload, user_id: userId });
      toast.success("Combo guardado");
      onSave();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3 pb-12">
      <div>
        <label className="text-xs text-muted-foreground">Nombre del combo *</label>
        <Input value={name} onChange={e => setName(e.target.value)} className="bg-muted border-border" placeholder="Combo Verano" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Descripción</label>
        <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} className="bg-muted border-border" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Productos *</label>
        <div className="max-h-48 overflow-y-auto border border-border rounded p-2 space-y-1">
          {products.filter(p => p.stock > 0).map(p => (
            <label key={p.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/30 p-1 rounded">
              <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
              <span>{p.name}</span>
              <span className="ml-auto text-muted-foreground text-xs">{formatARS(Number(p.sale_price_ars))}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Precio original</label>
          <Input value={formatARS(original)} disabled className="bg-muted border-border" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Precio combo *</label>
          <Input type="number" value={comboPrice} onChange={e => setComboPrice(e.target.value)} className="bg-muted border-border" />
        </div>
      </div>
      {savings > 0 && <p className="text-xs text-emerald-400">Ahorro: {formatARS(savings)} ({((savings / original) * 100).toFixed(0)}%)</p>}
      <Button type="submit" disabled={saving} className="w-full gradient-gold text-primary-foreground font-semibold">
        {saving ? 'Guardando...' : 'Guardar combo'}
      </Button>
    </form>
  );
}

function BannersTab() {
  const { user } = useAuth();
  const [banners, setBanners] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);

  const reload = async () => { try { setBanners(await listBanners()); } catch (e: any) { toast.error(e.message); } };
  useEffect(() => { if (user) reload(); }, [user]);

  const handleDelete = async (id: string) => { await deleteBanner(id); toast.success("Banner eliminado"); reload(); };
  const toggleActive = async (b: any) => { await updateBanner(b.id, { active: !b.active }); reload(); };

  return (
    <div>
      <div className="flex justify-end mb-4">
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditItem(null); }}>
          <DialogTrigger asChild>
            <Button className="gradient-gold text-primary-foreground font-semibold"><Plus className="w-4 h-4 mr-2" />Nuevo banner</Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border/60 max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editItem ? 'Editar banner' : 'Crear banner'}</DialogTitle></DialogHeader>
            <BannerForm editItem={editItem} userId={user?.id || ''} onSave={() => { setOpen(false); setEditItem(null); reload(); }} />
          </DialogContent>
        </Dialog>
      </div>
      {banners.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground"><ImageIcon className="w-12 h-12 mx-auto mb-2 opacity-30" /><p>Sin banners cargados</p></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {banners.map(b => (
            <div key={b.id} className="border border-border rounded-lg overflow-hidden">
              <div className="p-6 text-center" style={{ background: b.background_color, color: b.text_color }}>
                <h3 className="font-bold text-lg">{b.title}</h3>
                {b.subtitle && <p className="text-sm opacity-90">{b.subtitle}</p>}
              </div>
              <div className="p-3 flex items-center justify-between bg-card">
                <div className="text-xs text-muted-foreground">
                  <Switch checked={b.active} onCheckedChange={() => toggleActive(b)} />
                  <span className="ml-2">{b.active ? 'Activo' : 'Pausado'}</span>
                  {b.expires_at && <span className="ml-2">· Expira {new Date(b.expires_at).toLocaleDateString('es-AR')}</span>}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditItem(b); setOpen(true); }}><Edit className="w-3.5 h-3.5" /></Button>
                  <ConfirmDialog
                    trigger={<Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                    title="Eliminar banner?" confirmText="Eliminar" onConfirm={() => handleDelete(b.id)}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BannerForm({ editItem, userId, onSave }: { editItem?: any; userId: string; onSave: () => void }) {
  const [title, setTitle] = useState(editItem?.title || '');
  const [subtitle, setSubtitle] = useState(editItem?.subtitle || '');
  const [bg, setBg] = useState(editItem?.background_color || '#D4A843');
  const [tc, setTc] = useState(editItem?.text_color || '#FFFFFF');
  const [linkUrl, setLinkUrl] = useState(editItem?.link_url || '');
  const [expires, setExpires] = useState(editItem?.expires_at ? editItem.expires_at.slice(0, 10) : '');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return toast.error("Título requerido");
    setSaving(true);
    try {
      const payload: any = {
        title: title.trim(), subtitle: subtitle.trim() || null,
        background_color: bg, text_color: tc,
        link_url: linkUrl.trim() || null,
        expires_at: expires ? new Date(expires + 'T23:59:59').toISOString() : null,
      };
      if (editItem) await updateBanner(editItem.id, payload);
      else await createBanner({ ...payload, user_id: userId });
      toast.success("Banner guardado");
      onSave();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3 pb-12">
      <div>
        <label className="text-xs text-muted-foreground">Título *</label>
        <Input value={title} onChange={e => setTitle(e.target.value)} className="bg-muted border-border" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Subtítulo</label>
        <Input value={subtitle} onChange={e => setSubtitle(e.target.value)} className="bg-muted border-border" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Color fondo</label>
          <Input type="color" value={bg} onChange={e => setBg(e.target.value)} className="bg-muted border-border h-10" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Color texto</label>
          <Input type="color" value={tc} onChange={e => setTc(e.target.value)} className="bg-muted border-border h-10" />
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Link (opcional)</label>
        <Input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://..." className="bg-muted border-border" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Expira (opcional)</label>
        <Input type="date" value={expires} onChange={e => setExpires(e.target.value)} className="bg-muted border-border" />
      </div>
      <div className="p-4 rounded text-center border border-border" style={{ background: bg, color: tc }}>
        <p className="font-bold">{title || 'Vista previa'}</p>
        {subtitle && <p className="text-sm opacity-90">{subtitle}</p>}
      </div>
      <Button type="submit" disabled={saving} className="w-full gradient-gold text-primary-foreground font-semibold">
        {saving ? 'Guardando...' : 'Guardar banner'}
      </Button>
    </form>
  );
}