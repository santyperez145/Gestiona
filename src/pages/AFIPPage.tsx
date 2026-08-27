import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import PageHeader from "@/components/shared/PageHeader";
import ConectarAfip, { type MotivoAfip } from "@/components/afip/ConectarAfip";
import AfipConfigForm from "@/components/afip/AfipConfigForm";
import KPICard from "@/components/shared/KPICard";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  RefreshCw,
  Settings,
  Shield,
  XCircle,
} from "lucide-react";

interface AfipConnectionStatus {
  cuit: string | null;
  configured: boolean | null;
  environment: string | null;
  punto_venta: number | null;
  razon_social: string | null;
  ta_expires_at: string | null;
  ticket_vigente: boolean | null;
  /** C14: 'delegado' factura con el certificado de la plataforma. */
  modo: string | null;
  plataforma_lista: boolean | null;
  /** C14b: el CUIT al que hay que delegar. No es secreto. */
  plataforma_cuit: string | null;
  plataforma_razon_social: string | null;
  /** Por qué no puede emitir, para no mandar al comercio a un trámite ajeno. */
  motivo: MotivoAfip | null;
  delegacion_verificada: boolean | null;
}

interface FiscalInvoice {
  id: string;
  number: string;
  customer_name: string;
  issue_date: string;
  total: number;
  cae: string | null;
  cae_vencimiento: string | null;
  afip_status: string | null;
  afip_error: string | null;
  numero_afip: number | null;
  tipo_comprobante: number | null;
}

const TIPO_COMPROBANTE: Record<number, string> = {
  1: "Factura A",
  6: "Factura B",
  11: "Factura C",
};

const ERROR_STATES = new Set(["rejected", "error", "config_error", "network_error", "validation_error"]);

function formatARS(value: number) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString("es-AR") : "—";
}

