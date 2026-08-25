import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useCallback } from "react";
import { useOrg } from "@/lib/orgContext";
import MercadoLibrePanel from "@/components/integrations/MercadoLibrePanel";
import PaymentConnectionsPanel from "@/components/integrations/PaymentConnectionsPanel";
import { useAuth } from "@/lib/auth";
import TiendanubeExcelImport from "@/components/integrations/TiendanubeExcelImport";
import PlatformServicesPanel from "@/components/integrations/PlatformServicesPanel";
import { supabase } from "@/integrations/supabase/client";
import { safeChannel } from "@/lib/realtimeChannel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  ShoppingBag, RefreshCw, Unplug, CheckCircle2, AlertCircle,
  ExternalLink, Package, ShoppingCart, Loader2, Link2, Zap,
  Eye, EyeOff, Save, Webhook, KeyRound, Copy, RotateCcw,
  History, XCircle, Clock, Activity, WifiOff, ShieldCheck,
  AlertTriangle, Send, MessageCircle, QrCode as QrCodeIcon,
  Code2,
  FileSpreadsheet,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import { usePageTitle } from "@/hooks/usePageTitle";
import AdvancedApiKeysPanel from "@/components/integrations/AdvancedApiKeysPanel";
import AdvancedWebhooksPanel from "@/components/integrations/AdvancedWebhooksPanel";

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




function fmtDate(d: string | null) {
  if (!d) return "Nunca";
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(d));
}

