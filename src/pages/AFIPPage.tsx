import RecorridoAltaFiscal from "@/components/afip/RecorridoAltaFiscal";
import { recorridoAltaFiscal } from "@/lib/recorridoAltaFiscal";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/hooks/useOrganization";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import PageHeader from "@/components/shared/PageHeader";
import ConectarAfip, { type MotivoAfip } from "@/components/afip/ConectarAfip";
import ConceptoDeFacturacion from "@/components/afip/ConceptoDeFacturacion";
import DatosFceComercio from "@/components/afip/DatosFceComercio";
import PercepcionesConfig from "@/components/afip/PercepcionesConfig";
import RetencionesConfig from "@/components/afip/RetencionesConfig";
import ContingenciaCaea from "@/components/afip/ContingenciaCaea";
import ExportacionConfig from "@/components/afip/ExportacionConfig";
import ConsultaDeCuit from "@/components/afip/ConsultaDeCuit";
import AfipConfigForm from "@/components/afip/AfipConfigForm";
import FiscalHealthPanel from "@/components/afip/FiscalHealthPanel";
import LibroIvaDigital from "@/components/afip/LibroIvaDigital";
import ConciliacionArca from "@/components/afip/ConciliacionArca";
import ConectarCertificadoPropio from "@/components/afip/ConectarCertificadoPropio";
import { estadoCertificado } from "@/lib/certificadoPropio";
import { COLUMNAS_CERTIFICADO_PROPIO, conColumnasDelCertificado } from "@/lib/conexionFiscalLectura";
import MonotributoPanel from "@/components/afip/MonotributoPanel";
import { saludFiscal } from "@/lib/fiscalHealth";
import KPICard from "@/components/shared/KPICard";
import { fechaFiscalArgentina } from "@/lib/arcaInvoice";
import { useModulePermissions } from "@/lib/usePermissions";
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
  /** Va impreso en la factura y en los términos. No bloquea CAE: ARCA no lo pide. */
  domicilio: string | null;
  ingresos_brutos: string | null;
  inicio_actividades: string | null;
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
  last_error: string | null;
  delegacion_solicitada_at: string | null;
  delegacion_revisada_at: string | null;
  delegacion_verificada: boolean | null;
  plataforma_verificada?: boolean | null;
  tipo_emisor?: string | null;
  plataforma_ambiente: string | null;
  /** Certificado propio (2026-10-22): datos públicos y última prueba con ARCA. */
  certificado_vence?: string | null;
  certificado_emisor?: string | null;
  certificado_verificado_ok?: boolean | null;
  certificado_verificado_at?: string | null;
  certificado_verificado_motivo?: string | null;
  pedido_pendiente?: boolean | null;
  pedido_csr?: string | null;
  pedido_ambiente?: string | null;
  pedido_creado_at?: string | null;
}

interface FiscalInvoice {
  id: string;
  number: string;
  customer_name: string;
  issue_date: string;
  status: string | null;
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
  return fechaFiscalArgentina(value);
}

