import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { usePageTitle } from "@/hooks/usePageTitle";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { KPICard } from "@/components/shared/KPICard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  ShoppingBag, Plus, Pencil, Trash2, ExternalLink, RefreshCw,
  Eye, ShoppingCart, DollarSign, TrendingUp, Settings2,
} from "lucide-react";

interface Channel {
  id: string;
  channel: string;
  store_name: string;
  store_url: string | null;
  is_active: boolean;
  last_synced_at: string | null;
}

interface Listing {
  id: string;
  channel_id: string;
  product_id: string | null;
  external_id: string | null;
  title: string;
  price: number;
  original_price: number | null;
  currency: string;
  stock: int;
  status: string;
  listing_url: string | null;
  commission_pct: number;
  views: number;
  sales_count: number;
  revenue: number;
  notes: string | null;
  updated_at: string;
}

interface MLOrder {
  id: string;
  channel_id: string;
  listing_id: string | null;
  external_order_id: string | null;
  buyer_name: string | null;
  quantity: number;
  unit_price: number;
  total_amount: number;
  commission: number;
  net_amount: number;
  status: string;
  tracking_code: string | null;
  order_date: string;
}

interface Product { id: string; name: string; sku: string | null; price: number; }

const CHANNELS = [
  { value: "mercadolibre", label: "MercadoLibre", emoji: "🛒", color: "text-yellow-400" },
  { value: "tiendanube", label: "Tiendanube", emoji: "☁️", color: "text-blue-400" },
  { value: "woocommerce", label: "WooCommerce", emoji: "🔧", color: "text-purple-400" },
  { value: "shopify", label: "Shopify", emoji: "🟢", color: "text-emerald-400" },
  { value: "instagram_shop", label: "Instagram Shop", emoji: "📸", color: "text-pink-400" },
  { value: "facebook_shop", label: "Facebook Shop", emoji: "👥", color: "text-blue-500" },
  { value: "amazon", label: "Amazon", emoji: "📦", color: "text-orange-400" },
  { value: "otro", label: "Otro", emoji: "🌐", color: "text-muted-foreground" },
];

const LISTING_STATUS: Record<string, { label: string; color: string }> = {
  active:   { label: "Activo",    color: "bg-emerald-500/15 text-emerald-400" },
  paused:   { label: "Pausado",   color: "bg-yellow-500/15 text-yellow-400" },
  closed:   { label: "Cerrado",   color: "bg-muted/50 text-muted-foreground" },
  pending:  { label: "Pendiente", color: "bg-blue-500/15 text-blue-400" },
  deleted:  { label: "Eliminado", color: "bg-destructive/15 text-destructive" },
};

const ORDER_STATUS: Record<string, { label: string; color: string }> = {
  pending:   { label: "Pendiente", color: "bg-yellow-500/15 text-yellow-400" },
  paid:      { label: "Pagado",    color: "bg-blue-500/15 text-blue-400" },
  shipped:   { label: "Enviado",   color: "bg-primary/15 text-primary" },
  delivered: { label: "Entregado", color: "bg-emerald-500/15 text-emerald-400" },
  cancelled: { label: "Cancelado", color: "bg-muted/50 text-muted-foreground" },
  refunded:  { label: "Devuelto",  color: "bg-destructive/15 text-destructive" },
};

function fmt(n: number) {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 0 }).format(n);
}
function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}

