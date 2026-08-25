import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useOrg } from "@/lib/orgContext";
import { listBrandKnowledge, createBrandKnowledge, updateBrandKnowledge, deleteBrandKnowledge } from "@/lib/marketingExtraDB";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Brain, Plus, Edit, Trash2, BookOpen, Tag, Globe } from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import KPICard from "@/components/shared/KPICard";
import CategorySelect, { useOrgCategories } from "@/components/products/CategorySelect";
import { nombreDeCategoria } from "@/lib/storeCategories";

// Las categorías salen de `ecommerce_categories`, la misma fuente que usa la
// ficha de producto. Hasta 2026-08-25 vivían acá escritas a mano —perfume
// árabe, occidental, premium, vapers, líquidos— así que un comercio de otro
// rubro clasificaba sus marcas con el vocabulario de una perfumería, y el
// formulario arrancaba además preseleccionado en `perfume_arabe`.

export default function BrandKnowledgeTab() {
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const { opciones, categorias } = useOrgCategories(activeOrg?.id);
  const [items, setItems] = useState<any[]>([]);
  const [filter, setFilter] = useState('all');
  const [editItem, setEditItem] = useState<any>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    try { setItems(await listBrandKnowledge()); } catch (e: any) { toast.error(e.message); }
    setLoading(false);
  };
  useEffect(() => { if (user) reload(); }, [user]);

  const filtered = filter === 'all' ? items : items.filter(i => i.category === filter);

  // Los códigos son las categorías de la organización **más** las que ya traen
  // las marcas cargadas. Ese segundo conjunto no es opcional: la base global de
  // marcas (`org_id IS NULL`) llega con categorías que el comercio nunca creó,
  // y agrupar sólo por las propias las haría desaparecer de la pantalla.
  const codigos = [
    ...opciones.map(o => o.slug),
    ...([...new Set(items.map(i => i.category))]
      .filter(c => c && !opciones.some(o => o.slug === c)) as string[]),
  ];
  const etiqueta = (code: string) =>
    opciones.find(o => o.slug === code)?.label ?? nombreDeCategoria(code, categorias);
  const grouped = codigos
    .map(code => ({ code, label: etiqueta(code), items: filtered.filter(i => i.category === code) }))
    .filter(g => g.items.length > 0);
  const categoriesUsed = new Set(items.map(i => i.category)).size;
  const publicItems = items.filter(i => i.is_public).length;

  const handleDelete = async (id: string) => {
    await deleteBrandKnowledge(id);
    toast.success("Marca eliminada");
    reload();
  };

  return (
    <div className="space-y-6 pb-12">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-lg font-bold">Base de conocimiento de marcas</h2>
          <p className="text-sm text-muted-foreground">Marcas, clones y notas que la IA usa para generar descripciones y respuestas</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditItem(null); }}>
          <DialogTrigger asChild>
            <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold">
              <Plus className="w-4 h-4 mr-2" />Nueva marca
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border/60 max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editItem ? 'Editar marca' : 'Agregar marca'}</DialogTitle></DialogHeader>
            <BrandForm
              editItem={editItem}
              onSave={() => { setOpen(false); setEditItem(null); reload(); }}
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard label="Marcas registradas" value={items.length} icon={Brain} color="primary" sub="en base de conocimiento" />
        <KPICard label="Categorías" value={categoriesUsed} icon={Tag} color="blue" sub={`de ${codigos.length} disponibles`} />
        <KPICard label="Mostrando" value={filtered.length} icon={BookOpen} color={filtered.length < items.length ? "warning" : "success"} sub={filter === 'all' ? "todas las marcas" : "filtradas"} />
        <KPICard label="Públicas" value={publicItems} icon={Globe} color={publicItems > 0 ? "success" : "primary"} sub="visibles en catálogo" />
      </div>

      <div className="mb-4">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="bg-muted border-border w-full sm:w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las categorías</SelectItem>
            {codigos.map(c => <SelectItem key={c} value={c}>{etiqueta(c)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando...</p>
      ) : grouped.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Brain className="w-12 h-12 mx-auto mb-2 opacity-30" />
          <p>Sin marcas cargadas. La IA usará reglas genéricas hasta que agregues conocimiento.</p>
        </div>
      ) : (
        <div className="space-y-6 pb-12">
          {grouped.map(g => (
            <div key={g.code}>
              <h2 className="font-display text-sm uppercase tracking-wider text-muted-foreground mb-2">{g.label}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {g.items.map(it => (
                  <div key={it.id} className="bg-card border border-border/60 rounded-lg p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <h3 className="font-semibold">{it.brand}</h3>
                        {it.clone_of && <p className="text-xs text-primary">Clon de: {it.clone_of}</p>}
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => { setEditItem(it); setOpen(true); }}>
                          <Edit className="w-3.5 h-3.5" />
                        </Button>
                        <ConfirmDialog
                          trigger={<Button variant="ghost" size="sm" className="h-7 w-7 p-0"><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                          title={`Eliminar ${it.brand}?`}
                          confirmText="Eliminar"
                          onConfirm={() => handleDelete(it.id)}
                        />
                      </div>
                    </div>
                    {it.notes_typical && <p className="text-xs text-muted-foreground mb-1"><strong>Notas:</strong> {it.notes_typical}</p>}
                    {it.description && <p className="text-xs text-muted-foreground">{it.description}</p>}
                    {it.org_id === null && <span className="inline-block mt-2 text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground">Global (solo lectura)</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BrandForm({ editItem, onSave }: { editItem?: any; onSave: () => void }) {
  const { activeOrg } = useOrg();
  const [brand, setBrand] = useState(editItem?.brand || '');
  // Sin categoría por defecto. Preseleccionar una deja la marca clasificada sin
  // que nadie lo haya decidido, y el que la carga no se entera. Mismo criterio
  // que el rubro del onboarding en `20260825000001_rubro_sin_default`.
  const [category, setCategory] = useState(editItem?.category || '');
  const [cloneOf, setCloneOf] = useState(editItem?.clone_of || '');
  const [notes, setNotes] = useState(editItem?.notes_typical || '');
  const [description, setDescription] = useState(editItem?.description || '');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brand.trim()) return toast.error("Ingresá la marca");
    if (!category) return toast.error("Elegí una categoría");
    setSaving(true);
    try {
      const payload = {
        brand: brand.trim().toUpperCase(), category,
        clone_of: cloneOf.trim() || null, notes_typical: notes.trim() || null,
        description: description.trim() || null,
      };
      if (editItem && editItem.org_id) await updateBrandKnowledge(editItem.id, payload);
      else await createBrandKnowledge(payload);
      toast.success("Marca guardada");
      onSave();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3 pb-12">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Marca *</label>
          <Input value={brand} onChange={e => setBrand(e.target.value)} placeholder="LATTAFA" className="bg-muted border-border" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Categoría</label>
          {/* El mismo control que la ficha de producto, así la marca y el
              producto quedan clasificados con el mismo vocabulario y se puede
              crear una categoría sin salir del formulario. */}
          <CategorySelect
            value={category}
            onChange={setCategory}
            orgId={activeOrg?.id}
            className="bg-muted border-border"
          />
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Clon de (opcional)</label>
        <Input value={cloneOf} onChange={e => setCloneOf(e.target.value)} placeholder="Ej: Baccarat Rouge 540" className="bg-muted border-border" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Notas olfativas típicas</label>
        <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Azafrán, ámbar, jazmín..." className="bg-muted border-border" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Descripción / regla para IA</label>
        <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Cuándo recomendarlo, mensajes clave..." className="bg-muted border-border" />
      </div>
      <Button type="submit" disabled={saving} className="w-full gradient-gold text-primary-foreground font-semibold">
        {saving ? 'Guardando...' : editItem ? 'Guardar cambios' : 'Agregar marca'}
      </Button>
    </form>
  );
}
