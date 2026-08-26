/**
 * MercadoLibrePanel — conexión y sincronización con MercadoLibre.
 *
 * Los tokens viven en `meli_connections`, con RLS y sin policies: nunca llegan
 * al navegador. Este panel lee la vista `meli_connection_status`, que dice si
 * está conectado y con qué cuenta, pero no expone el token.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ShoppingBag, Loader2, RefreshCw, Download, Unlink, AlertTriangle, ExternalLink, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

interface Status {
  nickname: string | null;
  site_id: string;
  conectado: boolean;
  token_vigente: boolean;
  expires_at: string | null;
  last_error: string | null;
  connected_at: string;
}

interface Listing {
  id: string;
  meli_item_id: string;
  permalink: string | null;
  status: string;
  last_synced_at: string | null;
  last_error: string | null;
}

interface MeliOrder {
  id: string;
  meli_order_id: number;
  status: string | null;
  buyer_nickname: string | null;
  total_ars: number | null;
  items: unknown;
  date_created: string | null;
  imported_at: string | null;
  sale_id: string | null;
}

const formatARS = (amount: number | null) => new Intl.NumberFormat("es-AR", {
  style: "currency", currency: "ARS", maximumFractionDigits: 0,
}).format(Number(amount ?? 0));

export default function MercadoLibrePanel() {
  const { activeOrg } = useOrg();
  const [status, setStatus] = useState<Status | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [orders, setOrders] = useState<MeliOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeOrg?.id) { setLoading(false); return; }
    setLoading(true);
    const [sRes, lRes, oRes] = await Promise.all([
      supabase.from("meli_connection_status").select("*").eq("org_id", activeOrg.id).maybeSingle(),
      supabase.from("meli_listings").select("id, meli_item_id, permalink, status, last_synced_at, last_error")
        .eq("org_id", activeOrg.id).order("created_at", { ascending: false }).limit(50),
      supabase.from("meli_orders")
        .select("id, meli_order_id, status, buyer_nickname, total_ars, items, date_created, imported_at, sale_id")
        .eq("org_id", activeOrg.id).order("date_created", { ascending: false }).limit(20),
    ]);
    if (sRes.error || lRes.error || oRes.error) {
      const error = sRes.error ?? lRes.error ?? oRes.error;
      toast.error(`No se pudo cargar MercadoLibre: ${error?.message ?? "error desconocido"}`);
    }
    if (!sRes.error) setStatus((sRes.data as unknown as Status) ?? null);
    if (!lRes.error) setListings((lRes.data ?? []) as Listing[]);
    if (!oRes.error) setOrders((oRes.data ?? []) as MeliOrder[]);
    setLoading(false);
  }, [activeOrg?.id]);

  useEffect(() => { load(); }, [load]);

  // El redirect de MercadoLibre vuelve con ?code=... — se canjea y se limpia la URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code || !activeOrg?.id) return;

    (async () => {
      setBusy("connect");
      const { data, error } = await supabase.functions.invoke("meli-oauth", {
        body: { action: "connect", code, orgId: activeOrg.id },
      });
      setBusy(null);
      if (error || (data as any)?.error) {
        toast.error("No se pudo conectar: " + ((data as any)?.error ?? error?.message));
      } else {
        toast.success(`Conectado a MercadoLibre como ${(data as any)?.nickname ?? "tu cuenta"}`);
      }
      params.delete("code");
      params.delete("state");
      window.history.replaceState({}, "", window.location.pathname + (params.toString() ? `?${params}` : ""));
      load();
    })();
  }, [activeOrg?.id, load]);

  const call = async (action: string, label: string, extra: Record<string, unknown> = {}) => {
    if (!activeOrg?.id) return;
    setBusy(action);
    const { data, error } = await supabase.functions.invoke("meli-sync", {
      body: { action, orgId: activeOrg.id, ...extra },
    });
    setBusy(null);
    const err = (data as any)?.error ?? error?.message;
    if (err) { toast.error(err); return; }
    const d = data as any;
    if (action === "sync-stock") {
      toast.success(`${d.sincronizadas} publicación${d.sincronizadas === 1 ? "" : "es"} actualizada${d.sincronizadas === 1 ? "" : "s"}`);
      if (d.errores?.length) toast.warning(`${d.errores.length} con error — mirá el detalle abajo`);
    } else if (action === "pull-orders") {
      toast.success(`${d.ordenes} orden${d.ordenes === 1 ? "" : "es"} traída${d.ordenes === 1 ? "" : "s"}`);
    } else if (action === "import-order") {
      toast.success(`${d.ventas} venta${d.ventas === 1 ? "" : "s"} de MercadoLibre ingresada${d.ventas === 1 ? "" : "s"} al stock y las finanzas`);
    } else {
      toast.success(label);
    }
    load();
  };

  const disconnect = async () => {
    if (!activeOrg?.id) return;
    if (!confirm("¿Desconectar la cuenta de MercadoLibre? Las publicaciones siguen online, pero dejan de sincronizarse.")) return;
    setBusy("disconnect");
    await supabase.functions.invoke("meli-oauth", { body: { action: "disconnect", orgId: activeOrg.id } });
    setBusy(null);
    toast.success("Cuenta desconectada");
    load();
  };

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Cargando MercadoLibre…
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-xl p-4 md:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-yellow-400/15 flex items-center justify-center shrink-0">
            <ShoppingBag className="w-4 h-4 text-yellow-500" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display font-semibold text-sm">MercadoLibre</h2>
            <p className="text-xs text-muted-foreground">
              {status?.conectado
                ? `Conectado como ${status.nickname ?? "—"} · ${status.site_id}`
                : "Publicá tu catálogo y bajá las órdenes automáticamente"}
            </p>
          </div>
        </div>
        {status?.conectado && (
          <Badge className={status.token_vigente
            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
            : "bg-amber-500/15 text-amber-500 border-amber-500/20"}>
            {status.token_vigente ? "Activa" : "Token vencido"}
          </Badge>
        )}
      </div>

      {/* Los vapers están prohibidos en ML Argentina — mejor decirlo antes. */}
      <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 flex gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">
          MercadoLibre Argentina <strong>no permite vender vapers</strong> — ANMAT
          los tiene prohibidos y publicarlos puede costarte una sanción en la
          cuenta. La integración bloquea esa categoría; el resto del catálogo
          se publica normalmente.
        </p>
      </div>

      {status?.last_error && (
        <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3">
          <p className="text-xs text-destructive">Último error: {status.last_error}</p>
        </div>
      )}

      {!status?.conectado ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Para conectar necesitás crear una aplicación en{" "}
            <a
              href="https://developers.mercadolibre.com.ar/devcenter"
              target="_blank" rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-0.5"
            >
              developers.mercadolibre.com.ar <ExternalLink className="w-3 h-3" />
            </a>{" "}
            y cargar el <code className="text-[10px] bg-muted px-1 py-0.5 rounded">Client ID</code>,{" "}
            <code className="text-[10px] bg-muted px-1 py-0.5 rounded">Client Secret</code> y{" "}
            <code className="text-[10px] bg-muted px-1 py-0.5 rounded">Redirect URI</code> como
            secretos de las Edge Functions. Está explicado en{" "}
            <code className="text-[10px] bg-muted px-1 py-0.5 rounded">docs/MERCADOLIBRE.md</code>.
          </p>
          <Button
            disabled={busy === "connect"}
            onClick={() => {
              const clientId = import.meta.env.VITE_MELI_CLIENT_ID;
              if (!clientId) {
                toast.error("Falta VITE_MELI_CLIENT_ID en el .env — mirá docs/MERCADOLIBRE.md");
                return;
              }
              const redirect = encodeURIComponent(window.location.origin + "/integraciones?tab=conexiones");
              window.location.href =
                `https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=${clientId}&redirect_uri=${redirect}`;
            }}
          >
            {busy === "connect" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ShoppingBag className="w-4 h-4 mr-2" />}
            Conectar con MercadoLibre
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Publicaciones</p>
              <p className="text-lg font-bold">{listings.length}</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Órdenes bajadas</p>
              <p className="text-lg font-bold">{orders.length}</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Con error</p>
              <p className={`text-lg font-bold ${listings.some(l => l.last_error) ? "text-destructive" : ""}`}>
                {listings.filter(l => l.last_error).length}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => call("sync-stock", "Stock sincronizado")}>
              {busy === "sync-stock" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
              Sincronizar stock y precios
            </Button>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => call("pull-orders", "Órdenes traídas")}>
              {busy === "pull-orders" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1.5" />}
              Traer órdenes
            </Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={!!busy} onClick={disconnect}>
              <Unlink className="w-3.5 h-3.5 mr-1.5" />Desconectar
            </Button>
          </div>

          {listings.length > 0 && (
            <div className="rounded-lg border border-border/60 overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Publicación</th>
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground hidden sm:table-cell">Estado</th>
                    <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Última sync</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {listings.map(l => (
                    <tr key={l.id} className="hover:bg-muted/20">
                      <td className="px-3 py-2">
                        {l.permalink ? (
                          <a href={l.permalink} target="_blank" rel="noopener noreferrer"
                             className="text-primary hover:underline inline-flex items-center gap-1">
                            {l.meli_item_id} <ExternalLink className="w-3 h-3" />
                          </a>
                        ) : l.meli_item_id}
                        {l.last_error && <p className="text-[10px] text-destructive mt-0.5">{l.last_error}</p>}
                      </td>
                      <td className="px-3 py-2 hidden sm:table-cell">
                        <span className={l.status === "active" ? "text-emerald-400" : "text-muted-foreground"}>
                          {l.status}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        {l.last_synced_at
                          ? new Date(l.last_synced_at).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {listings.length === 0 && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              Cuenta conectada. Publicá un producto desde su ficha en Productos.
            </p>
          )}

          {orders.length > 0 && (
            <div className="space-y-2">
              <div>
                <h3 className="text-xs font-semibold">Órdenes descargadas</h3>
                <p className="text-[11px] text-muted-foreground">
                  Sólo una orden cobrada entra como venta: usa el precio y la comisión que informó MercadoLibre,
                  descuenta el stock una vez y no se puede importar dos veces.
                </p>
              </div>
              <div className="rounded-lg border border-border/60 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Orden</th>
                      <th className="text-left px-3 py-2 font-semibold text-muted-foreground hidden sm:table-cell">Comprador</th>
                      <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Total</th>
                      <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {orders.map(order => {
                      const isPaid = order.status === "paid";
                      const isImported = !!order.imported_at;
                      const itemCount = Array.isArray(order.items) ? order.items.length : 0;
                      return (
                        <tr key={order.id} className="hover:bg-muted/20">
                          <td className="px-3 py-2">
                            <p className="font-medium">#{order.meli_order_id}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {order.status ?? "sin estado"} · {itemCount} {itemCount === 1 ? "producto" : "productos"}
                            </p>
                          </td>
                          <td className="px-3 py-2 hidden sm:table-cell text-muted-foreground">
                            {order.buyer_nickname ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-right font-medium">{formatARS(order.total_ars)}</td>
                          <td className="px-3 py-2 text-right">
                            {isImported ? (
                              <span className="inline-flex items-center gap-1 text-emerald-400">
                                <CheckCircle2 className="w-3.5 h-3.5" /> Importada
                              </span>
                            ) : isPaid ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!!busy}
                                onClick={() => call("import-order", "", { meliOrderId: order.id })}
                              >
                                {busy === "import-order"
                                  ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                  : <Download className="w-3.5 h-3.5 mr-1.5" />}
                                Importar venta
                              </Button>
                            ) : (
                              <span className="text-muted-foreground">Esperando cobro</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
