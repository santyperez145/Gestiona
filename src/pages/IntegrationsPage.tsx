import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useCallback } from "react";
import { useOrg } from "@/lib/orgContext";
import MercadoLibrePanel from "@/components/integrations/MercadoLibrePanel";
import PaymentConnectionsPanel from "@/components/integrations/PaymentConnectionsPanel";
import PlatformServicesPanel from "@/components/integrations/PlatformServicesPanel";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { safeChannel } from "@/lib/realtimeChannel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  ShoppingBag, RefreshCw, Unplug, CheckCircle2, AlertCircle,
  ExternalLink, Package, ShoppingCart, Loader2, Link2,
  Save, Webhook, KeyRound,
  XCircle, Activity, WifiOff, ShieldCheck,
  MessageCircle, QrCode as QrCodeIcon,
  FileSpreadsheet,
} from "lucide-react";
import PageHeader from "@/components/shared/PageHeader";
import { usePageTitle } from "@/hooks/usePageTitle";
import AdvancedApiKeysPanel from "@/components/integrations/AdvancedApiKeysPanel";
import AdvancedWebhooksPanel from "@/components/integrations/AdvancedWebhooksPanel";
import IntegrationsMarketplace from "@/components/integrations/IntegrationsMarketplace";
import { mensajeDeEdgeFunction } from "@/lib/edgeErrors";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";

import { plural } from "@/lib/plural";
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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") || "mercado";

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
        return `Hace ${plural(Math.floor(hrs / 24), "día")}`;
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
      .select("provider, connected:conectado")
      .eq("org_id", activeOrg.id)
      .eq("provider", "mercadopago")
      .maybeSingle()
      .then(({ data }) => setMpConectado(!!(data as { connected?: boolean } | null)?.connected),
            () => setMpConectado(false));
  }, [activeOrg]);

  // La generación de la key EN EL NAVEGADOR se eliminó el 2026-08-24: escribía
  // settings.api_key en texto plano — una tabla que todo miembro lee por RLS —
  // y era uno de tres sistemas de keys desconectados. La emisión vive en el
  // servidor (api_key_emitir) y la maneja el panel de API keys de abajo.

  useEffect(() => {
    loadHealth();
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
        description="Conectá servicios clave para cobrar, vender y automatizar con estado claro en un solo panel."
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
          if (v === "mercado") next.delete("tab"); else next.set("tab", v);
          setSearchParams(next, { replace: true });
        }}
      >
        <TabsList className="workspace-tabs-nav mb-0">
          <TabsTrigger value="mercado" className="gap-1.5"><ShoppingBag className="w-3.5 h-3.5" />Mercado</TabsTrigger>
          <TabsTrigger value="conexiones" className="gap-1.5"><Link2 className="w-3.5 h-3.5" />Conexiones</TabsTrigger>
          <TabsTrigger value="apikeys" className="gap-1.5"><KeyRound className="w-3.5 h-3.5" />API Keys</TabsTrigger>
          <TabsTrigger value="webhooks" className="gap-1.5"><Webhook className="w-3.5 h-3.5" />Webhooks</TabsTrigger>
        </TabsList>

        <TabsContent value="mercado" className="space-y-6 mt-4">
          <IntegrationsMarketplace />
        </TabsContent>

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
          Conexiones externas para potenciar tu operación.
          Activá sólo las que necesite tu negocio.
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
              Todavía no hay actividad para mostrar. Los registros aparecerán con las primeras operaciones.
            </div>
          )}
        </div>
      </div>

      {/* Productos es la única autoridad de migración. Integraciones explica
          el camino y deriva allí; no mantiene un segundo escritor de stock. */}
      <div className="bg-card border border-border/60 rounded-[10px] overflow-hidden shadow-card">
        <div className="px-5 py-4 border-b border-border flex items-center gap-3">
          <div className="w-10 h-10 rounded-[6px] bg-[#2f6ee4]/10 flex items-center justify-center shrink-0">
            <FileSpreadsheet className="w-5 h-5 text-[#2f6ee4]" />
          </div>
          <div>
            <h2 className="font-semibold">Migrar catálogo a Nerqia</h2>
            <p className="text-xs text-muted-foreground">
              Shopify, Tiendanube, Empretienda o una planilla propia, con validación previa.
            </p>
          </div>
        </div>
        <div className="px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-2xl text-sm text-muted-foreground">
              Productos centraliza variantes, imágenes, stock, visibilidad y URLs antiguas para que una reimportación no duplique el catálogo.
            </p>
            <Button className="shrink-0" onClick={() => navigate("/productos?importar=1")}>
              <FileSpreadsheet className="mr-2 h-4 w-4" />Abrir migrador
            </Button>
          </div>
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
            <p className="text-sm text-muted-foreground">Conectá Nerqia con otros sistemas de tu operación</p>
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
          <p className="text-xs mt-2">
            Encabezado de autenticación: <code>Authorization: Bearer &lt;tu clave de API&gt;</code>
          </p>
          <p className="text-xs">
            El costo de cada producto se envía solo si la clave tiene además{" "}
            <code>costs:read</code>.
          </p>
          <p className="text-xs">
            En <code>POST /v1/sales</code>, <code>Idempotency-Key</code> (clave anti-duplicados)
            evita duplicados: si se corta la red y reintentás, devuelve la misma venta
            en vez de crear una nueva.
          </p>
          <p className="text-xs">
            ARS admite 2 decimales, costos USD 4, y el stock representa unidades
            enteras. Cada respuesta autenticada informa el cupo real de la key.
          </p>
          <p className="text-xs">Recomendación: usala desde tu backend para mantener tus claves protegidas.</p>
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
        <TabsContent value="webhooks" className="mt-4">
          <div className="rounded-2xl border border-border bg-card p-4 sm:p-6 shadow-sm">
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
  const { ask, dialog } = useConfirmDialog();

  // Las credenciales sólo existen mientras se envían al endpoint seguro. Nunca
  // se hidratan desde la base ni se conservan después de guardar.
  const [apiUrl,   setApiUrl]   = useState("");
  const [apiKey,   setApiKey]   = useState("");
  const [instance, setInstance] = useState("nerqia");
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
          instance: instance.trim() || "nerqia",
        },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (error) throw error;
      setApiUrl("");
      setApiKey("");
      setConnection({ configured: true, instance: data?.instance || instance.trim() || "nerqia", updated_at: new Date().toISOString() });
      toast.success("Conexión de WhatsApp guardada de forma segura");
    } catch (err: any) {
      toast.error("Error al guardar: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRevokeCredentials = async () => {
    if (!orgId || !session) return;
    if (!(await ask({
      title: "¿Revocar Evolution?",
      description: "Se detendrán los envíos hasta configurarla otra vez.",
      confirmText: "Revocar",
      variant: "destructive",
    }))) return;
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
      setInstance("nerqia");
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
    if (error) throw new Error(await mensajeDeEdgeFunction(error, data));
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
    if (!(await ask({
      title: "¿Desconectar WhatsApp?",
      description: "Tendrás que escanear el QR de nuevo.",
      confirmText: "Desconectar",
      variant: "destructive",
    }))) return;
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
    <>
      {dialog}
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
            placeholder="nerqia"
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
    </>
  );
}
