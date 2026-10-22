// Datos fiscales del comercio. **No** un formulario de certificados.
//
// Hasta el 2026-08-27 esta pantalla pedía pegar el certificado (.crt) y la
// clave privada (.key) en PEM, con instrucciones de openssl: ahí abandonaba el
// comercio. Desde el 2026-10-22 (ADR 007) cada comercio factura con su propio
// certificado, pero el certificado tampoco se carga acá: lo conecta
// `ConectarCertificadoPropio`, arriba, que genera el pedido en el servidor y
// guía los pasos en ARCA. `ConectarAfip` queda para un comercio delegado.
//
// Lo que quedó acá son los datos que **sólo el comercio conoce** y que van
// impresos en la factura.
//
// ⚠️ Hasta el 2026-08-27 esto vivía dentro de `SettingsPage` (332 líneas de
// las 2.754), mientras `/afip` mostraba el estado y tenía un botón
// «Configurar AFIP» que **mandaba a /ajustes**. Una sola tarea —conectar la
// facturación electrónica— repartida en dos páginas, con el formulario en la
// que NO se llama AFIP.
//
// Ahora vive donde el comercio la busca. Ajustes conserva un puntero.

import { conColumnasDelCertificado } from "@/lib/conexionFiscalLectura";
import { hoyAR } from "@/lib/fechaAR";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileCheck, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { mensajeIdentidadFiscalFaltante } from "@/lib/fiscalIdentity";
import { consultarPadron, domicilioPadron } from "@/lib/arcaPadron";
import { tipoEmisorDesdePadron } from "@/lib/emisorPadron";

interface Props {
  canEdit: boolean;
  onSaved?: () => void | Promise<void>;
}

