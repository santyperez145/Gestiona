/**
 * PaymentConnectionsPanel — medios de cobro del comercio.
 *
 * Antes había que entrar al panel de desarrolladores de MercadoPago, generar
 * un Access Token y pegarlo acá. Ahora es un clic: la plataforma tiene UNA
 * aplicación registrada y cada comercio autoriza su cuenta, igual que en
 * Tiendanube.
 *
 * Los tokens viven en `payment_connections`, con RLS y sin policies: nunca
 * llegan al navegador. Este panel lee la vista `payment_connection_status`.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CreditCard, Loader2, Unlink, RefreshCw, CheckCircle2, AlertTriangle, ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { mensajeDeEdgeFunction } from "@/lib/edgeErrors";

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

export default function PaymentConnectionsPanel() {
  const { activeOrg } = useOrg();
  const [mp, setMp] = useState<Estado | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeOrg?.id) { setLoading(false); return; }
    setLoading(true);
    const [cRes, sRes] = await Promise.all([
      supabase.from("payment_connection_status").select("*")
        .eq("org_id", activeOrg.id).eq("provider", "mercadopago").maybeSingle(),
      supabase.from("settings").select("mp_access_token, mp_enabled")
        .eq("org_id", activeOrg.id).maybeSingle(),
    ]);
    setMp((cRes.data as unknown as Estado) ?? null);
    setLegacy(!!(sRes.data?.mp_enabled && sRes.data?.mp_access_token));
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
      if (err) toast.error("No se pudo conectar: " + err);
      else toast.success(`Cuenta de MercadoPago conectada${(data as any)?.nickname ? ` (${(data as any).nickname})` : ""}`);

      params.delete("code"); params.delete("state");
      window.history.replaceState({}, "", window.location.pathname + (params.toString() ? `?${params}` : ""));
      load();
    })();
  }, [activeOrg?.id, load]);

  const conectar = async () => {
    if (!activeOrg?.id) return;
    setBusy("start");
    const { data, error } = await supabase.functions.invoke("mp-connect", {
      body: { action: "start", orgId: activeOrg.id, returnUrl: window.location.href },
    });
    setBusy(null);
    const url = (data as any)?.url;
    if (url) { window.location.href = url; return; }
    toast.error(await mensajeDeEdgeFunction(error, data) || "No se pudo iniciar la conexión");
  };

  const accion = async (action: string, ok: string) => {
    if (!activeOrg?.id) return;
    if (action === "disconnect" && !confirm("¿Desconectar MercadoPago? Los cobros online dejan de funcionar.")) return;
    setBusy(action);
    const { data, error } = await supabase.functions.invoke("mp-connect", {
      body: { action, orgId: activeOrg.id },
    });
    setBusy(null);
    const err = await mensajeDeEdgeFunction(error, data);
    if (err) toast.error(err); else toast.success(ok);
    load();
  };

  if (loading) {
    return (
      <div className="bg-card border border-border rounded-xl p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Cargando medios de cobro…
      </div>
    );
  }

  const conectado = !!mp?.conectado;

  return (
    <div className="bg-card border border-border rounded-xl p-4 md:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-sky-500/15 flex items-center justify-center shrink-0">
            <CreditCard className="w-4 h-4 text-sky-500" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display font-semibold text-sm">Cobros con MercadoPago</h2>
            <p className="text-xs text-muted-foreground">
              {conectado
                ? `Cuenta ${mp?.nickname ?? mp?.email ?? "vinculada"}`
                : "Conectá tu cuenta para cobrar online en la tienda"}
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

      {/* Aviso a quien todavía tiene el token pegado a mano */}
      {!conectado && legacy && (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 flex gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            Estás usando un Access Token cargado a mano. Sigue funcionando, pero
            conviene conectar la cuenta: se renueva sola, no vence sin aviso y no
            queda un secreto guardado en la configuración.
          </p>
        </div>
      )}

      {!conectado ? (
        <div className="space-y-2">
          <Button onClick={conectar} disabled={busy === "start"} className="gap-2">
            {busy === "start" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
            Conectar con MercadoPago
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Te lleva a MercadoPago para que autorices el cobro en tu nombre. No
            vemos tu usuario ni tu contraseña, y podés revocar el permiso desde
            tu cuenta cuando quieras.
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
    </div>
  );
}
