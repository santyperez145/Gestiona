import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  PackageSearch, Plus, Truck, DollarSign, TrendingUp,
  ExternalLink, ChevronDown, ChevronRight, CheckCircle,
  Clock, AlertCircle, XCircle, Package, RotateCcw, Loader2
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";

interface Supplier {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  country: string;
  currency: string;
  avg_dispatch_days: number;
  commission_pct: number;
  payment_terms: string | null;
  notes: string | null;
  active: boolean;
}

interface DropProduct {
  id: string;
  supplier_id: string;
  supplier_sku: string | null;
  supplier_price: number;
  sell_price: number;
  margin_pct: number;
  stock_status: string;
  supplier_url: string | null;
  notes: string | null;
  active: boolean;
  product_id: string | null;
  dropship_suppliers?: { name: string } | null;
}

interface DropOrder {
  id: string;
  order_number: string;
  supplier_id: string;
  customer_name: string;
  customer_phone: string | null;
  ship_address: string | null;
  ship_city: string | null;
  ship_province: string | null;
  supplier_total: number;
  sell_total: number;
  profit: number;
  status: string;
  tracking_code: string | null;
  estimated_delivery: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  notes: string | null;
  created_at: string;
  dropship_suppliers?: { name: string } | null;
  dropship_order_items?: OrderItem[];
}

interface OrderItem {
  id: string;
  product_name: string;
  supplier_sku: string | null;
  quantity: number;
  supplier_price: number;
  sell_price: number;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending:                { label: "Pendiente",          color: "bg-yellow-500/15 text-yellow-400",   icon: <Clock className="w-3 h-3" /> },
  ordered_from_supplier:  { label: "Pedido proveedor",   color: "bg-blue-500/15 text-blue-400",       icon: <Package className="w-3 h-3" /> },
  dispatched:             { label: "Despachado",          color: "bg-indigo-500/15 text-indigo-400",   icon: <Truck className="w-3 h-3" /> },
  in_transit:             { label: "En tránsito",         color: "bg-purple-500/15 text-purple-400",   icon: <Truck className="w-3 h-3" /> },
  delivered:              { label: "Entregado",           color: "bg-emerald-500/15 text-emerald-400", icon: <CheckCircle className="w-3 h-3" /> },
  cancelled:              { label: "Cancelado",           color: "bg-red-500/15 text-red-400",         icon: <XCircle className="w-3 h-3" /> },
  returned:               { label: "Devuelto",            color: "bg-orange-500/15 text-orange-400",   icon: <RotateCcw className="w-3 h-3" /> },
};

const STOCK_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  available:    { label: "Disponible",    color: "bg-green-500/15 text-green-400 border-green-500/20" },
  out_of_stock: { label: "Sin stock",     color: "bg-red-500/15 text-red-400 border-red-500/20" },
  discontinued: { label: "Discontinuado", color: "bg-muted/40 text-muted-foreground border-border/30" },
};

const EMPTY_SUPPLIER = {
  name: "", contact_name: "", email: "", phone: "",
  website: "", country: "AR", currency: "ARS",
  avg_dispatch_days: 3, commission_pct: 0,
  payment_terms: "", notes: ""
};

const EMPTY_PRODUCT = {
  supplier_id: "", supplier_sku: "", supplier_price: 0,
  sell_price: 0, stock_status: "available", supplier_url: "", notes: ""
};

const EMPTY_ORDER = {
  supplier_id: "", customer_name: "", customer_phone: "",
  ship_address: "", ship_city: "", ship_province: "", ship_zip: "",
  notes: "", tracking_code: ""
};

