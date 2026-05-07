import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useOrg } from "@/lib/orgContext";
import TiendanubeExcelImport from "@/components/integrations/TiendanubeExcelImport";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  ShoppingBag, RefreshCw, Unplug, CheckCircle2, AlertCircle,
  ExternalLink, Package, ShoppingCart, Loader2, Link2, Zap,
  Eye, EyeOff, Save, Webhook, KeyRound, Copy, RotateCcw,
  History, XCircle, Clock, Activity, WifiOff, ShieldCheck,
  AlertTriangle, Send,
} from "lucide-react";

// ── Integration health types ──────────────────────────────────────────────────
type IntegrationStatus = "ok" | "error" | "warning" | "unknown";

interface IntegrationHealth {
  integration: string;
  label: string;
  icon: React.ReactNode;
  status: IntegrationStatus;
  lastSeen: string | null;
  message: string | null;
  configured: boolean;
}

function StatusDot({ status }: { status: IntegrationStatus }) {
  const cls = {
    ok: "bg-green-400",
    error: "bg-red-400 animate-pulse",
    warning: "bg-yellow-400",
    unknown: "bg-muted-foreground/30",
  }[status];
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${cls}`} />;
}

const TIENDANUBE_APP_ID = import.meta.env.VITE_TIENDANUBE_APP_ID || "";

type TiendanubeConnection = {
  id: string;
  store_id: string;
  store_name: string;
  store_url: string;
  connected_at: string;
  last_sync_products_at: string | null;
  last_sync_orders_at: string | null;
  sync_products: boolean;
  sync_orders: boolean;
};

function fmtDate(d: string | null) {
  if (!d) return "Nunca";
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
}

export default function IntegrationsPage() {
  const { activeOrg } = useOrg();
  const [searchParams, setSearchParams] = useSearchParams();
  const [conn, setConn] = useState<TiendanubeConnection | null>(null);
  const [loadingConn, setLoadingConn] = useState(true);
  const [syncing, setSyncing] = useState<"products" | "orders" | "all" | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [registeringWebhooks, setRegisteringWebhooks] = useState(false);

  // Mercado Pago settings
  const [mpToken, setMpToken] = useState("");
  const [mpEnabled, setMpEnabled] = useState(false);
  const [mpTokenVisible, setMpTokenVisible] = useState(false);
  const [savingMp, setSavingMp] = useState(false);
  const [mpLoaded, setMpLoaded] = useState(false);

  // API key
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [generatingKey, setGeneratingKey] = useState(false);

  // Outbound webhooks
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEnabled, setWebhookEnabled] = useState(false);
  const [webhookEvents, setWebhookEvents] = useState<string[]>(["sale.created", "stock.low", "debt.overdue"]);
  const [webhookSecret, setWebhookSecret] = useState("");
  const [webhookSecretVisible, setWebhookSecretVisible] = useState(false);
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);

  // Webhook delivery history + dead-letter queue
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [loadingDeliveries, setLoadingDeliveries] = useState(false);
  const [showDeliveries, setShowDeliveries] = useState(false);
  const [retryingDelivery, setRetryingDelivery] = useState<string | null>(null);

  // Integration health
  const [healthMap, setHealthMap] = useState<Record<string, IntegrationHealth>>({});
  const [loadingHealth, setLoadingHealth] = useState(false);

  const loadHealth = async () => {
    if (!activeOrg) return;
    setLoadingHealth(true);
    try {
      // Get latest log per integration in the last 24h
      const { data: logs } = await (supabase as any)
        .from("integration_logs")
        .select("integration, status, message, created_at")
        .eq("org_id", activeOrg.id)
        .order("created_at", { ascending: false })
        .limit(50);

      // Get org settings to know what's configured
      const { data: settings } = await supabase
        .from("settings")
        .select("mp_access_token, mp_enabled, api_key")
        .eq("org_id", activeOrg.id)
        .maybeSingle();

      const logsArr: any[] = logs || [];
      // Deduplicate: keep only the most recent per integration
      const latest: Record<string, any> = {};
      for (const l of logsArr) {
        if (!latest[l.integration]) latest[l.integration] = l;
      }

      const now = Date.now();
      const staleMs = 25 * 60 * 60 * 1000; // 25h — stale if no activity

      const buildStatus = (key: string): IntegrationStatus => {
        const l = latest[key];
        if (!l) return "unknown";
        const age = now - new Date(l.created_at).getTime();
        if (l.status === "error") return "error";
        if (l.status === "warning") return "warning";
        if (age > staleMs) return "warning";
        return "ok";
      };

      const fmtAge = (iso: string | null) => {
        if (!iso) return null;
        const mins = Math.floor((now - new Date(iso).getTime()) / 60_000);
        if (mins < 1) return "Hace un momento";
        if (mins < 60) return `Hace ${mins} min`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `Hace ${hrs}h`;
        return `Hace ${Math.floor(hrs / 24)} días`;
      };

      setHealthMap({
        tiendanube: {
          integration: "tiendanube", label: "Tiendanube",
          icon: <ShoppingBag className="w-4 h-4 text-[#2f6ee4]" />,
          status: conn ? buildStatus("tiendanube") : "unknown",
          lastSeen: fmtAge(latest.tiendanube?.created_at || conn?.last_sync_orders_at || null),
          message: latest.tiendanube?.message || null,
          configured: !!conn,
        },
        mercadopago: {
          integration: "mercadopago", label: "Mercado Pago",
          icon: <span className="text-blue-400 font-bold text-sm">$</span>,
          status: (settings as any)?.mp_enabled && (settings as any)?.mp_access_token
            ? buildStatus("mercadopago")
            : "unknown",
          lastSeen: fmtAge(latest.mercadopago?.created_at || null),
          message: latest.mercadopago?.message || null,
          configured: !!(settings as any)?.mp_enabled && !!(settings as any)?.mp_access_token,
        },
        stripe: {
          integration: "stripe", label: "Stripe",
          icon: <ShieldCheck className="w-4 h-4 text-violet-400" />,
          status: buildStatus("stripe"),
          lastSeen: fmtAge(latest.stripe?.created_at || null),
          message: latest.stripe?.message || null,
          configured: true, // always configured via env
        },
        afip: {
          integration: "afip", label: "AFIP",
          icon: <span className="text-amber-400 font-bold text-xs">AR</span>,
          status: buildStatus("afip"),
          lastSeen: fmtAge(latest.afip?.created_at || null),
          message: latest.afip?.message || null,
          configured: true,
        },
        public_api: {
          integration: "public_api", label: "API Pública",
          icon: <KeyRound className="w-4 h-4 text-emerald-400" />,
          status: (settings as any)?.api_key ? buildStatus("public_api") : "unknown",
          lastSeen: fmtAge(latest.public_api?.created_at || null),
          message: latest.public_api?.message || null,
          configured: !!(settings as any)?.api_key,
        },
      });
    } catch { /* silent — table may not exist yet */ }
    setLoadingHealth(false);
  };

  const loadConnection = async () => {
    if (!activeOrg) return;
    setLoadingConn(true);
    const { data } = await supabase
      .from("tiendanube_connections")
      .select("*")
      .eq("org_id", activeOrg.id)
      .maybeSingle();
    setConn(data as TiendanubeConnection | null);
    setLoadingConn(false);
  };

  const loadMpSettings = async () => {
    if (!activeOrg) return;
    const { data } = await supabase
      .from("settings")
      .select("mp_access_token, mp_enabled, api_key")
      .eq("org_id", activeOrg.id)
      .maybeSingle();
    if (data) {
      setMpToken(data.mp_access_token || "");
      setMpEnabled(!!data.mp_enabled);
      setApiKey((data as any).api_key || null);
      setWebhookUrl((data as any).webhook_url || "");
      setWebhookEnabled(!!(data as any).webhook_enabled);
      setWebhookSecret((data as any).webhook_secret || "");
      if ((data as any).webhook_events) setWebhookEvents((data as any).webhook_events);
    }
    setMpLoaded(true);
  };

  const handleGenerateApiKey = async () => {
    if (!activeOrg) return;
    setGeneratingKey(true);
    try {
      const newKey = "gst_" + Array.from(crypto.getRandomValues(new Uint8Array(24)))
        .map(b => b.toString(16).padStart(2, "0")).join("");
      const { error } = await supabase
        .from("settings")
        .upsert({ org_id: activeOrg.id, api_key: newKey }, { onConflict: "org_id" });
      if (error) throw error;
      setApiKey(newKey);
      setApiKeyVisible(true);
      toast.success("API key generada");
    } catch { toast.error("Error al generar API key"); }
    finally { setGeneratingKey(false); }
  };

  const handleRevokeApiKey = async () => {
    if (!activeOrg || !confirm("¿Revocar la API key? Las integraciones dejarán de funcionar.")) return;
    await supabase.from("settings").update({ api_key: null } as any).eq("org_id", activeOrg.id);
    setApiKey(null);
    toast.success("API key revocada");
  };

  const handleSaveWebhook = async () => {
    if (!activeOrg) return;
    if (webhookEnabled && !webhookUrl.startsWith("http")) { toast.error("Ingresá una URL válida (http/https)"); return; }
    setSavingWebhook(true);
    const { error } = await supabase.from("settings").upsert({
      org_id: activeOrg.id,
      webhook_url: webhookUrl.trim() || null,
      webhook_enabled: webhookEnabled,
      webhook_events: webhookEvents,
      webhook_secret: webhookSecret.trim() || null,
    } as any, { onConflict: "org_id" });
    setSavingWebhook(false);
    if (error) toast.error("Error al guardar webhook");
    else toast.success("Webhook guardado");
  };

  const handleGenerateWebhookSecret = () => {
    const secret = "whsec_" + Array.from(crypto.getRandomValues(new Uint8Array(20)))
      .map(b => b.toString(16).padStart(2, "0")).join("");
    setWebhookSecret(secret);
    setWebhookSecretVisible(true);
  };

  const loadDeliveries = async () => {
    if (!activeOrg) return;
    setLoadingDeliveries(true);
    try {
      const { data, error } = await supabase
        .from("webhook_deliveries" as any)
        .select("*")
        .eq("org_id", activeOrg.id)
        .order("created_at", { ascending: false })
        .limit(30);
      if (!error) setDeliveries((data as any[]) || []);
    } catch {
      // table may not exist yet — silent fail, empty list
    }
    setLoadingDeliveries(false);
  };

  const handleRetryDelivery = async (d: any) => {
    setRetryingDelivery(d.id);
    try {
      const { error } = await supabase.functions.invoke("send-webhook", {
        body: { event: d.event, data: d.payload?.data ?? d.payload ?? {} },
      });
      if (error) throw error;
      toast.success("Reenvío solicitado — revisá el historial en un momento");
      setTimeout(loadDeliveries, 2000); // refresh after edge fn processes
    } catch {
      toast.error("Error al reintentar el envío");
    }
    setRetryingDelivery(null);
  };

  const handleTestWebhook = async () => {
    if (!webhookUrl.startsWith("http")) { toast.error("Configurá la URL primero"); return; }
    setTestingWebhook(true);
    try {
      const { error } = await supabase.functions.invoke("send-webhook", {
        body: { event: "test.ping", data: { message: "Webhook de prueba desde Gestiona", timestamp: new Date().toISOString() } },
      });
      if (error) throw error;
      toast.success("Webhook de prueba enviado — revisá tu endpoint");
    } catch { toast.error("Error al enviar prueba"); }
    finally { setTestingWebhook(false); }
  };

  const handleSaveMp = async () => {
    if (!activeOrg) return;
    setSavingMp(true);
    const { error } = await supabase
      .from("settings")
      .upsert({ org_id: activeOrg.id, mp_access_token: mpToken, mp_enabled: mpEnabled }, { onConflict: "org_id" });
    setSavingMp(false);
    if (error) {
      toast.error("Error al guardar: " + error.message);
    } else {
      toast.success("Configuración de Mercado Pago guardada");
    }
  };

  const handleRegisterWebhooks = async () => {
    if (!activeOrg) return;
    setRegisteringWebhooks(true);
    const { data, error } = await supabase.functions.invoke("tiendanube-register-webhooks", {
      body: { orgId: activeOrg.id },
    });
    setRegisteringWebhooks(false);
    if (error || data?.error) {
      toast.error("Error al registrar webhooks: " + (data?.error || error?.message));
    } else {
      const { registered = [], skipped = [], errors = [] } = data;
      if (errors.length > 0) {
        toast.error(`Errores: ${errors.join(", ")}`);
      } else {
        toast.success(`Webhooks: ${registered.length} registrados, ${skipped.length} ya existían`);
        loadConnection();
      }
    }
  };

  // Handle OAuth callback: code param is present after Tiendanube redirects back
  useEffect(() => {
    const code = searchParams.get("code");
    if (!code || !activeOrg) return;

    setConnecting(true);
    setSearchParams({}, { replace: true }); // clean up URL

    supabase.functions
      .invoke("tiendanube-oauth", { body: { code, orgId: activeOrg.id } })
      .then(({ data, error }) => {
        if (error || !data?.ok) {
          toast.error("Error al conectar: " + (data?.error || error?.message || "Error desconocido"));
        } else {
          toast.success(`Tiendanube conectado: ${data.storeName}`);
          loadConnection();
        }
      })
      .finally(() => setConnecting(false));
  }, [searchParams, activeOrg]);

  useEffect(() => {
    loadConnection();
    loadMpSettings();
    loadHealth();
    loadDeliveries(); // load on mount so failed count badge shows immediately
  }, [activeOrg]);

  // Refresh health after conn loads
  useEffect(() => {
    if (!loadingConn) loadHealth();
  }, [loadingConn]);

  // Realtime: re-load health whenever a new integration_log is inserted
  useEffect(() => {
    if (!activeOrg) return;
    const ch = supabase
      .channel("integration-logs-rt")
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "integration_logs",
        filter: `org_id=eq.${activeOrg.id}`,
      }, () => { loadHealth(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrg]);

  // Auto-refresh health every 60 seconds (background poll)
  useEffect(() => {
    const timer = setInterval(() => { if (activeOrg) loadHealth(); }, 60_000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrg]);

  const handleConnect = () => {
    if (!TIENDANUBE_APP_ID) {
      toast.error("App ID de Tiendanube no configurado. Contactá al equipo de soporte.");
      return;
    }
    const redirectUri = encodeURIComponent(window.location.href.split("?")[0]);
    window.location.href = `https://www.tiendanube.com/apps/${TIENDANUBE_APP_ID}/authorize?redirect_uri=${redirectUri}`;
  };

  const handleSync = async (syncType: "products" | "orders" | "all") => {
    if (!activeOrg) return;
    setSyncing(syncType);
    const { data, error } = await supabase.functions.invoke("tiendanube-sync", {
      body: { orgId: activeOrg.id, syncType },
    });
    setSyncing(null);
    if (error || data?.error) {
      toast.error("Error en la sincronización: " + (data?.error || error?.message));
    } else {
      const msgs = [];
      if (data.productsUpserted > 0) msgs.push(`${data.productsUpserted} productos`);
      if (data.ordersImported > 0) msgs.push(`${data.ordersImported} pedidos`);
      toast.success(msgs.length > 0 ? `Sincronizados: ${msgs.join(", ")}` : "Sincronización completada (sin cambios nuevos)");
      loadConnection();
    }
  };

  const handleDisconnect = async () => {
    if (!conn || !activeOrg) return;
    setDisconnecting(true);
    const { error } = await supabase
      .from("tiendanube_connections")
      .delete()
      .eq("id", conn.id)
      .eq("org_id", activeOrg.id);
    setDisconnecting(false);
    if (error) {
      toast.error("Error al desconectar: " + error.message);
    } else {
      toast.success("Tiendanube desconectado");
      setConn(null);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-display font-bold">Integraciones</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Conectá tu tienda online y sincronizá productos y pedidos automáticamente.
          </p>
        </div>
        <Button variant="ghost" size="sm" className="text-xs shrink-0" onClick={loadHealth} disabled={loadingHealth}>
          <Activity className={`w-3.5 h-3.5 mr-1.5 ${loadingHealth ? "animate-pulse" : ""}`} />
          Estado
        </Button>
      </div>

      {/* ── Health check panel ─────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-card">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            <span className="text-sm font-semibold">Estado de integraciones</span>
          </div>
          {loadingHealth && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-x divide-y sm:divide-y-0 divide-border">
          {Object.values(healthMap).map((h) => (
            <div key={h.integration} className="px-4 py-3 space-y-1.5">
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5">
                  {h.icon}
                  <span className="text-xs font-medium">{h.label}</span>
                </div>
                <StatusDot status={h.status} />
              </div>
              <div>
                {!h.configured ? (
                  <span className="text-[10px] text-muted-foreground/50">Sin configurar</span>
                ) : h.status === "unknown" ? (
                  <span className="text-[10px] text-muted-foreground/50 flex items-center gap-1">
                    <WifiOff className="w-3 h-3" />Sin actividad
                  </span>
                ) : (
                  <span className={`text-[10px] ${h.status === "error" ? "text-red-400" : h.status === "warning" ? "text-yellow-500" : "text-muted-foreground"}`}>
                    {h.status === "error" ? (h.message?.slice(0, 40) || "Error") : (h.lastSeen || "—")}
                  </span>
                )}
              </div>
              {h.status === "error" && h.message && (
                <p className="text-[9px] text-red-400/70 leading-tight line-clamp-2" title={h.message}>
                  {h.message}
                </p>
              )}
            </div>
          ))}
          {Object.keys(healthMap).length === 0 && !loadingHealth && (
            <div className="col-span-5 px-5 py-6 text-center text-xs text-muted-foreground">
              <Activity className="w-6 h-6 mx-auto mb-2 opacity-30" />
              Sin datos de actividad aún — los registros aparecerán después de las primeras operaciones.
            </div>
          )}
        </div>
      </div>

      {/* Tiendanube Card */}
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-card">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#2f6ee4]/10 flex items-center justify-center shrink-0">
              <ShoppingBag className="w-5 h-5 text-[#2f6ee4]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">Tiendanube</h2>
                {conn ? (
                  <Badge className="text-[10px] h-4 px-1.5 bg-success/15 text-success border-success/20">Conectado</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-muted-foreground">Sin conectar</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Sincronizá productos y pedidos de tu tienda online
              </p>
            </div>
          </div>
          {conn ? (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive border-destructive/30 hover:bg-destructive/5 h-8 text-xs"
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unplug className="w-3.5 h-3.5" />}
              <span className="ml-1.5">Desconectar</span>
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-8 text-xs gradient-gold text-primary-foreground shadow-gold"
              onClick={handleConnect}
              disabled={connecting || loadingConn}
            >
              {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
              <span className="ml-1.5">{connecting ? "Conectando…" : "Conectar"}</span>
            </Button>
          )}
        </div>

        {loadingConn ? (
          <div className="px-5 py-8 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : conn ? (
          <div className="px-5 py-4 space-y-4">
            {/* Store info */}
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
              <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{conn.store_name}</p>
                {conn.store_url && (
                  <a
                    href={`https://${conn.store_url}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary flex items-center gap-1 hover:underline mt-0.5"
                  >
                    {conn.store_url} <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                <p className="text-[10px] text-muted-foreground mt-1">
                  Conectado el {fmtDate(conn.connected_at)}
                </p>
              </div>
            </div>

            {/* Sync status */}
            <div className="grid grid-cols-2 gap-3">
              <div className="border border-border rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Package className="w-4 h-4 text-primary" />
                  <span className="text-xs font-medium">Productos</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Última sync: {fmtDate(conn.last_sync_products_at)}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full mt-2 h-7 text-xs"
                  onClick={() => handleSync("products")}
                  disabled={syncing !== null}
                >
                  {syncing === "products" ? (
                    <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                  ) : (
                    <RefreshCw className="w-3 h-3 mr-1.5" />
                  )}
                  Sincronizar
                </Button>
              </div>

              <div className="border border-border rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <ShoppingCart className="w-4 h-4 text-primary" />
                  <span className="text-xs font-medium">Pedidos</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Última sync: {fmtDate(conn.last_sync_orders_at)}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full mt-2 h-7 text-xs"
                  onClick={() => handleSync("orders")}
                  disabled={syncing !== null}
                >
                  {syncing === "orders" ? (
                    <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                  ) : (
                    <RefreshCw className="w-3 h-3 mr-1.5" />
                  )}
                  Sincronizar
                </Button>
              </div>
            </div>

            <Button
              className="w-full h-9 text-sm gradient-gold text-primary-foreground shadow-gold"
              onClick={() => handleSync("all")}
              disabled={syncing !== null}
            >
              {syncing === "all" ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <Zap className="w-4 h-4 mr-2" />
              )}
              {syncing === "all" ? "Sincronizando todo…" : "Sincronizar todo ahora"}
            </Button>

            {/* Webhook registration */}
            <div className="border border-border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium flex items-center gap-1.5">
                    <Webhook className="w-3.5 h-3.5 text-primary" />
                    Webhooks en tiempo real
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Recibí nuevos pedidos y cambios de productos automáticamente.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs shrink-0"
                  onClick={handleRegisterWebhooks}
                  disabled={registeringWebhooks}
                >
                  {registeringWebhooks ? (
                    <Loader2 className="w-3 h-3 animate-spin mr-1" />
                  ) : (
                    <Zap className="w-3 h-3 mr-1" />
                  )}
                  {(conn as any)?.webhook_id ? "Re-registrar" : "Activar"}
                </Button>
              </div>
              {(conn as any)?.webhook_id && (
                <div className="flex items-center gap-1.5 text-[10px] text-success">
                  <CheckCircle2 className="w-3 h-3" />
                  Webhooks activos
                </div>
              )}
            </div>

            {/* Excel import */}
            <TiendanubeExcelImport />
          </div>
        ) : (
          <div className="px-5 py-6 text-center">
            <AlertCircle className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-1">No hay ninguna tienda conectada.</p>
            <p className="text-xs text-muted-foreground/60">
              Conectá tu tienda Tiendanube para importar productos y pedidos automáticamente.
            </p>
          </div>
        )}
      </div>

      {/* Mercado Pago */}
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-card">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
              <span className="text-blue-400 font-bold text-lg">$</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">Mercado Pago</h2>
                {mpEnabled && mpToken ? (
                  <Badge className="text-[10px] h-4 px-1.5 bg-success/15 text-success border-success/20">Activo</Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-muted-foreground">Sin configurar</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Generá links de pago desde el POS y recibí cobros
              </p>
            </div>
          </div>
        </div>

        {mpLoaded && (
          <div className="px-5 py-4 space-y-4">
            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">
                Access Token de producción
              </label>
              <div className="relative">
                <Input
                  type={mpTokenVisible ? "text" : "password"}
                  value={mpToken}
                  onChange={e => setMpToken(e.target.value)}
                  placeholder="APP_USR-..."
                  className="bg-muted border-border pr-10 font-mono text-xs"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setMpTokenVisible(v => !v)}
                >
                  {mpTokenVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Encontralo en{" "}
                <a
                  href="https://www.mercadopago.com.ar/developers/panel/app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Mercado Pago → Developers → Credenciales
                </a>
              </p>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Habilitar Mercado Pago</p>
                <p className="text-[11px] text-muted-foreground">Activa el botón de link de pago en el POS</p>
              </div>
              <Switch checked={mpEnabled} onCheckedChange={setMpEnabled} />
            </div>

            <Button
              className="w-full h-9 text-sm gradient-gold text-primary-foreground shadow-gold"
              onClick={handleSaveMp}
              disabled={savingMp}
            >
              {savingMp ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
              Guardar configuración
            </Button>
          </div>
        )}
      </div>

      {/* API REST pública */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10">
            <KeyRound className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h3 className="font-semibold">API REST Pública</h3>
            <p className="text-sm text-muted-foreground">Integrá Gestiona con cualquier sistema externo</p>
          </div>
        </div>

        <div className="space-y-2 text-sm text-muted-foreground rounded-lg bg-muted/20 p-3">
          <p className="font-medium text-foreground">Endpoints disponibles:</p>
          <code className="block text-xs">GET  /functions/v1/public-api/products</code>
          <code className="block text-xs">GET  /functions/v1/public-api/sales?limit=50</code>
          <code className="block text-xs">POST /functions/v1/public-api/sales</code>
          <code className="block text-xs">PATCH /functions/v1/public-api/stock/:productId</code>
          <code className="block text-xs">GET  /functions/v1/public-api/customers</code>
          <p className="text-xs mt-2">Header: <code>Authorization: Bearer &lt;tu_api_key&gt;</code></p>
        </div>

        {apiKey ? (
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Tu API Key</label>
            <div className="flex gap-2">
              <div className="flex-1 font-mono text-xs bg-muted/30 rounded-lg border border-border px-3 py-2 overflow-hidden">
                {apiKeyVisible ? apiKey : "gst_" + "•".repeat(40)}
              </div>
              <Button variant="ghost" size="sm" onClick={() => setApiKeyVisible(v => !v)}>
                {apiKeyVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { navigator.clipboard.writeText(apiKey); toast.success("Copiado"); }}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <Button variant="outline" size="sm" className="w-full text-destructive hover:text-destructive" onClick={handleRevokeApiKey}>
              <RotateCcw className="w-4 h-4 mr-2" /> Revocar y generar nueva
            </Button>
          </div>
        ) : (
          <Button className="w-full" onClick={handleGenerateApiKey} disabled={generatingKey}>
            {generatingKey ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <KeyRound className="w-4 h-4 mr-2" />}
            Generar API Key
          </Button>
        )}
      </div>

      {/* Outbound Webhooks */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-500/10">
            <Webhook className="w-5 h-5 text-purple-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">Webhooks salientes</h3>
              {deliveries.filter(d => !d.delivered).length > 0 && (
                <Badge className="text-[10px] h-4 px-1.5 bg-red-500/15 text-red-400 border-red-500/20">
                  {deliveries.filter(d => !d.delivered).length} fallidos
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">Notificá Zapier, N8N o Make.com en tiempo real</p>
          </div>
        </div>

        {/* Dead-letter queue alert */}
        {deliveries.filter(d => !d.delivered).length > 0 && (
          <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/5 border border-red-500/20">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-red-400">
                {deliveries.filter(d => !d.delivered).length} entrega{deliveries.filter(d => !d.delivered).length !== 1 ? "s" : ""} fallida{deliveries.filter(d => !d.delivered).length !== 1 ? "s" : ""}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Verificá que tu endpoint responda con HTTP 2xx. Podés reintentar individualmente desde el historial.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 h-7 text-xs border-red-500/30 text-red-400 hover:bg-red-500/10"
              onClick={() => {
                setShowDeliveries(true);
                if (!deliveries.length) loadDeliveries();
              }}
            >
              Ver historial
            </Button>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Activar webhooks</p>
            <p className="text-xs text-muted-foreground">Envía eventos a tu URL cuando ocurren acciones en Gestiona</p>
          </div>
          <Switch checked={webhookEnabled} onCheckedChange={setWebhookEnabled} />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">URL del endpoint</label>
          <Input
            value={webhookUrl}
            onChange={e => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.zapier.com/hooks/catch/..."
            className="bg-muted border-border font-mono text-xs"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Eventos a enviar</label>
          <div className="flex flex-wrap gap-2">
            {["sale.created", "stock.low", "debt.overdue"].map(ev => (
              <button
                key={ev}
                type="button"
                onClick={() => setWebhookEvents(prev =>
                  prev.includes(ev) ? prev.filter(e => e !== ev) : [...prev, ev]
                )}
                className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                  webhookEvents.includes(ev)
                    ? "bg-primary/20 text-primary border-primary/30"
                    : "bg-muted text-muted-foreground border-border"
                }`}
              >
                {ev}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Payload: <code className="text-[10px]">event, org_id, timestamp, delivery_id, data</code>
            {" · "}Firma: <code className="text-[10px]">X-Gestiona-Signature: sha256=...</code>
          </p>
        </div>

        {/* Webhook secret for HMAC verification */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Secret para verificar firma (HMAC-SHA256)</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={webhookSecretVisible ? "text" : "password"}
                value={webhookSecret}
                onChange={e => setWebhookSecret(e.target.value)}
                placeholder="whsec_... (opcional, se usa org_id si está vacío)"
                className="bg-muted border-border pr-10 font-mono text-xs"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setWebhookSecretVisible(v => !v)}
              >
                {webhookSecretVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <Button variant="outline" size="sm" className="shrink-0" onClick={handleGenerateWebhookSecret}>
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            Verificá la firma en tu endpoint: <code>hmac_sha256(secret, request_body) === header['x-gestiona-signature'].replace('sha256=','')</code>
          </p>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleTestWebhook} disabled={testingWebhook || !webhookUrl}>
            {testingWebhook ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Zap className="w-3.5 h-3.5 mr-1" />}
            Enviar prueba
          </Button>
          <Button size="sm" onClick={handleSaveWebhook} disabled={savingWebhook} className="flex-1">
            {savingWebhook ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Save className="w-3.5 h-3.5 mr-1" />}
            Guardar
          </Button>
        </div>

        {/* Webhook delivery history */}
        <div className="border-t border-border pt-3">
          <button
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => {
              const next = !showDeliveries;
              setShowDeliveries(next);
              if (next && deliveries.length === 0) loadDeliveries();
            }}
          >
            <History className="w-3.5 h-3.5" />
            {showDeliveries ? "Ocultar historial" : "Ver historial de entregas"}
            {deliveries.length > 0 && ` (${deliveries.length})`}
            {loadingDeliveries && <Loader2 className="w-3 h-3 animate-spin" />}
          </button>

          {showDeliveries && (
            <div className="mt-3 space-y-1.5 max-h-64 overflow-y-auto">
              {deliveries.length === 0 && !loadingDeliveries && (
                <p className="text-xs text-muted-foreground text-center py-4">Sin entregas registradas aún</p>
              )}
              {deliveries.map(d => (
                <div key={d.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs ${
                  d.delivered
                    ? "bg-green-500/5 border-green-500/20"
                    : "bg-red-500/5 border-red-500/20"
                }`}>
                  {d.delivered
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0" />
                    : <XCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />}
                  <span className="font-mono text-muted-foreground shrink-0">{d.event}</span>
                  <span className="flex-1 text-muted-foreground/60 text-[10px] truncate">
                    {d.last_response_status ? `HTTP ${d.last_response_status}` : "Sin respuesta"}
                    {d.attempt_count > 1 && ` (${d.attempt_count} intentos)`}
                  </span>
                  <span className="text-muted-foreground/50 shrink-0 hidden sm:inline">
                    {new Date(d.created_at).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}
                  </span>
                  {!d.delivered && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5 text-[10px] text-red-400 hover:text-red-300 hover:bg-red-500/10 shrink-0"
                      onClick={() => handleRetryDelivery(d)}
                      disabled={retryingDelivery === d.id}
                      title="Reintentar envío"
                    >
                      {retryingDelivery === d.id
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <Send className="w-3 h-3" />}
                    </Button>
                  )}
                </div>
              ))}
              {deliveries.length > 0 && (
                <Button variant="ghost" size="sm" className="w-full h-7 text-xs" onClick={loadDeliveries} disabled={loadingDeliveries}>
                  <RefreshCw className={`w-3 h-3 mr-1 ${loadingDeliveries ? "animate-spin" : ""}`} />
                  Recargar
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
