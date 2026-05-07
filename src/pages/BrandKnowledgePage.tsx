import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { listBrandKnowledge, createBrandKnowledge, updateBrandKnowledge, deleteBrandKnowledge } from "@/lib/marketingExtraDB";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Brain, Plus, Edit, Trash2 } from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import PageHeader from "@/components/shared/PageHeader";

const CATEGORIES = [
  { code: 'perfume_arabe', label: 'Perfume árabe' },
  { code: 'perfume_occidental', label: 'Perfume occidental' },
  { code: 'perfume_premium', label: 'Premium / Nicho' },
  { code: 'vaper', label: 'Vapers / Pods' },
  { code: 'liquido', label: 'Líquidos / E-juice' },
  { code: 'accesorio', label: 'Accesorio' },
  { code: 'otro', label: 'Otro' },
];

export default function BrandKnowledgePage() {
  const { user } = useAuth();
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
  const grouped = CATEGORIES.map(c => ({ ...c, items: filtered.filter(i => i.category === c.code) })).filter(g => g.items.length > 0);

  const handleDelete = async (id: string) => {
    await deleteBrandKnowledge(id);
    toast.success("Marca eliminada");
    reload();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Brain}
        title="Base de conocimiento de marcas"
        description="Marcas, clones y notas que la IA usa para generar descripciones y respuestas"
        actions={
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditItem(null); }}>
            <DialogTrigger asChild>
              <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold">
                <Plus className="w-4 h-4 mr-2" />Nueva marca
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border max-h-[85vh] overflow-y-auto">
              <DialogHeader><DialogTitle>{editItem ? 'Editar marca' : 'Agregar marca'}</DialogTitle></DialogHeader>
              <BrandForm
                editItem={editItem}
                onSave={() => { setOpen(false); setEditItem(null); reload(); }}
              />
            </DialogContent>
          </Dialog>
        }
      />

      <div className="mb-4">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="bg-muted border-border w-full sm:w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las categorías</SelectItem>
            {CATEGORIES.map(c => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}
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
        <div className="space-y-6">
          {grouped.map(g => (
            <div key={g.code}>
              <h2 className="font-display text-sm uppercase tracking-wider text-muted-foreground mb-2">{g.label}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {g.items.map(it => (
                  <div key={it.id} className="bg-card border border-border rounded-lg p-4">
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
  const [brand, setBrand] = useState(editItem?.brand || '');
  const [category, setCategory] = useState(editItem?.category || 'perfume_arabe');
  const [cloneOf, setCloneOf] = useState(editItem?.clone_of || '');
  const [notes, setNotes] = useState(editItem?.notes_typical || '');
  const [description, setDescription] = useState(editItem?.description || '');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brand.trim()) return toast.error("Ingresá la marca");
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
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Marca *</label>
          <Input value={brand} onChange={e => setBrand(e.target.value)} placeholder="LATTAFA" className="bg-muted border-border" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Categoría</label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map(c => <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
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