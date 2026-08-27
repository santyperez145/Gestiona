// Configuración fiscal de AFIP/ARCA — el formulario, no sólo el estado.
//
// ⚠️ Hasta el 2026-08-27 esto vivía dentro de `SettingsPage` (332 líneas de
// las 2.754), mientras `/afip` mostraba el estado y tenía un botón
// «Configurar AFIP» que **mandaba a /ajustes**. Una sola tarea —conectar la
// facturación electrónica— repartida en dos páginas, con el formulario en la
// que NO se llama AFIP.
//
// Ahora vive donde el comercio la busca. Ajustes conserva un puntero.

import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileCheck, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";

export default function AfipConfigForm() {
  const { activeOrg } = useOrg();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const [cuit, setCuit] = useState("");
  const [razonSocial, setRazonSocial] = useState("");
  const [domicilio, setDomicilio] = useState("");
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
  const [certificate, setCertificate] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [taStatus, setTaStatus] = useState<"none" | "valid" | "expired">("none");
  /** Hay certificado PROPIO cargado. No se sabe cuál: eso no vuelve del servidor. */
  const [certConfigurado, setCertConfigurado] = useState(false);
  /**
   * C14 — de qué certificado se factura.
   *
   * `delegado`: el comercio no sube nada; se emite con el certificado de la
   * plataforma y su CUIT en el comprobante, porque delegó `wsfe` desde el
   * Administrador de Relaciones de ARCA.
   *
   * `propio`: subió su certificado. Sigue siendo posible y no se quita — es
   * la salida si la delegación no le sirve.
   */
  const [modo, setModo] = useState<"delegado" | "propio">("delegado");
  /** La plataforma tiene su certificado cargado. Si no, el modo delegado no
   *  puede emitir, y eso NO es un problema del comercio: hay que decirlo. */
  const [plataformaLista, setPlataformaLista] = useState(false);
  /** El formulario del certificado propio arranca cerrado en modo delegado:
   *  mostrar un campo de clave privada a quien no necesita subirla es lo que
   *  hace que el onboarding parezca un trámite. */
  const [mostrarCert, setMostrarCert] = useState(false);

  const refreshConnectionStatus = useCallback(async () => {
    if (!activeOrg) return;

    // La vista sólo devuelve metadatos seguros. El certificado y su clave no
    // vuelven al navegador, ni siquiera después de que se hayan guardado.
    const { data, error } = await supabase
      .from("afip_connection_status")
      .select("cuit, razon_social, domicilio, punto_venta, environment, tipo_emisor, configured, modo, plataforma_lista, ta_expires_at")
      .eq("org_id", activeOrg.id)
      .maybeSingle();
    if (error) throw error;

    if (!data) {
      setCertConfigurado(false);
      setTaStatus("none");
      return;
    }

    // ⚠️ `configured` de la vista significa PUEDE EMITIR, no "subió un
    // certificado": en modo delegado el certificado es el de la plataforma.
    setModo(data.modo === "propio" ? "propio" : "delegado");
    setPlataformaLista(!!data.plataforma_lista);
    setDomicilio(data.domicilio || "");

    setCuit(data.cuit || "");
    setRazonSocial(data.razon_social || "");
    setPuntoVenta(String(data.punto_venta || 1));
    setEnvironment(data.environment || "homologacion");
    setTipoEmisor(data.tipo_emisor || "");
    // El certificado PROPIO sólo existe en modo propio; en delegado
    // `configured` habla del de la plataforma.
    setCertConfigurado(data.modo === "propio" && !!data.configured);
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
        toast.error(`No se pudo leer el estado AFIP: ${error.message}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [activeOrg, refreshConnectionStatus]);

  const doSave = async () => {
    if (!activeOrg) return;

    // Lo que no es secreto va por RPC, que además valida CUIT y entorno.
    const { error: cfgErr } = await supabase.rpc("save_afip_config", {
      p_org_id: activeOrg.id,
      p_cuit: cuit,
      p_punto_venta: parseInt(puntoVenta) || 1,
      p_environment: environment,
      p_tipo_emisor: tipoEmisor || null,
      p_razon_social: razonSocial || null,
      p_domicilio: domicilio || null,
    });
    if (cfgErr) throw new Error(cfgErr.message.replace(/^.*?:\s*/, ""));

    // El certificado sólo si se pegó uno nuevo. La Edge Function lo escribe con
    // `service_role`; desde el navegador no hay forma de llegar a esa tabla.
    // Sólo si efectivamente pegó uno. En modo delegado estos campos están
    // ocultos y vacíos, así que este bloque no corre.
    if (certificate.trim() || privateKey.trim()) {
      const { data, error } = await supabase.functions.invoke("afip-credentials", {
        body: { org_id: activeOrg.id, certificate, privateKey },
      });
      const err = (data as { error?: string } | null)?.error ?? error?.message;
      if (err) throw new Error(err);
      setCertConfigurado(true);
      // No se conservan en memoria más de lo necesario.
      setCertificate("");
      setPrivateKey("");
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await doSave();
      await refreshConnectionStatus();
      toast.success("Configuración AFIP guardada");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!activeOrg) return;
    const tieneNuevoCertificado = !!(certificate.trim() && privateKey.trim());
    if (!cuit) {
      toast.error("Completá el CUIT antes de probar");
      return;
    }
    // En modo delegado el certificado es el de la plataforma: pedirle uno al
    // comercio sería mandarlo a resolver algo que no es suyo.
    if (modo === "propio" && !certConfigurado && !tieneNuevoCertificado) {
      toast.error("Completá certificado y clave privada antes de probar");
      return;
    }
    if (modo === "delegado" && !plataformaLista) {
      toast.error("La plataforma todavía no cargó su certificado de AFIP. No es un problema de tu configuración.");
      return;
    }
    setTesting(true);
    try {
      await doSave();
      const resp = await supabase.functions.invoke("afip-authorize", {
        body: { action: "test_connection", org_id: activeOrg.id },
      });
      const errMsg: string = resp.error?.message || (resp.data as { error?: string })?.error || "";
      if (errMsg) {
        toast.error("Error AFIP: " + errMsg);
      } else {
        toast.success("✓ Conexión con AFIP verificada correctamente");
        setTaStatus("valid");
        await refreshConnectionStatus();
      }
    } catch (e: any) {
      toast.error("Error al probar: " + e.message);
    } finally {
      setTesting(false);
    }
  };

  if (loading) return null;

  const isConfigured = !!(cuit && (modo === "delegado" ? plataformaLista : certConfigurado));
  const canTestConnection = !!(cuit && (
    modo === "delegado" ? plataformaLista : (certConfigurado || (certificate.trim() && privateKey.trim()))
  ));

  return (
    <div className="bg-card border border-border/60 rounded-[10px] p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold text-[14px] tracking-tight flex items-center gap-2">
          <FileCheck className="w-4 h-4 text-primary" />AFIP — Facturación Electrónica
        </h2>
        {isConfigured && (
          <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-[5px] font-medium ${
            taStatus === "valid" ? "bg-green-500/10 text-green-400" :
            taStatus === "expired" ? "bg-yellow-500/10 text-yellow-400" :
            "bg-muted text-muted-foreground"
          }`}>
            {taStatus === "valid" ? <><CheckCircle2 className="w-3 h-3" />TA activo</> :
             taStatus === "expired" ? <><AlertTriangle className="w-3 h-3" />TA vencido</> :
             "No verificado"}
          </span>
        )}
      </div>

      <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-xs text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Requisitos previos</p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>Solicitá el certificado en <strong>CLAVE FISCAL → Administrador de Relaciones de Clave Fiscal</strong></li>
          <li>Vinculá el servicio <strong>wsfe</strong> a tu CUIT</li>
          <li>Pegá el certificado (.crt) y clave privada (.key) en formato PEM abajo</li>
          <li>Probá con <strong>Homologación</strong> antes de pasar a Producción</li>
        </ol>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">CUIT del emisor</label>
          <Input value={cuit} onChange={e => setCuit(e.target.value)} placeholder="20-12345678-9" className="bg-muted border-border font-mono" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Razón social</label>
          <Input value={razonSocial} onChange={e => setRazonSocial(e.target.value)} placeholder="Mi Empresa SRL" className="bg-muted border-border" />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs text-muted-foreground mb-1 block">Domicilio fiscal</label>
          <Input value={domicilio} onChange={e => setDomicilio(e.target.value)} placeholder="Av. Corrientes 1234, CABA" className="bg-muted border-border" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Punto de venta</label>
          <Input type="number" min="1" max="9999" value={puntoVenta} onChange={e => setPuntoVenta(e.target.value)} className="bg-muted border-border" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Tipo de emisor</label>
          <Select value={tipoEmisor} onValueChange={setTipoEmisor}>
            <SelectTrigger className="bg-muted border-border">
              <SelectValue placeholder="Elegí tu condición" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="monotributo">Monotributista → Factura C</SelectItem>
              <SelectItem value="responsable_inscripto">Responsable Inscripto → Factura A / B</SelectItem>
              <SelectItem value="exento">Exento → Factura C</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-2">
          <label className="text-xs text-muted-foreground mb-1 block">Ambiente</label>
          <Select value={environment} onValueChange={setEnvironment}>
            <SelectTrigger className="bg-muted border-border"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="homologacion">🧪 Homologación (pruebas)</SelectItem>
              <SelectItem value="produccion">🚀 Producción (facturas reales)</SelectItem>
            </SelectContent>
          </Select>
          {environment === "produccion" && (
            <p className="text-[10px] text-destructive mt-1">⚠ Las facturas emitidas en producción son definitivas ante AFIP.</p>
          )}
        </div>
      </div>

      {/* ── C14: en modo delegado no se sube ninguna clave ───────────────
          El trámite lo explica y lo verifica `ConectarAfip` en /afip, que dice
          a qué CUIT delegar y le pregunta a ARCA si quedó hecho. Acá sólo queda
          el desvío hacia el certificado propio, que es lo único de esta
          pantalla: los campos del PEM viven abajo. */}
      {modo === "delegado" && (
        <div className="rounded-[8px] border border-border/60 bg-muted/40 p-3 space-y-2">
          <p className="text-xs font-medium">Facturás con el certificado de la plataforma</p>
          <p className="text-[11px] text-muted-foreground">
            No tenés que generar ninguna clave.{" "}
            <Link to="/afip" className="underline underline-offset-2">
              Conectá AFIP desde acá
            </Link>{" "}
            — te dice a qué CUIT delegar el servicio y verifica contra ARCA que
            haya quedado hecho.
          </p>
          {!plataformaLista && (
            <p className="text-[11px] text-destructive">
              La plataforma todavía no cargó su certificado. No es un problema de tu
              configuración: no hay nada que puedas hacer de este lado.
            </p>
          )}
          <button
            type="button"
            onClick={() => setMostrarCert(v => !v)}
            className="text-[11px] text-muted-foreground underline underline-offset-2"
          >
            {mostrarCert ? "Ocultar" : "Prefiero usar mi propio certificado"}
          </button>
        </div>
      )}

      <div className={`space-y-3 pb-12 ${modo === "delegado" && !mostrarCert ? "hidden" : ""}`}>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Certificado AFIP (PEM)</label>
          <Textarea
            value={certificate}
            onChange={e => setCertificate(e.target.value)}
            placeholder={"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"}
            className="bg-muted border-border font-mono text-xs h-28 resize-none"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">Clave privada (PEM)</label>
          <Textarea
            value={privateKey}
            onChange={e => setPrivateKey(e.target.value)}
            placeholder={"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"}
            className="bg-muted border-border font-mono text-xs h-28 resize-none"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Se guarda fuera del alcance del navegador: después de enviarla no se puede volver a leer desde la app.
          </p>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <Button onClick={handleSave} disabled={saving} className="gradient-gold text-primary-foreground font-semibold">
          {saving ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Guardando…</> : "Guardar AFIP"}
        </Button>
        {canTestConnection && (
          <Button onClick={handleTestConnection} disabled={testing} variant="outline">
            {testing ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Verificando…</> : "Verificar conexión"}
          </Button>
        )}
      </div>
    </div>
  );
}

// ===== Sucursales (Locations) Management =====
