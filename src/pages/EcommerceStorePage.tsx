import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ShoppingBag, Globe, Package, ShoppingCart, TrendingUp, Settings,
  Plus, Eye, RefreshCw, ExternalLink, Palette, Zap, BarChart3,
  Check, AlertTriangle, Tag, Users, DollarSign, ArrowRight, Loader2
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import { usePageTitle } from "@/hooks/usePageTitle";

const THEMES = [
  { id: "minimal", label: "Minimal", desc: "Limpio y moderno", preview: "bg-white" },
  { id: "bold",    label: "Bold",    desc: "Colores vibrantes", preview: "bg-yellow-400" },
  { id: "luxury",  label: "Luxury",  desc: "Dark & premium",   preview: "bg-zinc-900" },
  { id: "sport",   label: "Sport",   desc: "Dinámico",         preview: "bg-blue-600" },
  { id: "natural", label: "Natural", desc: "Orgánico, verde",   preview: "bg-emerald-600" },
];

const PAYMENT_METHODS = [
  { id: "mercadopago",    label: "MercadoPago",    logo: "🔵" },
  { id: "transferencia",  label: "Transferencia",  logo: "🏦" },
  { id: "efectivo",       label: "Efectivo",       logo: "💵" },
  { id: "stripe",         label: "Stripe",         logo: "🟣" },
  { id: "paypal",         label: "PayPal",         logo: "🟡" },
];

interface EcomOrder {
  id: string;
  order_number: string;
  customer_name: string;
  customer_email: string;
  total: number;
  payment_status: string;
  fulfillment_status: string;
  items: unknown[];
  created_at: string;
}

interface FunnelRow {
  label: string;
  value: number;
  pct: number;
  color: string;
}

