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
  Check, AlertTriangle, Tag, Users, DollarSign, ArrowRight, Loader2, MapPin
} from "lucide-react";
import { Link } from "react-router-dom";
import StoreReadinessPanel from "@/components/ecommerce/StoreReadinessPanel";
import { evaluateStoreReadiness, readinessSummary } from "@/lib/storeReadiness";
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

const SHIPPING_MODES = [
  { id: "flat",  label: "Precio plano",   hint: "Un mismo costo para todo el país." },
  { id: "zones", label: "Por zona y peso", hint: "Cotiza según provincia, peso y transportista." },
  { id: "free",  label: "Envío gratis",   hint: "Sin costo de envío para el comprador." },
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
    description: "", notification_email: "",
    meta_pixel_id: "", ga_measurement_id: "", tiktok_pixel_id: "",
    shipping_mode: "flat", pickup_enabled: false,
    pickup_address: "", pickup_instructions: "",
    default_item_weight_kg: "0.5",
  });
  const [selectedTheme, setSelectedTheme] = useState("minimal");
  const [orderFilter, setOrderFilter] = useState<string | null>(null);
  // Señales de "¿puede vender?". Arrancan en el peor caso: mientras no se sepa,
  // es más honesto mostrar que falta algo que decir que todo está listo.
  const [signals, setSignals] = useState({
    publishedProducts: 0,
    productsWithoutWeight: 0,
    shippingZones: 0,
    zonesWithRates: 0,
    coveredProvinces: 0,
    paymentConnected: false,
  });
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
            description: data.description ?? prev.description,
            notification_email: data.notification_email ?? prev.notification_email,
            meta_pixel_id: data.meta_pixel_id ?? prev.meta_pixel_id,
            ga_measurement_id: data.ga_measurement_id ?? prev.ga_measurement_id,
            tiktok_pixel_id: data.tiktok_pixel_id ?? prev.tiktok_pixel_id,
            meta_description: data.meta_description ?? prev.meta_description,
            // Estos se guardaban pero no se leían de vuelta: al recargar, una
            // tienda con envío por zona se veía como precio plano.
            shipping_mode: data.shipping_mode ?? prev.shipping_mode,
            pickup_enabled: data.pickup_enabled ?? prev.pickup_enabled,
            pickup_address: data.pickup_address ?? prev.pickup_address,
            pickup_instructions: data.pickup_instructions ?? prev.pickup_instructions,
            default_item_weight_kg: data.default_item_weight_kg != null
              ? String(data.default_item_weight_kg)
              : prev.default_item_weight_kg,
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

    // Señales para saber si la tienda puede vender de verdad. Se cuentan en la
    // base (`head: true`) en vez de traer las filas: sólo interesa el número.
    Promise.all([
      supabase.from("products").select("id", { count: "exact", head: true })
        .eq("org_id", orgId).gt("stock", 0).gt("sale_price_ars", 0),
      supabase.from("products").select("id", { count: "exact", head: true })
        .eq("org_id", orgId).gt("stock", 0).gt("sale_price_ars", 0).is("weight_kg", null),
      supabase.from("shipping_zones").select("id, provinces")
        .eq("org_id", orgId).eq("is_active", true),
      supabase.from("shipping_rates").select("zone_id").eq("org_id", orgId).eq("is_active", true),
      supabase.from("settings").select("mp_enabled, mp_access_token").eq("org_id", orgId).maybeSingle(),
    ]).then(([prods, sinPeso, zonas, tarifas, ajustes]) => {
      const zonasList = (zonas.data ?? []) as { id: string; provinces: string[] | null }[];
      const conTarifa = new Set(((tarifas.data ?? []) as { zone_id: string }[]).map(r => r.zone_id));
      const provincias = new Set(zonasList.flatMap(z => z.provinces ?? []));
      const st = ajustes.data as { mp_enabled?: boolean; mp_access_token?: string | null } | null;
      setSignals({
        publishedProducts: prods.count ?? 0,
        productsWithoutWeight: sinPeso.count ?? 0,
        shippingZones: zonasList.length,
        zonesWithRates: zonasList.filter(z => conTarifa.has(z.id)).length,
        coveredProvinces: provincias.size,
        paymentConnected: !!(st?.mp_enabled && st?.mp_access_token),
      });
    }, () => { /* si falla, el panel muestra el estado conservador */ });

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
      description: storeForm.description || null,
      notification_email: storeForm.notification_email || null,
      meta_pixel_id: storeForm.meta_pixel_id || null,
      ga_measurement_id: storeForm.ga_measurement_id || null,
      tiktok_pixel_id: storeForm.tiktok_pixel_id || null,
      meta_title: storeForm.meta_title,
      meta_description: storeForm.meta_description,
      shipping_mode: storeForm.shipping_mode,
      pickup_enabled: storeForm.pickup_enabled,
      pickup_address: storeForm.pickup_address || null,
      pickup_instructions: storeForm.pickup_instructions || null,
      default_item_weight_kg: Number(storeForm.default_item_weight_kg) || 0.5,
    };
    const { error } = await supabase.from("ecommerce_stores").upsert(row, { onConflict: "org_id" });
    setLoading(false);
    if (error) { toast.error("Error al guardar"); return; }
    toast.success("Tienda guardada correctamente");
    setStore(row);
  };

  // Se evalúa sobre el FORMULARIO y no sobre lo guardado: así el estado
  // reacciona mientras el comercio configura, sin tener que guardar para ver.
  const readiness = useMemo(() => evaluateStoreReadiness({
    store: {
      is_active: storeForm.is_active,
      slug: storeForm.slug || store?.slug || null,
      name: storeForm.name,
      logo_url: store?.logo_url ?? null,
      description: storeForm.description || null,
      meta_title: storeForm.meta_title || null,
      payment_methods: storeForm.payment_methods,
      shipping_mode: storeForm.shipping_mode,
      pickup_enabled: storeForm.pickup_enabled,
      shipping_cost: Number(storeForm.shipping_cost) || 0,
    },
    ...signals,
  }), [storeForm, store?.logo_url, store?.slug, signals]);

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
            {/* Una tienda activa que no puede cobrar o no puede cotizar el envío
                no está "Activa" en ningún sentido útil: se avisa acá, que es
                donde se mira el estado. */}
            <Badge className={
              !store?.is_active
                ? "bg-zinc-500/15 text-zinc-400 border-zinc-500/20"
                : readiness.canPublish
                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
                  : "bg-yellow-500/15 text-yellow-500 border-yellow-500/20"
            }>
              {!store?.is_active
                ? "○ Inactiva"
                : readiness.canPublish
                  ? "● Activa"
                  : `▲ ${readinessSummary(readiness)}`}
            </Badge>
            {store?.slug && (
              <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => window.open(`${window.location.origin}/tienda/${store.slug}`, "_blank")}>
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
                  <span className="text-xs text-muted-foreground shrink-0 truncate max-w-[45%]">{window.location.host}/tienda/</span>
                  <Input value={storeForm.slug} onChange={e => setStoreForm(p => ({ ...p, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") }))} placeholder="mi-tienda" className="h-9" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Descripción</label>
                <Input
                  value={storeForm.description}
                  onChange={e => setStoreForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="Aparece en el encabezado de la tienda y en el pie"
                  className="h-9"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">
                  Email para avisos de venta
                </label>
                <Input
                  type="email"
                  value={storeForm.notification_email}
                  onChange={e => setStoreForm(p => ({ ...p, notification_email: e.target.value }))}
                  placeholder="ventas@tunegocio.com"
                  className="h-9"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Si lo dejás vacío, los pedidos llegan al email con el que iniciás sesión.
                </p>
              </div>
            </div>
          </div>

          {/* ── Envíos ─────────────────────────────────────────────── */}
          <div className="bg-card border border-border/40 rounded-xl p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">Envíos</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Cómo se calcula el envío en el checkout de tu tienda.
                </p>
              </div>
              <Link to="/envios?tab=zonas">
                <Button variant="outline" size="sm" className="shrink-0">
                  <MapPin className="w-3.5 h-3.5 mr-1" /> Zonas y tarifas
                </Button>
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {SHIPPING_MODES.map(m => {
                const active = storeForm.shipping_mode === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => setStoreForm(p => ({ ...p, shipping_mode: m.id }))}
                    className={`text-left p-3 rounded-lg border transition-all ${
                      active
                        ? "border-primary/50 bg-primary/8"
                        : "border-border/50 bg-muted/20 hover:border-border"
                    }`}
                  >
                    <p className={`text-sm font-medium ${active ? "text-primary" : ""}`}>{m.label}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{m.hint}</p>
                  </button>
                );
              })}
            </div>

            {storeForm.shipping_mode === "flat" && (
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
            )}

            {storeForm.shipping_mode === "zones" && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">Envío gratis desde</label>
                    <Input type="number" value={storeForm.free_shipping_above} onChange={e => setStoreForm(p => ({ ...p, free_shipping_above: e.target.value }))} className="h-9" placeholder="dejar vacío para nunca" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">
                      Peso por producto sin peso cargado (kg)
                    </label>
                    <Input type="number" step="0.1" value={storeForm.default_item_weight_kg}
                      onChange={e => setStoreForm(p => ({ ...p, default_item_weight_kg: e.target.value }))} className="h-9" />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Cargá el peso real de cada producto en Productos para que la cotización sea exacta.
                  Mientras no lo tenga, se usa este peso estimado.
                </p>
              </div>
            )}

            {/* Retiro en tienda — vale para cualquier modo */}
            <div className="pt-3 border-t border-border/40 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Retiro en tienda</p>
                  <p className="text-[11px] text-muted-foreground">
                    Opción gratis en el checkout. Sube la conversión y te ahorra el envío.
                  </p>
                </div>
                <button onClick={() => setStoreForm(p => ({ ...p, pickup_enabled: !p.pickup_enabled }))}
                  className={`w-10 h-5 rounded-full transition-all shrink-0 ${storeForm.pickup_enabled ? "bg-emerald-500" : "bg-muted"}`}>
                  <div className={`w-4 h-4 bg-white rounded-full m-0.5 transition-transform ${storeForm.pickup_enabled ? "translate-x-5" : "translate-x-0"}`} />
                </button>
              </div>
              {storeForm.pickup_enabled && (
                <div className="space-y-2">
                  <Input value={storeForm.pickup_address}
                    onChange={e => setStoreForm(p => ({ ...p, pickup_address: e.target.value }))}
                    placeholder="Dirección de retiro" className="h-9" />
                  <Input value={storeForm.pickup_instructions}
                    onChange={e => setStoreForm(p => ({ ...p, pickup_instructions: e.target.value }))}
                    placeholder="Horarios o instrucciones (ej: lun a vie de 10 a 18)" className="h-9" />
                </div>
              )}
            </div>
          </div>

          {/* SEO — estos campos se guardaban desde siempre pero no tenían
              dónde escribirse. Son los que ve Google y los que aparecen al
              pegar el link en WhatsApp o Instagram. */}
          <div className="bg-card border border-border/40 rounded-xl p-5 space-y-3">
            <h3 className="font-semibold flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" />SEO y vista previa al compartir
            </h3>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">
                Título ({storeForm.meta_title.length}/60)
              </label>
              <Input
                value={storeForm.meta_title}
                onChange={e => setStoreForm(p => ({ ...p, meta_title: e.target.value.slice(0, 60) }))}
                placeholder={`${storeForm.name} — Perfumes importados`}
                className="h-9"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">
                Descripción ({storeForm.meta_description.length}/160)
              </label>
              <Input
                value={storeForm.meta_description}
                onChange={e => setStoreForm(p => ({ ...p, meta_description: e.target.value.slice(0, 160) }))}
                placeholder="Perfumes árabes y de diseñador originales, con envío a todo el país."
                className="h-9"
              />
            </div>

            {/* Vista previa aproximada de cómo se ve el link compartido */}
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
                Así se va a ver el link
              </p>
              <p className="text-xs text-muted-foreground truncate">
                {window.location.host}/tienda/{storeForm.slug || "mi-tienda"}
              </p>
              <p className="text-sm font-medium text-primary truncate">
                {storeForm.meta_title || `${storeForm.name} — Tienda online`}
              </p>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {storeForm.meta_description || storeForm.description || "Agregá una descripción para que se vea mejor al compartir."}
              </p>
            </div>
          </div>

          {/* Píxeles — sin esto no se puede publicitar: Meta no sabe qué
              anuncio generó la venta y no puede armar públicos similares. */}
          <div className="bg-card border border-border/40 rounded-xl p-5 space-y-3">
            <h3 className="font-semibold flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />Píxeles y analítica
            </h3>
            <p className="text-xs text-muted-foreground">
              La tienda dispara solo los eventos de ver producto, agregar al carrito,
              iniciar compra y compra concretada. No se envían datos personales del
              comprador, solo qué producto y por cuánto.
            </p>

            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">
                Píxel de Meta (Facebook / Instagram)
              </label>
              <Input
                value={storeForm.meta_pixel_id}
                onChange={e => setStoreForm(p => ({ ...p, meta_pixel_id: e.target.value.trim() }))}
                placeholder="123456789012345"
                className="h-9"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">
                Google Analytics 4
              </label>
              <Input
                value={storeForm.ga_measurement_id}
                onChange={e => setStoreForm(p => ({ ...p, ga_measurement_id: e.target.value.trim() }))}
                placeholder="G-XXXXXXXXXX"
                className="h-9"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">
                Píxel de TikTok
              </label>
              <Input
                value={storeForm.tiktok_pixel_id}
                onChange={e => setStoreForm(p => ({ ...p, tiktok_pixel_id: e.target.value.trim() }))}
                placeholder="CXXXXXXXXXXXXXXXXXXX"
                className="h-9"
              />
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

          {/* Qué falta para que la tienda pueda vender */}
          <StoreReadinessPanel readiness={readiness} />

          <div className="flex items-center justify-between bg-card border border-border/40 rounded-xl p-4">
            <div>
              <p className="text-sm font-semibold">Tienda Activa</p>
              <p className="text-xs text-muted-foreground">
                {readiness.canPublish
                  ? "Pública y visible en internet"
                  : "Resolvé lo que falta antes de publicarla: hoy un comprador no podría terminar la compra"}
              </p>
            </div>
            {/* No se bloquea el toggle: si quiere publicar igual, es su negocio.
                Lo que no puede pasar es que lo haga sin saber qué va a fallar. */}
            <button
              onClick={() => setStoreForm(p => ({ ...p, is_active: !p.is_active }))}
              title={readiness.canPublish ? undefined : readinessSummary(readiness)}
              className={`w-10 h-5 rounded-full transition-all shrink-0 ${
                storeForm.is_active
                  ? readiness.canPublish ? "bg-emerald-500" : "bg-yellow-500"
                  : "bg-muted"
              }`}
            >
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
