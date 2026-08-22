import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Clock3, RefreshCw, Shield, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { isMissingRelation } from "@/lib/publicDataSource";
import {
  approveSupportDiagnosticAccess,
  listOrganizationSupportDiagnosticRequests,
  revokeSupportDiagnosticAccess,
  SUPPORT_DIAGNOSTIC_REASONS,
  type OrganizationSupportDiagnosticRequest,
} from "@/lib/supportDiagnosticAccess";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

type HistoricalSupportAccess = {
  id: string;
  created_at: string;
  staff_email: string | null;
  event: string;
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Esperando tu decisión",
  active: "Diagnóstico autorizado",
  expired: "Venció",
  revoked: "Revocado",
};

const REASON_LABELS = Object.fromEntries(SUPPORT_DIAGNOSTIC_REASONS.map(reason => [reason.value, reason.label]));

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Sólo owner ve y decide el consentimiento temporal de soporte. */
export function SupportAccessAuditSection() {
  const { activeOrg, activeRole } = useOrg();
  const [historicalEntries, setHistoricalEntries] = useState<HistoricalSupportAccess[]>([]);
  const [requests, setRequests] = useState<OrganizationSupportDiagnosticRequest[]>([]);
  const [durations, setDurations] = useState<Record<string, 15 | 30 | 60>>({});
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [errorMessageText, setErrorMessageText] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeOrg || activeRole !== "owner") return;
    setLoading(true);
    setErrorMessageText(null);

    const [historyResult, requestsResult] = await Promise.allSettled([
      supabase
        .from("organization_support_accesses")
        .select("id, created_at, staff_email, event")
        .eq("org_id", activeOrg.id)
        .order("created_at", { ascending: false })
        .limit(50),
      listOrganizationSupportDiagnosticRequests(activeOrg.id),
    ]);

    const errors: string[] = [];
    if (historyResult.status === "fulfilled" && !historyResult.value.error) {
      setHistoricalEntries((historyResult.value.data ?? []) as HistoricalSupportAccess[]);
    } else {
      const error = historyResult.status === "fulfilled" ? historyResult.value.error : historyResult.reason;
      setHistoricalEntries([]);
      if (!isMissingRelation(error)) errors.push("No se pudo leer el historial anterior de soporte.");
    }
    if (requestsResult.status === "fulfilled") {
      setRequests(requestsResult.value);
    } else {
      setRequests([]);
      errors.push("No se pudieron leer las autorizaciones de diagnóstico.");
    }
    setErrorMessageText(errors.length ? errors.join(" ") : null);
    setLoading(false);
  }, [activeOrg, activeRole]);

  useEffect(() => { void load(); }, [load]);

  if (!activeOrg || activeRole !== "owner") return null;

  const approve = async (requestId: string) => {
    setActionId(requestId);
    try {
      await approveSupportDiagnosticAccess(requestId, durations[requestId] || 30);
      toast.success("Diagnóstico temporal autorizado");
      await load();
    } catch (error) {
      toast.error(errorMessage(error, "No se pudo autorizar el diagnóstico"));
    } finally {
      setActionId(null);
    }
  };

  const revoke = async (requestId: string) => {
    setActionId(requestId);
    try {
      await revokeSupportDiagnosticAccess(requestId);
      toast.success("Acceso de diagnóstico revocado");
      await load();
    } catch (error) {
      toast.error(errorMessage(error, "No se pudo revocar el diagnóstico"));
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="settings-panel settings-panel--system bg-card border border-border/60 rounded-[10px] p-4 md:p-6">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
            <Shield className="w-4 h-4 text-primary" />Acceso de soporte
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Sólo el dueño puede autorizar un diagnóstico agregado y temporal. Soporte no inicia sesión como integrantes del negocio.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
          Actualizar
        </Button>
      </div>

      <p className="text-[11px] text-muted-foreground border-l-2 border-primary/40 pl-2 mb-4">
        El diagnóstico muestra hitos, calidad del catálogo, precisión de stock, cola de eventos e integraciones sin clientes, órdenes, montos, credenciales ni errores crudos. Podés rechazar o revocar en cualquier momento.
      </p>

      {errorMessageText && <p className="mb-3 text-xs text-destructive">{errorMessageText}</p>}

      <div className="space-y-2">
        {loading && requests.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">Cargando autorizaciones…</p>
        ) : requests.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">No hay solicitudes de diagnóstico.</p>
        ) : requests.map(request => {
          if (!request.id) return null;
          const status = request.status || "pending";
          return (
            <article key={request.id} className="rounded-lg border border-border/50 bg-muted/20 px-3 py-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    {status === "active" ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : status === "pending" ? <Clock3 className="h-3.5 w-3.5 text-amber-400" /> : <XCircle className="h-3.5 w-3.5 text-muted-foreground" />}
                    {STATUS_LABELS[status] || status}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {REASON_LABELS[request.reason_code || ""] || request.reason_code} · {request.staff_email || "Staff de Gestiona"} · solicitada {request.requested_at ? new Date(request.requested_at).toLocaleString("es-AR") : "sin fecha"}
                  </p>
                  {request.expires_at && <p className="mt-0.5 text-[10px] text-muted-foreground">Vence {new Date(request.expires_at).toLocaleString("es-AR")} · {request.view_count || 0} lecturas</p>}
                </div>
                {status === "pending" ? (
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Select value={String(durations[request.id] || 30)} onValueChange={value => setDurations(current => ({ ...current, [request.id!]: Number(value) as 15 | 30 | 60 }))}>
                      <SelectTrigger className="h-8 w-[110px] bg-background text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="15">15 minutos</SelectItem>
                        <SelectItem value="30">30 minutos</SelectItem>
                        <SelectItem value="60">60 minutos</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" className="h-8 text-xs" onClick={() => approve(request.id!)} disabled={actionId === request.id}>Autorizar</Button>
                    <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => revoke(request.id!)} disabled={actionId === request.id}>Rechazar</Button>
                  </div>
                ) : status === "active" ? (
                  <Button size="sm" variant="outline" className="h-8 shrink-0 text-xs" onClick={() => revoke(request.id!)} disabled={actionId === request.id}>Revocar ahora</Button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {historicalEntries.length > 0 && (
        <details className="mt-4 border-t border-border/50 pt-3">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Historial anterior de enlaces retirados ({historicalEntries.length})</summary>
          <div className="mt-2 space-y-2 max-h-[220px] overflow-y-auto">
            {historicalEntries.map(entry => (
              <div key={entry.id} className="rounded-lg border border-border/40 bg-muted/15 px-3 py-2">
                <p className="text-xs font-medium">Se generó un enlace de acceso (mecanismo retirado)</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{new Date(entry.created_at).toLocaleString("es-AR")}{entry.staff_email ? ` · ${entry.staff_email}` : " · Staff de plataforma"}</p>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