function invoiceStatus(invoice: FiscalInvoice) {
  if (invoice.cae && invoice.afip_status === "authorized") {
    return { label: "CAE autorizado", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20" };
  }
  if (ERROR_STATES.has(invoice.afip_status || "")) {
    return { label: "Requiere atención", className: "bg-red-500/15 text-red-400 border-red-500/20" };
  }
  return { label: "Pendiente de autorizar", className: "bg-amber-500/15 text-amber-400 border-amber-500/20" };
}

export default function AFIPPage() {
  usePageTitle("AFIP / Facturación electrónica");
  const { orgId } = useOrganization();
  const [connection, setConnection] = useState<AfipConnectionStatus | null>(null);
  const [invoices, setInvoices] = useState<FiscalInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [invoicesError, setInvoicesError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) {
      setConnection(null);
      setInvoices([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setConnectionError(null);
    setInvoicesError(null);
    const [connectionResult, invoicesResult] = await Promise.all([
      supabase
        .from("afip_connection_status")
        .select("cuit, configured, environment, punto_venta, razon_social, ta_expires_at, ticket_vigente, modo, plataforma_lista")
        .eq("org_id", orgId)
        .maybeSingle(),
      supabase
        .from("invoices")
        .select("id, number, customer_name, issue_date, total, cae, cae_vencimiento, afip_status, afip_error, numero_afip, tipo_comprobante")
        .eq("org_id", orgId)
        .or("cae.not.is.null,afip_status.not.is.null")
        .order("issue_date", { ascending: false })
        .limit(50),
    ]);

    if (connectionResult.error) {
      setConnection(null);
      setConnectionError(connectionResult.error.message);
    } else {
      setConnection(connectionResult.data as AfipConnectionStatus | null);
    }

    if (invoicesResult.error) {
      setInvoices([]);
      setInvoicesError(invoicesResult.error.message);
    } else {
      setInvoices((invoicesResult.data || []) as FiscalInvoice[]);
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const metrics = useMemo(() => {
    const authorized = invoices.filter((invoice) => invoice.cae && invoice.afip_status === "authorized");
    const failed = invoices.filter((invoice) => ERROR_STATES.has(invoice.afip_status || ""));
    const pending = invoices.filter((invoice) => !invoice.cae && invoice.afip_status === "pending");
    return {
      authorized: authorized.length,
      failed: failed.length,
      pending: pending.length,
      billed: authorized.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0),
    };
  }, [invoices]);

  const readiness = (() => {
    if (connectionError) {
      return {
        title: "No se pudo verificar la conexión fiscal",
        detail: connectionError,
        className: "bg-red-500/5 border-red-500/20 text-red-300",
        icon: XCircle,
      };
    }
    if (!connection?.cuit) {
      return {
        title: "Falta configurar los datos fiscales",
        detail: "Cargá CUIT, razón social, punto de venta y condición del emisor para poder pedir CAE.",
        className: "bg-amber-500/5 border-amber-500/20 text-amber-200",
        icon: AlertTriangle,
      };
    }
    if (!connection.configured) {
      // C14: quién tiene que hacer algo depende del modo. Decirle "cargá el
      // certificado" a un comercio delegado lo manda a un trámite que no le
      // toca y que no puede completar.
      const delegado = connection.modo !== "propio";
      return {
        title: delegado
          ? "La plataforma todavía no puede emitir por vos"
          : "Falta cargar el certificado AFIP",
        detail: delegado
          ? "Tus datos fiscales están guardados. Falta que la plataforma cargue su certificado de AFIP; no hay nada que puedas hacer de tu lado."
          : "Los datos fiscales están guardados, pero todavía no hay certificado y clave privada en el almacén seguro.",
        className: "bg-amber-500/5 border-amber-500/20 text-amber-200",
        icon: AlertTriangle,
      };
    }
    if (!connection.ticket_vigente) {
      return {
        title: "Listo para emitir; conexión pendiente de prueba",
        detail: "Desde Ajustes podés pedir un Ticket de Acceso real a WSAA. No se emite ningún comprobante durante esa prueba.",
        className: "bg-blue-500/5 border-blue-500/20 text-blue-200",
        icon: Clock,
      };
    }
    return {
      title: "Conexión AFIP verificada",
      detail: `WSAA respondió para ${connection.environment === "produccion" ? "producción" : "homologación"}. El Ticket de Acceso vence ${formatDate(connection.ta_expires_at)}.`,
      className: "bg-emerald-500/5 border-emerald-500/20 text-emerald-200",
      icon: CheckCircle2,
    };
  })();
  const ReadinessIcon = readiness.icon;

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Shield}
        title="AFIP / Facturación electrónica"
        description="Estado real de la conexión fiscal y de los CAE solicitados desde Facturas"
        actions={
          <div className="flex flex-wrap gap-2">
            {/* El botón mandaba a /ajustes, donde estaba el formulario. Ahora
                el formulario está acá abajo: no hace falta ir a ningún lado. */}
            <Button asChild size="sm" className="gap-1.5 gradient-gold text-primary-foreground">
              <Link to="/facturas"><FileText className="w-3.5 h-3.5" /> Ver facturas</Link>
            </Button>
          </div>
        }
      />

      {/* C14b — la guía de conexión va primero. Un comercio que no puede
          emitir no necesita ver estadísticas de comprobantes: necesita saber
          qué tocar para poder emitir. */}
      <ConectarAfip
        orgId={orgId}
        motivo={connection?.motivo ?? null}
        plataformaCuit={connection?.plataforma_cuit ?? null}
        plataformaRazonSocial={connection?.plataforma_razon_social ?? null}
        cuitDelComercio={connection?.cuit ?? null}
        ambiente={connection?.environment ?? null}
        onVerificado={load}
      />

      {/* La configuración fiscal, en la página que se llama AFIP. Antes vivía
          en Ajustes → Sistema, a dos clics de acá. */}
      <AfipConfigForm />

      <div className={`rounded-xl border p-4 ${readiness.className}`}>
        <div className="flex gap-3">
          <ReadinessIcon className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-sm">{readiness.title}</p>
            <p className="text-xs mt-1 opacity-85">{readiness.detail}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="CAE autorizados" value={metrics.authorized} icon={CheckCircle2} color="success" />
        <KPICard label="Pendientes" value={metrics.pending} icon={Clock} color="primary" />
        <KPICard label="Con error" value={metrics.failed} icon={XCircle} color="destructive" />
        <KPICard label="Facturado con CAE" value={formatARS(metrics.billed)} icon={FileText} color="blue" />
      </div>

      <section className="bg-card border border-border/40 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border/40">
          <div>
            <h2 className="font-semibold">Comprobantes del Business Core</h2>
            <p className="text-xs text-muted-foreground mt-1">Una factura se autoriza desde Facturas; esta pantalla nunca inventa importes, clientes ni CAE.</p>
          </div>
          <Button size="icon" variant="ghost" onClick={() => void load()} disabled={loading} aria-label="Actualizar estado AFIP">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {invoicesError ? (
          <div className="px-5 py-10 text-sm text-destructive">No se pudieron leer las facturas fiscales: {invoicesError}</div>
        ) : loading ? (
          <div className="px-5 py-10 text-sm text-muted-foreground">Actualizando estado fiscal…</div>
        ) : invoices.length === 0 ? (
          <div className="px-5 py-10 text-sm text-muted-foreground">Todavía no hay facturas con estado AFIP para esta organización.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/20 border-b border-border/40">
                  {["Factura", "Cliente", "Fecha", "Total", "CAE", "Estado"].map((label) => (
                    <th key={label} className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => {
                  const status = invoiceStatus(invoice);
                  return (
                    <tr key={invoice.id} className="border-b border-border/20 hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <p className="font-medium text-xs">{invoice.number}</p>
                        <p className="text-xs text-muted-foreground">{TIPO_COMPROBANTE[invoice.tipo_comprobante || 0] || "Comprobante fiscal"}{invoice.numero_afip ? ` · ${String(invoice.numero_afip).padStart(8, "0")}` : ""}</p>
                      </td>
                      <td className="px-4 py-3 text-xs">{invoice.customer_name}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{formatDate(invoice.issue_date)}</td>
                      <td className="px-4 py-3 text-xs font-medium">{formatARS(Number(invoice.total || 0))}</td>
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs">{invoice.cae || "—"}</p>
                        {invoice.cae_vencimiento && <p className="text-[10px] text-muted-foreground">Vto. {formatDate(invoice.cae_vencimiento)}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={`text-xs ${status.className}`} title={invoice.afip_error || undefined}>{status.label}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
