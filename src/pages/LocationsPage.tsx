import { useState, useEffect } from "react";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { getProductsDB, formatARS } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { MapPin, Plus, Edit2, Trash2, ArrowLeftRight, Package, Phone, Star, Check } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import { usePageTitle } from "@/hooks/usePageTitle";

type Location = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  is_main: boolean;
  active: boolean;
};

type LocationStock = {
  product_id: string;
  stock: number;
  product_name?: string;
};

const EMPTY_FORM = { name: "", address: "", phone: "", is_main: false };

function LocationForm({
  initial,
  onSave,
  onClose,
}: {
  initial?: Partial<typeof EMPTY_FORM & { id: string }>;
  onSave: (data: typeof EMPTY_FORM) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...initial });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof EMPTY_FORM, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Ingresá un nombre"); return; }
    setSaving(true);
    try { await onSave(form); onClose(); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Nombre del local *</label>
        <Input value={form.name} onChange={e => set("name", e.target.value)} placeholder="Casa Central, Sucursal Norte…" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Dirección</label>
        <Input value={form.address ?? ""} onChange={e => set("address", e.target.value)} placeholder="Av. Corrientes 1234, CABA" />
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Teléfono</label>
        <Input value={form.phone ?? ""} onChange={e => set("phone", e.target.value)} placeholder="+54 11 1234-5678" />
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={form.is_main} onChange={e => set("is_main", e.target.checked)} className="rounded" />
        <span className="text-sm">Es el local principal</span>
      </label>
      <div className="flex gap-2 pt-2">
        <Button type="submit" className="flex-1 gradient-gold text-primary-foreground font-semibold" disabled={saving}>
          {saving ? "Guardando…" : "Guardar"}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
      </div>
    </form>
  );
}

