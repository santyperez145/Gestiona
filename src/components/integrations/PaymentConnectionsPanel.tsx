/**
 * PaymentConnectionsPanel — Gestiona Pay + catálogo OAuth.
 *
 * Modelo Pago Nube / Tiendanube: el producto propio se activa con un clic;
 * el resto de medios aparecen en el catálogo con estado honesto
 * (Disponible / Próximamente). Un «declarado» no tiene botón Conectar.
 *
 * Los tokens viven en `payment_connections` (RLS, cero policies). El panel
 * lee `payment_connection_status` y `medios_de_pago_de`.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CreditCard, Loader2, Unlink, RefreshCw, CheckCircle2, ExternalLink, Clock,
} from "lucide-react";
import { toast } from "sonner";
import { mensajeDeEdgeFunction } from "@/lib/edgeErrors";
import { destinoOAuthPermitido } from "@/lib/gestionaPay";
import {
  etiquetaEstadoMedio,
  mediosOAuthDelCatalogo,
  puedeConectarMedioCatalogo,
  type MedioCatalogo,
} from "@/lib/paymentCatalog";
import GestionaPayComisiones from "@/components/integrations/GestionaPayComisiones";
import { useConfirmDialog } from "@/hooks/useConfirmDialog";

interface Estado {
  provider: string;
  nickname: string | null;
  email: string | null;
  live_mode: boolean;
  conectado: boolean;
  vigente: boolean;
  expires_at: string | null;
  last_error: string | null;
}

export default function PaymentConnectionsPanel({
  onConnectionChange,
}: {
  /** Para que el checklist de Commerce no diga «sin Pay» con la cuenta ya vinculada. */
  onConnectionChange?: () => void;
} = {}) {
  const { activeOrg } = useOrg();
  const { ask, dialog } = useConfirmDialog();
  const [mp, setMp] = useState<Estado | null>(null);
  const [catalogo, setCatalogo] = useState<MedioCatalogo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeOrg?.id) { setLoading(false); return; }
    setLoading(true);
    const [cRes, catRes] = await Promise.all([
      supabase.from("payment_connection_status").select("*")
        .eq("org_id", activeOrg.id).eq("provider", "mercadopago").maybeSingle(),
      supabase.rpc("medios_de_pago_de", { p_org: activeOrg.id }),
    ]);
    if (cRes.error) console.error("PaymentConnectionsPanel status:", cRes.error);
    if (catRes.error) console.error("PaymentConnectionsPanel catálogo:", catRes.error);
    setMp((cRes.data as unknown as Estado) ?? null);
    setCatalogo((catRes.data as MedioCatalogo[] | null) ?? []);
    setLoading(false);
  }, [activeOrg?.id]);

  useEffect(() => { load(); }, [load]);

  // Al volver del consentimiento, MercadoPago manda ?code=...&state=...
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state || !activeOrg?.id) return;

    (async () => {
      setBusy("callback");
      const { data, error } = await supabase.functions.invoke("mp-connect", {
        body: { action: "callback", orgId: activeOrg.id, code, state },
      });
      setBusy(null);
      const err = await mensajeDeEdgeFunction(error, data);
      params.delete("code"); params.delete("state");
      window.history.replaceState({}, "", window.location.pathname + (params.toString() ? `?${params}` : ""));
      if (err) {
        toast.error("No se pudo conectar: " + err);
        load();
        return;
      }
      toast.success(`Gestiona Pay activo${(data as { nickname?: string })?.nickname ? ` (${(data as { nickname?: string }).nickname})` : ""}`);
      const destino = destinoOAuthPermitido(
        (data as { redirect_to?: string | null })?.redirect_to,
        window.location.origin,
      );
      if (destino && destino !== `${window.location.pathname}${window.location.search}`) {
        window.location.assign(destino);
        return;
      }
      await load();
      onConnectionChange?.();
    })();
  }, [activeOrg?.id, load, onConnectionChange]);

  const conectar = async () => {
    if (!activeOrg?.id) return;
    setBusy("start");
    const { data, error } = await supabase.functions.invoke("mp-connect", {
      body: { action: "start", orgId: activeOrg.id, returnUrl: window.location.href.split("#")[0] },
    });
    setBusy(null);
    const url = (data as { url?: string } | null)?.url;
    if (url) { window.location.href = url; return; }
    toast.error(await mensajeDeEdgeFunction(error, data) || "No se pudo iniciar la conexión");
  };

  const accion = async (action: string, ok: string) => {
    if (!activeOrg?.id) return;
    if (action === "disconnect" && !(await ask({
      title: "¿Desconectar Gestiona Pay?",
      description: "Los cobros online dejan de funcionar hasta que vuelvas a conectar la cuenta.",
      confirmText: "Desconectar",
      variant: "destructive",
    }))) return;
    setBusy(action);
    const { data, error } = await supabase.functions.invoke("mp-connect", {
      body: { action, orgId: activeOrg.id },
    });
    setBusy(null);
    const err = await mensajeDeEdgeFunction(error, data);
    if (err) toast.error(err); else toast.success(ok);
    await load();
    onConnectionChange?.();
  };

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Cargando medios de cobro…
      </div>
    );
  }

  const conectado = !!mp?.conectado;
  const oauthExternos = mediosOAuthDelCatalogo(catalogo);

  return (
    <>
      {dialog}
    <div className="space-y-4">
    <div className="bg-card border border-border rounded-xl p-4 md:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-sky-500/15 flex items-center justify-center shrink-0">
            <CreditCard className="w-4 h-4 text-sky-500" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display font-semibold text-sm">Gestiona Pay</h2>
            <p className="text-xs text-muted-foreground">
              {conectado
                ? `Rail Mercado Pago · ${mp?.nickname ?? mp?.email ?? "cuenta vinculada"}`
                : "Activá el cobro de la tienda, el POS QR y la comisión de plataforma. No se pegan claves."}
            </p>
          </div>
        </div>
        {conectado && (
          <div className="flex items-center gap-1.5">
            {!mp?.live_mode && (
              <Badge className="bg-amber-500/15 text-amber-500 border-amber-500/20">Modo prueba</Badge>
            )}
            <Badge className={mp?.vigente
              ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/20"
              : "bg-destructive/15 text-destructive border-destructive/20"}>
              {mp?.vigente ? "Activa" : "Vencida"}
            </Badge>
          </div>
        )}
      </div>

      {mp?.last_error && (
        <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3">
          <p className="text-xs text-destructive">Último error: {mp.last_error}</p>
        </div>
      )}

      {!conectado ? (
        <div className="space-y-2">
          <Button onClick={conectar} disabled={busy === "start"} className="gap-2 min-h-11">
            {busy === "start" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
            Activar Gestiona Pay
          </Button>
          <p className="text-[11px] text-muted-foreground">
            En Argentina el procesador es Mercado Pago: autorizás tu cuenta y el
            dinero entra ahí. Gestiona orquesta el checkout, la conciliación y la
            comisión. No es un medio aparte.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Cuenta</p>
              <p className="text-sm font-medium truncate">{mp?.nickname ?? "—"}</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Modo</p>
              <p className="text-sm font-medium">{mp?.live_mode ? "Producción" : "Prueba"}</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Vence</p>
              <p className="text-sm font-medium">
                {mp?.expires_at
                  ? new Date(mp.expires_at).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" })
                  : "—"}
              </p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            El token se renueva solo antes de vencer. No tenés que hacer nada.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!!busy}
              onClick={() => accion("refresh", "Token renovado")}>
              {busy === "refresh" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
              Renovar ahora
            </Button>
            <a
              href="https://www.mercadopago.com.ar/settings/account/security"
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-3 py-2"
            >
              Ver permisos en MercadoPago <ExternalLink className="w-3 h-3" />
            </a>
            <Button size="sm" variant="ghost" className="text-muted-foreground ml-auto"
              disabled={!!busy} onClick={() => accion("disconnect", "Cuenta desconectada")}>
              <Unlink className="w-3.5 h-3.5 mr-1.5" />Desconectar
            </Button>
          </div>
        </>
      )}

      <GestionaPayComisiones orgId={activeOrg?.id} planId={activeOrg?.plan_id} />
    </div>

    {oauthExternos.length > 0 && (
      <div className="bg-card border border-border rounded-xl p-4 md:p-6 space-y-3">
        <div>
          <h3 className="font-display font-semibold text-sm">Más medios de cobro</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Como en Tiendanube: se conectan por OAuth cuando el contrato esté.
            Transferencia y efectivo se configuran arriba en Métodos de cobro.
          </p>
        </div>
        <ul className="divide-y divide-border/60 rounded-lg border border-border/50 overflow-hidden">
          {oauthExternos.map((m) => {
            const estado = etiquetaEstadoMedio(m.integracion);
            const conectarVisible = puedeConectarMedioCatalogo(m);
            return (
              <li key={m.provider} className="flex items-start justify-between gap-3 p-3 bg-muted/10">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{m.nombre}</span>
                    <Badge
                      variant="outline"
                      className={
                        estado.tone === "live"
                          ? "border-emerald-500/30 text-emerald-600"
                          : estado.tone === "beta"
                            ? "border-amber-500/30 text-amber-600"
                            : "border-border text-muted-foreground"
                      }
                    >
                      {estado.tone === "soon" && <Clock className="w-3 h-3 mr-1" />}
                      {estado.label}
                    </Badge>
                  </div>
                  {m.descripcion && (
                    <p className="text-[11px] text-muted-foreground mt-1">{m.descripcion}</p>
                  )}
                </div>
                {conectarVisible ? (
                  <Button size="sm" className="min-h-11 shrink-0" disabled>
                    Conectar
                  </Button>
                ) : (
                  <span className="text-[11px] text-muted-foreground shrink-0 pt-1">Sin adapter aún</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    )}
    </div>
    </>
  );
}
