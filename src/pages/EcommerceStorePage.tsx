import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MAX_DESCUENTO_PORCENTAJE } from "@/lib/paymentDiscount";
import { STORE_FONTS } from "@/storefront/theme";
import { Badge } from "@/components/ui/badge";
import {
  ShoppingBag, Globe, Package, ShoppingCart, TrendingUp, Settings,
  Plus, Eye, RefreshCw, ExternalLink, Palette, Zap, BarChart3,
  Check, AlertTriangle, Tag, Users, DollarSign, ArrowRight, Loader2, MapPin,
  Image as ImageIcon, Type, ChevronUp, ChevronDown, Copy,
} from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import StoreReadinessPanel from "@/components/ecommerce/StoreReadinessPanel";
import StoreOrdersPanel from "@/components/ecommerce/StoreOrdersPanel";
import AbandonedCartsPanel from "@/components/ecommerce/AbandonedCartsPanel";
import StoreOrderInspector from "@/components/ecommerce/StoreOrderInspector";
import PaymentConnectionsPanel from "@/components/integrations/PaymentConnectionsPanel";
import ReviewsModeration from "@/components/ecommerce/ReviewsModeration";
import QuestionsModeration from "@/components/ecommerce/QuestionsModeration";
import StorePagesEditor from "@/components/ecommerce/StorePagesEditor";
import CategoriesEditor from "@/components/ecommerce/CategoriesEditor";
import MenuEditor from "@/components/ecommerce/MenuEditor";
import QuantityDiscountsEditor from "@/components/ecommerce/QuantityDiscountsEditor";
import StoreBannersEditor from "@/components/ecommerce/StoreBannersEditor";
import OrderShipmentDialog, { type OrderForShipment } from "@/components/ecommerce/OrderShipmentDialog";
import ImageUpload from "@/components/shared/ImageUpload";
import { evaluateStoreReadiness, readinessSummary } from "@/lib/storeReadiness";
import { storeBankTransferReady } from "@/lib/storeTransfer";
import { parseActivationHandoff, storeHandoffCopy } from "@/lib/activationHandoff";
import {
  storeAbandonedCartCount,
  storeAfterCatalogCopy,
  storeFunnelFromCarts,
  storePublishCta,
  storePublishNudges,
  storeShouldLeadWithPay,
  storeShouldShowAfterCatalog,
  storeShouldShowCatalogHandoff,
  storeShouldShowStoreMissingHandoff,
  storeShouldShowPerformanceChrome,
  storeMissingCopy,
  storeStatusLabel,
  storeShouldLeadSettingsWithIdentity,
  storeAfterCreateCopy,
  urlPublicaDeTienda,
} from "@/lib/storeFirstPublish";
import type { AbandonedCartRow } from "@/lib/abandonedCarts";
import { filterAbandonedCartsForQueue } from "@/lib/abandonedCarts";
import {
  costoEnvioAlGuardar,
  envioGratisAlGuardar,
  esConflictoDeSlug,
  slugCandidatoDeTienda,
  storeDraftInicial,
  storeFormDesdeFila,
  sugerirDireccionDeRetiro,
  sugerirEmailDeAvisos,
} from "@/lib/storeDraft";
import { socialLinksParaGuardar } from "@/lib/storeSocial";
import {
  HOME_SECTION_LABELS,
  layoutParaGuardar,
  moverSeccion,
} from "@/lib/storeHomeLayout";
import { estadoPublicacionLegal } from "@/lib/legalPages";
import { fetchPaymentStatus } from "@/lib/paymentStatus";
import {
  esMedioGestionaPay,
  MEDIO_GESTIONA_PAY,
  normalizarDescuentosMedios,
  normalizarMediosTienda,
} from "@/lib/gestionaPay";
import { STORE_ORDER_QUEUE_LIMIT, storeOrderFulfillmentLabel, storeOrderFulfillmentTone } from "@/lib/storeOrderQueue";
import { findStoreOrderForInspect, isStoreOrderInspectId } from "@/lib/storeOrderDetail";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";
import PageHeader from "@/components/shared/PageHeader";
import KPICard from "@/components/shared/KPICard";
import WorkspaceState from "@/components/shared/WorkspaceState";
import { usePageTitle } from "@/hooks/usePageTitle";

const THEMES = [
  { id: "minimal", label: "Minimal", desc: "Limpio y moderno", preview: "bg-white" },
  { id: "bold",    label: "Bold",    desc: "Colores vibrantes", preview: "bg-yellow-400" },
  { id: "luxury",  label: "Luxury",  desc: "Dark & premium",   preview: "bg-zinc-900" },
  { id: "sport",   label: "Sport",   desc: "Dinámico",         preview: "bg-blue-600" },
  { id: "natural", label: "Natural", desc: "Orgánico, verde",   preview: "bg-emerald-600" },
  { id: "noche",   label: "Noche",   desc: "Oscuro y neutro",   preview: "bg-slate-900" },
  { id: "pastel",  label: "Pastel",  desc: "Claro y cálido",    preview: "bg-rose-200" },
];

const SHIPPING_MODES = [
  { id: "flat",  label: "Precio plano",   hint: "Un mismo costo para todo el país." },
  { id: "zones", label: "Por zona y peso", hint: "Cotiza según provincia, peso y transportista." },
  { id: "free",  label: "Envío gratis",   hint: "Sin costo de envío para el comprador." },
];

const PAYMENT_METHODS = [
  { id: "gestiona_pay",   label: "Gestiona Pay", hint: "Procesado con Mercado Pago", logo: "🔵" },
  { id: "transferencia",  label: "Transferencia",  logo: "🏦" },
  { id: "efectivo",       label: "Efectivo / retiro", logo: "💵" },
];

// Radix Select no acepta una opción con value vacío. Este valor nunca llega a
// la base: al guardar se convierte en null, que conserva el modo global para
// comercios que todavía no usan sucursales.
const GLOBAL_FULFILLMENT_LOCATION = "__stock_global__";