export default function AfipConfigForm({ canEdit, onSaved }: Props) {
  const { activeOrg } = useOrg();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [cuit, setCuit] = useState("");
  const [razonSocial, setRazonSocial] = useState("");
  const [domicilio, setDomicilio] = useState("");
  const [ingresosBrutos, setIngresosBrutos] = useState("");
  const [inicioActividades, setInicioActividades] = useState("");
  const [puntoVenta, setPuntoVenta] = useState("1");
  const [environment, setEnvironment] = useState("homologacion");
  /**
   * ⚠️ Arranca VACÍO, no en "monotributo".
   *
   * La columna tenía `DEFAULT 'monotributo'` y se sacó el 2026-08-26: un
   * responsable inscripto quedaba marcado como monotributista y emitía Factura
   * C sin IVA discriminado, sin que nada se lo dijera. Preseleccionarlo acá
   * reintroduciría la misma adivinanza desde el otro lado — el comercio
   * apretaría "Guardar" sin mirar y el campo quedaría mal igual.
   */
  const [tipoEmisor, setTipoEmisor] = useState("");
  const [consultandoPadron, setConsultandoPadron] = useState(false);
  const [avisoPadron, setAvisoPadron] = useState<string | null>(null);

  /**
   * Padrón del emisor: con el CUIT, ARCA devuelve razón social, domicilio y
   * condición frente al IVA. Completa sin pisar lo que ARCA no informa, y
   * no guarda: el comercio revisa y guarda como siempre.
   */
  const completarConArca = async () => {
    if (!activeOrg?.id) return;
    setConsultandoPadron(true);
    setAvisoPadron(null);
    const r = await consultarPadron(activeOrg.id, cuit);
    setConsultandoPadron(false);
    if (r.ok === false) {
      setAvisoPadron(r.error);
      return;
    }
    const p = r.persona;
    if (p.nombre) setRazonSocial(p.nombre);
    const domicilioArca = domicilioPadron(p);
    if (domicilioArca) setDomicilio(domicilioArca);
    const tipo = tipoEmisorDesdePadron(p);
    if (tipo) setTipoEmisor(tipo);
    const avisos = [
      tipo ? null : "ARCA no informa inscripción en IVA ni monotributo: elegí el tipo de emisor a mano.",
      p.estadoClave && p.estadoClave !== "ACTIVO" ? `La clave del CUIT figura «${p.estadoClave}» en ARCA.` : null,
    ].filter(Boolean);
    setAvisoPadron(avisos.length ? avisos.join(" ") : "Datos traídos de ARCA. Revisalos y guardá.");
  };

  const [taStatus, setTaStatus] = useState<"none" | "valid" | "expired">("none");
  /** La plataforma tiene su certificado cargado. Si no, un comercio delegado
   *  no puede emitir, y eso NO es un problema suyo: hay que decirlo. */
  const [plataformaLista, setPlataformaLista] = useState(false);
  /** Certificado propio (2026-10-22): con certificado cargado, el ambiente lo
   *  define el certificado (uno de homologación no sirve en producción). */
  const [modo, setModo] = useState<string | null>(null);
  const [certificadoCargado, setCertificadoCargado] = useState(false);
  const [configurado, setConfigurado] = useState(false);

  const refreshConnectionStatus = useCallback(async () => {
    if (!activeOrg) return;

    // La vista sólo devuelve metadatos seguros. El certificado y su clave no
    // vuelven al navegador, ni siquiera después de que se hayan guardado.
    const { data: fila, error } = await conColumnasDelCertificado(
      "cuit, razon_social, domicilio, ingresos_brutos, inicio_actividades, punto_venta, environment, tipo_emisor, configured, plataforma_lista, ta_expires_at, modo",
      "certificado_vence",
      columnas => supabase.from("afip_connection_status").select(columnas).eq("org_id", activeOrg.id).maybeSingle(),
    );
    const data = fila as unknown as Record<string, any> | null;
    if (error) throw error;

    if (!data) {
      setTaStatus("none");
      return;
    }

    // ⚠️ `configured` de la vista significa PUEDE EMITIR, no "subió un
    // certificado": el certificado es siempre el de la plataforma.
    setPlataformaLista(!!data.plataforma_lista);
    setModo(data.modo ?? null);
    setCertificadoCargado(!!data.certificado_vence);
    setConfigurado(!!data.configured);
    setDomicilio(data.domicilio || "");
    setIngresosBrutos(data.ingresos_brutos || "");
    setInicioActividades(data.inicio_actividades || "");

    setCuit(data.cuit || "");
    setRazonSocial(data.razon_social || "");
    setPuntoVenta(String(data.punto_venta || 1));
    setEnvironment(data.environment || "homologacion");
    setTipoEmisor(data.tipo_emisor || "");
    setTaStatus(data.ta_expires_at && new Date(data.ta_expires_at) > new Date() ? "valid" : "none");
  }, [activeOrg]);

  useEffect(() => {
    if (!activeOrg) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        await refreshConnectionStatus();
      } catch (error: any) {
        toast.error(`No se pudo leer el estado ARCA: ${error.message}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [activeOrg, refreshConnectionStatus]);

  const doSave = async () => {
    if (!activeOrg) return;

    const identidad = mensajeIdentidadFiscalFaltante({ razonSocial, domicilio });
    if (identidad) throw new Error(identidad);

    // Lo que no es secreto va por RPC, que además valida CUIT y entorno.
    // Razón social y domicilio no van `null`: la autoridad los exige.
    const { error: cfgErr } = await supabase.rpc("save_afip_config", {
      p_org_id: activeOrg.id,
      p_cuit: cuit,
      p_punto_venta: parseInt(puntoVenta) || 1,
      p_environment: environment,
      p_tipo_emisor: tipoEmisor || null,
      p_razon_social: razonSocial.trim(),
      p_domicilio: domicilio.trim(),
      p_ingresos_brutos: ingresosBrutos.trim() || null,
      p_inicio_actividades: inicioActividades || null,
    });
    if (cfgErr) throw new Error(cfgErr.message.replace(/^.*?:\s*/, ""));

    // ⚠️ Acá se mandaba el certificado y la clave privada a `afip-credentials`.
    // El comercio ya no sube nada: el certificado es de la plataforma y se
    // administra en /platform/afip. Esta pantalla sólo guarda datos fiscales.
  };

  const handleSave = async () => {
    if (!canEdit || saving) return;
    const identidad = mensajeIdentidadFiscalFaltante({ razonSocial, domicilio });
    if (identidad) {
      toast.error(identidad);
      return;
    }
    setSaving(true);
    try {
      await doSave();

      toast.success("Datos fiscales guardados");
      if (modo !== "propio" && !plataformaLista) {
        toast.warning("La plataforma todavía no cargó su certificado; no es algo de tu lado.");
      }
      await refreshConnectionStatus();
      await onSaved?.();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  // ⚠️ Configurado = datos fiscales + certificado DE LA PLATAFORMA. El
  //    comercio ya no sube el suyo, así que su estado no entra acá.
  const propio = modo === "propio";
  const isConfigured = propio ? !!(cuit && configurado) : !!(cuit && plataformaLista);
  const ambienteFijo = propio && certificadoCargado;
  const identidadIncompleta = !!mensajeIdentidadFiscalFaltante({ razonSocial, domicilio })
    || !tipoEmisor
    || (environment === "produccion" && (!ingresosBrutos.trim() || !inicioActividades));

  return (
    <section aria-label="Datos fiscales" className="bg-card border border-border/60 rounded-lg p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
          <FileCheck className="w-4 h-4 text-primary" />ARCA — Facturación electrónica
        </h2>
        {isConfigured && (
          <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-[5px] font-medium ${
            taStatus === "valid" ? "bg-green-500/10 text-green-700 dark:text-green-300" :
            taStatus === "expired" ? "bg-yellow-500/10 text-yellow-700 dark:text-yellow-300" :
            "bg-muted text-muted-foreground"
          }`}>
            {taStatus === "valid" ? <><CheckCircle2 className="w-3 h-3" />TA activo</> :
             taStatus === "expired" ? <><AlertTriangle className="w-3 h-3" />TA vencido</> :
             "No verificado"}
          </span>
        )}
      </div>

      {/* Acá había un instructivo que terminaba en «pegá el certificado (.crt)
          y la clave privada (.key)». Los pasos del certificado los guía ahora
          `ConectarCertificadoPropio`, arriba, sin que el comercio toque claves. */}
      <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-xs text-muted-foreground">
        <p className="font-medium text-foreground mb-0.5">Estos datos van impresos en tu factura</p>
        <p>
          Razón social, CUIT, condición IVA, Ingresos Brutos e inicio de
          actividades quedan en la factura. La plataforma no los adivina y cada
          comprobante autorizado conserva su propia foto fiscal aunque después
          cambies esta configuración.
        </p>
      </div>

      {!canEdit && <p className="text-xs text-muted-foreground">Solo lectura: necesitás permiso de edición de facturación para modificar o verificar la conexión.</p>}
      <fieldset disabled={!canEdit || saving} className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label htmlFor="arca-cuit" className="text-xs text-muted-foreground mb-1 block">CUIT del emisor</label>
          <div className="flex gap-2">
            <Input id="arca-cuit" value={cuit} onChange={e => setCuit(e.target.value)} placeholder="20-12345678-9" className="bg-muted border-border font-mono" />
            <Button type="button" variant="outline" className="shrink-0" disabled={consultandoPadron || cuit.replace(/\D/g, "").length !== 11}
              onClick={() => void completarConArca()} title="Trae razón social, domicilio y condición frente al IVA del padrón de ARCA">
              {consultandoPadron ? <Loader2 className="h-4 w-4 animate-spin" /> : "Completar con ARCA"}
            </Button>
          </div>
          {avisoPadron && <p className="mt-1 text-[11px] text-muted-foreground">{avisoPadron}</p>}
        </div>
        <div>
          <label htmlFor="arca-name" className="text-xs text-muted-foreground mb-1 block">Razón social</label>
          <Input id="arca-name" value={razonSocial} onChange={e => setRazonSocial(e.target.value)} placeholder="Tal cual figura en ARCA" className="bg-muted border-border" required />
        </div>
        <div className="md:col-span-2">
          <label htmlFor="arca-address" className="text-xs text-muted-foreground mb-1 block">Domicilio fiscal</label>
          <Input id="arca-address" value={domicilio} onChange={e => setDomicilio(e.target.value)} placeholder="Calle, número, localidad — el de ARCA, no el de retiro" className="bg-muted border-border" required />
        </div>
        <div>
          <label htmlFor="arca-point" className="text-xs text-muted-foreground mb-1 block">Punto de venta</label>
          <Input id="arca-point" type="number" min="1" max="99999" value={puntoVenta} onChange={e => setPuntoVenta(e.target.value)} className="bg-muted border-border" />
        </div>
        <div>
          <label htmlFor="arca-issuer" className="text-xs text-muted-foreground mb-1 block">Tipo de emisor</label>
          <Select value={tipoEmisor} onValueChange={setTipoEmisor}>
            <SelectTrigger id="arca-issuer" className="bg-muted border-border">
              <SelectValue placeholder="Elegí tu condición" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="monotributo">Monotributista → Factura C</SelectItem>
              <SelectItem value="responsable_inscripto">Responsable Inscripto → Factura A / B</SelectItem>
              <SelectItem value="exento">Exento → Factura C</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label htmlFor="arca-gross-income" className="text-xs text-muted-foreground mb-1 block">Ingresos Brutos</label>
          <Input
            id="arca-gross-income"
            value={ingresosBrutos}
            onChange={e => setIngresosBrutos(e.target.value)}
            placeholder="Número, Convenio Multilateral o No inscripto"
            className="bg-muted border-border"
            required={environment === "produccion"}
          />
        </div>
        <div>
          <label htmlFor="arca-start-date" className="text-xs text-muted-foreground mb-1 block">Inicio de actividades</label>
          <Input
            id="arca-start-date"
            type="date"
            max={hoyAR()}
            value={inicioActividades}
            onChange={e => setInicioActividades(e.target.value)}
            className="bg-muted border-border"
            required={environment === "produccion"}
          />
        </div>
        <div className="md:col-span-2">
          <label htmlFor="arca-environment" className="text-xs text-muted-foreground mb-1 block">Ambiente</label>
          <Select value={environment} onValueChange={setEnvironment} disabled={ambienteFijo}>
            <SelectTrigger id="arca-environment" className="bg-muted border-border"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="homologacion">Homologación (pruebas)</SelectItem>
              <SelectItem value="produccion">Producción (facturas reales)</SelectItem>
            </SelectContent>
          </Select>
          {ambienteFijo && (
            <p className="text-[10px] text-muted-foreground mt-1">
              Lo define tu certificado. Para cambiarlo, generá un pedido del otro ambiente en «Conectá ARCA».
            </p>
          )}
          {environment === "produccion" && (
            <p className="text-[10px] text-destructive mt-1">
              Las facturas emitidas en producción son definitivas ante ARCA. Para
              habilitarlo se exigen Ingresos Brutos e inicio de actividades.
            </p>
          )}
        </div>
      </fieldset>

      {/* ── De qué certificado se factura: información, no una decisión ──
          Desde 2026-10-22 (ADR 007) cada comercio usa el suyo; el modo lo
          define la base, no un selector de esta pantalla. */}
      {propio ? (
        <div className="rounded-[8px] border border-border/60 bg-muted/40 p-3 space-y-1">
          <p className="text-xs font-medium">Facturás con tu propio certificado de ARCA</p>
          <p className="text-[11px] text-muted-foreground">
            Lo conectás en «Conectá ARCA», arriba. Las facturas salen con tu CUIT y tu certificado;
            Nerqia nunca te pide la clave fiscal.
          </p>
        </div>
      ) : (
        <div className="rounded-[8px] border border-border/60 bg-muted/40 p-3 space-y-2">
          <p className="text-xs font-medium">
            Facturás con el certificado de la plataforma
          </p>
          {/* ⚠️ Acá decía «sólo tenés que delegar el servicio wsfe». Se
              contradecía con la tarjeta de arriba, que para un comercio cuyo
              CUIT es el de la plataforma dice «no tenés que hacer ningún
              trámite». Qué falta —y si falta algo— lo decide `ConectarAfip`
              mirando el motivo; este bloque sólo cuenta de qué certificado se
              factura. Dos lugares contando el mismo estado terminan
              contradiciéndose, que es justo lo que pasó. */}
          <p className="text-[11px] text-muted-foreground">
            No tenés que generar ninguna clave ni subir ningún archivo, y la
            activación y su estado se gestionan en la guía de arriba.
          </p>
          {!plataformaLista && (
            <p className="text-[11px] text-destructive">
              La plataforma todavía no cargó su certificado. No es un problema de tu
              configuración: no hay nada que puedas hacer de este lado.
            </p>
          )}
        </div>
      )}
      {/* ⚠️ Acá vivían los dos <Textarea> del certificado y la clave privada en
          PEM. El comercio no sube ninguna clave: el certificado es de la
          plataforma y se administra en /platform/afip. Pedirle a un comerciante
          que genere una clave con openssl es donde abandona. */}

      <div className="flex gap-2 pt-1">
        <Button onClick={handleSave} disabled={!canEdit || saving || identidadIncompleta} className="gradient-gold text-primary-foreground font-semibold">
          {saving ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Guardando…</> : "Guardar datos fiscales"}
        </Button>
      </div>
    </section>
  );
}

// ===== Sucursales (Locations) Management =====