function TransferDialog({
  locations,
  products,
  orgId,
  userId,
  onClose,
  onDone,
}: {
  locations: Location[];
  products: any[];
  orgId: string;
  userId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [fromLoc, setFromLoc] = useState("");
  const [toLoc, setToLoc] = useState("");
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("1");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromLoc || !toLoc || !productId || !qty) { toast.error("Completá todos los campos"); return; }
    if (fromLoc === toLoc) { toast.error("Los locales de origen y destino deben ser distintos"); return; }
    const product = products.find(p => p.id === productId);
    if (!product) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("stock_transfers").insert({
        org_id: orgId,
        from_location_id: fromLoc,
        to_location_id: toLoc,
        product_id: productId,
        product_name: product.name,
        quantity: Number(qty),
        notes: notes.trim() || null,
        transferred_by: userId,
      });
      if (error) throw error;

      // Adjust location_stock for both locations
      const q = Number(qty);
      await Promise.all([
        upsertLocationStock(orgId, fromLoc, productId, -q),
        upsertLocationStock(orgId, toLoc, productId, q),
      ]);

      toast.success(`Transferencia de ${qty} u. de ${product.name} registrada`);
      onDone();
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Error al transferir");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleTransfer} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Desde</label>
          <Select value={fromLoc} onValueChange={setFromLoc}>
            <SelectTrigger><SelectValue placeholder="Origen" /></SelectTrigger>
            <SelectContent>{locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Hacia</label>
          <Select value={toLoc} onValueChange={setToLoc}>
            <SelectTrigger><SelectValue placeholder="Destino" /></SelectTrigger>
            <SelectContent>{locations.map(l => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Producto</label>
        <Select value={productId} onValueChange={setProductId}>
          <SelectTrigger><SelectValue placeholder="Seleccioná producto" /></SelectTrigger>
          <SelectContent>
            {products.filter(p => p.stock > 0).map(p => (
              <SelectItem key={p.id} value={p.id}>{p.name} ({p.stock} u.)</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Cantidad</label>
        <Input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} />
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Notas (opcional)</label>
        <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Motivo de la transferencia…" />
      </div>
      <div className="flex gap-2 pt-2">
        <Button type="submit" className="flex-1 gradient-gold text-primary-foreground font-semibold" disabled={saving}>
          <ArrowLeftRight className="w-4 h-4 mr-1.5" />{saving ? "Transfiriendo…" : "Transferir"}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
      </div>
    </form>
  );
}

async function upsertLocationStock(orgId: string, locationId: string, productId: string, delta: number) {
  const { data: existing } = await supabase
    .from("location_stock")
    .select("id, stock")
    .eq("location_id", locationId)
    .eq("product_id", productId)
    .maybeSingle();

  if (existing) {
    await supabase.from("location_stock")
      .update({ stock: Math.max(0, existing.stock + delta), updated_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else if (delta > 0) {
    await supabase.from("location_stock").insert({ org_id: orgId, location_id: locationId, product_id: productId, stock: delta });
  }
}

export default function LocationsPage() {
  usePageTitle("Ubicaciones");
  const { activeOrg } = useOrg();
  const { user } = useAuth();
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [locationStock, setLocationStock] = useState<Record<string, LocationStock[]>>({});
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingLoc, setEditingLoc] = useState<Location | null>(null);
  const [showTransfer, setShowTransfer] = useState(false);

  const load = async () => {
    if (!activeOrg || !user) return;
    setLoading(true);

    const [{ data: locs }, prods, { data: txs }, { data: ls }] = await Promise.all([
      supabase.from("locations").select("*").eq("org_id", activeOrg.id).eq("active", true).order("is_main", { ascending: false }).order("name"),
      getProductsDB(user.id),
      supabase.from("stock_transfers").select("*, from_location:from_location_id(name), to_location:to_location_id(name)").eq("org_id", activeOrg.id).order("created_at", { ascending: false }).limit(20),
      supabase.from("location_stock").select("location_id, product_id, stock").eq("org_id", activeOrg.id),
    ]);

    setLocations((locs || []) as Location[]);
    setProducts(prods);
    setTransfers(txs || []);

    // Index location stock by location_id
    const stockIndex: Record<string, LocationStock[]> = {};
    for (const row of ls || []) {
      const prod = prods.find((p: any) => p.id === row.product_id);
      if (!stockIndex[row.location_id]) stockIndex[row.location_id] = [];
      stockIndex[row.location_id].push({ product_id: row.product_id, stock: row.stock, product_name: prod?.name });
    }
    setLocationStock(stockIndex);
    setLoading(false);
  };

  useEffect(() => { load(); }, [activeOrg, user]);

  const handleSave = async (data: typeof EMPTY_FORM) => {
    if (!activeOrg) return;
    if (editingLoc) {
      const { error } = await supabase.from("locations").update(data).eq("id", editingLoc.id);
      if (error) { toast.error(error.message); return; }
      toast.success("Local actualizado");
    } else {
      const { error } = await supabase.from("locations").insert({ ...data, org_id: activeOrg.id });
      if (error) { toast.error(error.message); return; }
      toast.success("Local creado");
    }
    setEditingLoc(null);
    await load();
  };

  const deleteLoc = async (loc: Location) => {
    if (!confirm(`¿Eliminar "${loc.name}"?`)) return;
    await supabase.from("locations").update({ active: false }).eq("id", loc.id);
    await load();
    toast.success("Local eliminado");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={MapPin}
        title="Sucursales"
        description="Gestioná múltiples locales y transferencias de stock entre ellos"
        actions={
          <div className="flex gap-2">
            {locations.length >= 2 && (
              <Button variant="outline" onClick={() => setShowTransfer(true)}>
                <ArrowLeftRight className="w-4 h-4 mr-2" />Transferir stock
              </Button>
            )}
            <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold" onClick={() => { setEditingLoc(null); setShowForm(true); }}>
              <Plus className="w-4 h-4 mr-2" />Nuevo local
            </Button>
          </div>
        }
      />

      {loading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Cargando sucursales…</div>
      ) : locations.length === 0 ? (
        <div className="text-center py-20">
          <MapPin className="w-12 h-12 mx-auto mb-4 text-muted-foreground/20" />
          <p className="text-lg text-muted-foreground font-medium">Sin sucursales configuradas</p>
          <p className="text-sm text-muted-foreground mt-1">Agregá tu primer local para comenzar a gestionar stock por sucursal</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {locations.map((loc) => {
            const stock = locationStock[loc.id] || [];
            const totalUnits = stock.reduce((s, ls) => s + ls.stock, 0);
            return (
              <div key={loc.id} className="bg-card border border-border/60 rounded-xl p-5 shadow-card">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {loc.is_main && <Star className="w-4 h-4 text-primary shrink-0" />}
                    <div>
                      <h3 className="font-semibold">{loc.name}</h3>
                      {loc.address && <p className="text-xs text-muted-foreground mt-0.5">{loc.address}</p>}
                      {loc.phone && <p className="text-xs text-muted-foreground">{loc.phone}</p>}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={() => { setEditingLoc(loc); setShowForm(true); }}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    {!loc.is_main && (
                      <Button variant="ghost" size="sm" onClick={() => deleteLoc(loc)}>
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 text-sm border-t border-border/50 pt-3">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Package className="w-3.5 h-3.5" />
                    <span>{totalUnits} u. en {stock.length} productos</span>
                  </div>
                </div>

                {stock.length > 0 && (
                  <div className="mt-3 space-y-1">
                    {stock.slice(0, 4).map((ls) => (
                      <div key={ls.product_id} className="flex justify-between text-xs">
                        <span className="text-muted-foreground truncate max-w-[160px]">{ls.product_name}</span>
                        <span className="font-mono">{ls.stock} u.</span>
                      </div>
                    ))}
                    {stock.length > 4 && <p className="text-[10px] text-muted-foreground">+{stock.length - 4} productos más</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Transfer history */}
      {transfers.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <ArrowLeftRight className="w-4 h-4" />Últimas transferencias
          </h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Fecha</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Producto</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Cant.</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden sm:table-cell">Desde → Hacia</th>
                </tr>
              </thead>
              <tbody>
                {transfers.map((t) => (
                  <tr key={t.id} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{new Date(t.created_at).toLocaleDateString("es-AR")}</td>
                    <td className="px-3 py-2 font-medium">{t.product_name}</td>
                    <td className="px-3 py-2">{t.quantity} u.</td>
                    <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">
                      {t.from_location?.name ?? "—"} → {t.to_location?.name ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create/Edit Location Dialog */}
      <Dialog open={showForm} onOpenChange={v => { setShowForm(v); if (!v) setEditingLoc(null); }}>
        <DialogContent className="bg-card border-border/60 max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">{editingLoc ? "Editar local" : "Nuevo local"}</DialogTitle>
          </DialogHeader>
          <LocationForm
            initial={editingLoc ? { ...editingLoc } : undefined}
            onSave={handleSave}
            onClose={() => { setShowForm(false); setEditingLoc(null); }}
          />
        </DialogContent>
      </Dialog>

      {/* Transfer Dialog */}
      <Dialog open={showTransfer} onOpenChange={setShowTransfer}>
        <DialogContent className="bg-card border-border/60 max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Transferir stock entre locales</DialogTitle>
          </DialogHeader>
          {user && activeOrg && (
            <TransferDialog
              locations={locations}
              products={products}
              orgId={activeOrg.id}
              userId={user.id}
              onClose={() => setShowTransfer(false)}
              onDone={load}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