interface EcomOrder {
  id: string;
  order_number: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  total: number;
  subtotal: number | null;
  shipping_cost: number | null;
  discount_amount: number | null;
  coupon_code: string | null;
  coupon_discount_ars: number | null;
  tax_amount: number | null;
  payment_status: string;
  payment_method: string | null;
  carrier?: string | null;
  shipping_service?: string | null;
  fulfillment_status: string;
  tracking_number: string | null;
  shipping_address: Record<string, string> | null;
  items: unknown[];
  notes: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

interface FunnelRow {
  label: string;
  value: number;
  pct: number;
  color: string;
}

const STORE_TAB_IDS = ["overview", "orders", "carritos", "reviews", "categorias", "pages", "banners", "design", "settings"] as const;
type StoreTab = typeof STORE_TAB_IDS[number];

function isStoreTab(value: string | null): value is StoreTab {
  return value !== null && (STORE_TAB_IDS as readonly string[]).includes(value);
}

export default function EcommerceStorePage() {
  usePageTitle("Gestiona Commerce");
  const { orgId, org } = useOrganization();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { ask, dialog } = useConfirmDialog();
  const { fromWizard } = parseActivationHandoff(searchParams);
  const requestedTab = searchParams.get("tab");
  const tab: StoreTab = isStoreTab(requestedTab) ? requestedTab : "overview";
  const goToTab = (next: StoreTab) => {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      if (next === "overview") params.delete("tab");
      else params.set("tab", next);
      if (next !== "orders") {
        params.delete("q");
        params.delete("vista");
        params.delete("pedido");
      }
      return params;
    }, { replace: true });
  };
  // Opiniones y preguntas comparten pestaña: son las dos cosas que escribe el
  // comprador y que el comercio contesta. Separarlas agregaba una pestaña más a
  // una fila que ya tiene siete.
  const [vozTab, setVozTab] = useState<"opiniones" | "preguntas">("opiniones");
  const [store, setStore] = useState<any>(null);
  /** Tras el primer Guardar: banner al catálogo mientras siguen en settings. */
  const [justCreatedStore, setJustCreatedStore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [storeForm, setStoreForm] = useState(() => storeDraftInicial(undefined, GLOBAL_FULFILLMENT_LOCATION));
  const [selectedTheme, setSelectedTheme] = useState("minimal");
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  // Señales de "¿puede vender?". Arrancan en el peor caso: mientras no se sepa,
  // es más honesto mostrar que falta algo que decir que todo está listo.
  const [signals, setSignals] = useState({
    publishedProducts: 0,
    productsWithoutWeight: 0,
    shippingZones: 0,
    zonesWithRates: 0,
    coveredProvinces: 0,
    paymentConnected: false,
    // Hasta poder leer las páginas, es más seguro advertir que faltan que
    // presentar una tienda como apta para recibir datos personales.
    legalPages: { missingOrTemplate: 2, drafts: 0 },
  });
  // CBU/alias viven en settings (misma autoridad que el link de pago).
  const [bankForm, setBankForm] = useState({
    bank_cbu: "",
    bank_alias: "",
    bank_name: "",
    bank_holder: "",
  });
  const [orders, setOrders] = useState<EcomOrder[]>([]);
  const [envioDe, setEnvioDe] = useState<EcomOrder | null>(null);
  const [confirmingPaid, setConfirmingPaid] = useState(false);
  const [pedidoExtra, setPedidoExtra] = useState<EcomOrder | null>(null);
  const [pedidoExtraLoading, setPedidoExtraLoading] = useState(false);
  const [funnelData, setFunnelData] = useState<FunnelRow[]>([]);
  const [abandonedCarts, setAbandonedCarts] = useState(0);
  const [abandonedCartRows, setAbandonedCartRows] = useState<AbandonedCartRow[]>([]);
  const [abandonedLoading, setAbandonedLoading] = useState(false);
  const [abandonedError, setAbandonedError] = useState<string | null>(null);
  // Opciones para armar el menú: las categorías y las páginas publicadas.
  const [menuCategorias, setMenuCategorias] = useState<{ slug: string; name: string }[]>([]);
  const [menuPaginas, setMenuPaginas] = useState<{ slug: string; title: string }[]>([]);
  const [fulfillmentLocations, setFulfillmentLocations] = useState<{
    id: string; name: string; is_main: boolean;
  }[]>([]);
  const [domicilioFiscal, setDomicilioFiscal] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId || tab !== "categorias") return;
    Promise.all([
      supabase.from("ecommerce_categories").select("slug, name")
        .eq("org_id", orgId).eq("is_active", true).order("sort_order"),
      supabase.from("store_pages").select("slug, title")
        .eq("org_id", orgId).eq("status", "published").order("title"),
    ]).then(([c, g]) => {
      setMenuCategorias((c.data ?? []) as { slug: string; name: string }[]);
      setMenuPaginas((g.data ?? []) as { slug: string; title: string }[]);
    });
  }, [orgId, tab]);

  /** Releer las órdenes. Se usa al montar y después de despachar una. */
  const loadOrders = useCallback(async () => {
    if (!orgId) {
      setOrders([]);
      setOrdersLoading(false);
      return;
    }
    setOrdersLoading(true);
    setOrdersError(null);
    const { data, error } = await supabase
      .from("ecommerce_orders")
      .select("id, order_number, customer_name, customer_email, customer_phone, total, subtotal, shipping_cost, discount_amount, coupon_code, coupon_discount_ars, tax_amount, payment_status, payment_method, fulfillment_status, tracking_number, shipping_address, items, notes, shipped_at, delivered_at, created_at, carrier, shipping_service")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(STORE_ORDER_QUEUE_LIMIT);
    if (error) {
      console.error("No se pudieron leer los pedidos de la tienda", error);
      setOrders([]);
      setOrdersError("No pudimos leer los pedidos de la tienda. Reintentá.");
    } else {
      setOrders((data ?? []) as EcomOrder[]);
    }
    setOrdersLoading(false);
  }, [orgId]);

  const pedidoId = searchParams.get("pedido");
  const pedidoFromQueue = findStoreOrderForInspect(orders, pedidoId);
  const inspectedOrder = pedidoFromQueue ?? pedidoExtra;

  const openPedido = (orderId: string) => {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      params.set("tab", "orders");
      params.set("pedido", orderId);
      return params;
    });
  };
  const closePedido = () => {
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      params.delete("pedido");
      return params;
    }, { replace: true });
  };

  const confirmarPagoManual = async (order: { id: string; order_number: string; payment_method?: string | null }) => {
    const medio = order.payment_method === "efectivo" ? "efectivo" : "transferencia";
    if (!(await ask({
      title: "¿Marcar como cobrado?",
      description: medio === "efectivo"
        ? `Confirmás que recibiste el pago en efectivo del pedido ${order.order_number}. Se acredita la venta y se puede despachar.`
        : `Confirmás que viste la transferencia del pedido ${order.order_number}. Se acredita la venta y se puede despachar.`,
      confirmText: "Marcar cobrado",
    }))) return;
    setConfirmingPaid(true);
    const { data, error } = await supabase.rpc("confirmar_pago_manual_tienda", {
      p_order_id: order.id,
    });
    setConfirmingPaid(false);
    if (error) {
      console.error("confirmar_pago_manual_tienda:", error);
      toast.error(error.message || "No se pudo acreditar el pago.");
      return;
    }
    if ((data as { ok?: boolean } | null)?.ok === false) {
      toast.error("No se pudo acreditar el pago.");
      return;
    }
    toast.success(`Pedido ${order.order_number} marcado como cobrado`);
    await loadOrders();
  };

  useEffect(() => {
    const raw = searchParams.get("pedido");
    if (!raw) {
      setPedidoExtra(null);
      setPedidoExtraLoading(false);
      return;
    }
    if (findStoreOrderForInspect(orders, raw)) {
      setPedidoExtra(null);
      setPedidoExtraLoading(false);
      return;
    }
    if (!orgId || !isStoreOrderInspectId(raw)) {
      setPedidoExtra(null);
      setPedidoExtraLoading(false);
      return;
    }
    let cancelado = false;
    setPedidoExtraLoading(true);
    supabase
      .from("ecommerce_orders")
      .select("id, order_number, customer_name, customer_email, customer_phone, total, subtotal, shipping_cost, discount_amount, coupon_code, coupon_discount_ars, tax_amount, payment_status, payment_method, fulfillment_status, tracking_number, shipping_address, items, notes, shipped_at, delivered_at, created_at, carrier, shipping_service")
      .eq("org_id", orgId)
      .eq("id", raw)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelado) return;
        if (error) console.error("No se pudo leer el pedido del deep link", error);
        setPedidoExtra((data as EcomOrder | null) ?? null);
        setPedidoExtraLoading(false);
      });
    return () => { cancelado = true; };
  }, [orgId, orders, searchParams]);

  useEffect(() => {
    if (!orgId) {
      setOrdersLoading(false);
      return;
    }
    supabase.from("ecommerce_stores").select("*").eq("org_id", orgId).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setStore(data);
          setStoreForm(storeFormDesdeFila(data, GLOBAL_FULFILLMENT_LOCATION));
          setSelectedTheme(data.theme);
        } else {
          setStoreForm(storeDraftInicial(org ?? undefined, GLOBAL_FULFILLMENT_LOCATION));
        }
      });

    // La tienda puede seguir en modo global, pero si el comercio ya trabaja
    // con sucursales se le muestra la elección explícita de dónde prepara los
    // pedidos. La base vuelve a validar que sea una sucursal propia y activa.
    supabase.from("locations")
      .select("id, name, is_main")
      .eq("org_id", orgId)
      .eq("active", true)
      .order("is_main", { ascending: false })
      .order("name")
      .then(({ data, error }) => {
        if (error) {
          console.error("No se pudieron leer las sucursales de despacho", error);
          return;
        }
        setFulfillmentLocations((data ?? []) as { id: string; name: string; is_main: boolean }[]);
      });

    // Misma autoridad que Facturas/legales: si ya hay domicilio fiscal y el
    // retiro está vacío, se ofrece copiarlo. No se escribe solo.
    supabase.from("afip_connection_status")
      .select("domicilio")
      .eq("org_id", orgId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.error("No se pudo leer el domicilio fiscal para el retiro", error);
          return;
        }
        setDomicilioFiscal(String(data?.domicilio ?? "").trim() || null);
      });

    supabase.from("settings")
      .select("bank_cbu, bank_alias, bank_name, bank_holder")
      .eq("org_id", orgId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.error("No se pudieron leer los datos bancarios de la tienda", error);
          return;
        }
        if (!data) return;
        setBankForm({
          bank_cbu: data.bank_cbu || "",
          bank_alias: data.bank_alias || "",
          bank_name: data.bank_name || "",
          bank_holder: data.bank_holder || "",
        });
      });

    loadOrders();

    const loadCartSessions = () => {
      setAbandonedLoading(true);
      setAbandonedError(null);
      supabase
        .from("ecommerce_cart_sessions")
        .select("id, status, items, customer_email, subtotal, total, abandoned_email_sent, updated_at, created_at")
        .eq("org_id", orgId)
        .then(({ data, error }) => {
          if (error) {
            console.error("EcommerceStorePage / carritos:", error);
            setAbandonedError(error.message);
            setAbandonedLoading(false);
            return;
          }
          const rows = (data ?? []) as AbandonedCartRow[];
          setFunnelData(storeFunnelFromCarts(rows));
          setAbandonedCarts(storeAbandonedCartCount(rows));
          setAbandonedCartRows(filterAbandonedCartsForQueue(rows));
          setAbandonedLoading(false);
        });
    };
    loadCartSessions();
  }, [orgId, org, loadOrders]);

  // Las señales viven en otras pestañas (Páginas, Pay, Productos). Si sólo se
  // leyeran al montar, publicar legales o conectar MP dejaba el checklist
  // mintiendo hasta un F5.
  const reloadReadinessSignals = useCallback(async () => {
    if (!orgId) return;
    try {
      const [prods, sinPeso, zonas, tarifas, paginas, cobro] = await Promise.all([
        supabase.from("products").select("id", { count: "exact", head: true })
          .eq("org_id", orgId).gt("stock", 0).gt("sale_price_ars", 0),
        supabase.from("products").select("id", { count: "exact", head: true })
          .eq("org_id", orgId).gt("stock", 0).gt("sale_price_ars", 0).is("weight_kg", null),
        supabase.from("shipping_zones").select("id, provinces")
          .eq("org_id", orgId).eq("is_active", true),
        supabase.from("shipping_rates").select("zone_id").eq("org_id", orgId).eq("is_active", true),
        supabase.from("store_pages").select("slug, content, status")
          .eq("org_id", orgId)
          .in("slug", ["politica-de-privacidad", "terminos-y-condiciones"]),
        fetchPaymentStatus(orgId),
      ]);
      const zonasList = (zonas.data ?? []) as { id: string; provinces: string[] | null }[];
      const conTarifa = new Set(((tarifas.data ?? []) as { zone_id: string }[]).map(r => r.zone_id));
      const provincias = new Set(
        zonasList.filter(z => conTarifa.has(z.id)).flatMap(z => z.provinces ?? []),
      );
      const estadoLegal = estadoPublicacionLegal(
        (paginas.data ?? []) as { slug: string; content: string | null; status: string | null }[],
      );
      if (paginas.error) console.error("No se pudieron leer las páginas legales", paginas.error);
      setSignals({
        publishedProducts: prods.count ?? 0,
        productsWithoutWeight: sinPeso.count ?? 0,
        shippingZones: zonasList.length,
        zonesWithRates: zonasList.filter(z => conTarifa.has(z.id)).length,
        coveredProvinces: provincias.size,
        paymentConnected: cobro.connected,
        legalPages: {
          missingOrTemplate: estadoLegal.faltantesOPlantilla,
          drafts: estadoLegal.borradores,
        },
      });
    } catch (err) {
      console.error("No se pudieron releer las señales de la tienda", err);
    }
  }, [orgId]);

  useEffect(() => {
    void reloadReadinessSignals();
  }, [reloadReadinessSignals, tab]);

  const saveStore = async (opts?: { activate?: boolean }) => {
    if (!orgId) return;
    const creatingStore = !store?.id;
    const name = storeForm.name.trim();
    if (!name) {
      toast.error("Poné el nombre de la tienda.");
      return;
    }
    const slug = slugCandidatoDeTienda({
      slugEscrito: storeForm.slug,
      name,
      orgSlug: org?.slug,
      orgId,
    });
    if (!slug) {
      toast.error("Elegí una dirección para la tienda.");
      return;
    }
    const isActive = opts?.activate ? true : storeForm.is_active;
    // Publicar (CTA o toggle+guardar) exige lo mismo: sin canPublish el
    // comprador no termina la compra. Shopify/Tiendanube no dejan ir live
    // con el cobro a medias.
    if (isActive && !readiness.canPublish) {
      toast.error(readinessSummary(readiness));
      return;
    }
    setLoading(true);
    const row = {
      org_id: orgId,
      name,
      slug,
      theme: selectedTheme,
      primary_color: storeForm.primary_color,
      currency: storeForm.currency,
      tax_included: storeForm.tax_included,
      free_shipping_above: envioGratisAlGuardar(storeForm.free_shipping_above),
      shipping_cost: costoEnvioAlGuardar(storeForm.shipping_cost),
      is_active: isActive,
      payment_methods: normalizarMediosTienda(storeForm.payment_methods),
      payment_discounts: normalizarDescuentosMedios(storeForm.payment_discounts),
      payment_discount_stacks: storeForm.payment_discount_stacks,
      font: storeForm.font,
      description: storeForm.description || null,
      logo_url: storeForm.logo_url || null,
      banner_url: storeForm.banner_url || null,
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
      storefront_layout: layoutParaGuardar(storeForm.storefront_layout),
      social_links: socialLinksParaGuardar({
        whatsapp: storeForm.whatsapp,
        instagram: storeForm.instagram,
      }),
      fulfillment_location_id: storeForm.fulfillment_location_id === GLOBAL_FULFILLMENT_LOCATION
        ? null
        : storeForm.fulfillment_location_id,
    };
    const { data: saved, error } = await supabase
      .from("ecommerce_stores")
      .upsert(row, { onConflict: "org_id" })
      .select("*")
      .single();
    if (error) {
      setLoading(false);
      console.error("No se pudo guardar la tienda", error);
      toast.error(esConflictoDeSlug(error)
        ? "Esa dirección ya está en uso. Probá otra."
        : "No se pudo guardar la tienda.");
      return;
    }

    // Transferencia cobra con estos datos: si el medio está marcado y no se
    // guardan acá, el pedido del comprador sigue diciendo «te escribimos».
    const { error: bankError } = await supabase.from("settings").update({
      bank_cbu: bankForm.bank_cbu.trim() || null,
      bank_alias: bankForm.bank_alias.trim() || null,
      bank_name: bankForm.bank_name.trim() || null,
      bank_holder: bankForm.bank_holder.trim() || null,
    }).eq("org_id", orgId);
    setLoading(false);
    if (bankError) {
      console.error("No se pudieron guardar los datos bancarios", bankError);
      toast.error("La tienda se guardó, pero no los datos para transferir. Reintentá.");
      // Igual conservamos el id: sin él Páginas/Banners siguen muertos.
      if (saved) {
        setStore(saved);
        setStoreForm(storeFormDesdeFila(saved, GLOBAL_FULFILLMENT_LOCATION));
      }
      return;
    }
    toast.success(opts?.activate ? "La tienda está publicada" : "Tienda guardada correctamente");
    // El upsert sin select dejaba store sin id: legales y banners pedían
    // «Creá la tienda» con toast de guardado (medido sesión 145).
    setStore(saved);
    setStoreForm(storeFormDesdeFila(saved, GLOBAL_FULFILLMENT_LOCATION));
    if (creatingStore) setJustCreatedStore(true);
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
      pickup_address: storeForm.pickup_address || null,
      pickup_instructions: storeForm.pickup_instructions || null,
      shipping_cost: costoEnvioAlGuardar(storeForm.shipping_cost),
      notification_email: storeForm.notification_email || null,
    },
    bankTransferReady: storeBankTransferReady(bankForm),
    bank_cbu: bankForm.bank_cbu,
    bank_alias: bankForm.bank_alias,
    ...signals,
  }), [storeForm, store?.logo_url, store?.slug, signals, bankForm]);

  const storeMissing = storeShouldShowStoreMissingHandoff(store?.id)
    ? storeMissingCopy()
    : null;
  const catalogHandoff = !storeMissing && storeShouldShowCatalogHandoff(signals.publishedProducts)
    ? storeHandoffCopy()
    : null;
  const afterCatalog = !storeMissing && storeShouldShowAfterCatalog({
    fromWizard,
    publishedProducts: signals.publishedProducts,
    storeActive: !!storeForm.is_active,
  })
    ? storeAfterCatalogCopy({ canPublish: readiness.canPublish })
    : null;
  const publishCta = afterCatalog ? storePublishCta({ canPublish: readiness.canPublish }) : null;
  const publishNudges = useMemo(() => storePublishNudges({
    productsWithoutWeight: signals.productsWithoutWeight,
    legalMissingOrDraft:
      signals.legalPages.missingOrTemplate + signals.legalPages.drafts,
    shippingGaps: readiness.checks.some(
      (c) => (c.id === "shipping-rates" || c.id === "coverage") && !c.done,
    ),
  }), [signals, readiness.checks]);

  const TABS: { id: StoreTab; label: string }[] = [
    { id: "overview",  label: "Publicar" },
    { id: "orders",    label: "Pedidos" },
    { id: "carritos",  label: "Carritos" },
    { id: "reviews",   label: "Opiniones y preguntas" },
    { id: "categorias", label: "Categorías" },
    { id: "pages",     label: "Páginas" },
    { id: "banners",   label: "Banners" },
    { id: "design",    label: "Diseño y tema" },
    { id: "settings",  label: "Pagos y envíos" },
  ];

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayOrders = useMemo(() => orders.filter(o => o.created_at.slice(0, 10) === todayStr), [orders, todayStr]);
  const todayRevenue = useMemo(() => todayOrders.reduce((sum, o) => sum + Number(o.total), 0), [todayOrders]);
  const conversionPct = funnelData.find(f => f.label === "Órdenes completadas")?.pct ?? 0;
  const activeCartsCount = funnelData.find(f => f.label === "Con items en carrito")?.value ?? 0;
  const showPerformance = storeShouldShowPerformanceChrome({
    sessionCount: funnelData.find(f => f.label === "Sesiones")?.value ?? 0,
    orderCount: orders.length,
  });
  const methods = storeForm.payment_methods ?? [];
  const leadWithPay = storeShouldLeadWithPay({
    publishedProducts: signals.publishedProducts,
    paymentConnected: signals.paymentConnected,
    wantsMercadoPago: methods.some(esMedioGestionaPay),
    hasOfflinePayment: methods.some((m) => m === "transferencia" || m === "efectivo"),
  });
  const retiroSugerido = storeForm.pickup_enabled
    ? sugerirDireccionDeRetiro({
      pickupAddress: storeForm.pickup_address,
      domicilioFiscal,
    })
    : null;
  const emailAvisosSugerido = sugerirEmailDeAvisos({
    notificationEmail: storeForm.notification_email,
    sessionEmail: user?.email,
  });

  const kpis = useMemo(() => [
    { label: "Revenue hoy",      value: todayRevenue > 0 ? `$${(todayRevenue / 1000).toFixed(0)}K` : "$0", sub: `${todayOrders.length} órd. hoy`, icon: DollarSign,    color: "success"  as const },
    { label: "Órdenes totales",  value: String(orders.length || 0),  sub: `${todayOrders.length} hoy`,      icon: ShoppingCart, color: "primary"  as const },
    { label: "Conversión",       value: `${conversionPct}%`,          sub: `${funnelData[0]?.value ?? 0} sesiones totales`, icon: TrendingUp, color: "warning" as const },
    { label: "Carritos c/items", value: activeCartsCount,             sub: `${abandonedCarts} abandonados`, icon: Users, color: "blue" as const },
  ], [todayRevenue, todayOrders.length, orders.length, conversionPct, funnelData, activeCartsCount, abandonedCarts]);

  const urlPublica = urlPublicaDeTienda(
    typeof window === "undefined" ? "" : window.location.origin,
    store?.slug,
  );

  const leadSettingsWithIdentity = storeShouldLeadSettingsWithIdentity(store?.id);
  const afterCreate = justCreatedStore && store?.id && signals.publishedProducts === 0
    ? storeAfterCreateCopy()
    : null;

  useEffect(() => {
    if (signals.publishedProducts > 0) setJustCreatedStore(false);
  }, [signals.publishedProducts]);

  return (
    <div className="workspace-page workspace-ecommerce space-y-6 pb-12">
      <PageHeader
        icon={ShoppingBag}
        title="Gestiona Commerce"
        description="Publicá la tienda, cobrá con Gestiona Pay (Mercado Pago) y despachá. El catálogo y el stock son los del Business Core."
        actions={
          <div className="flex items-center flex-wrap gap-2">
            {/* Una tienda activa que no puede cobrar o no puede cotizar el envío
                no está "Activa" en ningún sentido útil: se avisa acá, que es
                donde se mira el estado. */}
            <Badge className={
              !store?.id
                ? "bg-zinc-500/15 text-zinc-400 border-zinc-500/20"
                : !store?.is_active
                ? "bg-zinc-500/15 text-zinc-400 border-zinc-500/20"
                : readiness.canPublish
                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
                  : "bg-yellow-500/15 text-yellow-500 border-yellow-500/20"
            }>
              {storeStatusLabel({
                storeExists: Boolean(store?.id),
                isActive: Boolean(store?.is_active),
                canPublish: readiness.canPublish,
                readinessSummary: readinessSummary(readiness),
              })}
            </Badge>
            {urlPublica && (
              <>
                <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={() => window.open(urlPublica, "_blank")}>
                  <ExternalLink className="w-3 h-3" />Ver tienda
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs"
                  onClick={() => {
                    void navigator.clipboard.writeText(urlPublica).then(
                      () => toast.success("Enlace copiado"),
                      () => toast.error("No se pudo copiar"),
                    );
                  }}
                >
                  <Copy className="w-3 h-3" />Copiar enlace
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* KPIs: un $0 y un 0% no son analítica. Aparecen cuando hubo tráfico. */}
      {showPerformance ? (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(k => (
          <KPICard key={k.label} label={k.label} value={k.value} sub={k.sub} icon={k.icon} color={k.color} />
        ))}
      </div>
      ) : null}

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 bg-muted/30 p-1 rounded-xl w-fit max-w-full">
        {TABS.map(t => (
          <button key={t.id} onClick={() => goToTab(t.id)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === t.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {t.label}
            {t.id === "carritos" && abandonedCarts > 0 ? (
              <span className="ml-1.5 text-[10px] tabular-nums text-amber-600 dark:text-amber-400">
                {abandonedCarts}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {tab === "reviews" && (
        <div className="space-y-4">
          <div className="flex gap-1 bg-muted/30 p-1 rounded-xl w-fit max-w-full flex-wrap">
            {(["opiniones", "preguntas"] as const).map(v => (
              <button
                key={v} onClick={() => setVozTab(v)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all ${vozTab === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                {v}
              </button>
            ))}
          </div>
          {vozTab === "opiniones" ? <ReviewsModeration /> : <QuestionsModeration />}
        </div>
      )}

      {tab === "categorias" && (
        <div className="space-y-6">
          <CategoriesEditor storeId={store?.id ?? null} />
          <MenuEditor
            storeSlug={store?.slug ?? null}
            categorias={menuCategorias}
            paginas={menuPaginas}
          />
          <QuantityDiscountsEditor categorias={menuCategorias} />
        </div>
      )}

      {tab === "pages" && (
        <StorePagesEditor
          storeId={store?.id ?? null}
          storeSlug={store?.slug ?? null}
          onPagesChanged={reloadReadinessSignals}
        />
      )}

      {tab === "banners" && <StoreBannersEditor storeId={store?.id ?? null} />}

      <OrderShipmentDialog
        order={envioDe as OrderForShipment | null}
        storeName={store?.name ?? storeForm.name}
        onClose={() => setEnvioDe(null)}
        onDone={loadOrders}
      />
      <StoreOrderInspector
        open={Boolean(pedidoId)}
        orgId={orgId}
        order={inspectedOrder}
        requestedId={pedidoId}
        loading={Boolean(pedidoId) && !inspectedOrder && (ordersLoading || pedidoExtraLoading)}
        confirmingPaid={confirmingPaid}
        onClose={closePedido}
        onPrepare={order => {
          setEnvioDe(order as EcomOrder);
        }}
        onConfirmPaid={order => { void confirmarPagoManual(order); }}
      />
      {dialog}
      {/* ─── Overview ─── */}
      {tab === "overview" && (
        <div className="space-y-6">
          {storeMissing && (
            <WorkspaceState
              kind="empty-first-use"
              icon={ShoppingBag}
              title={storeMissing.title}
              description={storeMissing.description}
              actionLabel={storeMissing.actionLabel}
              onAction={() => goToTab("settings")}
            />
          )}
          {catalogHandoff && (
            <WorkspaceState
              kind="empty-first-use"
              icon={Package}
              title={catalogHandoff.title}
              description={catalogHandoff.description}
              actionLabel={catalogHandoff.actionLabel}
              onAction={() => navigate(catalogHandoff.href)}
            />
          )}
          {afterCatalog && (
            <div className="rounded-xl border border-border/40 bg-card p-4 sm:p-5">
              <p className="text-sm font-semibold">{afterCatalog.title}</p>
              <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
                {afterCatalog.description}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {publishCta?.kind === "activate" ? (
                  <Button
                    size="sm"
                    className="min-h-11"
                    disabled={loading}
                    onClick={() => { void saveStore({ activate: true }); }}
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : publishCta.label}
                  </Button>
                ) : (
                  <>
                    <Button size="sm" className="min-h-11" onClick={() => goToTab("settings")}>
                      Pagos y envíos
                    </Button>
                    <Button size="sm" variant="outline" className="min-h-11" onClick={() => goToTab("pages")}>
                      Páginas legales
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
          {!storeMissing && !catalogHandoff ? <StoreReadinessPanel readiness={readiness} /> : null}
          {!storeMissing && !catalogHandoff && publishNudges.length > 0 && (
            <div className="space-y-2">
              {publishNudges.map((n) => (
                <div
                  key={n.id}
                  className="flex flex-col gap-2 rounded-xl border border-border/50 bg-muted/20 p-3 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{n.title}</p>
                    <p className="text-[12px] text-muted-foreground leading-snug">{n.detail}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-11 shrink-0"
                    asChild
                  >
                    <Link to={n.actionHref}>{n.actionLabel}</Link>
                  </Button>
                </div>
              ))}
            </div>
          )}
          {leadWithPay && (
            <div className="flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/[0.06] p-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Gestiona Pay todavía no está activo</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  Sin Gestiona Pay activo el checkout no ofrece cobro online. Transferencia o efectivo sí pueden cobrar.
                </p>
              </div>
              <Button size="sm" className="min-h-11 shrink-0" onClick={() => goToTab("settings")}>
                Activar Gestiona Pay
              </Button>
            </div>
          )}
        {showPerformance ? (
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
              {orders.length === 0 ? (
                <p className="text-sm text-muted-foreground">Todavía no hay pedidos.</p>
              ) : orders.slice(0, 4).map(o => {
                const itemCount = Array.isArray(o.items) ? (o.items as unknown[]).length : 0;
                return (
                <button
                  type="button"
                  key={o.id}
                  className="flex w-full items-center justify-between rounded-lg bg-muted/20 p-3 text-left hover:bg-muted/30"
                  onClick={() => openPedido(o.id)}
                >
                  <div>
                    <p className="text-sm font-medium">{o.customer_name}</p>
                    <p className="text-xs text-muted-foreground">{o.order_number} · {itemCount} item{itemCount > 1 ? "s" : ""}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">${Number(o.total).toLocaleString("es-AR")}</p>
                    <Badge className={`text-xs ${storeOrderFulfillmentTone(o.fulfillment_status)}`}>
                      {storeOrderFulfillmentLabel(o.fulfillment_status, o)}
                    </Badge>
                  </div>
                </button>
                );
              })}
            </div>
          </div>
        </div>
        ) : null}
        </div>
      )}

      {/* ─── Orders tab ─── */}
      {tab === "orders" && (
        <StoreOrdersPanel
          orders={orders}
          loading={ordersLoading}
          error={ordersError}
          selectedId={pedidoId}
          onRetry={() => { void loadOrders(); }}
          onInspect={order => openPedido(order.id)}
          onPrepare={order => {
            const full = orders.find(o => o.id === order.id) ?? inspectedOrder;
            if (full) setEnvioDe(full as EcomOrder);
          }}
        />
      )}

      {tab === "carritos" && (
        <AbandonedCartsPanel
          carts={abandonedCartRows}
          loading={abandonedLoading}
          error={abandonedError}
          onRetry={() => {
            if (!orgId) return;
            setAbandonedLoading(true);
            setAbandonedError(null);
            supabase
              .from("ecommerce_cart_sessions")
              .select("id, status, items, customer_email, subtotal, total, abandoned_email_sent, updated_at, created_at")
              .eq("org_id", orgId)
              .then(({ data, error }) => {
                if (error) {
                  console.error("EcommerceStorePage / carritos:", error);
                  setAbandonedError(error.message);
                  setAbandonedLoading(false);
                  return;
                }
                const rows = (data ?? []) as AbandonedCartRow[];
                setFunnelData(storeFunnelFromCarts(rows));
                setAbandonedCarts(storeAbandonedCartCount(rows));
                setAbandonedCartRows(filterAbandonedCartsForQueue(rows));
                setAbandonedLoading(false);
              });
          }}
        />
      )}

      {/* ─── Design tab ─── */}
      {tab === "design" && (
        <div className="space-y-5">
          <div className="bg-card border border-border/40 rounded-xl p-5">
            <h3 className="font-semibold flex items-center gap-2 mb-4"><Palette className="w-4 h-4 text-primary" />Tema de la Tienda</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
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
          <div className="bg-card border border-border/40 rounded-xl p-5">
            <h3 className="font-semibold flex items-center gap-2 mb-1">
              <Type className="w-4 h-4 text-primary" />Tipografía
            </h3>
            <p className="text-xs text-muted-foreground mb-4">
              Es lo que más cambia la cara de una tienda. La vista previa usa la
              fuente de verdad, así que si no se ve distinta es que todavía está
              cargando.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {STORE_FONTS.map(f => {
                const elegida = (storeForm.font || "sistema") === f.id;
                return (
                  <button
                    key={f.id}
                    onClick={() => setStoreForm(p => ({ ...p, font: f.id }))}
                    className={`p-3 rounded-xl border-2 text-left transition-all ${elegida ? "border-primary" : "border-border/40 hover:border-primary/40"}`}
                  >
                    {/* La previa se renderiza con la fuente real: elegir a ciegas
                        por el nombre es cómo se termina con una tienda ilegible. */}
                    <p className="text-lg leading-tight" style={{ fontFamily: f.stack }}>
                      Aa <span className="text-sm">Perfume 100ml</span>
                    </p>
                    <p className="text-xs font-semibold mt-1.5">{f.label}</p>
                    <p className="text-[10px] text-muted-foreground leading-snug">{f.hint}</p>
                    {elegida && <Check className="w-3 h-3 text-primary mt-1" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Logo y portada. Antes no había forma de cargarlos desde la app:
              las columnas existían en `ecommerce_stores` y ninguna pantalla las
              editaba, así que la tienda salía siempre sin logo. */}
          <div className="bg-card border border-border/40 rounded-xl p-5 space-y-4">
            <h3 className="font-semibold flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-primary" />Identidad
            </h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <ImageUpload
                value={storeForm.logo_url || null}
                onChange={url => setStoreForm(p => ({ ...p, logo_url: url ?? "" }))}
                orgId={orgId ?? null}
                carpeta="tienda"
                preset="logo"
                alto="h-24"
                etiqueta="Logo"
                ayuda="Cuadrado. Se ve en el encabezado y al compartir el link."
              />
              <ImageUpload
                value={storeForm.banner_url || null}
                onChange={url => setStoreForm(p => ({ ...p, banner_url: url ?? "" }))}
                orgId={orgId ?? null}
                carpeta="tienda"
                preset="banner"
                alto="h-24"
                etiqueta="Portada"
                ayuda="Fondo del encabezado, cuando no hay banners cargados."
              />
            </div>
          </div>

          <div className="bg-card border border-border/40 rounded-xl p-5 space-y-4">
            <h3 className="font-semibold">Portada</h3>
            <p className="text-xs text-muted-foreground">
              Los bloques se muestran en este orden. Vacío o todo como viene
              de fábrica se guarda como automático: un bloque nuevo no queda
              escondido. No es un editor en vivo — es la composición de la home.
            </p>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={storeForm.storefront_layout.announcement.enabled}
                  onChange={e => setStoreForm(p => ({
                    ...p,
                    storefront_layout: {
                      ...p.storefront_layout,
                      announcement: { ...p.storefront_layout.announcement, enabled: e.target.checked },
                    },
                  }))}
                />
                Barra de anuncio
              </label>
              <Input
                value={storeForm.storefront_layout.announcement.text}
                maxLength={140}
                placeholder="Vacío = envío gratis, si está cargado"
                onChange={e => setStoreForm(p => ({
                  ...p,
                  storefront_layout: {
                    ...p.storefront_layout,
                    announcement: { ...p.storefront_layout.announcement, text: e.target.value },
                  },
                }))}
              />
            </div>
            <ul className="space-y-2">
              {storeForm.storefront_layout.sections.map((s, i) => (
                <li
                  key={s.id}
                  className="flex items-center gap-2 rounded-lg border border-border/40 px-3 py-2"
                >
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={e => setStoreForm(p => ({
                      ...p,
                      storefront_layout: {
                        ...p.storefront_layout,
                        sections: p.storefront_layout.sections.map(x =>
                          x.id === s.id ? { ...x, enabled: e.target.checked } : x,
                        ),
                      },
                    }))}
                  />
                  <span className="flex-1 text-sm">{HOME_SECTION_LABELS[s.id]}</span>
                  <button
                    type="button"
                    className="min-h-11 min-w-11 grid place-items-center disabled:opacity-30"
                    disabled={i === 0}
                    aria-label={`Subir ${HOME_SECTION_LABELS[s.id]}`}
                    onClick={() => setStoreForm(p => ({
                      ...p,
                      storefront_layout: {
                        ...p.storefront_layout,
                        sections: moverSeccion(p.storefront_layout.sections, s.id, -1),
                      },
                    }))}
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    className="min-h-11 min-w-11 grid place-items-center disabled:opacity-30"
                    disabled={i === storeForm.storefront_layout.sections.length - 1}
                    aria-label={`Bajar ${HOME_SECTION_LABELS[s.id]}`}
                    onClick={() => setStoreForm(p => ({
                      ...p,
                      storefront_layout: {
                        ...p.storefront_layout,
                        sections: moverSeccion(p.storefront_layout.sections, s.id, 1),
                      },
                    }))}
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
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
          <Button onClick={() => { void saveStore(); }} disabled={loading} className="gradient-gold text-primary-foreground">
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Guardar Diseño
          </Button>
        </div>
      )}

      {/* ─── Settings tab ─── */}
      {tab === "settings" && (
        <div className="space-y-5">
          {afterCreate && (
            <WorkspaceState
              kind="empty-first-use"
              icon={Package}
              title={afterCreate.title}
              description={afterCreate.description}
              actionLabel={afterCreate.actionLabel}
              onAction={() => navigate(afterCreate.href)}
            />
          )}
          {leadSettingsWithIdentity && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 sm:p-5 space-y-3">
              <p className="text-sm font-semibold">Primero nombre y dirección</p>
              <p className="text-[13px] text-muted-foreground leading-snug">
                Shopify y Tiendanube piden la identidad de la tienda antes del cobro.
                Gestiona Pay puede esperar: sin slug no hay link ni páginas legales.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Nombre de la tienda</label>
                  <Input
                    value={storeForm.name}
                    onChange={e => setStoreForm(p => ({ ...p, name: e.target.value }))}
                    className="h-9 min-h-11"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">Slug (URL)</label>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground shrink-0 truncate max-w-[45%]">
                      {typeof window !== "undefined" ? window.location.host : ""}/tienda/
                    </span>
                    <Input
                      value={storeForm.slug}
                      onChange={e => setStoreForm(p => ({
                        ...p,
                        slug: e.target.value.toLowerCase().replace(/\s+/g, "-"),
                      }))}
                      placeholder="mi-tienda"
                      className="h-9 min-h-11"
                    />
                  </div>
                </div>
                <Button
                  className="min-h-11 w-full sm:w-auto"
                  disabled={loading}
                  onClick={() => { void saveStore(); }}
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                  Crear tienda
                </Button>
              </div>
            </div>
          )}
          {!leadSettingsWithIdentity && (
            <PaymentConnectionsPanel onConnectionChange={reloadReadinessSignals} />
          )}
          <div className="bg-card border border-border/40 rounded-xl p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold flex items-center gap-2">
                  <Package className="w-4 h-4 text-primary" /> Depósito de despacho
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Cada pedido reserva y descuenta este depósito. Así la tienda no ofrece mercadería que está en otra sucursal.
                </p>
              </div>
              <Link to="/sucursales">
                <Button variant="outline" size="sm" className="shrink-0">
                  <MapPin className="w-3.5 h-3.5 mr-1" /> Sucursales
                </Button>
              </Link>
            </div>

            <Select
              value={storeForm.fulfillment_location_id}
              onValueChange={value => setStoreForm(p => ({ ...p, fulfillment_location_id: value }))}
            >
              <SelectTrigger className="h-9 max-w-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={GLOBAL_FULFILLMENT_LOCATION}>Stock global (sin sucursal)</SelectItem>
                {fulfillmentLocations.map(location => (
                  <SelectItem key={location.id} value={location.id}>
                    {location.name}{location.is_main ? " · Principal" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {fulfillmentLocations.length === 0 ? (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                Todavía no hay sucursales activas. Creá y cargá el stock de un depósito antes de activarlo para despacho.
              </p>
            ) : storeForm.fulfillment_location_id === GLOBAL_FULFILLMENT_LOCATION ? (
              <p className="text-[11px] text-muted-foreground">
                La tienda conserva el comportamiento actual y vende contra el total. Elegí una sucursal cuando el inventario esté distribuido.
              </p>
            ) : (
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                Las órdenes guardarán esta sucursal aunque más adelante cambies la configuración de la tienda.
              </p>
            )}
          </div>

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
                <label className="text-xs text-muted-foreground mb-1.5 block">WhatsApp</label>
                <Input
                  value={storeForm.whatsapp}
                  onChange={e => setStoreForm(p => ({ ...p, whatsapp: e.target.value }))}
                  placeholder="54911… con código de país"
                  className="h-9 min-h-11"
                  inputMode="tel"
                  autoComplete="tel"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  El comprador lo ve en la tienda. No es el número del digest interno.
                </p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">Instagram</label>
                <Input
                  value={storeForm.instagram}
                  onChange={e => setStoreForm(p => ({ ...p, instagram: e.target.value }))}
                  placeholder="@tunegocio"
                  className="h-9 min-h-11"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground mb-1.5 block">
                  Email para avisos de venta
                </label>
                <Input
                  type="email"
                  value={storeForm.notification_email}
                  onChange={e => setStoreForm(p => ({ ...p, notification_email: e.target.value }))}
                  placeholder="ventas@tunegocio.com"
                  className="h-9 min-h-11"
                />
                <p className="text-[10px] text-muted-foreground">
                  Si lo dejás vacío, los pedidos llegan al correo del dueño de la organización.
                </p>
                {emailAvisosSugerido && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="min-h-11"
                    onClick={() => setStoreForm(p => ({ ...p, notification_email: emailAvisosSugerido }))}
                  >
                    Usar mi correo
                  </Button>
                )}
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
                  <Input type="number" value={storeForm.shipping_cost} onChange={e => setStoreForm(p => ({ ...p, shipping_cost: e.target.value }))} className="h-9" placeholder="vacío = $0" />
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
                    placeholder="Dirección de retiro" className="h-9 min-h-11" />
                  <Input value={storeForm.pickup_instructions}
                    onChange={e => setStoreForm(p => ({ ...p, pickup_instructions: e.target.value }))}
                    placeholder="Horarios o instrucciones (ej: lun a vie de 10 a 18)" className="h-9 min-h-11" />
                  {!storeForm.pickup_address.trim() && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400">
                      Sin dirección el checkout dice «te vamos a contactar». Cargala antes de publicar.
                    </p>
                  )}
                  {!!storeForm.pickup_address.trim() && !storeForm.pickup_instructions.trim() && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400">
                      Sin horario el pedido pagado no dice cuándo pasar. Cargalo; no se inventa.
                    </p>
                  )}
                  {retiroSugerido && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="min-h-11"
                      onClick={() => setStoreForm(p => ({ ...p, pickup_address: retiroSugerido }))}
                    >
                      Usar domicilio fiscal
                    </Button>
                  )}
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
            <h3 className="font-semibold">Métodos de cobro</h3>
            <p className="text-xs text-muted-foreground">
              Gestiona Pay es el producto de cobro (como Pago Nube). En Argentina el
              procesamiento corre por Mercado Pago — no es un medio aparte. Stripe y
              PayPal no se ofrecen: no hay adapter vivo. El descuento se aplica sobre
              la mercadería, nunca sobre el envío.
            </p>
            <div className="space-y-2">
              {PAYMENT_METHODS.map(pm => {
                const enabled = pm.id === MEDIO_GESTIONA_PAY
                  ? storeForm.payment_methods.some(esMedioGestionaPay)
                  : storeForm.payment_methods.includes(pm.id);
                const pct = Number(storeForm.payment_discounts?.[pm.id] ?? 0);
                return (
                  <div key={pm.id} className="p-3 bg-muted/20 rounded-lg space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span>{pm.logo}</span>
                        <div>
                          <span className="text-sm">{pm.label}</span>
                          {"hint" in pm && pm.hint ? (
                            <p className="text-[11px] text-muted-foreground">{pm.hint}</p>
                          ) : null}
                        </div>
                      </div>
                      <button onClick={() => setStoreForm(p => {
                        if (pm.id === MEDIO_GESTIONA_PAY) {
                          return {
                            ...p,
                            payment_methods: enabled
                              ? p.payment_methods.filter(x => !esMedioGestionaPay(x))
                              : normalizarMediosTienda([...p.payment_methods, MEDIO_GESTIONA_PAY]),
                          };
                        }
                        return {
                          ...p,
                          payment_methods: enabled
                            ? p.payment_methods.filter(x => x !== pm.id)
                            : [...p.payment_methods, pm.id],
                        };
                      })} className={`w-10 h-5 rounded-full transition-all ${enabled ? "bg-emerald-500" : "bg-muted"}`}>
                        <div className={`w-4 h-4 bg-white rounded-full m-0.5 transition-transform ${enabled ? "translate-x-5" : "translate-x-0"}`} />
                      </button>
                    </div>
                    {/* El descuento sólo se ofrece si el medio está habilitado:
                        configurarlo para uno que no se acepta no haría nada y
                        además se anunciaría mal en la vitrina. */}
                    {enabled && pm.id === MEDIO_GESTIONA_PAY && !signals.paymentConnected && (
                      <p className="text-[11px] text-muted-foreground pl-7">
                        El checkout lo muestra cuando actives Gestiona Pay (OAuth con Mercado Pago). Sin eso el comprador no lo ve.
                      </p>
                    )}
                    {enabled && pm.id === "transferencia" && (
                      <div className="pl-7 space-y-2 pt-1">
                        <p className="text-[11px] text-muted-foreground">
                          Sin CBU ni alias el pedido queda en «te vamos a escribir» y no hay primera venta sola.
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <Label className="text-xs text-muted-foreground">Titular</Label>
                            <Input
                              value={bankForm.bank_holder}
                              onChange={e => setBankForm(p => ({ ...p, bank_holder: e.target.value }))}
                              placeholder="Nombre del titular"
                              className="h-9 mt-1"
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Banco</Label>
                            <Input
                              value={bankForm.bank_name}
                              onChange={e => setBankForm(p => ({ ...p, bank_name: e.target.value }))}
                              placeholder="Banco"
                              className="h-9 mt-1"
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">CBU</Label>
                            <Input
                              value={bankForm.bank_cbu}
                              onChange={e => setBankForm(p => ({ ...p, bank_cbu: e.target.value }))}
                              placeholder="0000003100010000000001"
                              className="h-9 mt-1 font-mono text-xs"
                              inputMode="numeric"
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Alias</Label>
                            <Input
                              value={bankForm.bank_alias}
                              onChange={e => setBankForm(p => ({ ...p, bank_alias: e.target.value }))}
                              placeholder="mi.comercio"
                              className="h-9 mt-1"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                    {enabled && (
                      <div className="flex items-center gap-2 pl-7">
                        <Label className="text-xs text-muted-foreground">Descuento</Label>
                        <Input
                          type="number" min={0} max={MAX_DESCUENTO_PORCENTAJE} step={1}
                          value={pct || ""}
                          placeholder="0"
                          onChange={e => {
                            const v = Math.max(0, Math.min(MAX_DESCUENTO_PORCENTAJE, Number(e.target.value) || 0));
                            setStoreForm(p => {
                              const next = { ...(p.payment_discounts ?? {}) };
                              if (v > 0) next[pm.id] = v; else delete next[pm.id];
                              return { ...p, payment_discounts: next };
                            });
                          }}
                          className="h-8 w-20 text-xs"
                        />
                        <span className="text-xs text-muted-foreground">
                          %{pct > 0 && " — se muestra en la tienda"}
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* La pregunta que el código no puede contestar solo: un "20% off"
                puede ser el precio con transferencia o una liquidación real
                sobre la que el descuento todavía corresponde. Es la misma
                columna con dos significados. */}
            <label className="flex items-start gap-2 mt-4 pt-4 border-t border-border/40 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={storeForm.payment_discount_stacks}
                onChange={e => setStoreForm(f => ({ ...f, payment_discount_stacks: e.target.checked }))}
              />
              <span>
                <span className="text-sm font-medium">
                  El descuento se suma a los productos en oferta
                </span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  {storeForm.payment_discount_stacks
                    ? "Un producto rebajado de $100.000 a $70.000 con 20% de transferencia se cobra $56.000. Usalo si tus ofertas son liquidaciones reales."
                    : "Un producto rebajado de $100.000 a $70.000 con 20% de transferencia se cobra $70.000: la oferta YA es el precio con descuento. Es lo más común y evita descontar dos veces."}
                </span>
                <span className="block text-xs text-muted-foreground mt-1">
                  Se puede cambiar producto por producto desde su ficha.
                </span>
              </span>
            </label>
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
            {/* El toggle avisa en amarillo si falta algo; Guardar es quien
                corta: no se publica una tienda que el comprador no puede
                terminar (canPublish). */}
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

          <Button onClick={() => { void saveStore(); }} disabled={loading} className="gradient-gold text-primary-foreground w-full">
            {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
            Guardar Configuración
          </Button>
          {leadSettingsWithIdentity && (
            <>
              <p className="text-xs text-muted-foreground">
                Gestiona Pay puede esperar: primero guardá nombre y slug arriba.
              </p>
              <PaymentConnectionsPanel onConnectionChange={reloadReadinessSignals} />
            </>
          )}
        </div>
      )}
    </div>
  );
}