export default function DropshippingPage() {
  usePageTitle("Dropshipping");
  const { orgId } = useOrganization();

  const [suppliers, setSuppliers]   = useState<Supplier[]>([]);
  const [products, setProducts]     = useState<DropProduct[]>([]);
  const [orders, setOrders]         = useState<DropOrder[]>([]);
  const [loading, setLoading]       = useState(true);
  const [activeTab, setActiveTab]   = useState("orders");
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

  // Supplier dialog
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [supplierForm, setSupplierForm] = useState({ ...EMPTY_SUPPLIER });
  const [savingSupplier, setSavingSupplier] = useState(false);

  // Product dialog
  const [productOpen, setProductOpen] = useState(false);
  const [productForm, setProductForm] = useState({ ...EMPTY_PRODUCT });
  const [savingProduct, setSavingProduct] = useState(false);

  // Order dialog
  const [orderOpen, setOrderOpen] = useState(false);
  const [orderForm, setOrderForm] = useState({ ...EMPTY_ORDER });
  const [orderItems, setOrderItems] = useState<{ product_name: string; supplier_sku: string; quantity: number; supplier_price: number; sell_price: number }[]>([]);
  const [savingOrder, setSavingOrder] = useState(false);

  // Status update
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    const [suppRes, prodRes, ordRes] = await Promise.allSettled([
      supabase.from("dropship_suppliers").select("*").eq("org_id", orgId).eq("active", true).order("name"),
      supabase.from("dropship_products").select("*, dropship_suppliers(name)").eq("org_id", orgId).eq("active", true),
      supabase.from("dropship_orders").select("*, dropship_suppliers(name), dropship_order_items(*)").eq("org_id", orgId).order("created_at", { ascending: false }),
    ]);
    if (suppRes.status === "fulfilled" && suppRes.value.data) setSuppliers(suppRes.value.data as Supplier[]);
    if (prodRes.status === "fulfilled" && prodRes.value.data) setProducts(prodRes.value.data as DropProduct[]);
    if (ordRes.status === "fulfilled" && ordRes.value.data) setOrders(ordRes.value.data as DropOrder[]);
    setLoading(false);
  }, [orgId]);

  useEffect(() => { load(); }, [load]);

  async function saveSupplier() {
    if (!orgId || !supplierForm.name.trim()) return toast.error("Ingresá el nombre del proveedor");
    setSavingSupplier(true);
    const { error } = await supabase.from("dropship_suppliers").insert({
      org_id: orgId,
      name: supplierForm.name.trim(),
      contact_name: supplierForm.contact_name || null,
      email: supplierForm.email || null,
      phone: supplierForm.phone || null,
      website: supplierForm.website || null,
      country: supplierForm.country,
      currency: supplierForm.currency,
      avg_dispatch_days: Number(supplierForm.avg_dispatch_days),
      commission_pct: Number(supplierForm.commission_pct),
      payment_terms: supplierForm.payment_terms || null,
      notes: supplierForm.notes || null,
    });
    setSavingSupplier(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Proveedor creado");
    setSupplierOpen(false);
    setSupplierForm({ ...EMPTY_SUPPLIER });
    load();
  }

  async function saveProduct() {
    if (!orgId || !productForm.supplier_id) return toast.error("Seleccioná un proveedor");
    setSavingProduct(true);
    const { error } = await supabase.from("dropship_products").insert({
      org_id: orgId,
      supplier_id: productForm.supplier_id,
      supplier_sku: productForm.supplier_sku || null,
      supplier_price: Number(productForm.supplier_price),
      sell_price: Number(productForm.sell_price),
      stock_status: productForm.stock_status,
      supplier_url: productForm.supplier_url || null,
      notes: productForm.notes || null,
    });
    setSavingProduct(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Producto dropshipping creado");
    setProductOpen(false);
    setProductForm({ ...EMPTY_PRODUCT });
    load();
  }

  function addOrderItem() {
    setOrderItems(prev => [...prev, { product_name: "", supplier_sku: "", quantity: 1, supplier_price: 0, sell_price: 0 }]);
  }

  function updateOrderItem(idx: number, field: string, value: string | number) {
    setOrderItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));
  }

  function removeOrderItem(idx: number) {
    setOrderItems(prev => prev.filter((_, i) => i !== idx));
  }

  const orderTotals = orderItems.reduce((acc, it) => ({
    supplier: acc.supplier + Number(it.supplier_price) * Number(it.quantity),
    sell: acc.sell + Number(it.sell_price) * Number(it.quantity),
  }), { supplier: 0, sell: 0 });

  async function saveOrder() {
    if (!orgId || !orderForm.supplier_id) return toast.error("Seleccioná un proveedor");
    if (!orderForm.customer_name.trim()) return toast.error("Ingresá el nombre del cliente");
    if (orderItems.length === 0) return toast.error("Agregá al menos un producto");
    setSavingOrder(true);

    const { data: orderData, error: orderErr } = await supabase.from("dropship_orders").insert({
      org_id: orgId,
      order_number: "temp",
      supplier_id: orderForm.supplier_id,
      customer_name: orderForm.customer_name.trim(),
      customer_phone: orderForm.customer_phone || null,
      ship_address: orderForm.ship_address || null,
      ship_city: orderForm.ship_city || null,
      ship_province: orderForm.ship_province || null,
      ship_zip: orderForm.ship_zip || null,
      supplier_total: orderTotals.supplier,
      sell_total: orderTotals.sell,
      notes: orderForm.notes || null,
    }).select("id").single();

    if (orderErr || !orderData) { setSavingOrder(false); toast.error(orderErr?.message ?? "Error al crear pedido"); return; }

    const items = orderItems.map(it => ({
      order_id: orderData.id,
      product_name: it.product_name || "Producto",
      supplier_sku: it.supplier_sku || null,
      quantity: Number(it.quantity),
      supplier_price: Number(it.supplier_price),
      sell_price: Number(it.sell_price),
    }));

    const { error: itemsErr } = await supabase.from("dropship_order_items").insert(items);
    setSavingOrder(false);
    if (itemsErr) { toast.error(itemsErr.message); return; }

    toast.success("Pedido dropshipping creado");
    setOrderOpen(false);
    setOrderForm({ ...EMPTY_ORDER });
    setOrderItems([]);
    load();
  }

  async function updateOrderStatus(orderId: string, newStatus: string) {
    setUpdatingStatus(orderId);
    const extra: Record<string, string | null> = {};
    if (newStatus === "dispatched") extra.dispatched_at = new Date().toISOString();
    if (newStatus === "delivered") extra.delivered_at = new Date().toISOString();
    const { error } = await supabase.from("dropship_orders").update({ status: newStatus, ...extra }).eq("id", orderId);
    setUpdatingStatus(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Estado actualizado");
    load();
  }

  const fmt = (n: number) => `$${Number(n).toLocaleString("es-AR", { minimumFractionDigits: 2 })}`;

  const filteredOrders = statusFilter === "all" ? orders : orders.filter(o => o.status === statusFilter);

  const kpis = {
    total: orders.length,
    pending: orders.filter(o => o.status === "pending").length,
    inTransit: orders.filter(o => ["dispatched", "in_transit"].includes(o.status)).length,
    totalProfit: orders.filter(o => o.status === "delivered").reduce((s, o) => s + Number(o.profit), 0),
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-7 h-7 animate-spin text-primary" />
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={PackageSearch}
        title="Dropshipping"
        description="Gestión de proveedores, productos y pedidos drop."
        actions={<div className="flex gap-2">
          {activeTab === "orders" && (
            <Dialog open={orderOpen} onOpenChange={setOrderOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => { setOrderForm({ ...EMPTY_ORDER }); setOrderItems([]); }}>
                  <Plus className="w-4 h-4 mr-2" /> Nuevo pedido
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Nuevo pedido dropshipping</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label>Proveedor *</Label>
                      <Select value={orderForm.supplier_id} onValueChange={v => setOrderForm(f => ({ ...f, supplier_id: v }))}>
                        <SelectTrigger><SelectValue placeholder="Seleccionar proveedor" /></SelectTrigger>
                        <SelectContent>
                          {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Cliente *</Label>
                      <Input value={orderForm.customer_name} onChange={e => setOrderForm(f => ({ ...f, customer_name: e.target.value }))} placeholder="Nombre del cliente" />
                    </div>
                    <div className="space-y-1">
                      <Label>Teléfono</Label>
                      <Input value={orderForm.customer_phone} onChange={e => setOrderForm(f => ({ ...f, customer_phone: e.target.value }))} placeholder="+54 9 11..." />
                    </div>
                    <div className="space-y-1">
                      <Label>Provincia</Label>
                      <Input value={orderForm.ship_province} onChange={e => setOrderForm(f => ({ ...f, ship_province: e.target.value }))} placeholder="Buenos Aires" />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label>Dirección de envío</Label>
                      <Input value={orderForm.ship_address} onChange={e => setOrderForm(f => ({ ...f, ship_address: e.target.value }))} placeholder="Calle, número, piso..." />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Productos</Label>
                      <Button size="sm" variant="outline" onClick={addOrderItem}><Plus className="w-3 h-3 mr-1" /> Agregar</Button>
                    </div>
                    {orderItems.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Sin productos aún</p>}
                    {orderItems.map((it, idx) => (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-end bg-muted/40 p-2 rounded">
                        <div className="col-span-4 space-y-1">
                          <Label className="text-xs">Nombre</Label>
                          <Input className="h-8 text-sm" value={it.product_name} onChange={e => updateOrderItem(idx, "product_name", e.target.value)} placeholder="Producto" />
                        </div>
                        <div className="col-span-2 space-y-1">
                          <Label className="text-xs">SKU prov.</Label>
                          <Input className="h-8 text-sm" value={it.supplier_sku} onChange={e => updateOrderItem(idx, "supplier_sku", e.target.value)} />
                        </div>
                        <div className="col-span-1 space-y-1">
                          <Label className="text-xs">Cant.</Label>
                          <Input className="h-8 text-sm" type="number" min={1} value={it.quantity} onChange={e => updateOrderItem(idx, "quantity", e.target.value)} />
                        </div>
                        <div className="col-span-2 space-y-1">
                          <Label className="text-xs">Costo prov.</Label>
                          <Input className="h-8 text-sm" type="number" min={0} value={it.supplier_price} onChange={e => updateOrderItem(idx, "supplier_price", e.target.value)} />
                        </div>
                        <div className="col-span-2 space-y-1">
                          <Label className="text-xs">Precio venta</Label>
                          <Input className="h-8 text-sm" type="number" min={0} value={it.sell_price} onChange={e => updateOrderItem(idx, "sell_price", e.target.value)} />
                        </div>
                        <div className="col-span-1">
                          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-500" onClick={() => removeOrderItem(idx)}>✕</Button>
                        </div>
                      </div>
                    ))}
                    {orderItems.length > 0 && (
                      <div className="flex justify-between text-sm font-medium bg-primary/10 px-3 py-2 rounded">
                        <span>Costo proveedor: {fmt(orderTotals.supplier)}</span>
                        <span>Venta total: {fmt(orderTotals.sell)}</span>
                        <span className="text-green-400">Ganancia: {fmt(orderTotals.sell - orderTotals.supplier)}</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label>Notas</Label>
                    <Textarea value={orderForm.notes} onChange={e => setOrderForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
                  </div>

                  <Button className="w-full" onClick={saveOrder} disabled={savingOrder}>
                    {savingOrder ? "Guardando..." : "Crear pedido"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
          {activeTab === "products" && (
            <Dialog open={productOpen} onOpenChange={setProductOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => setProductForm({ ...EMPTY_PRODUCT })}>
                  <Plus className="w-4 h-4 mr-2" /> Nuevo producto
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>Nuevo producto dropshipping</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label>Proveedor *</Label>
                    <Select value={productForm.supplier_id} onValueChange={v => setProductForm(f => ({ ...f, supplier_id: v }))}>
                      <SelectTrigger><SelectValue placeholder="Seleccionar proveedor" /></SelectTrigger>
                      <SelectContent>
                        {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>SKU del proveedor</Label>
                      <Input value={productForm.supplier_sku} onChange={e => setProductForm(f => ({ ...f, supplier_sku: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Estado stock</Label>
                      <Select value={productForm.stock_status} onValueChange={v => setProductForm(f => ({ ...f, stock_status: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="available">Disponible</SelectItem>
                          <SelectItem value="out_of_stock">Sin stock</SelectItem>
                          <SelectItem value="discontinued">Discontinuado</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Precio proveedor</Label>
                      <Input type="number" min={0} value={productForm.supplier_price} onChange={e => setProductForm(f => ({ ...f, supplier_price: Number(e.target.value) }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Precio de venta</Label>
                      <Input type="number" min={0} value={productForm.sell_price} onChange={e => setProductForm(f => ({ ...f, sell_price: Number(e.target.value) }))} />
                    </div>
                  </div>
                  {productForm.supplier_price > 0 && productForm.sell_price > 0 && (
                    <div className="bg-success/10 rounded p-2 text-sm text-success">
                      Margen estimado: {(((productForm.sell_price - productForm.supplier_price) / productForm.sell_price) * 100).toFixed(1)}%
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label>URL del proveedor</Label>
                    <Input value={productForm.supplier_url} onChange={e => setProductForm(f => ({ ...f, supplier_url: e.target.value }))} placeholder="https://..." />
                  </div>
                  <div className="space-y-1">
                    <Label>Notas</Label>
                    <Textarea value={productForm.notes} onChange={e => setProductForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
                  </div>
                  <Button className="w-full" onClick={saveProduct} disabled={savingProduct}>
                    {savingProduct ? "Guardando..." : "Crear producto"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
          {activeTab === "suppliers" && (
            <Dialog open={supplierOpen} onOpenChange={setSupplierOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => setSupplierForm({ ...EMPTY_SUPPLIER })}>
                  <Plus className="w-4 h-4 mr-2" /> Nuevo proveedor
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>Nuevo proveedor dropshipping</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label>Nombre *</Label>
                    <Input value={supplierForm.name} onChange={e => setSupplierForm(f => ({ ...f, name: e.target.value }))} placeholder="Nombre del proveedor" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label>Contacto</Label>
                      <Input value={supplierForm.contact_name} onChange={e => setSupplierForm(f => ({ ...f, contact_name: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Email</Label>
                      <Input type="email" value={supplierForm.email} onChange={e => setSupplierForm(f => ({ ...f, email: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Teléfono</Label>
                      <Input value={supplierForm.phone} onChange={e => setSupplierForm(f => ({ ...f, phone: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Sitio web</Label>
                      <Input value={supplierForm.website} onChange={e => setSupplierForm(f => ({ ...f, website: e.target.value }))} placeholder="https://..." />
                    </div>
                    <div className="space-y-1">
                      <Label>País</Label>
                      <Input value={supplierForm.country} onChange={e => setSupplierForm(f => ({ ...f, country: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Moneda</Label>
                      <Select value={supplierForm.currency} onValueChange={v => setSupplierForm(f => ({ ...f, currency: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ARS">ARS</SelectItem>
                          <SelectItem value="USD">USD</SelectItem>
                          <SelectItem value="EUR">EUR</SelectItem>
                          <SelectItem value="BRL">BRL</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Días despacho promedio</Label>
                      <Input type="number" min={0} value={supplierForm.avg_dispatch_days} onChange={e => setSupplierForm(f => ({ ...f, avg_dispatch_days: Number(e.target.value) }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Comisión %</Label>
                      <Input type="number" min={0} step={0.01} value={supplierForm.commission_pct} onChange={e => setSupplierForm(f => ({ ...f, commission_pct: Number(e.target.value) }))} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Términos de pago</Label>
                    <Input value={supplierForm.payment_terms} onChange={e => setSupplierForm(f => ({ ...f, payment_terms: e.target.value }))} placeholder="prepago, net30..." />
                  </div>
                  <div className="space-y-1">
                    <Label>Notas</Label>
                    <Textarea value={supplierForm.notes} onChange={e => setSupplierForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
                  </div>
                  <Button className="w-full" onClick={saveSupplier} disabled={savingSupplier}>
                    {savingSupplier ? "Guardando..." : "Crear proveedor"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>}
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Total pedidos" value={kpis.total} icon={Package} color="primary" />
        <KPICard label="Pendientes" value={kpis.pending} icon={AlertCircle} color="warning" />
        <KPICard label="En tránsito" value={kpis.inTransit} icon={Truck} color="blue" />
        <KPICard label="Ganancia entregados" value={fmt(kpis.totalProfit)} icon={TrendingUp} color="success" />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="orders">Pedidos ({orders.length})</TabsTrigger>
          <TabsTrigger value="products">Productos ({products.length})</TabsTrigger>
          <TabsTrigger value="suppliers">Proveedores ({suppliers.length})</TabsTrigger>
        </TabsList>

        {/* ORDERS */}
        <TabsContent value="orders" className="space-y-4 mt-4">
          {/* Status filter pills */}
          <div className="flex flex-wrap gap-2">
            {["all", ...Object.keys(STATUS_CONFIG)].map(st => (
              <button key={st} onClick={() => setStatusFilter(st)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${statusFilter === st ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border hover:border-primary/50"}`}>
                {st === "all" ? `Todos (${orders.length})` : STATUS_CONFIG[st]?.label}
              </button>
            ))}
          </div>

          {filteredOrders.length === 0 && (
            <div className="text-center py-16 text-muted-foreground">
              <PackageSearch className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No hay pedidos {statusFilter !== "all" ? `con estado "${STATUS_CONFIG[statusFilter]?.label}"` : "aún"}</p>
            </div>
          )}

          <div className="space-y-2">
            {filteredOrders.map(order => {
              const cfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.pending;
              const isExpanded = expandedOrder === order.id;
              return (
                <Card key={order.id} className="overflow-hidden">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <button onClick={() => setExpandedOrder(isExpanded ? null : order.id)} className="text-muted-foreground/70 hover:text-foreground/80 flex-shrink-0">
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-sm font-semibold text-foreground">{order.order_number}</span>
                            <Badge className={`${cfg.color} text-xs flex items-center gap-1`}>
                              {cfg.icon} {cfg.label}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mt-0.5">
                            <span className="font-medium">{order.customer_name}</span>
                            {order.ship_city && ` · ${order.ship_city}`}
                            {order.ship_province && `, ${order.ship_province}`}
                          </p>
                          <p className="text-xs text-muted-foreground/70">
                            {order.dropship_suppliers?.name} · {new Date(order.created_at).toLocaleDateString("es-AR")}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 flex-shrink-0">
                        <div className="text-right">
                          <p className="text-sm text-muted-foreground">Venta: <span className="font-semibold text-foreground">{fmt(order.sell_total)}</span></p>
                          <p className="text-xs text-green-400">Ganancia: {fmt(order.profit)}</p>
                        </div>
                        {/* Status progression */}
                        <div className="flex gap-1">
                          {order.status === "pending" && (
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => updateOrderStatus(order.id, "ordered_from_supplier")} disabled={updatingStatus === order.id}>
                              Pedir a proveedor
                            </Button>
                          )}
                          {order.status === "ordered_from_supplier" && (
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => updateOrderStatus(order.id, "dispatched")} disabled={updatingStatus === order.id}>
                              Marcar despachado
                            </Button>
                          )}
                          {order.status === "dispatched" && (
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => updateOrderStatus(order.id, "in_transit")} disabled={updatingStatus === order.id}>
                              En tránsito
                            </Button>
                          )}
                          {order.status === "in_transit" && (
                            <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700" onClick={() => updateOrderStatus(order.id, "delivered")} disabled={updatingStatus === order.id}>
                              Entregado ✓
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t space-y-3">
                        {order.tracking_code && (
                          <p className="text-sm text-muted-foreground">🚚 Tracking: <span className="font-mono">{order.tracking_code}</span></p>
                        )}
                        {order.dropship_order_items && order.dropship_order_items.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Productos</p>
                            <div className="space-y-1">
                              {order.dropship_order_items.map(item => (
                                <div key={item.id} className="flex justify-between text-sm bg-muted/20 px-3 py-1.5 rounded">
                                  <span>{item.product_name} {item.supplier_sku && <span className="text-muted-foreground/70 text-xs">({item.supplier_sku})</span>}</span>
                                  <span className="text-muted-foreground">x{item.quantity} · costo: {fmt(item.supplier_price)} · venta: {fmt(item.sell_price)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {order.notes && <p className="text-sm text-muted-foreground italic">{order.notes}</p>}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </TabsContent>

        {/* PRODUCTS */}
        <TabsContent value="products" className="mt-4">
          {products.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No hay productos dropshipping aún</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {products.map(prod => {
                const sc = STOCK_STATUS_CONFIG[prod.stock_status] ?? STOCK_STATUS_CONFIG.available;
                return (
                  <Card key={prod.id}>
                    <CardContent className="pt-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium text-foreground">{prod.dropship_suppliers?.name ?? "—"}</p>
                          {prod.supplier_sku && <p className="text-xs text-muted-foreground/70 font-mono">{prod.supplier_sku}</p>}
                        </div>
                        <Badge className={`text-xs ${sc.color}`}>{sc.label}</Badge>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="bg-muted/20 rounded p-2">
                          <p className="text-xs text-muted-foreground">Costo</p>
                          <p className="text-sm font-semibold">{fmt(prod.supplier_price)}</p>
                        </div>
                        <div className="bg-blue-500/10 rounded p-2">
                          <p className="text-xs text-muted-foreground">Venta</p>
                          <p className="text-sm font-semibold text-blue-400">{fmt(prod.sell_price)}</p>
                        </div>
                        <div className="bg-emerald-500/10 rounded p-2">
                          <p className="text-xs text-muted-foreground">Margen</p>
                          <p className="text-sm font-semibold text-emerald-400">{Number(prod.margin_pct).toFixed(1)}%</p>
                        </div>
                      </div>
                      {prod.supplier_url && (
                        <a href={prod.supplier_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                          <ExternalLink className="w-3 h-3" /> Ver en proveedor
                        </a>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* SUPPLIERS */}
        <TabsContent value="suppliers" className="mt-4">
          {suppliers.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Truck className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>No hay proveedores dropshipping aún</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {suppliers.map(sup => (
                <Card key={sup.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{sup.name}</CardTitle>
                    {sup.contact_name && <p className="text-xs text-muted-foreground">{sup.contact_name}</p>}
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {sup.email && <p className="text-sm text-muted-foreground">✉ {sup.email}</p>}
                    {sup.phone && <p className="text-sm text-muted-foreground">📞 {sup.phone}</p>}
                    {sup.website && (
                      <a href={sup.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                        <ExternalLink className="w-3 h-3" /> {sup.website}
                      </a>
                    )}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Badge variant="outline" className="text-xs">{sup.country} · {sup.currency}</Badge>
                      <Badge variant="outline" className="text-xs">{sup.avg_dispatch_days}d despacho</Badge>
                      {sup.commission_pct > 0 && <Badge variant="outline" className="text-xs text-green-400 border-green-500/30">{sup.commission_pct}% comisión</Badge>}
                    </div>
                    {sup.payment_terms && <p className="text-xs text-muted-foreground/70">Pago: {sup.payment_terms}</p>}
                    <div className="pt-1">
                      <p className="text-xs text-muted-foreground/70">
                        Productos: {products.filter(p => p.supplier_id === sup.id).length}
                        {" · "}
                        Pedidos: {orders.filter(o => o.supplier_id === sup.id).length}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