function invoiceStatus(invoice: FiscalInvoice) {
  if (invoice.cae && invoice.afip_status === "authorized") {
    return { label: "CAE autorizado", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/20" };
  }
  if (ERROR_STATES.has(invoice.afip_status || "")) {
    return { label: "Requiere atención", className: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/20" };
  }
  return { label: "Pendiente de autorizar", className: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/20" };
}

export default function AFIPPage() {
  usePageTitle("ARCA / Facturación electrónica");
  const { orgId, role } = useOrganization();
  const permissions = useModulePermissions("invoices");
  const canEdit = !permissions.loading && permissions.canEdit && (role === "owner" || role === "admin");
  const [connection, setConnection] = useState<AfipConnectionStatus | null>(null);
  const [invoices, setInvoices] = useState<FiscalInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  // Los enlaces desde otras pantallas (`/afip#consulta-cuit`) llegan antes que
  // las secciones: se baja a la pedida cuando terminó de cargar.
  const { hash } = useLocation();
  useEffect(() => {
    if (loading || !hash) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView({ block: "start" });
  }, [loading, hash]);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [invoicesError, setInvoicesError] = useState<string | null>(null);
  const context = useRef({ orgId, active: true, request: 0 }).current;
  context.orgId = orgId;
  useEffect(() => { context.active = true; return () => { context.active = false; }; }, [context]);

  const load = useCallback(async () => {
    const request = ++context.request;
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
      conColumnasDelCertificado("cuit, configured, environment, punto_venta, razon_social, domicilio, ingresos_brutos, inicio_actividades, ta_expires_at, ticket_vigente, modo, plataforma_lista, plataforma_cuit, plataforma_razon_social, motivo, last_error, delegacion_solicitada_at, delegacion_revisada_at, delegacion_verificada, plataforma_ambiente, plataforma_verificada, tipo_emisor",
        COLUMNAS_CERTIFICADO_PROPIO, columnas => supabase
        .from("afip_connection_status")
        // ⚠️ `motivo`, `plataforma_cuit` y `plataforma_razon_social` faltaban
        // acá aunque la interface los declaraba y la pantalla los usaba. La
        // vista los devuelve bien —medido: motivo=listo, cuit=20446484436—
        // pero llegaban `undefined`, así que el panel mostraba "Conectá AFIP
        // en 3 pasos" con AFIP ya conectado, y el CUIT a delegar salía "—".
        //
        // No lo agarraba nada: `columnasQueExisten` vigila lo contrario —pedir
        // una columna que no existe— y con `strictNullChecks: false` el cast a
        // la interface hace que TypeScript crea que el campo está.
        .select(columnas)
        .eq("org_id", orgId)
        .maybeSingle()),
      supabase
        .from("invoices")
        .select("id, number, customer_name, issue_date, status, total, cae, cae_vencimiento, afip_status, afip_error, numero_afip, tipo_comprobante")
        .eq("org_id", orgId)
        .or("cae.not.is.null,afip_status.not.is.null")
        .order("issue_date", { ascending: false })
        .limit(50),
    ]);
    if (!context.active || context.orgId !== orgId || context.request !== request) return;

    if (connectionResult.error) {
      console.error("[ARCA] status read failed", { code: connectionResult.error.code });
      setConnection(null);
      setConnectionError("No pudimos leer el estado fiscal. Actualizá el estado o reintentá en unos minutos.");
    } else {
      setConnection(connectionResult.data as unknown as AfipConnectionStatus | null);
    }

    if (invoicesResult.error) {
      console.error("[ARCA] fiscal invoices read failed", { code: invoicesResult.error.code });
      setInvoices([]);
      setInvoicesError("La consulta no está disponible ahora. Reintentá sin modificar tus comprobantes.");
    } else {
      setInvoices((invoicesResult.data || []) as FiscalInvoice[]);
    }
    setLoading(false);
  }, [orgId, context]);

  useEffect(() => {
    setConnection(null);
    setInvoices([]);
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

  // Recorrido único de alta fiscal: los mismos datos que la salud fiscal.
  const pasosAlta = useMemo(
    () => (loading || connectionError || invoicesError ? null : recorridoAltaFiscal(connection, invoices)),
    [loading, connectionError, invoicesError, connection, invoices],
  );
  const salud = useMemo(
    () => (connectionError || invoicesError ? null : saludFiscal(connection, invoices)),
    [connection, invoices, connectionError, invoicesError],
  );

  const readiness = (() => {
    if (connectionError) {
      return {
        title: "No se pudo verificar la conexión fiscal",
        detail: connectionError,
        className: "bg-red-500/5 border-red-500/20 text-red-700 dark:text-red-300",
        icon: XCircle,
      };
    }
    if (!connection?.cuit) {
      return {
        title: "Falta configurar los datos fiscales",
        detail: "Cargá CUIT, razón social, domicilio fiscal, punto de venta y condición del emisor.",
        className: "bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-300",
        icon: AlertTriangle,
      };
    }
    if (connection.motivo === "falta_ambiente") {
      return {
        title: "El ambiente elegido no está disponible",
        detail: `El certificado disponible es de ${connection.plataforma_ambiente === "produccion" ? "producción" : "homologación"}. Revisá el ambiente fiscal o contactá a soporte para habilitar el correcto. No se emitió ningún comprobante.`,
        className: "bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-300",
        icon: AlertTriangle,
      };
    }
    // Certificado propio (2026-10-22): qué le falta, en las mismas palabras que
    // el asistente de arriba.
    if (connection.modo === "propio") {
      const cert = estadoCertificado(connection);
      const aviso = {
        sin_certificado: { title: "Falta conectar tu certificado de ARCA", detail: "Seguí el paso a paso de arriba: son unos minutos con tu clave fiscal. Nerqia nunca te la pide." },
        pedido_pendiente: { title: "Falta subir tu certificado", detail: "Creá el certificado en ARCA con el pedido que descargaste, asocialo a Facturación Electrónica y subí el .crt." },
        falta_asociar: { title: "Falta asociar el certificado a Facturación Electrónica", detail: cert.motivo ?? "Hacé ese paso en el Administrador de Relaciones de ARCA y probá de nuevo." },
        rechazado: { title: "ARCA rechazó tu certificado", detail: cert.motivo ?? "Generá un pedido nuevo y volvé a crear el certificado." },
        vencido: { title: "Tu certificado de ARCA venció", detail: "No se pueden autorizar facturas hasta renovarlo. Son unos minutos desde la tarjeta de arriba." },
      }[cert.fase as string];
      if (aviso) return { ...aviso, className: cert.fase === "vencido" || cert.fase === "rechazado"
        ? "bg-red-500/5 border-red-500/20 text-red-700 dark:text-red-300"
        : "bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-300", icon: AlertTriangle };
    }
    if (!connection.configured) {
      // C14: quién tiene que hacer algo depende del modo. Decirle "cargá el
      // certificado" a un comercio delegado lo manda a un trámite que no le
      // toca y que no puede completar.
      const delegado = connection.modo !== "propio";
      return {
        title: delegado
          ? "La plataforma todavía no puede emitir por vos"
          : "Falta cargar el certificado de ARCA",
        detail: delegado
          ? "Tus datos fiscales están guardados. Falta que la plataforma cargue su certificado de ARCA; no hay nada que puedas hacer de tu lado."
          : "Los datos fiscales están guardados, pero todavía no hay certificado y clave privada en el almacén seguro.",
        className: "bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-300",
        icon: AlertTriangle,
      };
    }
    // ⚠️ No entra en `configured`: ARCA no pide domicilio para WSFE. Pedir
    // CAE sigue. Lo que falta es lo que va impreso y lo que leen los términos.
    if (!String(connection.domicilio ?? "").trim()) {
      return {
        title: "Falta el domicilio fiscal",
        detail: "Va impreso en la factura y en los términos de la tienda. Completalo en el formulario de abajo.",
        className: "bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-300",
        icon: AlertTriangle,
      };
    }
    if (connection.environment === "produccion" && !String(connection.ingresos_brutos ?? "").trim()) {
      return {
        title: "Falta declarar Ingresos Brutos",
        detail: "Informá el número, Convenio Multilateral o la condición de no inscripto. Es un dato visible del comprobante.",
        className: "bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-300",
        icon: AlertTriangle,
      };
    }
    if (connection.environment === "produccion" && !connection.inicio_actividades) {
      return {
        title: "Falta el inicio de actividades",
        detail: "Completá la fecha declarada para que la representación de la factura tenga la identidad fiscal completa.",
        className: "bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-300",
        icon: AlertTriangle,
      };
    }
    if (connection.motivo === "falta_delegar") {
      return {
        title: "Falta delegar Facturación Electrónica",
        detail: "Completá la designación en ARCA y solicitá la activación desde la guía de arriba.",
        className: "bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-300",
        icon: AlertTriangle,
      };
    }
    if (connection.motivo === "esperando_plataforma") {
      return {
        title: "Activación fiscal en revisión",
        detail: "Nerqia debe aceptar la designación, asociar el computador fiscal y verificarla con ARCA.",
        className: "bg-blue-500/5 border-blue-500/20 text-blue-700 dark:text-blue-300",
        icon: Clock,
      };
    }
    if (connection.motivo === "requiere_correccion") {
      return {
        title: "La designación necesita una corrección",
        detail: connection.last_error || "ARCA todavía no aceptó la conexión. Revisá el servicio delegado y el punto de venta.",
        className: "bg-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-300",
        icon: AlertTriangle,
      };
    }
    if (!connection.delegacion_verificada) {
      return {
        title: "Conexión pendiente de verificación",
        detail: "Verificá el CUIT y el punto de venta con ARCA desde esta pantalla. Un Ticket de Acceso vigente no confirma la habilitación del comercio; la consulta no emite facturas.",
        className: "bg-blue-500/5 border-blue-500/20 text-blue-700 dark:text-blue-300",
        icon: Clock,
      };
    }
    return {
      title: "Conexión ARCA verificada",
      detail: `ARCA confirmó el CUIT y el punto de venta para ${connection.environment === "produccion" ? "producción; cada comprobante requiere su propio CAE" : "homologación; las pruebas no tienen valor fiscal"}.`,
      className: "bg-emerald-500/5 border-emerald-500/20 text-emerald-700 dark:text-emerald-300",
      icon: CheckCircle2,
    };
  })();
  const ReadinessIcon = readiness.icon;

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        icon={Shield}
        title="ARCA / Facturación electrónica"
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
      {pasosAlta && <RecorridoAltaFiscal pasos={pasosAlta} />}

      <div id="conectar-arca" className="scroll-mt-20">
      {loading ? <p role="status" className="text-sm text-muted-foreground">Consultando estado fiscal…</p> : !connectionError && connection?.modo === "propio" ? (
        <ConectarCertificadoPropio orgId={orgId} estado={connection} canEdit={canEdit} onCambio={() => void load()} />
      ) : !connectionError && <ConectarAfip
        orgId={orgId}
        motivo={connection?.motivo ?? null}
        plataformaCuit={connection?.plataforma_cuit ?? null}
        plataformaRazonSocial={connection?.plataforma_razon_social ?? null}
        cuitDelComercio={connection?.cuit ?? null}
        ambiente={connection?.environment ?? null}
        ultimoDiagnostico={connection?.last_error ?? null}
        delegacionVerificada={connection?.delegacion_verificada ?? null}
        delegacionSolicitada={!!connection?.delegacion_solicitada_at}
        canVerify={canEdit}
        onVerificado={load}
      />}
      </div>

      {/* La configuración fiscal, en la página que se llama AFIP. Antes vivía
          en Ajustes → Sistema, a dos clics de acá. */}
      <div id="datos-fiscales" className="scroll-mt-20">
        <AfipConfigForm canEdit={canEdit} onSaved={load} />
        {orgId && <div className="mt-4 space-y-4"><ConceptoDeFacturacion orgId={orgId} canEdit={canEdit} /><DatosFceComercio orgId={orgId} canEdit={canEdit} /><PercepcionesConfig orgId={orgId} canEdit={canEdit} /><RetencionesConfig orgId={orgId} canEdit={canEdit} cuitAgente={connection?.cuit ?? null} /><ContingenciaCaea orgId={orgId} canEdit={canEdit} /><ExportacionConfig orgId={orgId} canEdit={canEdit} /><ConsultaDeCuit orgId={orgId} cuitPropio={connection?.cuit ?? null} modo={connection?.modo ?? null} /></div>}
      </div>

      <div className={`rounded-xl border p-4 ${readiness.className}`}>
        <div className="flex gap-3">
          <ReadinessIcon className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-sm">{readiness.title}</p>
            <p className="text-xs mt-1 opacity-85">{readiness.detail}</p>
          </div>
        </div>
      </div>

      {!loading && salud && <FiscalHealthPanel salud={salud} />}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="CAE autorizados" value={metrics.authorized} icon={CheckCircle2} color="success" />
        <KPICard label="Pendientes" value={metrics.pending} icon={Clock} color="primary" />
        <KPICard label="Con error" value={metrics.failed} icon={XCircle} color="destructive" />
        <KPICard label="Facturado con CAE" value={formatARS(metrics.billed)} icon={FileText} color="blue" />
      </div>

      {!connectionError && connection?.tipo_emisor === "monotributo" && <MonotributoPanel orgId={orgId} />}

      {!connectionError && <LibroIvaDigital orgId={orgId} monotributo={connection?.tipo_emisor === "monotributo"} canEdit={canEdit} />}
      {!connectionError && <ConciliacionArca orgId={orgId} />}

      <section className="bg-card border border-border/40 rounded-xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border/40">
          <div>
            <h2 className="font-semibold">Comprobantes de tus ventas</h2>
            <p className="text-xs text-muted-foreground mt-1">Una factura se autoriza desde Facturas; esta pantalla nunca inventa importes, clientes ni CAE.</p>
          </div>
          <Button size="icon" variant="ghost" onClick={() => void load()} disabled={loading} aria-label="Actualizar estado ARCA">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>

        {invoicesError ? (
          <div className="px-5 py-10 text-sm text-destructive">No se pudieron leer las facturas fiscales: {invoicesError}</div>
        ) : loading ? (
          <div className="px-5 py-10 text-sm text-muted-foreground">Actualizando estado fiscal…</div>
        ) : invoices.length === 0 ? (
          <div className="px-5 py-10 text-sm text-muted-foreground">Todavía no hay facturas con estado ARCA para esta organización.</div>
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