export default function IntegrationsPage() {
  usePageTitle("Integraciones & API");
  const { activeOrg } = useOrg();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") || "conexiones";

  // Mercado Pago settings
  const [mpLoaded, setMpLoaded] = useState(false);

  // MercadoLibre marketplace
  const [mlUserId, setMlUserId] = useState("");


  // API key

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
      const { data: logs } = await supabase
        .from("integration_logs")
        .select("integration, status, message, created_at")
        .eq("org_id", activeOrg.id)
        .order("created_at", { ascending: false })
        .limit(50);

      // Señal de "API pública configurada": keys vivas en la tabla canónica.
      // Antes miraba settings.api_key, columna deprecada el 2026-08-24 que
      // quedó siempre NULL — el panel habría dicho "sin configurar" con keys
      // funcionando, el mismo bug que ya tuvieron las vistas *_status.
      const { count: keysVivas } = await supabase
        .from("api_keys")
        .select("id", { count: "exact", head: true })
        .eq("org_id", activeOrg.id)
        .is("revoked_at", null);
      const tieneApiKey = (keysVivas ?? 0) > 0;

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
        mercadopago: {
          integration: "mercadopago", label: "Mercado Pago",
          icon: <span className="text-blue-400 font-bold text-sm">$</span>,
          // Desde la conexión OAuth, no desde `settings`: con el token pegado
          // fuera de juego, mirar `mp_access_token` daba "Sin configurar"
          // eternamente aunque la cuenta estuviera conectada.
          status: mpConectado ? buildStatus("mercadopago") : "unknown",
          lastSeen: fmtAge(latest.mercadopago?.created_at || null),
          message: latest.mercadopago?.message || null,
          configured: mpConectado,
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
          status: tieneApiKey ? buildStatus("public_api") : "unknown",
          lastSeen: fmtAge(latest.public_api?.created_at || null),
          message: latest.public_api?.message || null,
          configured: tieneApiKey,
        },
      });
    } catch { /* silent — table may not exist yet */ }
    setLoadingHealth(false);
  };

  /**
   * ¿Hay cuenta de MercadoPago conectada?
   *
   * Se lee de `payment_connection_status`, la vista que dice si está conectado
   * y con qué cuenta sin exponer el token. La tabla de abajo tiene RLS con cero
   * policies a propósito: sólo la tocan las Edge Functions.
   */
  const [mpConectado, setMpConectado] = useState(false);

  useEffect(() => {
    if (!activeOrg) return;
    supabase
      .from("payment_connection_status")
      .select("provider, connected")
      .eq("org_id", activeOrg.id)
      .eq("provider", "mercadopago")
      .maybeSingle()
      .then(({ data }) => setMpConectado(!!(data as { connected?: boolean } | null)?.connected),
            () => setMpConectado(false));
  }, [activeOrg]);

  const loadMpSettings = async () => {
    if (!activeOrg) return;
    const { data } = await supabase
      .from("settings")
      .select("webhook_url, webhook_enabled, webhook_events, webhook_secret, ml_user_id")
      .eq("org_id", activeOrg.id)
      .maybeSingle();
    if (data) {
      setWebhookUrl(data.webhook_url || "");
      setWebhookEnabled(!!data.webhook_enabled);
      setWebhookSecret(data.webhook_secret || "");
      if (data.webhook_events) setWebhookEvents(data.webhook_events as string[]);
      setMlUserId(data.ml_user_id || "");
    }
    setMpLoaded(true);
  };

  // La generación de la key EN EL NAVEGADOR se eliminó el 2026-08-24: escribía
  // settings.api_key en texto plano — una tabla que todo miembro lee por RLS —
  // y era uno de tres sistemas de keys desconectados. La emisión vive en el
  // servidor (api_key_emitir) y la maneja el panel de API keys de abajo.

  const handleSaveWebhook = async () => {
    if (!activeOrg) return;
    if (webhookEnabled && !webhookUrl.startsWith("http")) { toast.error("Ingresá una URL válida (http/https)"); return; }
    setSavingWebhook(true);
    const { error } = await supabase.from("settings").upsert({
      org_id: activeOrg.id,
      user_id: user!.id,
      webhook_url: webhookUrl.trim() || null,
      webhook_enabled: webhookEnabled,
      webhook_events: webhookEvents,
      webhook_secret: webhookSecret.trim() || null,
    }, { onConflict: "org_id" });
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
        .from("webhook_deliveries")
        .select("*")
        .eq("org_id", activeOrg.id)
        .order("created_at", { ascending: false })
        .limit(30);
      if (!error) setDeliveries(data || []);
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


  useEffect(() => {
    loadMpSettings();
    loadHealth();
    loadDeliveries(); // load on mount so failed count badge shows immediately
  }, [activeOrg]);

  // Realtime: re-load health whenever a new integration_log is inserted
  useEffect(() => {
    if (!activeOrg) return;
    const ch = safeChannel("integration-logs-rt", activeOrg.id)
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


  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Link2}
        title="Integraciones & API"
        description="Conexiones con servicios externos, claves API y webhooks salientes."
        actions={
          <Button variant="outline" size="sm" className="text-xs" onClick={loadHealth} disabled={loadingHealth}>
            <Activity className={`w-3.5 h-3.5 mr-1.5 ${loadingHealth ? "animate-pulse" : ""}`} />
            Actualizar estado
          </Button>
        }
      />

      <Tabs
        className="workspace-tabs-layout"
        defaultValue={initialTab}
        onValueChange={(v) => {
          const next = new URLSearchParams(searchParams);
          if (v === "conexiones") next.delete("tab"); else next.set("tab", v);
          setSearchParams(next, { replace: true });
        }}
      >
        <TabsList className="workspace-tabs-nav mb-0">
          <TabsTrigger value="conexiones" className="gap-1.5"><Link2 className="w-3.5 h-3.5" />Conexiones</TabsTrigger>
          <TabsTrigger value="apikeys" className="gap-1.5"><KeyRound className="w-3.5 h-3.5" />API Keys</TabsTrigger>
          <TabsTrigger value="webhooks" className="gap-1.5"><Webhook className="w-3.5 h-3.5" />Webhooks</TabsTrigger>
        </TabsList>

        {/* ── CONEXIONES TAB ───────────────────────────────────────── */}
        <TabsContent value="conexiones" className="space-y-6 mt-4">
      {/* ── Platform services (bundled, no config needed) ──────────── */}
      <PlatformServicesPanel />

      {/* ── Medios de cobro ────────────────────────────────────────── */}
      <PaymentConnectionsPanel />

      {/* ── MercadoLibre ───────────────────────────────────────────── */}
      <MercadoLibrePanel />

      {/* ── Your integrations section header ───────────────────────── */}
      <div className="pt-2">
        <div className="flex items-center gap-2 mb-1">
          <Link2 className="w-4 h-4 text-primary" />
          <h2 className="text-base font-semibold">Tus integraciones</h2>
        </div>
        <p className="text-xs text-muted-foreground ml-6">
          Conexiones con servicios externos que requieren <strong className="text-foreground">tu cuenta y credenciales</strong>.
          Cada una es opcional según tu modelo de negocio.
        </p>
      </div>

      {/* ── Health check panel ─────────────────────────────────────── */}
      <div className="bg-card border border-border/60 rounded-[10px] overflow-hidden shadow-card">
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

      {/* Importar desde una planilla de Tiendanube.
          De la integración por API de Tiendanube no queda nada: ninguna
          organización la había conectado, y sostener el OAuth, el webhook y
          dos sincronizadores de una plataforma con la que se compite es
          trabajo que no paga. Esto es otra cosa: lee el Excel que Tiendanube
          le da al comercio, sin API ni credenciales, para que quien se cambia
          traiga su catálogo. */}
      <div className="bg-card border border-border/60 rounded-[10px] overflow-hidden shadow-card">
        <div className="px-5 py-4 border-b border-border flex items-center gap-3">
          <div className="w-10 h-10 rounded-[6px] bg-[#2f6ee4]/10 flex items-center justify-center shrink-0">
            <FileSpreadsheet className="w-5 h-5 text-[#2f6ee4]" />
          </div>
          <div>
            <h2 className="font-semibold">Importar catálogo desde una planilla</h2>
            <p className="text-xs text-muted-foreground">
              Subí el Excel que exportaste de Tiendanube y traé tus productos.
            </p>
          </div>
        </div>
        <div className="px-5 py-4">
          <TiendanubeExcelImport />
        </div>
      </div>

      {/* Twilio WhatsApp */}
      <TwilioSection orgId={activeOrg?.id} />
        </TabsContent>

        {/* ── API KEYS TAB ─────────────────────────────────────────── */}
        <TabsContent value="apikeys" className="space-y-6 mt-4">
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
          <p className="font-medium text-foreground">Endpoints y permiso que exige cada uno:</p>
          {[
            ["GET", "/v1/products", "products:read"],
            ["GET", "/v1/products/:id", "products:read"],
            ["GET", "/v1/stock/:productId", "stock:read"],
            ["PATCH", "/v1/stock/:productId", "stock:write"],
            ["GET", "/v1/sales?limit=50", "sales:read"],
            ["POST", "/v1/sales", "sales:write"],
            ["GET", "/v1/customers", "customers:read"],
          ].map(([metodo, ruta, scope]) => (
            <div key={metodo + ruta} className="flex items-baseline justify-between gap-3">
              <code className="text-xs">{metodo} /functions/v1/public-api{ruta}</code>
              <code className="text-[11px] shrink-0 text-emerald-500">{scope}</code>
            </div>
          ))}
          <p className="text-xs mt-2">Header: <code>Authorization: Bearer &lt;tu_api_key&gt;</code></p>
          <p className="text-xs">
            El costo de cada producto sólo viaja si la key tiene además{" "}
            <code>costs:read</code>.
          </p>
          <p className="text-xs">
            En <code>POST /v1/sales</code>, mandá <code>Idempotency-Key</code>: si
            se corta la red y reintentás, devuelve la misma venta en vez de
            duplicarla.
          </p>
          <p className="text-xs">
            Es una API servidor a servidor: no la llames desde el navegador, ahí
            la key queda a la vista de cualquiera.
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          Las keys se emiten abajo, con permisos acotados. Se muestran una sola
          vez y acá sólo se guarda su huella: ni un empleado con acceso a la
          base puede recuperarlas.
        </p>
      </div>

      {/* API keys con scopes — la única superficie de emisión */}
      <div className="rounded-xl border border-border bg-card p-5">
        <AdvancedApiKeysPanel />
      </div>
        </TabsContent>

        {/* ── WEBHOOKS TAB ─────────────────────────────────────────── */}
        <TabsContent value="webhooks" className="space-y-6 mt-4">
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

        <div className="space-y-2 pb-12">
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

      {/* Advanced per-event webhooks */}
      <div className="rounded-xl border border-border bg-card p-5">
        <AdvancedWebhooksPanel />
      </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Evolution API — WhatsApp propio, gratis, QR scan
// ═══════════════════════════════════════════════════════════════════════════════
function TwilioSection({ orgId }: { orgId: string | undefined }) {
  return <EvolutionSection orgId={orgId} />;
}

type ConnectionState = "open" | "connecting" | "close" | "unknown";

type EvolutionConnectionStatus = {
  configured: boolean;
  instance: string | null;
  updated_at: string;
};

function EvolutionSection({ orgId }: { orgId: string | undefined }) {
  const { session } = useAuth();

  // Las credenciales sólo existen mientras se envían al endpoint seguro. Nunca
  // se hidratan desde la base ni se conservan después de guardar.
  const [apiUrl,   setApiUrl]   = useState("");
  const [apiKey,   setApiKey]   = useState("");
  const [instance, setInstance] = useState("gestiona");
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [connection, setConnection] = useState<EvolutionConnectionStatus | null>(null);

  // Connection state
  const [connState,    setConnState]    = useState<ConnectionState>("unknown");
  const [qrBase64,     setQrBase64]     = useState<string | null>(null);
  const [loadingQR,    setLoadingQR]    = useState(false);
  const [loadingState, setLoadingState] = useState(false);
  const [polling,      setPolling]      = useState(false);

  // La vista devuelve sólo estado e instancia; URL y API key no vuelven nunca
  // al navegador, ni siquiera al administrador que las cargó.
  const loadConnectionStatus = useCallback(async () => {
    if (!orgId) return;
    const { data, error } = await supabase
      .from("evolution_connection_status")
      .select("configured,instance,updated_at")
      .eq("org_id", orgId)
      .maybeSingle();
    if (error) {
      setConnection(null);
      return;
    }
    const next = data as EvolutionConnectionStatus | null;
    setConnection(next);
    if (next?.instance) setInstance(next.instance);
  }, [orgId]);

  useEffect(() => {
    void loadConnectionStatus();
  }, [loadConnectionStatus]);

  // La API key viaja una vez por una Edge Function autenticada y se persiste en
  // una tabla sin policies de navegador. La respuesta sólo confirma el estado.
  const handleSave = async () => {
    if (!orgId || !session) return;
    if (!apiUrl.trim() || !apiKey.trim()) {
      toast.error("Ingresá la URL HTTPS y la API key para guardar la conexión");
      return;
    }
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke("evolution-credentials", {
        body: {
          action: "save",
          orgId,
          apiUrl: apiUrl.trim(),
          apiKey: apiKey.trim(),
          instance: instance.trim() || "gestiona",
        },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) throw error;
      setApiUrl("");
      setApiKey("");
      setConnection({ configured: true, instance: data?.instance || instance.trim() || "gestiona", updated_at: new Date().toISOString() });
      toast.success("Conexión de WhatsApp guardada de forma segura");
    } catch (err: any) {
      toast.error("Error al guardar: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRevokeCredentials = async () => {
    if (!orgId || !session || !confirm("¿Revocar la conexión de Evolution? Se detendrán los envíos hasta configurarla otra vez.")) return;
    setRevoking(true);
    try {
      const { error } = await supabase.functions.invoke("evolution-credentials", {
        body: { action: "revoke", orgId },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) throw error;
      setConnection(null);
      setApiUrl("");
      setApiKey("");
      setInstance("gestiona");
      setConnState("unknown");
      setQrBase64(null);
      setPolling(false);
      toast.success("Conexión revocada");
    } catch (err: any) {
      toast.error("No se pudo revocar: " + (err.message || "reintentá en unos minutos"));
    } finally {
      setRevoking(false);
    }
  };

  // Invoke edge function proxy
  const callEvolution = useCallback(async (action: string) => {
    if (!orgId || !session) return null;
    const { data, error } = await supabase.functions.invoke("evolution-qr", {
      body: { orgId, action },
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (error) throw new Error(error.message);
    return data;
  }, [orgId, session]);

  // Check connection state
  const checkState = useCallback(async () => {
    if (!connection?.configured) return;
    setLoadingState(true);
    try {
      const data = await callEvolution("status");
      const state: ConnectionState = data?.instance?.state || data?.state || "unknown";
      setConnState(state);
      if (state === "open") setQrBase64(null); // connected, no need for QR
    } catch {
      setConnState("unknown");
    } finally {
      setLoadingState(false);
    }
  }, [callEvolution, connection?.configured]);

  // Get QR code
  const getQR = async () => {
    if (!connection?.configured) {
      toast.error("Primero guardá la conexión de Evolution API");
      return;
    }
    setLoadingQR(true);
    setQrBase64(null);
    try {
      // Try connecting directly
      const data = await callEvolution("qr");
      const qr = data?.qrcode?.base64 || data?.base64 || data?.qr;
      if (qr) {
        setQrBase64(qr);
        setConnState("connecting");
        // Start polling for state change
        setPolling(true);
      } else if (data?.instance?.state === "open") {
        setConnState("open");
        toast.success("¡WhatsApp ya está conectado!");
      } else {
        // Maybe instance doesn't exist yet — create it first
        await callEvolution("create");
        const data2 = await callEvolution("qr");
        const qr2 = data2?.qrcode?.base64 || data2?.base64 || data2?.qr;
        if (qr2) {
          setQrBase64(qr2);
          setConnState("connecting");
          setPolling(true);
        } else {
          toast.error("No se pudo obtener el código QR. Verificá la URL y API Key.");
        }
      }
    } catch (err: any) {
      toast.error("Error: " + (err.message || "No se pudo conectar con Evolution API"));
    } finally {
      setLoadingQR(false);
    }
  };

  // Disconnect
  const handleLogout = async () => {
    if (!confirm("¿Desconectar WhatsApp? Tendrás que escanear el QR de nuevo.")) return;
    try {
      await callEvolution("logout");
      setConnState("close");
      setQrBase64(null);
      toast.success("WhatsApp desconectado");
    } catch {
      toast.error("Error al desconectar");
    }
  };

  // Poll state while QR is visible
  useEffect(() => {
    if (!polling) return;
    const id = setInterval(async () => {
      try {
        const data = await callEvolution("status");
        const state: ConnectionState = data?.instance?.state || data?.state || "unknown";
        setConnState(state);
        if (state === "open") {
          setQrBase64(null);
          setPolling(false);
          toast.success("¡WhatsApp conectado exitosamente! 🎉");
        }
      } catch { /* silent */ }
    }, 4000);
    return () => clearInterval(id);
  }, [callEvolution, polling]);

  // Consultar estado sólo cuando una conexión sanitizada confirma que existe.
  useEffect(() => {
    void checkState();
  }, [checkState]);

  const isConfigured = !!connection?.configured;
  const stateColor = {
    open: "bg-emerald-500/20 text-emerald-400 border-emerald-500/40",
    connecting: "bg-amber-500/20 text-amber-400 border-amber-500/40",
    close: "bg-red-500/20 text-red-400 border-red-500/40",
    unknown: "bg-muted/30 text-muted-foreground border-border",
  }[connState];
  const stateLabel = {
    open: "✓ Conectado",
    connecting: "⏳ Conectando…",
    close: "✗ Desconectado",
    unknown: "— Sin verificar",
  }[connState];

  return (
    <div className="rounded-xl border border-green-500/20 bg-card p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-green-500/10">
            <MessageCircle className="w-5 h-5 text-green-400" />
          </div>
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              WhatsApp Masivo · Evolution API
              {isConfigured && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${stateColor}`}>
                  {stateLabel}
                </span>
              )}
            </h3>
            <p className="text-sm text-muted-foreground">
              Gratis, tu propio número, sin aprobación de Meta
            </p>
          </div>
        </div>

        {isConfigured && (
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={checkState} disabled={loadingState} className="gap-1.5 text-xs text-muted-foreground">
              {loadingState ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Estado
            </Button>
            <Button size="sm" variant="ghost" onClick={handleRevokeCredentials} disabled={revoking} className="gap-1.5 text-xs text-destructive hover:text-destructive">
              {revoking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unplug className="w-3.5 h-3.5" />}
              Revocar
            </Button>
          </div>
        )}
      </div>

      {/* Setup guide */}
      <div className="bg-muted/20 border border-border/40 rounded-[8px] p-3 text-xs text-muted-foreground space-y-1.5">
        <p className="font-medium text-foreground text-[11px] uppercase tracking-wider">Cómo configurar</p>
        <p>1. Desplegá Evolution API gratis en{" "}
          <a href="https://railway.app/template/4AkQxo" target="_blank" rel="noreferrer" className="text-primary underline">Railway</a>{" "}
          o{" "}
          <a href="https://render.com" target="_blank" rel="noreferrer" className="text-primary underline">Render</a>.
        </p>
        <p>2. Copiá la URL pública (ej: <code className="bg-muted px-1 rounded">https://mi-evolution.up.railway.app</code>).</p>
        <p>3. La API Key la seteás como variable de entorno <code className="bg-muted px-1 rounded">AUTHENTICATION_API_KEY</code> en el deploy.</p>
        <p>4. Pegá ambas acá, guardá, y hacé clic en <strong className="text-foreground">Conectar WhatsApp</strong> para escanear el QR.</p>
        <p className="text-emerald-400/90">La clave se envía una sola vez al servicio seguro y no vuelve a mostrarse en el navegador.</p>
      </div>

      {/* Config fields */}
      <div className="space-y-3 pb-12">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">URL de Evolution API {isConfigured ? "nueva" : ""}</label>
          <Input
            value={apiUrl}
            onChange={e => setApiUrl(e.target.value)}
            placeholder="https://mi-evolution.up.railway.app"
            className="bg-muted border-border font-mono text-sm"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">API Key (AUTHENTICATION_API_KEY) {isConfigured ? "nueva" : ""}</label>
          <Input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="••••••••••••••••••••••••••••••••"
            autoComplete="new-password"
            className="bg-muted border-border font-mono text-sm"
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Nombre de instancia</label>
          <Input
            value={instance}
            onChange={e => setInstance(e.target.value)}
            placeholder="gestiona"
            className="bg-muted border-border font-mono text-sm"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Nombre identificador de tu conexión WhatsApp. Sin espacios.
          </p>
        </div>

        <Button onClick={handleSave} disabled={saving} className="gradient-gold text-primary-foreground font-semibold gap-1.5 w-full sm:w-auto">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {isConfigured ? "Reemplazar conexión" : "Guardar conexión"}
        </Button>
      </div>

      {/* Connection section */}
      {isConfigured && (
        <div className="border-t border-border/50 pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Conexión WhatsApp</p>
              <p className="text-xs text-muted-foreground">
                {connState === "open"
                  ? "Tu número está conectado y listo para enviar mensajes."
                  : connState === "connecting"
                  ? "Escaneá el QR con WhatsApp de tu teléfono."
                  : "Conectá tu número escaneando el código QR."}
              </p>
            </div>

            {connState === "open" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={handleLogout}
                className="gap-1.5 text-red-400 border-red-500/30 hover:bg-red-500/10 text-xs"
              >
                <XCircle className="w-3.5 h-3.5" />Desconectar
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={getQR}
                disabled={loadingQR}
                className="gap-1.5 bg-green-600 hover:bg-green-700 text-white text-xs"
              >
                {loadingQR ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <QrCodeIcon className="w-3.5 h-3.5" />}
                {loadingQR ? "Generando…" : connState === "connecting" ? "Actualizar QR" : "Conectar WhatsApp"}
              </Button>
            )}
          </div>

          {/* QR Code display */}
          {qrBase64 && (
            <div className="flex flex-col items-center gap-3 bg-white rounded-[12px] p-4">
              <img
                src={qrBase64.startsWith("data:") ? qrBase64 : `data:image/png;base64,${qrBase64}`}
                alt="WhatsApp QR Code"
                className="w-52 h-52 object-contain"
              />
              <p className="text-xs text-slate-600 text-center max-w-[200px]">
                Abrí WhatsApp → Dispositivos vinculados → Vincular dispositivo → escaneá este QR
              </p>
              <p className="text-[10px] text-slate-400 flex items-center gap-1">
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                Esperando escaneo…
              </p>
            </div>
          )}

          {connState === "open" && (
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-[8px] px-3 py-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <div>
                <p className="text-sm font-medium text-emerald-300">WhatsApp listo para enviar</p>
                <p className="text-xs text-muted-foreground">Instancia: <span className="font-mono">{instance}</span></p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
