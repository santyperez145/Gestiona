import { useState, useEffect } from "react";
import { useOrg } from "@/lib/orgContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Plus, Pencil, Trash2, Search, Truck, Phone, Mail,
  MapPin, FileText, ChevronDown, ChevronUp, Building2, ShoppingCart,
} from "lucide-react";
import ConfirmDialog from "@/components/shared/ConfirmDialog";

type Supplier = {
  id: string;
  name: string;
  contact: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  active: boolean;
  created_at: string;
};

type PurchaseSummary = {
  id: string;
  product_name: string;
  quantity: number;
  total_price_ars: number;
  date: string;
};

const EMPTY: Partial<Supplier> = { name: "", contact: "", phone: "", email: "", address: "", notes: "", active: true };

export default function ProveedoresPage() {
  const { activeOrg } = useOrg();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState<Partial<Supplier>>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [purchases, setPurchases] = useState<Record<string, PurchaseSummary[]>>({});
  const [loadingPurchases, setLoadingPurchases] = useState(false);

  const load = async () => {
    if (!activeOrg) return;
    setLoading(true);
    const { data } = await supabase
      .from("suppliers")
      .select("*")
      .eq("org_id", activeOrg.id)
      .order("name");
    setSuppliers((data as Supplier[]) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeOrg]);

  const loadPurchases = async (supplierId: string) => {
    if (purchases[supplierId]) return;
    setLoadingPurchases(true);
    const { data } = await supabase
      .from("purchases")
      .select("id, product_name, quantity, total_price_ars, date")
      .eq("supplier_id", supplierId)
      .order("date", { ascending: false })
      .limit(10);
    setPurchases(prev => ({ ...prev, [supplierId]: (data || []) as PurchaseSummary[] }));
    setLoadingPurchases(false);
  };

  const openCreate = () => { setEditing(null); setForm(EMPTY); setOpen(true); };
  const openEdit = (s: Supplier) => { setEditing(s); setForm({ ...s }); setOpen(true); };

  const handleSave = async () => {
    if (!form.name?.trim() || !activeOrg) return;
    setSaving(true);
    try {
      if (editing) {
        const { error } = await supabase
          .from("suppliers")
          .update({ name: form.name, contact: form.contact, phone: form.phone, email: form.email, address: form.address, notes: form.notes, active: form.active })
          .eq("id", editing.id);
        if (error) throw error;
        toast.success("Proveedor actualizado");
      } else {
        const { error } = await supabase.from("suppliers").insert({
          org_id: activeOrg.id,
          name: form.name,
          contact: form.contact || null,
          phone: form.phone || null,
          email: form.email || null,
          address: form.address || null,
          notes: form.notes || null,
          active: true,
        });
        if (error) throw error;
        toast.success("Proveedor agregado");
      }
      setOpen(false);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("suppliers").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Proveedor eliminado"); load(); }
  };

  const filtered = suppliers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.contact || "").toLowerCase().includes(search.toLowerCase()) ||
    (s.email || "").toLowerCase().includes(search.toLowerCase())
  );

  const f = (k: keyof Supplier) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }));

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2">
            <Truck className="w-6 h-6 text-primary" /> Proveedores
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {suppliers.filter(s => s.active).length} proveedores activos
          </p>
        </div>
        <Button className="gradient-gold text-primary-foreground shadow-gold h-9" onClick={openCreate}>
          <Plus className="w-4 h-4 mr-2" /> Nuevo proveedor
        </Button>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por nombre, contacto o email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="pl-9 h-9"
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-muted/30 rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Truck className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-muted-foreground">
            {search ? "Sin resultados para tu búsqueda." : "Aún no hay proveedores. Agregá uno para vincularlos a tus compras."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(s => (
            <div key={s.id} className="bg-card border border-border rounded-xl overflow-hidden shadow-card">
              <div className="px-4 py-3.5 flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Building2 className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{s.name}</span>
                    {!s.active && <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-muted-foreground">Inactivo</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                    {s.contact && <span className="text-xs text-muted-foreground flex items-center gap-1"><FileText className="w-3 h-3" />{s.contact}</span>}
                    {s.phone && <span className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3" />{s.phone}</span>}
                    {s.email && <span className="text-xs text-muted-foreground flex items-center gap-1"><Mail className="w-3 h-3" />{s.email}</span>}
                    {s.address && <span className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" />{s.address}</span>}
                  </div>
                  {s.notes && <p className="text-xs text-muted-foreground/70 mt-1 line-clamp-1">{s.notes}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => {
                      const newId = expandedId === s.id ? null : s.id;
                      setExpandedId(newId);
                      if (newId) loadPurchases(newId);
                    }}
                    className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
                    title="Ver compras"
                  >
                    {expandedId === s.id ? <ChevronUp className="w-4 h-4" /> : <ShoppingCart className="w-4 h-4" />}
                  </button>
                  <button onClick={() => openEdit(s)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <ConfirmDialog
                    title="Eliminar proveedor"
                    description={`¿Eliminar "${s.name}"? Las compras vinculadas no se borrarán.`}
                    onConfirm={() => handleDelete(s.id)}
                  >
                    <button className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </ConfirmDialog>
                </div>
              </div>

              {expandedId === s.id && (
                <div className="border-t border-border bg-muted/20 px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                    <ShoppingCart className="w-3 h-3" /> Últimas compras
                  </p>
                  {loadingPurchases ? (
                    <div className="h-8 bg-muted/40 rounded animate-pulse" />
                  ) : (purchases[s.id] || []).length === 0 ? (
                    <p className="text-xs text-muted-foreground/60">No hay compras vinculadas a este proveedor.</p>
                  ) : (
                    <div className="space-y-1">
                      {(purchases[s.id] || []).map(p => (
                        <div key={p.id} className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">{new Date(p.date).toLocaleDateString("es-AR")}</span>
                          <span className="flex-1 px-3 truncate">{p.product_name}</span>
                          <span className="text-muted-foreground">×{p.quantity}</span>
                          <span className="ml-3 font-medium">${p.total_price_ars?.toLocaleString("es-AR")}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar proveedor" : "Nuevo proveedor"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Nombre *</label>
              <Input placeholder="Nombre del proveedor" value={form.name || ""} onChange={f("name")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Contacto</label>
                <Input placeholder="Nombre de contacto" value={form.contact || ""} onChange={f("contact")} />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Teléfono</label>
                <Input placeholder="+54 9 11…" value={form.phone || ""} onChange={f("phone")} />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Email</label>
              <Input type="email" placeholder="proveedor@empresa.com" value={form.email || ""} onChange={f("email")} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Dirección</label>
              <Input placeholder="Calle, ciudad, provincia" value={form.address || ""} onChange={f("address")} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Notas</label>
              <Textarea
                placeholder="Condiciones de pago, plazos, etc."
                value={form.notes || ""}
                onChange={f("notes")}
                className="h-20 resize-none"
              />
            </div>
            <Button
              className="w-full gradient-gold text-primary-foreground"
              disabled={!form.name?.trim() || saving}
              onClick={handleSave}
            >
              {saving ? "Guardando…" : editing ? "Guardar cambios" : "Agregar proveedor"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