export default function MarketplaceListingsPage() {
  usePageTitle("Marketplace & Canales de Venta");
  const { activeOrg } = useOrg();
  const orgId = activeOrg?.id ?? "";

  const [channels, setChannels] = useState<Channel[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [orders, setOrders] = useState<MLOrder[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("listings");
  const [channelFilter, setChannelFilter] = useState("all");

  const [channelOpen, setChannelOpen] = useState(false);
  const [listingOpen, setListingOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [editingListing, setEditingListing] = useState<Listing | null>(null);

  const [channelForm, setChannelForm] = useState({ channel: "mercadolibre", store_name: "", store_url: "" });
  const [listingForm, setListingForm] = useState({
    channel_id: "", product_id: "", title: "", description: "",
    price: "", original_price: "", stock: "0", status: "active",
    listing_url: "", commission_pct: "0", notes: "",
  });
  const [orderForm, setOrderForm] = useState({
    channel_id: "", listing_id: "", buyer_name: "", quantity: "1",
    unit_price: "", status: "paid", tracking_code: "",
  });

  async function loadData() {
    if (!orgId) return;
    setLoading(true);
    const [chRes, lsRes, ordRes, prodRes] = await Promise.all([
      supabase.from("marketplace_channels").select("*").eq("org_id", orgId).order("created_at"),
      supabase.from("marketplace_listings").select("*").eq("org_id", orgId).order("updated_at", { ascending: false }),
      supabase.from("marketplace_orders").select("*").eq("org_id", orgId).order("order_date", { ascending: false }).limit(100),
      supabase.from("products").select("id, name, sku, price").eq("org_id", orgId).order("name").limit(300),
    ]);
    setChannels((chRes.data || []) as Channel[]);
    setListings((lsRes.data || []) as Listing[]);
    setOrders((ordRes.data || []) as MLOrder[]);
    setProducts((prodRes.data || []) as Product[]);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [orgId]);

  async function saveChannel() {
    if (!channelForm.store_name.trim()) { toast.error("Nombre de tienda requerido"); return; }
    const { error } = await supabase.from("marketplace_channels").insert({
      org_id: orgId, channel: channelForm.channel,
      store_name: channelForm.store_name.trim(),
      store_url: channelForm.store_url || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Canal agregado");
    setChannelOpen(false);
    setChannelForm({ channel: "mercadolibre", store_name: "", store_url: "" });
    loadData();
  }

  async function saveListing() {
    if (!listingForm.channel_id || !listingForm.title.trim() || !listingForm.price) {
      toast.error("Canal, título y precio son requeridos"); return;
    }
    const payload = {
      org_id: orgId, channel_id: listingForm.channel_id,
      product_id: listingForm.product_id || null,
      title: listingForm.title.trim(), price: Number(listingForm.price),
      original_price: listingForm.original_price ? Number(listingForm.original_price) : null,
      stock: Number(listingForm.stock), status: listingForm.status,
      listing_url: listingForm.listing_url || null,
      commission_pct: Number(listingForm.commission_pct),
      notes: listingForm.notes || null,
    };
    if (editingListing) {
      const { error } = await supabase.from("marketplace_listings").update(payload).eq("id", editingListing.id);
      if (error) { toast.error(error.message); return; }
      toast.success("Listing actualizado");
    } else {
      const { error } = await supabase.from("marketplace_listings").insert(payload);
      if (error) { toast.error(error.message); return; }
      toast.success("Listing creado");
    }
    setListingOpen(false); setEditingListing(null);
    setListingForm({ channel_id: "", product_id: "", title: "", description: "", price: "", original_price: "", stock: "0", status: "active", listing_url: "", commission_pct: "0", notes: "" });
    loadData();
  }

  async function saveOrder() {
    if (!orderForm.channel_id || !orderForm.unit_price) { toast.error("Canal y precio requeridos"); return; }
    const qty = Number(orderForm.quantity);
    const unitPrice = Number(orderForm.unit_price);
    const total = qty * unitPrice;
    const listing = listings.find(l => l.id === orderForm.listing_id);
    const commPct = listing ? listing.commission_pct / 100 : 0;
    const commission = total * commPct;

    const { error } = await supabase.from("marketplace_orders").insert({
      org_id: orgId, channel_id: orderForm.channel_id,
      listing_id: orderForm.listing_id || null,
      buyer_name: orderForm.buyer_name || null, quantity: qty,
      unit_price: unitPrice, total_amount: total,
      commission, net_amount: total - commission,
      status: orderForm.status,
      tracking_code: orderForm.tracking_code || null,
    });
    if (error) { toast.error(error.message); return; }

    // Update listing metrics
    if (orderForm.listing_id) {
      await supabase.from("marketplace_listings").update({
        sales_count: (listing?.sales_count || 0) + qty,
        revenue: (listing?.revenue || 0) + total,
        stock: Math.max(0, (listing?.stock || 0) - qty),
      }).eq("id", orderForm.listing_id);
    }

    toast.success(`Venta registrada: ${fmt(total)}`);
    setOrderOpen(false);
    setOrderForm({ channel_id: "", listing_id: "", buyer_name: "", quantity: "1", unit_price: "", status: "paid", tracking_code: "" });
    loadData();
  }

  async function deleteListing(id: string) {
    if (!confirm("¿Eliminar listing?")) return;
    await supabase.from("marketplace_listings").delete().eq("id", id);
    toast.success("Listing eliminado");
    loadData();
  }

  async function deleteChannel(id: string) {
    if (!confirm("¿Eliminar canal y todos sus listings?")) return;
    await supabase.from("marketplace_channels").delete().eq("id", id);
    toast.success("Canal eliminado");
    loadData();
  }

  const filtered = channelFilter === "all" ? listings : listings.filter(l => l.channel_id === channelFilter);
  const totalRevenue = orders.reduce((s, o) => s + o.net_amount, 0);
  const totalOrders = orders.length;
  const activeListings = listings.filter(l => l.status === "active").length;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ShoppingBag}
        title="Marketplace & Canales de Venta"
        description="Gestioná listings en MercadoLibre, Tiendanube, Shopify y más desde un solo lugar."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setChannelOpen(true)}>
              <Settings2 className="w-4 h-4 mr-1" /> Canal
            </Button>
            <Button variant="outline" onClick={() => setOrderOpen(true)} disabled={channels.length === 0}>
              <ShoppingCart className="w-4 h-4 mr-1" /> Venta
            </Button>
            <Button onClick={() => { setEditingListing(null); setListingOpen(true); }} disabled={channels.length === 0}>
              <Plus className="w-4 h-4 mr-1" /> Listing
            </Button>
          </div>
        }
      />

      {/* Channel pills */}
      {channels.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {channels.map(ch => {
            const meta = CHANNELS.find(c => c.value === ch.channel);
            return (
              <div key={ch.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${ch.is_active ? "border-border/50 bg-card" : "border-border/20 bg-muted/20 opacity-60"} text-sm`}>
                <span>{meta?.emoji}</span>
                <span className="font-medium">{ch.store_name}</span>
                <button onClick={() => deleteChannel(ch.id)} className="text-muted-foreground/40 hover:text-destructive ml-1">×</button>
              </div>
            );
          })}
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard label="Listings activos" value={activeListings} icon={ShoppingBag} color="success" />
        <KPICard label="Órdenes totales" value={totalOrders} icon={ShoppingCart} color="primary" />
        <KPICard label="Vistas totales" value={listings.reduce((s, l) => s + l.views, 0).toLocaleString("es-AR")} icon={Eye} color="blue" />
        <KPICard label="Ingresos netos" value={fmt(totalRevenue)} icon={DollarSign} color="success" />
      </div>

      {channels.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <ShoppingBag className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Primero agregá un canal de venta (MercadoLibre, Tiendanube, etc.).</p>
          <Button className="mt-4" onClick={() => setChannelOpen(true)}><Plus className="w-4 h-4 mr-1" /> Agregar canal</Button>
        </div>
      ) : loading ? <div className="text-center py-12 text-muted-foreground">Cargando...</div> : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="listings">Listings ({listings.length})</TabsTrigger>
            <TabsTrigger value="orders">Órdenes ({orders.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="listings" className="pt-3 space-y-3">
            {/* Channel filter */}
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setChannelFilter("all")}
                className={`px-3 py-1 rounded-full text-xs font-medium ${channelFilter === "all" ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground"}`}>
                Todos
              </button>
              {channels.map(ch => (
                <button key={ch.id} onClick={() => setChannelFilter(ch.id)}
                  className={`px-3 py-1 rounded-full text-xs font-medium ${channelFilter === ch.id ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground"}`}>
                  {CHANNELS.find(c => c.value === ch.channel)?.emoji} {ch.store_name}
                </button>
              ))}
            </div>

            {filtered.length === 0 ? (
              <p className="text-center py-10 text-muted-foreground text-sm">Sin listings. Creá uno.</p>
            ) : (
              <div className="rounded-xl border border-border/50 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/20 border-b border-border/50">
                    <tr className="text-xs text-muted-foreground">
                      <th className="text-left px-3 py-2.5">Título</th>
                      <th className="text-left px-3 py-2.5 hidden md:table-cell">Canal</th>
                      <th className="text-right px-3 py-2.5">Precio</th>
                      <th className="text-right px-3 py-2.5 hidden sm:table-cell">Stock</th>
                      <th className="text-right px-3 py-2.5 hidden md:table-cell">Ventas</th>
                      <th className="text-left px-3 py-2.5">Estado</th>
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(listing => {
                      const ch = channels.find(c => c.id === listing.channel_id);
                      const chMeta = CHANNELS.find(c => c.value === ch?.channel);
                      const st = LISTING_STATUS[listing.status];
                      return (
                        <tr key={listing.id} className="border-b border-border/30 hover:bg-muted/20">
                          <td className="px-3 py-2">
                            <p className="font-medium text-sm truncate max-w-[200px]">{listing.title}</p>
                            {listing.external_id && <p className="text-xs text-muted-foreground">{listing.external_id}</p>}
                          </td>
                          <td className="px-3 py-2 hidden md:table-cell text-xs">
                            {chMeta?.emoji} {ch?.store_name}
                          </td>
                          <td className="px-3 py-2 text-right font-mono font-semibold">{fmt(listing.price)}</td>
                          <td className="px-3 py-2 text-right hidden sm:table-cell">{listing.stock}</td>
                          <td className="px-3 py-2 text-right hidden md:table-cell">{listing.sales_count}</td>
                          <td className="px-3 py-2">
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {listing.listing_url && (
                                <a href={listing.listing_url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary">
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                              )}
                              <button onClick={() => {
                                setEditingListing(listing);
                                setListingForm({ channel_id: listing.channel_id, product_id: listing.product_id || "", title: listing.title, description: "", price: String(listing.price), original_price: listing.original_price ? String(listing.original_price) : "", stock: String(listing.stock), status: listing.status, listing_url: listing.listing_url || "", commission_pct: String(listing.commission_pct), notes: listing.notes || "" });
                                setListingOpen(true);
                              }} className="text-muted-foreground hover:text-primary"><Pencil className="w-3.5 h-3.5" /></button>
                              <button onClick={() => deleteListing(listing.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="orders" className="pt-3">
            {orders.length === 0 ? (
              <p className="text-center py-10 text-muted-foreground text-sm">Sin órdenes.</p>
            ) : (
              <div className="rounded-xl border border-border/50 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/20 border-b border-border/50">
                    <tr className="text-xs text-muted-foreground">
                      <th className="text-left px-3 py-2.5">Comprador</th>
                      <th className="text-left px-3 py-2.5 hidden md:table-cell">Canal</th>
                      <th className="text-right px-3 py-2.5">Total</th>
                      <th className="text-right px-3 py-2.5 hidden sm:table-cell">Neto</th>
                      <th className="text-left px-3 py-2.5">Estado</th>
                      <th className="text-right px-3 py-2.5 hidden md:table-cell">Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map(order => {
                      const ch = channels.find(c => c.id === order.channel_id);
                      const chMeta = CHANNELS.find(c => c.value === ch?.channel);
                      const st = ORDER_STATUS[order.status];
                      return (
                        <tr key={order.id} className="border-b border-border/30 hover:bg-muted/20">
                          <td className="px-3 py-2">
                            <p className="font-medium">{order.buyer_name || "—"}</p>
                            {order.external_order_id && <p className="text-xs text-muted-foreground">{order.external_order_id}</p>}
                          </td>
                          <td className="px-3 py-2 hidden md:table-cell text-xs">{chMeta?.emoji} {ch?.store_name}</td>
                          <td className="px-3 py-2 text-right font-mono font-semibold">{fmt(order.total_amount)}</td>
                          <td className="px-3 py-2 text-right hidden sm:table-cell font-mono text-emerald-400">{fmt(order.net_amount)}</td>
                          <td className="px-3 py-2"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${st.color}`}>{st.label}</span></td>
                          <td className="px-3 py-2 text-right hidden md:table-cell text-muted-foreground text-xs">{fmtDate(order.order_date)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      )}

      {/* Channel dialog */}
      <Dialog open={channelOpen} onOpenChange={setChannelOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Agregar canal de venta</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Plataforma</Label>
              <Select value={channelForm.channel} onValueChange={v => setChannelForm(p => ({ ...p, channel: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CHANNELS.map(c => <SelectItem key={c.value} value={c.value}>{c.emoji} {c.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Nombre de la tienda *</Label>
              <Input value={channelForm.store_name} onChange={e => setChannelForm(p => ({ ...p, store_name: e.target.value }))} placeholder="Mi Tienda ML..." />
            </div>
            <div><Label>URL de la tienda</Label>
              <Input value={channelForm.store_url} onChange={e => setChannelForm(p => ({ ...p, store_url: e.target.value }))} placeholder="https://..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChannelOpen(false)}>Cancelar</Button>
            <Button onClick={saveChannel}>Agregar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Listing dialog */}
      <Dialog open={listingOpen} onOpenChange={v => { setListingOpen(v); if (!v) setEditingListing(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingListing ? "Editar listing" : "Nuevo listing"}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Canal *</Label>
              <Select value={listingForm.channel_id} onValueChange={v => setListingForm(p => ({ ...p, channel_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Seleccioná canal..." /></SelectTrigger>
                <SelectContent>{channels.map(c => <SelectItem key={c.id} value={c.id}>{CHANNELS.find(x => x.value === c.channel)?.emoji} {c.store_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Producto del catálogo</Label>
              <Select value={listingForm.product_id || "none"} onValueChange={v => {
                const prod = products.find(p => p.id === v);
                setListingForm(p => ({ ...p, product_id: v === "none" ? "" : v, title: prod?.name || p.title, price: prod ? String(prod.price) : p.price }));
              }}>
                <SelectTrigger><SelectValue placeholder="(ninguno)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ninguno (manual)</SelectItem>
                  {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Título *</Label>
              <Input value={listingForm.title} onChange={e => setListingForm(p => ({ ...p, title: e.target.value }))} placeholder="Zapatillas Nike..." />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label>Precio *</Label>
                <Input type="number" min="0" value={listingForm.price} onChange={e => setListingForm(p => ({ ...p, price: e.target.value }))} placeholder="$0" />
              </div>
              <div><Label>Precio tachado</Label>
                <Input type="number" min="0" value={listingForm.original_price} onChange={e => setListingForm(p => ({ ...p, original_price: e.target.value }))} placeholder="$0" />
              </div>
              <div><Label>Stock</Label>
                <Input type="number" min="0" value={listingForm.stock} onChange={e => setListingForm(p => ({ ...p, stock: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Comisión %</Label>
                <Input type="number" min="0" max="100" step="0.1" value={listingForm.commission_pct}
                  onChange={e => setListingForm(p => ({ ...p, commission_pct: e.target.value }))} placeholder="6.5" />
              </div>
              <div><Label>Estado</Label>
                <Select value={listingForm.status} onValueChange={v => setListingForm(p => ({ ...p, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(LISTING_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>URL del listing</Label>
              <Input value={listingForm.listing_url} onChange={e => setListingForm(p => ({ ...p, listing_url: e.target.value }))} placeholder="https://..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setListingOpen(false); setEditingListing(null); }}>Cancelar</Button>
            <Button onClick={saveListing}>{editingListing ? "Guardar" : "Crear listing"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Order dialog */}
      <Dialog open={orderOpen} onOpenChange={setOrderOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Registrar venta de marketplace</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div><Label>Canal *</Label>
              <Select value={orderForm.channel_id} onValueChange={v => setOrderForm(p => ({ ...p, channel_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Canal..." /></SelectTrigger>
                <SelectContent>{channels.map(c => <SelectItem key={c.id} value={c.id}>{c.store_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Listing</Label>
              <Select value={orderForm.listing_id || "none"} onValueChange={v => {
                const listing = listings.find(l => l.id === v);
                setOrderForm(p => ({ ...p, listing_id: v === "none" ? "" : v, unit_price: listing ? String(listing.price) : p.unit_price }));
              }}>
                <SelectTrigger><SelectValue placeholder="(ninguno)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ninguno</SelectItem>
                  {listings.filter(l => l.channel_id === orderForm.channel_id || !orderForm.channel_id).map(l => (
                    <SelectItem key={l.id} value={l.id}>{l.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Comprador</Label>
                <Input value={orderForm.buyer_name} onChange={e => setOrderForm(p => ({ ...p, buyer_name: e.target.value }))} placeholder="Nombre..." />
              </div>
              <div><Label>Cantidad</Label>
                <Input type="number" min="1" value={orderForm.quantity} onChange={e => setOrderForm(p => ({ ...p, quantity: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Precio unitario *</Label>
                <Input type="number" min="0" value={orderForm.unit_price} onChange={e => setOrderForm(p => ({ ...p, unit_price: e.target.value }))} placeholder="$0" />
              </div>
              <div><Label>Estado</Label>
                <Select value={orderForm.status} onValueChange={v => setOrderForm(p => ({ ...p, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(ORDER_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Tracking</Label>
              <Input value={orderForm.tracking_code} onChange={e => setOrderForm(p => ({ ...p, tracking_code: e.target.value }))} placeholder="OCA-XXXX..." />
            </div>
            {orderForm.unit_price && orderForm.quantity && (
              <div className="rounded-lg bg-muted/30 p-3 text-xs">
                Total: <strong>{fmt(Number(orderForm.unit_price) * Number(orderForm.quantity))}</strong>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOrderOpen(false)}>Cancelar</Button>
            <Button onClick={saveOrder}>Registrar venta</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
