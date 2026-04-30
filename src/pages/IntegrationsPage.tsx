import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useOrg } from "@/lib/orgContext";
import TiendanubeExcelImport from "@/components/integrations/TiendanubeExcelImport";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  ShoppingBag, RefreshCw, Unplug, CheckCircle2, AlertCircle,
  ExternalLink, Package, ShoppingCart, Loader2, Link2, Zap,
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

      {/* Mercado Pago — coming soon */}
      <div className="bg-card border border-border rounded-xl overflow-hidden shadow-card opacity-60">
        <div className="px-5 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
              <span className="text-blue-400 font-bold text-lg">$</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-semibold">Mercado Pago</h2>
                <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-muted-foreground">Próximamente</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Generá links de pago y reconciliá cobros automáticamente
              </p>
            </div>
          </div>
          <Button size="sm" disabled className="h-8 text-xs">
            <Link2 className="w-3.5 h-3.5 mr-1.5" />
            Conectar
          </Button>
        </div>
      </div>
    </div>
  );
}
