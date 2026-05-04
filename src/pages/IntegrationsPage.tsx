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
} from "lucide-react";

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
  const [savingWebhook, setSavingWebhook] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);

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
    } as any, { onConflict: "org_id" });
    setSavingWebhook(false);
    if (error) toast.error("Error al guardar webhook");
    else toast.success("Webhook guardado");
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
      <div>
        <h1 className="text-2xl font-display font-bold">Integraciones</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Conectá tu tienda online y sincronizá productos y pedidos automáticamente.
        </p>
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
          <div>
            <h3 className="font-semibold">Webhooks salientes</h3>
            <p className="text-sm text-muted-foreground">Notificá Zapier, N8N o Make.com en tiempo real</p>
          </div>
        </div>

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
          <p className="text-xs text-muted-foreground">El cuerpo del payload incluye: event, org_id, timestamp, data</p>
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
      </div>
    </div>
  );
}
