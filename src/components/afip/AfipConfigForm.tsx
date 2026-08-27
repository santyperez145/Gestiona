// Datos fiscales del comercio. **No** un formulario de certificados.
//
// ⚠️ Hasta el 2026-08-27 esta pantalla pedía pegar el certificado (.crt) y la
// clave privada (.key) en PEM, con un instructivo de cuatro pasos que empezaba
// en "solicitá el certificado en Clave Fiscal". Eso es exactamente lo que
// CLAUDE.md tiene prohibido desde hace meses: «AFIP se conecta por delegación,
// no subiendo certificados. Un comercio que tiene que generar una clave con
// openssl, armar un CSR y subirlo a WSASS abandona ahí».
//
// Cómo lo hace Tiendanube, que es el mecanismo que funciona: el comercio pone
// **razón social, CUIT y punto de venta**, y la conexión la resuelve la
// plataforma. El certificado es de la plataforma; el comercio sólo delega el
// servicio wsfe desde el Administrador de Relaciones, que ya sabe usar.
//
// Lo que quedó acá son los datos que **sólo el comercio conoce** y que van
// impresos en la factura. El resto lo hace `ConectarAfip` arriba, que dice a
// qué CUIT delegar y le pregunta a ARCA si quedó hecho.
//
// ⚠️ Hasta el 2026-08-27 esto vivía dentro de `SettingsPage` (332 líneas de
// las 2.754), mientras `/afip` mostraba el estado y tenía un botón
// «Configurar AFIP» que **mandaba a /ajustes**. Una sola tarea —conectar la
// facturación electrónica— repartida en dos páginas, con el formulario en la
// que NO se llama AFIP.
//
// Ahora vive donde el comercio la busca. Ajustes conserva un puntero.

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrg } from "@/lib/orgContext";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileCheck, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { mensajeDeEdgeFunction } from "@/lib/edgeErrors";

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

  const [taStatus, setTaStatus] = useState<"none" | "valid" | "expired">("none");
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

    // ⚠️ Acá se mandaba el certificado y la clave privada a `afip-credentials`.
    // El comercio ya no sube nada: el certificado es de la plataforma y se
    // administra en /platform/afip. Esta pantalla sólo guarda datos fiscales.
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await doSave();

      // ── La conexión se hace sola ────────────────────────────────────────
      // Guardar los datos fiscales y después pedirle al comercio que aprete
      // "Probar conexión" es hacerle a él un paso que la app puede hacer.
      //
      // ⚠️ Si falla, NO se convierte en error de guardado: los datos fiscales
      // quedaron bien guardados. Decir "no se pudo guardar" mandaría al
      // comercio a corregir un formulario que está correcto.
      //
      // ⚠️ Va `verificar_delegacion` y NO `test_connection`, por dos razones
      // que costaron un reporte de «me dice eso todavía»:
      //
      //  1. `test_connection` prueba el CERTIFICADO —que WSAA entregue un
      //     Ticket de Acceso—, y eso no dice nada sobre si este comercio puede
      //     emitir. `verificar_delegacion` consulta `FECompUltimoAutorizado`
      //     con el CUIT del comercio: es de sólo lectura y es lo que falla si
      //     ARCA no lo reconoce.
      //  2. `test_connection` devuelve sus fallos con status 400, y
      //     `functions.invoke` **no expone el cuerpo** en un no-2xx: llega un
      //     "non-2xx status code" genérico y el motivo real de ARCA se pierde.
      //     `verificar_delegacion` responde 200 con `{ ok:false, error }`
      //     justamente para que se pueda leer y mostrar.
      if (plataformaLista) {
        const resp = await supabase.functions.invoke("afip-authorize", {
          body: { action: "verificar_delegacion", org_id: activeOrg!.id },
        });
        const r = resp.data as { ok?: boolean; error?: string } | null;

        if (r?.ok) {
          setTaStatus("valid");
          toast.success("✓ Datos guardados y conexión con AFIP verificada");
        } else {
          toast.success("Datos fiscales guardados");
          // Lo que contestó ARCA, textual. "El CUIT no está autorizado" y "el
          // punto de venta no existe" mandan a lugares distintos, y taparlos
          // con un mensaje fijo hace perder una tarde.
          const detalle = await mensajeDeEdgeFunction(resp.error, resp.data);
          console.error("[afip] verificar_delegacion falló:", detalle, resp);
          toast.warning(`No se pudo verificar con ARCA — ${detalle}`);
        }
      } else {
        toast.success("Datos fiscales guardados");
        toast.warning("La plataforma todavía no cargó su certificado; no es algo de tu lado.");
      }

      await refreshConnectionStatus();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!activeOrg) return;
    if (!cuit) {
      toast.error("Completá el CUIT antes de probar");
      return;
    }
    if (!plataformaLista) {
      toast.error("La plataforma todavía no cargó su certificado de AFIP. No es un problema de tu configuración.");
      return;
    }
    setTesting(true);
    try {
      await doSave();
      // Igual que al guardar: lo que le importa al comercio es «¿puedo
      // facturar?», y eso lo contesta `verificar_delegacion` consultando
      // `FECompUltimoAutorizado`. `test_connection` sólo prueba que WSAA
      // entregue un Ticket de Acceso, que es un diagnóstico de la plataforma.
      const resp = await supabase.functions.invoke("afip-authorize", {
        body: { action: "verificar_delegacion", org_id: activeOrg.id },
      });
      const errMsg = (resp.data as { ok?: boolean } | null)?.ok
        ? ""
        : await mensajeDeEdgeFunction(resp.error, resp.data);
      if (errMsg) {
        console.error("[afip] verificar_delegacion falló:", errMsg, resp);
        toast.error("ARCA respondió: " + errMsg);
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

  // ⚠️ Configurado = datos fiscales + certificado DE LA PLATAFORMA. El
  //    comercio ya no sube el suyo, así que su estado no entra acá.
  const isConfigured = !!(cuit && plataformaLista);
  const canTestConnection = !!(cuit && plataformaLista);

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

      {/* ⚠️ Acá había un instructivo de cuatro pasos que terminaba en "pegá el
          certificado (.crt) y la clave privada (.key)". Ése es el trámite que
          hace abandonar a un comercio, y no hace falta: el certificado lo pone
          la plataforma. Los pasos que SÍ le tocan —a qué CUIT delegar wsfe y
          verificar que quedó hecho— los explica `ConectarAfip`, arriba. */}
      <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-xs text-muted-foreground">
        <p className="font-medium text-foreground mb-0.5">Estos datos van impresos en tu factura</p>
        <p>
          Son los únicos que la plataforma no puede averiguar sola. La conexión con
          AFIP se verifica automáticamente al guardar.
        </p>
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

      {/* ── De qué certificado se factura: información, no una decisión ──
          Antes este bloque aparecía sólo en modo delegado y ofrecía un
          «prefiero usar mi propio certificado». Elegir certificado no es una
          decisión del comercio: es de la plataforma. Acá se cuenta cuál se
          usa, que es distinto. */}
      <div className="rounded-[8px] border border-border/60 bg-muted/40 p-3 space-y-2">
        <p className="text-xs font-medium">
          {modo === "propio"
            ? "Facturás con un certificado propio, administrado por la plataforma"
            : "Facturás con el certificado de la plataforma"}
        </p>
        <p className="text-[11px] text-muted-foreground">
          No tenés que generar ninguna clave ni subir ningún archivo.{" "}
          {modo === "propio"
            ? "Tu certificado ya está cargado; si hay que renovarlo lo hace la plataforma."
            : "Sólo tenés que delegar el servicio wsfe desde el Administrador de Relaciones de ARCA."}
        </p>
        {!plataformaLista && (
          <p className="text-[11px] text-destructive">
            La plataforma todavía no cargó su certificado. No es un problema de tu
            configuración: no hay nada que puedas hacer de este lado.
          </p>
        )}
      </div>
      {/* ⚠️ Acá vivían los dos <Textarea> del certificado y la clave privada en
          PEM. El comercio no sube ninguna clave: el certificado es de la
          plataforma y se administra en /platform/afip. Pedirle a un comerciante
          que genere una clave con openssl es donde abandona. */}

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