export default function EcommerceStorePage() {
  usePageTitle("Tienda E-Commerce");
  const { orgId } = useOrganization();
  const [tab, setTab] = useState<"overview" | "orders" | "design" | "settings">("overview");
  const [store, setStore] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [storeForm, setStoreForm] = useState({
    name: "Mi Tienda Online", slug: "", theme: "minimal",
    primary_color: "#f59e0b", currency: "ARS",
    tax_included: true, free_shipping_above: "50000",
    shipping_cost: "2500", is_active: false,
    payment_methods: ["mercadopago", "transferencia"],
    meta_title: "", meta_description: "",
  });
  const [selectedTheme, setSelectedTheme] = useState("minimal");
  const [orderFilter, setOrderFilter] = useState<string | null>(null);
  const [orders, setOrders] = useState<EcomOrder[]>([]);
  const [funnelData, setFunnelData] = useState<FunnelRow[]>([]);

  useEffect(() => {
    if (!orgId) return;
    supabase.from("ecommerce_stores").select("*").eq("org_id", orgId).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setStore(data);
          // Mapeo explícito: la fila trae columnas extra y numéricas donde el
          // formulario usa strings (los inputs son de texto).
          setStoreForm(prev => ({
            ...prev,
            name: data.name ?? prev.name,
            slug: data.slug ?? prev.slug,
            theme: data.theme ?? prev.theme,
            primary_color: data.primary_color ?? prev.primary_color,
            currency: data.currency ?? prev.currency,
            tax_included: data.tax_included ?? prev.tax_included,
            free_shipping_above: data.free_shipping_above != null ? String(data.free_shipping_above) : prev.free_shipping_above,
            shipping_cost: data.shipping_cost != null ? String(data.shipping_cost) : prev.shipping_cost,
            is_active: data.is_active ?? prev.is_active,
            payment_methods: data.payment_methods || ["mercadopago", "transferencia"],
            meta_title: data.meta_title ?? prev.meta_title,
            meta_description: data.meta_description ?? prev.meta_description,
          }));
          setSelectedTheme(data.theme);
        }
      });

    supabase
      .from("ecommerce_orders")
      .select("id, order_number, customer_name, customer_email, total, payment_status, fulfillment_status, items, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (data) setOrders(data as EcomOrder[]);
      });

    supabase
      .from("ecommerce_cart_sessions")
      .select("id, status, items")
      .eq("org_id", orgId)
      .then(({ data }) => {
        if (!data) return;
        const totalSessions = data.length;
        const withItems = data.filter(cs => Array.isArray(cs.items) && (cs.items as unknown[]).length > 0).length;
        const converted = data.filter(cs => cs.status === "converted").length;
        const abandoned = data.filter(cs => cs.status === "abandoned").length;
        const convRate = totalSessions > 0 ? parseFloat(((converted / totalSessions) * 100).toFixed(1)) : 0;
        const withItemsPct = totalSessions > 0 ? parseFloat(((withItems / totalSessions) * 100).toFixed(1)) : 0;
        const checkoutEst = withItems > 0 ? Math.round(withItems * 0.37) : 0;
        const checkoutPct = totalSessions > 0 ? parseFloat(((checkoutEst / totalSessions) * 100).toFixed(1)) : 0;
        setFunnelData([
          { label: "Sesiones", value: totalSessions, pct: 100, color: "bg-blue-400" },
          { label: "Con items en carrito", value: withItems, pct: withItemsPct, color: "bg-indigo-400" },
          { label: "Checkout iniciado", value: checkoutEst, pct: checkoutPct, color: "bg-purple-400" },
          { label: "Órdenes completadas", value: converted, pct: convRate, color: "bg-emerald-400" },
        ]);
      });
  }, [orgId]);

  const saveStore = async () => {
    if (!orgId) return;
    setLoading(true);
    const row = {
      org_id: orgId,
      name: storeForm.name,
      slug: storeForm.slug || storeForm.name.toLowerCase().replace(/\s+/g, "-"),
      theme: selectedTheme,
      primary_color: storeForm.primary_color,
      currency: storeForm.currency,
      tax_included: storeForm.tax_included,
      free_shipping_above: storeForm.free_shipping_above ? Number(storeForm.free_shipping_above) : null,
      shipping_cost: Number(storeForm.shipping_cost),
      is_active: storeForm.is_active,
      payment_methods: storeForm.payment_methods,
      meta_title: storeForm.meta_title,
      meta_description: storeForm.meta_description,
    };
    const { error } = await supabase.from("ecommerce_stores").upsert(row, { onConflict: "org_id" });
    setLoading(false);
    if (error) { toast.error("Error al guardar"); return; }
    toast.success("Tienda guardada correctamente");
    setStore(row);
  };

  const filteredOrders = orders.filter(o => !orderFilter || o.fulfillment_status === orderFilter);

  const TABS = [
    { id: "overview",  label: "Overview" },
    { id: "orders",    label: "Órdenes" },
    { id: "design",    label: "Diseño & Tema" },
    { id: "settings",  label: "Configuración" },
  ];

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayOrders = useMemo(() => orders.filter(o => o.created_at.slice(0, 10) === todayStr), [orders, todayStr]);
  const todayRevenue = useMemo(() => todayOrders.reduce((sum, o) => sum + Number(o.total), 0), [todayOrders]);
  const conversionPct = funnelData[3]?.pct ?? 0;
  const activeCartsCount = funnelData[1]?.value ?? 0;
  const abandonedCount = funnelData.find(f => f.label === "Órdenes completadas") ? (funnelData[1]?.value ?? 0) - (funnelData[3]?.value ?? 0) : 0;

  const kpis = useMemo(() => [
    { label: "Revenue hoy",      value: todayRevenue > 0 ? `$${(todayRevenue / 1000).toFixed(0)}K` : "$0", sub: `${todayOrders.length} órd. hoy`, icon: DollarSign,    color: "success"  as const },
    { label: "Órdenes totales",  value: String(orders.length || 0),  sub: `${todayOrders.length} hoy`,      icon: ShoppingCart, color: "primary"  as const },
    { label: "Conversión",       value: `${conversionPct}%`,          sub: `${funnelData[0]?.value ?? 0} sesiones totales`, icon: TrendingUp, color: "warning" as const },
    { label: "Carritos c/items", value: activeCartsCount,             sub: `${Math.max(0, abandonedCount)} abandonados`, icon: Users, color: "blue" as const },
  ], [todayRevenue, todayOrders.length, orders.length, conversionPct, funnelData, activeCartsCount, abandonedCount]);

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={ShoppingBag}
        title="Tienda E-Commerce"
        description="Tu tienda online integrada con inventario y pagos"
        actions={
          <div className="flex items-center flex-wrap gap-2">
            <Badge className={store?.is_active ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" : "bg-zinc-500/15 text-zinc-400 border-zinc-500/20"}>
              {store?.is_active ? "● Activa" : "○ Inactiva"}
            </Badge>
            {store?.slug && (
              <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => window.open(`https://gestiona.app/tienda/${store.slug}`, "_blank")}>
                <ExternalLink className="w-3 h-3" />Ver tienda
              </Button>
            )}
          </div>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(k => (
          <KPICard key={k.label} label={k.label} value={k.value} sub={k.sub} icon={k.icon} color={k.color} />
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/30 p-1 rounded-xl w-fit">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === t.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── Overview ─── */}
      {tab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Funnel */}
          <div className="bg-card border border-border/40 rounded-xl p-5">
            <h3 className="font-semibold flex items-center gap-2 mb-4"><BarChart3 className="w-4 h-4 text-primary" />Embudo de Conversión</h3>
            <div className="space-y-3">
              {funnelData.map((f, i) => (
                <div key={f.label}>
                  <div className="flex items-center justify-between text-sm mb-1.5">
                    <div className="flex items-center gap-2">
                      {i < funnelData.length - 1 && <ArrowRight className="w-3 h-3 text-muted-foreground" />}
                      {i === funnelData.length - 1 && <Check className="w-3 h-3 text-emerald-400" />}
                      <span>{f.label}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>{f.value.toLocaleString()}</span>
                      <span className="font-semibold text-foreground">{f.pct}%</span>
                    </div>
                  </div>
                  <div className="h-2 bg-muted rounded-full">
                    <div className={`h-2 rounded-full ${f.color}`} style={{ width: `${f.pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent orders */}
          <div className="bg-card border border-border/40 rounded-xl p-5">
            <h3 className="font-semibold flex items-center gap-2 mb-4"><ShoppingCart className="w-4 h-4 text-primary" />Órdenes Recientes</h3>
            <div className="space-y-2">
              {orders.slice(0, 4).map(o => {
                const itemCount = Array.isArray(o.items) ? (o.items as unknown[]).length : 0;
                return (
                <div key={o.id} className="flex items-center justify-between p-3 bg-muted/20 rounded-lg">
                  <div>
                    <p className="text-sm font-medium">{o.customer_name}</p>
                    <p className="text-xs text-muted-foreground">{o.order_number} · {itemCount} item{itemCount > 1 ? "s" : ""}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">${Number(o.total).toLocaleString("es-AR")}</p>
                    <Badge className={`text-xs ${o.fulfillment_status === "delivered" ? "bg-emerald-500/15 text-emerald-400 border-0" : o.fulfillment_status === "shipped" ? "bg-blue-500/15 text-blue-400 border-0" : o.fulfillment_status === "processing" ? "bg-yellow-500/15 text-yellow-400 border-0" : "bg-zinc-500/15 text-zinc-400 border-0"}`}>
                      {o.fulfillment_status}
                    </Badge>
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ─── Orders tab ─── */}
      {tab === "orders" && (
        <div className="space-y-4">
          <div className="flex gap-1">
            {[null, "pending", "processing", "shipped", "delivered"].map(f => (
              <button key={f ?? "all"} onClick={() => setOrderFilter(f)}
                className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${orderFilter === f ? "bg-primary/15 text-primary border-primary/30" : "border-border/40 text-muted-foreground"}`}>
                {f === null ? "Todas" : f}
              </button>
            ))}
          </div>
          <div className="bg-card border border-border/40 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    {["Orden", "Cliente", "Email", "Total", "Pago", "Estado", "Fecha"].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map(o => (
                    <tr key={o.id} className="border-b border-border/20 hover:bg-muted/20">
                      <td className="px-4 py-3 font-mono text-xs">{o.order_number}</td>
                      <td className="px-4 py-3 text-sm font-medium">{o.customer_name}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{o.customer_email}</td>
                      <td className="px-4 py-3 text-sm font-semibold">${Number(o.total).toLocaleString("es-AR")}</td>
                      <td className="px-4 py-3"><Badge className={`text-xs ${o.payment_status === "paid" ? "bg-emerald-500/15 text-emerald-400 border-0" : "bg-yellow-500/15 text-yellow-400 border-0"}`}>{o.payment_status}</Badge></td>
                      <td className="px-4 py-3"><Badge className={`text-xs ${o.fulfillment_status === "delivered" ? "bg-emerald-500/15 text-emerald-400 border-0" : o.fulfillment_status === "shipped" ? "bg-blue-500/15 text-blue-400 border-0" : "bg-zinc-500/15 text-zinc-400 border-0"}`}>{o.fulfillment_status}</Badge></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{o.created_at.slice(0, 10)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ─── Design tab ─── */}
      {tab === "design" && (
        <div className="space-y-5">
          <div className="bg-card border border-border/40 rounded-xl p-5">
            <h3 className="font-semibold flex items-center gap-2 mb-4"><Palette className="w-4 h-4 text-primary" />Tema de la Tienda</h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              {THEMES.map(t => (
                <button key={t.id} onClick={() => setSelectedTheme(t.id)}
                  className={`p-3 rounded-xl border-2 text-center transition-all ${selectedTheme === t.id ? "border-primary" : "border-border/40 hover:border-primary/40"}`}>
                  <div className={`w-full h-12 rounded-lg mb-2 ${t.preview} border border-border/20`} />
                  <p className="text-xs font-semibold">{t.label}</p>
                  <p className="text-[10px] text-muted-foreground">{t.desc}</p>
                  {selectedTheme === t.id && <Check className="w-3 h-3 text-primary mx-auto mt-1" />}
                </button>
              ))}
            </div>
          </div>
          <div className="bg-card border border-border/40 rounded-xl p-5 space-y-4">
            <h3 className="font-semibold">Color Principal</h3>
            <div className="flex items-center gap-3">
              <input type="color" value={storeForm.primary_color}
                onChange={e => setStoreForm(p => ({ ...p, primary_color: e.target.value }))}
                className="w-10 h-10 rounded-lg border border-border cursor-pointer" />
              <Input value={storeForm.primary_color} onChange={e => setStoreForm(p => ({ ...p, primary_color: e.target.value }))}
                className="h-9 font-mono w-32" maxLength={7} />
              <div className="w-8 h-8 rounded-full border border-border/40" style={{ background: storeForm.primary_color }} />
            </div>
          </div>
          <Button onClick={saveStore} disabled={loading} className="gradient-gold text-primary-foreground">
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Guardar Diseño
          </Button>
        </div>
      )}

      {/* ─── Settings tab ─── */}
      {tab === "settings" && (
        <div className="space-y-5">
          <div className="bg-card border border-border/40 rounded-xl p-5 space-y-4">
            <h3 className="font-semibold flex items-center gap-2"><Settings className="w-4 h-4 text-primary" />Configuración General</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Nombre de la tienda</label>
                <Input value={storeForm.name} onChange={e => setStoreForm(p => ({ ...p, name: e.target.value }))} className="h-9" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Slug (URL)</label>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground shrink-0">gestiona.app/tienda/</span>
                  <Input value={storeForm.slug} onChange={e => setStoreForm(p => ({ ...p, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") }))} placeholder="mi-tienda" className="h-9" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Costo de envío</label>
                  <Input type="number" value={storeForm.shipping_cost} onChange={e => setStoreForm(p => ({ ...p, shipping_cost: e.target.value }))} className="h-9" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Envío gratis desde</label>
                  <Input type="number" value={storeForm.free_shipping_above} onChange={e => setStoreForm(p => ({ ...p, free_shipping_above: e.target.value }))} className="h-9" placeholder="dejar vacío para nunca" />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-card border border-border/40 rounded-xl p-5 space-y-3">
            <h3 className="font-semibold">Métodos de Pago</h3>
            <div className="space-y-2">
              {PAYMENT_METHODS.map(pm => {
                const enabled = storeForm.payment_methods.includes(pm.id);
                return (
                  <div key={pm.id} className="flex items-center justify-between p-3 bg-muted/20 rounded-lg">
                    <div className="flex items-center gap-2">
                      <span>{pm.logo}</span>
                      <span className="text-sm">{pm.label}</span>
                    </div>
                    <button onClick={() => setStoreForm(p => ({
                      ...p,
                      payment_methods: enabled
                        ? p.payment_methods.filter(x => x !== pm.id)
                        : [...p.payment_methods, pm.id]
                    }))} className={`w-10 h-5 rounded-full transition-all ${enabled ? "bg-emerald-500" : "bg-muted"}`}>
                      <div className={`w-4 h-4 bg-white rounded-full m-0.5 transition-transform ${enabled ? "translate-x-5" : "translate-x-0"}`} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between bg-card border border-border/40 rounded-xl p-4">
            <div>
              <p className="text-sm font-semibold">Tienda Activa</p>
              <p className="text-xs text-muted-foreground">Pública y visible en internet</p>
            </div>
            <button onClick={() => setStoreForm(p => ({ ...p, is_active: !p.is_active }))}
              className={`w-10 h-5 rounded-full transition-all ${storeForm.is_active ? "bg-emerald-500" : "bg-muted"}`}>
              <div className={`w-4 h-4 bg-white rounded-full m-0.5 transition-transform ${storeForm.is_active ? "translate-x-5" : "translate-x-0"}`} />
            </button>
          </div>

          <Button onClick={saveStore} disabled={loading} className="gradient-gold text-primary-foreground w-full">
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
            Guardar Configuración
          </Button>
        </div>
      )}
    </div>
  );
}
