import { useState, useEffect } from "react";
import { useOrg } from "@/lib/orgContext";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { getProductsDB, formatARS, setStockAbsoluteDB } from "@/lib/supabaseStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { MapPin, Plus, Edit2, Trash2, ArrowLeftRight, Package, Phone, Star, Check, Warehouse, Building2 } from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";
import WarehouseZonesTab from "@/components/locations/WarehouseZonesTab";

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

type VariantLocationStock = {
  product_id: string;
  variant_id: string;
  stock: number;
};

type ProductVariant = {
  id: string;
  product_id: string;
  variant_name: string;
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
  locationStock,
  productVariants,
  variantLocationStock,
  onClose,
  onDone,
}: {
  locations: Location[];
  products: any[];
  /** Stock por sucursal, indexado por `location_id`. */
  locationStock: Record<string, LocationStock[]>;
  productVariants: ProductVariant[];
  /** Variantes físicas por sucursal. No se deducen desde el producto agregado. */
  variantLocationStock: Record<string, VariantLocationStock[]>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [fromLoc, setFromLoc] = useState("");
  const [toLoc, setToLoc] = useState("");
  const [stockItemKey, setStockItemKey] = useState("");
  const [qty, setQty] = useState("1");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Un producto con variantes no se puede transferir como agregado: no sabríamos
  // si viajaron 50 ml, 100 ml o un sabor concreto. Escondemos su saldo agregado
  // y mostramos únicamente los saldos físicos de cada variante.
  const productsWithVariants = new Set(productVariants.map(variant => variant.product_id));
  const disponibles = [
    ...(locationStock[fromLoc] ?? [])
      .filter(ls => ls.stock > 0 && !productsWithVariants.has(ls.product_id))
      .map(ls => ({
        key: `product:${ls.product_id}`,
        product_id: ls.product_id,
        variant_id: null as string | null,
        stock: ls.stock,
        product_name: products.find(p => p.id === ls.product_id)?.name ?? ls.product_name ?? "Producto",
      })),
    ...(variantLocationStock[fromLoc] ?? [])
      .filter(ls => ls.stock > 0)
      .map(ls => {
        const variant = productVariants.find(v => v.id === ls.variant_id);
        const productName = products.find(p => p.id === ls.product_id)?.name ?? "Producto";
        return {
          key: `variant:${ls.variant_id}`,
          product_id: ls.product_id,
          variant_id: ls.variant_id,
          stock: ls.stock,
          product_name: `${productName} — ${variant?.variant_name ?? "Variante"}`,
        };
      }),
  ]
    .sort((a, b) => a.product_name.localeCompare(b.product_name));

  const selectedItem = disponibles.find(d => d.key === stockItemKey);
  const maxDisponible = selectedItem?.stock ?? 0;

  /**
   * Transferir por RPC, no escribiendo `location_stock` desde acá.
   *
   * Antes esta pantalla insertaba el `stock_transfers` y después ajustaba las
   * dos sucursales con un read-modify-write. Con `Math.max(0, stock + delta)`
   * en el origen y un INSERT del delta completo en el destino, **inventaba
   * mercadería**: verificado contra la base, transferir 50 unidades teniendo 10
   * dejaba origen 0 y destino 50, con el total de la organización todavía en 10.
   * Además dos transferencias simultáneas se pisaban, y ninguna dejaba asiento
   * en el Kardex.
   *
   * `transfer_stock_between_locations` valida contra lo que hay, serializa con
   * `FOR UPDATE` y deja los dos movimientos. La validación de acá abajo es sólo
   * para no ir al servidor por gusto: la que manda es la del RPC.
   */
  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromLoc || !toLoc || !selectedItem || !qty) { toast.error("Completá todos los campos"); return; }
    if (fromLoc === toLoc) { toast.error("Los locales de origen y destino deben ser distintos"); return; }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc("transfer_stock_between_locations", {
        p_from_location_id: fromLoc,
        p_to_location_id: toLoc,
        p_product_id: selectedItem.product_id,
        p_variant_id: selectedItem.variant_id,
        p_quantity: Number(qty),
        p_notes: notes.trim() || null,
      });
      if (error) throw error;
      const r = data as { producto?: string; origen?: number; destino?: number } | null;
      toast.success(
        `${qty} u. de ${r?.producto ?? "el producto"} — origen ${r?.origen ?? 0}, destino ${r?.destino ?? 0}`,
      );
      onDone();
      onClose();
    } catch (e) {
      // El RPC dice cuántas unidades hay y cuántas se pedían; eso es más útil
      // que "error al transferir".
      toast.error(e instanceof Error ? e.message : "Error al transferir");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleTransfer} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Desde</label>
          <Select value={fromLoc} onValueChange={value => { setFromLoc(value); setStockItemKey(""); }}>
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
        <label className="text-xs text-muted-foreground mb-1 block">Producto o variante</label>
        <Select value={stockItemKey} onValueChange={setStockItemKey} disabled={!fromLoc}>
          <SelectTrigger>
            <SelectValue placeholder={fromLoc ? "Seleccioná producto" : "Elegí primero el origen"} />
          </SelectTrigger>
          <SelectContent>
            {disponibles.length === 0 && (
              <div className="px-2 py-3 text-xs text-muted-foreground">
                Esa sucursal no tiene stock cargado.
              </div>
            )}
            {disponibles.map(d => (
              <SelectItem key={d.key} value={d.key}>
                {d.product_name} ({d.stock} u. acá)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Los productos con variantes se transfieren por presentación concreta para que el depósito de despacho conserve stock real.
        </p>
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">
          Cantidad{maxDisponible > 0 && <span className="text-muted-foreground/70"> — hay {maxDisponible}</span>}
        </label>
        <Input
          type="number" min="1" max={maxDisponible || undefined}
          value={qty} onChange={e => setQty(e.target.value)}
          className={Number(qty) > maxDisponible && maxDisponible > 0 ? "border-destructive" : ""}
        />
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Notas (opcional)</label>
        <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Motivo de la transferencia…" />
      </div>
      <div className="flex gap-2 pt-2">
        <Button
          type="submit"
          className="flex-1 gradient-gold text-primary-foreground font-semibold"
          disabled={saving || !selectedItem || Number(qty) < 1 || Number(qty) > maxDisponible}
        >
          <ArrowLeftRight className="w-4 h-4 mr-1.5" />{saving ? "Transfiriendo…" : "Transferir"}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
      </div>
    </form>
  );
}

/** Ajusta el saldo final de una variante en un depósito concreto.
 *
 * No es una escritura directa: `adjust_stock` calcula el delta y delega en
 * Kardex. Cuando hay dos sucursales, el servidor exige este locationId incluso
 * si alguien modifica el formulario en el navegador.
 */
function AdjustVariantStockDialog({
  locations,
  products,
  productVariants,
  variantLocationStock,
  onClose,
  onDone,
}: {
  locations: Location[];
  products: any[];
  productVariants: ProductVariant[];
  variantLocationStock: Record<string, VariantLocationStock[]>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [locationId, setLocationId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [newStock, setNewStock] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const selectedVariant = productVariants.find(variant => variant.id === variantId);
  const currentStock = selectedVariant && locationId
    ? variantLocationStock[locationId]?.find(row => row.variant_id === selectedVariant.id)?.stock ?? 0
    : null;

  const handleAdjust = async (event: React.FormEvent) => {
    event.preventDefault();
    const desired = Number(newStock);
    if (!locationId || !selectedVariant || !Number.isInteger(desired) || desired < 0) {
      toast.error("Elegí depósito, variante y un stock válido");
      return;
    }
    setSaving(true);
    try {
      await setStockAbsoluteDB({
        productId: selectedVariant.product_id,
        variantId: selectedVariant.id,
        locationId,
        newStock: desired,
        notes: notes.trim() || "Ajuste de variante por depósito",
      });
      toast.success(`Stock de ${selectedVariant.variant_name} ajustado a ${desired} u.`);
      onDone();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo ajustar el stock");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleAdjust} className="space-y-4">
      <p className="text-xs text-muted-foreground">
        El número es el saldo final de esta presentación en este depósito. La base calcula el movimiento y lo deja en Kardex.
      </p>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Depósito</label>
        <Select value={locationId} onValueChange={value => { setLocationId(value); setNewStock(""); }}>
          <SelectTrigger><SelectValue placeholder="Elegí depósito" /></SelectTrigger>
          <SelectContent>{locations.map(location => (
            <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>
          ))}</SelectContent>
        </Select>
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Variante</label>
        <Select value={variantId} onValueChange={value => { setVariantId(value); setNewStock(""); }} disabled={!locationId}>
          <SelectTrigger><SelectValue placeholder={locationId ? "Elegí una variante" : "Elegí primero el depósito"} /></SelectTrigger>
          <SelectContent>{productVariants.map(variant => {
            const productName = products.find(product => product.id === variant.product_id)?.name ?? "Producto";
            return <SelectItem key={variant.id} value={variant.id}>{productName} — {variant.variant_name}</SelectItem>;
          })}</SelectContent>
        </Select>
        {currentStock !== null && <p className="mt-1 text-[11px] text-muted-foreground">Stock actual en este depósito: <strong>{currentStock}</strong> u.</p>}
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Stock final en este depósito</label>
        <Input type="number" min="0" step="1" value={newStock} onChange={event => setNewStock(event.target.value)} placeholder={currentStock === null ? "Elegí variante" : String(currentStock)} />
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1 block">Motivo (opcional)</label>
        <Input value={notes} onChange={event => setNotes(event.target.value)} placeholder="Ingreso, conteo, corrección…" />
      </div>
      <div className="flex gap-2 pt-2">
        <Button type="submit" className="flex-1 gradient-gold text-primary-foreground font-semibold" disabled={saving || !locationId || !variantId || newStock === ""}>
          <Package className="w-4 h-4 mr-1.5" />{saving ? "Ajustando…" : "Guardar stock"}
        </Button>
        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
      </div>
    </form>
  );
}

// `upsertLocationStock` se borró: ajustaba `location_stock` desde el navegador y
// era por donde se inventaba mercadería. Ahora esa tabla es de sólo lectura para
// la UI — la escriben `record_stock_movement` y
// `transfer_stock_between_locations`, que validan.

export default function LocationsPage() {
  usePageTitle("Sucursales & Depósitos");
  const { activeOrg } = useOrg();
  const { user } = useAuth();
  const [locations, setLocations] = useState<Location[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [transfers, setTransfers] = useState<any[]>([]);
  const [locationStock, setLocationStock] = useState<Record<string, LocationStock[]>>({});
  const [productVariants, setProductVariants] = useState<ProductVariant[]>([]);
  const [variantLocationStock, setVariantLocationStock] = useState<Record<string, VariantLocationStock[]>>({});
  const [loading, setLoading] = useState(true);
  const [mainTab, setMainTab] = useState<"sucursales" | "depositos">("sucursales");
  const [tab, setTab] = useState<"locations" | "transfers" | "stock">("locations");
  const [showForm, setShowForm] = useState(false);
  const [editingLoc, setEditingLoc] = useState<Location | null>(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showVariantAdjustment, setShowVariantAdjustment] = useState(false);

  const load = async () => {
    if (!activeOrg || !user) return;
    setLoading(true);

    const [{ data: locs }, prods, { data: txs }, { data: ls }, { data: variants }, { data: variantStock }] = await Promise.all([
      supabase.from("locations").select("*").eq("org_id", activeOrg.id).eq("active", true).order("is_main", { ascending: false }).order("name"),
      getProductsDB(user.id),
      supabase.from("stock_transfers").select("*, from_location:from_location_id(name), to_location:to_location_id(name)").eq("org_id", activeOrg.id).order("created_at", { ascending: false }).limit(20),
      supabase.from("location_stock").select("location_id, product_id, stock").eq("org_id", activeOrg.id),
      supabase.from("product_variants").select("id, product_id, variant_name").eq("org_id", activeOrg.id),
      supabase.from("location_variant_stock").select("location_id, product_id, variant_id, stock").eq("org_id", activeOrg.id),
    ]);

    setLocations((locs || []) as Location[]);
    setProducts(prods);
    setTransfers(txs || []);
    setProductVariants((variants ?? []) as ProductVariant[]);

    // Index location stock by location_id
    const stockIndex: Record<string, LocationStock[]> = {};
    for (const row of ls || []) {
      const prod = prods.find((p: any) => p.id === row.product_id);
      if (!stockIndex[row.location_id]) stockIndex[row.location_id] = [];
      stockIndex[row.location_id].push({ product_id: row.product_id, stock: row.stock, product_name: prod?.name });
    }
    setLocationStock(stockIndex);

    const variantStockIndex: Record<string, VariantLocationStock[]> = {};
    for (const row of variantStock || []) {
      if (!variantStockIndex[row.location_id]) variantStockIndex[row.location_id] = [];
      variantStockIndex[row.location_id].push({
        product_id: row.product_id,
        variant_id: row.variant_id,
        stock: row.stock,
      });
    }
    setVariantLocationStock(variantStockIndex);
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
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={MapPin}
        title="Sucursales & Depósitos"
        description="Locales, depósitos y zonas en un solo lugar"
      />

      {/* Main sections */}
      <div className="flex gap-1 bg-muted/30 p-1 rounded-xl w-fit">
        {[
          { id: "sucursales",  label: "Sucursales", icon: MapPin },
          { id: "depositos",   label: "Depósitos y Zonas", icon: Warehouse },
        ].map(t => (
          <button key={t.id} onClick={() => setMainTab(t.id as any)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${mainTab === t.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            <t.icon className="w-3.5 h-3.5" />{t.label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════ Sucursales ═══════════════════════════════════ */}
      {mainTab === "sucursales" && (
      <div className="space-y-6">
      <div className="flex items-center justify-end gap-2">
        {locations.length >= 1 && (
          <Button variant="outline" onClick={() => setShowVariantAdjustment(true)}>
            <Package className="w-4 h-4 mr-2" />Ajustar variante
          </Button>
        )}
        {locations.length >= 2 && (
          <Button variant="outline" onClick={() => setShowTransfer(true)}>
            <ArrowLeftRight className="w-4 h-4 mr-2" />Transferir stock
          </Button>
        )}
        <Button className="gradient-gold text-primary-foreground font-semibold shadow-gold" onClick={() => { setEditingLoc(null); setShowForm(true); }}>
          <Plus className="w-4 h-4 mr-2" />Nuevo local
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Sucursales activas" value={locations.length} icon={MapPin} color="primary" sub={`${locations.filter(l => l.is_main).length} principal`} />
        <KPICard label="Productos rastreados" value={Object.values(locationStock).flat().length} icon={Package} color="blue" sub="ítems con stock por sucursal" />
        <KPICard label="Unidades totales" value={Object.values(locationStock).flat().reduce((s, ls) => s + ls.stock, 0)} icon={Star} color="success" sub="en todos los locales" />
        <KPICard label="Transferencias" value={transfers.length} icon={ArrowLeftRight} color="purple" sub="historial reciente" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/30 p-1 rounded-xl w-fit">
        {[{ id: "locations", label: "Sucursales" }, { id: "transfers", label: "Transferencias" }, { id: "stock", label: "Stock comparativo" }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === t.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── Locations tab ─── */}
      {tab === "locations" && (
        loading ? (
          <div className="text-center py-12 text-muted-foreground text-sm">Cargando sucursales…</div>
        ) : locations.length === 0 ? (
          <div className="text-center py-20">
            <MapPin className="w-12 h-12 mx-auto mb-4 text-muted-foreground/20" />
            <p className="text-lg text-muted-foreground font-medium">Sin sucursales configuradas</p>
            <p className="text-sm text-muted-foreground mt-1">Agregá tu primer local para comenzar a gestionar stock por sucursal</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {locations.map((loc) => {
              const stock = locationStock[loc.id] || [];
              const totalUnits = stock.reduce((s, ls) => s + ls.stock, 0);
              return (
                <div key={loc.id} className="bg-card border border-border/60 rounded-xl p-5 shadow-card hover:border-primary/30 transition-all">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      {loc.is_main && <Star className="w-4 h-4 text-primary shrink-0" />}
                      <div>
                        <h3 className="font-semibold">{loc.name}</h3>
                        {loc.address && <p className="text-xs text-muted-foreground mt-0.5">{loc.address}</p>}
                        {loc.phone && <p className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="w-3 h-3" />{loc.phone}</p>}
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

                  <div className="flex items-center gap-3 text-sm border-t border-border/50 pt-3 mb-2">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Package className="w-3.5 h-3.5" />
                      <span className="text-xs">{totalUnits} u. en {stock.length} productos</span>
                    </div>
                  </div>

                  {stock.length > 0 && (
                    <div className="space-y-1">
                      {stock.slice(0, 4).map((ls) => (
                        <div key={ls.product_id} className="flex justify-between text-xs">
                          <span className="text-muted-foreground truncate max-w-[160px]">{ls.product_name}</span>
                          <span className="font-mono font-semibold">{ls.stock} u.</span>
                        </div>
                      ))}
                      {stock.length > 4 && <p className="text-[10px] text-muted-foreground">+{stock.length - 4} productos más</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ─── Transfers tab ─── */}
      {tab === "transfers" && (
        <div className="bg-card border border-border/40 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border/40 flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2"><ArrowLeftRight className="w-4 h-4 text-primary" />Historial de Transferencias</h3>
            <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => setShowTransfer(true)} disabled={locations.length < 2}>
              <Plus className="w-3.5 h-3.5" />Nueva transferencia
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/20">
                  {["Fecha", "Producto", "Cantidad", "Desde", "Hacia"].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transfers.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">Sin transferencias registradas</td></tr>
                ) : transfers.map((t) => (
                  <tr key={t.id} className="border-b border-border/20 hover:bg-muted/20">
                    <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(t.created_at).toLocaleDateString("es-AR")}</td>
                    <td className="px-4 py-3 font-medium text-sm">
                      {t.product_name}{t.variant_name ? ` — ${t.variant_name}` : ""}
                    </td>
                    <td className="px-4 py-3 text-xs font-semibold">{t.quantity} u.</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{t.from_location?.name ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-primary font-medium">{t.to_location?.name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─── Stock comparativo tab ─── */}
      {tab === "stock" && (
        <div className="bg-card border border-border/40 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border/40">
            <h3 className="font-semibold flex items-center gap-2"><Package className="w-4 h-4 text-primary" />Stock por Sucursal y Producto</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/20">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">Producto</th>
                  {locations.map(l => (
                    <th key={l.id} className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">{l.name}</th>
                  ))}
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Total</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const productMap: Record<string, { name: string; byLoc: Record<string, number> }> = {};
                  locations.forEach(loc => {
                    (locationStock[loc.id] ?? []).forEach(ls => {
                      if (!productMap[ls.product_id]) productMap[ls.product_id] = { name: ls.product_name ?? ls.product_id, byLoc: {} };
                      productMap[ls.product_id].byLoc[loc.id] = ls.stock;
                    });
                  });
                  const rows = Object.entries(productMap);
                  if (rows.length === 0) return (
                    <tr><td colSpan={locations.length + 2} className="px-4 py-10 text-center text-sm text-muted-foreground">Sin datos de stock por sucursal</td></tr>
                  );
                  return rows.map(([pid, data]) => {
                    const total = Object.values(data.byLoc).reduce((s, v) => s + v, 0);
                    return (
                      <tr key={pid} className="border-b border-border/20 hover:bg-muted/20">
                        <td className="px-4 py-3 font-medium text-sm">{data.name}</td>
                        {locations.map(l => (
                          <td key={l.id} className="px-4 py-3 text-right text-xs">
                            <span className={data.byLoc[l.id] > 0 ? "font-semibold" : "text-muted-foreground"}>
                              {data.byLoc[l.id] ?? 0}
                            </span>
                          </td>
                        ))}
                        <td className="px-4 py-3 text-right text-sm font-bold">{total}</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>
      )}

      {/* ═══════════════════════ Depósitos y Zonas ═════════════════════════════ */}
      {mainTab === "depositos" && <WarehouseZonesTab />}


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
              locationStock={locationStock}
              productVariants={productVariants}
              variantLocationStock={variantLocationStock}
              onClose={() => setShowTransfer(false)}
              onDone={load}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Ajuste localizado de variante */}
      <Dialog open={showVariantAdjustment} onOpenChange={setShowVariantAdjustment}>
        <DialogContent className="bg-card border-border/60 max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Ajustar stock de variante</DialogTitle>
          </DialogHeader>
          <AdjustVariantStockDialog
            locations={locations}
            products={products}
            productVariants={productVariants}
            variantLocationStock={variantLocationStock}
            onClose={() => setShowVariantAdjustment(false)}
            onDone={load}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
