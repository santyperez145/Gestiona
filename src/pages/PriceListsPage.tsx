import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DollarSign,
  Plus,
  Edit,
  Trash2,
  RefreshCw,
  Search,
  Tag,
  Package,
  Star,
  CheckCircle,
  Globe,
  ChevronDown,
  ChevronUp,
  Download,
} from "lucide-react";
import { format } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PriceList {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  currency: string;
  is_default: boolean;
  active: boolean;
  valid_from: string | null;
  valid_until: string | null;
  applies_to: "all" | "segment" | "customer";
  customer_segment: string | null;
  discount_type: "none" | "percentage" | "fixed";
  discount_value: number;
  created_at: string;
}

interface PriceListItem {
  id: string;
  price_list_id: string;
  product_id: string;
  custom_price: number;
  min_quantity: number;
  created_at: string;
  product?: { id: string; name: string; price: number; category: string | null };
}

interface Product {
  id: string;
  name: string;
  price: number;
  category: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CURRENCY_FLAGS: Record<string, string> = { ARS: "🇦🇷", USD: "🇺🇸", EUR: "🇪🇺", BRL: "🇧🇷", UYU: "🇺🇾" };

function fmtCurrency(amount: number, currency = "ARS") {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
}

function discountLabel(list: PriceList) {
  if (list.discount_type === "none") return "Sin descuento";
  if (list.discount_type === "percentage") return `-${list.discount_value}%`;
  return `-${fmtCurrency(list.discount_value, list.currency)}`;
}

// ─── Price List Form ──────────────────────────────────────────────────────────

interface PLFormProps {
  open: boolean;
  list: PriceList | null;
  orgId: string;
  onClose: () => void;
  onSaved: () => void;
}

function PLForm({ open, list, orgId, onClose, onSaved }: PLFormProps) {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [currency, setCurrency] = useState("ARS");
  const [isDefault, setIsDefault] = useState(false);
  const [active, setActive] = useState(true);
  const [validFrom, setValidFrom] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [appliesTo, setAppliesTo] = useState("all");
  const [segment, setSegment] = useState("");
  const [discountType, setDiscountType] = useState("none");
  const [discountValue, setDiscountValue] = useState("0");

  useEffect(() => {
    if (list) {
      setName(list.name); setDescription(list.description ?? ""); setCurrency(list.currency);
      setIsDefault(list.is_default); setActive(list.active);
      setValidFrom(list.valid_from ?? ""); setValidUntil(list.valid_until ?? "");
      setAppliesTo(list.applies_to); setSegment(list.customer_segment ?? "");
      setDiscountType(list.discount_type); setDiscountValue(String(list.discount_value));
    } else {
      setName(""); setDescription(""); setCurrency("ARS"); setIsDefault(false); setActive(true);
      setValidFrom(""); setValidUntil(""); setAppliesTo("all"); setSegment(""); setDiscountType("none"); setDiscountValue("0");
    }
  }, [list, open]);

  const handleSave = async () => {
    if (!name.trim()) { toast.error("Nombre requerido"); return; }
    setLoading(true);
    const payload = {
      org_id: orgId, name: name.trim(), description: description.trim() || null,
      currency, is_default: isDefault, active,
      valid_from: validFrom || null, valid_until: validUntil || null,
      applies_to: appliesTo, customer_segment: segment.trim() || null,
      discount_type: discountType, discount_value: parseFloat(discountValue) || 0,
    };
    const { error } = list
      ? await supabase.from("price_lists").update(payload).eq("id", list.id)
      : await supabase.from("price_lists").insert(payload);
    setLoading(false);
    if (error) { toast.error("Error: " + error.message); return; }
    toast.success(list ? "Lista actualizada" : "Lista creada");
    onSaved();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{list ? "Editar lista de precios" : "Nueva lista de precios"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Nombre *</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Lista Mayorista USD" />
            </div>
            <div className="col-span-2">
              <Label>Descripción</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} />
            </div>
            <div>
              <Label>Moneda</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(CURRENCY_FLAGS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v} {k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Aplica a</Label>
              <Select value={appliesTo} onValueChange={setAppliesTo}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="segment">Segmento</SelectItem>
                  <SelectItem value="customer">Cliente específico</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {appliesTo === "segment" && (
              <div className="col-span-2">
                <Label>Segmento</Label>
                <Input value={segment} onChange={e => setSegment(e.target.value)} placeholder="Ej: vip, mayorista, retail" />
              </div>
            )}
            <div>
              <Label>Descuento global</Label>
              <Select value={discountType} onValueChange={setDiscountType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin descuento</SelectItem>
                  <SelectItem value="percentage">Porcentaje (%)</SelectItem>
                  <SelectItem value="fixed">Monto fijo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {discountType !== "none" && (
              <div>
                <Label>{discountType === "percentage" ? "Descuento (%)" : "Monto a descontar"}</Label>
                <Input type="number" value={discountValue} onChange={e => setDiscountValue(e.target.value)} min="0" />
              </div>
            )}
            <div>
              <Label>Válida desde</Label>
              <Input type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)} />
            </div>
            <div>
              <Label>Válida hasta</Label>
              <Input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="is_default" checked={isDefault} onChange={e => setIsDefault(e.target.checked)} className="rounded" />
              <Label htmlFor="is_default">Lista predeterminada</Label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="pl_active" checked={active} onChange={e => setActive(e.target.checked)} className="rounded" />
              <Label htmlFor="pl_active">Activa</Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
            {list ? "Guardar" : "Crear lista"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Price List Items Dialog ──────────────────────────────────────────────────

interface PLItemsDialogProps {
  open: boolean;
  list: PriceList | null;
  products: Product[];
  orgId: string;
  onClose: () => void;
}

function PLItemsDialog({ open, list, products, orgId, onClose }: PLItemsDialogProps) {
  const [items, setItems] = useState<PriceListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [addProductId, setAddProductId] = useState("none");
  const [addPrice, setAddPrice] = useState("");
  const [addMinQty, setAddMinQty] = useState("1");

  const loadItems = useCallback(async () => {
    if (!list) return;
    setLoading(true);
    const { data } = await supabase
      .from("price_list_items")
      .select("*, product:products(id,name,price,category)")
      .eq("price_list_id", list.id)
      .order("created_at");
    setItems(data ?? []);
    setLoading(false);
  }, [list]);

  useEffect(() => { if (open) loadItems(); }, [open, loadItems]);

  const handleAddItem = async () => {
    if (addProductId === "none" || !addPrice) { toast.error("Seleccioná producto y precio"); return; }
    const { error } = await supabase.from("price_list_items").insert({
      price_list_id: list!.id,
      org_id: orgId,
      product_id: addProductId,
      custom_price: parseFloat(addPrice),
      min_quantity: parseInt(addMinQty) || 1,
    });
    if (error) { toast.error("Error: " + error.message); return; }
    toast.success("Precio agregado");
    setAddProductId("none"); setAddPrice(""); setAddMinQty("1");
    loadItems();
  };

  const handleDelete = async (id: string) => {
    await supabase.from("price_list_items").delete().eq("id", id);
    setItems(prev => prev.filter(i => i.id !== id));
    toast.success("Eliminado");
  };

  const filteredItems = items.filter(i =>
    !search || (i.product?.name ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const filteredProducts = products.filter(p =>
    !items.some(i => i.product_id === p.id)
  );

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="w-5 h-5" /> Precios — {list?.name}
          </DialogTitle>
        </DialogHeader>

        {/* Add item row */}
        <div className="flex gap-2 items-end border-b border-border pb-4">
          <div className="flex-1">
            <Label className="text-xs">Producto</Label>
            <Select value={addProductId} onValueChange={v => {
              setAddProductId(v);
              const prod = products.find(p => p.id === v);
              if (prod) setAddPrice(String(prod.price));
            }}>
              <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Seleccionar...</SelectItem>
                {filteredProducts.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-32">
            <Label className="text-xs">Precio personalizado</Label>
            <Input type="number" value={addPrice} onChange={e => setAddPrice(e.target.value)} placeholder="0.00" min="0" />
          </div>
          <div className="w-24">
            <Label className="text-xs">Cant. mín.</Label>
            <Input type="number" value={addMinQty} onChange={e => setAddMinQty(e.target.value)} min="1" />
          </div>
          <Button onClick={handleAddItem} size="sm">
            <Plus className="w-4 h-4 mr-1" /> Agregar
          </Button>
        </div>

        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Filtrar productos..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>

        <div className="overflow-y-auto flex-1 space-y-1">
          {loading ? <div className="flex justify-center py-6"><RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          : filteredItems.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
              Sin precios personalizados aún
            </div>
          ) : filteredItems.map(item => {
            const prod = item.product;
            const saving = prod ? prod.price - item.custom_price : 0;
            const savingPct = prod && prod.price > 0 ? Math.round((saving / prod.price) * 100) : 0;
            return (
              <div key={item.id} className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-card/50 hover:bg-muted/20 transition-colors">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{prod?.name ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    Precio base: {fmtCurrency(prod?.price ?? 0, list?.currency)}
                    {item.min_quantity > 1 ? ` · Mín: ${item.min_quantity} uds` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <p className="font-bold text-sm">{fmtCurrency(item.custom_price, list?.currency)}</p>
                    {saving > 0 && <p className="text-xs text-emerald-400">-{savingPct}%</p>}
                    {saving < 0 && <p className="text-xs text-amber-400">+{Math.abs(savingPct)}%</p>}
                  </div>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleDelete(item.id)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PriceListsPage() {
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";

  const [lists, setLists] = useState<PriceList[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [plFormOpen, setPLFormOpen] = useState(false);
  const [editingList, setEditingList] = useState<PriceList | null>(null);
  const [itemsDialogList, setItemsDialogList] = useState<PriceList | null>(null);

  const loadAll = async () => {
    if (!orgId) return;
    setLoading(true);
    const [listRes, prodRes] = await Promise.all([
      supabase.from("price_lists").select("*").eq("org_id", orgId).order("is_default", { ascending: false }).order("name"),
      supabase.from("products").select("id,name,price,category").eq("org_id", orgId).order("name"),
    ]);
    setLists(listRes.data ?? []);
    setProducts(prodRes.data ?? []);
    setLoading(false);
  };

  useEffect(() => { loadAll(); }, [orgId]);

  const kpis = useMemo(() => ({
    total: lists.length,
    active: lists.filter(l => l.active).length,
    currencies: [...new Set(lists.map(l => l.currency))].length,
    withDiscounts: lists.filter(l => l.discount_type !== "none").length,
  }), [lists]);

  const handleDelete = async (list: PriceList) => {
    if (!confirm(`¿Eliminar "${list.name}"?`)) return;
    const { error } = await supabase.from("price_lists").delete().eq("id", list.id);
    if (error) { toast.error("No se puede eliminar"); return; }
    setLists(prev => prev.filter(l => l.id !== list.id));
    toast.success("Lista eliminada");
  };

  const handleToggle = async (list: PriceList) => {
    await supabase.from("price_lists").update({ active: !list.active }).eq("id", list.id);
    setLists(prev => prev.map(l => l.id === list.id ? { ...l, active: !l.active } : l));
  };

  const exportCSV = () => {
    const rows = [["Lista", "Moneda", "Descuento", "Aplica a", "Activa"],
      ...lists.map(l => [l.name, l.currency, discountLabel(l), l.applies_to, l.active ? "Sí" : "No"])];
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "listas-precios.csv"; a.click();
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2">
            <Tag className="w-6 h-6 text-primary" />
            Listas de Precios
          </h1>
          <p className="text-muted-foreground text-sm mt-1">Precios segmentados por cliente, moneda y cantidad</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="w-4 h-4 mr-1.5" /> Exportar
          </Button>
          <Button size="sm" onClick={() => { setEditingList(null); setPLFormOpen(true); }}>
            <Plus className="w-4 h-4 mr-1.5" /> Nueva lista
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total listas", value: kpis.total, icon: Tag },
          { label: "Activas", value: kpis.active, icon: CheckCircle },
          { label: "Monedas", value: kpis.currencies, icon: Globe },
          { label: "Con descuento", value: kpis.withDiscounts, icon: DollarSign },
        ].map(k => (
          <div key={k.label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-1">
              <k.icon className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">{k.label}</span>
            </div>
            <p className="text-2xl font-bold">{k.value}</p>
          </div>
        ))}
      </div>

      {/* Lists */}
      {loading ? (
        <div className="flex justify-center py-12"><RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" /></div>
      ) : lists.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Tag className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Sin listas de precios</p>
          <p className="text-sm">Creá listas para diferentes segmentos o monedas</p>
        </div>
      ) : (
        <div className="space-y-3">
          {lists.map(list => (
            <div key={list.id} className={`rounded-xl border bg-card overflow-hidden transition-all ${!list.active ? "opacity-60" : ""}`}>
              <div
                className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/20 transition-colors"
                onClick={() => setExpanded(e => e === list.id ? null : list.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold">{list.name}</h3>
                    {list.is_default && <Badge className="text-xs bg-primary/15 text-primary"><Star className="w-3 h-3 mr-1" />Predeterminada</Badge>}
                    <span className="text-sm">{CURRENCY_FLAGS[list.currency] ?? "💱"} {list.currency}</span>
                    {list.discount_type !== "none" && <Badge className="text-xs bg-emerald-500/15 text-emerald-400">{discountLabel(list)}</Badge>}
                    {!list.active && <Badge className="text-xs bg-gray-500/15 text-gray-400">Inactiva</Badge>}
                    {list.applies_to !== "all" && <Badge className="text-xs bg-blue-500/15 text-blue-400">{list.applies_to === "segment" ? list.customer_segment : "Por cliente"}</Badge>}
                  </div>
                  {list.description && <p className="text-xs text-muted-foreground mt-1">{list.description}</p>}
                  {(list.valid_from || list.valid_until) && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {list.valid_from ? `Desde: ${format(new Date(list.valid_from), "dd/MM/yyyy")}` : ""}
                      {list.valid_until ? ` · Hasta: ${format(new Date(list.valid_until), "dd/MM/yyyy")}` : ""}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="outline" onClick={e => { e.stopPropagation(); setItemsDialogList(list); }}>
                    <Package className="w-3.5 h-3.5 mr-1" /> Precios
                  </Button>
                  <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); setEditingList(list); setPLFormOpen(true); }}>
                    <Edit className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); handleToggle(list); }}>
                    {list.active ? "Pausar" : "Activar"}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={e => { e.stopPropagation(); handleDelete(list); }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                  {expanded === list.id ? <ChevronUp className="w-4 h-4 ml-1 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 ml-1 text-muted-foreground" />}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <PLForm
        open={plFormOpen}
        list={editingList}
        orgId={orgId}
        onClose={() => { setPLFormOpen(false); setEditingList(null); }}
        onSaved={loadAll}
      />

      <PLItemsDialog
        open={!!itemsDialogList}
        list={itemsDialogList}
        products={products}
        orgId={orgId}
        onClose={() => setItemsDialogList(null)}
      />
    </div>
  );
}
