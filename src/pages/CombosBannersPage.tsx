import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { listCombos, createCombo, updateCombo, deleteCombo, listBanners, createBanner, updateBanner, deleteBanner } from "@/lib/marketingExtraDB";
import { getProductsDB, formatARS } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Package, Image as ImageIcon, Plus, Edit, Trash2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import PageHeader from "@/components/shared/PageHeader";

export default function CombosBannersPage() {
  usePageTitle("Combos & Banners");
  return (
    <div className="space-y-6">
      <PageHeader
        icon={Sparkles}
        title="Combos & Banners"
        description="Crea combos promocionales y banners para tu catálogo público"
      />
      <Tabs defaultValue="combos">
        <TabsList className="mb-4">
          <TabsTrigger value="combos"><Package className="w-4 h-4 mr-2" />Combos</TabsTrigger>
          <TabsTrigger value="banners"><ImageIcon className="w-4 h-4 mr-2" />Banners</TabsTrigger>
        </TabsList>
        <TabsContent value="combos"><CombosTab /></TabsContent>
        <TabsContent value="banners"><BannersTab /></TabsContent>
      </Tabs>
    </div>
  );
}

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
          <DialogContent className="bg-[hsl(228_24%_7%)] border-border/60 max-h-[85vh] overflow-y-auto">
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
            <div key={c.id} className="bg-[hsl(228_24%_7%)] border border-border/60 rounded-lg p-4">
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
                  <span className="ml-2 text-xs text-success">Ahorro {formatARS(Number(c.savings_ars))}</span>
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
    <form onSubmit={submit} className="space-y-3">
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
      {savings > 0 && <p className="text-xs text-success">Ahorro: {formatARS(savings)} ({((savings / original) * 100).toFixed(0)}%)</p>}
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
          <DialogContent className="bg-[hsl(228_24%_7%)] border-border/60 max-h-[85vh] overflow-y-auto">
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
    <form onSubmit={submit} className="space-y-3">
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